import assert from 'node:assert/strict';
import test from 'node:test';
import {createLedgerClient,type CreateTransactionInput} from './index.ts';
import {createOutbox,OutboxPersistenceError,OutboxCorruptionError,OutboxEndpointError,type OutboxStorage} from './outbox.ts';

const input=(key='key'):CreateTransactionInput=>({idempotencyKey:key,date:'2026-10-19',description:'Lunch',postings:[{accountName:'expenses:food',amount:{commodity:'KRW',value:'12.000000000000000001'}},{accountName:'assets:bank',amount:{commodity:'KRW',value:'-12.000000000000000001'}}]});
function memory(){
  let value:string|null=null;
  let fail=false;
  const storage:OutboxStorage={load:async()=>value,save:async next=>{if(fail)throw Error('disk full');value=next;}};
  return {storage,read:()=>value,write:(next:string)=>{value=next;},fail:(next:boolean)=>{fail=next;}};
}
function success(key:string,replayed=false){return {data:{createTransaction:{transaction:{id:'transaction',date:'2026-10-19',description:'Lunch',code:null,status:'UNMARKED',createdAt:null,source:'APP',tags:[],postings:input(key).postings.map(p=>({...p,accountId:null,memo:null}))},idempotency:{key,replayed},errors:[]}}};}
const endpoint='http://localhost:8080/graphql';

// Sending before saving or replacing the key on retry must fail this restart test.
test('stores immutable input before sending and survives ambiguous response and restart with the same key',async()=>{
  const db=memory();let calls=0;
  const client=createLedgerClient({endpoint,token:'secret',fetch:async(_url,init)=>{
    calls++;
    const key=JSON.parse(String(init?.body)).variables.input.idempotencyKey;
    assert.equal(key,'key');
    const saved=JSON.parse(db.read()!);
    assert.equal(saved.records[0].state,'sending');
    assert.equal(saved.records[0].input.postings[0].amount.value,'12.000000000000000001');
    if(calls===1)throw Error('connection lost after write');
    return Response.json(success(key,true));
  }});
  const queue=createOutbox(db.storage,client), draft=input();
  const first=await queue.enqueue(draft);
  assert.equal(first.state,'needsReview');
  assert.equal(calls,1);
  draft.description='mutated externally';first.input.description='also changed';
  const restored=createOutbox(db.storage,client);
  assert.equal((await restored.hydrate())[0]!.state,'needsReview');
  assert.equal(calls,1);
  assert.equal(restored.list()[0]!.input.description,'Lunch');
  assert.equal((await restored.retry('key')).state,'succeeded');
  assert.equal(calls,2);
  assert.equal(db.read()!.includes('secret'),false);
  await restored.retry('key');
  assert.equal(calls,2);
});

test('offline drafts remain queued and interrupted sending restores needsReview without a request',async()=>{
  const db=memory();let calls=0;
  const client=createLedgerClient({endpoint,fetch:async()=>{calls++;return Response.json(success('key'));}});
  const queue=createOutbox(db.storage,client);
  assert.equal((await queue.enqueue(input(),{send:false})).state,'queued');
  assert.equal(calls,0);
  const persisted=JSON.parse(db.read()!);persisted.records[0].state='sending';db.write(JSON.stringify(persisted));
  const next=createOutbox(db.storage,client);
  assert.equal((await next.hydrate())[0]!.state,'needsReview');
  assert.equal(calls,0);
  assert.equal(JSON.parse(db.read()!).records[0].state,'needsReview');
});

test('authentication, expected input errors and conflicts stay blocked without automatic retries',async()=>{
  for(const response of [()=>new Response('unauthorized',{status:401}),()=>Response.json({errors:[{message:'Denied',extensions:{code:'UNAUTHENTICATED'}}]}),()=>Response.json({data:{createTransaction:{transaction:null,idempotency:null,errors:[{path:'input',code:'IDEMPOTENCY_CONFLICT',message:'Conflict',requestId:'r',timestamp:'2026-10-19T00:00:00Z',details:null}]}}})]){
    const db=memory();let calls=0;
    const client=createLedgerClient({endpoint,fetch:async()=>{calls++;return response();}});
    const queue=createOutbox(db.storage,client);
    assert.equal((await queue.enqueue(input())).state,'blocked');
    assert.equal((await createOutbox(db.storage,client).hydrate())[0]!.state,'blocked');
    assert.equal(calls,1);
  }
});

test('missing confirmation, protocol errors and server failure require review',async()=>{
  for(const response of [()=>Response.json({data:{createTransaction:null}}),()=>Response.json({errors:[{message:'Write failed',extensions:{code:'INTERNAL_SERVER_ERROR'}}]}),()=>new Response('bad JSON'),()=>new Response('failed',{status:500}),()=>Response.json(success('different-key'))]){
    const db=memory();const queue=createOutbox(db.storage,createLedgerClient({endpoint,fetch:async()=>response()}));
    assert.equal((await queue.enqueue(input())).state,'needsReview');
  }
});

test('failed persistence cannot expose a new item or dispatch any request',async()=>{
  const db=memory();let calls=0;const queue=createOutbox(db.storage,createLedgerClient({endpoint,fetch:async()=>{calls++;return Response.json(success('key'));}}));
  await queue.hydrate();db.fail(true);
  await assert.rejects(queue.enqueue(input()),OutboxPersistenceError);
  assert.deepEqual(queue.list(),[]);assert.equal(calls,0);
  db.fail(false);await queue.enqueue(input(),{send:false});db.fail(true);
  await assert.rejects(queue.retry('key'),OutboxPersistenceError);
  assert.equal(queue.list()[0]!.state,'queued');assert.equal(calls,0);
  await assert.rejects(queue.discard('key'),OutboxPersistenceError);
  assert.equal(queue.list().length,1);
});

test('concurrent enqueue calls serialize without lost rows or duplicate dispatch',async()=>{
  const db=memory();let calls=0;const queue=createOutbox(db.storage,createLedgerClient({endpoint,fetch:async(_url,init)=>{calls++;return Response.json(success(JSON.parse(String(init?.body)).variables.input.idempotencyKey));}}));
  const [a,b,c]=await Promise.all([queue.enqueue(input('a')),queue.enqueue(input('b')),queue.enqueue(input('a'))]);
  assert.equal(a.state,'succeeded');assert.equal(b.state,'succeeded');assert.equal(c.id,'a');
  assert.equal(calls,2);assert.equal(queue.list().length,2);
  await assert.rejects(queue.enqueue({...input('a'),description:'Changed'}),/key.*different input/i);
  const restart=createOutbox(db.storage,createLedgerClient({endpoint}));
  assert.equal((await restart.hydrate()).length,2);
});

test('endpoint changes cannot send a restored request to another ledger',async()=>{
  const db=memory();await createOutbox(db.storage,createLedgerClient({endpoint})).enqueue(input(),{send:false});
  let calls=0;const other=createOutbox(db.storage,createLedgerClient({endpoint:'http://localhost:9090/graphql',fetch:async()=>{calls++;return Response.json(success('key'));}}));
  await other.hydrate();await assert.rejects(other.retry('key'),OutboxEndpointError);
  assert.equal(calls,0);assert.equal(other.list()[0]!.endpoint,endpoint);
});

test('templates retain every posting but omit keys and are durable before exposure',async()=>{
  const db=memory();const queue=createOutbox(db.storage,createLedgerClient({endpoint}));
  const saved=await queue.saveTemplate('Lunch',input());
  assert.equal('idempotencyKey' in saved.input,false);assert.equal(saved.input.postings.length,2);
  saved.input.description='mutated';
  const next=createOutbox(db.storage,createLedgerClient({endpoint}));await next.hydrate();
  assert.equal(next.listTemplates()[0]!.input.description,'Lunch');
  db.fail(true);await assert.rejects(next.saveTemplate('Other',input()),OutboxPersistenceError);
  assert.equal(next.listTemplates().length,1);
});

test('corrupt storage is surfaced and never silently replaced',async()=>{
  for(const bad of ['broken','{}',JSON.stringify({version:1,records:[{id:'key'}],templates:[]})]){
    const db=memory();db.write(bad);const queue=createOutbox(db.storage,createLedgerClient({endpoint}));
    await assert.rejects(queue.hydrate(),OutboxCorruptionError);
    await assert.rejects(queue.enqueue(input()),OutboxCorruptionError);
    assert.equal(db.read(),bad);
  }
});

test('bound records survive restart and cannot be retried against another journal on the same server',async()=>{
  const db=memory();let calls=0;
  const client=createLedgerClient({endpoint,ledgerId:'sample'});
  await createOutbox(db.storage,client).enqueue(input(),{send:false});
  const restored=createOutbox(db.storage,client);
  assert.equal((await restored.hydrate())[0]!.endpoint,`${endpoint}#ledger=sample`);
  const changed=createOutbox(db.storage,createLedgerClient({endpoint,ledgerId:'personal',fetch:async()=>{calls++;return Response.json(success('key'));}}));
  await changed.hydrate();await assert.rejects(changed.retry('key'),OutboxEndpointError);
  assert.equal(calls,0);
});

test('a failed completion save retains sending until restart recovery and explicit same-key replay',async()=>{
  const db=memory();let calls=0;
  const client=createLedgerClient({endpoint,fetch:async()=>{calls++;if(calls===1)db.fail(true);return Response.json(success('key',calls>1));}});
  const queue=createOutbox(db.storage,client);
  await assert.rejects(queue.enqueue(input()),OutboxPersistenceError);
  assert.equal(queue.list()[0]!.state,'sending');
  assert.equal(JSON.parse(db.read()!).records[0].state,'sending');
  db.fail(false);
  const restart=createOutbox(db.storage,client);
  assert.equal((await restart.hydrate())[0]!.state,'needsReview');
  assert.equal(calls,1);assert.equal((await restart.retry('key')).state,'succeeded');
  assert.equal(calls,2);
});

test('foreign pending records are visibly blocked when hydrated',async()=>{
  const db=memory();
  await createOutbox(db.storage,createLedgerClient({endpoint,ledgerId:'sample'})).enqueue(input(),{send:false});
  const foreign=createOutbox(db.storage,createLedgerClient({endpoint,ledgerId:'personal'}));
  assert.equal((await foreign.hydrate())[0]!.state,'blocked');
  assert.match(foreign.list()[0]!.message!,/another ledger/i);
});

test('timeouts become needsReview and GraphQL ledger mismatch becomes blocked',async()=>{
  const timeoutDb=memory();
  const stalled=createOutbox(timeoutDb.storage,createLedgerClient({endpoint,timeoutMs:5,fetch:async()=>new Promise<Response>(()=>{})}));
  assert.equal((await stalled.enqueue(input())).state,'needsReview');
  const mismatch=createOutbox(memory().storage,createLedgerClient({endpoint,fetch:async()=>Response.json({errors:[{message:'Journal changed',extensions:{code:'LEDGER_MISMATCH'}}]})}));
  assert.equal((await mismatch.enqueue(input())).state,'blocked');
});

test('malformed success confirmations from injected clients never mark a request succeeded',async()=>{
  const complete=success('key').data.createTransaction;
  const cases=[
    {transaction:{},idempotency:{key:'key'},errors:[]},
    {...complete,idempotency:{key:'key'}},
    {...complete,transaction:{...complete.transaction,date:'2026-02-30'}},
    {...complete,transaction:{...complete.transaction,postings:[]}},
    {...complete,transaction:{...complete.transaction,postings:complete.transaction.postings.map(p=>({...p,amount:{...p.amount,value:12}}))}},
  ];
  for(const payload of cases){
    const client={identity:endpoint,createTransaction:async()=>({data:{createTransaction:payload}} as unknown as import('./index.ts').GraphQLResult<import('./index.ts').CreateTransactionMutation>)};
    const queue=createOutbox(memory().storage,client);
    assert.equal((await queue.enqueue(input())).state,'needsReview');
  }
});

test('an ambiguous write stays uncertain through rejected retries until same-key confirmation',async()=>{
  for(const rejection of [()=>new Response('unauthorized',{status:401}),()=>Response.json({data:{createTransaction:{transaction:null,idempotency:null,errors:[{path:'input',code:'INVALID_INPUT',message:'Rejected',requestId:'r',timestamp:'2026-10-19T00:00:00Z',details:null}]}}}),()=>new Response('ledger changed',{status:409})]){
    const db=memory();let attempt=0;
    const client=createLedgerClient({endpoint,fetch:async(_url,init)=>{
      assert.equal(JSON.parse(String(init?.body)).variables.input.idempotencyKey,'key');
      attempt++;
      if(attempt===1)throw new Error('response lost after write');
      if(attempt===2)return rejection();
      return Response.json(success('key',true));
    }});
    const queue=createOutbox(db.storage,client);
    assert.equal((await queue.enqueue(input())).state,'needsReview');
    const rejected=await queue.retry('key');
    assert.equal(rejected.state,'needsReview');assert.ok(rejected.message);
    const restored=createOutbox(db.storage,client);
    assert.equal((await restored.hydrate())[0]!.state,'needsReview');
    assert.equal((await restored.retry('key')).state,'succeeded');assert.equal(attempt,3);
  }
});

test('foreign projections retain uncertain outcomes and do not alter their durable original state',async()=>{
  const db=memory();
  const queue=createOutbox(db.storage,createLedgerClient({endpoint,ledgerId:'sample',fetch:async()=>{throw new Error('response lost');}}));
  await queue.enqueue(input());
  const foreign=createOutbox(db.storage,createLedgerClient({endpoint,ledgerId:'other'}));
  assert.equal((await foreign.hydrate())[0]!.state,'needsReview');
  assert.match(foreign.list()[0]!.message!,/another ledger/i);
  await assert.rejects(foreign.retry('key'),OutboxEndpointError);
  assert.equal(JSON.parse(db.read()!).records[0].state,'needsReview');
});

test('a durable sending record also retains uncertainty after a rejected explicit retry',async()=>{
  const db=memory();let calls=0;
  const queue=createOutbox(db.storage,createLedgerClient({endpoint,fetch:async()=>{
    calls++;if(calls===1){db.fail(true);return Response.json(success('key'));}
    return new Response('unauthorized',{status:401});
  }}));
  await assert.rejects(queue.enqueue(input()),OutboxPersistenceError);
  assert.equal(queue.list()[0]!.state,'sending');
  db.fail(false);
  assert.equal((await queue.retry('key')).state,'needsReview');
});

test('costs survive offline storage, templates, restart and same-key retry unchanged', async () => {
  const db = memory();
  const draft = input('trade-cost');
  draft.postings = [
    { accountName: 'assets:stock', amount: { commodity: 'AAPL', value: '2' }, cost: { type: 'UNIT', amount: { commodity: 'USD', value: '10.1234567890123456789' } } },
    { accountName: 'assets:cash', amount: { commodity: 'USD', value: '-20.2469135780246913578' } },
  ];
  let calls = 0;
  const client = createLedgerClient({ endpoint, fetch: async (_url, init) => {
    calls++;
    assert.deepEqual(JSON.parse(String(init?.body)).variables.input, draft);
    throw Error('response lost');
  } });
  const queue = createOutbox(db.storage, client);
  await queue.enqueue(draft, { send: false });
  await queue.saveTemplate('trade', draft);
  const restored = createOutbox(db.storage, client);
  assert.deepEqual((await restored.hydrate())[0]!.input, draft);
  assert.deepEqual(restored.listTemplates()[0]!.input.postings, draft.postings);
  assert.equal((await restored.retry('trade-cost')).state, 'needsReview');
  assert.deepEqual((await createOutbox(db.storage, client).hydrate())[0]!.input, draft);
  assert.equal(calls, 1);
});

test('malformed saved costs are rejected rather than silently discarded', async () => {
  for (const cost of [{ type: 'OTHER', amount: { value: '1', commodity: 'USD' } }, { type: 'TOTAL', amount: { value: 1, commodity: 'USD' } }, { type: 'UNIT' }]) {
    const db = memory();
    const client = createLedgerClient({ endpoint });
    await createOutbox(db.storage, client).enqueue(input(), { send: false });
    const stored = JSON.parse(db.read()!);
    stored.records[0].input.postings[0].cost = cost;
    db.write(JSON.stringify(stored));
    await assert.rejects(createOutbox(db.storage, client).hydrate(), OutboxCorruptionError);
  }
});

test('semantic messages persist in version one and clear on same-key successful retry', async () => {
  const db = memory(); let attempts = 0;
  const client = createLedgerClient({ endpoint, fetch: async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).variables.input.idempotencyKey, 'key');
    attempts++;
    const durable = JSON.parse(db.read()!).records[0];
    assert.equal(durable.message, undefined);
    assert.equal(durable.messageInfo, undefined);
    if (attempts === 1) throw Error('lost');
    if (attempts === 2) return new Response('denied', { status: 401 });
    return Response.json(success('key', true));
  } });
  const queue = createOutbox(db.storage, client);
  assert.deepEqual((await queue.enqueue(input())).messageInfo, { code: 'transport', kind: 'network' });
  const retried = await queue.retry('key');
  assert.equal(retried.state, 'needsReview');
  assert.deepEqual(retried.messageInfo, { code: 'retryUncertain', reason: { code: 'transport', kind: 'http', status: 401 } });
  assert.equal(JSON.parse(db.read()!).version, 1);
  const restored = createOutbox(db.storage, client);
  assert.deepEqual((await restored.hydrate())[0]!.messageInfo, retried.messageInfo);
  const confirmed = await restored.retry('key');
  assert.equal(confirmed.messageInfo, undefined);
  assert.equal(confirmed.message, undefined);
});

test('old snapshots retain raw messages and endpoint metadata only overlays returned copies', async () => {
  const db = memory(); const client = createLedgerClient({ endpoint });
  await createOutbox(db.storage, client).enqueue(input(), { send: false });
  const old = JSON.parse(db.read()!); old.records[0].state = 'needsReview'; old.records[0].message = 'Legacy custom message';
  db.write(JSON.stringify(old));
  const restored = createOutbox(db.storage, client);
  assert.equal((await restored.hydrate())[0]!.message, 'Legacy custom message');
  assert.equal(restored.list()[0]!.messageInfo, undefined);
  const foreign = createOutbox(db.storage, createLedgerClient({ endpoint: 'http://other/graphql' }));
  assert.deepEqual((await foreign.hydrate())[0]!.messageInfo, { code: 'endpointMismatch' });
  assert.deepEqual(JSON.parse(db.read()!), old);
});

test('invalid saved semantic message metadata is corruption', async () => {
  for (const messageInfo of [null, {}, {code:'invented'}, {code:'transport',kind:'other'}, {code:'transport',kind:'http',status:'401'}, {code:'retryUncertain',detail:42}, {code:'retryUncertain',reason:{code:'retryUncertain'}}]) {
    const db = memory(); const client = createLedgerClient({ endpoint });
    await createOutbox(db.storage, client).enqueue(input(), { send: false });
    const stored = JSON.parse(db.read()!); stored.records[0].messageInfo = messageInfo; db.write(JSON.stringify(stored));
    await assert.rejects(createOutbox(db.storage, client).hydrate(), OutboxCorruptionError);
  }
});

test('raw rejected retries retain server detail and uncertainty across restart', async () => {
  const db = memory(); let attempts = 0;
  const client = createLedgerClient({ endpoint, fetch: async () => {
    if (++attempts === 1) throw Error('lost response');
    return Response.json({ errors: [{ message: 'Custom ledger rejection', extensions: { code: 'UNAUTHENTICATED' } }] });
  } });
  const queue = createOutbox(db.storage, client);
  await queue.enqueue(input());
  const rejected = await queue.retry('key');
  assert.deepEqual(rejected.messageInfo, { code: 'retryUncertain', detail: 'Custom ledger rejection' });
  assert.equal(rejected.message, 'Custom ledger rejection The earlier write outcome is still unknown.');
  assert.deepEqual((await createOutbox(db.storage, client).hydrate())[0]!.messageInfo, rejected.messageInfo);
});

test('interruption recovery stores semantic metadata without changing the legacy message', async () => {
  const db = memory(); const client = createLedgerClient({ endpoint });
  await createOutbox(db.storage, client).enqueue(input(), { send: false });
  const stored = JSON.parse(db.read()!); stored.records[0].state = 'sending'; db.write(JSON.stringify(stored));
  const recovered = (await createOutbox(db.storage, client).hydrate())[0]!;
  assert.deepEqual(recovered.messageInfo, { code: 'interrupted' });
  assert.equal(recovered.message, 'The app stopped during a request. Check the ledger or explicitly retry with the same key.');
  assert.deepEqual(JSON.parse(db.read()!).records[0].messageInfo, recovered.messageInfo);
});
