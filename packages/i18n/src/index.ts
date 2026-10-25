import { setupI18n, type I18n } from '@lingui/core';
import { LedgerTransportError } from '../../client/index.ts';
import { OutboxPersistenceError, OutboxCorruptionError, OutboxEndpointError, type OutboxRecord, type OutboxMessage } from '../../client/outbox.ts';
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

const storageMessages: Record<string, { id: string; message: string }> = {
  '저장된 자료의 무결성을 확인할 수 없습니다.': /* i18n */ { id: 'native.storage.integrityFailed', message: '저장된 자료의 무결성을 확인할 수 없습니다.' },
  '기기 저장 자료를 읽지 못했습니다. 원본은 보존되어 있으며 새 저장을 중단했습니다.': /* i18n */ { id: 'native.storage.damagedSnapshots', message: '기기 저장 자료를 읽지 못했습니다. 원본은 보존되어 있으며 새 저장을 중단했습니다.' },
  '저장 사본 하나가 불완전하여 마지막 정상 사본을 복구했습니다. 대기 거래를 확인해 주세요.': /* i18n */ { id: 'native.storage.recoveredSnapshot', message: '저장 사본 하나가 불완전하여 마지막 정상 사본을 복구했습니다. 대기 거래를 확인해 주세요.' },
  '기기 저장을 확인하지 못했습니다. 입력을 유지하고 다시 시도해 주세요.': /* i18n */ { id: 'native.storage.saveUnconfirmed', message: '기기 저장을 확인하지 못했습니다. 입력을 유지하고 다시 시도해 주세요.' },
};
/** Localize only exact app-owned storage diagnostics; server text stays intact. */
export function formatStorageMessage(raw: string): string {
  return Object.hasOwn(storageMessages, raw) ? i18n._(storageMessages[raw]) : raw;
}

/** Transport errors must never imply that an interrupted write was not saved. */
export function translateError(error: unknown): string {
  if (error instanceof OutboxPersistenceError) return i18n._(/* i18n */ { id: 'error.outboxPersistence', message: '전송 대기함을 저장하지 못했습니다. 마지막으로 저장된 상태를 유지합니다.' });
  if (error instanceof OutboxCorruptionError) return i18n._(/* i18n */ { id: 'error.outboxCorruption', message: '저장된 전송 대기함이 올바르지 않습니다. 초기화하기 전에 복구할 수 있도록 데이터를 보존해 주세요.' });
  if (error instanceof OutboxEndpointError) return formatOutboxInfo({ code: 'endpointMismatch' });
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
  return error instanceof Error ? formatStorageMessage(error.message) : typeof error === 'string' ? formatStorageMessage(error) : i18n._(/* i18n */ {
    id: 'error.unknown',
    message: '알 수 없는 오류가 발생했습니다.',
  });
}


function formatOutboxInfo(info: OutboxMessage): string {
  switch (info.code) {
    case 'interrupted': return i18n._(/* i18n */ { id: 'outbox.message.interrupted', message: '요청 도중 앱이 종료되었습니다. 원장을 확인하거나 같은 키로 직접 재시도해 주세요.' });
    case 'rejected': return i18n._(/* i18n */ { id: 'outbox.message.rejected', message: '원장이 이 요청을 거부했습니다.' });
    case 'unconfirmed': return i18n._(/* i18n */ { id: 'outbox.message.unconfirmed', message: '서버가 저장을 확인하지 않았습니다. 원장을 확인하거나 같은 키로 직접 재시도해 주세요.' });
    case 'unknown': return i18n._(/* i18n */ { id: 'outbox.message.unknown', message: '저장 결과를 알 수 없습니다.' });
    case 'endpointMismatch': return i18n._(/* i18n */ { id: 'outbox.message.endpointMismatch', message: '다른 원장 서버의 요청입니다. 재시도하려면 원래 서버에 다시 연결해 주세요.' });
    case 'transport': return translateError(new LedgerTransportError('', info.kind, info.status));
    case 'retryUncertain': {
      const detail = info.reason ? formatOutboxInfo(info.reason) : info.detail ?? i18n._(/* i18n */ { id: 'outbox.message.retryRejected', message: '재시도가 거부되었습니다.' });
      return i18n._(/* i18n */ { id: 'outbox.message.retryUncertain', message: '{detail} 이전 저장 결과는 여전히 알 수 없습니다.', values: { detail } });
    }
  }
}

type OutboxReason = Exclude<OutboxMessage, { code: 'retryUncertain' }>;
const legacyOutboxMessages: Record<string, OutboxReason> = {
  'The app stopped during a request. Check the ledger or explicitly retry with the same key.': { code: 'interrupted' },
  'The ledger rejected this request.': { code: 'rejected' },
  'The server did not confirm this save. Check the ledger or explicitly retry with the same key.': { code: 'unconfirmed' },
  'The write outcome is unknown.': { code: 'unknown' },
  'This request belongs to another ledger endpoint. Reconnect to its original endpoint to retry.': { code: 'endpointMismatch' },
  'The ledger request timed out. Its write outcome may be unknown.': { code: 'transport', kind: 'network' },
  'The ledger request could not be completed. Its write outcome may be unknown.': { code: 'transport', kind: 'network' },
  'The ledger returned invalid JSON. Its write outcome may be unknown.': { code: 'transport', kind: 'protocol' },
  'Invalid GraphQL response.': { code: 'transport', kind: 'protocol' },
  'The ledger returned an invalid save confirmation. Its write outcome may be unknown.': { code: 'transport', kind: 'protocol' },
};

function legacyOutboxInfo(raw: string): OutboxReason | undefined {
  if (Object.hasOwn(legacyOutboxMessages, raw)) return legacyOutboxMessages[raw];
  const http = /^The ledger returned HTTP ([1-5][0-9]{2})\.$/.exec(raw);
  return http ? { code: 'transport', kind: 'http', status: Number(http[1]) } : undefined;
}

/** Render saved diagnostics in the active locale without changing the durable record. */
export function formatOutboxMessage(record: Pick<OutboxRecord, 'message' | 'messageInfo'>): string {
  if (record.messageInfo) return formatOutboxInfo(record.messageInfo);
  const raw = record.message ?? '';
  const info = legacyOutboxInfo(raw);
  if (info) return formatOutboxInfo(info);
  const suffix = ' The earlier write outcome is still unknown.';
  if (raw.endsWith(suffix)) {
    const detail = raw.slice(0, -suffix.length);
    if (detail) {
      const reason = legacyOutboxInfo(detail);
      return formatOutboxInfo({ code: 'retryUncertain', ...(reason ? { reason } : { detail: detail === 'The retry was rejected.' ? undefined : detail }) });
    }
  }
  return raw;
}

/** Only domain-owned validation messages are translated; other diagnostics stay intact. */
export function formatTradeValidation(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  switch (message) {
    case 'Asset is required and must be at most 32 characters.': return i18n._(/* i18n */ { id: 'trade.validation.asset', message: '종목을 1~32자로 입력해 주세요.' });
    case 'Settlement asset is required and must be at most 32 characters.': return i18n._(/* i18n */ { id: 'trade.validation.settlementAsset', message: '결제 자산을 1~32자로 입력해 주세요.' });
    case 'Asset account is required.': return i18n._(/* i18n */ { id: 'trade.validation.assetAccount', message: '주식 계좌를 입력해 주세요.' });
    case 'Cash account is required.': return i18n._(/* i18n */ { id: 'trade.validation.cashAccount', message: '결제 계좌를 입력해 주세요.' });
    case 'Asset and settlement commodity must differ.': return i18n._(/* i18n */ { id: 'trade.validation.distinctAssets', message: '종목과 결제 자산은 서로 달라야 합니다.' });
    case 'Asset and cash accounts must differ.': return i18n._(/* i18n */ { id: 'trade.validation.distinctAccounts', message: '주식 계좌와 결제 계좌는 서로 달라야 합니다.' });
    case 'Fee account must differ from trade accounts.': return i18n._(/* i18n */ { id: 'trade.validation.distinctFeeAccount', message: '수수료 비용 항목은 주식·결제 계좌와 달라야 합니다.' });
    case 'Fee account is required.': return i18n._(/* i18n */ { id: 'trade.validation.feeAccount', message: '수수료가 있으면 비용 항목을 입력해 주세요.' });
    case 'Fee must be nonnegative.': return i18n._(/* i18n */ { id: 'trade.validation.fee', message: '수수료는 0 이상이어야 합니다.' });
    case 'Invalid trade side.': return i18n._(/* i18n */ { id: 'trade.validation.side', message: '매수 또는 매도를 선택해 주세요.' });
    case 'Invalid price type.': return i18n._(/* i18n */ { id: 'trade.validation.priceType', message: '가격 입력 방식을 선택해 주세요.' });
    case 'Expected an exact decimal string.':
    case 'Quantity and price must be positive.': return i18n._(/* i18n */ { id: 'trade.validation.amounts', message: '수량과 가격은 양수, 수수료는 0 이상으로 쉼표 없이 입력해 주세요.' });
    default: return message || translateError(error);
  }
}
