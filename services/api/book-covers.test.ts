import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { lookupBookCover, normalizeBookCoverUrl } from './book-covers.ts';
const isbn = '9788936434267';
const jpeg = () =>
  sharp({ create: { width: 100, height: 160, channels: 3, background: '#235' } })
    .jpeg()
    .toBuffer();
test('validates an exact ISBN cover and returns the public URL and provenance', async () => {
  const bytes = await jpeg();
  const result = await lookupBookCover(isbn, {
    fetch: async (url, init) => {
      assert.equal(
        String(url),
        `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`,
      );
      assert.equal(init?.redirect, 'manual');
      return new Response(bytes, { headers: { 'content-type': 'image/jpeg' } });
    },
  });
  assert.equal(
    result?.coverUrl,
    `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`,
  );
  assert.equal(result?.coverSource, 'OPEN_LIBRARY');
});
test('rejects missing, fake, tiny, oversized and unsafe redirected covers', async () => {
  const tiny = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } })
    .jpeg()
    .toBuffer();
  for (const response of [
    new Response('', { status: 404 }),
    new Response('not jpeg', { headers: { 'content-type': 'image/jpeg' } }),
    new Response(tiny, { headers: { 'content-type': 'image/jpeg' } }),
    new Response('', { headers: { 'content-type': 'image/jpeg', 'content-length': '2097153' } }),
    new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
  ]) {
    assert.equal(await lookupBookCover(isbn, { fetch: async () => response }), null);
  }
});
test('follows only known Open Library image redirects within a bounded timeout', async () => {
  const bytes = await jpeg();
  let calls = 0;
  assert.ok(
    await lookupBookCover(isbn, {
      fetch: async () =>
        ++calls === 1
          ? new Response(null, {
              status: 302,
              headers: { location: 'https://covers.openlibrary.org/b/id/123-L.jpg' },
            })
          : new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }),
    }),
  );
  assert.equal(calls, 2);
  const hanging: typeof fetch = async (_url, init) =>
    new Promise((_resolve, reject) =>
      init?.signal?.addEventListener('abort', () => reject(new Error('abort'))),
    );
  assert.equal(await lookupBookCover(isbn, { fetch: hanging, timeoutMs: 5 }), null);
});
test('cover URL storage accepts strict provider paths and existing National Library covers', () => {
  assert.ok(normalizeBookCoverUrl('https://www.nl.go.kr/cover.jpg'));
  assert.ok(
    normalizeBookCoverUrl(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`),
  );
  for (const url of [
    'https://covers.openlibrary.org/x',
    'https://covers.openlibrary.org/b/id/1-L.jpg',
    'https://covers.openlibrary.org/b/isbn/9788936434267-L.jpg',
    'https://covers.openlibrary.org.evil/b/isbn/9788936434267-L.jpg?default=false',
  ])
    assert.equal(normalizeBookCoverUrl(url), null);
});

test('accepts the live archive image redirect shape but rejects arbitrary archive endpoints', async () => {
  const bytes = await jpeg();
  let calls = 0;
  const archive =
    'https://ia600502.us.archive.org/view_archive.php?archive=/31/items/m_covers_0013/m_covers_0013_14.zip&file=0013141400-M.jpg';
  assert.ok(
    await lookupBookCover(isbn, {
      fetch: async (url) => {
        calls++;
        if (calls === 1) return new Response(null, { status: 302, headers: { location: archive } });
        assert.equal(String(url), archive);
        return new Response(bytes, { headers: { 'content-type': 'image/jpeg' } });
      },
    }),
  );
  for (const location of [
    'https://archive.org/private',
    'https://ia600502.us.archive.org/view_archive.php?archive=/etc/passwd&file=1-M.jpg',
    `${archive}&extra=1`,
  ]) {
    let count = 0;
    assert.equal(
      await lookupBookCover(isbn, {
        fetch: async () => {
          count++;
          return new Response(null, { status: 302, headers: { location } });
        },
      }),
      null,
    );
    assert.equal(count, 1);
  }
});

test('follows the verified large-cover archive chain', async () => {
  const bytes = await jpeg();
  let calls = 0;
  const chain = [
    'https://archive.org/download/l_covers_0013/l_covers_0013_14.zip/0013141400-L.jpg',
    'https://ia801909.us.archive.org/view_archive.php?archive=/31/items/l_covers_0013/l_covers_0013_14.zip&file=0013141400-L.jpg',
  ];
  assert.ok(
    await lookupBookCover(isbn, {
      fetch: async () =>
        calls++ < 2
          ? new Response(null, { status: 302, headers: { location: chain[calls - 1] } })
          : new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }),
    }),
  );
  assert.equal(calls, 3);
});

test('uses verified edition cover IDs while preserving exact ISBN provenance', async () => {
  const bytes = await jpeg();
  const result = await lookupBookCover(isbn, {
    coverId: 123,
    fetch: async (url) => {
      assert.equal(String(url), 'https://covers.openlibrary.org/b/id/123-L.jpg?default=false');
      return new Response(bytes, { headers: { 'content-type': 'image/jpeg' } });
    },
  });
  assert.equal(result?.coverUrl, 'https://covers.openlibrary.org/b/id/123-L.jpg?default=false');
  assert.equal(result?.coverSourceUrl, `https://openlibrary.org/isbn/${isbn}`);
  for (const coverId of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    '0',
    '01',
    '1/2',
    '1?x',
    ' 1',
    '1e3',
    '9007199254740992',
  ]) {
    let called = false;
    assert.equal(
      await lookupBookCover(isbn, {
        coverId,
        fetch: async () => {
          called = true;
          return new Response(bytes);
        },
      }),
      null,
    );
    assert.equal(called, false, String(coverId));
  }
});

test('isolates process caches by ISBN and cover identity', async () => {
  const original = globalThis.fetch;
  const bytes = await jpeg();
  const urls: string[] = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response(bytes, { headers: { 'content-type': 'image/jpeg' } });
  };
  try {
    await lookupBookCover(isbn, { coverId: 1001 });
    await lookupBookCover(isbn, { coverId: '1001' });
    await lookupBookCover(isbn, { coverId: 1002 });
    await lookupBookCover(isbn);
    await lookupBookCover('9780140328721', { coverId: 1001 });
    assert.equal(urls.length, 4);
  } finally {
    globalThis.fetch = original;
  }
});

test('rejects unsafe cover ID redirects without following them', async () => {
  for (const location of [
    'https://covers.openlibrary.org.evil/b/id/1-L.jpg',
    'https://covers.openlibrary.org/b/id/1-L.jpg?x=1',
    'https://covers.openlibrary.org/b/id/0-L.jpg',
    'http://covers.openlibrary.org/b/id/1-L.jpg',
  ]) {
    let calls = 0;
    assert.equal(
      await lookupBookCover(isbn, {
        coverId: 42,
        fetch: async () => {
          calls++;
          return new Response(null, { status: 302, headers: { location } });
        },
      }),
      null,
    );
    assert.equal(calls, 1);
  }
});

test('ID images retain JPEG and dimension validation', async () => {
  const tiny = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } })
    .jpeg()
    .toBuffer();
  for (const bytes of [Buffer.from('not a JPEG'), tiny]) {
    assert.equal(
      await lookupBookCover(isbn, {
        coverId: 123,
        fetch: async () => new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }),
      }),
      null,
    );
  }
});

test('the process cover budget remains at most 40 requests per five minutes', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(null, { status: 404 });
  };
  try {
    for (let id = 2000; id < 2045; id++) await lookupBookCover(isbn, { coverId: id });
    assert.ok(calls > 0 && calls <= 40);
    const afterBudget = calls;
    assert.equal(await lookupBookCover(isbn, { coverId: 3000 }), null);
    assert.equal(calls, afterBudget);
  } finally {
    globalThis.fetch = original;
  }
});
