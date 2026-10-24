import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAssetUnitOptions,
  iso4217PublishedAt,
  iso4217SourceUrl,
  iso4217Units,
} from './asset-units.ts';

test('bundled ISO snapshot retains unique codes, numeric codes and minor-unit metadata', () => {
  assert.equal(iso4217PublishedAt, '2026-09-17');
  assert.match(iso4217SourceUrl, /^https:\/\/www\.six-group\.com\//);
  assert.equal(new Set(iso4217Units.map(unit => unit.code)).size, iso4217Units.length);
  assert.ok(iso4217Units.length > 170);
  for (const [code, numericCode, minorUnit] of [['KRW', '410', 0], ['USD', '840', 2], ['JPY', '392', 0]] as const) {
    const unit = iso4217Units.find(candidate => candidate.code === code);
    assert.equal(unit?.numericCode, numericCode);
    assert.equal(unit?.minorUnit, minorUnit);
    assert.equal(unit?.kind, 'currency');
  }
  assert.equal(iso4217Units.find(unit => unit.code === 'ALL')?.numericCode, '008');
});

test('fiat defaults have stable common ordering and exclude ISO funds, metals and special units', () => {
  const options = getAssetUnitOptions();
  assert.deepEqual(options.slice(0, 4).map(option => option.value), ['KRW', 'USD', 'EUR', 'JPY']);
  const rest = options.slice(4).map(option => option.value);
  assert.deepEqual(rest, [...rest].sort());
  assert.ok(options.every(option => option.kind === 'currency'));
  for (const code of ['XXX', 'XTS', 'XAU', 'XAG', 'XPT', 'XPD', 'XDR', 'XUA', 'XSU', 'XBA', 'XBB', 'XBC', 'XBD', 'CLF', 'USN', 'XAD']) {
    assert.ok(!options.some(option => option.value === code), code);
  }
  // X-prefixed legal currencies must not be mistaken for special codes.
  for (const code of ['XAF', 'XOF', 'XCD', 'XPF', 'XCG']) {
    assert.ok(options.some(option => option.value === code), code);
  }
  assert.equal(iso4217Units.find(unit => unit.code === 'CLF')?.kind, 'fund');
  assert.equal(iso4217Units.find(unit => unit.code === 'XAU')?.kind, 'metal');
  assert.equal(iso4217Units.find(unit => unit.code === 'XXX')?.kind, 'special');
});

test('custom units preserve numeric identifiers, exact case and spaces with exact-only deduplication', () => {
  const custom = ['BTC', 'AAPL', '005930', 'btc', 'Fund Class A', 'BTC', 'USD', 'usd', 'XAU'];
  const original = [...custom];
  const options = getAssetUnitOptions(custom);
  assert.deepEqual(options.filter(option => option.kind === 'custom').map(option => option.value),
    ['BTC', 'AAPL', '005930', 'btc', 'Fund Class A', 'usd', 'XAU']);
  assert.equal(options.filter(option => option.value === 'USD').length, 1);
  assert.deepEqual(custom, original);
  // The suggestion helper is not the input validator or a canonicalizer.
  assert.ok(getAssetUnitOptions(['  exact  ']).some(option => option.value === '  exact  '));
});

test('search matches code, English name, localized name and custom values without changing values', () => {
  assert.ok(getAssetUnitOptions([], ' krw ').some(option => option.value === 'KRW'));
  assert.ok(getAssetUnitOptions([], 'US Dollar').some(option => option.value === 'USD'));
  assert.ok(getAssetUnitOptions([], 'Won').some(option => option.value === 'KRW'));
  assert.deepEqual(getAssetUnitOptions(['BTC', 'btc', 'AAPL'], 'BtC').map(option => option.value), ['BTC', 'btc']);
  assert.deepEqual(getAssetUnitOptions(['005930'], '0059').map(option => option.value), ['005930']);
  const krw = getAssetUnitOptions().find(option => option.value === 'KRW')!;
  if (krw.label.includes('원')) assert.ok(getAssetUnitOptions([], '원').some(option => option.value === 'KRW'));
  assert.deepEqual(getAssetUnitOptions([], 'no-such-asset-unit'), []);
});

test('option results can be changed by callers without corrupting later suggestions', () => {
  const options = getAssetUnitOptions();
  options.splice(0, options.length);
  assert.equal(getAssetUnitOptions()[0]?.value, 'KRW');
});
