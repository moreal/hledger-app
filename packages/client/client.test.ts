import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLedgerClient,
  LedgerTransportError,
  addDecimals,
  subtractDecimals,
  previousDate,
  newIdempotencyKey,
} from './index.ts';

// Removing partial errors or coercing money to Number must break these assertions.
test('typed operations preserve partial data, extensions and decimal strings over the wire', async () => {
  const amount = '90071992547409931234567890.000000000001';
  let sent: { query: string; variables: unknown } | undefined;
  let authorization: string | null = null;
  const client = createLedgerClient({
    endpoint: 'http://localhost:8080/graphql',
    token: 'secret',
    fetch: async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      authorization = new Headers(init?.headers).get('authorization');
      return Response.json({
        data: { accounts: null },
        errors: [
          {
            message: 'offline',
            path: ['accounts'],
            extensions: { code: 'UPSTREAM_UNAVAILABLE', requestId: 'r' },
          },
        ],
      });
    },
  });
  const result = await client.accounts({ asOf: '2026-10-19', filter: { includeEmpty: true } });
  assert.equal(result.data?.accounts, null);
  assert.equal(result.errors?.[0]?.extensions?.code, 'UPSTREAM_UNAVAILABLE');
  assert.equal(authorization, 'Bearer secret');
  assert.match(sent!.query, /query Accounts/);
  assert.deepEqual(sent!.variables, {
    asOf: '2026-10-19',
    includeSubaccounts: false,
    filter: { includeEmpty: true, asOf: '2026-10-19', includeSubaccounts: false },
  });
  const write = createLedgerClient({
    endpoint: 'http://localhost:8080/graphql',
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.variables.input.postings[0].amount.value, amount);
      assert.match(body.query, /fragment TransactionFields/);
      return Response.json({ data: { createTransaction: null } });
    },
  });
  await write.createTransaction({
    idempotencyKey: 'key',
    date: '2026-10-19',
    description: 'Exact',
    postings: [
      { accountName: 'assets', amount: { value: amount, commodity: 'KRW' } },
      { accountName: 'equity', amount: { value: `-${amount}`, commodity: 'KRW' } },
    ],
  });
});

test('transport classifies network, HTTP authorization, malformed envelopes and invalid JSON', async () => {
  for (const [response, kind, status] of [
    [
      async () => {
        throw new TypeError('offline');
      },
      'network',
      undefined,
    ],
    [async () => new Response('denied', { status: 401 }), 'http', 401],
    [async () => new Response('invalid'), 'protocol', undefined],
    [async () => Response.json({ unexpected: true }), 'protocol', undefined],
    [async () => Response.json({ errors: 'invalid' }), 'protocol', undefined],
  ] as const) {
    const client = createLedgerClient({ endpoint: 'http://localhost/graphql', fetch: response });
    await assert.rejects(
      client.health(),
      (error: unknown) =>
        error instanceof LedgerTransportError && error.kind === kind && error.status === status,
    );
  }
});

test('decimal helpers keep arbitrary precision and date helper handles Gregorian bounds', () => {
  assert.equal(
    addDecimals('900719925474099312345.000000000001', '0.000000000009'),
    '900719925474099312345.00000000001',
  );
  assert.equal(subtractDecimals('0.10', '0.3'), '-0.2');
  assert.equal(addDecimals('-2.500', '2.5'), '0');
  assert.throws(() => addDecimals('1e3', '2'), TypeError);
  assert.throws(() => addDecimals('1\n', '2'), TypeError);
  assert.equal(previousDate('2024-03-01'), '2024-02-29');
  assert.equal(previousDate('1900-03-01'), '1900-02-28');
  assert.equal(previousDate('0100-01-01'), '0099-12-31');
  assert.throws(() => previousDate('2023-02-29'), RangeError);
  assert.throws(() => previousDate('0001-01-01'), RangeError);
});

test('keys use secure entropy or an explicitly supplied native ID factory', () => {
  assert.equal(
    newIdempotencyKey(() => 'native-secure-id'),
    'native-secure-id',
  );
  assert.notEqual(newIdempotencyKey(), newIdempotencyKey());
  assert.throws(() => newIdempotencyKey(() => ''), TypeError);
  assert.equal(
    createLedgerClient({ endpoint: 'http://LOCALHOST:80/graphql', token: 'secret' }).identity,
    'http://localhost/graphql',
  );
});

test('ledger binding travels on every request and distinguishes identities at the same endpoint', async () => {
  let binding: string | null = null;
  let target = '';
  const bound = createLedgerClient({
    endpoint: 'http://LOCALHOST:80/graphql',
    ledgerId: 'journal-id',
    fetch: async (url, init) => {
      target = String(url);
      binding = new Headers(init?.headers).get('x-ledger-id');
      return Response.json({ data: { health: null } });
    },
  });
  await bound.health();
  assert.equal(binding, 'journal-id');
  assert.equal(target, 'http://localhost/graphql');
  assert.equal(bound.identity, 'http://localhost/graphql#ledger=journal-id');
  assert.notEqual(
    bound.identity,
    createLedgerClient({ endpoint: 'http://localhost/graphql', ledgerId: 'other-journal' })
      .identity,
  );
});

test('timeouts bound both a stalled request and stalled JSON parsing and abort the request', async () => {
  for (const phase of ['fetch', 'json']) {
    let signal: AbortSignal | null | undefined;
    const client = createLedgerClient({
      endpoint: 'http://localhost/graphql',
      timeoutMs: 5,
      fetch: async (_url, init) => {
        signal = init?.signal;
        if (phase === 'fetch') return new Promise<Response>(() => {});
        return Object.assign(Response.json({ data: { health: null } }), {
          json: () => new Promise<unknown>(() => {}),
        });
      },
    });
    await assert.rejects(
      client.health(),
      (error: unknown) => error instanceof LedgerTransportError && error.kind === 'network',
    );
    assert.equal(signal?.aborted, true);
  }
});

test('client snapshots its original binding and credentials even if the caller mutates options', async () => {
  let observed: { url: string; ledger: string | null; token: string | null } | undefined;
  const options = {
    endpoint: 'http://localhost/graphql',
    ledgerId: 'journal-a',
    token: 'token-a',
    fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      observed = {
        url: String(url),
        ledger: headers.get('x-ledger-id'),
        token: headers.get('authorization'),
      };
      return Response.json({ data: { health: null } });
    },
  };
  const client = createLedgerClient(options);
  options.endpoint = 'http://elsewhere/graphql';
  options.ledgerId = 'journal-b';
  options.token = 'token-b';
  await client.health();
  assert.equal(client.identity, 'http://localhost/graphql#ledger=journal-a');
  assert.deepEqual(observed, {
    url: 'http://localhost/graphql',
    ledger: 'journal-a',
    token: 'Bearer token-a',
  });
});

test('direct mutation callers reject malformed success confirmations as ambiguous protocol errors', async () => {
  for (const payload of [
    { transaction: {}, idempotency: { key: 'key' }, errors: [] },
    { transaction: { id: 'id' }, idempotency: { key: 'key', replayed: false }, errors: [] },
  ]) {
    const client = createLedgerClient({
      endpoint: 'http://localhost/graphql',
      fetch: async () => Response.json({ data: { createTransaction: payload } }),
    });
    await assert.rejects(
      client.createTransaction({
        idempotencyKey: 'key',
        date: '2026-10-19',
        description: 'Lunch',
        postings: [],
      }),
      (error: unknown) => error instanceof LedgerTransportError && error.kind === 'protocol',
    );
  }
});

test('valid non-BMP character boundaries are accepted in transaction confirmations', async () => {
  const transaction = {
    id: '🧾'.repeat(128),
    date: '2026-10-19',
    description: '😀'.repeat(512),
    code: '📘'.repeat(64),
    status: 'UNMARKED',
    createdAt: null,
    source: 'APP',
    tags: [],
    postings: [
      {
        accountId: null,
        accountName: 'expenses:food',
        memo: '📝'.repeat(1000),
        amount: { commodity: '🪙'.repeat(32), value: '1' },
      },
      {
        accountId: null,
        accountName: 'assets:cash',
        memo: null,
        amount: { commodity: '🪙'.repeat(32), value: '-1' },
      },
    ],
  };
  const client = createLedgerClient({
    endpoint: 'http://localhost/graphql',
    fetch: async () =>
      Response.json({
        data: {
          createTransaction: {
            transaction,
            idempotency: { key: 'key', replayed: false },
            errors: [],
          },
        },
      }),
  });
  const result = await client.createTransaction({
    idempotencyKey: 'key',
    date: transaction.date,
    description: transaction.description,
    code: transaction.code,
    postings: transaction.postings,
  });
  assert.equal(result.data?.createTransaction?.transaction?.description, '😀'.repeat(512));
});
