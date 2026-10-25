import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedgerClient, isValidBookConfirmation } from './index';
const payload = () => ({
  errors: [],
  idempotency: { key: 'book-request', replayed: false },
  book: {
    id: '0123456789abcdef0123',
    commodity: 'asset:book:0123456789abcdef0123',
    isbn: '9780132350884',
    title: 'Clean Code',
    authors: [],
    coverUrl: null,
    assetAccount: 'assets:books',
    purchaseDate: '2026-10-23',
    status: 'HELD',
    disposalDate: null,
    purchasePrice: { commodity: 'KRW', value: '15000.0000000000000001' },
    saleProceeds: null,
    realizedGain: null,
  },
});
test('book confirmation requires complete matching copy metadata', () => {
  const p = payload();
  assert.equal(isValidBookConfirmation(p, 'book-request'), true);
  assert.equal(isValidBookConfirmation(p, 'other'), false);
  assert.equal(
    isValidBookConfirmation(
      { ...p, book: { ...p.book, commodity: 'asset:book:wrong' } },
      'book-request',
    ),
    false,
  );
  assert.equal(
    isValidBookConfirmation(
      { ...p, book: { ...p.book, purchasePrice: { commodity: 'KRW', value: 15000 } } },
      'book-request',
    ),
    false,
  );
  assert.equal(
    isValidBookConfirmation(
      { ...p, book: { ...p.book, purchaseDate: '2026-02-30' } },
      'book-request',
    ),
    false,
  );
});

test('typed book client runs purchase, sale and discard against HTTP and actual hledger', async (t) => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { startServer } = await import('../../services/api/server.ts');
  const { createHledgerAdapter } = await import('../../services/api/hledger.ts');
  const { createLedgerClient } = await import('./index.ts');
  const dir = await mkdtemp(join(tmpdir(), 'book-client-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const journal = join(dir, 'books.journal');
  await writeFile(journal, '');
  const { createMemoryFeatureSettingsStore } =
    await import('../../services/api/feature-settings.ts');
  const server = await startServer({
    featureSettings: createMemoryFeatureSettingsStore({ enabled: true }),
    adapter: createHledgerAdapter({
      journalPath: journal,
      hledgerPath: process.env.HLEDGER_BIN ?? '/opt/homebrew/bin/hledger',
    }),
    token: 'test-books',
    port: 0,
    ledgerId: 'test-books',
  });
  t.after(
    () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  );
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const client = createLedgerClient({
    endpoint: `http://127.0.0.1:${address.port}/graphql`,
    token: 'test-books',
    ledgerId: 'test-books',
  });
  const input = {
    idempotencyKey: 'book-http-a',
    date: '2026-10-23',
    isbn: '9780306406157',
    title: 'Test book',
    purchasePrice: { commodity: 'KRW', value: '10000' },
    assetAccount: 'Assets:Books',
    cashAccount: 'Assets:Cash',
  };
  const a = await client.purchaseBook(input);
  assert.deepEqual(a.data?.purchaseBook?.errors, []);
  const id = a.data!.purchaseBook!.book!.id;
  const b = await client.purchaseBook({ ...input, idempotencyKey: 'book-http-b' });
  assert.notEqual(b.data!.purchaseBook!.book!.id, id);
  const sale = {
    idempotencyKey: 'sale-http',
    date: input.date,
    copyId: id,
    kind: 'SELL' as const,
    saleProceeds: { commodity: 'KRW', value: '12000' },
    fee: '500',
    cashAccount: 'Assets:Cash',
  };
  const sold = await client.disposeBook(sale);
  assert.equal(sold.data?.disposeBook?.book?.realizedGain?.value, '1500');
  assert.equal((await client.disposeBook(sale)).data?.disposeBook?.idempotency?.replayed, true);
  const discarded = await client.disposeBook({
    idempotencyKey: 'discard-http',
    date: input.date,
    copyId: b.data!.purchaseBook!.book!.id,
    kind: 'DISCARD',
  });
  assert.equal(discarded.data?.disposeBook?.book?.realizedGain?.value, '-10000');
  assert.deepEqual((await client.books()).data?.books?.map((x) => x.status).sort(), [
    'DISCARDED',
    'SOLD',
  ]);
});

const request = {
  kind: 'purchase' as const,
  input: {
    idempotencyKey: 'book-request',
    date: '2026-10-23',
    isbn: '9780132350884',
    title: 'Clean Code',
    purchasePrice: { commodity: 'KRW', value: '15000.0000000000000001' },
    assetAccount: 'assets:books',
    cashAccount: 'assets:cash',
  },
};
function responding(data: unknown) {
  return createLedgerClient({
    endpoint: 'https://ledger.example/graphql',
    fetch: async () => Response.json({ data }),
  });
}
test('typed recovery requires complete same-key confirmation and rejects hostile copies', async () => {
  const { createHash } = await import('node:crypto');
  const id = createHash('sha256').update('book:book-request').digest('hex').slice(0, 20);
  const confirmed = {
    status: 'CONFIRMED',
    book: { ...payload().book, id, commodity: `asset:book:${id}` },
    idempotency: { key: 'book-request', replayed: true },
  };
  assert.equal(
    (await responding({ bookRequestStatus: confirmed }).bookRequestStatus(request)).data
      ?.bookRequestStatus.status,
    'CONFIRMED',
  );
  for (const value of [
    { ...confirmed, book: null },
    { ...confirmed, idempotency: { key: 'other', replayed: true } },
    { ...confirmed, book: { ...confirmed.book, title: 'Other' } },
    { ...confirmed, book: { ...confirmed.book, authors: undefined } },
    { ...confirmed, book: { ...confirmed.book, status: 'SOLD' } },
  ]) {
    await assert.rejects(
      () => responding({ bookRequestStatus: value }).bookRequestStatus(request),
      /unconfirmed/,
    );
  }
  const disposed = {
    ...confirmed,
    book: {
      ...confirmed.book,
      status: 'DISCARDED',
      disposalDate: '2026-10-24',
      saleProceeds: { commodity: 'KRW', value: '0' },
      realizedGain: { commodity: 'KRW', value: '-15000.0000000000000001' },
    },
  };
  assert.equal(
    (await responding({ bookRequestStatus: disposed }).bookRequestStatus(request)).data
      ?.bookRequestStatus.status,
    'CONFIRMED',
  );
  await assert.rejects(() => responding({}).bookRequestStatus(request), /unconfirmed/);
  assert.equal(
    (
      await responding({
        bookRequestStatus: { status: 'UNKNOWN', book: null, idempotency: null },
      }).bookRequestStatus(request)
    ).data?.bookRequestStatus.status,
    'UNKNOWN',
  );
});
test('settings and recovery use fixed typed operation variables', async () => {
  const calls: any[] = [];
  const client = createLedgerClient({
    endpoint: 'https://ledger.example/graphql',
    fetch: async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return Response.json({ data: {} });
    },
  });
  await client.ledgerFeatures();
  await client.setBooksEnabled(true, 3, true);
  assert.match(calls[0].query, /ledgerFeatures/);
  assert.deepEqual(calls[1].variables, { enabled: true, expectedVersion: 3, hasPending: true });
});

test('missing mutation confirmations never imply success', async () => {
  for (const data of [{}, { purchaseBook: null }, { purchaseBook: { errors: [] } }])
    await assert.rejects(() => responding(data).purchaseBook(request.input), /unconfirmed/);
  await assert.rejects(
    () =>
      responding({ disposeBook: null }).disposeBook({
        idempotencyKey: 'dispose',
        date: '2026-10-24',
        copyId: payload().book.id,
        kind: 'DISCARD',
      }),
    /unconfirmed/,
  );
});
test('disposal recovery validates original copy, disposal kind, date and money', async () => {
  const disposal = {
    kind: 'dispose' as const,
    input: {
      idempotencyKey: 'dispose',
      date: '2026-10-24',
      copyId: payload().book.id,
      kind: 'SELL' as const,
      saleProceeds: { commodity: 'KRW', value: '16000' },
      fee: '100',
    },
  };
  const status = {
    status: 'CONFIRMED',
    idempotency: { key: 'dispose', replayed: true },
    book: {
      ...payload().book,
      status: 'SOLD',
      disposalDate: '2026-10-24',
      saleProceeds: { commodity: 'KRW', value: '16000' },
      realizedGain: { commodity: 'KRW', value: '899.9999999999999999' },
    },
  };
  const calls: any[] = [];
  const client = createLedgerClient({
    endpoint: 'https://ledger.example/graphql',
    fetch: async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return Response.json({ data: { bookRequestStatus: status } });
    },
  });
  assert.equal(
    (await client.bookRequestStatus(disposal)).data?.bookRequestStatus.status,
    'CONFIRMED',
  );
  assert.deepEqual(calls[0].variables, { input: { disposal: disposal.input } });
  for (const book of [
    { ...status.book, id: 'abcdef0123456789abcd', commodity: 'asset:book:abcdef0123456789abcd' },
    { ...status.book, status: 'DISCARDED' },
    { ...status.book, disposalDate: '2026-10-25' },
    { ...status.book, saleProceeds: { commodity: 'KRW', value: '16001' } },
  ])
    await assert.rejects(
      () => responding({ bookRequestStatus: { ...status, book } }).bookRequestStatus(disposal),
      /unconfirmed/,
    );
});
