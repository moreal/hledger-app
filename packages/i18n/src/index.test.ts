import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { LedgerTransportError } from '../../client/index.ts';
import { activateLocale, createAppI18n, defaultLocale, i18n, localeStorageKey, resolveLocale, supportedLocales, translateError } from './index.ts';

afterEach(() => activateLocale('ko'));

test('only explicit supported preferences select English; everything else defaults to Korean', () => {
  assert.deepEqual(supportedLocales, ['ko', 'en']);
  assert.equal(defaultLocale, 'ko');
  assert.equal(localeStorageKey, 'hledger.locale');
  assert.equal(resolveLocale('en'), 'en');
  assert.equal(resolveLocale('ko'), 'ko');
  for (const value of [undefined, null, '', 'EN', 'en-US', 'fr', 1, {}, ['en']]) assert.equal(resolveLocale(value), 'ko');
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
