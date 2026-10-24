import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidBookConfirmation } from './index';
const payload=()=>({errors:[],idempotency:{key:'book-request',replayed:false},book:{id:'0123456789abcdef0123',commodity:'asset:book:0123456789abcdef0123',isbn:'9780132350884',title:'Clean Code',assetAccount:'assets:books',purchaseDate:'2026-10-23',status:'HELD',disposalDate:null,purchasePrice:{commodity:'KRW',value:'15000.0000000000000001'},saleProceeds:null,realizedGain:null}});
test('book confirmation requires complete matching copy metadata',()=>{
  const p=payload();assert.equal(isValidBookConfirmation(p,'book-request'),true);
  assert.equal(isValidBookConfirmation(p,'other'),false);
  assert.equal(isValidBookConfirmation({...p,book:{...p.book,commodity:'asset:book:wrong'}},'book-request'),false);
  assert.equal(isValidBookConfirmation({...p,book:{...p.book,purchasePrice:{commodity:'KRW',value:15000}}},'book-request'),false);
  assert.equal(isValidBookConfirmation({...p,book:{...p.book,purchaseDate:'2026-02-30'}},'book-request'),false);
});

test('typed book client runs purchase, sale and discard against HTTP and actual hledger',async t=>{
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {startServer}=await import('../../services/api/server.ts');const {createHledgerAdapter}=await import('../../services/api/hledger.ts');const {createLedgerClient}=await import('./index.ts');
  const dir=await mkdtemp(join(tmpdir(),'book-client-'));t.after(()=>rm(dir,{recursive:true,force:true}));const journal=join(dir,'books.journal');await writeFile(journal,'');
  const server=await startServer({adapter:createHledgerAdapter({journalPath:journal,hledgerPath:process.env.HLEDGER_BIN??'/opt/homebrew/bin/hledger'}),token:'test-books',port:0,ledgerId:'test-books'});
  t.after(()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())));const address=server.address();assert.ok(address&&typeof address!=='string');
  const client=createLedgerClient({endpoint:`http://127.0.0.1:${address.port}/graphql`,token:'test-books',ledgerId:'test-books'});
  const input={idempotencyKey:'book-http-a',date:'2026-10-23',isbn:'9780306406157',title:'Test book',purchasePrice:{commodity:'KRW',value:'10000'},assetAccount:'Assets:Books',cashAccount:'Assets:Cash'};
  const a=await client.purchaseBook(input);assert.deepEqual(a.data?.purchaseBook?.errors,[]);const id=a.data!.purchaseBook!.book!.id;
  const b=await client.purchaseBook({...input,idempotencyKey:'book-http-b'});assert.notEqual(b.data!.purchaseBook!.book!.id,id);
  const sale={idempotencyKey:'sale-http',date:input.date,copyId:id,kind:'SELL' as const,saleProceeds:{commodity:'KRW',value:'12000'},fee:'500',cashAccount:'Assets:Cash'};
  const sold=await client.disposeBook(sale);assert.equal(sold.data?.disposeBook?.book?.realizedGain?.value,'1500');
  assert.equal((await client.disposeBook(sale)).data?.disposeBook?.idempotency?.replayed,true);
  const discarded=await client.disposeBook({idempotencyKey:'discard-http',date:input.date,copyId:b.data!.purchaseBook!.book!.id,kind:'DISCARD'});assert.equal(discarded.data?.disposeBook?.book?.realizedGain?.value,'-10000');
  assert.deepEqual((await client.books()).data?.books?.map(x=>x.status).sort(),['DISCARDED','SOLD']);
});
