import { setupI18n } from '@lingui/core';
import assert from 'node:assert/strict';
import test from 'node:test';
import { BookValidationError, bookDate, bookDecimal, bookIsbn } from './book-validation';

test('book date and ISBN errors use Korean guidance while retaining strict guards', () => {
  for (const value of ['', '2026-02-30', '2026-13-01', '2026-1-01'])
    assert.throws(() => bookDate(value), /날짜.*YYYY-MM-DD/);
  assert.equal(bookDate('2024-02-29'), '2024-02-29');
  for (const value of ['', 'abc', '9788936434590'])
    assert.throws(() => bookIsbn(value), /ISBN.*입력해 주세요/);
  assert.equal(bookIsbn('978-89-364-3459-5'), '9788936434595');
});

test('book amounts reject empty or invalid exact decimals with Korean guidance', () => {
  for (const value of ['', ' ', 'abc', '1e3', '1,000', '1.', '.5', '1\n', ' 1']) {
    assert.throws(() => bookDecimal(value), /금액.*입력해 주세요/);
  }
});

test('purchase requires a positive amount and sale amounts allow zero', () => {
  for (const value of ['0', '0.00', '-0', '-1', '-0.01']) {
    assert.throws(() => bookDecimal(value, true), /금액.*양수/);
  }
  for (const value of ['-0', '-1', '-0.01']) {
    assert.throws(() => bookDecimal(value), /금액.*0 이상/);
  }
  assert.equal(bookDecimal('0'), '0');
  assert.equal(bookDecimal('0.00'), '0.00');
});

test('valid book amounts retain every decimal digit without number coercion', () => {
  for (const value of [
    '1',
    '0001.20',
    '9007199254740993.000000000000000001',
    '0.000000000000000001',
  ]) {
    assert.equal(bookDecimal(value, true), value);
    assert.equal(bookDecimal(value), value);
  }
});

test('validation errors retain semantic descriptors that render in the active locale', () => {
  let captured: BookValidationError | undefined;
  try {
    bookDecimal('0', true);
  } catch (error) {
    assert.ok(error instanceof BookValidationError);
    captured = error;
  }
  assert.ok(captured);
  const i18n = setupI18n({
    locale: 'ko',
    messages: {
      ko: { 'books.validation.positive': '금액은 정확한 양수로 입력해 주세요.' },
      en: { 'books.validation.positive': 'Enter an exact positive amount.' },
    },
  });
  assert.equal(i18n._(captured.descriptor), '금액은 정확한 양수로 입력해 주세요.');
  i18n.activate('en');
  assert.equal(i18n._(captured.descriptor), 'Enter an exact positive amount.');
  assert.equal(captured.descriptor.id, 'books.validation.positive');
});
