import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupBookMetadata, safeBookCoverUrl } from './seoji.ts';
import { executeLedgerRequest } from './schema.ts';
import { createMemoryFeatureSettingsStore } from './feature-settings.ts';
const data = {
  isbn13: '9788936434267',
  title: '아몬드',
  contributors: [
    { name: '손원평', role: 'author' },
    { name: '편집자', role: 'editor' },
  ],
  cover_url: null,
  attribution: '국립중앙도서관',
};
const mock =
  (body: unknown, status = 200): typeof fetch =>
  async () =>
    new Response(JSON.stringify(body), { status });
test('Seoji lookup normalizes ISBN and maps a partial result without inventing cover art', async () => {
  const result = await lookupBookMetadata('978-89-364-3426-7', {
    fetch: async (url, init) => {
      assert.equal(String(url), 'http://localhost:8000/api/v1/books/9788936434267');
      assert.equal(init?.redirect, 'error');
      return new Response(JSON.stringify(data));
    },
  });
  assert.equal(result.status, 'FOUND');
  assert.equal(result.book?.title, '아몬드');
  assert.deepEqual(result.book?.authors, ['손원평']);
  assert.equal(result.book?.coverUrl, null);
});
test('invalid ISBN never contacts Seoji', async () => {
  await assert.rejects(
    lookupBookMetadata('invalid', {
      fetch: async () => {
        throw new Error('must not fetch');
      },
    }),
  );
});
test('missing, broken, oversized, mismatched and timed-out responses allow manual entry', async () => {
  assert.equal(
    (await lookupBookMetadata(data.isbn13, { fetch: mock({}, 404) })).status,
    'NOT_FOUND',
  );
  for (const fetcher of [
    mock({}, 500),
    mock({ ...data, isbn13: '9780306406157' }),
    mock('x'.repeat(1_048_577)),
    async () => {
      throw new Error('offline');
    },
  ] as (typeof fetch)[])
    assert.equal((await lookupBookMetadata(data.isbn13, { fetch: fetcher })).status, 'UNAVAILABLE');
  const timeoutFetch: typeof fetch = async (_url, init) =>
    new Promise((_resolve, reject) =>
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
    );
  assert.equal(
    (await lookupBookMetadata(data.isbn13, { fetch: timeoutFetch, timeoutMs: 5 })).status,
    'UNAVAILABLE',
  );
});
test('covers accept only HTTPS National Library hosts', () => {
  assert.equal(
    safeBookCoverUrl('https://www.nl.go.kr/cover.jpg'),
    'https://www.nl.go.kr/cover.jpg',
  );
  for (const url of [
    'http://www.nl.go.kr/x',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://10.0.0.1/x',
    'https://www.nl.go.kr.evil.test/x',
    'https://user@www.nl.go.kr/x',
    'https://www.nl.go.kr:8443/x',
  ])
    assert.equal(safeBookCoverUrl(url), null);
});
test('metadata query requires authorization before lookup and invalid ISBN reports INVALID_INPUT', async () => {
  const adapter = {
    read: async () => {
      throw new Error('unexpected read');
    },
    create: async () => {
      throw new Error('unexpected write');
    },
  };
  const query = '{ bookMetadata(isbn:"invalid") { status } }';
  assert.equal(
    (await executeLedgerRequest({ adapter, query, authorized: false })).errors?.[0]?.extensions
      .code,
    'UNAUTHENTICATED',
  );
  assert.equal(
    (await executeLedgerRequest({ adapter, query, authorized: true })).errors?.[0]?.extensions.code,
    'FEATURE_DISABLED',
  );
  assert.equal(
    (
      await executeLedgerRequest({
        adapter,
        query,
        authorized: true,
        featureSettings: createMemoryFeatureSettingsStore({ enabled: true }),
      })
    ).errors?.[0]?.extensions.code,
    'INVALID_INPUT',
  );
});

test('lookup rejects metadata beyond purchase limits without truncating bibliography', async () => {
  for (const record of [
    { ...data, title: 'a'.repeat(201) },
    {
      ...data,
      contributors: Array.from({ length: 21 }, (_, i) => ({ name: `Author ${i}`, role: 'author' })),
    },
  ])
    assert.equal(
      (await lookupBookMetadata(data.isbn13, { fetch: mock(record) })).status,
      'UNAVAILABLE',
    );
});
test('source provenance uses returned official LOD links or the actual service endpoint', async () => {
  const lookup = async (links: unknown) =>
    (await lookupBookMetadata(data.isbn13, { fetch: mock({ ...data, links }) })).book?.sourceUrl;
  assert.equal(
    await lookup({ nlk_lod: 'http://lod.nl.go.kr/resource/KMO123' }),
    'https://lod.nl.go.kr/resource/KMO123',
  );
  assert.equal(
    await lookup({ nlk_lod: 'https://evil.example/resource/123' }),
    'http://localhost:8000/api/v1/books/9788936434267',
  );
});

test('fills only missing covers and keeps metadata provenance separate', async () => {
  const { default: sharp } = await import('sharp');
  const bytes = await sharp({
    create: { width: 100, height: 160, channels: 3, background: '#357' },
  })
    .jpeg()
    .toBuffer();
  let coverCalls = 0;
  const coverFetch: typeof fetch = async () => {
    coverCalls++;
    return new Response(bytes, { headers: { 'content-type': 'image/jpeg' } });
  };
  const result = await lookupBookMetadata(data.isbn13, { fetch: mock(data), coverFetch });
  assert.equal(result.book?.coverSource, 'OPEN_LIBRARY');
  assert.equal(result.book?.coverSourceUrl, `https://openlibrary.org/isbn/${data.isbn13}`);
  assert.equal(result.book?.sourceUrl, `http://localhost:8000/api/v1/books/${data.isbn13}`);
  assert.equal(coverCalls, 1);
  const official = await lookupBookMetadata(data.isbn13, {
    fetch: mock({ ...data, cover_url: 'https://www.nl.go.kr/cover.jpg' }),
    coverFetch,
  });
  assert.equal(official.book?.coverSource, 'NATIONAL_LIBRARY');
  assert.equal(coverCalls, 1);
  for (const response of [mock({}, 404), mock({}, 500), mock({ ...data, isbn13: '9780306406157' })])
    await lookupBookMetadata(data.isbn13, { fetch: response, coverFetch });
  assert.equal(coverCalls, 1);
});

test('saved YES24 covers accept only the verified image route', () => {
  assert.equal(
    safeBookCoverUrl('https://image.yes24.com/goods/108422348/xl'),
    'https://image.yes24.com/goods/108422348/xl',
  );
  for (const url of [
    'http://image.yes24.com/goods/108422348/xl',
    'https://image.yes24.com/goods/108422348/xl?q=x',
    'https://image.yes24.com/goods/108422348/xl#x',
    'https://image.yes24.com.evil.test/goods/108422348/xl',
    'https://image.yes24.com/other.jpg',
  ])
    assert.equal(safeBookCoverUrl(url), null);
});

test('verified bookstore cover fills missing Open Library cover without changing seoji metadata', async () => {
  const { default: sharp } = await import('sharp');
  const bytes = await sharp({
    create: { width: 100, height: 160, channels: 3, background: '#357' },
  })
    .jpeg()
    .toBuffer();
  const bookstoreFetch: typeof fetch = async (url) => {
    const path = String(url);
    if (path.includes('/Product/Search?'))
      return new Response('<a class="gd_name" href="/product/goods/123">Book</a>', {
        headers: { 'content-type': 'text/html' },
      });
    if (path.includes('/Product/Goods/'))
      return new Response(
        `<script type="application/ld+json">${JSON.stringify({ '@type': 'Book', isbn: data.isbn13, image: { url: 'https://image.yes24.com/goods/123/xl' } })}</script>`,
        { headers: { 'content-type': 'text/html' } },
      );
    return new Response(bytes, { headers: { 'content-type': 'image/jpeg' } });
  };
  const result = await lookupBookMetadata(data.isbn13, {
    fetch: mock(data),
    coverFetch: mock({}, 404),
    bookstoreFetch,
  });
  assert.equal(result.book?.coverSource, 'YES24');
  assert.equal(result.book?.coverUrl, 'https://image.yes24.com/goods/123/xl');
  assert.equal(result.book?.title, data.title);
  assert.deepEqual(result.book?.authors, ['손원평']);
  assert.equal(result.book?.sourceUrl, `http://localhost:8000/api/v1/books/${data.isbn13}`);
});

test('seoji cannot bypass ISBN validation by supplying a different provider cover', async () => {
  for (const cover_url of [
    'https://covers.openlibrary.org/b/isbn/9780306406157-L.jpg?default=false',
    'https://image.yes24.com/goods/123/xl',
  ]) {
    const result = await lookupBookMetadata(data.isbn13, {
      fetch: mock({ ...data, cover_url }),
      coverFetch: mock({}, 404),
      bookstoreFetch: mock({}, 404),
    });
    assert.equal(result.book?.coverUrl, null);
    assert.equal(result.book?.coverSource, null);
  }
});
