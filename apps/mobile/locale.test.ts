import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalePreference } from './locale';

test('unknown, malformed and failed locale storage fall back to Korean', async () => {
  for (const load of [async () => 'broken', async () => JSON.stringify({ 'hledger.locale': 'xx' }), async () => { throw Error('offline'); }]) {
    const activated: string[] = [];
    const preference = createLocalePreference({ load, save: async () => {} }, locale => { activated.push(locale); });
    await preference.hydrate();
    assert.equal(preference.current(), 'ko');
    assert.deepEqual(activated, ['ko']);
  }
});

test('late hydration cannot overwrite an explicit language selection', async () => {
  let resolve!: (value: string) => void;
  const preference = createLocalePreference({ load: () => new Promise(r => { resolve = r; }), save: async () => {} }, () => {});
  const hydration = preference.hydrate();
  const selection = preference.select('en');
  resolve(JSON.stringify({ 'hledger.locale': 'ko' }));
  await Promise.all([hydration, selection]);
  assert.equal(preference.current(), 'en');
});

test('rapid selections persist in order and recover after a failed write', async () => {
  const saved: string[] = [];
  const preference = createLocalePreference({ load: async () => null, save: async value => { saved.push(value); if (saved.length === 1) throw Error('full'); } }, () => {});
  const first = preference.select('en');
  const second = preference.select('ko');
  await assert.rejects(first);
  await second;
  assert.deepEqual(saved.map(value => JSON.parse(value)['hledger.locale']), ['en', 'ko']);
  assert.equal(preference.current(), 'ko');
});
