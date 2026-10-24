import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDecimal, formatMoney, galleryFixtures } from './index.ts';

test('formats amounts beyond Number precision without dropping fractional digits', () => {
  assert.equal(formatDecimal('900719925474099312345678901234567890.1234567890123456789000'),
    '900,719,925,474,099,312,345,678,901,234,567,890.1234567890123456789000');
});

test('keeps negative signs, tiny fractions, trailing zeroes and leading zeroes', () => {
  assert.equal(formatDecimal('-1234567.00400'), '-1,234,567.00400');
  assert.equal(formatDecimal('0.000000000000000000000000000001'), '0.000000000000000000000000000001');
  assert.equal(formatDecimal('-0.00'), '-0.00');
  assert.equal(formatDecimal('0001234.00'), '0,001,234.00');
  assert.equal(formatDecimal('0'), '0');
});

test('rejects malformed decimal strings rather than silently changing their meaning', () => {
  for (const value of ['', ' ', '1e3', '+1', '.1', '1.', '1,000', '1 000', 'NaN', 'Infinity', '--1', '1\n', ' 1', '1 ']) {
    assert.throws(() => formatDecimal(value), TypeError, `accepted ${JSON.stringify(value)}`);
  }
});

test('money keeps an explicit commodity without assuming precision or conversion', () => {
  assert.equal(formatMoney('-1234.5000', 'KRW'), '-1,234.5000 KRW');
  assert.equal(formatMoney('0.00000001', 'BTC'), '0.00000001 BTC');
  assert.equal(formatMoney('10.00', 'USD'), '10.00 USD');
  assert.throws(() => formatMoney('12', ''), TypeError);
  assert.throws(() => formatMoney('12', '   '), TypeError);
});

test('demo variants preserve decimals and separate commodities for each balance and posting', () => {
  for (const variant of [galleryFixtures, galleryFixtures.worstCase]) {
    assert.ok(variant.accounts.length > 0);
    assert.ok(variant.transactions.length > 0);
    assert.ok(variant.prices.length > 0);
    for (const account of variant.accounts) {
      assert.ok(account.balances.length > 0);
      for (const amount of account.balances) assert.doesNotThrow(() => formatMoney(amount.value, amount.commodity));
    }
    for (const transaction of variant.transactions) {
      assert.ok(transaction.postings.length >= 2);
      for (const posting of transaction.postings) assert.doesNotThrow(() => formatMoney(posting.amount.value, posting.amount.commodity));
    }
    for (const price of variant.prices) assert.doesNotThrow(() => formatDecimal(price.rate));
  }
  assert.ok(galleryFixtures.worstCase.accounts.some(account => account.path.length > 100));
  assert.ok(galleryFixtures.worstCase.accounts.some(account => account.balances.length > 1));
  assert.ok(galleryFixtures.worstCase.accounts.some(account => account.balances.some(amount => amount.value === '900719925474099312345678901234567890.1234567890123456789000')));
  assert.ok(galleryFixtures.worstCase.accounts.some(account => account.balances.some(amount => amount.value === '0.000000000000000000000000000001')));
});
