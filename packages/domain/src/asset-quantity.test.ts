import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAssetQuantity } from './asset-quantity';
test('bound stock quantity hides storage ID without rounding', () => {
  assert.equal(
    formatAssetQuantity('1234.0000000000000001', 'asset:stock:krx:005930', {
      kind: 'STOCK',
      symbol: '005930',
    }),
    '1,234.0000000000000001주',
  );
  assert.equal(formatAssetQuantity('-1', '005930', { kind: 'STOCK', symbol: '005930' }), '-1주');
});
test('cash and custom units remain distinct from stocks', () => {
  assert.equal(formatAssetQuantity('10000', 'KRW'), '10,000원');
  assert.equal(formatAssetQuantity('1', '005930'), '1 005930');
  assert.equal(formatAssetQuantity('1', 'MY-POINTS'), '1 MY-POINTS');
  assert.equal(formatAssetQuantity('1', 'BTC'), '1 BTC');
});
