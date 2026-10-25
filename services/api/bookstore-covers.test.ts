import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {lookupBookstoreCover} from './bookstore-covers.ts';
const isbn='9788936434595';
const url='https://image.yes24.com/goods/108422348/xl';
const book={ '@type':['Book','Product'],isbn,image:{'@type':'ImageObject',url,contentUrl:url}};
const html=(value:unknown=book,meta=isbn)=>`<meta property="books:isbn" content="${meta}"><script type="application/ld+json">${JSON.stringify(value)}</script>`;
const search='<li data-goods-no="108422348"><a class="gd_name" href="/product/goods/108422348">채식주의자</a><a class="gd_name" href="/product/goods/108422348">duplicate</a></li>';
const text=(value:string)=>new Response(value,{headers:{'content-type':'text/html;charset=UTF8'}});
async function run(product:string,options:{search?:string;image?:Response}={}) {
 const bytes=await sharp({create:{width:100,height:160,channels:3,background:'#235'}}).jpeg().toBuffer();let calls=0;
 const result=await lookupBookstoreCover(isbn,{fetch:async(target,init)=>{
  assert.equal(init?.redirect,'error');if(String(target).includes('aladin.co.kr'))return text('');calls++;
  if(calls===1){assert.equal(String(target),`https://www.yes24.com/Product/Search?domain=BOOK&query=${isbn}`);return text(options.search??search);}
  if(String(target).includes('/Product/Goods/'))return text(product);
  assert.equal(String(target),url);return options.image??new Response(bytes,{headers:{'content-type':'image/jpeg'}});
 }});return {result,calls};
}
test('public ISBN search deduplicates links and accepts exact Book/Product image',async()=>{
 const {result,calls}=await run(html());assert.equal(calls,3);
 assert.deepEqual(result,{coverUrl:url,coverSource:'YES24',coverSourceUrl:'https://www.yes24.com/Product/Goods/108422348'});
});
test('rejects old edition, conflicting identity metadata, multiple Book objects and malformed JSON',async()=>{
 for(const product of [html({...book,isbn:'9788936433598'}),html(book,'9788936433598'),html([book,book]),html({...book,isbn:[isbn,'9788936433598']}),'<script type="application/ld+json">bad</script>',html({...book,image:undefined})]) {
  const {result,calls}=await run(product);assert.equal(result,null);assert.equal(calls,2);
 }
});
test('rejects unsafe images and images belonging to a different product',async()=>{
 for(const unsafe of ['http://image.yes24.com/goods/108422348/xl','https://image.yes24.com.evil/goods/108422348/xl','https://image.yes24.com/goods/99/xl',`${url}?redirect=x`,'https://user@image.yes24.com/goods/108422348/xl','https://image.yes24.com/private']) {
  assert.equal((await run(html({...book,image:{url:unsafe}}))).result,null);
 }
 assert.equal((await run(html({...book,image:{url,contentUrl:'https://image.yes24.com/goods/99/xl'}}))).result,null);
});
test('rejects missing, oversized, fake, tiny and redirected images',async()=>{
 const tiny=await sharp({create:{width:1,height:1,channels:3,background:'white'}}).jpeg().toBuffer();
 for(const image of [new Response(null,{status:404}),new Response('fake',{headers:{'content-type':'image/jpeg'}}),new Response(tiny,{headers:{'content-type':'image/jpeg'}}),new Response('',{headers:{'content-type':'image/jpeg','content-length':'2097153'}}),new Response(null,{status:302,headers:{location:'https://evil.test'}})]) assert.equal((await run(html(),{image})).result,null);
});
test('bounds HTML, search candidates, unsafe result links, and missing metadata',async()=>{
 for(const searchValue of ['', '<a class="gd_name" href="https://evil.test/product/goods/1">bad</a>',Array.from({length:4},(_,i)=>`<a class="gd_name" href="/product/goods/${i}">x</a>`).join('')]) assert.equal((await run(html(),{search:searchValue})).result,null);
 assert.equal((await run('x'.repeat(1_048_577))).result,null);
 assert.equal((await run('no book')).result,null);
});
test('rejects ambiguous exact matches across products',async()=>{
 const searchValue=search+'<a class="gd_name" href="/product/goods/99">x</a>';
 assert.equal((await run(html(),{search:searchValue})).result?.coverSource,'YES24'); // Second product has mismatched image and fails identity binding.
 const result=await lookupBookstoreCover(isbn,{fetch:async target=>String(target).includes('/Search?')?text(searchValue):text(html({...book,image:{url:`https://image.yes24.com/goods/${String(target).endsWith('/99')?'99':'108422348'}/xl`}}))});assert.equal(result,null);
});
test('overall deadline includes a transport that ignores cancellation',async()=>{
 assert.equal(await lookupBookstoreCover(isbn,{timeoutMs:5,fetch:async()=>new Promise(()=>{})}),null);
});

const aladinUrl='https://image.aladin.co.kr/product/29137/2/cover500/8936434594_2.jpg';
const aladinProduct=(identity=isbn,image=aladinUrl)=>`<meta property="books:isbn" content="${identity}"><meta property="og:barcode" content="${identity}"><meta property="og:image" content="${image}"><script type="application/ld+json">${JSON.stringify({'@type':'Book',isbn:identity,image})}</script>`;
async function fallback(product=aladinProduct(),searchPage='<a href="/shop/wproduct.aspx?ItemId=291370219">book</a>') {
 const calls:string[]=[]; const bytes=await sharp({create:{width:100,height:160,channels:3,background:'#235'}}).jpeg().toBuffer();
 const result=await lookupBookstoreCover(isbn,{fetch:async target=>{
  const value=String(target);calls.push(value);
  if(value.includes('yes24.com'))return text('');
  if(value.includes('wsearchresult.aspx'))return text(searchPage);
  if(value.includes('wproduct.aspx'))return text(product);
  return new Response(bytes,{headers:{'content-type':'image/jpeg'}});
 }});return {result,calls};
}
test('Aladin runs after missing YES24 and requires exact product ISBN',async()=>{
 const {result,calls}=await fallback();
 assert.deepEqual(result,{coverUrl:aladinUrl,coverSource:'ALADIN',coverSourceUrl:'https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=291370219'});
 assert.equal(calls.length,4);
 for(const product of [aladinProduct('9788936433598'),aladinProduct().replace(`content="${isbn}"`,`content="9788936433598"`),aladinProduct().replace('"isbn":"'+isbn+'"','"isbn":"9788936433598"'),aladinProduct(isbn,'https://evil.test/a.jpg')])assert.equal((await fallback(product)).result,null);
});
test('Aladin ignores untrusted search links and bounds candidates',async()=>{
 for(const value of ['<a href="https://evil.test/shop/wproduct.aspx?ItemId=1">x</a>',Array.from({length:4},(_,i)=>`<a href="/shop/wproduct.aspx?ItemId=${i+1}">x</a>`).join('')])assert.equal((await fallback(aladinProduct(),value)).result,null);
});

test('Aladin binds edition workExample ISBN to the parent Book image',async()=>{
 const product=aladinProduct().replace(JSON.stringify({'@type':'Book',isbn,image:aladinUrl}),JSON.stringify({'@type':'Book',image:aladinUrl,workExample:[{'@type':'Book',isbn}]}));
 assert.equal((await fallback(product)).result?.coverSource,'ALADIN');
 assert.equal((await fallback(product.replace('"isbn":"'+isbn+'"','"isbn":"9788936433598"'))).result,null);
});

test('YES24 timeout reserves time for an exact Aladin fallback',async()=>{
 const bytes=await sharp({create:{width:100,height:160,channels:3,background:'#235'}}).jpeg().toBuffer();
 const started=Date.now();
 const result=await lookupBookstoreCover(isbn,{timeoutMs:300,fetch:async target=>{
  const value=String(target);
  if(value.includes('yes24.com'))return new Promise(()=>{});
  if(value.includes('wsearchresult.aspx'))return text('<a href="/shop/wproduct.aspx?ItemId=291370219">book</a>');
  if(value.includes('wproduct.aspx'))return text(aladinProduct());
  return new Response(bytes,{headers:{'content-type':'image/jpeg'}});
 }});
 assert.equal(result?.coverSource,'ALADIN');assert.ok(Date.now()-started<500);
});
test('Aladin rejects conflicting barcode, multiple editions and conflicting image metadata',async()=>{
 const product=aladinProduct();
 for(const value of [product.replace('property="og:barcode" content="'+isbn+'"','property="og:barcode" content="9788936433598"'),product+'<meta property="og:image" content="https://evil.test/a.jpg">',product.replace('"image":"'+aladinUrl+'"','"image":"https://image.aladin.co.kr/product/1/1/cover500/wrong.jpg"'),product.replace(JSON.stringify({'@type':'Book',isbn,image:aladinUrl}),JSON.stringify([{'@type':'Book',isbn},{'@type':'Book',isbn}]))])assert.equal((await fallback(value)).result,null);
});
