import assert from 'node:assert/strict';
import test from 'node:test';
import { tokens } from './index';
import { iso4217Units } from '../../domain/src/asset-units';
import { currencyIcons, currencyIconSizes, getCurrencyIcon } from './currency-icons';

test('every snapshot currency has one stable icon and a distinct identifying code', () => {
  const codes = iso4217Units.filter(unit => unit.kind === 'currency').map(unit => unit.code);
  assert.deepEqual(currencyIcons.map(icon => icon.code), codes);
  assert.equal(new Set(currencyIcons.map(icon => icon.code)).size, codes.length);
  for (const icon of currencyIcons) {
    assert.equal(getCurrencyIcon(icon.code), icon);
    assert.equal(icon.kind, 'currency');
    assert.ok(icon.glyph.length > 0);
    assert.ok(icon.name.length > 0);
    assert.equal(icon.background, tokens.colors.featureBackground);
    assert.equal(icon.foreground, tokens.colors.featureText);
  }
});

test('ambiguous symbols retain the identifying ISO code', () => {
  for (const code of ['USD', 'CAD', 'AUD', 'HKD']) {
    assert.equal(getCurrencyIcon(code).glyph, '$');
    assert.equal(getCurrencyIcon(code).code, code);
  }
  assert.equal(getCurrencyIcon('JPY').glyph, getCurrencyIcon('CNY').glyph);
  assert.notEqual(getCurrencyIcon('JPY').code, getCurrencyIcon('CNY').code);
});

test('custom commodities preserve exact spelling and never become currencies implicitly', () => {
  for (const code of ['usd', 'Usd', ' USD', 'USD ', 'BTC', '005930', 'XAU', 'XXX', '', '한글 단위', '__proto__']) {
    const icon = getCurrencyIcon(code);
    assert.equal(icon.kind, 'custom');
    assert.equal(icon.code, code);
    assert.equal(icon.name, code);
    assert.equal(icon.glyph, '◇');
    assert.deepEqual(getCurrencyIcon(code), icon);
  }
});

test('shared sizes support compact rows and large inspection', () => {
  assert.deepEqual(currencyIconSizes, { small: 24, medium: 32, large: 48 });
});
