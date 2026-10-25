import test from 'node:test';
import assert from 'node:assert/strict';
import { companyLogos, getCompanyLogo } from './company-logos.ts';

const apple = {
  kind: 'STOCK' as const,
  source: 'nasdaq',
  exchange: 'NASDAQ',
  symbol: 'AAPL',
  name: 'Apple Inc. - Common Stock',
};
test('reviewed Korean and US listings have sourced, keyless PNG company logos', () => {
  assert.equal(companyLogos.length, 6);
  for (const logo of companyLogos) {
    assert.equal(
      getCompanyLogo({
        kind: 'STOCK',
        source: logo.sources[0]!,
        exchange: logo.exchange,
        symbol: logo.symbol,
        name: logo.name,
      }),
      logo,
    );
    assert.match(
      logo.imageUrl,
      /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/.+\.png$/,
    );
    assert.match(logo.sourcePage, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.ok(logo.license.includes('trademark'));
    assert.equal(new URL(logo.imageUrl).search, '');
  }
});
test('provider casing and whitespace conventions preserve known issuer identity', () => {
  assert.ok(getCompanyLogo(apple));
  assert.ok(
    getCompanyLogo({ ...apple, source: 'sec', exchange: 'Nasdaq', name: '  APPLE   INC.  ' }),
  );
  assert.ok(
    getCompanyLogo({
      kind: 'STOCK',
      source: 'kind',
      exchange: 'KOSPI',
      symbol: '005930',
      name: '삼성전자',
    }),
  );
});
test('ambiguous or missing issuer identities never infer a logo from a ticker', () => {
  for (const override of [
    { kind: 'CURRENCY' as const },
    { source: 'custom' },
    { exchange: null },
    { exchange: 'NYSE' },
    { symbol: 'aapl' },
    { symbol: 'AAPLX' },
    { name: 'Apple Inc. leveraged ETF' },
    { name: '' },
    { name: 'An unrelated issuer' },
  ]) {
    assert.equal(getCompanyLogo({ ...apple, ...override }), null);
  }
  assert.equal(
    getCompanyLogo({
      ...apple,
      source: 'kind',
      exchange: 'KRX',
      symbol: '005930',
      name: '삼성전자',
    }),
    null,
  );
});
