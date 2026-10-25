import test from 'node:test';
import assert from 'node:assert/strict';
import { executeLedgerRequest } from './schema.ts';
import { createMemoryFeatureSettingsStore } from './feature-settings.ts';
import type { LedgerAdapter } from './types.ts';
const featureQuery =
  '{ ledgerFeatures { ledgerId books { enabled version canRead canWrite canLookupMetadata canRecover } } }';
function adapter(): LedgerAdapter {
  return {
    read: async () => {
      throw Error('book must not read');
    },
    create: async () => {
      throw Error('book must not write');
    },
  };
}
test('disabled direct book queries reject before adapter or metadata provider', async () => {
  for (const query of ['{ books { id } }', '{ bookMetadata(isbn:"9780140328721") { status } }']) {
    const result = await executeLedgerRequest({
      adapter: adapter(),
      authorized: true,
      query,
      featureSettings: createMemoryFeatureSettingsStore(),
    });
    assert.equal(result.errors?.[0]?.extensions.code, 'FEATURE_DISABLED');
  }
  const missing = await executeLedgerRequest({
    adapter: adapter(),
    authorized: true,
    query: '{ books { id } }',
  });
  assert.equal(missing.errors?.[0]?.extensions.code, 'FEATURE_DISABLED');
});
test('unauthenticated features and settings cannot read or toggle', async () => {
  const featureSettings = createMemoryFeatureSettingsStore();
  for (const query of [
    featureQuery,
    'mutation { setBooksEnabled(enabled:true,expectedVersion:0) { feature { enabled } errors { code } } }',
  ]) {
    const result = await executeLedgerRequest({
      adapter: adapter(),
      authorized: false,
      query,
      featureSettings,
    });
    assert.equal(result.errors?.[0]?.extensions.code, 'UNAUTHENTICATED');
  }
  assert.equal((await featureSettings.read()).enabled, false);
});
test('authenticated settings expose capabilities and stale version error', async () => {
  const featureSettings = createMemoryFeatureSettingsStore();
  const execute = (query: string) =>
    executeLedgerRequest({
      adapter: adapter(),
      authorized: true,
      query,
      featureSettings,
      ledgerId: 'ledger',
    });
  assert.equal((await execute(featureQuery)).errors, undefined);
  const mutation =
    'mutation { setBooksEnabled(enabled:true,expectedVersion:0) { feature { enabled version } errors { code } } }';
  const result = await execute(mutation);
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {
    setBooksEnabled: { feature: { enabled: true, version: 1 }, errors: [] },
  });
  const stale = await execute(mutation);
  assert.equal((stale.data as any).setBooksEnabled.errors[0].code, 'FEATURE_VERSION_CONFLICT');
});
test('disabled mutations return field errors and never call adapter', async () => {
  const query =
    'mutation { purchaseBook(input:{idempotencyKey:"off",isbn:"9780140328721",title:"Matilda",date:"2026-01-01",purchasePrice:{commodity:"USD",value:"10"},assetAccount:"assets:books",cashAccount:"assets:cash"}) { book { id } errors { code } } }';
  const result = await executeLedgerRequest({
    adapter: adapter(),
    authorized: true,
    query,
    featureSettings: createMemoryFeatureSettingsStore(),
  });
  assert.equal(result.errors, undefined);
  assert.equal((result.data as any).purchaseBook.errors[0].code, 'FEATURE_DISABLED');
});

test('disabled disposal and generic ledger reads remain independent', async () => {
  const featureSettings = createMemoryFeatureSettingsStore();
  const disposal = await executeLedgerRequest({
    adapter: adapter(),
    authorized: true,
    featureSettings,
    query:
      'mutation { disposeBook(input:{idempotencyKey:"off",date:"2026-01-01",copyId:"copy",kind:DISCARD}) { errors { code } } }',
  });
  assert.equal(disposal.errors, undefined);
  assert.equal((disposal.data as any).disposeBook.errors[0].code, 'FEATURE_DISABLED');
  const genericAdapter: LedgerAdapter = {
    ...adapter(),
    read: async () => ({
      revision: '1',
      readAt: new Date().toISOString(),
      accounts: [],
      transactions: [],
      prices: [],
    }),
  };
  const generic = await executeLedgerRequest({
    adapter: genericAdapter,
    authorized: true,
    featureSettings,
    query: '{ accounts { edges { node { id } } } }',
  });
  assert.equal(generic.errors, undefined);
});
