import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTradePostings, arePostingsBalanced, sumPostingsAtCost, type TradeInput } from './trade';
const base: TradeInput = { side: 'BUY', quantity: '2', commodity: 'STOCK', priceType: 'UNIT', price: '10.25', settlementCommodity: 'USD', securityAccount: 'Assets:Stock', cashAccount: 'Assets:Cash' };
test('buy and sell unit costs balance with fees', () => {
  for (const side of ['BUY', 'SELL'] as const) {
    const postings = buildTradePostings({ ...base, side, fee: '0.50', feeAccount: 'Expenses:Fees' });
    assert.equal(postings[0].amount.value, side === 'BUY' ? '2' : '-2');
    assert.equal(postings[1].amount.value, side === 'BUY' ? '-21' : '20');
    assert.equal(postings[2].amount.value, '0.50');
    assert.equal(arePostingsBalanced(postings), true);
  }
});
test('total costs do not multiply quantity and follow disposal sign', () => {
  for (const side of ['BUY', 'SELL'] as const) {
    const postings = buildTradePostings({ ...base, side, priceType: 'TOTAL', price: '100.001' });
    assert.equal(postings[1].amount.value, side === 'BUY' ? '-100.001' : '100.001');
    assert.equal(arePostingsBalanced(postings), true);
  }
});
test('large amounts and tiny fractions retain exact precision', () => {
  const postings = buildTradePostings({ ...base, quantity: '9007199254740993.000000000000000001', price: '0.000000000000000002' });
  assert.equal(postings[1].amount.value, '-0.018014398509481986000000000000000002');
  assert.equal(arePostingsBalanced(postings), true);
  const tiny = buildTradePostings({ ...base, quantity: '0.00000000000000000001', price: '0.00000000000000000001' });
  assert.equal(tiny[1].amount.value, '-0.0000000000000000000000000000000000000001');
});
test('sale fees can exceed proceeds and yield a balanced cash payment', () => {
  const postings = buildTradePostings({ ...base, side: 'SELL', priceType: 'TOTAL', price: '1', fee: '2', feeAccount: 'Expenses:Fees' });
  assert.equal(postings[1].amount.value, '-1');
  assert.equal(arePostingsBalanced(postings), true);
});
test('zero fees omit expense postings and decimal leading/trailing zeros normalize correctly', () => {
  const postings = buildTradePostings({ ...base, quantity: '0002.00', price: '010.00', fee: '0.000' });
  assert.equal(postings.length, 2);
  assert.equal(postings[0].amount.value, '2');
  assert.equal(postings[1].amount.value, '-20');
});
test('rejects invalid trade fields', () => {
  for (const change of [
    { quantity: '0' }, { quantity: '-1' }, { quantity: '1e2' }, { price: '0' }, { price: 'NaN' }, { price: '1\n' },
    { fee: '-0.1' }, { fee: '1' }, { commodity: 'USD' }, { securityAccount: '' }, { cashAccount: 'Assets:Stock' },
    { fee: '1', feeAccount: 'Assets:Cash' }, { settlementCommodity: ' ' }, { commodity: 'x'.repeat(33) },
  ]) assert.throws(() => buildTradePostings({ ...base, ...change }), TypeError);
});
test('balance helper separates commodities and includes exact signed total costs', () => {
  assert.deepEqual(sumPostingsAtCost([{ amount: { value: '-200', commodity: 'STOCK' }, cost: { type: 'TOTAL', amount: { value: '10', commodity: 'USD' } } }, { amount: { value: '10', commodity: 'USD' } }]), [{ commodity: 'USD', value: '0' }]);
  assert.equal(arePostingsBalanced([{ amount: { value: '1', commodity: 'USD' } }, { amount: { value: '-1', commodity: 'KRW' } }]), false);
  assert.throws(() => sumPostingsAtCost([{ amount: { value: '1', commodity: 'STOCK' }, cost: { type: 'UNIT', amount: { value: '-1', commodity: 'USD' } } }]), TypeError);
});
