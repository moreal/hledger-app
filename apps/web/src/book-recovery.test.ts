import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptsBooksFeature, updateBooksFeature, inspectPending, readPending, validRequest } from './book-recovery';
const purchase = {kind:'purchase', input:{idempotencyKey:'original-key',date:'2026-10-25',isbn:'9780140328721',title:'Matilda',authors:['Roald Dahl'],purchasePrice:{value:'12.50',commodity:'USD'},assetAccount:'assets:books',cashAccount:'assets:bank'}};
test('legacy storage hydrates the exact input and original key independently of module state', () => {
  const saved = JSON.stringify(purchase); const keys: string[] = [];
  const recovered = readPending('hledger.book-request:ledger-a', {getItem(key) { keys.push(key); return saved; }});
  assert.deepEqual(keys,['hledger.book-request:ledger-a']); assert.deepEqual(recovered.request,purchase); assert.equal(recovered.error,'');
  assert.equal(JSON.stringify(recovered.request),saved);
});
test('absent entry differs from corrupt or unavailable storage', () => {
  assert.deepEqual(readPending('key',{getItem:()=>null}),{request:null,error:''});
  for (const value of ['', '{}', 'null', '{', JSON.stringify({...purchase,input:{...purchase.input,purchasePrice:{value:'NaN',commodity:'USD'}}})]) {
    const result = readPending('key',{getItem:()=>value}); assert.equal(result.request,null); assert.ok(result.error);
  }
  assert.ok(readPending('key',{getItem:()=>{throw new Error('denied');}}).error);
});
test('incomplete legacy purchases and disposal inputs fail closed', () => {
  for (const key of ['date','isbn','title','assetAccount','cashAccount','purchasePrice','idempotencyKey']) {
    const input = {...purchase.input}; delete (input as Record<string,unknown>)[key]; assert.equal(validRequest({kind:'purchase',input}),false,key);
  }
  assert.equal(validRequest({...purchase,input:{...purchase.input,date:'2026-02-30'}}),false);
  const disposal = {kind:'dispose',input:{idempotencyKey:'retained',date:'2026-10-25',copyId:'0123456789abcdef0123',kind:'SELL',saleProceeds:{value:'10',commodity:'USD'},fee:'1',feeAccount:'expenses:fees',cashAccount:'assets:bank',gainAccount:'income:books',lossAccount:'expenses:books'}};
  assert.equal(validRequest(disposal),true);
  assert.equal(validRequest({...disposal,input:{...disposal.input,feeAccount:''}}),false);
  assert.equal(validRequest({...disposal,input:{...disposal.input,kind:'DISCARD'}}),false);
});

test('disabled read-only recovery preserves the exact request until complete matching proof', async () => {
  const request = {...purchase,kind:'purchase' as const};
  const key = 'hledger.book-request:original-ledger';
  const saved = JSON.stringify(request); let durable: string | null = saved; const calls: unknown[] = [];
  const storage = {removeItem(actual: string) { assert.equal(actual,key); durable = null; }};
  const proof = {status:'CONFIRMED',idempotency:{key:'original-key',replayed:true},book:{id:'0123456789abcdef0123',commodity:'asset:book:0123456789abcdef0123',isbn:purchase.input.isbn,title:purchase.input.title,authors:purchase.input.authors,coverUrl:null,assetAccount:purchase.input.assetAccount,purchaseDate:purchase.input.date,status:'HELD',disposalDate:null,purchasePrice:purchase.input.purchasePrice,saleProceeds:null,realizedGain:null}};
  for (const response of [{status:'UNKNOWN',book:null,idempotency:null}, {...proof,book:null}, {...proof,idempotency:{key:'other',replayed:true}}, {...proof,book:{...proof.book,title:'Unrelated'}}]) {
    assert.equal(await inspectPending(request,key,async input => { calls.push(input); return response; },storage),false);
    assert.equal(durable,saved);
  }
  await assert.rejects(inspectPending(request,key,async()=>{throw new Error('offline');},storage)); assert.equal(durable,saved);
  assert.equal(await inspectPending(request,key,async input => { assert.deepEqual(input,request); return proof; },storage),true);
  assert.equal(durable,null); assert.ok(calls.every(input => JSON.stringify(input) === saved));
});
test('failure to remove confirmed recovery never reports it cleared', async () => {
  const request = {...purchase,kind:'purchase' as const};
  // Missing typed proof cannot even attempt deletion.
  let removed = false;
  assert.equal(await inspectPending(request,'key',async()=>({status:'CONFIRMED'}),{removeItem(){removed = true; throw new Error('denied');}}),false);
  assert.equal(removed,false);
});

test('long legacy account paths survive hydration without truncation', () => {
  const longAccount = `assets:${'long:'.repeat(200)}books`;
  const original = {...purchase,input:{...purchase.input,assetAccount:longAccount,cashAccount:longAccount}};
  const serialized = JSON.stringify(original);
  const recovered = readPending('legacy',{getItem:()=>serialized});
  assert.equal(recovered.error,''); assert.equal(JSON.stringify(recovered.request),serialized);
});

test('feature capabilities reject malformed, incompatible and incoherent states', () => {
  const feature = {moduleId:'books',migrationVersion:1,version:17,enabled:true,migratedExistingData:false,canRead:true,canWrite:true,canLookupMetadata:true,canRecover:true};
  assert.equal(acceptsBooksFeature(feature),true);
  assert.equal(acceptsBooksFeature({...feature,enabled:false,canRead:false,canWrite:false,canLookupMetadata:false}),true);
  for (const value of [null,{}, {...feature,moduleId:'foreign'}, {...feature,migrationVersion:2}, {...feature,version:-1}, {...feature,version:1.5}, {...feature,version:Number.MAX_SAFE_INTEGER}, {...feature,enabled:'true'}, {...feature,canRecover:undefined}, {...feature,canRecover:false}, {...feature,enabled:false}, {...feature,canRead:false}]) assert.equal(acceptsBooksFeature(value),false);
});

test('CAS rejection remains failed after a successful capability refresh and can be retried', async () => {
  let refreshed = 0;
  const refresh = () => { refreshed++; };
  assert.equal(await updateBooksFeature(async()=>({data:{setBooksEnabled:{feature:null,errors:[{code:'FEATURE_CONFLICT'}]}}}),refresh),false);
  assert.equal(refreshed,1);
  assert.equal(await updateBooksFeature(async()=>{throw new Error('offline');},refresh),false);
  assert.equal(refreshed,2);
  const feature = {moduleId:'books',migrationVersion:1,version:18,enabled:true,migratedExistingData:false,canRead:true,canWrite:true,canLookupMetadata:true,canRecover:true};
  assert.equal(await updateBooksFeature(async()=>({data:{setBooksEnabled:{feature,errors:[]}}}),refresh),true);
  assert.equal(refreshed,3);
  assert.equal(await updateBooksFeature(async()=>({data:{}}),refresh),false);
});
