import { setupI18n, type I18n } from '@lingui/core';
import { LedgerTransportError } from '../../client/index.ts';
import { messages as koMessages } from '../locales/ko/messages';
import { messages as enMessages } from '../locales/en/messages';

export type AppLocale = 'ko' | 'en';
export const supportedLocales = ['ko', 'en'] as const;
export const defaultLocale: AppLocale = 'ko';
export const localeStorageKey = 'hledger.locale';

export function resolveLocale(value: unknown): AppLocale {
  return value === 'en' ? 'en' : defaultLocale;
}

/** Each instance includes both catalogs so changing language works offline. */
export function createAppI18n(locale: AppLocale = defaultLocale): I18n {
  return setupI18n({ locale: resolveLocale(locale), messages: { ko: koMessages, en: enMessages } });
}

export const i18n = createAppI18n();

export function activateLocale(locale: AppLocale): void {
  i18n.activate(resolveLocale(locale));
}

/** Transport errors must never imply that an interrupted write was not saved. */
export function translateError(error: unknown): string {
  if (error instanceof LedgerTransportError) {
    if (error.kind === 'network') return i18n._(/* i18n */ {
      id: 'error.network',
      message: '네트워크 요청을 완료하지 못했습니다. 저장 결과가 불명확할 수 있습니다. 같은 요청으로 결과를 확인해 주세요.',
    });
    if (error.kind === 'http') return i18n._(/* i18n */ {
      id: 'error.http',
      message: '서버가 HTTP {status} 응답을 반환했습니다. 저장 결과가 불명확할 수 있습니다. 같은 요청으로 결과를 확인해 주세요.',
      values: { status: error.status ?? '?' },
    });
    if (error.kind === 'protocol') return i18n._(/* i18n */ {
      id: 'error.protocol',
      message: '서버 응답을 확인하지 못했습니다. 저장 결과가 불명확할 수 있습니다. 같은 요청으로 결과를 확인해 주세요.',
    });
  }
  return error instanceof Error ? error.message : i18n._(/* i18n */ {
    id: 'error.unknown',
    message: '알 수 없는 오류가 발생했습니다.',
  });
}
