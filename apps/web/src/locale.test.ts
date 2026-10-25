import assert from 'node:assert/strict';
import test from 'node:test';
import { readLocale, persistLocale } from './locale';

test('restores explicit English and defaults unknown or missing choices to Korean', () => {
  assert.equal(readLocale({ getItem: () => 'en' }), 'en');
  assert.equal(readLocale({ getItem: () => 'ko' }), 'ko');
  assert.equal(readLocale({ getItem: () => 'fr' }), 'ko');
  assert.equal(readLocale({ getItem: () => null }), 'ko');
});
test('locale preferences use an independent key', () => {
  const values = new Map([['hledger.endpoint', 'https://ledger.example/graphql']]);
  persistLocale('en', { setItem: (key, value) => { values.set(key, value); } });
  assert.equal(values.get('hledger.locale'), 'en');
  assert.equal(values.get('hledger.endpoint'), 'https://ledger.example/graphql');
});
test('unavailable browser storage does not prevent locale selection', () => {
  assert.equal(readLocale({ getItem: () => { throw new Error('blocked'); } }), 'ko');
  assert.doesNotThrow(() => persistLocale('en', { setItem: () => { throw new Error('full'); } }));
});
