import assert from 'node:assert/strict';
import test from 'node:test';
import type { Asset } from './asset-catalog.ts';
import { ledgerCommodity } from './asset-identity.ts';

const stock = (
  exchange: string | null,
  symbol = '005930',
  source = 'kind',
): Pick<Asset, 'kind' | 'exchange' | 'symbol' | 'source'> => ({
  kind: 'STOCK',
  exchange,
  symbol,
  source,
});

test('Korean stock identity is shared across providers and KRX markets', () => {
  for (const exchange of ['KOSPI', 'KOSDAQ', 'KONEX']) {
    for (const source of ['kind', 'krx', 'other']) {
      assert.equal(ledgerCommodity(stock(exchange, '005930', source)), 'asset:stock:krx:005930');
    }
  }
});

test('US stock identity distinguishes exchanges while ignoring providers', () => {
  for (const exchange of ['NASDAQ', 'NYSE', 'AMEX']) {
    for (const source of ['nasdaq', 'other']) {
      assert.equal(
        ledgerCommodity(stock(exchange, 'AbC.B', source)),
        `asset:stock:${exchange.toLowerCase()}:AbC.B`,
      );
    }
  }
});

test('unsupported stock exchanges retain exact symbols without inferring market from provider', () => {
  for (const exchange of [null, '', 'UNKNOWN']) {
    assert.equal(ledgerCommodity(stock(exchange, 'Raw Symbol', 'nasdaq')), 'Raw Symbol');
  }
});

test('currency and crypto symbols remain exact ledger units', () => {
  for (const kind of ['CURRENCY', 'CRYPTO'] as const) {
    assert.equal(
      ledgerCommodity({ kind, exchange: null, symbol: '  Exact Symbol  ', source: 'custom' }),
      '  Exact Symbol  ',
    );
  }
});

test('canonical identifiers are never truncated to satisfy commodity length limits', () => {
  const symbol = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  assert.equal(ledgerCommodity(stock('NASDAQ', symbol)), symbol);
  assert.equal(
    ledgerCommodity(stock('NASDAQ', 'ABCDEFGHIJKLM')),
    'asset:stock:nasdaq:ABCDEFGHIJKLM',
  );
});
