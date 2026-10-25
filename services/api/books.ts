import { normalizeBookCoverUrl as safeBookCoverUrl } from '../../packages/domain/src/book-cover-url.ts';
import { createHash } from 'node:crypto';
import { normalizeIsbn, createBookCommodity } from '../../packages/domain/src/books.ts';
import {
  parseDate,
  parseDecimal,
  validateCreateTransactionInput,
} from '../../packages/api-contract/validation.ts';
import {
  LedgerError,
  type LedgerAdapter,
  type LedgerTransaction,
  type CreateTransactionInput,
} from './types.ts';

type Money = { commodity: string; value: string };
export interface PurchaseBookInput {
  idempotencyKey: string;
  date: string;
  isbn: string;
  title: string;
  authors?: string[] | null;
  coverUrl?: string | null;
  purchasePrice: Money;
  assetAccount: string;
  cashAccount: string;
}
export interface DisposeBookInput {
  idempotencyKey: string;
  date: string;
  copyId: string;
  kind: 'SELL' | 'DISCARD';
  cashAccount?: string | null;
  saleProceeds?: Money | null;
  fee?: string | null;
  gainAccount?: string | null;
  lossAccount?: string | null;
  feeAccount?: string | null;
}
export interface BookRecord {
  id: string;
  commodity: string;
  isbn: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  purchasePrice: Money;
  purchaseDate: string;
  status: 'HELD' | 'SOLD' | 'DISCARDED';
  disposalDate: string | null;
  saleProceeds: Money | null;
  realizedGain: Money | null;
  assetAccount: string;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const tags = (transaction: LedgerTransaction) =>
  Object.fromEntries(transaction.tags.map((tag) => [tag.key, tag.value]));
const invalid = (message: string): never => {
  throw new LedgerError('INVALID_INPUT', message);
};
function decimal(value: string, positive = false): string {
  try {
    parseDecimal(value);
  } catch {
    invalid('Enter a valid decimal amount.');
  }
  if (value.startsWith('-') || (positive && !/[1-9]/.test(value)))
    invalid(positive ? 'Purchase price must be positive.' : 'Amount cannot be negative.');
  return value;
}
function sum(...values: string[]): string {
  const scale = Math.max(...values.map((v) => v.split('.')[1]?.length ?? 0));
  const n = values.reduce((a, v) => {
    const [i, f = ''] = v.replace(/^-/, '').split('.');
    return a + BigInt(i + f.padEnd(scale, '0')) * (v.startsWith('-') ? -1n : 1n);
  }, 0n);
  const s = (n < 0 ? -n : n).toString().padStart(scale + 1, '0');
  return `${n < 0 ? '-' : ''}${scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s}`;
}
const neg = (value: string) => (value.startsWith('-') ? value.slice(1) : `-${value}`);
function validateInput(input: CreateTransactionInput) {
  const issues = validateCreateTransactionInput(input);
  if (issues.length) throw new LedgerError(issues[0]!.code, issues[0]!.message, issues[0]!.path);
}
function normalizeAuthors(value: unknown): string[] {
  if (value == null) return [];
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some((name) => typeof name !== 'string' || !name.trim() || name.length > 200)
  )
    return invalid('Authors must contain at most 20 nonempty names of up to 200 characters.');
  return value.map((name) => name.trim());
}
/** Provider results may omit an unsafe image; explicitly supplied purchase metadata must reject it. */
function normalizeBookCoverUrl(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || /[\p{Cc}\p{Cs}]/u.test(value))
    return invalid('Cover URL must be a safe supported HTTPS URL.');
  const normalized = safeBookCoverUrl(value);
  if (!normalized) return invalid('Cover URL must be a safe supported HTTPS URL.');
  return normalized;
}
function decodeMetadata(value: string): string {
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  if (!value || Buffer.from(decoded).toString('base64url') !== value)
    throw new Error('Invalid metadata encoding.');
  return decoded;
}
function checkKey(key: string) {
  if (!key?.trim() || key.length > 128) invalid('A request key of 1–128 characters is required.');
}
export function booksFromTransactions(transactions: LedgerTransaction[]): BookRecord[] {
  const result: BookRecord[] = [];
  const purchases = new Set<string>();
  for (const transaction of transactions) {
    const metadata = tags(transaction);
    for (const posting of transaction.postings) {
      const commodity = posting.amount.commodity;
      if (commodity.startsWith('asset:book:')) {
        try {
          if (posting.cost) decimal(posting.cost.amount.value, true);
        } catch {
          throw new LedgerError(
            'BOOK_METADATA_INVALID',
            'A managed book posting has an invalid cost.',
          );
        }
      }
      if (
        posting.cost?.amount.commodity.startsWith('asset:book:') ||
        (commodity.startsWith('asset:book:') &&
          (transaction.source !== 'APP' ||
            !['PURCHASE', 'SELL', 'DISCARD'].includes(metadata['book.action']!) ||
            commodity !== `asset:book:${metadata['book.copy']}`))
      )
        throw new LedgerError(
          'BOOK_METADATA_INVALID',
          'A managed book commodity has an unmanaged ledger posting.',
        );
    }
  }
  for (const tx of transactions) {
    const t = tags(tx);
    if (tx.source !== 'APP' || t['book.action'] !== 'PURCHASE') continue;
    if (!/^[a-f0-9]{20}$/.test(t['book.copy'] ?? ''))
      throw new LedgerError(
        'BOOK_METADATA_INVALID',
        'A managed book record has an invalid copy ID.',
      );
    if (purchases.has(t['book.copy']!))
      throw new LedgerError('BOOK_METADATA_INVALID', 'A book copy has duplicate purchase records.');
    purchases.add(t['book.copy']!);
    let authors: string[] = [];
    let coverUrl: string | null = null;
    const posting = tx.postings.find(
      (p) => p.amount.commodity === createBookCommodity(t['book.copy']!),
    );
    try {
      if (
        !posting?.cost ||
        posting.amount.value !== '1' ||
        posting.cost.type !== 'UNIT' ||
        tx.postings.length !== 2 ||
        tx.postings.filter((p) => p.amount.commodity === posting.amount.commodity).length !== 1
      )
        throw new Error();
      decimal(posting.cost.amount.value, true);
      const cash = tx.postings.find((p) => p !== posting)!;
      if (
        cash.amount.commodity !== posting.cost.amount.commodity ||
        cash.cost ||
        /[1-9]/.test(sum(cash.amount.value, posting.cost.amount.value))
      )
        throw new Error();
      if (normalizeIsbn(t['book.isbn']!) !== t['book.isbn']) throw new Error();
      if ('book.authors' in t) {
        const parsed: unknown = JSON.parse(decodeMetadata(t['book.authors']!));
        if (!Array.isArray(parsed)) throw new Error('Invalid stored authors.');
        authors = normalizeAuthors(parsed);
      }
      if ('book.cover' in t) {
        coverUrl = normalizeBookCoverUrl(decodeMetadata(t['book.cover']!));
        if (!coverUrl) throw new Error('Invalid stored cover URL.');
      }
      const title = t['book.title'];
      if (
        !title ||
        Buffer.from(Buffer.from(title, 'base64url').toString('utf8')).toString('base64url') !==
          title ||
        !Buffer.from(title, 'base64url').toString('utf8').trim()
      )
        throw new Error();
    } catch {
      throw new LedgerError(
        'BOOK_METADATA_INVALID',
        'A managed book purchase record is malformed.',
      );
    }
    if (!posting?.cost)
      throw new LedgerError('BOOK_METADATA_INVALID', 'Missing book purchase cost.');
    const disposal = transactions.find((d) => {
      const dt = tags(d);
      return (
        d.source === 'APP' &&
        dt['book.copy'] === t['book.copy'] &&
        ['SELL', 'DISCARD'].includes(dt['book.action']!)
      );
    });
    const dt = disposal ? tags(disposal) : {};
    if (disposal) {
      try {
        decimal(dt['book.proceeds']!);
        parseDecimal(dt['book.gain']!);
        const monetary = disposal.postings.filter(
          (p) => p.amount.commodity !== posting.amount.commodity,
        );
        if (
          !monetary.length ||
          monetary.some((p) => p.amount.commodity !== posting.cost!.amount.commodity || p.cost)
        )
          throw new Error();
        if (dt['book.action'] === 'DISCARD') {
          if (
            monetary.length !== 1 ||
            /[1-9]/.test(dt['book.proceeds']!) ||
            /[1-9]/.test(sum(monetary[0]!.amount.value, neg(posting.cost.amount.value))) ||
            /[1-9]/.test(sum(dt['book.gain']!, posting.cost.amount.value))
          )
            throw new Error();
        } else {
          const cash = monetary[0]!.amount.value;
          parseDecimal(cash);
          const fee = sum(dt['book.proceeds']!, neg(cash));
          decimal(fee);
          const grossGain = sum(dt['book.proceeds']!, neg(posting.cost.amount.value));
          const expected = [
            cash,
            ...(/[1-9]/.test(fee) ? [fee] : []),
            ...(/[1-9]/.test(grossGain) ? [neg(grossGain)] : []),
          ];
          if (
            monetary.length !== expected.length ||
            monetary.some((p, i) => /[1-9]/.test(sum(p.amount.value, neg(expected[i]!)))) ||
            /[1-9]/.test(sum(dt['book.gain']!, neg(cash), posting.cost.amount.value))
          )
            throw new Error();
        }
      } catch {
        throw new LedgerError(
          'BOOK_METADATA_INVALID',
          'Book disposal money metadata does not match its ledger postings.',
        );
      }
      if (
        transactions.filter(
          (d) =>
            d.source === 'APP' &&
            tags(d)['book.copy'] === t['book.copy'] &&
            ['SELL', 'DISCARD'].includes(tags(d)['book.action']!),
        ).length !== 1
      )
        throw new LedgerError(
          'BOOK_METADATA_INVALID',
          'A book copy has multiple disposal records.',
        );
      const reductions = disposal.postings.filter(
        (p) => p.amount.commodity === posting.amount.commodity,
      );
      if (
        reductions.length !== 1 ||
        reductions[0]!.amount.value !== '-1' ||
        reductions[0]!.accountName !== posting.accountName ||
        reductions[0]!.cost?.type !== 'UNIT' ||
        reductions[0]!.cost.amount.commodity !== posting.cost.amount.commodity ||
        /[1-9]/.test(sum(reductions[0]!.cost.amount.value, neg(posting.cost.amount.value))) ||
        disposal.date < tx.date
      )
        throw new LedgerError(
          'BOOK_METADATA_INVALID',
          'A managed book disposal record is malformed.',
        );
    }
    result.push({
      id: t['book.copy']!,
      commodity: posting.amount.commodity,
      isbn: t['book.isbn']!,
      title: Buffer.from(t['book.title']!, 'base64url').toString('utf8'),
      authors,
      coverUrl,
      purchasePrice: posting.cost.amount,
      purchaseDate: tx.date,
      assetAccount: posting.accountName,
      status: disposal ? (dt['book.action'] === 'SELL' ? 'SOLD' : 'DISCARDED') : 'HELD',
      disposalDate: disposal?.date ?? null,
      saleProceeds: dt['book.proceeds']
        ? { commodity: posting.cost.amount.commodity, value: dt['book.proceeds'] }
        : null,
      realizedGain: dt['book.gain']
        ? { commodity: posting.cost.amount.commodity, value: dt['book.gain'] }
        : null,
    });
  }
  for (const tx of transactions)
    if (
      tx.source === 'APP' &&
      ['SELL', 'DISCARD'].includes(tags(tx)['book.action']!) &&
      !purchases.has(tags(tx)['book.copy']!)
    )
      throw new LedgerError('BOOK_METADATA_INVALID', 'A book disposal has no purchase record.');
  return result.sort(
    (a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || a.id.localeCompare(b.id),
  );
}
function purchaseWrite(input: PurchaseBookInput): { id: string; write: CreateTransactionInput } {
  checkKey(input.idempotencyKey);
  parseDate(input.date);
  let isbn: string;
  try {
    isbn = normalizeIsbn(input.isbn);
  } catch (error) {
    return invalid((error as Error).message);
  }
  if (!input.title.trim() || input.title.length > 200)
    invalid('Title must contain 1–200 characters.');
  const authors = normalizeAuthors(input.authors);
  const coverUrl = normalizeBookCoverUrl(input.coverUrl);
  decimal(input.purchasePrice.value, true);
  if (input.purchasePrice.commodity.startsWith('asset:book:'))
    invalid('A book purchase price must use a settlement currency.');
  const id = hash(`book:${input.idempotencyKey}`).slice(0, 20),
    commodity = createBookCommodity(id);
  const write: CreateTransactionInput = {
    idempotencyKey: `book-buy:${hash(input.idempotencyKey)}`,
    date: input.date,
    description: 'Book purchase',
    tags: Object.entries({
      'book.action': 'PURCHASE',
      'book.copy': id,
      'book.isbn': isbn,
      'book.title': Buffer.from(input.title.trim()).toString('base64url'),
      ...(authors.length
        ? { 'book.authors': Buffer.from(JSON.stringify(authors)).toString('base64url') }
        : {}),
      ...(coverUrl ? { 'book.cover': Buffer.from(coverUrl).toString('base64url') } : {}),
    }).map(([key, value]) => ({ key, value })),
    postings: [
      {
        accountName: input.assetAccount,
        amount: { commodity, value: '1' },
        cost: { type: 'UNIT', amount: input.purchasePrice },
      },
      {
        accountName: input.cashAccount,
        amount: { commodity: input.purchasePrice.commodity, value: neg(input.purchasePrice.value) },
      },
    ],
  };
  validateInput(write);
  return { id, write };
}
export async function purchaseBook(adapter: LedgerAdapter, input: PurchaseBookInput) {
  const { id, write } = purchaseWrite(input);
  const result = await adapter.create(write);
  return {
    book: booksFromTransactions(
      result.replayed ? (await adapter.read()).transactions : [result.transaction],
    ).find((b) => b.id === id)!,
    idempotency: { key: input.idempotencyKey, replayed: result.replayed },
    errors: [],
  };
}
export async function disposeBook(adapter: LedgerAdapter, input: DisposeBookInput) {
  checkKey(input.idempotencyKey);
  parseDate(input.date);
  const snapshot = await adapter.read();
  const book = booksFromTransactions(snapshot.transactions).find((b) => b.id === input.copyId);
  if (!book) throw new LedgerError('NOT_FOUND', 'Book copy was not found.');
  const write = disposalWrite(input, book);
  const result = await adapter.create(write);
  return {
    book: booksFromTransactions([
      ...snapshot.transactions.filter((t) => tags(t)['book.action'] === 'PURCHASE'),
      result.transaction,
    ]).find((b) => b.id === book.id)!,
    idempotency: { key: input.idempotencyKey, replayed: result.replayed },
    errors: [],
  };
}
function disposalWrite(input: DisposeBookInput, book: BookRecord): CreateTransactionInput {
  checkKey(input.idempotencyKey);
  parseDate(input.date);
  if (input.date < book.purchaseDate) invalid('Disposal date cannot precede purchase date.');
  if (!['SELL', 'DISCARD'].includes(input.kind)) invalid('Choose sell or discard.');
  const currency = book.purchasePrice.commodity;
  const fee = decimal(input.fee ?? '0');
  if (input.kind === 'DISCARD' && (input.saleProceeds || /[1-9]/.test(fee)))
    invalid('Discard cannot have proceeds or fees.');
  const proceeds = input.kind === 'SELL' ? input.saleProceeds : { commodity: currency, value: '0' };
  if (!proceeds || proceeds.commodity !== currency)
    throw new LedgerError('INVALID_INPUT', 'Sale currency must match the purchase currency.');
  decimal(proceeds.value);
  const gain = sum(proceeds.value, neg(book.purchasePrice.value), neg(fee));
  const postings: CreateTransactionInput['postings'] = [
    {
      accountName: book.assetAccount,
      amount: { commodity: book.commodity, value: '-1' },
      cost: { type: 'UNIT', amount: book.purchasePrice },
    },
  ];
  if (input.kind === 'SELL') {
    postings.push({
      accountName: input.cashAccount ?? '',
      amount: { commodity: currency, value: sum(proceeds.value, neg(fee)) },
    });
    if (/[1-9]/.test(fee))
      postings.push({
        accountName: input.feeAccount ?? 'expenses:books:fees',
        amount: { commodity: currency, value: fee },
      });
    const grossGain = sum(proceeds.value, neg(book.purchasePrice.value));
    if (/[1-9]/.test(grossGain))
      postings.push({
        accountName: grossGain.startsWith('-')
          ? (input.lossAccount ?? 'expenses:books:loss')
          : (input.gainAccount ?? 'income:books:gain'),
        amount: { commodity: currency, value: neg(grossGain) },
      });
  } else
    postings.push({
      accountName: input.lossAccount ?? 'expenses:books:loss',
      amount: book.purchasePrice,
    });
  // Every writer competes for one durable adapter key per copy; retries still fingerprint the caller key.
  const write: CreateTransactionInput = {
    idempotencyKey: `book-dispose:${book.id}`,
    date: input.date,
    description: input.kind === 'SELL' ? 'Book sale' : 'Book discard',
    tags: Object.entries({
      'book.action': input.kind,
      'book.copy': book.id,
      'book.request': hash(input.idempotencyKey),
      'book.fingerprint': hash(
        JSON.stringify({
          key: input.idempotencyKey,
          date: input.date,
          copyId: input.copyId,
          kind: input.kind,
          cashAccount: input.cashAccount ?? null,
          saleProceeds: proceeds,
          fee,
          gainAccount: input.gainAccount ?? null,
          lossAccount: input.lossAccount ?? null,
          feeAccount: input.feeAccount ?? null,
        }),
      ),
      'book.proceeds': proceeds.value,
      'book.gain': gain,
    }).map(([key, value]) => ({ key, value })),
    postings,
  };
  validateInput(write);
  return write;
}

export type BookRequest =
  | { kind: 'purchase'; input: PurchaseBookInput }
  | { kind: 'dispose'; input: DisposeBookInput };
export type BookRequestProof = {
  status: 'CONFIRMED' | 'UNKNOWN';
  book: BookRecord | null;
  idempotency: { key: string; replayed: true } | null;
};
/** Absence of evidence never means the original request was not saved. */
export async function proveBookRequest(
  adapter: LedgerAdapter,
  request: BookRequest,
): Promise<BookRequestProof> {
  const unknown: BookRequestProof = { status: 'UNKNOWN', book: null, idempotency: null };
  if (!adapter.inspectReadOnly) return unknown;
  try {
    const snapshot = await adapter.inspectReadOnly();
    const books = booksFromTransactions(snapshot.transactions);
    const prepared = request.kind === 'purchase' ? purchaseWrite(request.input) : null;
    const book = books.find(
      (book) => book.id === (prepared?.id ?? (request.input as DisposeBookInput).copyId),
    );
    if (!book) return unknown;
    const write =
      prepared?.write ??
      disposalWrite((request as Extract<BookRequest, { kind: 'dispose' }>).input, book);
    const matches = snapshot.transactions.filter(
      (transaction) =>
        transaction.source === 'APP' && transaction.id === `app_${hash(write.idempotencyKey)}`,
    );
    if (matches.length !== 1) return unknown;
    const transaction = matches[0]!;
    // Compare the entire expected durable transaction, including the caller-key
    // fingerprint on disposals and every optional piece of purchase metadata.
    const postingEvidence = (
      postings: CreateTransactionInput['postings'] | LedgerTransaction['postings'],
    ) =>
      postings.map((posting) => ({
        accountName: posting.accountName,
        amount: posting.amount,
        memo: posting.memo ?? null,
        cost: posting.cost ?? null,
      }));
    if (
      transaction.date !== write.date ||
      transaction.description !== write.description ||
      transaction.code !== (write.code ?? null) ||
      transaction.status !== 'UNMARKED' ||
      JSON.stringify(transaction.tags) !== JSON.stringify(write.tags ?? []) ||
      JSON.stringify(postingEvidence(transaction.postings)) !==
        JSON.stringify(postingEvidence(write.postings))
    )
      return unknown;
    return {
      status: 'CONFIRMED',
      book,
      idempotency: { key: request.input.idempotencyKey, replayed: true },
    };
  } catch {
    return unknown;
  }
}
