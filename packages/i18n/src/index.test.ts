import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { LedgerTransportError } from '../../client/index.ts';
import {
  OutboxPersistenceError,
  OutboxCorruptionError,
  OutboxEndpointError,
  type OutboxRecord,
} from '../../client/outbox.ts';
import {
  formatOutboxMessage,
  formatTradeValidation,
  formatStorageMessage,
  activateLocale,
  createAppI18n,
  defaultLocale,
  i18n,
  localeStorageKey,
  resolveLocale,
  supportedLocales,
  translateError,
} from './index.ts';

afterEach(() => activateLocale('ko'));

test('only explicit supported preferences select English; everything else defaults to Korean', () => {
  assert.deepEqual(supportedLocales, ['ko', 'en']);
  assert.equal(defaultLocale, 'ko');
  assert.equal(localeStorageKey, 'hledger.locale');
  assert.equal(resolveLocale('en'), 'en');
  assert.equal(resolveLocale('ko'), 'ko');
  for (const value of [undefined, null, '', 'EN', 'en-US', 'fr', 1, {}, ['en']])
    assert.equal(resolveLocale(value), 'ko');
});

test('instances bundle both locales and remain independent of the app singleton', () => {
  const isolated = createAppI18n('en');
  assert.equal(isolated.locale, 'en');
  assert.equal(i18n.locale, 'ko');
  assert.equal(createAppI18n().locale, 'ko');
  activateLocale('en');
  assert.equal(i18n.locale, 'en');
  isolated.activate('ko');
  assert.equal(i18n.locale, 'en');
});

test('missing descriptors retain the supplied message or identifier', () => {
  const isolated = createAppI18n('en');
  assert.equal(isolated._({ id: 'test.missing', message: 'Source fallback' }), 'Source fallback');
  assert.equal(isolated._('test.identifier'), 'test.identifier');
});

test('compiled catalogs interpolate exact values and select plural branches', () => {
  const isolated = createAppI18n('en');
  assert.equal(isolated._('story.transactionCount', { count: 1 }), '1 transaction');
  assert.equal(isolated._('story.transactionCount', { count: 3 }), '3 transactions');
  isolated.activate('ko');
  assert.equal(isolated._('story.transactionCount', { count: 3 }), '거래 3개');
  activateLocale('en');
  assert.match(translateError(new LedgerTransportError('Internal', 'http', 503)), /503/);
});

test('all transport kinds retain the unknown write outcome and same-request recovery guidance', () => {
  for (const locale of supportedLocales) {
    activateLocale(locale);
    for (const kind of ['network', 'http', 'protocol'] as const) {
      const message = translateError(new LedgerTransportError('Raw internal detail', kind, 503));
      assert.doesNotMatch(message, /Raw internal detail/);
      assert.match(message, locale === 'en' ? /unknown/i : /불명확/);
      assert.match(message, locale === 'en' ? /same request/i : /같은 요청/);
      if (kind === 'http') assert.match(message, /503/);
    }
  }
});

test('ordinary error messages are preserved and non-errors use the current localized fallback', () => {
  assert.equal(translateError(new Error('Account:자산:USD 1.000')), 'Account:자산:USD 1.000');
  assert.equal(translateError(null), '알 수 없는 오류가 발생했습니다.');
  activateLocale('en');
  assert.equal(translateError({ message: 'untrusted' }), 'An unknown error occurred.');
});

test('outbox metadata rerenders the same immutable record across locale switches', () => {
  const record: OutboxRecord = {
    id: 'same-key',
    endpoint: 'https://ledger.test/',
    state: 'needsReview',
    input: {
      idempotencyKey: 'same-key',
      date: '2026-01-01',
      description: 'Raw 거래',
      postings: [],
    },
    message: 'Old stored text',
    messageInfo: {
      code: 'retryUncertain',
      reason: { code: 'transport', kind: 'http', status: 403 },
    },
  };
  const before = JSON.stringify(record);
  activateLocale('ko');
  const ko = formatOutboxMessage(record);
  activateLocale('en');
  const en = formatOutboxMessage(record);
  assert.notEqual(en, ko);
  assert.match(en, /403/);
  assert.match(en, /earlier write outcome.*unknown/i);
  assert.match(ko, /이전 저장 결과/);
  assert.equal(JSON.stringify(record), before);
});

test('legacy app literals translate while raw server diagnostics remain exact', () => {
  activateLocale('ko');
  assert.match(formatOutboxMessage({ message: 'The ledger rejected this request.' }), /거부/);
  const raw = 'Server says Asset is missing; HTTP 503; 자산:주식';
  assert.equal(formatOutboxMessage({ message: raw }), raw);
  assert.equal(
    formatOutboxMessage({ message: 'The ledger returned HTTP 503. trailing server detail' }),
    'The ledger returned HTTP 503. trailing server detail',
  );
  const wrapped = formatOutboxMessage({
    message: raw + ' The earlier write outcome is still unknown.',
  });
  assert.ok(wrapped.startsWith(raw));
  assert.match(wrapped, /이전 저장 결과/);
  assert.equal(formatOutboxMessage({}), '');
});

test('outbox infrastructure errors localize without replacing ordinary diagnostics', () => {
  for (const error of [
    new OutboxPersistenceError('raw'),
    new OutboxCorruptionError(),
    new OutboxEndpointError(),
  ]) {
    activateLocale('ko');
    const ko = translateError(error);
    activateLocale('en');
    assert.notEqual(translateError(error), ko);
  }
  assert.equal(
    translateError(new Error('The saved outbox is invalid: server diagnostic')),
    'The saved outbox is invalid: server diagnostic',
  );
});

test('trade validation uses the current locale and preserves unrecognized errors', () => {
  const errors = [
    'Asset is required and must be at most 32 characters.',
    'Settlement asset is required and must be at most 32 characters.',
    'Asset account is required.',
    'Cash account is required.',
    'Asset and settlement commodity must differ.',
    'Asset and cash accounts must differ.',
    'Fee account must differ from trade accounts.',
    'Fee account is required.',
    'Fee must be nonnegative.',
    'Expected an exact decimal string.',
    'Quantity and price must be positive.',
    'Invalid trade side.',
    'Invalid price type.',
  ].map((message) => new Error(message));
  for (const error of errors) {
    const original = error.message;
    activateLocale('ko');
    const ko = formatTradeValidation(error);
    activateLocale('en');
    assert.notEqual(formatTradeValidation(error), ko, original);
    assert.equal(error.message, original);
  }
  for (const raw of [
    'Asset is unavailable on server',
    'Fee account must differ: custom diagnostic',
    'Unexpected 자산:USD 1.000',
  ])
    assert.equal(formatTradeValidation(new Error(raw)), raw);
});

test('legacy uncertain retry localizes both the exact app prefix and uncertainty suffix', () => {
  for (const prefix of [
    'The ledger request could not be completed. Its write outcome may be unknown.',
    'The ledger returned HTTP 403.',
  ]) {
    const record = Object.freeze({
      message: prefix + ' The earlier write outcome is still unknown.',
    });
    activateLocale('ko');
    const ko = formatOutboxMessage(record);
    assert.ok(ko.startsWith(formatOutboxMessage({ message: prefix })));
    assert.match(ko, /이전 저장 결과/);
    assert.doesNotMatch(ko, /The ledger/);
    activateLocale('en');
    const en = formatOutboxMessage(record);
    assert.ok(en.startsWith(formatOutboxMessage({ message: prefix })));
    assert.match(en, /earlier write outcome.*unknown/i);
    assert.notEqual(en, ko);
    assert.equal(record.message, prefix + ' The earlier write outcome is still unknown.');
  }
});

test('retained exact storage diagnostics follow locale without changing the original error', () => {
  const messages = [
    '저장된 자료의 무결성을 확인할 수 없습니다.',
    '기기 저장 자료를 읽지 못했습니다. 원본은 보존되어 있으며 새 저장을 중단했습니다.',
    '저장 사본 하나가 불완전하여 마지막 정상 사본을 복구했습니다. 대기 거래를 확인해 주세요.',
    '기기 저장을 확인하지 못했습니다. 입력을 유지하고 다시 시도해 주세요.',
  ];
  for (const raw of messages) {
    const retained = new Error(raw);
    activateLocale('ko');
    assert.equal(formatStorageMessage(raw), raw);
    assert.equal(translateError(retained), raw);
    activateLocale('en');
    assert.notEqual(formatStorageMessage(raw), raw);
    assert.equal(translateError(retained), formatStorageMessage(raw));
    assert.equal(translateError(raw), formatStorageMessage(raw));
    assert.equal(retained.message, raw);
  }
  for (const raw of [
    '서버 저장 오류: custom diagnostic',
    messages[0] + ' Server detail',
    '__proto__',
  ]) {
    assert.equal(formatStorageMessage(raw), raw);
    assert.equal(translateError(new Error(raw)), raw);
  }
});
