import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenLibraryLookup } from './open-library.ts';
const isbn='9780140328721';
const record={key:'/books/OL7353617M',title:'Matilda',authors:[{name:'Roald Dahl'}],identifiers:{isbn_10:['0140328726']},cover:{large:'https://covers.openlibrary.org/b/id/123-L.jpg'}};
const response=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
test('exact ISBN10 edition becomes canonical metadata with verified cover ID and provenance',async()=>{
 let calls=0;
 const lookup=createOpenLibraryLookup({fetch:async(url,init)=>{calls++; const u=new URL(String(url)); assert.equal(u.origin,'https://openlibrary.org'); assert.equal(u.searchParams.get('bibkeys'),`ISBN:${isbn}`); assert.equal(u.searchParams.get('jscmd'),'data'); assert.equal(init?.redirect,'error'); assert.equal(new Headers(init?.headers).has('authorization'),false); return response({[`ISBN:${isbn}`]:record});}});
 const result=await lookup('0140328726'); assert.equal(result.status,'FOUND'); assert.equal(result.book?.isbn,isbn); assert.equal(result.coverId,'123'); assert.equal(result.book?.sourceUrl,'https://openlibrary.org/books/OL7353617M');
 await lookup(isbn); assert.equal(calls,1);
});
test('wrong ISBN, Work records, malformed and excessive fields fail closed',async()=>{
 for(const bad of [{...record,identifiers:{isbn_13:['9780306406157']}},{...record,key:'/works/OL1W'},{...record,title:'x'.repeat(201)},{...record,authors:Array.from({length:21},()=>({name:'A'}))}]) {
  assert.equal((await createOpenLibraryLookup({fetch:async()=>response({[`ISBN:${isbn}`]:bad})})(isbn)).status,'UNAVAILABLE');
 }
});
test('coalescing and one-per-second process-instance admission; missing cache',async()=>{
 let calls=0; let time=1000;
 const lookup=createOpenLibraryLookup({now:()=>time,fetch:async()=>{calls++; return response({});}});
 const values=await Promise.all([lookup(isbn),lookup(isbn)]); assert.equal(values[0].status,'NOT_FOUND'); assert.equal(calls,1);
 assert.equal((await lookup('9780306406157')).status,'UNAVAILABLE'); time+=1000; assert.equal((await lookup('9780306406157')).status,'NOT_FOUND'); assert.equal(calls,2);
});
test('timeout bounds even noncompliant transports; oversized and invalid JSON rejected',async()=>{
 const lookup=createOpenLibraryLookup({timeoutMs:10,fetch:async()=>new Promise(()=>{})}); assert.equal((await lookup(isbn)).status,'UNAVAILABLE');
 for(const r of [new Response('x'),new Response('{}',{headers:{'content-length':'1048577'}}),new Response('x'.repeat(1048577))]) assert.equal((await createOpenLibraryLookup({fetch:async()=>r})(isbn)).status,'UNAVAILABLE');
});
test('979 exact identifier works and arbitrary cover URLs are not trusted',async()=>{
 const n='9791090636071'; const result=await createOpenLibraryLookup({fetch:async()=>response({[`ISBN:${n}`]:{...record,identifiers:{isbn_13:[n]},cover:{large:'https://evil.test/123.jpg'}}})})(n); assert.equal(result.status,'FOUND'); assert.equal(result.coverId,undefined);
});
