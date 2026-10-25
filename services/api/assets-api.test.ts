import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { print } from 'graphql';
import { AssetsDocument, AssetBindingsDocument, SetAssetBindingDocument } from '../../packages/api-contract/generated/client/graphql.ts';
import { createAssetCatalog, parseKindCatalog, parseNasdaqDirectory, writeCatalogSnapshot } from './asset-catalog.ts';
import { createAssetBindingStore } from './asset-bindings.ts';
import type { Asset, AssetCatalog } from '../../packages/domain/src/asset-catalog.ts';
import type { AssetBinding, AssetBindingStore } from './asset-bindings.ts';
import { executeLedgerRequest } from './schema.ts';
import { assetFingerprint } from './automatic-logos.ts';
import { getCompanyLogo } from '../../packages/domain/src/company-logos.ts';
import { createLedgerClient } from '../../packages/client/index.ts';

const bitcoin: Asset = { id: 'crypto:bitcoin', symbol: 'BTC', name: 'Bitcoin', exchange: null, kind: 'CRYPTO', isin: null,
  source: 'CoinGecko', sourceUrl: 'https://www.coingecko.com/en/coins/bitcoin', asOf: null, iconText: 'BTC', iconUrl: null };
const usd: Asset = { ...bitcoin, id: 'currency:USD', symbol: 'USD', name: 'US Dollar', kind: 'CURRENCY', source: 'ISO 4217', sourceUrl: 'https://www.iso.org/iso-4217-currency-codes.html' };
const assetFields = 'id symbol name exchange kind isin source sourceUrl asOf iconText iconUrl';
const bindingFields = `commodity updatedAt asset { ${assetFields} }`;
const mutation = `mutation($commodity:String!,$assetId:ID){setAssetBinding(commodity:$commodity,assetId:$assetId){commodity binding{${bindingFields}}}}`;
function fixture() {
  const bindings = new Map<string, AssetBinding>();
  let reads = 0, creates = 0, sets = 0, searches = 0;
  const catalog: AssetCatalog = {
    search: async (query, first = 20) => { searches++; return { items: [usd, bitcoin].filter(asset => `${asset.symbol} ${asset.name}`.toLowerCase().includes(query.toLowerCase())).slice(0, first), providers: [{ provider: 'builtin', status: 'READY', updatedAt: null, message: null }] }; },
    get: async id => [usd, bitcoin].find(asset => asset.id === id) ?? null,
  };
  const store: AssetBindingStore = {
    list: async commodities => [...bindings.values()].filter(binding => commodities === undefined || commodities.includes(binding.commodity)),
    set: async (commodity, asset) => {
      sets++;
      if (asset === null) { bindings.delete(commodity); return null; }
      const binding = { commodity, asset: structuredClone(asset), updatedAt: '2026-10-21T01:00:00Z' };
      bindings.set(commodity, binding); return binding;
    },
  };
  const adapter = {
    read: async () => { reads++; return { accounts: [], transactions: [], prices: [], revision: 'unchanged', readAt: '2026-10-21T00:00:00Z' }; },
    create: async () => { creates++; throw new Error('Metadata must not create a transaction'); },
  };
  const run = (query: string, variables?: Record<string, unknown>, authorized = true) => executeLedgerRequest({ adapter, query, variables, authorized,
    requestId: 'asset-request', ledgerId: 'ledger-a', assetCatalog: catalog, assetBindings: store });
  return { run, bindings, catalog, store, adapter, counts: () => ({ reads, creates, sets, searches }) };
}

test('asset fields independently require authorization alongside public health and aliases', async () => {
  const f = fixture();
  const result = await f.run('{health{status} private:assets(query:""){items{id}} bindings:assetBindings{commodity}}', undefined, false);
  assert.equal((result.data?.health as any).status, 'OK');
  assert.equal(result.data?.private, null);
  assert.equal(result.data?.bindings, null);
  assert.deepEqual(result.errors?.map(error => error.extensions.code), ['UNAUTHENTICATED', 'UNAUTHENTICATED']);
  assert.ok(result.errors?.every(error => error.extensions.requestId === 'asset-request' && typeof error.extensions.timestamp === 'string'));
  const denied = await f.run(mutation, { commodity: 'BTC', assetId: bitcoin.id }, false);
  assert.equal(denied.errors?.[0]?.extensions.code, 'UNAUTHENTICATED');
  assert.deepEqual(f.counts(), { reads: 1, creates: 0, sets: 0, searches: 0 });
});

test('catalog supports empty and bounded searches without touching the ledger', async () => {
  const f = fixture();
  const result = await f.run(`{assets(query:"",first:1){items{${assetFields}} providers{provider status updatedAt message}}}`);
  assert.equal(result.errors, undefined);
  assert.equal((result.data?.assets as any).items[0].id, usd.id);
  assert.equal((result.data?.assets as any).providers[0].status, 'READY');
  for (const first of [0, 51]) assert.equal((await f.run('query($first:Int){assets(query:"",first:$first){items{id}}}', { first })).errors?.[0]?.extensions.code, 'INVALID_INPUT');
  assert.equal((await f.run('query($query:String!){assets(query:$query){items{id}}}', { query: 'x'.repeat(201) })).errors?.[0]?.extensions.code, 'INVALID_INPUT');
  assert.deepEqual(f.counts(), { reads: 0, creates: 0, sets: 0, searches: 1 });
});

test('bindings preserve exact custom commodity strings and stored asset snapshots, then clear metadata only', async () => {
  const f = fixture();
  for (const commodity of ['BTC', 'btc', 'My custom asset']) {
    const saved = await f.run(mutation, { commodity, assetId: bitcoin.id });
    assert.equal(saved.errors, undefined);
    assert.equal((saved.data?.setAssetBinding as any).commodity, commodity);
    assert.equal((saved.data?.setAssetBinding as any).binding.asset.id, bitcoin.id);
  }
  f.catalog.get = async () => null;
  f.catalog.search = async () => ({ items: [], providers: [{ provider: 'CoinGecko', status: 'STALE', updatedAt: null, message: 'Cached catalog' }] });
  const filtered = await f.run(`query($commodities:[String!]){assetBindings(commodities:$commodities){${bindingFields}}}`, { commodities: ['btc'] });
  assert.equal(filtered.errors, undefined);
  assert.equal((filtered.data?.assetBindings as any).length, 1);
  assert.equal((filtered.data?.assetBindings as any)[0].commodity, 'btc');
  assert.equal((filtered.data?.assetBindings as any)[0].asset.name, 'Bitcoin');
  const missing = await f.run(mutation, { commodity: 'BTC', assetId: 'invented' });
  assert.equal(missing.errors?.[0]?.extensions.code, 'INVALID_INPUT');
  assert.equal(f.bindings.get('BTC')?.asset.id, bitcoin.id);
  const cleared = await f.run(mutation, { commodity: 'BTC', assetId: null });
  assert.equal(cleared.errors, undefined);
  assert.equal((cleared.data?.setAssetBinding as any).binding, null);
  assert.equal(f.bindings.has('BTC'), false);
  assert.equal(f.bindings.has('btc'), true);
  assert.deepEqual(f.counts(), { reads: 0, creates: 0, sets: 4, searches: 0 });
});

test('invalid commodity and filter sizes never write metadata', async () => {
  const f = fixture();
  for (const commodity of ['', ' ', 'x'.repeat(33)]) {
    assert.equal((await f.run(mutation, { commodity, assetId: bitcoin.id })).errors?.[0]?.extensions.code, 'INVALID_INPUT');
    assert.equal((await f.run('{assetBindings(commodities:["' + commodity + '"]){commodity}}')).errors?.[0]?.extensions.code, 'INVALID_INPUT');
  }
  assert.equal((await f.run('query($commodities:[String!]){assetBindings(commodities:$commodities){commodity}}', { commodities: Array(201).fill('BTC') })).errors?.[0]?.extensions.code, 'INVALID_INPUT');
  assert.equal((await f.run(mutation, { commodity: 'BTC', assetId: '' })).errors?.[0]?.extensions.code, 'INVALID_INPUT');
  assert.equal(f.counts().sets, 0);
});

test('catalog and storage failures are sanitized and missing dependencies are explicit', async () => {
  const f = fixture();
  f.catalog.search = async () => { throw new Error('/private/cache secret-token'); };
  const search = await f.run('{assets(query:""){items{id} providers{provider status message}}}');
  assert.equal(search.errors, undefined);
  assert.equal((search.data?.assets as any).providers[0].status, 'UNAVAILABLE');
  assert.ok(!JSON.stringify(search).includes('secret-token'));
  f.store.list = async () => { throw new Error('/private/journal secret-token'); };
  const unavailable = await f.run('{assetBindings{commodity}}');
  assert.equal(unavailable.errors?.[0]?.extensions.code, 'ASSET_METADATA_UNAVAILABLE');
  assert.ok(!JSON.stringify(unavailable).includes('secret-token'));
  const missing = await executeLedgerRequest({ adapter: f.adapter, authorized: true, query: '{assets(query:""){items{id}} assetBindings{commodity}}' });
  assert.deepEqual(missing.errors?.map(error => error.extensions.code), ['ASSET_METADATA_UNAVAILABLE', 'ASSET_METADATA_UNAVAILABLE']);
  assert.equal(f.counts().reads, 0);
});


test('generated client asset methods send exact variables and the bound ledger identity', async () => {
  const requests: { query: string; variables: Record<string, unknown>; headers: Headers }[] = [];
  const client = createLedgerClient({ endpoint: 'https://ledger.example/graphql', ledgerId: 'ledger-a', token: 'test-token',
    fetch: async (_url, init) => {
      requests.push({ ...JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({ data: {} }), { headers: { 'content-type': 'application/json' } });
    },
  });
  await client.assets({ query: 'BTC', first: 10 });
  await client.assetBindings(['BTC', 'btc']);
  await client.setAssetBinding({ commodity: 'btc', assetId: null });
  assert.match(requests[0]!.query, /query Assets/);
  assert.deepEqual(requests[0]!.variables, { query: 'BTC', first: 10 });
  assert.deepEqual(requests[1]!.variables, { commodities: ['BTC', 'btc'] });
  assert.match(requests[2]!.query, /mutation SetAssetBinding/);
  assert.deepEqual(requests[2]!.variables, { commodity: 'btc', assetId: null });
  assert.ok(requests.every(request => request.headers.get('x-ledger-id') === 'ledger-a' && request.headers.get('authorization') === 'Bearer test-token'));
});


test('real currency and Nasdaq catalog dates serialize through every generated search and binding field', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-graphql-dates-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const snapshotPath = join(directory, 'catalog.json');
  const listed = `Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N
File Creation Time: 1020202621:31|||||||
`;
  const [stock] = parseNasdaqDirectory(listed, 'nasdaqlisted', '2026-10-20');
  await writeCatalogSnapshot(snapshotPath, 'nasdaq', [stock!], '2026-10-20T22:00:00Z');
  const f = fixture();
  const assetCatalog = createAssetCatalog({ snapshotPath });
  const assetBindings = createAssetBindingStore({ path: join(directory, 'bindings.json'), ledgerId: 'date-ledger' });
  const run = (query: string, variables: Record<string, unknown>) => executeLedgerRequest({
    adapter: f.adapter, authorized: true, ledgerId: 'date-ledger', query, variables, assetCatalog, assetBindings,
  });
  for (const query of ['USD', 'AAPL']) {
    const result = await run(print(AssetsDocument), { query });
    assert.equal(result.errors, undefined);
    const asset = (result.data?.assets as any).items[0];
    assert.equal(asset.symbol, query);
    assert.match(asset.asOf, /^\d{4}-\d{2}-\d{2}$/);
    if (query === 'AAPL') assert.equal(asset.asOf, '2026-10-20');
    assert.equal((result.data?.assets as any).providers.find((provider: any) => provider.provider === 'iso4217').updatedAt, null);
    const saved = await run(print(SetAssetBindingDocument), { commodity: query, assetId: asset.id });
    assert.equal(saved.errors, undefined);
    assert.equal((saved.data?.setAssetBinding as any).binding.asset.asOf, asset.asOf);
  }
  const result = await run(print(AssetBindingsDocument), {});
  assert.equal(result.errors, undefined);
  assert.deepEqual((result.data?.assetBindings as any).map((binding: any) => binding.asset.symbol).sort(), ['AAPL', 'USD']);
  assert.deepEqual(f.counts(), { reads: 0, creates: 0, sets: 0, searches: 0 });
});

test('KIND companies search by Korean name and six-digit code and bind exact custom commodities without ledger operations', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'asset-graphql-kind-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const snapshotPath = join(directory, 'catalog.json');
  const [stock] = parseKindCatalog(`<table><tr><th>회사명</th><th>종목코드</th><th>시장구분</th></tr>
<tr><td>삼성전자</td><td>005930</td><td>유가증권</td></tr></table>`, '2026-10-22');
  await writeCatalogSnapshot(snapshotPath, 'kind', [stock!], new Date().toISOString());
  const f = fixture();
  const assetCatalog = createAssetCatalog({ snapshotPath });
  const assetBindings = createAssetBindingStore({ path: join(directory, 'bindings.json'), ledgerId: 'kind-ledger' });
  const run = (query: string, variables: Record<string, unknown>) => executeLedgerRequest({
    adapter: f.adapter, authorized: true, ledgerId: 'kind-ledger', query, variables, assetCatalog, assetBindings,
  });
  const displayedStock = { ...stock!, iconUrl: getCompanyLogo(stock!)!.imageUrl };
  for (const query of ['삼성전자', '005930']) {
    const result = await run(print(AssetsDocument), { query });
    assert.equal(result.errors, undefined);
    assert.deepEqual((result.data?.assets as any).items.map((asset: Asset) => ({ ...asset })), [displayedStock]);
    assert.equal((result.data?.assets as any).providers.find((provider: any) => provider.provider === 'kind').status, 'READY');
  }
  const commodity = '내 삼성주식';
  const saved = await run(print(SetAssetBindingDocument), { commodity, assetId: stock!.id });
  assert.equal(saved.errors, undefined);
  assert.equal((saved.data?.setAssetBinding as any).commodity, commodity);
  assert.equal((saved.data?.setAssetBinding as any).binding.commodity, commodity);
  assert.deepEqual({ ...(saved.data?.setAssetBinding as any).binding.asset }, displayedStock);
  const read = await run(print(AssetBindingsDocument), { commodities: [commodity] });
  assert.equal(read.errors, undefined);
  assert.equal((read.data?.assetBindings as any).length, 1);
  assert.equal((read.data?.assetBindings as any)[0].commodity, commodity);
  assert.deepEqual({ ...(read.data?.assetBindings as any)[0].asset }, displayedStock);
  const cleared = await run(print(SetAssetBindingDocument), { commodity, assetId: null });
  assert.equal(cleared.errors, undefined);
  assert.equal((cleared.data?.setAssetBinding as any).commodity, commodity);
  assert.equal((cleared.data?.setAssetBinding as any).binding, null);
  const empty = await run(print(AssetBindingsDocument), { commodities: [commodity] });
  assert.equal(empty.errors, undefined);
  assert.deepEqual(empty.data?.assetBindings, []);
  assert.deepEqual(f.counts(), { reads: 0, creates: 0, sets: 0, searches: 0 });
});


test('existing custom bindings receive public logos without mutating their stored metadata or ledger', async () => {
  const f = fixture();
  const samsung: Asset = { ...bitcoin, id: 'kind:KOSPI:005930', symbol: '005930', name: '삼성전자', kind: 'STOCK', exchange: 'KOSPI', source: 'kind', iconUrl: null };
  const original: AssetBinding = { commodity: '내 삼성주식', asset: samsung, updatedAt: '2026-10-21T01:00:00Z' };
  f.bindings.set(original.commodity, original);
  const result = await f.run(print(AssetBindingsDocument), { commodities: [original.commodity] });
  assert.equal(result.errors, undefined);
  const binding = (result.data?.assetBindings as AssetBinding[])[0]!;
  assert.equal(binding.commodity, '내 삼성주식');
  assert.match(binding.asset.iconUrl!, /^https:\/\//);
  assert.equal(original.asset.iconUrl, null);
  assert.equal(binding.updatedAt, original.updatedAt);
  assert.deepEqual(f.counts(), { reads: 0, creates: 0, sets: 0, searches: 0 });
});


test('saved custom bindings receive automatic cached logos without disk or ledger writes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'automatic-binding-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stock: Asset = { ...bitcoin, id: 'nasdaq:NASDAQ:TSLA', symbol: 'TSLA', name: 'Tesla, Inc. - Common Stock', kind: 'STOCK', exchange: 'NASDAQ', source: 'nasdaq', iconUrl: 'https://upload.wikimedia.org/wikipedia/commons/old.png' };
  const path = join(directory, 'bindings.json');
  const store = createAssetBindingStore({ path, ledgerId: 'auto-ledger' });
  await store.set('내 자동차주식', stock);
  const before = await readFile(path, 'utf8');
  const automaticLogoPath = join(directory, 'company-logos.json');
  const imageUrl = 'https://upload.wikimedia.org/wikipedia/commons/test.png';
  await writeFile(automaticLogoPath, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), records: [{ fingerprint: assetFingerprint(stock), entity: 'Q478214', imageUrl, sourcePage: 'https://commons.wikimedia.org/wiki/File:Test.png', license: 'Public domain', artist: 'Test fixture' }], counts: { processed: 1, matched: 1, ambiguous: 0, missing: 0, failed: 0, total: 1, bounded: false } }));
  const f = fixture();
  const result = await executeLedgerRequest({ adapter: f.adapter, authorized: true, ledgerId: 'auto-ledger', assetBindings: store,
    assetCatalog: createAssetCatalog({ snapshotPath: join(directory, 'not-needed.json'), automaticLogoPath }),
    query: print(AssetBindingsDocument), variables: { commodities: ['내 자동차주식'] } });
  assert.equal(result.errors, undefined);
  const binding = (result.data?.assetBindings as AssetBinding[])[0]!;
  assert.equal(binding.commodity, '내 자동차주식');
  assert.equal(binding.asset.iconUrl, imageUrl);
  assert.equal(await readFile(path, 'utf8'), before);
  await rm(automaticLogoPath);
  const missing = await executeLedgerRequest({ adapter: f.adapter, authorized: true, ledgerId: 'auto-ledger', assetBindings: store,
    assetCatalog: createAssetCatalog({ snapshotPath: join(directory, 'not-needed.json'), automaticLogoPath }),
    query: print(AssetBindingsDocument), variables: { commodities: ['내 자동차주식'] } });
  assert.equal(missing.errors, undefined);
  assert.equal((missing.data?.assetBindings as AssetBinding[])[0]!.asset.iconUrl, null);
  assert.equal(await readFile(path, 'utf8'), before);
  assert.deepEqual(f.counts(), { reads: 0, creates: 0, sets: 0, searches: 0 });
});


test('official homepage icons supplement existing Korean custom bindings without writes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'homepage-binding-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stock: Asset = { ...bitcoin, id: 'kind:KOSDAQ:123456', symbol: '123456', name: '테스트기업', kind: 'STOCK', exchange: 'KOSDAQ', source: 'kind', iconUrl: null };
  const path = join(directory, 'bindings.json');
  const store = createAssetBindingStore({ path, ledgerId: 'homepage-ledger' });
  await store.set('나의 한국 주식', stock);
  const before = await readFile(path, 'utf8');
  const homepageLogoPath = join(directory, 'homepage-logos.json');
  const fingerprint = assetFingerprint(stock);
  const imageUrl = 'https://issuer.example.com/icon.png';
  await writeFile(homepageLogoPath, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), records: [{ fingerprint, entity: 'https://issuer.example.com/', imageUrl, sourcePage: 'https://issuer.example.com/', source: 'official-website-icon', license: '공식 홈페이지 아이콘 · 권리 미확인', authoritySource: 'KIND' }], attempts: { [fingerprint]: 'matched' }, counts: { processed: 1, matched: 1, missing: 0, failed: 0, total: 1, bounded: false } }));
  const f = fixture();
  const result = await executeLedgerRequest({ adapter: f.adapter, authorized: true, ledgerId: 'homepage-ledger', assetBindings: store,
    assetCatalog: createAssetCatalog({ snapshotPath: join(directory, 'unused.json'), homepageLogoPath }),
    query: print(AssetBindingsDocument), variables: { commodities: ['나의 한국 주식'] } });
  assert.equal(result.errors, undefined);
  const binding = (result.data?.assetBindings as AssetBinding[])[0]!;
  assert.equal(binding.commodity, '나의 한국 주식');
  assert.equal(binding.asset.iconUrl, imageUrl);
  assert.equal(await readFile(path, 'utf8'), before);
  assert.deepEqual(f.counts(), { reads: 0, creates: 0, sets: 0, searches: 0 });
});
