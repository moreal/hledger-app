import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  parsePendingBook,
  canTransmitBook,
  acceptsBooksFeature,
  confirmsPendingBook,
} from './book-recovery';
const request = {
  identity: 'https://ledger.test/graphql#ledger-a',
  kind: 'purchase' as const,
  input: {
    idempotencyKey: 'original-key',
    date: '2026-10-25',
    isbn: '9780140328721',
    title: 'Matilda',
    authors: ['Roald Dahl'],
    purchasePrice: { commodity: 'KRW', value: '0001.20' },
    assetAccount: 'assets:books',
    cashAccount: 'assets:cash',
  },
};
const feature = {
  moduleId: 'books',
  version: 3,
  migrationVersion: 1,
  enabled: true,
  migratedExistingData: false,
  canRead: true,
  canWrite: true,
  canLookupMetadata: true,
  canRecover: true,
};
test('legacy durable payload retains exact request, decimal, identity and key and cannot be modified', () => {
  const pending = parsePendingBook(JSON.stringify(request));
  assert.deepEqual(pending, request);
  assert.equal(Object.isFrozen(pending!.input), true);
  Reflect.set(pending!.input, 'idempotencyKey', 'replacement');
  assert.equal(pending!.input.idempotencyKey, 'original-key');
  assert.equal(parsePendingBook('null'), null);
  assert.equal(parsePendingBook(null), null);
});
test('corrupt legacy storage cannot become an empty ready queue', () => {
  for (const raw of [
    '',
    '{',
    '{}',
    '[]',
    JSON.stringify({ ...request, identity: '' }),
    JSON.stringify({ ...request, input: { idempotencyKey: 'key' } }),
    JSON.stringify({ ...request, kind: 'unknown' }),
  ])
    assert.throws(() => parsePendingBook(raw));
});
test('disabled, unverified, wrong ledger and unhydrated recovery never authorize transmitting', () => {
  const pending = parsePendingBook(JSON.stringify(request))!;
  assert.equal(canTransmitBook(pending, request.identity, true, true, feature), true);
  for (const [identity, verified, ready, value] of [
    [request.identity, true, true, { ...feature, enabled: false }],
    ['other', true, true, feature],
    [request.identity, false, true, feature],
    [request.identity, true, false, feature],
    [request.identity, true, true, null],
  ] as const)
    assert.equal(canTransmitBook(pending, identity, verified, ready, value), false);
});
test('unknown or malformed proof preserves pending and unsupported capability versions fail closed', () => {
  assert.equal(
    confirmsPendingBook({ status: 'UNKNOWN', book: null, idempotency: null }, request),
    false,
  );
  assert.equal(
    confirmsPendingBook(
      {
        status: 'CONFIRMED',
        book: { title: 'Matilda' },
        idempotency: { key: 'original-key', replayed: true },
      },
      request,
    ),
    false,
  );
  assert.equal(acceptsBooksFeature(feature), true);
  for (const value of [
    null,
    { ...feature, moduleId: 'foreign' },
    { ...feature, migrationVersion: 2 },
    { ...feature, version: -1 },
    { ...feature, canWrite: undefined },
  ])
    assert.equal(acceptsBooksFeature(value), false);
});

test('only full confirmed evidence for the original request resolves recovery while Books is disabled', () => {
  const id = createHash('sha256')
    .update(`book:${request.input.idempotencyKey}`)
    .digest('hex')
    .slice(0, 20);
  const proof = {
    status: 'CONFIRMED',
    idempotency: { key: request.input.idempotencyKey, replayed: true },
    book: {
      id,
      commodity: `asset:book:${id}`,
      isbn: request.input.isbn,
      title: request.input.title,
      authors: request.input.authors,
      coverUrl: null,
      purchaseDate: request.input.date,
      purchasePrice: { commodity: 'KRW', value: '1.20' },
      assetAccount: request.input.assetAccount,
      status: 'HELD',
      disposalDate: null,
      saleProceeds: null,
      realizedGain: null,
    },
  };
  const pending = parsePendingBook(JSON.stringify(request))!;
  assert.equal(
    canTransmitBook(pending, request.identity, true, true, { ...feature, enabled: false }),
    false,
  );
  assert.equal(confirmsPendingBook(proof, pending), true);
  for (const change of [
    { title: 'Different book' },
    { isbn: '9780439554930' },
    { purchasePrice: { commodity: 'USD', value: '1.20' } },
    { authors: [] },
    { assetAccount: 'assets:other' },
    { coverUrl: 'https://example.test/cover.jpg' },
  ])
    assert.equal(
      confirmsPendingBook({ ...proof, book: { ...proof.book, ...change } }, pending),
      false,
    );
  assert.equal(
    confirmsPendingBook(
      { ...proof, idempotency: { key: 'different-key', replayed: true } },
      pending,
    ),
    false,
  );
});
test('legacy sale and discard retain exact kind, references, amounts and ledger through off/on', () => {
  for (const kind of ['SELL', 'DISCARD'] as const) {
    const original = {
      identity: request.identity,
      kind: 'dispose',
      input: {
        idempotencyKey: 'dispose-key',
        date: '2026-10-25',
        copyId: 'a'.repeat(20),
        kind,
        lossAccount: 'expenses:books:loss',
        ...(kind === 'SELL'
          ? {
              saleProceeds: { commodity: 'USD', value: '0003.50' },
              fee: '0.10',
              cashAccount: 'assets:cash',
              gainAccount: 'income:gain',
              feeAccount: 'expenses:fees',
            }
          : {}),
      },
    };
    const pending = parsePendingBook(JSON.stringify(original))!;
    assert.deepEqual(pending, original);
    assert.equal(
      canTransmitBook(pending, original.identity, true, true, { ...feature, enabled: false }),
      false,
    );
    assert.equal(canTransmitBook(pending, original.identity, true, true, feature), true);
    assert.deepEqual(JSON.parse(JSON.stringify(pending)), original);
  }
});
