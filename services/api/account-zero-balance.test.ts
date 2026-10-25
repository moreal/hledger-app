import assert from 'node:assert/strict';
import test from 'node:test';
import { executeLedgerRequest } from './schema.ts';
import type { LedgerSnapshot } from './types.ts';

function fixture() {
  const amounts: [string, string, string, string][] = [
    ['Zero', '1.10', 'USD', '2026-10-01'], ['Zero', '-1.10', 'USD', '2026-10-02'],
    ['Exact', '900719925474099312345.000000000000000001', 'USD', '2026-10-01'],
    ['Exact', '-900719925474099312345', 'USD', '2026-10-01'],
    ['Mixed', '1', 'USD', '2026-10-01'], ['Mixed', '-1', 'EUR', '2026-10-01'],
    ['MixedZero', '0.1', 'USD', '2026-10-01'], ['MixedZero', '-0.1', 'USD', '2026-10-01'],
    ['MixedZero', '2', 'EUR', '2026-10-01'], ['MixedZero', '-2', 'EUR', '2026-10-01'],
    ['Parent:Child', '3', 'USD', '2026-10-01'],
    ['Offset', '5', 'USD', '2026-10-01'], ['Offset:Child', '-5', 'USD', '2026-10-01'],
    ['Future', '8', 'USD', '2026-10-03'],
  ];
  const snapshot: LedgerSnapshot = {
    revision: 'zero-filter', readAt: '2026-10-25T00:00:00Z', prices: [],
    accounts: ['Empty', 'Exact', 'Future', 'Mixed', 'MixedZero', 'Offset', 'Offset:Child', 'Parent', 'Parent:Child', 'Zero'].map(name => ({ name, tags: [] })),
    transactions: amounts.map(([accountName, value, commodity, date], index) => ({
      id: String(index), date, description: 'balance fixture', code: null, status: 'CLEARED', source: 'HLEDGER', createdAt: null, tags: [],
      postings: [{ accountName, accountId: null, amount: { value, commodity }, memo: null }],
    })),
  };
  return async (filter: Record<string, unknown>, first = 200, after?: string) => {
    const result = await executeLedgerRequest({
      adapter: { read: async () => snapshot, create: async () => { throw new Error('read only'); } },
      authorized: true,
      query: 'query($filter:AccountFilter,$first:Int,$after:String){accounts(filter:$filter,first:$first,after:$after){totalEstimate edges{node{fullName}} pageInfo{endCursor hasNextPage}}}',
      variables: { filter, first, after },
    });
    assert.equal(result.errors, undefined);
    return result.data!.accounts as any;
  };
}
const names = (page: any): string[] => page.edges.map((edge: any) => edge.node.fullName);

test('zero balance filter excludes history that nets to zero and preserves exact nonzero and separate commodities', async () => {
  const run = fixture();
  assert.deepEqual(names(await run({})), ['Exact', 'Future', 'Mixed', 'Offset', 'Offset:Child', 'Parent:Child']);
  assert.equal((await run({ includeEmpty: true })).totalEstimate, 10);
});

test('zero balance filter applies inclusive asOf and depth before counting and pagination', async () => {
  const run = fixture();
  const filter = { asOf: '2026-10-01', depth: 1, includeSubaccounts: true };
  const first = await run(filter, 2);
  assert.deepEqual(names(first), ['Exact', 'Mixed']);
  assert.equal(first.totalEstimate, 4);
  assert.equal(first.pageInfo.hasNextPage, true);
  const second = await run(filter, 2, first.pageInfo.endCursor);
  assert.deepEqual(names(second), ['Parent', 'Zero']);
  assert.equal(second.pageInfo.hasNextPage, false);
  assert.deepEqual(names(await run({ asOf: '2026-10-02', query: 'Zero' })), []);
});

test('zero filter works for undeclared commodity empty accounts without requiring a display default', async () => {
  assert.deepEqual(names(await fixture()({ query: 'Empty' })), []);
});

test('zero filter uses requested own or descendant balances for parent-only, child-only, and offset postings', async () => {
  const run = fixture();
  assert.deepEqual(names(await run({ query: 'Parent' })), ['Parent:Child']);
  assert.deepEqual(names(await run({ query: 'Parent', includeSubaccounts: true })), ['Parent', 'Parent:Child']);
  assert.deepEqual(names(await run({ query: 'Offset' })), ['Offset', 'Offset:Child']);
  assert.deepEqual(names(await run({ query: 'Offset', includeSubaccounts: true })), ['Offset:Child']);
  assert.deepEqual(names(await run({ includeEmpty: true, query: 'Parent', depth: 1 })), ['Parent']);
});
