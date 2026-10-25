import { isValidBookRequestConfirmation, type BookRequest } from '../../packages/client';
export type PendingBook = { identity: string } & BookRequest;
export type BooksFeature = { moduleId: string; version: number; migrationVersion: number; enabled: boolean; migratedExistingData: boolean; canRead: boolean; canWrite: boolean; canLookupMetadata: boolean; canRecover: boolean };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
/** Decode the original durable namespace payload without rewriting or normalizing it. */
export function parsePendingBook(raw: string | null): PendingBook | null {
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (value === null) return null;
  if (!record(value) || !text(value.identity) || !record(value.input) || !text(value.input.idempotencyKey) || !text(value.input.date)) throw new Error('Invalid preserved book request');
  const input = value.input;
  const money = (amount: unknown) => record(amount) && text(amount.commodity) && text(amount.value);
  if (value.kind === 'purchase') {
    if (!text(input.isbn) || !text(input.title) || !text(input.assetAccount) || !text(input.cashAccount) || !money(input.purchasePrice) || (input.authors !== undefined && input.authors !== null && (!Array.isArray(input.authors) || !input.authors.every(author => typeof author === 'string')))) throw new Error('Invalid preserved purchase');
  } else if (value.kind === 'dispose') {
    if (!text(input.copyId) || !text(input.lossAccount) || !['SELL', 'DISCARD'].includes(String(input.kind)) || (input.kind === 'SELL' && (!money(input.saleProceeds) || !text(input.cashAccount) || !text(input.gainAccount) || !text(input.feeAccount)))) throw new Error('Invalid preserved disposal');
  } else throw new Error('Invalid preserved book request kind');
  return freeze(value as PendingBook);
}
export function acceptsBooksFeature(value: unknown): value is BooksFeature {
  return record(value) && value.moduleId === 'books' && value.migrationVersion === 1 && Number.isSafeInteger(value.version) && Number(value.version) >= 0 && ['enabled', 'migratedExistingData', 'canRead', 'canWrite', 'canLookupMetadata', 'canRecover'].every(key => typeof value[key] === 'boolean');
}
export function canTransmitBook(pending: PendingBook, identity: string, verified: boolean, ready: boolean, feature: unknown): boolean {
  return ready && verified && pending.identity === identity && acceptsBooksFeature(feature) && feature.enabled && feature.canWrite;
}
export function confirmsPendingBook(proof: unknown, pending: PendingBook): boolean { return isValidBookRequestConfirmation(proof, pending); }
