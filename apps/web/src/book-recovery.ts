import { isValidBookRequestConfirmation, type BookRequest } from '../../../packages/client/index';
import { normalizeIsbn } from '../../../packages/domain/src/books';
import type { MessageDescriptor } from '@lingui/core';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = Infinity) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const decimal = (value: unknown) => typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) && value.length <= 100;
function date(value: unknown) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const parsed = new Date(value); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }
const money = (value: unknown) => record(value) && decimal(value.value) && text(value.commodity, 32);
/** Validate the entire legacy envelope without normalizing or changing the durable input. */
export function validRequest(value: unknown): value is BookRequest {
  if (!record(value) || !record(value.input)) return false;
  const input = value.input;
  if (!text(input.idempotencyKey, 128) || !date(input.date)) return false;
  if (value.kind === 'purchase') {
    try { if (typeof input.isbn !== 'string') return false; normalizeIsbn(input.isbn); } catch { return false; }
    return text(input.title, 200) && text(input.assetAccount) && text(input.cashAccount) && money(input.purchasePrice) &&
      /[1-9]/.test(String((input.purchasePrice as Record<string, unknown>).value)) &&
      (input.authors == null || Array.isArray(input.authors) && input.authors.length <= 20 && input.authors.every(author => text(author, 200))) &&
      (input.coverUrl == null || typeof input.coverUrl === 'string');
  }
  if (value.kind !== 'dispose' || !text(input.copyId, 20) || !/^[a-f0-9]{20}$/.test(String(input.copyId)) || !text(input.lossAccount)) return false;
  if (input.kind === 'DISCARD') return ['saleProceeds','fee','cashAccount','gainAccount','feeAccount'].every(key => input[key] == null);
  return input.kind === 'SELL' && money(input.saleProceeds) && text(input.cashAccount) && text(input.gainAccount) &&
    (input.fee == null || decimal(input.fee)) && (input.feeAccount == null || text(input.feeAccount)) &&
    (!/[1-9]/.test(String(input.fee ?? '0')) || text(input.feeAccount));
}
export function readPending(key: string, storage?: Pick<Storage, 'getItem'>): { request: BookRequest | null; error: '' | MessageDescriptor } {
  try { const saved = (storage ?? localStorage).getItem(key); if (saved === null) return { request: null, error: '' }; const value: unknown = JSON.parse(saved); if (!validRequest(value)) throw new Error(); return { request: value, error: '' }; }
  catch { return { request: null, error: /* i18n */ { id: 'web.books.1', message: '기존 책 요청의 확인 정보를 읽을 수 없습니다. 브라우저 저장소를 확인하기 전에는 새 요청을 보낼 수 없습니다.' } }; }
}

/** Read-only inspection may clear recovery only after complete same-request proof. */
export async function inspectPending(request: BookRequest, key: string, inspect: (request: BookRequest) => Promise<unknown>, storage: Pick<Storage, 'removeItem'>): Promise<boolean> {
  const proof = await inspect(request);
  if (!isValidBookRequestConfirmation(proof, request)) return false;
  storage.removeItem(key);
  return true;
}

export type BooksFeature = { moduleId: string; version: number; migrationVersion: number; enabled: boolean; migratedExistingData: boolean; canRead: boolean; canWrite: boolean; canLookupMetadata: boolean; canRecover: boolean };
export function acceptsBooksFeature(value: unknown): value is BooksFeature {
  if (!record(value) || value.moduleId !== 'books' || value.migrationVersion !== 1 || !Number.isSafeInteger(value.version) || Number(value.version) < 0 || Number(value.version) > 2147483647) return false;
  if (!['enabled','migratedExistingData','canRead','canWrite','canLookupMetadata','canRecover'].every(key => typeof value[key] === 'boolean')) return false;
  return value.canRecover === true && (value.enabled === true || (!value.canRead && !value.canWrite && !value.canLookupMetadata)) && (!value.canWrite || value.canRead === true);
}
/** A successful reread cannot turn a rejected settings operation into success. */
export async function updateBooksFeature(update: () => Promise<unknown>, refresh: () => void): Promise<boolean> {
  try {
    const result = await update();
    if (!record(result) || (Array.isArray(result.errors) && result.errors.length) || !record(result.data) || !record(result.data.setBooksEnabled)) return false;
    const payload = result.data.setBooksEnabled;
    return Array.isArray(payload.errors) && payload.errors.length === 0 && acceptsBooksFeature(payload.feature);
  } catch { return false; }
  finally { refresh(); }
}
