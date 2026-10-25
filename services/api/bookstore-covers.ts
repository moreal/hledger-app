import sharp from 'sharp';
import { normalizeIsbn } from '../../packages/domain/src/books.ts';

export interface BookstoreCover { coverUrl:string; coverSource:'YES24'|'ALADIN'; coverSourceUrl:string }
const HTML_LIMIT=1_048_576;
const IMAGE_LIMIT=2_097_152;
const cache=new Map<string,{expires:number;value:BookstoreCover|null}>();
const pending=new Map<string,Promise<BookstoreCover|null>>();
let recent:number[]=[];
function attributes(tag:string):Map<string,string> {
 const result=new Map<string,string>();
 for(const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)) result.set(match[1].toLowerCase(),match[3]);
 return result;
}
function coverUrl(value:unknown,id:string):string|null {
 if(typeof value!=='string') return null;
 try {
  const url=new URL(value);
  return url.protocol==='https:' && url.hostname==='image.yes24.com' && !url.port && !url.username && !url.password && !url.search && !url.hash && new RegExp(`^/goods/${id}/xl$`).test(url.pathname) ? url.href : null;
 } catch { return null; }
}
function parseProduct(html:string,isbn:string,id:string):string|null {
 // Only identity metadata is considered, never recommendation ISBNs elsewhere in the page.
 for(const tag of html.match(/<meta\b[^>]*>/gi)??[]) {
  const attrs=attributes(tag);
  if(attrs.get('property')?.toLowerCase()==='books:isbn' && attrs.get('content')!==isbn) return null;
 }
 const books:Record<string,unknown>[]=[];
 function visit(value:unknown) {
  if(Array.isArray(value)) { for(const item of value) visit(item); return; }
  if(!value || typeof value!=='object') return;
  const record=value as Record<string,unknown>;
  const types=Array.isArray(record['@type'])?record['@type']:[record['@type']];
  if(types.includes('Book')) books.push(record);
  if(record['@graph']) visit(record['@graph']);
 }
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
  if(attributes(match[1]).get('type')?.toLowerCase()!=='application/ld+json') continue;
  try { visit(JSON.parse(match[2])); } catch { return null; }
 }
 if(books.length!==1 || books[0].isbn!==isbn) return null;
 const image=books[0].image;
 if(!image || typeof image!=='object' || Array.isArray(image)) return null;
 const record=image as Record<string,unknown>;
 const url=coverUrl(record.url,id);
 if(!url || (record.contentUrl!==undefined && coverUrl(record.contentUrl,id)!==url)) return null;
 return url;
}
function parseAladinProduct(html:string,isbn:string):string|null {
 const metadata=new Map<string,string>();
 for(const tag of html.match(/<meta\b[^>]*>/gi)??[]) {
  const attrs=attributes(tag); const key=attrs.get('property')?.toLowerCase();
  if(key && ['books:isbn','og:barcode','og:image'].includes(key)) {
   const value=attrs.get('content')??'';
   if(metadata.has(key) && metadata.get(key)!==value) return null;
   metadata.set(key,value);
  }
 }
 if(metadata.get('books:isbn')!==isbn || metadata.get('og:barcode')!==isbn) return null;
 const identities:unknown[]=[];
 function visit(value:unknown) {
  if(Array.isArray(value)) {value.forEach(visit);return;}
  if(!value || typeof value!=='object') return;
  const record=value as Record<string,unknown>;
  const types=Array.isArray(record['@type'])?record['@type']:[record['@type']];
  if(types.includes('Book')) {
   if(record.isbn!==undefined) identities.push(record.image===metadata.get('og:image')?record.isbn:undefined);
   else if(Array.isArray(record.workExample) && record.workExample.length===1 && record.image===metadata.get('og:image')) {
    const edition=record.workExample[0] as Record<string,unknown>|null;
    identities.push(edition && edition['@type']==='Book'?edition.isbn:undefined);
   } else identities.push(undefined);
  }
  if(record['@graph']) visit(record['@graph']);
 }
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
  if(attributes(match[1]).get('type')?.toLowerCase()!=='application/ld+json') continue;
  try {visit(JSON.parse(match[2]));}catch{return null;}
 }
 if(identities.length!==1 || identities[0]!==isbn) return null;
 try {
  const url=new URL(metadata.get('og:image')??'');
  return url.protocol==='https:' && url.hostname==='image.aladin.co.kr' && !url.port && !url.username && !url.password && !url.search && !url.hash && /^\/product\/\d+\/\d+\/cover500\/[a-zA-Z0-9_-]+\.jpg$/.test(url.pathname)?url.href:null;
 }catch{return null;}
}
async function body(response:Response,limit:number):Promise<Buffer|null> {
 if(!response.ok || !response.body || Number(response.headers.get('content-length'))>limit) { await response.body?.cancel(); return null; }
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try {
  while(true) { const part=await reader.read(); if(part.done) break; size+=part.value.byteLength; if(size>limit) { await reader.cancel(); return null; } chunks.push(part.value); }
  return Buffer.concat(chunks);
 } finally { reader.releaseLock(); }
}
async function resolveCover(isbn:string,fetcher:typeof fetch,timeoutMs:number,provider:'YES24'|'ALADIN'='YES24'):Promise<BookstoreCover|null> {
 const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeoutMs);
 async function read(url:string,image=false) {
  if(controller.signal.aborted) return null;
  const response=await fetcher(url,{redirect:'error',signal:controller.signal,headers:{Accept:image?'image/jpeg':'text/html'}});
  if(response.redirected || (response.url && response.url!==url) || !(image?/^image\/jpeg(?:;|$)/i:/^text\/html(?:;|$)/i).test(response.headers.get('content-type')??'')) { await response.body?.cancel();return null; }
  return body(response,image?IMAGE_LIMIT:HTML_LIMIT);
 }
 const work=async():Promise<BookstoreCover|null>=>{
  const search=await read(provider==='YES24'?`https://www.yes24.com/Product/Search?domain=BOOK&query=${isbn}`:`https://www.aladin.co.kr/search/wsearchresult.aspx?SearchTarget=Book&SearchWord=${isbn}`);if(!search) return null;
  const ids=new Set<string>();
  for(const tag of search.toString('utf8').match(/<a\b[^>]*>/gi)??[]) {
   const attrs=attributes(tag);if(provider==='YES24' && !(attrs.get('class')??'').split(/\s+/).includes('gd_name')) continue;
   const href=attrs.get('href')??'';
   const match=provider==='YES24'?href.match(/^\/product\/goods\/(\d+)$/i):href.match(/^(?:https:\/\/www\.aladin\.co\.kr)?\/shop\/wproduct\.aspx\?ItemId=([1-9]\d*)$/i);if(match) ids.add(match[1]);
   if(ids.size>3) return null;
  }
  const matches:{url:string;source:string}[]=[];
  await Promise.all([...ids].map(async id=>{
   const source=provider==='YES24'?`https://www.yes24.com/Product/Goods/${id}`:`https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=${id}`;
   const product=await read(source);if(!product) return;
   const url=provider==='YES24'?parseProduct(product.toString('utf8'),isbn,id):parseAladinProduct(product.toString('utf8'),isbn);if(url) matches.push({url,source});
  }));
  if(matches.length!==1 || controller.signal.aborted) return null;
  const bytes=await read(matches[0].url,true);if(!bytes || bytes[0]!==255 || bytes[1]!==216 || bytes[2]!==255) return null;
  const image=sharp(bytes,{limitInputPixels:16_000_000,failOn:'warning'}).timeout({seconds:1});
  const info=await image.metadata();if(info.format!=='jpeg' || !info.width || !info.height || info.width<50 || info.height<50) return null;
  await image.resize(1,1).raw().toBuffer();if(controller.signal.aborted) return null;
  return {coverUrl:matches[0].url,coverSource:provider,coverSourceUrl:matches[0].source};
 };
 // Racing also bounds injected transports that do not implement AbortSignal.
 let timeout:ReturnType<typeof setTimeout>|undefined;
 try { return await Promise.race([work(),new Promise<null>(resolve=>{timeout=setTimeout(()=>{controller.abort();resolve(null);},timeoutMs);})]); }
 catch { return null; } finally {controller.abort();clearTimeout(timer);if(timeout) clearTimeout(timeout);}
}
async function resolveBookstores(isbn:string,fetcher:typeof fetch,timeoutMs:number):Promise<BookstoreCover|null> {
 const started=Date.now();
 const yes24=await resolveCover(isbn,fetcher,timeoutMs/3);
 if(yes24) return yes24;
 const remaining=timeoutMs-(Date.now()-started);
 return remaining>0?resolveCover(isbn,fetcher,remaining,'ALADIN'):null;
}
/** Key-free public search, with exact product ISBN and a decoded image required. */
export async function lookupBookstoreCover(rawIsbn:string,options:{fetch?:typeof fetch;timeoutMs?:number}={}):Promise<BookstoreCover|null> {
 let isbn:string;try {isbn=normalizeIsbn(rawIsbn);}catch{return null;}
 if(!/^\d{13}$/.test(isbn)) return null;
 if(options.fetch) return resolveBookstores(isbn,options.fetch,options.timeoutMs??4500);
 const now=Date.now();const found=cache.get(isbn);if(found && found.expires>now) return found.value;
 const existing=pending.get(isbn);if(existing) return existing;
 // At most ten public HTTP requests per lookup; this local budget is deliberately conservative.
 recent=recent.filter(time=>time>now-300_000);if(recent.length>=10)return null;recent.push(now);
 const request=resolveBookstores(isbn,fetch,options.timeoutMs??4500).then(value=>{
  if(cache.size>=500)cache.delete(cache.keys().next().value!);
  cache.set(isbn,{value,expires:Date.now()+(value?86_400_000:300_000)});return value;
 }).finally(()=>pending.delete(isbn));pending.set(isbn,request);return request;
}
