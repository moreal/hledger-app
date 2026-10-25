import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupBookMetadata } from './book-metadata.ts';
const isbn='9780140328721';
const data={key:'/books/OL7353617M',title:'Matilda',identifiers:{isbn_13:[isbn]}};
const json=(value:unknown)=>new Response(JSON.stringify(value));
test('Open Library metadata survives missing cover and requires no SeoJi service',async()=>{
 const calls:string[]=[];
 const result=await lookupBookMetadata(isbn,{fetch:async url=>{calls.push(String(url));return json({[`ISBN:${isbn}`]:data});},coverFetch:async()=>new Response(null,{status:404})});
 assert.equal(result.status,'FOUND');assert.equal(result.book?.title,'Matilda');assert.equal(result.book?.coverUrl,null);assert.equal(calls.length,1);assert.ok(calls[0].startsWith('https://openlibrary.org/'));
});
test('no implicit localhost fallback; explicitly configured SeoJi remains available',async()=>{
 let calls=0; const fetcher:typeof fetch=async url=>{calls++;return String(url).startsWith('https://openlibrary.org/')?json({}):json({isbn13:isbn,title:'Local title',contributors:[]});};
 assert.equal((await lookupBookMetadata(isbn,{fetch:fetcher})).status,'NOT_FOUND');assert.equal(calls,1);
 const result=await lookupBookMetadata(isbn,{fetch:fetcher,baseUrl:'http://localhost:8000',coverFetch:async()=>new Response(null,{status:404}),bookstoreFetch:async()=>new Response(null,{status:404})});assert.equal(result.status,'FOUND');assert.equal(result.book?.title,'Local title');assert.equal(calls,3);
});
