import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createAssetBindingStore } from './asset-bindings.ts';
import type { Asset } from '../../packages/domain/src/asset-catalog.ts';

const asset: Asset = {
  id: 'stock:NASDAQ:AAPL', symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', kind: 'STOCK',
  isin: 'US0378331005', source: 'test-catalog', sourceUrl: 'https://example.org/catalog', asOf: '2026-10-21',
  iconText: 'A', iconUrl: 'https://cdn.brandfetch.io/apple.com',
};
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'asset-bindings-'));
  const path = join(directory, 'metadata', 'bindings.json');
  return { directory, path, store: createAssetBindingStore({ path, ledgerId: 'ledger-a' }) };
}
async function child(source: string) {
  const process = spawn(globalThis.process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; process.stderr.on('data', chunk => { stderr += chunk; });
  const [code, signal] = await once(process, 'exit');
  return { code, signal, stderr };
}
const moduleUrl = new URL('./asset-bindings.ts', import.meta.url).href;

test('bindings persist asset snapshots across restart and removal without changing journal bytes', async () => {
  const f = await fixture();
  try {
    const journal = join(f.directory, 'ledger.journal');
    const bytes = '2026-10-21 Existing\n    Assets  1 AAPL\n    Equity\n';
    await writeFile(journal, bytes);
    assert.deepEqual(await f.store.list(), []);
    const selected = structuredClone(asset);
    const saved = await f.store.set('AAPL', selected);
    assert.equal(saved?.commodity, 'AAPL');
    assert.deepEqual(saved?.asset, asset);
    assert.ok(saved && Number.isFinite(Date.parse(saved.updatedAt)));
    const restarted = createAssetBindingStore({ path: f.path, ledgerId: 'ledger-a' });
    assert.deepEqual(await restarted.list(), [saved]);
    // No catalog is consulted during reads, so unavailable or removed entries retain their names.
    selected.name = 'Changed upstream';
    assert.equal((await restarted.list())[0]?.asset.name, 'Apple Inc.');
    assert.equal(await restarted.set('AAPL', null), null);
    assert.deepEqual(await createAssetBindingStore({ path: f.path, ledgerId: 'ledger-a' }).list(), []);
    assert.equal(await readFile(journal, 'utf8'), bytes);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('commodity spelling, case, spaces and Unicode code points remain exact', async () => {
  const f = await fixture();
  try {
    const commodities = ['AAPL', 'aapl', ' custom unit ', '🪙'.repeat(32), '__proto__'];
    for (const commodity of commodities) await f.store.set(commodity, asset);
    assert.deepEqual(new Set((await f.store.list()).map(binding => binding.commodity)), new Set(commodities));
    assert.deepEqual((await f.store.list(['aapl', 'missing'])).map(binding => binding.commodity), ['aapl']);
    for (const commodity of ['', ' ', 'x'.repeat(33), 'bad\nunit', 'bad\u0000unit']) {
      await assert.rejects(f.store.set(commodity, asset), { code: 'INVALID_INPUT' });
    }
    assert.equal((await f.store.list()).length, commodities.length);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('invalid asset snapshots and unsafe icon URLs fail before modifying saved bindings', async () => {
  const f = await fixture();
  try {
    await f.store.set('AAPL', asset);
    const before = await readFile(f.path, 'utf8');
    for (const patch of [{ name: '' }, { kind: 'OTHER' }, { iconUrl: 'javascript:alert(1)' }, { iconUrl: 'http://example.com/a.png' }, { iconUrl: 'https://user:secret@example.com/a.png' }]) {
      await assert.rejects(f.store.set('AAPL', { ...asset, ...patch } as Asset), { code: 'INVALID_INPUT' });
      assert.equal(await readFile(f.path, 'utf8'), before);
    }
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('wrong ledger namespace rejects reads and writes and preserves the file', async () => {
  const f = await fixture();
  try {
    await f.store.set('AAPL', asset);
    const before = await readFile(f.path, 'utf8');
    const other = createAssetBindingStore({ path: f.path, ledgerId: 'ledger-b' });
    await assert.rejects(other.list(), { code: 'METADATA_UNAVAILABLE' });
    await assert.rejects(other.set('AAPL', null), { code: 'METADATA_UNAVAILABLE' });
    assert.equal(await readFile(f.path, 'utf8'), before);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('corrupt, unsupported or invalid metadata never gets replaced by a new write', async () => {
  const f = await fixture();
  try {
    await f.store.set('AAPL', asset);
    const valid = JSON.parse(await readFile(f.path, 'utf8'));
    const contents = ['{broken', JSON.stringify({ ...valid, version: 99 }), JSON.stringify({ ...valid, bindings: [{ commodity: 'AAPL', asset: { ...asset, iconUrl: 'javascript:bad' }, updatedAt: new Date().toISOString() }] })];
    for (const content of contents) {
      await writeFile(f.path, content);
      await assert.rejects(f.store.list(), { code: 'METADATA_UNAVAILABLE' });
      await assert.rejects(f.store.set('OTHER', asset), { code: 'METADATA_UNAVAILABLE' });
      assert.equal(await readFile(f.path, 'utf8'), content);
    }
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('independent store instances preserve every concurrent update', async () => {
  const f = await fixture();
  try {
    await Promise.all(Array.from({ length: 24 }, (_, index) => createAssetBindingStore({ path: f.path, ledgerId: 'ledger-a' }).set(`unit ${index}`, asset)));
    assert.equal((await f.store.list()).length, 24);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('independent processes preserve every concurrent update', async () => {
  const f = await fixture();
  try {
    const results = await Promise.all(Array.from({ length: 4 }, (_, index) => child(`
      const {createAssetBindingStore} = await import(${JSON.stringify(moduleUrl)});
      const store = createAssetBindingStore(${JSON.stringify({ path: f.path, ledgerId: 'ledger-a' })});
      for (let i=0; i<4; i++) await store.set(${JSON.stringify(`process ${index}:`)}+i, ${JSON.stringify(asset)});
    `)));
    for (const result of results) assert.equal(result.code, 0, result.stderr);
    assert.equal((await f.store.list()).length, 16);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('a failed atomic replacement preserves the previous complete snapshot', async () => {
  const f = await fixture();
  try {
    await f.store.set('AAPL', asset);
    const before = await readFile(f.path, 'utf8');
    const result = await child(`
      import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
      const originalRename = fs.rename;
      fs.rename = async function(from,to) { if(to === ${JSON.stringify(f.path)}) throw Object.assign(new Error('Injected failure'),{code:'EIO'}); return originalRename(from,to); };
      syncBuiltinESMExports();
      const {createAssetBindingStore} = await import(${JSON.stringify(moduleUrl)});
      try { await createAssetBindingStore(${JSON.stringify({ path: f.path, ledgerId: 'ledger-a' })}).set('OTHER',${JSON.stringify(asset)}); process.exitCode=2; }
      catch(error) { if(error.code !== 'METADATA_UNAVAILABLE') throw error; }
    `);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(f.path, 'utf8'), before);
    await f.store.set('AFTER', asset);
    assert.equal((await f.store.list()).length, 2);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('an interrupted writer leaves the old snapshot readable and its lock is reclaimed', async () => {
  const f = await fixture();
  try {
    await f.store.set('AAPL', asset);
    const before = await readFile(f.path, 'utf8');
    const result = await child(`
      import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
      const originalRename = fs.rename;
      fs.rename = async function(from,to) { if(to === ${JSON.stringify(f.path)}) process.kill(process.pid,'SIGKILL'); return originalRename(from,to); };
      syncBuiltinESMExports();
      const {createAssetBindingStore} = await import(${JSON.stringify(moduleUrl)});
      await createAssetBindingStore(${JSON.stringify({ path: f.path, ledgerId: 'ledger-a' })}).set('OTHER',${JSON.stringify(asset)});
    `);
    assert.equal(result.signal, 'SIGKILL', result.stderr);
    assert.equal(await readFile(f.path, 'utf8'), before);
    await f.store.set('AFTER', asset);
    assert.deepEqual(new Set((await f.store.list()).map(binding => binding.commodity)), new Set(['AAPL', 'AFTER']));
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});


test('normalized PNG icons persist across store restart', async () => {
  const f = await fixture();
  try {
    const iconUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=';
    const saved = await f.store.set('AAPL', { ...asset, iconUrl });
    const restarted = createAssetBindingStore({ path: f.path, ledgerId: 'ledger-a' });
    assert.deepEqual(await restarted.list(), [saved]);
    assert.equal((await restarted.list())[0]?.asset.iconUrl, iconUrl);
    for (const invalid of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,PHN2Zz4=', iconUrl + '=', iconUrl + 'A'.repeat(400000)]) {
      await assert.rejects(restarted.set('AAPL', { ...asset, iconUrl: invalid }), { code: 'INVALID_INPUT' });
    }
    assert.deepEqual(await restarted.list(), [saved]);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
