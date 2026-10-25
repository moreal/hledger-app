import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { normalizeIsbn } from '../domain/src/books.ts';
import { print } from 'graphql';
import { parseDate, parseDateTime, parseDecimal, validateTags } from '../api-contract/validation.ts';
import { LedgerFeaturesDocument, SetBooksEnabledDocument, BookRequestStatusDocument, BookMetadataDocument, BooksDocument, PurchaseBookDocument, DisposeBookDocument, HealthDocument, AccountsDocument, AccountTransactionsDocument, TransactionsDocument, PricesDocument, CreateTransactionDocument, AssetsDocument, AssetBindingsDocument, SetAssetBindingDocument } from '../api-contract/generated/client/graphql.ts';
import type { PurchaseBookInput, DisposeBookInput, AccountsQueryVariables, AccountTransactionsQueryVariables, TransactionsQueryVariables, PricesQueryVariables, CreateTransactionInput, AssetsQueryVariables } from '../api-contract/generated/client/graphql.ts';
export type * from '../api-contract/generated/client/graphql.ts';

export interface GraphQLErrorInfo {
  message: string;
  path?: readonly (string | number)[];
  locations?: readonly { line: number; column: number }[];
  extensions?: Record<string, unknown>;
}
export interface GraphQLResult<T> { data?: T | null; errors?: GraphQLErrorInfo[] }
export class LedgerTransportError extends Error {
  constructor(message: string, readonly kind: 'network' | 'http' | 'protocol', readonly status?: number, options?: ErrorOptions) {
    super(message, options); this.name = 'LedgerTransportError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, minimum: number, maximum = Infinity): value is string { return typeof value === 'string' && [...value].length >= minimum && [...value].length <= maximum; }
function nullableText(value: unknown, maximum = Infinity): boolean { return value === null || text(value, 0, maximum); }

/** A successful write requires a complete queried transaction and same-key confirmation. */
export function isValidCreateConfirmation(value: unknown, key: string): boolean {
  if (!isRecord(value) || !Array.isArray(value.errors) || value.errors.length !== 0 || !isRecord(value.idempotency) || value.idempotency.key !== key || typeof value.idempotency.replayed !== 'boolean' || !isRecord(value.transaction)) return false;
  const transaction = value.transaction;
  if (!text(transaction.id, 1, 128) || !text(transaction.description, 1, 512) || !nullableText(transaction.code, 64) || !['UNMARKED', 'PENDING', 'CLEARED'].includes(String(transaction.status)) || !['APP', 'HLEDGER'].includes(String(transaction.source)) || !Array.isArray(transaction.tags) || validateTags(transaction.tags).length || !Array.isArray(transaction.postings) || transaction.postings.length < 2) return false;
  try {
    parseDate(transaction.date);
    if (transaction.createdAt !== null) parseDateTime(transaction.createdAt);
    for (const posting of transaction.postings) {
      if (!isRecord(posting) || !text(posting.accountName, 1) || !(posting.accountId === null || text(posting.accountId, 1, 128)) || !nullableText(posting.memo, 1000) || !isRecord(posting.amount) || !text(posting.amount.commodity, 1, 32)) return false;
      parseDecimal(posting.amount.value);
      if (posting.cost != null) {
        if (!isRecord(posting.cost) || !['UNIT', 'TOTAL'].includes(String(posting.cost.type)) || !isRecord(posting.cost.amount) || !text(posting.cost.amount.commodity, 1, 32)) return false;
        const cost = parseDecimal(posting.cost.amount.value);
        if (cost.startsWith('-') || !/[1-9]/.test(cost)) return false;
      }
    }
    return true;
  } catch { return false; }
}

/** Confirm a book write only with a complete typed copy and matching request key. */
export function isValidBookConfirmation(value: unknown, key: string): boolean {
  if (!isRecord(value) || !Array.isArray(value.errors) || value.errors.length || !isRecord(value.idempotency) || value.idempotency.key !== key || typeof value.idempotency.replayed !== 'boolean' || !isRecord(value.book)) return false;
  const book = value.book;
  if (!Array.isArray(book.authors) || book.authors.length > 20 || book.authors.some(author => !text(author, 1, 200)) || !nullableText(book.coverUrl) || !Object.hasOwn(book,'disposalDate') || !Object.hasOwn(book,'saleProceeds') || !Object.hasOwn(book,'realizedGain')) return false;
  if (!text(book.id, 20, 20) || !/^[a-f0-9]{20}$/.test(book.id) || book.commodity !== `asset:book:${book.id}` || !text(book.isbn, 13, 13) || !text(book.title, 1, 200) || !text(book.assetAccount, 1) || !['HELD','SOLD','DISCARDED'].includes(String(book.status))) return false;
  try {
    if (normalizeIsbn(book.isbn as string) !== book.isbn) return false;
    parseDate(book.purchaseDate);
    if (book.status === 'HELD' && (book.disposalDate !== null || book.saleProceeds !== null || book.realizedGain !== null)) return false;
    if (book.status !== 'HELD' && (book.disposalDate == null || book.realizedGain == null || book.saleProceeds == null)) return false;
    if (book.disposalDate != null) parseDate(book.disposalDate);
    for (const field of ['purchasePrice','saleProceeds','realizedGain']) {
      const amount = book[field];
      if (amount == null && field !== 'purchasePrice') continue;
      if (!isRecord(amount) || !text(amount.commodity, 1, 32)) return false;
      parseDecimal(amount.value);
    }
    return true;
  } catch { return false; }
}

export type BookRequest = { kind: 'purchase'; input: PurchaseBookInput } | { kind: 'dispose'; input: DisposeBookInput };
/** Read-only confirmation must describe the original request, never merely the same key. */
export function isValidBookRequestConfirmation(value: unknown, request: BookRequest): boolean {
  if (!isRecord(value) || value.status !== 'CONFIRMED' || !isRecord(value.idempotency) || value.idempotency.replayed !== true || !isValidBookConfirmation({ ...value, errors: [] }, request.input.idempotencyKey) || !isRecord(value.book)) return false;
  const book = value.book;
  try {
    if (request.kind === 'purchase') {
      const purchase = request.input;
      return book.isbn === normalizeIsbn(purchase.isbn) && book.title === purchase.title.trim() && book.purchaseDate === purchase.date &&
        book.assetAccount === purchase.assetAccount &&
        JSON.stringify(book.authors) === JSON.stringify((purchase.authors ?? []).map(author => author.trim())) &&
        book.coverUrl === (purchase.coverUrl ?? null) && isRecord(book.purchasePrice) &&
        book.purchasePrice.commodity === purchase.purchasePrice.commodity && subtractDecimals(String(book.purchasePrice.value), purchase.purchasePrice.value) === '0';
    }
    const disposal = request.input;
    if (book.id !== disposal.copyId || book.disposalDate !== disposal.date || book.status !== (disposal.kind === 'SELL' ? 'SOLD' : 'DISCARDED')) return false;
    if (!isRecord(book.saleProceeds) || !isRecord(book.purchasePrice) || !isRecord(book.realizedGain)) return false;
    const proceeds = disposal.kind === 'SELL' ? disposal.saleProceeds : {commodity:book.purchasePrice.commodity,value:'0'};
    return !!proceeds && book.saleProceeds.commodity === proceeds.commodity && subtractDecimals(String(book.saleProceeds.value), proceeds.value) === '0' &&
      book.realizedGain.commodity === book.purchasePrice.commodity && subtractDecimals(String(book.realizedGain.value), subtractDecimals(subtractDecimals(proceeds.value, disposal.fee ?? '0'), String(book.purchasePrice.value))) === '0';
  } catch { return false; }
}

export function createLedgerClient(options: { endpoint: string; token?: string; ledgerId?: string; timeoutMs?: number; fetch?: typeof fetch }) {
  const { endpoint: configuredEndpoint, token, ledgerId, fetch: configuredFetch, timeoutMs: configuredTimeout } = options;
  const url = new URL(configuredEndpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new TypeError('Expected an HTTP endpoint without credentials or fragment.');
  if (ledgerId !== undefined && (!ledgerId.length || ledgerId.length > 128 || /[\r\n]/.test(ledgerId))) throw new TypeError('Expected a ledger ID of 1–128 characters.');
  const endpoint = url.toString();
  const identity = ledgerId === undefined ? endpoint : `${endpoint}#ledger=${encodeURIComponent(ledgerId)}`;
  const timeoutMs = configuredTimeout ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Expected a positive request timeout.');
  const transport = configuredFetch ?? globalThis.fetch;
  async function execute<T, V>(document: TypedDocumentNode<T, V>, variables: V): Promise<GraphQLResult<T>> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new LedgerTransportError('The ledger request timed out. Its write outcome may be unknown.', 'network')); }, timeoutMs);
    });
    async function request(): Promise<GraphQLResult<T>> {
    let response: Response;
    try {
      response = await transport(endpoint, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', ...(ledgerId === undefined ? {} : { 'x-ledger-id': ledgerId }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ query: print(document), variables }) });
    } catch (cause) { throw new LedgerTransportError('The ledger request could not be completed. Its write outcome may be unknown.', 'network', undefined, { cause }); }
    if (!response.ok) throw new LedgerTransportError(`The ledger returned HTTP ${response.status}.`, 'http', response.status);
    let body: unknown;
    try { body = await response.json(); }
    catch (cause) { throw new LedgerTransportError('The ledger returned invalid JSON. Its write outcome may be unknown.', 'protocol', undefined, { cause }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new LedgerTransportError('Invalid GraphQL response.', 'protocol');
    const envelope = body as Record<string, unknown>;
    if ((!('data' in envelope) && !('errors' in envelope)) || ('data' in envelope && envelope.data !== null && (typeof envelope.data !== 'object' || Array.isArray(envelope.data))) || ('errors' in envelope && (!Array.isArray(envelope.errors) || envelope.errors.some(error => !error || typeof error !== 'object' || typeof error.message !== 'string')))) throw new LedgerTransportError('Invalid GraphQL response.', 'protocol');
    return body as GraphQLResult<T>;
    }
    try { return await Promise.race([request(), timeout]); }
    finally { clearTimeout(timer!); }
  }
  return Object.freeze({
    identity,
    health: () => execute(HealthDocument, {}),
    books: () => execute(BooksDocument, {}),
    ledgerFeatures: () => execute(LedgerFeaturesDocument, {}),
    setBooksEnabled: (enabled: boolean, expectedVersion: number, hasPending = false) => execute(SetBooksEnabledDocument, { enabled, expectedVersion, hasPending }),
    bookRequestStatus: async (request: BookRequest) => {
      const input = request.kind === 'purchase' ? { purchase: request.input } : { disposal: request.input };
      const result = await execute(BookRequestStatusDocument, { input });
      if (!result.errors?.length) {
        const status = result.data?.bookRequestStatus;
        if (!status || !['CONFIRMED','UNKNOWN'].includes(status.status) ||
          (status.status === 'CONFIRMED' && !isValidBookRequestConfirmation(status, request)) ||
          (status.status === 'UNKNOWN' && (status.book !== null || status.idempotency !== null))) {
          throw new LedgerTransportError('Book request outcome is unconfirmed.', 'protocol');
        }
      }
      return result;
    },
    bookMetadata: (isbn: string) => execute(BookMetadataDocument, { isbn }),
    purchaseBook: async (input: PurchaseBookInput) => {
      const result = await execute(PurchaseBookDocument, { input });
      const payload = result.data?.purchaseBook;
      if (!result.errors?.length && !payload?.errors?.length && !isValidBookConfirmation(payload, input.idempotencyKey)) throw new LedgerTransportError('Book purchase outcome is unconfirmed.', 'protocol');
      return result;
    },
    disposeBook: async (input: DisposeBookInput) => {
      const result = await execute(DisposeBookDocument, { input });
      const payload = result.data?.disposeBook;
      if (!result.errors?.length && !payload?.errors?.length && (!isValidBookConfirmation(payload, input.idempotencyKey) || payload?.book?.id !== input.copyId)) throw new LedgerTransportError('Book disposal outcome is unconfirmed.', 'protocol');
      return result;
    },
    assets: (variables: AssetsQueryVariables) => execute(AssetsDocument, variables),
    assetBindings: (commodities?: string[]) => execute(AssetBindingsDocument, { commodities }),
    setAssetBinding: (variables: { commodity: string; assetId: string | null }) => execute(SetAssetBindingDocument, variables),
    accounts: (variables: AccountsQueryVariables = {}) => {
      const asOf = variables.asOf !== undefined ? variables.asOf : variables.filter?.asOf;
      const includeSubaccounts = variables.includeSubaccounts !== undefined
        ? variables.includeSubaccounts
        : variables.filter?.includeSubaccounts !== undefined ? variables.filter.includeSubaccounts : false;
      return execute(AccountsDocument, {
        ...variables,
        asOf,
        includeSubaccounts,
        filter: { ...variables.filter, asOf, includeSubaccounts },
      });
    },
    accountTransactions: (variables: AccountTransactionsQueryVariables) => execute(AccountTransactionsDocument, variables),
    transactions: (variables: TransactionsQueryVariables = {}) => execute(TransactionsDocument, variables),
    prices: (variables: PricesQueryVariables = {}) => execute(PricesDocument, variables),
    createTransaction: async (input: CreateTransactionInput) => {
      const result = await execute(CreateTransactionDocument, { input });
      const payload = result.data?.createTransaction;
      if (payload != null && !result.errors?.length && (!Array.isArray(payload.errors) || payload.errors.length === 0) && !isValidCreateConfirmation(payload, input.idempotencyKey)) {
        throw new LedgerTransportError('The ledger returned an invalid save confirmation. Its write outcome may be unknown.', 'protocol');
      }
      return result;
    },
  });
}
export type LedgerClient = ReturnType<typeof createLedgerClient>;

function decimal(value: string) {
  if (typeof value !== 'string' || !/^-?[0-9]+(?:\.[0-9]+)?$/.test(value) || value.endsWith('\n')) throw new TypeError('Expected an exact decimal string.');
  const [whole, fraction = ''] = value.split('.');
  return { mantissa: BigInt(whole! + fraction), scale: fraction.length };
}
function combine(a: string, b: string, subtract: boolean): string {
  const left = decimal(a), right = decimal(b), scale = Math.max(left.scale, right.scale);
  const result = left.mantissa * 10n ** BigInt(scale - left.scale) + (subtract ? -1n : 1n) * right.mantissa * 10n ** BigInt(scale - right.scale);
  const sign = result < 0n ? '-' : '', digits = (result < 0n ? -result : result).toString().padStart(scale + 1, '0');
  if (!scale) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '');
}
export function addDecimals(a: string, b: string): string { return combine(a, b, false); }
export function subtractDecimals(a: string, b: string): string { return combine(a, b, true); }

export function previousDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.endsWith('\n') || value < '0001-01-02') throw new RangeError('Date has no supported previous day.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new RangeError('Expected a valid Gregorian date.');
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
/** Native runtimes without global Web Crypto must supply a cryptographically secure ID factory. */
export function newIdempotencyKey(factory?: () => string): string {
  let key: string;
  if (factory) key = factory();
  else if (globalThis.crypto?.randomUUID) key = globalThis.crypto.randomUUID();
  else if (globalThis.crypto?.getRandomValues) key = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
  else throw new Error('Secure entropy is unavailable; supply a native secure ID factory.');
  if (typeof key !== 'string' || !key.length || key.length > 128) throw new TypeError('Expected an idempotency key of 1–128 characters.');
  return key;
}

export type { OutboxMessage } from './outbox.ts';
