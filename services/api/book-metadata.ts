import { normalizeIsbn } from '../../packages/domain/src/books.ts';
import type { BookMetadataLookup } from './seoji.ts';
import { createOpenLibraryLookup, lookupOpenLibraryMetadata } from './open-library.ts';
import { lookupBookCover } from './book-covers.ts';
const configuredLookups = new Map<string, ReturnType<typeof createOpenLibraryLookup>>();
export interface BookMetadataOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  coverFetch?: typeof fetch;
  bookstoreFetch?: typeof fetch;
  coverTimeoutMs?: number;
  userAgent?: string;
}
/** Key-free exact-edition metadata first; SeoJi is optional and must be explicitly configured. */
export async function lookupBookMetadata(
  rawIsbn: string,
  options: BookMetadataOptions = {},
): Promise<BookMetadataLookup> {
  const isbn = normalizeIsbn(rawIsbn);
  // Injected transports have their own cache/budget, avoiding cross-test/caller poisoning.
  let lookup = lookupOpenLibraryMetadata;
  if (options.fetch)
    lookup = createOpenLibraryLookup({
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      userAgent: options.userAgent,
    });
  else if (options.timeoutMs !== undefined || options.userAgent !== undefined) {
    const key = JSON.stringify([options.timeoutMs, options.userAgent]);
    lookup =
      configuredLookups.get(key) ??
      createOpenLibraryLookup({ timeoutMs: options.timeoutMs, userAgent: options.userAgent });
    if (configuredLookups.size < 16) configuredLookups.set(key, lookup);
  }
  const result = await lookup(isbn);
  if (result.status === 'FOUND' && result.book) {
    const cover = await lookupBookCover(isbn, {
      coverId: result.coverId,
      fetch: options.coverFetch ?? options.fetch,
      timeoutMs: options.coverTimeoutMs,
    });
    return {
      status: 'FOUND',
      message: null,
      book: {
        ...result.book,
        coverUrl: cover?.coverUrl ?? null,
        coverSource: cover?.coverSource ?? null,
        coverSourceUrl: cover?.coverSourceUrl ?? null,
      },
    };
  }
  const baseUrl = options.baseUrl ?? process.env.HLEDGER_SEOJI_URL;
  if (baseUrl?.trim()) {
    const { lookupBookMetadata: lookupSeoji } = await import('./seoji.ts');
    const fallback = await lookupSeoji(isbn, { ...options, baseUrl });
    if (fallback.status === 'FOUND') return fallback;
    if (result.status === 'UNAVAILABLE' || fallback.status === 'UNAVAILABLE')
      return {
        status: 'UNAVAILABLE',
        book: null,
        message: '책 정보를 불러오지 못했습니다. 직접 입력할 수 있습니다.',
      };
  }
  return { status: result.status, book: null, message: result.message };
}
