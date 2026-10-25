import { normalizeIsbn } from '../../packages/domain/src/books.ts';
import type { BookMetadataLookup } from './seoji.ts';
export interface OpenLibraryResult extends BookMetadataLookup {
  coverId?: string;
}
export interface OpenLibraryOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
  now?: () => number;
}
const unavailable = (): OpenLibraryResult => ({
  status: 'UNAVAILABLE',
  book: null,
  message: '책 정보를 불러오지 못했습니다. 직접 입력할 수 있습니다.',
});
const missing = (): OpenLibraryResult => ({
  status: 'NOT_FOUND',
  book: null,
  message: '검색된 책이 없습니다. 직접 입력해 주세요.',
});
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown, limit: number): string | null =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= limit
    ? value.trim()
    : null;
function coverId(value: unknown): string | undefined {
  const covers = object(value);
  if (!covers) return;
  for (const candidate of [covers.large, covers.medium, covers.small]) {
    if (typeof candidate !== 'string') continue;
    try {
      const u = new URL(candidate);
      const match = /^\/b\/id\/([1-9]\d{0,14})-[SML]\.jpg$/.exec(u.pathname);
      if (
        u.origin === 'https://covers.openlibrary.org' &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        match
      )
        return match[1];
    } catch {}
  }
}
let lastNetworkRequest = -Infinity;
/** Fixed-origin exact ISBN lookup. Per-process budget must be aggregated outside multi-process deployments. */
export function createOpenLibraryLookup(options: OpenLibraryOptions = {}) {
  const cache = new Map<string, { expires: number; result: OpenLibraryResult }>();
  const pending = new Map<string, Promise<OpenLibraryResult>>();
  let lastRequest = -Infinity;
  const now = options.now ?? Date.now;
  async function request(isbn: string): Promise<OpenLibraryResult> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operation = async (): Promise<OpenLibraryResult> => {
      try {
        const endpoint = new URL('https://openlibrary.org/api/books');
        endpoint.search = new URLSearchParams({
          bibkeys: `ISBN:${isbn}`,
          jscmd: 'data',
          format: 'json',
        }).toString();
        const configured = options.userAgent ?? process.env.HLEDGER_OPEN_LIBRARY_USER_AGENT;
        const userAgent =
          configured && configured.length <= 256 && !/[\r\n]/.test(configured)
            ? configured
            : 'hledger-app/0.1';
        const response = await (options.fetch ?? fetch)(endpoint, {
          signal: controller.signal,
          redirect: 'error',
          headers: { Accept: 'application/json', 'User-Agent': userAgent },
        });
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          return unavailable();
        }
        if (Number(response.headers.get('content-length')) > 1_048_576) {
          await response.body.cancel();
          return unavailable();
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
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
        if (controller.signal.aborted) return unavailable();
        const data = object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        if (!data) return unavailable();
        const key = `ISBN:${isbn}`;
        if (!(key in data)) return missing();
        const record = object(data[key]);
        if (!record) return unavailable();
        const title = text(record.title, 200);
        const edition =
          typeof record.key === 'string' && /^\/books\/OL[1-9]\d*M$/.test(record.key)
            ? record.key
            : null;
        const ids = object(record.identifiers);
        const candidates = [
          ...(Array.isArray(ids?.isbn_10) ? ids.isbn_10 : []),
          ...(Array.isArray(ids?.isbn_13) ? ids.isbn_13 : []),
        ];
        const matches = candidates.some((value) => {
          try {
            return typeof value === 'string' && normalizeIsbn(value) === isbn;
          } catch {
            return false;
          }
        });
        if (!title || !edition || !matches) return unavailable();
        if (
          record.authors !== undefined &&
          (!Array.isArray(record.authors) || record.authors.length > 20)
        )
          return unavailable();
        const authors: string[] = [];
        for (const author of (record.authors ?? []) as unknown[]) {
          const name = text(object(author)?.name, 200);
          if (!name) return unavailable();
          authors.push(name);
        }
        return {
          status: 'FOUND',
          message: null,
          coverId: coverId(record.cover),
          book: {
            isbn,
            title,
            authors: [...new Set(authors)],
            coverUrl: null,
            coverSource: null,
            coverSourceUrl: null,
            sourceUrl: `https://openlibrary.org${edition}`,
            attribution: '서지 데이터 출처: Open Library',
          },
        };
      } catch {
        return unavailable();
      }
    };
    try {
      return await Promise.race([
        operation(),
        new Promise<OpenLibraryResult>((resolve) => {
          timer = setTimeout(
            () => {
              controller.abort();
              resolve(unavailable());
            },
            Math.max(1, Math.min(options.timeoutMs ?? 4000, 10000)),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  return async (rawIsbn: string): Promise<OpenLibraryResult> => {
    const isbn = normalizeIsbn(rawIsbn);
    const cached = cache.get(isbn);
    if (cached && cached.expires > now()) return structuredClone(cached.result);
    const existing = pending.get(isbn);
    if (existing) return structuredClone(await existing);
    const last = options.fetch ? lastRequest : lastNetworkRequest;
    if (now() - last < 1000) return unavailable();
    lastRequest = now();
    if (!options.fetch) lastNetworkRequest = lastRequest;
    const promise = request(isbn)
      .then((result) => {
        if (cache.size >= 500) cache.delete(cache.keys().next().value!);
        cache.set(isbn, {
          result,
          expires:
            now() +
            (result.status === 'FOUND'
              ? 86_400_000
              : result.status === 'NOT_FOUND'
                ? 300_000
                : 5000),
        });
        return result;
      })
      .finally(() => pending.delete(isbn));
    pending.set(isbn, promise);
    return structuredClone(await promise);
  };
}
export const lookupOpenLibraryMetadata = createOpenLibraryLookup();
