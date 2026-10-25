import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import {
  createFeatureSettingsStore,
  createMemoryFeatureSettingsStore,
} from './feature-settings.ts';

async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'features-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { path: join(directory, 'ledger.features.json'), ledgerId: 'ledger' };
}
test('new ledgers off; existing verified records migrate once and restart persists CAS', async (t) => {
  const options = await fixture(t);
  let inspections = 0;
  const store = createFeatureSettingsStore({
    ...options,
    inspectExisting: async () => {
      inspections++;
      return true;
    },
  });
  assert.equal((await store.read()).migratedExistingData, true);
  assert.equal((await store.read()).enabled, true);
  assert.equal(inspections, 1);
  await store.setEnabled(false, 0);
  const restarted = createFeatureSettingsStore(options);
  assert.equal((await restarted.read()).enabled, false);
  await assert.rejects(restarted.setEnabled(true, 0), { code: 'FEATURE_VERSION_CONFLICT' });
  const other = createFeatureSettingsStore({ ...options, path: options.path + '-other' });
  assert.equal((await other.read()).enabled, false);
});
test('corrupt settings and unverifiable migration fail closed without overwrite', async (t) => {
  const options = await fixture(t);
  await writeFile(options.path, 'broken');
  const store = createFeatureSettingsStore(options);
  await assert.rejects(store.read(), { code: 'FEATURE_SETTINGS_UNAVAILABLE' });
  await assert.rejects(store.withBooksEnabled(async () => assert.fail()));
  assert.equal(await readFile(options.path, 'utf8'), 'broken');
  const bad = createFeatureSettingsStore({
    ...options,
    path: options.path + '-bad',
    inspectExisting: async () => {
      throw Error('bad evidence');
    },
  });
  await assert.rejects(bad.read(), { code: 'FEATURE_SETTINGS_UNAVAILABLE' });
});
test('whole write holds admission lock through disable and pending guard', async (t) => {
  const options = await fixture(t),
    a = createFeatureSettingsStore(options),
    b = createFeatureSettingsStore(options);
  await a.setEnabled(true, 0);
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>((r) => (started = r)),
    wait = new Promise<void>((r) => (release = r));
  const write = a.withBooksEnabled(async () => {
    started();
    await wait;
  });
  await ready;
  let toggled = false;
  const disable = b.setEnabled(false, 1).then(() => {
    toggled = true;
  });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(toggled, false);
  release();
  await Promise.all([write, disable]);
  await assert.rejects(
    a.withBooksEnabled(async () => assert.fail()),
    { code: 'FEATURE_DISABLED' },
  );
  await assert.rejects(b.setEnabled(false, 2, true), { code: 'PENDING_BOOK_REQUEST' });
});
test('independent processes serialize stale-version toggles', async (t) => {
  const options = await fixture(t);
  await createFeatureSettingsStore(options).read();
  const source = `import {createFeatureSettingsStore} from ${JSON.stringify(new URL('./feature-settings.ts', import.meta.url).href)}; try {await createFeatureSettingsStore(${JSON.stringify(options)}).setEnabled(true,0);console.log('ok')}catch(e){console.log(e.code)}`;
  const run = () =>
    new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        source,
      ]);
      let out = '';
      child.stdout.on('data', (x) => (out += x));
      child.on('error', reject);
      child.on('exit', (code) =>
        code === 0 ? resolve(out.trim()) : reject(Error('child failed')),
      );
    });
  assert.deepEqual((await Promise.all([run(), run()])).sort(), ['FEATURE_VERSION_CONFLICT', 'ok']);
});
test('test memory store explicitly defaults off', async () => {
  const store = createMemoryFeatureSettingsStore();
  assert.equal((await store.read()).enabled, false);
  await assert.rejects(
    store.withBooksEnabled(async () => assert.fail()),
    { code: 'FEATURE_DISABLED' },
  );
});
test('another process cannot disable until an admitted book write completes', async (t) => {
  const options = await fixture(t);
  const store = createFeatureSettingsStore(options);
  await store.setEnabled(true, 0);
  const source = `import {createFeatureSettingsStore} from ${JSON.stringify(new URL('./feature-settings.ts', import.meta.url).href)}; await createFeatureSettingsStore(${JSON.stringify(options)}).withBooksEnabled(async()=>{console.log('admitted');await new Promise(r=>process.stdin.once('data',r));});process.exit(0);`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source]);
  t.after(() => child.kill());
  await new Promise<void>((resolve, reject) => {
    child.stdout.once('data', () => resolve());
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code) reject(Error('child failed'));
    });
  });
  let toggled = false;
  const disable = store.setEnabled(false, 1).then(() => {
    toggled = true;
  });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(toggled, false);
  child.stdin.end('complete');
  await disable;
  assert.equal((await store.read()).enabled, false);
});
