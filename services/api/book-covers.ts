import sharp from 'sharp';
import { normalizeIsbn } from '../../packages/domain/src/books.ts';
export { normalizeBookCoverUrl } from '../../packages/domain/src/book-cover-url.ts';
export interface BookCover { coverUrl: string; coverSource: 'OPEN_LIBRARY'; coverSourceUrl: string }
const MAX_BYTES = 2_097_152;
const cache = new Map<string, { expires: number; value: BookCover | null }>();
const pending = new Map<string, Promise<BookCover | null>>();
// Process-local budget leaves room for browsers to fetch the same ISBN URLs.
// Multiple API processes sharing an IP must enforce an aggregate limit externally.
let recentRequests: number[] = [];
function safeRedirect(value: string, base: string): URL | null {
 try {
  const url=new URL(value,base);
  const imagePath=url.hostname==='covers.openlibrary.org' && /^\/b\/id\/\d+-L\.jpg$/.test(url.pathname) && !url.search;
  const archiveDownload=url.hostname==='archive.org' && /^\/download\/(?:l_covers_\d+\/l_covers_\d+_\d+\.zip|olcovers\d+\/olcovers\d+-L\.zip)\/\d+-L\.jpg$/.test(url.pathname) && !url.search;
  const archivePath=/^ia\d+\.us\.archive\.org$/.test(url.hostname) && url.pathname==='/view_archive.php' && [...url.searchParams.keys()].sort().join(',')==='archive,file' && /^\/\d+\/items\/(?:[ml]_covers_\d+\/[ml]_covers_\d+_\d+\.zip|olcovers\d+\/olcovers\d+-L\.zip)$/.test(url.searchParams.get('archive')??'') && /^\d+-[SML]\.jpg$/.test(url.searchParams.get('file')??'');
  return url.protocol==='https:' && !url.username && !url.password && !url.port && !url.hash && (imagePath || archivePath || archiveDownload) ? url : null;
 } catch { return null; }
}
async function fetchCover(isbn:string, fetcher:typeof fetch, timeoutMs:number):Promise<BookCover|null> {
 const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeoutMs);
 const coverUrl=`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
 try {
  let target=coverUrl; let response:Response | undefined;
  for(let redirects=0;redirects<=2;redirects++) {
   response=await fetcher(target,{signal:controller.signal,redirect:'manual',headers:{Accept:'image/jpeg'}});
   if(![301,302,303,307,308].includes(response.status)) break;
   const next=safeRedirect(response.headers.get('location')??'',target); await response.body?.cancel();
   if(!next || redirects===2) return null; target=next.href;
  }
  if(!response?.ok || !response.body || !/^image\/jpeg(?:;|$)/i.test(response.headers.get('content-type')??'')) { await response?.body?.cancel(); return null; }
  if(Number(response.headers.get('content-length'))>MAX_BYTES) { await response.body.cancel(); return null; }
  const reader=response.body.getReader(); const chunks:Uint8Array[]=[]; let size=0;
  try {
   while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>MAX_BYTES) { await reader.cancel(); return null; } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes=Buffer.concat(chunks);
  if(bytes[0]!==255 || bytes[1]!==216 || bytes[2]!==255) return null;
  const image=sharp(bytes,{limitInputPixels:16_000_000,failOn:'warning'}).timeout({seconds:1});
  const metadata=await image.metadata();
  if(metadata.format!=='jpeg' || !metadata.width || !metadata.height || metadata.width<50 || metadata.height<50 || controller.signal.aborted) return null;
  await image.resize(1,1).raw().toBuffer();
  if(controller.signal.aborted) return null;
  return {coverUrl,coverSource:'OPEN_LIBRARY',coverSourceUrl:`https://openlibrary.org/isbn/${isbn}`};
 } catch { return null; } finally { clearTimeout(timer); }
}
/** Only the exact ISBN endpoint is queried. A missing cover never changes metadata status. */
export async function lookupBookCover(rawIsbn:string,options:{fetch?:typeof fetch;timeoutMs?:number}={}):Promise<BookCover|null> {
 const isbn=normalizeIsbn(rawIsbn);
 // Injected transports bypass process caches so tests and callers stay isolated.
 if(options.fetch) return fetchCover(isbn,options.fetch,options.timeoutMs??3500);
 const now=Date.now(); const cached=cache.get(isbn); if(cached && cached.expires>now) return cached.value;
 const existing=pending.get(isbn); if(existing) return existing;
 recentRequests=recentRequests.filter(time=>time>now-300_000);
 if(recentRequests.length>=40) return null;
 recentRequests.push(now);
 const request=fetchCover(isbn,fetch,options.timeoutMs??3500).then(value=>{
  if(cache.size>=500) cache.delete(cache.keys().next().value!);
  cache.set(isbn,{value,expires:Date.now()+(value?86_400_000:300_000)}); return value;
 }).finally(()=>pending.delete(isbn));
 pending.set(isbn,request); return request;
}
