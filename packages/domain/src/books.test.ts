import assert from 'node:assert/strict';
import test from 'node:test';
import { createBookCommodity, normalizeIsbn } from './books.ts';

test('ISBN-10 and ISBN-13 formats normalize to the same edition', () => {
  for (const isbn of ['0-306-40615-2', ' 978 0 306 40615 7 ', '9780306406157']) {
    assert.equal(normalizeIsbn(isbn), '9780306406157');
  }
});

test('ISBN-10 accepts X only as a valid terminal check digit', () => {
  assert.equal(normalizeIsbn('0-8044-2957-x'), '9780804429573');
  for (const isbn of ['0804429570', 'X804429570', '08044295X7'])
    assert.throws(() => normalizeIsbn(isbn));
});

test('ISBN-13 accepts 979 editions and rejects invalid checksums and non-ISBN EANs', () => {
  assert.equal(normalizeIsbn('979-10-90636-07-1'), '9791090636071');
  for (const isbn of [
    '',
    '9780306406158',
    '4006381333931',
    '978030640615',
    '97803064061570',
    'ISBN 9780306406157',
  ]) {
    assert.throws(() => normalizeIsbn(isbn));
  }
});

test('physical copies retain independent stable commodities within the length limit', () => {
  const first = createBookCommodity('0123456789abcdef0123');
  const second = createBookCommodity('0123456789abcdef0124');
  assert.equal(first, createBookCommodity('0123456789abcdef0123'));
  assert.notEqual(first, second);
  assert.equal(first.length, 31);
});

test('copy IDs cannot silently normalize, truncate, or reuse an ISBN', () => {
  for (const id of [
    '9780306406157',
    '',
    '0123456789ABCDEF0123',
    '0123456789abcdef01234',
    '0123456789abcdef012g',
  ]) {
    assert.throws(() => createBookCommodity(id));
  }
});
