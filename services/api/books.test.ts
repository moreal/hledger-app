import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHledgerAdapter } from './hledger.ts';
import { purchaseBook, disposeBook, booksFromTransactions, proveBookRequest } from './books.ts';
import { executeLedgerRequest } from './schema.ts';
import { createMemoryFeatureSettingsStore } from './feature-settings.ts';

test('physical copies persist, settle gains/losses/fees/discard and prevent competing disposals', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'books-api-'));
  const journalPath = join(dir, 'books.journal');
  await writeFile(journalPath, '');
  const make = () =>
    createHledgerAdapter({
      journalPath,
      hledgerPath: process.env.HLEDGER_BIN ?? '/opt/homebrew/bin/hledger',
    });
  try {
    let adapter = make();
    const base = {
      date: '2026-10-20',
      isbn: '9780306406157',
      title: '책, "이름"; 테스트',
      purchasePrice: { commodity: 'KRW', value: '10000' },
      assetAccount: 'assets:books',
      cashAccount: 'assets:cash',
    };
    const a = await purchaseBook(adapter, { ...base, idempotencyKey: 'a' }),
      b = await purchaseBook(adapter, { ...base, idempotencyKey: 'b' }),
      c = await purchaseBook(adapter, { ...base, idempotencyKey: 'c' });
    assert.notEqual(a.book.commodity, b.book.commodity);
    assert.equal(a.book.isbn, b.book.isbn);
    assert.equal(
      (await purchaseBook(adapter, { ...base, idempotencyKey: 'a' })).idempotency.replayed,
      true,
    );
    await assert.rejects(
      purchaseBook(adapter, { ...base, title: 'changed', idempotencyKey: 'a' }),
      { code: 'IDEMPOTENCY_CONFLICT' },
    );
    adapter = make();
    assert.equal(booksFromTransactions((await adapter.read()).transactions)[0]!.title, base.title);
    const sell = {
      idempotencyKey: 'sale-a',
      date: '2026-10-21',
      copyId: a.book.id,
      kind: 'SELL' as const,
      cashAccount: 'assets:cash',
      saleProceeds: { commodity: 'KRW', value: '12000' },
      fee: '500',
    };
    const sold = await disposeBook(adapter, sell);
    assert.equal(sold.book.status, 'SOLD');
    assert.equal(sold.book.realizedGain?.value, '1500');
    assert.equal((await disposeBook(make(), sell)).idempotency.replayed, true);
    assert.equal(
      (await purchaseBook(make(), { ...base, idempotencyKey: 'a' })).book.status,
      'SOLD',
    );
    await assert.rejects(disposeBook(adapter, { ...sell, idempotencyKey: 'another' }), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
    const loss = await disposeBook(adapter, {
      ...sell,
      idempotencyKey: 'sale-b',
      copyId: b.book.id,
      saleProceeds: { commodity: 'KRW', value: '8000' },
    });
    assert.equal(loss.book.realizedGain?.value, '-2500');
    const discarded = await disposeBook(adapter, {
      idempotencyKey: 'discard-c',
      date: '2026-10-22',
      copyId: c.book.id,
      kind: 'DISCARD',
    });
    assert.equal(discarded.book.realizedGain?.value, '-10000');
    assert.equal(discarded.book.status, 'DISCARDED');
    const managed = await make().read();
    const purchase = managed.transactions.find((t) =>
      t.tags.some((tag) => tag.key === 'book.action' && tag.value === 'PURCHASE'),
    )!;
    assert.throws(() => booksFromTransactions([...managed.transactions, purchase]), {
      code: 'BOOK_METADATA_INVALID',
    });
    const sale = managed.transactions.find((t) =>
      t.tags.some((tag) => tag.key === 'book.action' && tag.value === 'SELL'),
    )!;
    for (const key of ['book.proceeds', 'book.gain']) {
      const malformed = {
        ...sale,
        tags: sale.tags.map((tag) => (tag.key === key ? { ...tag, value: 'not-money' } : tag)),
      };
      assert.throws(
        () => booksFromTransactions(managed.transactions.map((t) => (t === sale ? malformed : t))),
        { code: 'BOOK_METADATA_INVALID' },
      );
      const inconsistent = {
        ...sale,
        tags: sale.tags.map((tag) => (tag.key === key ? { ...tag, value: '999999' } : tag)),
      };
      assert.throws(
        () =>
          booksFromTransactions(managed.transactions.map((t) => (t === sale ? inconsistent : t))),
        { code: 'BOOK_METADATA_INVALID' },
      );
    }
    assert.throws(
      () =>
        booksFromTransactions([
          ...managed.transactions,
          { ...sale, source: 'HLEDGER' as const, tags: [] },
        ]),
      { code: 'BOOK_METADATA_INVALID' },
    );
    const snap = await make().read();
    assert.equal(snap.transactions.length, 6);
    assert.equal(
      booksFromTransactions(snap.transactions).filter((b) => b.status === 'HELD').length,
      0,
    );
    const d = await purchaseBook(adapter, { ...base, idempotencyKey: 'd' });
    await assert.rejects(disposeBook(adapter, { ...sell, copyId: d.book.id, date: '2026-10-19' }), {
      code: 'INVALID_INPUT',
    });
    await assert.rejects(
      disposeBook(adapter, {
        ...sell,
        copyId: d.book.id,
        saleProceeds: { commodity: 'USD', value: '12' },
      }),
      { code: 'INVALID_INPUT' },
    );
    const concurrent = await Promise.allSettled([
      disposeBook(make(), { ...sell, copyId: d.book.id, idempotencyKey: 'race1' }),
      disposeBook(make(), { ...sell, copyId: d.book.id, idempotencyKey: 'race2' }),
    ]);
    assert.equal(concurrent.filter((x) => x.status === 'fulfilled').length, 1);
    const auth = await executeLedgerRequest({
      featureSettings: createMemoryFeatureSettingsStore({ enabled: true }),
      adapter,
      authorized: false,
      query: '{ books { id } }',
    });
    assert.equal(auth.errors?.[0]?.extensions.code, 'UNAUTHENTICATED');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('GraphQL book reads and writes require authorization and generic writes cannot forge metadata', async () => {
  const adapter = {
    read: async () => {
      throw new Error('unexpected read');
    },
    create: async () => {
      throw new Error('unexpected write');
    },
  };
  for (const [query, variables] of [
    ['{ books { id } }', undefined],
    [
      'mutation($input: PurchaseBookInput!) { purchaseBook(input:$input) { book { id } } }',
      {
        input: {
          idempotencyKey: 'x',
          date: '2026-10-20',
          isbn: '9780306406157',
          title: 'Book',
          purchasePrice: { commodity: 'KRW', value: '100' },
          assetAccount: 'assets:books',
          cashAccount: 'assets:cash',
        },
      },
    ],
    [
      'mutation($input: DisposeBookInput!) { disposeBook(input:$input) { book { id } } }',
      {
        input: {
          idempotencyKey: 'x',
          date: '2026-10-20',
          copyId: '00000000000000000000',
          kind: 'DISCARD',
        },
      },
    ],
  ] as const) {
    const result = await executeLedgerRequest({
      featureSettings: createMemoryFeatureSettingsStore({ enabled: true }),
      adapter,
      authorized: false,
      query,
      variables,
    });
    assert.equal(result.errors?.[0]?.extensions.code, 'UNAUTHENTICATED');
  }
  const forged = await executeLedgerRequest({
    featureSettings: createMemoryFeatureSettingsStore({ enabled: true }),
    adapter,
    authorized: true,
    query:
      'mutation($input: CreateTransactionInput!){createTransaction(input:$input){errors{code path}}}',
    variables: {
      input: {
        idempotencyKey: 'forge',
        date: '2026-10-20',
        description: 'Forge',
        tags: [{ key: 'Book.copy', value: '00000000000000000000' }],
        postings: [
          { accountName: 'assets:cash', amount: { commodity: 'KRW', value: '1' } },
          { accountName: 'equity:opening', amount: { commodity: 'KRW', value: '-1' } },
        ],
      },
    },
  });
  assert.equal(
    (forged.data!.createTransaction as { errors: { code: string }[] }).errors[0]?.code,
    'INVALID_INPUT',
  );
});

test('generic transactions cannot use book commodities in amounts or costs', async () => {
  const adapter = {
    read: async () => {
      throw new Error('unexpected read');
    },
    create: async () => {
      throw new Error('unexpected write');
    },
  };
  for (const inCost of [false, true]) {
    const posting = inCost
      ? {
          accountName: 'assets:cash',
          amount: { commodity: 'KRW', value: '1' },
          cost: {
            type: 'UNIT',
            amount: { commodity: 'asset:book:00000000000000000000', value: '1' },
          },
        }
      : {
          accountName: 'assets:books',
          amount: { commodity: 'asset:book:00000000000000000000', value: '1' },
        };
    const result = await executeLedgerRequest({
      featureSettings: createMemoryFeatureSettingsStore({ enabled: true }),
      adapter,
      authorized: true,
      query:
        'mutation($input: CreateTransactionInput!){createTransaction(input:$input){errors{code}}}',
      variables: {
        input: {
          idempotencyKey: 'raw',
          date: '2026-10-20',
          description: 'Raw',
          postings: [
            posting,
            { accountName: 'equity:opening', amount: { commodity: 'KRW', value: '-1' } },
          ],
        },
      },
    });
    assert.equal(
      (result.data!.createTransaction as { errors: { code: string }[] }).errors[0]?.code,
      'INVALID_INPUT',
    );
  }
});

test('optional author and cover metadata survives restart while legacy purchases still replay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'book-metadata-'));
  const journalPath = join(directory, 'ledger.journal');
  await writeFile(journalPath, '');
  const make = () =>
    createHledgerAdapter({
      journalPath,
      hledgerPath: process.env.HLEDGER_BIN ?? '/opt/homebrew/bin/hledger',
    });
  const base = {
    date: '2026-10-24',
    isbn: '9780306406157',
    title: '저자와 표지',
    purchasePrice: { commodity: 'KRW', value: '15000' },
    assetAccount: 'assets:books',
    cashAccount: 'assets:cash',
  };
  try {
    const legacy = await purchaseBook(make(), { ...base, idempotencyKey: 'legacy' });
    assert.deepEqual(legacy.book.authors, []);
    assert.equal(legacy.book.coverUrl, null);
    assert.equal(
      (
        await purchaseBook(make(), {
          ...base,
          idempotencyKey: 'legacy',
          authors: [],
          coverUrl: null,
        })
      ).idempotency.replayed,
      true,
    );
    const authors = ['홍길동, 작가; "역자"', 'François 日本語'];
    const coverUrl = 'https://www.nl.go.kr/cover/book.jpg';
    const rich = await purchaseBook(make(), {
      ...base,
      idempotencyKey: 'metadata',
      authors,
      coverUrl,
    });
    const snapshot = await make().read();
    const restored = booksFromTransactions(snapshot.transactions).find(
      (book) => book.id === rich.book.id,
    )!;
    assert.deepEqual(restored.authors, authors);
    assert.equal(restored.coverUrl, coverUrl);
    assert.equal(
      (await purchaseBook(make(), { ...base, idempotencyKey: 'metadata', authors, coverUrl }))
        .idempotency.replayed,
      true,
    );
    await assert.rejects(
      purchaseBook(make(), {
        ...base,
        idempotencyKey: 'metadata',
        authors: ['다른 저자'],
        coverUrl,
      }),
      { code: 'IDEMPOTENCY_CONFLICT' },
    );
    for (const cover of [
      'http://seoji.nl.go.kr/book.jpg',
      'https://127.0.0.1/book.jpg',
      'https://localhost/book.jpg',
      'https://user:pass@seoji.nl.go.kr/book.jpg',
      'javascript:alert(1)',
    ]) {
      await assert.rejects(
        purchaseBook(make(), { ...base, idempotencyKey: 'bad-cover', coverUrl: cover }),
        { code: 'INVALID_INPUT' },
      );
    }
    await assert.rejects(
      purchaseBook(make(), { ...base, idempotencyKey: 'bad-authors', authors: [''] }),
      { code: 'INVALID_INPUT' },
    );
    const transaction = snapshot.transactions.find((tx) =>
      tx.tags.some((tag) => tag.key === 'book.copy' && tag.value === rich.book.id),
    )!;
    for (const [key, value] of [
      ['book.authors', 'null'],
      ['book.authors', '["が",5]'],
      ['book.cover', 'http://localhost/x'],
    ] as const) {
      const damaged = {
        ...transaction,
        tags: transaction.tags.map((tag) =>
          tag.key === key ? { ...tag, value: Buffer.from(value).toString('base64url') } : tag,
        ),
      };
      assert.throws(
        () =>
          booksFromTransactions(
            snapshot.transactions.map((tx) => (tx === transaction ? damaged : tx)),
          ),
        { code: 'BOOK_METADATA_INVALID' },
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('read-only proof confirms full purchase and disposal requests without modifying journal or pending files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'books-proof-'));
  const journalPath = join(dir, 'books.journal');
  await writeFile(journalPath, '');
  const adapter = createHledgerAdapter({
    journalPath,
    hledgerPath: process.env.HLEDGER_BIN ?? '/opt/homebrew/bin/hledger',
  });
  try {
    const input = {
      idempotencyKey: 'proof-buy',
      date: '2026-10-20',
      isbn: '9780306406157',
      title: 'Proof',
      authors: ['Author'],
      purchasePrice: { commodity: 'USD', value: '10' },
      assetAccount: 'assets:books',
      cashAccount: 'assets:cash',
    };
    const purchase = await purchaseBook(adapter, input);
    const bytes = await readFile(journalPath);
    const entries = await readdir(dir);
    const readOnly = {
      ...adapter,
      read: async () => {
        throw new Error('must not recover');
      },
      create: async () => {
        throw new Error('must not mutate');
      },
    };
    assert.equal(
      (await proveBookRequest(readOnly, { kind: 'purchase', input })).status,
      'CONFIRMED',
    );
    for (const patch of [
      { idempotencyKey: 'different' },
      { title: 'changed' },
      { isbn: '9780140328721' },
      { authors: ['Other'] },
      { assetAccount: 'assets:other' },
      { cashAccount: 'assets:other' },
      { date: '2026-10-21' },
      { purchasePrice: { commodity: 'USD', value: '11' } },
      { coverUrl: 'https://nl.go.kr/cover.jpg' },
    ]) {
      assert.equal(
        (await proveBookRequest(readOnly, { kind: 'purchase', input: { ...input, ...patch } }))
          .status,
        'UNKNOWN',
      );
    }
    assert.deepEqual(await readFile(journalPath), bytes);
    assert.deepEqual(await readdir(dir), entries);
    assert.equal(
      (
        await proveBookRequest(
          { read: readOnly.read, create: readOnly.create },
          { kind: 'purchase', input },
        )
      ).status,
      'UNKNOWN',
    );
    const disposal = {
      idempotencyKey: 'proof-sale',
      date: '2026-10-21',
      copyId: purchase.book.id,
      kind: 'SELL' as const,
      cashAccount: 'assets:cash',
      saleProceeds: { commodity: 'USD', value: '12' },
      fee: '1',
    };
    await disposeBook(adapter, disposal);
    const purchaseAfterSale = await proveBookRequest(readOnly, { kind: 'purchase', input });
    assert.equal(purchaseAfterSale.status, 'CONFIRMED');
    assert.equal(purchaseAfterSale.book?.status, 'SOLD');
    assert.equal(
      (await proveBookRequest(readOnly, { kind: 'dispose', input: disposal })).status,
      'CONFIRMED',
    );
    for (const patch of [
      { idempotencyKey: 'different' },
      { date: '2026-10-22' },
      { cashAccount: 'assets:other' },
      { fee: '2' },
      { gainAccount: 'income:other' },
      { lossAccount: 'expenses:other' },
      { feeAccount: 'expenses:other' },
      { saleProceeds: { commodity: 'USD', value: '13' } },
    ]) {
      assert.equal(
        (await proveBookRequest(readOnly, { kind: 'dispose', input: { ...disposal, ...patch } }))
          .status,
        'UNKNOWN',
      );
    }
    const discardPurchase = await purchaseBook(adapter, {
      ...input,
      idempotencyKey: 'proof-discard-buy',
    });
    const discard = {
      idempotencyKey: 'proof-discard',
      date: '2026-10-22',
      copyId: discardPurchase.book.id,
      kind: 'DISCARD' as const,
    };
    await disposeBook(adapter, discard);
    assert.equal(
      (await proveBookRequest(readOnly, { kind: 'dispose', input: discard })).status,
      'CONFIRMED',
    );
    const completed = await readFile(journalPath);
    const pendingPath = `${journalPath}.hledger-app.pending`;
    const pending = Buffer.from('interrupted recovery evidence');
    await writeFile(pendingPath, pending);
    assert.equal((await proveBookRequest(readOnly, { kind: 'purchase', input })).status, 'UNKNOWN');
    assert.equal(
      (await proveBookRequest(readOnly, { kind: 'dispose', input: disposal })).status,
      'UNKNOWN',
    );
    assert.deepEqual(await readFile(journalPath), completed);
    assert.deepEqual(await readFile(pendingPath), pending);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
