import { normalizeIsbn } from '../../packages/domain/src/books.ts';

export interface BookMetadata {
  isbn: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  coverSource: string | null;
  coverSourceUrl: string | null;
  sourceUrl: string;
  attribution: string;
}
export interface BookMetadataLookup {
  status: 'FOUND' | 'NOT_FOUND' | 'UNAVAILABLE';
  book: BookMetadata | null;
  message: string | null;
}

export { normalizeBookCoverUrl } from '../../packages/domain/src/book-cover-url.ts';
import { normalizeBookCoverUrl } from '../../packages/domain/src/book-cover-url.ts';
import { lookupBookCover } from './book-covers.ts';
import { lookupBookstoreCover } from './bookstore-covers.ts';
function sourceLink(value: unknown, fallback: URL): string {
  if (typeof value === 'string' && value.length <= 2048) {
    try {
      const url = new URL(value);
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        url.hostname === 'lod.nl.go.kr' &&
        !url.username &&
        !url.password &&
        !url.port &&
        /^\/resource\/[^/]+$/.test(url.pathname)
      ) {
        url.protocol = 'https:';
        url.hash = '';
        return url.href;
      }
    } catch {
      /* Fall back to the service endpoint that returned this record. */
    }
  }
  return fallback.href;
}
const unavailable = (): BookMetadataLookup => ({
  status: 'UNAVAILABLE',
  book: null,
  message: '책 정보를 불러오지 못했습니다. 직접 입력할 수 있습니다.',
});
const text = (value: unknown, limit: number): string | null =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= limit
    ? value.trim()
    : null;

export async function lookupBookMetadata(
  rawIsbn: string,
  options: {
    fetch?: typeof fetch;
    baseUrl?: string;
    timeoutMs?: number;
    coverFetch?: typeof fetch;
    bookstoreFetch?: typeof fetch;
    coverTimeoutMs?: number;
  } = {},
): Promise<BookMetadataLookup> {
  // Validate before constructing a URL or contacting the service.
  const isbn = normalizeIsbn(rawIsbn);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 4000);
  try {
    const base = new URL(
      options.baseUrl ?? process.env.HLEDGER_SEOJI_URL ?? 'http://localhost:8000',
    );
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password)
      return unavailable();
    const endpoint = new URL(`/api/v1/books/${isbn}`, base);
    const response = await (options.fetch ?? fetch)(endpoint, {
      signal: controller.signal,
      redirect: 'error',
      headers: { Accept: 'application/json' },
    });
    if (response.status === 404)
      return {
        status: 'NOT_FOUND',
        book: null,
        message: '검색된 책이 없습니다. 직접 입력해 주세요.',
      };
    if (!response.ok || !response.body) return unavailable();
    if (Number(response.headers.get('content-length')) > 1_048_576) {
      await response.body.cancel();
      return unavailable();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1_048_576) {
          await reader.cancel();
          return unavailable();
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    const title = text(data.title, 200);
    if (data.isbn13 !== isbn || !title) return unavailable();
    const authors = Array.isArray(data.contributors)
      ? [
          ...new Set(
            data.contributors.flatMap((entry: unknown) => {
              if (!entry || typeof entry !== 'object') return [];
              const contributor = entry as Record<string, unknown>;
              const name = text(contributor.name, 200);
              return contributor.role === 'author' && name ? [name] : [];
            }),
          ),
        ]
      : [];
    if (authors.length > 20) return unavailable();
    const suppliedCover = normalizeBookCoverUrl(data.cover_url);
    const officialCover =
      suppliedCover && ['nl.go.kr', 'www.nl.go.kr'].includes(new URL(suppliedCover).hostname)
        ? suppliedCover
        : null;
    // Parallel bounded lookups keep metadata + cover within the client's request budget.
    const alternatives = officialCover
      ? []
      : await Promise.all([
          lookupBookCover(isbn, {
            fetch: options.coverFetch ?? options.fetch,
            timeoutMs: options.coverTimeoutMs,
          }),
          lookupBookstoreCover(isbn, {
            fetch: options.bookstoreFetch ?? options.fetch,
            timeoutMs: options.coverTimeoutMs,
          }),
        ]);
    const fallback = alternatives.find((cover) => cover !== null);
    return {
      status: 'FOUND',
      message: null,
      book: {
        isbn,
        title,
        authors,
        coverUrl: officialCover ?? fallback?.coverUrl ?? null,
        coverSource: officialCover ? 'NATIONAL_LIBRARY' : (fallback?.coverSource ?? null),
        coverSourceUrl: officialCover
          ? 'https://www.nl.go.kr/'
          : (fallback?.coverSourceUrl ?? null),
        sourceUrl: sourceLink(
          data.links && typeof data.links === 'object'
            ? (data.links as Record<string, unknown>).nlk_lod
            : null,
          endpoint,
        ),
        attribution: text(data.attribution, 2000) ?? '서지 데이터 출처: 국립중앙도서관',
      },
    };
  } catch {
    return unavailable();
  } finally {
    clearTimeout(timer);
  }
}

export const safeBookCoverUrl = normalizeBookCoverUrl;
