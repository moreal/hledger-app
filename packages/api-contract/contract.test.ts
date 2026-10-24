import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as validation from './validation';

const validInput = () => ({
  idempotencyKey: 'request-1', date: '2024-02-29', description: '점심',
  code: null, clientReference: 'mobile-1', tags: [{ key: 'project', value: '가계' }],
  postings: [
    { accountName: 'expenses:food', amount: { value: '900719925474099312345.000001', commodity: 'KRW' }, memo: '식사' },
    { accountName: 'assets:bank', amount: { value: '-900719925474099312345.000001', commodity: 'KRW' } },
  ],
});

test('GraphQL schema and shared operations cover every root and preserve legacy model fields', async () => {
  const { buildSchema, parse, validate, validateSchema, isObjectType, isInputObjectType } = await import('graphql');
  const schema = buildSchema(await readFile(new URL('./schema.graphql', import.meta.url), 'utf8'));
  assert.deepEqual(validateSchema(schema), []);
  const operations = parse(await readFile(new URL('./operations.graphql', import.meta.url), 'utf8'));
  assert.deepEqual(validate(schema, operations), []);
  const fields = (name: string) => {
    const type = schema.getType(name);
    assert.ok(isObjectType(type) || isInputObjectType(type), name);
    return type.getFields();
  };
  for (const [name, expected] of Object.entries({
    Query: ['health', 'accounts', 'account', 'transactions', 'prices'],
    Mutation: ['createTransaction'],
    Account: ['id', 'name', 'fullName', 'parentId', 'depth', 'balances', 'transactionCount', 'lastPostedDate', 'tags', 'movements', 'transactions'],
    Transaction: ['id', 'date', 'description', 'code', 'status', 'postings', 'tags', 'createdAt', 'source'],
    Posting: ['accountId', 'accountName', 'amount', 'memo'],
    PriceQuote: ['commodity', 'quoteCommodity', 'date', 'rate', 'source'],
    Health: ['status', 'timestamp', 'version', 'indexerLagSeconds', 'details', 'lastSuccessfulSyncAt', 'connectionStatus'],
    CreateTransactionInput: ['date', 'description', 'code', 'postings', 'tags', 'clientReference', 'idempotencyKey'],
    CreateTransactionPayload: ['transaction', 'idempotency', 'errors'],
    FieldError: ['path', 'code', 'message', 'details', 'timestamp', 'requestId'],
    AccountConnection: ['edges', 'pageInfo', 'limit', 'totalEstimate'],
    TransactionConnection: ['edges', 'pageInfo', 'limit', 'totalEstimate'],
    PriceConnection: ['edges', 'pageInfo', 'limit', 'totalEstimate'],
  })) for (const field of expected) assert.ok(fields(name)[field], `${name}.${field}`);
  for (const name of ['accounts', 'transactions', 'prices']) assert.ok(!String(fields('Query')[name]!.type).endsWith('!'));
  assert.equal(String(fields('Transaction').createdAt!.type), 'DateTime');
  assert.equal(String(fields('Health').indexerLagSeconds!.type), 'Int');
  assert.equal(String(fields('MoneyAmount').value!.type), 'Decimal!');
  assert.equal(String(fields('CreateTransactionInput').idempotencyKey!.type), 'String!');
  const covered = new Set<string>();
  for (const definition of operations.definitions) {
    if (definition.kind !== 'OperationDefinition') continue;
    for (const selection of definition.selectionSet.selections) if (selection.kind === 'Field') covered.add(`${definition.operation}.${selection.name.value}`);
  }
  for (const root of ['query.health', 'query.accounts', 'query.account', 'query.transactions', 'query.prices', 'mutation.createTransaction']) assert.ok(covered.has(root), root);
});

test('Decimal preserves precision and rejects JSON numbers, exponent, signs and whitespace', () => {
  for (const value of ['-0.00000000000000000001', '900719925474099312345', '001.2300']) {
    assert.equal(validation.parseDecimal(value), value);
  }
  for (const value of [1, null, '1e3', '+1', '.2', '1.', ' 1', '1\n', 'NaN']) {
    assert.throws(() => validation.parseDecimal(value));
  }
});

test('Date checks Gregorian leap days and rejects normalized or noncanonical dates', () => {
  assert.equal(validation.parseDate('2000-02-29'), '2000-02-29');
  for (const value of ['1900-02-29', '2025-02-29', '2024-04-31', '2024-00-01', '2024-1-01', '0000-01-01', '2024-01-01\n', 20240101]) {
    assert.throws(() => validation.parseDate(value));
  }
});

test('DateTime requires a valid calendar date, clock and explicit timezone', () => {
  for (const value of ['2024-02-29T23:59:59.123456Z', '2024-01-01T09:30:00+09:00']) {
    assert.equal(validation.parseDateTime(value), value);
  }
  for (const value of ['2025-02-29T12:00:00Z', '2024-01-01T24:00:00Z', '2024-01-01T00:60:00Z', '2024-01-01T00:00:60Z', '2024-01-01T12:00:00', '2024-01-01T00:00:00+24:00']) {
    assert.throws(() => validation.parseDateTime(value));
  }
});

test('JSONObject accepts nested JSON objects and rejects non-JSON data and cycles', () => {
  const value = { data: [null, true, 1, 'x', { nested: false }] };
  assert.equal(validation.parseJSONObject(value), value);
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  for (const bad of [[], null, 'text', { value: undefined }, { value: Infinity }, { value: 1n }, { value: new Date() }, cyclic]) {
    assert.throws(() => validation.parseJSONObject(bad));
  }
});

test('pagination defaults to 50 and enforces the 1–200 integer bounds', () => {
  assert.equal(validation.validateFirst(undefined), 50);
  assert.equal(validation.validateFirst(null), 50);
  for (const value of [1, 200]) assert.equal(validation.validateFirst(value), value);
  for (const value of [0, 201, 1.5, '50', NaN]) assert.throws(() => validation.validateFirst(value));
});

test('pagination rejects empty cursor tokens without interpreting opaque contents', () => {
  assert.equal(validation.validateAfter(null), undefined);
  assert.equal(validation.validateAfter(undefined), undefined);
  assert.equal(validation.validateAfter('opaque/revision:cursor='), 'opaque/revision:cursor=');
  for (const value of ['', 4, false]) assert.throws(() => validation.validateAfter(value));
});

test('depth and GraphQL count guards reject invalid and overflowing output values', () => {
  assert.equal(validation.validateDepth(10), 10);
  assert.equal(validation.validateDepth(20, true), 20);
  for (const value of [0, 11, 1.5]) assert.throws(() => validation.validateDepth(value));
  assert.equal(validation.validateGraphQLCount(2147483647), 2147483647);
  for (const value of [-1, 2147483648, 1.5]) assert.throws(() => validation.validateGraphQLCount(value));
});

test('query filters preserve inclusive dates and reject reverse ranges and empty search terms', () => {
  assert.deepEqual(validation.validateTransactionFilter({ from: '2024-02-29', to: '2024-02-29', query: '점심', accountId: 'opaque:1', tags: [{ key: 'k', value: 'v' }] }), []);
  assert.ok(validation.validateTransactionFilter({ from: '2024-03-01', to: '2024-02-29' }).some((issue) => issue.path === 'to'));
  for (const query of ['', 'x'.repeat(201)]) assert.ok(validation.validateTransactionFilter({ query }).length);
  assert.deepEqual(validation.validateAccountFilter({ includeEmpty: true, depth: 10, asOf: '2024-02-29', query: '현금' }), []);
  assert.ok(validation.validateAccountFilter({ includeEmpty: 'true', depth: 11, asOf: '2024-02-30' }).length >= 3);
  assert.deepEqual(validation.validatePriceFilter({ commodity: 'BTC', quoteCommodity: 'KRW', from: '2024-01-01', to: '2024-12-31' }), []);
  assert.ok(validation.validatePriceFilter({ commodity: '', quoteCommodity: 'x'.repeat(33) }).length === 2);
});

test('tag input rejects duplicate keys without discarding valid empty tag values', () => {
  assert.deepEqual(validation.validateTags([{ key: '', value: '' }]), []);
  assert.ok(validation.validateTags([{ key: 'project', value: 'a' }, { key: 'project', value: 'b' }]).some((issue) => issue.code === 'DUPLICATE_TAG'));
  assert.ok(validation.validateTags([{ key: 'k', value: 3 }]).length);
});

test('transaction accepts legacy optional fields and balances exact values at mixed scales', () => {
  assert.deepEqual(validation.validateCreateTransactionInput(validInput()), []);
  const input = validInput();
  input.postings[0]!.amount.value = '0.1';
  input.postings[1]!.amount.value = '-0.10';
  assert.deepEqual(validation.validateCreateTransactionInput(input), []);
});

test('transaction rejects single postings, mixed commodities and tiny exact imbalances', () => {
  const single = validInput(); single.postings.pop();
  assert.ok(validation.validateCreateTransactionInput(single).some((issue) => issue.path === 'postings'));
  const mixed = validInput(); mixed.postings[1]!.amount.commodity = 'USD';
  assert.ok(validation.validateCreateTransactionInput(mixed).some((issue) => issue.code === 'MIXED_COMMODITY'));
  const unbalanced = validInput(); unbalanced.postings[1]!.amount.value = '-900719925474099312345.000002';
  assert.ok(validation.validateCreateTransactionInput(unbalanced).some((issue) => issue.code === 'UNBALANCED'));
});

test('transaction rejects invalid scalar and legacy string boundaries with field paths', () => {
  const input = { ...validInput(), date: '2024-02-30', description: '', code: 'x'.repeat(65), clientReference: 'x'.repeat(129), idempotencyKey: '', tags: [{ key: 'k', value: 'a' }, { key: 'k', value: 'b' }], postings: [{ accountName: '', amount: { value: '1e2', commodity: 'x'.repeat(33) }, memo: 'x'.repeat(1001) }, { accountName: 'assets', amount: { value: '-100', commodity: 'KRW' } }] };
  const paths = validation.validateCreateTransactionInput(input).map((issue) => issue.path);
  for (const path of ['date', 'description', 'code', 'clientReference', 'idempotencyKey', 'tags[1].key', 'postings[0].accountName', 'postings[0].amount.value', 'postings[0].amount.commodity', 'postings[0].memo']) assert.ok(paths.includes(path), path);
  const maximum = { ...validInput(), description: '한'.repeat(512), code: 'x'.repeat(64), clientReference: 'x'.repeat(128), idempotencyKey: 'x'.repeat(128) };
  assert.deepEqual(validation.validateCreateTransactionInput(maximum), []);
});

test('trade cost balances exact settlement values and rejects malformed cost fields', () => {
  const input: any = {...validInput(),postings:[
    {accountName:'Assets:Stock',amount:{commodity:'asset:stock:krx:005930',value:'-2'},cost:{type:'TOTAL',amount:{commodity:'KRW',value:'140000'}}},
    {accountName:'Assets:Cash',amount:{commodity:'KRW',value:'139900'}},
    {accountName:'Expenses:Fees',amount:{commodity:'KRW',value:'100'}},
  ]};
  assert.deepEqual(validation.validateCreateTransactionInput(input),[]);
  for (const invalid of ['0','-1','1e3']) {
    const bad=structuredClone(input);bad.postings[0].cost.amount.value=invalid;
    assert.ok(validation.validateCreateTransactionInput(bad).some(e=>e.path==='postings[0].cost.amount.value'));
  }
  const imbalance=structuredClone(input);imbalance.postings[1].amount.value='139900.000000000000000001';
  assert.ok(validation.validateCreateTransactionInput(imbalance).some(e=>e.code==='UNBALANCED'));
});
