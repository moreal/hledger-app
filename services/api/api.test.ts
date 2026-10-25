import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHledgerAdapter } from './hledger.ts';
import { executeLedgerRequest } from './schema.ts';
import { startServer } from './server.ts';

const tx = (id: string, date: string, accountName: string, value: string, commodity = 'USD') => ({
  id,
  date,
  description: `Payment ${id}`,
  code: null,
  status: 'CLEARED',
  source: 'HLEDGER',
  createdAt: null,
  tags: [{ key: 'kind', value: 'food' }],
  postings: [
    { accountName, accountId: null, amount: { value, commodity }, memo: null },
    {
      accountName: 'Equity',
      accountId: null,
      amount: { value: value.startsWith('-') ? value.slice(1) : `-${value}`, commodity },
      memo: null,
    },
  ],
});
function fixture() {
  let reads = 0;
  const snapshot = {
    revision: 'rev-1',
    readAt: '2026-10-20T00:00:00Z',
    accounts: ['Assets', 'Assets:Cash', 'Equity', 'Empty'].map((name) => ({ name, tags: [] })),
    transactions: [
      tx('a', '2026-10-18', 'Assets', '900719925474099312345.10'),
      tx('b', '2026-10-19', 'Assets', '0.20'),
      tx('c', '2026-10-20', 'Assets:Cash', '0.000000000000000001', 'BTC'),
    ],
    prices: [
      {
        commodity: 'BTC',
        quoteCommodity: 'USD',
        date: '2026-10-20',
        rate: '70000.00000001',
        source: null,
      },
    ],
  };
  const adapter = {
    read: async () => {
      reads++;
      return snapshot;
    },
    create: async (_input: unknown) => ({
      transaction: snapshot.transactions[0]!,
      replayed: false,
    }),
  };
  const run = (query: string, variables?: Record<string, unknown>, authorized = true) =>
    executeLedgerRequest({
      adapter: adapter as any,
      query,
      variables,
      authorized,
      requestId: 'test-request',
      defaultCommodity: 'USD',
    });
  return { snapshot, adapter, run, reads: () => reads };
}

test('public health cannot authorize protected sibling or aliased fields', async () => {
  const f = fixture();
  const result = await f.run(
    '{ health { status indexerLagSeconds lastSuccessfulSyncAt } private: accounts { totalEstimate } }',
    undefined,
    false,
  );
  assert.equal((result.data?.health as any)?.status, 'OK');
  assert.equal((result.data?.health as any)?.indexerLagSeconds, null);
  assert.equal(result.data?.private, null);
  assert.equal(result.errors?.[0]?.extensions.code, 'UNAUTHENTICATED');
  assert.equal(result.errors?.[0]?.extensions.requestId, 'test-request');
});

test('accounts calculate exact own and descendant balances with inclusive movement dates', async () => {
  const f = fixture();
  const result =
    await f.run(`{ accounts(filter:{includeEmpty:true}) { edges { node { id fullName transactionCount
    balances { commodity value } before: balances(asOf:"2026-10-18") { commodity value }
    movements(from:"2026-10-19",to:"2026-10-19") { commodity value }
    all: balances(includeSubaccounts:true) { commodity value }
  } } } }`);
  assert.equal(result.errors, undefined);
  const assets = (result.data?.accounts as any)?.edges.find(
    (edge: any) => edge.node.fullName === 'Assets',
  ).node;
  assert.deepEqual(JSON.parse(JSON.stringify(assets.balances)), [
    { commodity: 'USD', value: '900719925474099312345.30' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(assets.before)), [
    { commodity: 'USD', value: '900719925474099312345.10' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(assets.movements)), [
    { commodity: 'USD', value: '0.20' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(assets.all)), [
    { commodity: 'BTC', value: '0.000000000000000001' },
    { commodity: 'USD', value: '900719925474099312345.30' },
  ]);
  assert.equal(assets.transactionCount, 2);
  assert.equal(f.reads(), 1);
});

test('cursors bind revision, effective filters and connection scope', async () => {
  const f = fixture();
  const first = await f.run(
    '{ transactions(first:1) { edges { node { id } } pageInfo { endCursor hasNextPage } } }',
  );
  const page = first.data?.transactions as any;
  assert.equal(page.edges[0].node.id, 'c');
  assert.equal(page.pageInfo.hasNextPage, true);
  const query =
    'query($after:String,$filter:TransactionFilter) { transactions(first:1,after:$after,filter:$filter) { edges { node { id } } } }';
  const next = await f.run(query, {
    after: page.pageInfo.endCursor,
    filter: { includeSubaccounts: false },
  });
  assert.equal((next.data?.transactions as any)?.edges[0].node.id, 'b');
  assert.equal(
    (await f.run(query, { after: page.pageInfo.endCursor, filter: { query: 'a' } })).errors?.[0]
      ?.extensions.code,
    'INVALID_CURSOR',
  );
  f.snapshot.revision = 'rev-2';
  assert.equal(
    (await f.run(query, { after: page.pageInfo.endCursor })).errors?.[0]?.extensions.code,
    'INVALID_CURSOR',
  );
});

test('filters apply all tags, query, commodity, inclusive bounds and reject invalid scope', async () => {
  const f = fixture();
  const result = await f.run(
    '{ transactions(filter:{from:"2026-10-19",to:"2026-10-19",query:"assets",commodity:"USD",tags:[{key:"kind",value:"food"}]}) { edges { node { id } } } prices(filter:{commodity:"BTC"}) { totalEstimate } }',
  );
  assert.equal(result.errors, undefined);
  assert.deepEqual(
    (result.data?.transactions as any)?.edges.map((edge: any) => edge.node.id),
    ['b'],
  );
  assert.equal((result.data?.prices as any)?.totalEstimate, 1);
  assert.equal(
    (await f.run('{ transactions(filter:{from:"2026-10-20",to:"2026-10-19"}) { totalEstimate } }'))
      .errors?.[0]?.extensions.code,
    'INVALID_INPUT',
  );
  const accounts = await f.run(
    '{ accounts(filter:{includeEmpty:true}) { edges { node { id fullName } } } }',
  );
  const id = (accounts.data?.accounts as any)?.edges.find(
    (edge: any) => edge.node.fullName === 'Assets',
  ).node.id;
  const scoped = await f.run(
    'query($id:ID!){account(id:$id){transactions(filter:{accountId:"wrong"}){totalEstimate}}}',
    { id },
  );
  assert.equal(scoped.errors?.[0]?.extensions.code, 'INVALID_INPUT');
});

test('strict scalar coercion rejects numbers, exponent decimals and invalid calendar dates', async () => {
  const f = fixture();
  for (const date of ['2026-02-30', '0000-01-01', '2026-10-20\n']) {
    assert.ok(
      (await f.run('query($date:Date){accounts(filter:{asOf:$date}){totalEstimate}}', { date }))
        .errors?.length,
    );
  }
  for (const value of [0.1, '1e2', '1.0\n']) {
    const result = await f.run(
      'mutation($input:CreateTransactionInput!){createTransaction(input:$input){errors{code}}}',
      {
        input: {
          idempotencyKey: 'k',
          date: '2026-10-20',
          description: 'test',
          postings: [
            { accountName: 'Assets', amount: { commodity: 'USD', value } },
            { accountName: 'Equity', amount: { commodity: 'USD', value: '-1' } },
          ],
        },
      },
    );
    assert.ok(result.errors?.length);
  }
});

test('expected mutation validation and conflict failures use correlated payload errors', async () => {
  const f = fixture();
  const input = {
    idempotencyKey: 'k',
    date: '2026-10-20',
    description: 'test',
    postings: [
      { accountName: 'Assets', amount: { commodity: 'USD', value: '1' } },
      { accountName: 'Equity', amount: { commodity: 'USD', value: '-0.9' } },
    ],
  };
  const query =
    'mutation($input:CreateTransactionInput!){createTransaction(input:$input){transaction{id} idempotency{key replayed} errors{code path requestId timestamp}}}';
  const invalid = await f.run(query, { input });
  assert.equal(invalid.errors, undefined);
  assert.equal((invalid.data?.createTransaction as any)?.errors[0].code, 'UNBALANCED');
  f.adapter.create = async () => {
    throw Object.assign(new Error('sensitive journal content'), { code: 'IDEMPOTENCY_CONFLICT' });
  };
  input.postings[1]!.amount.value = '-1';
  const conflict = await f.run(query, { input });
  assert.equal((conflict.data?.createTransaction as any)?.transaction, null);
  assert.equal((conflict.data?.createTransaction as any)?.errors[0].code, 'IDEMPOTENCY_CONFLICT');
});

test('HTTP enforces bearer auth, explicit CORS, POST JSON and sanitized malformed bodies', async (t) => {
  const f = fixture();
  const server = await startServer({
    adapter: f.adapter as any,
    token: 'test-secret',
    port: 0,
    allowedOrigins: ['http://localhost:5173'],
  });
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/graphql`;
  const request = (body: string, headers: Record<string, string> = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    });
  const unauthorized = await (
    await request(JSON.stringify({ query: '{ health { status } transactions { totalEstimate } }' }))
  ).json();
  assert.equal(unauthorized.data.health.status, 'OK');
  assert.equal(unauthorized.errors[0].extensions.code, 'UNAUTHENTICATED');
  const ok = await request(JSON.stringify({ query: '{ transactions { totalEstimate } }' }), {
    authorization: 'Bearer test-secret',
    origin: 'http://localhost:5173',
  });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal((await ok.json()).data.transactions.totalEstimate, 3);
  assert.equal((await request('{}', { origin: 'https://evil.invalid' })).status, 403);
  const malformed = await request('{journal: secret');
  assert.equal(malformed.status, 400);
  assert.ok(!(await malformed.text()).includes('secret'));
  assert.equal((await request('x'.repeat(1_048_577))).status, 413);
  assert.equal((await fetch(url)).status, 405);
});

test('health reports real upstream failures and preserves only the last successful read time', async () => {
  const f = fixture();
  const success = await f.run('{health{status lastSuccessfulSyncAt}}');
  assert.equal((success.data?.health as any)?.lastSuccessfulSyncAt, '2026-10-20T00:00:00Z');
  f.adapter.read = async () => {
    throw new Error('/private/journal contents TOKEN');
  };
  const result = await f.run(
    '{health{status connectionStatus lastSuccessfulSyncAt} transactions{totalEstimate}}',
  );
  assert.equal((result.data?.health as any)?.status, 'DEGRADED');
  assert.equal((result.data?.health as any)?.connectionStatus, 'DISCONNECTED');
  assert.equal((result.data?.health as any)?.lastSuccessfulSyncAt, '2026-10-20T00:00:00Z');
  assert.equal(result.errors?.[0]?.extensions.code, 'UPSTREAM_ERROR');
  assert.ok(!JSON.stringify(result).includes('/private/journal'));
});

test('pagination validates limits, forged cursors and account connection scope', async () => {
  const f = fixture();
  for (const first of [0, -1, 201]) {
    const result = await f.run('query($first:Int){transactions(first:$first){limit}}', { first });
    assert.equal(result.errors?.[0]?.extensions.code, 'INVALID_INPUT');
  }
  const result = await f.run(
    '{accounts(filter:{includeEmpty:true},first:1){edges{node{id}} pageInfo{endCursor}}}',
  );
  const page = result.data?.accounts as any;
  const invalid = await f.run('query($cursor:String){transactions(after:$cursor){limit}}', {
    cursor: page.pageInfo.endCursor,
  });
  assert.equal(invalid.errors?.[0]?.extensions.code, 'INVALID_CURSOR');
  const forged = await f.run('query($cursor:String){accounts(after:$cursor){limit}}', {
    cursor: page.pageInfo.endCursor + 'x',
  });
  assert.equal(forged.errors?.[0]?.extensions.code, 'INVALID_CURSOR');
});

test('empty accounts require explicit commodity and do not borrow unrelated commodity', async () => {
  const f = fixture();
  const result = await executeLedgerRequest({
    adapter: f.adapter as any,
    query:
      '{accounts(filter:{query:"Empty",includeEmpty:true}){edges{node{balances{commodity value}}}}}',
    authorized: true,
  });
  assert.equal(result.errors?.[0]?.extensions.code, 'UNDEFINED_COMMODITY');
  const configured = await f.run(
    '{accounts(filter:{query:"Empty",includeEmpty:true}){edges{node{balances{commodity value}}}}}',
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify((configured.data?.accounts as any)?.edges[0].node.balances)),
    [{ commodity: 'USD', value: '0' }],
  );
});

test('startup rejects missing token and wildcard CORS origins', async () => {
  const f = fixture();
  await assert.rejects(startServer({ adapter: f.adapter as any, token: '', port: 0 }), /TOKEN/);
  await assert.rejects(
    startServer({ adapter: f.adapter as any, token: 'x', port: 0, allowedOrigins: ['*'] }),
    /origins/,
  );
});

test('ledger identity is authenticated and writes reject a mismatched ledger header', async (t) => {
  const f = fixture();
  const server = await startServer({
    adapter: f.adapter as any,
    token: 'secret',
    port: 0,
    ledgerId: 'journal-a',
  });
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/graphql`;
  const request = (headers: Record<string, string>) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ query: '{health{details}}' }),
    });
  const publicHealth = await (await request({})).json();
  assert.equal(publicHealth.data.health.details.ledgerId, undefined);
  const authenticated = await (await request({ authorization: 'Bearer secret' })).json();
  assert.equal(authenticated.data.health.details.ledgerId, 'journal-a');
  const mismatch = await request({ authorization: 'Bearer secret', 'x-ledger-id': 'journal-b' });
  assert.equal(mismatch.status, 409);
  assert.equal((await mismatch.json()).errors[0].extensions.code, 'LEDGER_MISMATCH');
});

test('HTTP with real hledger saves once, replays after adapter restart and invalidates old cursors', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'hledger-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journalPath = join(directory, 'test.journal');
  await writeFile(
    journalPath,
    '2026-10-19 Opening\n    Assets:Bank  10.00 USD\n    Equity  -10.00 USD\n',
  );
  const adapter = createHledgerAdapter({
    journalPath,
    hledgerPath: process.env.HLEDGER_BIN ?? '/opt/homebrew/bin/hledger',
  });
  const server = await startServer({
    adapter,
    token: 'secret',
    port: 0,
    ledgerId: 'isolated-journal',
  });
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/graphql`;
  const request = async (query: string, variables?: Record<string, unknown>) =>
    (
      await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer secret',
          'x-ledger-id': 'isolated-journal',
        },
        body: JSON.stringify({ query, variables }),
      })
    ).json();
  const before = await request('{transactions(first:1){pageInfo{endCursor}}}');
  const input = {
    idempotencyKey: 'http-retry',
    date: '2026-10-20',
    description: 'Precise HTTP save',
    postings: [
      {
        accountName: 'Expenses:Food',
        amount: { commodity: 'USD', value: '0.1234567890123456789000' },
      },
      {
        accountName: 'Assets:Bank',
        amount: { commodity: 'USD', value: '-0.1234567890123456789000' },
      },
    ],
  };
  const mutation =
    'mutation($input:CreateTransactionInput!){createTransaction(input:$input){transaction{id source createdAt postings{amount{value}}} idempotency{replayed} errors{code}}}';
  const saved = await request(mutation, { input });
  assert.equal(saved.errors, undefined);
  assert.deepEqual(saved.data.createTransaction.errors, []);
  assert.equal(saved.data.createTransaction.idempotency.replayed, false);
  assert.equal(
    saved.data.createTransaction.transaction.postings[0].amount.value,
    '0.1234567890123456789000',
  );
  const replay = await request(mutation, { input });
  assert.equal(replay.data.createTransaction.idempotency.replayed, true);
  assert.equal(
    replay.data.createTransaction.transaction.id,
    saved.data.createTransaction.transaction.id,
  );
  const restarted = createHledgerAdapter({
    journalPath,
    hledgerPath: process.env.HLEDGER_BIN ?? '/opt/homebrew/bin/hledger',
  });
  assert.equal(
    (await restarted.create(input)).transaction.id,
    saved.data.createTransaction.transaction.id,
  );
  assert.equal((await restarted.read()).transactions.length, 2);
  const stale = await request('query($cursor:String){transactions(after:$cursor){totalEstimate}}', {
    cursor: before.data.transactions.pageInfo.endCursor,
  });
  assert.equal(stale.errors[0].extensions.code, 'INVALID_CURSOR');
});

test('GraphQL stock buys and sells persist costs and fees through real hledger HTTP and restart', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hledger-trade-http-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const journalPath = join(dir, 'ledger.journal');
  await writeFile(journalPath, '');
  const adapter = createHledgerAdapter({
    journalPath,
    hledgerPath: process.env.HLEDGER_BIN ?? '/opt/homebrew/bin/hledger',
  });
  const server = await startServer({
    adapter,
    token: 'trade-test',
    port: 0,
    ledgerId: 'trade-fixture',
  });
  t.after(
    () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  );
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const request = async (query: string, variables?: Record<string, unknown>) =>
    (
      await fetch(`http://127.0.0.1:${address.port}/graphql`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer trade-test',
          'x-ledger-id': 'trade-fixture',
        },
        body: JSON.stringify({ query, variables }),
      })
    ).json();
  const { buildTradePostings } = await import('../../packages/domain/src/trade.ts');
  const mutation =
    'mutation($input:CreateTransactionInput!){createTransaction(input:$input){transaction{id postings{amount{value commodity} cost{type amount{value commodity}}}} idempotency{replayed} errors{code message}}}';
  for (const side of ['BUY', 'SELL'] as const) {
    const input = {
      date: '2026-10-23',
      description: side,
      idempotencyKey: `trade-${side}`,
      postings: buildTradePostings({
        side,
        quantity: '2',
        commodity: 'asset:stock:krx:005930',
        priceType: side === 'BUY' ? 'UNIT' : 'TOTAL',
        price: side === 'BUY' ? '70000' : '150000',
        settlementCommodity: 'KRW',
        securityAccount: 'Assets:Broker:Stock',
        cashAccount: 'Assets:Broker:Cash',
        fee: '100',
        feeAccount: 'Expenses:Fees',
      }),
    };
    const saved = await request(mutation, { input });
    assert.equal(saved.errors, undefined);
    assert.deepEqual(saved.data.createTransaction.errors, []);
    assert.deepEqual(
      saved.data.createTransaction.transaction.postings[0].cost,
      input.postings[0]!.cost,
    );
    assert.equal(
      (await request(mutation, { input })).data.createTransaction.idempotency.replayed,
      true,
    );
    const restarted = createHledgerAdapter({
      journalPath,
      hledgerPath: process.env.HLEDGER_BIN ?? '/opt/homebrew/bin/hledger',
    });
    assert.equal((await restarted.create(input)).replayed, true);
  }
  const result = await request(
    '{transactions{edges{node{postings{cost{type amount{value commodity}}}}}}}',
  );
  assert.equal(result.errors, undefined);
  assert.equal(result.data.transactions.edges.length, 2);
  assert.ok(result.data.transactions.edges.every((e: any) => e.node.postings[0].cost));
});
