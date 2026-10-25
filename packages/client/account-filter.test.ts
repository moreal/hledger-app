import assert from 'node:assert/strict';
import test from 'node:test';
import { createLedgerClient, type AccountsQueryVariables } from './index.ts';

async function captureVariables(variables?: AccountsQueryVariables) {
  let sent: unknown;
  const client = createLedgerClient({
    endpoint: 'http://localhost/graphql',
    fetch: async (_url, init) => {
      sent = JSON.parse(String(init?.body)).variables;
      return Response.json({ data: { accounts: null } });
    },
  });
  await client.accounts(variables);
  return sent;
}

test('accounts applies top-level balance date and scope to the account filter', async () => {
  assert.deepEqual(await captureVariables({ asOf: '2026-10-19', includeSubaccounts: true }), {
    asOf: '2026-10-19',
    includeSubaccounts: true,
    filter: { asOf: '2026-10-19', includeSubaccounts: true },
  });
});

test('accounts uses filter-only balance date and scope for displayed balances', async () => {
  assert.deepEqual(
    await captureVariables({
      filter: { asOf: '2026-10-01', includeSubaccounts: true, includeEmpty: false },
    }),
    {
      asOf: '2026-10-01',
      includeSubaccounts: true,
      filter: { asOf: '2026-10-01', includeSubaccounts: true, includeEmpty: false },
    },
  );
});

test('accounts gives explicit top-level true and false precedence without mutating filters or cursors', async () => {
  for (const scope of [false, true]) {
    const filter = Object.freeze({
      asOf: '2026-10-01',
      includeSubaccounts: !scope,
      query: 'assets',
      depth: null,
      includeEmpty: false,
    });
    const variables = Object.freeze({
      filter,
      asOf: '2026-10-19',
      includeSubaccounts: scope,
      first: 5,
      after: 'cursor',
    });
    assert.deepEqual(await captureVariables(variables), {
      ...variables,
      filter: { ...filter, asOf: '2026-10-19', includeSubaccounts: scope },
    });
    assert.equal(filter.asOf, '2026-10-01');
    assert.equal(filter.includeSubaccounts, !scope);
  }
});

test('accounts defaults to own balances and preserves explicit null dates and unrelated filter fields', async () => {
  assert.deepEqual(await captureVariables(), {
    includeSubaccounts: false,
    filter: { includeSubaccounts: false },
  });
  assert.deepEqual(
    await captureVariables({
      asOf: null,
      filter: { asOf: '2026-10-01', query: null, includeEmpty: null },
    }),
    {
      asOf: null,
      includeSubaccounts: false,
      filter: { asOf: null, query: null, includeEmpty: null, includeSubaccounts: false },
    },
  );
  assert.deepEqual(await captureVariables({ filter: { asOf: null, includeSubaccounts: null } }), {
    asOf: null,
    includeSubaccounts: null,
    filter: { asOf: null, includeSubaccounts: null },
  });
  assert.deepEqual(
    await captureVariables({ includeSubaccounts: null, filter: { includeSubaccounts: true } }),
    {
      includeSubaccounts: null,
      filter: { includeSubaccounts: null },
    },
  );
});
