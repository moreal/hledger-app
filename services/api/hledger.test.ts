import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHledgerAdapter, accountId, decimalFromQuantity } from './hledger.ts';
import { ledgerCommodity } from '../../packages/domain/src/asset-identity.ts';
import type { CreateTransactionInput } from './types.ts';

const hledgerPath = process.env.HLEDGER_BIN ?? '/opt/homebrew/bin/hledger';
async function fixture(content = '') {
  const directory = await mkdtemp(join(tmpdir(), 'hledger-adapter-'));
  const journalPath = join(directory, 'ledger.journal');
  await writeFile(journalPath, content);
  return { directory, journalPath, adapter: createHledgerAdapter({ journalPath, hledgerPath }) };
}
function input(key = 'test-1'): CreateTransactionInput {
  return {
    idempotencyKey: key,
    date: '2026-10-20',
    description: '동네 식당',
    code: 'LUNCH-1',
    tags: [{ key: '분류', value: '생활' }],
    clientReference: 'mobile-1',
    postings: [
      {
        accountName: '비용:식비',
        amount: { commodity: 'KRW', value: '12500.0000' },
        memo: '맛있는 점심',
      },
      { accountName: '자산:생활비 통장', amount: { commodity: 'KRW', value: '-12500.0000' } },
    ],
  };
}

test('lossless exponent mantissas do not pass through floating point', () => {
  assert.equal(
    decimalFromQuantity({
      decimalMantissa: '9.00719925474099312345123456789e30',
      decimalPlaces: '10',
    }),
    '900719925474099312345.1234567890',
  );
  assert.equal(
    decimalFromQuantity({ decimalMantissa: '-12300', decimalPlaces: '7' }),
    '-0.0012300',
  );
});

test('CLI snapshots preserve 30-digit fractions, existing multi-commodity postings, account tags and prices', async () => {
  const f = await fixture(`account 자산:은행 ; kind: cash
account 자산:비어있음 ; purpose: reserve
P 2026-10-19 USD 1350.2500 KRW
2026-10-19 * (FX) 환전 ; 분류: 여행
    자산:외화  10.000000000000000000000000000001 USD @ 1350 KRW
    자산:은행  -13500.000000000000000000000000001350 KRW

2026-10-20 미세 금액
    자산:코인  0.000000000000000000000000000001 BTC
    자본:기초  -0.000000000000000000000000000001 BTC

2026-10-20 큰 금액
    자산:은행  900719925474099312345.1234567890123456789000 KRW
    자본:기초  -900719925474099312345.1234567890123456789000 KRW
`);
  try {
    const snapshot = await f.adapter.read();
    assert.equal(
      snapshot.transactions[0]!.postings[0]!.amount.value,
      '10.000000000000000000000000000001',
    );
    assert.equal(snapshot.transactions[0]!.postings[1]!.amount.commodity, 'KRW');
    assert.equal(
      snapshot.transactions[1]!.postings[0]!.amount.value,
      '0.000000000000000000000000000001',
    );
    assert.equal(
      snapshot.transactions[2]!.postings[0]!.amount.value,
      '900719925474099312345.1234567890123456789000',
    );
    assert.equal(snapshot.transactions[0]!.createdAt, null);
    assert.equal(snapshot.transactions[0]!.status, 'CLEARED');
    assert.deepEqual(snapshot.accounts.find((a) => a.name === '자산:비어있음')!.tags, [
      { key: 'purpose', value: 'reserve' },
    ]);
    assert.deepEqual(snapshot.prices, [
      {
        commodity: 'USD',
        quoteCommodity: 'KRW',
        date: '2026-10-19',
        rate: '1350.2500',
        source: null,
      },
    ]);
    assert.equal(snapshot.transactions[0]!.postings[1]!.accountId, accountId('자산:은행'));
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

async function killDuringAppend(
  f: Awaited<ReturnType<typeof fixture>>,
  key: string,
  full: boolean,
): Promise<void> {
  const source = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module';
    const originalOpen = fs.open; fs.open = async function(path, flags, ...args) {
      const handle = await originalOpen(path, flags, ...args);
      if (path === ${JSON.stringify(f.journalPath)} && flags === 'a') {
        handle.writeFile = async function(data) { const bytes = Buffer.from(data); await handle.write(${full ? 'bytes' : 'bytes.subarray(0, 123)'}); await handle.sync(); process.kill(process.pid, 'SIGKILL'); };
      } return handle;
    }; syncBuiltinESMExports();
    const {createHledgerAdapter} = await import(${JSON.stringify(new URL('./hledger.ts', import.meta.url).href)});
    await createHledgerAdapter(${JSON.stringify({ journalPath: f.journalPath, hledgerPath })}).create(${JSON.stringify(input(key))});`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const [, signal] = await once(child, 'exit');
  assert.equal(signal, 'SIGKILL', stderr);
}

test('same-key replay preserves original result across adapter restart and changed input conflicts', async () => {
  const f = await fixture();
  try {
    const first = await f.adapter.create(input());
    assert.equal(first.replayed, false);
    const restarted = createHledgerAdapter({ journalPath: f.journalPath, hledgerPath });
    assert.deepEqual(await restarted.create(input()), {
      transaction: first.transaction,
      replayed: true,
    });
    assert.deepEqual((await restarted.read()).transactions, [first.transaction]);
    await assert.rejects(restarted.create({ ...input(), description: '다른 점심' }), {
      code: 'IDEMPOTENCY_CONFLICT',
    });
    assert.equal((await restarted.read()).transactions.length, 1);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('quoted asset units preserve symbols, case and exact quantities through create, read and same-key replay', async () => {
  const f = await fixture();
  const commodities = [
    'BTC',
    'AAPL',
    '005930',
    'BRK.B',
    '삼성전자',
    'custom unit',
    'a  b',
    ':@={}()[]+-,./$€¥',
    'unit\\name',
    ' spaced unit ',
    'btc',
    '🪙'.repeat(32),
  ];
  const value = '900719925474099312345.123456789012345678900000000001';
  try {
    const saved = [];
    for (const [index, commodity] of commodities.entries()) {
      const request = {
        ...input(`asset-unit-${index}`),
        postings: [
          { accountName: '자산:보유', amount: { commodity, value } },
          { accountName: '자본:기초', amount: { commodity, value: `-${value}` } },
        ],
      };
      const first = await f.adapter.create(request);
      assert.equal(first.replayed, false);
      assert.deepEqual(
        first.transaction.postings.map((posting) => posting.amount),
        [
          { commodity, value },
          { commodity, value: `-${value}` },
        ],
      );
      const restarted = createHledgerAdapter({ journalPath: f.journalPath, hledgerPath });
      assert.deepEqual(await restarted.create(request), {
        transaction: first.transaction,
        replayed: true,
      });
      saved.push(first.transaction);
    }
    assert.deepEqual((await f.adapter.read()).transactions, saved);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('canonical stock identity roundtrips fractional holdings without rewriting existing raw units', async () => {
  const existing =
    '2026-10-19 existing stock\n    자산:기존  2 "005930"\n    자본:기초  -2 "005930"\n';
  const f = await fixture(existing);
  const commodity = ledgerCommodity({
    kind: 'STOCK',
    symbol: '005930',
    exchange: 'KOSPI',
    source: 'kind',
  });
  const value = '0.123456789012345678900000000001';
  const request = {
    ...input('canonical-stock'),
    postings: [
      { accountName: '자산:보유', amount: { commodity, value } },
      { accountName: '자본:기초', amount: { commodity, value: `-${value}` } },
    ],
  };
  try {
    assert.equal(commodity, 'asset:stock:krx:005930');
    const created = await f.adapter.create(request);
    const journal = await readFile(f.journalPath, 'utf8');
    assert.ok(journal.startsWith(existing));
    assert.ok(journal.includes(`"${commodity}"`));
    const restarted = createHledgerAdapter({ journalPath: f.journalPath, hledgerPath });
    const snapshot = await restarted.read();
    assert.equal(snapshot.transactions[0]!.postings[0]!.amount.commodity, '005930');
    assert.deepEqual(
      snapshot.transactions[1]!.postings.map((posting) => posting.amount),
      [
        { commodity, value },
        { commodity, value: `-${value}` },
      ],
    );
    assert.deepEqual(await restarted.create(request), {
      transaction: created.transaction,
      replayed: true,
    });
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('unsupported commodity syntax returns its field error without changing journal bytes', async () => {
  const existing = '; keep this journal unchanged\n';
  const f = await fixture(existing);
  try {
    for (const commodity of [
      ' ',
      '   ',
      'a"b',
      'a;b',
      'a\\"b',
      'USD\ninclude x',
      'a\rb',
      'a\tb',
      'a\u0000b',
      'a\u007fb',
      'a\u0085b',
      'a\u2028b',
      'a\u2029b',
      '🪙'.repeat(33),
    ]) {
      const request = {
        ...input(),
        postings: [
          { accountName: '자산:보유', amount: { commodity, value: '1' } },
          { accountName: '자본:기초', amount: { commodity, value: '-1' } },
        ],
      };
      await assert.rejects(
        f.adapter.create(request),
        { code: 'INVALID_INPUT', path: 'postings[0].amount.commodity' },
        JSON.stringify(commodity),
      );
      assert.equal(await readFile(f.journalPath, 'utf8'), existing);
    }
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('reject journal syntax injection and invalid dates or unbalanced amounts before any write', async () => {
  const f = await fixture();
  try {
    for (const bad of [
      { ...input(), description: '밥\ninclude /tmp/secret' },
      { ...input(), description: '밥 ; hidden: value' },
      { ...input(), code: 'X) hacked (' },
      { ...input(), date: '2026-02-30' },
      {
        ...input(),
        postings: [{ ...input().postings[0]!, accountName: 'a  1 USD ;' }, input().postings[1]!],
      },
      {
        ...input(),
        postings: [{ ...input().postings[0]!, memo: '[2026-11-01]' }, input().postings[1]!],
      },
      {
        ...input(),
        postings: [{ ...input().postings[0]!, memo: 'date: 2026-11-01' }, input().postings[1]!],
      },
      { ...input(), tags: [{ key: 'hledger-app-v1', value: 'forged' }] },
      {
        ...input(),
        postings: [
          { ...input().postings[0]!, amount: { commodity: 'USD\ninclude x', value: '1' } },
          input().postings[1]!,
        ],
      },
      {
        ...input(),
        postings: [
          { ...input().postings[0]!, amount: { commodity: 'KRW', value: '1' } },
          input().postings[1]!,
        ],
      },
    ])
      await assert.rejects(
        f.adapter.create(bad),
        (error: any) =>
          error.code === 'INVALID_INPUT' ||
          error.code === 'UNBALANCED' ||
          error.code === 'MIXED_COMMODITY',
      );
    assert.equal(await readFile(f.journalPath, 'utf8'), '');
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('independent adapter instances serialize concurrent retries to a single durable transaction', async () => {
  const f = await fixture();
  try {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        createHledgerAdapter({ journalPath: f.journalPath, hledgerPath }).create(input()),
      ),
    );
    assert.equal(results.filter((r) => !r.replayed).length, 1);
    assert.equal((await f.adapter.read()).transactions.length, 1);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('revision observes edits to included journals and append does not rewrite includes', async () => {
  const f = await fixture('include included.journal\n');
  const includedPath = join(f.directory, 'included.journal');
  const existing = '2026-10-19 before\n    a  1 USD\n    b  -1 USD\n';
  await writeFile(includedPath, existing);
  try {
    const before = await f.adapter.read();
    await appendFile(includedPath, '\n2026-10-20 after\n    a  2 USD\n    b  -2 USD\n');
    assert.notEqual((await f.adapter.read()).revision, before.revision);
    const included = await readFile(includedPath, 'utf8');
    await f.adapter.create(input());
    assert.equal(await readFile(includedPath, 'utf8'), included);
    assert.ok((await readFile(f.journalPath, 'utf8')).startsWith('include included.journal\n'));
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('inferred multi-commodity balancing produces each exact posting amount', async () => {
  const f = await fixture(
    '2026-10-20 inferred\n    a  0.000000000000000000000000000001 BTC\n    a  2.000000000000000000000000000001 USD\n    b\n',
  );
  try {
    const postings = (await f.adapter.read()).transactions[0]!.postings;
    assert.deepEqual(
      postings.map((p) => [p.accountName, p.amount.commodity, p.amount.value]),
      [
        ['a', 'BTC', '0.000000000000000000000000000001'],
        ['a', 'USD', '2.000000000000000000000000000001'],
        ['b', 'BTC', '-0.000000000000000000000000000001'],
        ['b', 'USD', '-2.000000000000000000000000000001'],
      ],
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('price commodities can be prefixed symbols or quoted names', async () => {
  const f = await fixture(
    'P 2026-10-19 BTC $1350.2500\nP 2026-10-19 "space coin" 1 "quote coin"\n',
  );
  try {
    assert.deepEqual(
      (await f.adapter.read()).prices.map((p) => [p.commodity, p.quoteCommodity, p.rate]),
      [
        ['BTC', '$', '1350.2500'],
        ['space coin', 'quote coin', '1'],
      ],
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('quoted price units retain literal backslashes rather than interpreting JSON escapes', async () => {
  const f = await fixture('P 2026-10-19 "custom \\name" 1 "quote \\unit"\n');
  try {
    assert.deepEqual(
      (await f.adapter.read()).prices.map((p) => [p.commodity, p.quoteCommodity]),
      [['custom \\name', 'quote \\unit']],
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('localized CSV decimal marks and digit grouping preserve exact fractions', async () => {
  const f = await fixture(
    'commodity EUR\n  format 1.000,000000000000 EUR\n2026-10-19 localized\n    a  1.000,000000000001 EUR\n    b  -1.000,000000000001 EUR\n',
  );
  try {
    assert.equal(
      (await f.adapter.read()).transactions[0]!.postings[0]!.amount.value,
      '1000.000000000001',
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('external edits to original application transaction tags or status cannot be hidden by recovery metadata', async () => {
  for (const change of [
    (text: string) => text.replace('분류: 생활', '분류: edited'),
    (text: string) => text.replace('2026-10-20 (LUNCH', '2026-10-20 * (LUNCH'),
  ]) {
    const f = await fixture();
    try {
      await f.adapter.create(input());
      await writeFile(f.journalPath, change(await readFile(f.journalPath, 'utf8')));
      await assert.rejects(f.adapter.create(input()), { code: 'IDEMPOTENCY_METADATA_INVALID' });
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  }
});

test('aliases changing requested account names fail preflight without appending', async () => {
  const f = await fixture('alias 비용:식비 = 비용:다른계정\n');
  try {
    await assert.rejects(f.adapter.create(input()), { code: 'IDEMPOTENCY_METADATA_INVALID' });
    assert.equal(await readFile(f.journalPath, 'utf8'), 'alias 비용:식비 = 비용:다른계정\n');
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('a SIGKILL during append completes only its durable pending bytes on same-key retry', async () => {
  const f = await fixture();
  try {
    await killDuringAppend(f, 'torn', false);
    assert.equal((await readFile(f.journalPath)).length, 123);
    const interruptedJournal = await readFile(f.journalPath);
    const interruptedPending = await readFile(`${f.journalPath}.hledger-app.pending`);
    await assert.rejects(f.adapter.inspectReadOnly!(), { code: 'WRITE_RECOVERY_REQUIRED' });
    assert.deepEqual(await readFile(f.journalPath), interruptedJournal);
    assert.deepEqual(await readFile(`${f.journalPath}.hledger-app.pending`), interruptedPending);
    const retry = await createHledgerAdapter({ journalPath: f.journalPath, hledgerPath }).create(
      input('torn'),
    );
    assert.equal(retry.replayed, true);
    assert.equal((await f.adapter.read()).transactions.length, 1);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('a dead recovery-guard owner cannot block interrupted-write recovery after restart', async () => {
  for (const initialized of [false, true]) {
    const f = await fixture();
    try {
      await killDuringAppend(f, `guard-${initialized}`, false);
      const guard = `${f.journalPath}.hledger-app.lock.recovery`;
      const source = `import {mkdir,writeFile} from 'node:fs/promises';
        await mkdir(${JSON.stringify(guard)});
        ${initialized ? `await writeFile(${JSON.stringify(guard)} + '/' + process.pid + '.dead-guard-owner', '');` : ''}
        process.kill(process.pid, 'SIGKILL');`;
      const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
        stdio: 'ignore',
      });
      const [, signal] = await once(child, 'exit');
      assert.equal(signal, 'SIGKILL');
      const restarted = createHledgerAdapter({ journalPath: f.journalPath, hledgerPath });
      const retries = await Promise.all(
        Array.from({ length: initialized ? 5 : 1 }, () =>
          createHledgerAdapter({ journalPath: f.journalPath, hledgerPath }).create(
            input(`guard-${initialized}`),
          ),
        ),
      );
      assert.ok(retries.every((result) => result.replayed));
      assert.equal((await restarted.read()).transactions.length, 1);
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  }
});

test('completed append recovery preserves subsequently appended external transactions', async () => {
  const f = await fixture();
  try {
    await killDuringAppend(f, 'complete', true);
    await appendFile(f.journalPath, '\n2026-10-20 external\n    a  1 USD\n    b  -1 USD\n');
    assert.equal((await f.adapter.create(input('complete'))).replayed, true);
    const transactions = (await f.adapter.read()).transactions;
    assert.equal(transactions.length, 2);
    assert.equal(transactions[1]!.description, 'external');
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('external bytes overlapping a torn append require recovery without changing any journal bytes', async () => {
  const f = await fixture();
  try {
    await killDuringAppend(f, 'overlap', false);
    await appendFile(f.journalPath, '\n; external content added during interruption\n');
    const before = await readFile(f.journalPath);
    await assert.rejects(f.adapter.create(input('overlap')), { code: 'WRITE_RECOVERY_REQUIRED' });
    assert.deepEqual(await readFile(f.journalPath), before);
    assert.ok((await readFile(`${f.journalPath}.hledger-app.pending`)).length > 0);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('a writer process exiting after durable append but before response replays after restart', async () => {
  const f = await fixture();
  try {
    const source = `import {createHledgerAdapter} from ${JSON.stringify(new URL('./hledger.ts', import.meta.url).href)};
      await createHledgerAdapter(${JSON.stringify({ journalPath: f.journalPath, hledgerPath })}).create(${JSON.stringify(input('crash'))});
      process.exit(87);`;
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', source],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const [code] = await once(child, 'exit');
    assert.equal(code, 87, stderr);
    const retry = await createHledgerAdapter({ journalPath: f.journalPath, hledgerPath }).create(
      input('crash'),
    );
    assert.equal(retry.replayed, true);
    assert.equal((await f.adapter.read()).transactions.length, 1);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('stock costs round trip exact unit/total buy and sell, fees, replay and tamper detection', async () => {
  const f = await fixture();
  try {
    for (const type of ['UNIT', 'TOTAL'] as const) {
      for (const sell of [false, true]) {
        const trade: CreateTransactionInput = {
          idempotencyKey: `${type}-${sell}`,
          date: '2026-10-20',
          description: 'Stock trade',
          postings: [
            {
              accountName: 'assets:stock',
              amount: { commodity: 'BRK B', value: sell ? '-0.5' : '0.5' },
              cost: {
                type,
                amount: {
                  commodity: 'USD',
                  value:
                    type === 'UNIT'
                      ? '20.123456789012345678901234567890'
                      : '10.061728394506172839450617283945',
                },
              },
            },
            { accountName: 'expenses:fees', amount: { commodity: 'USD', value: '0.1' } },
            {
              accountName: 'assets:cash',
              amount: {
                commodity: 'USD',
                value: sell
                  ? '9.961728394506172839450617283945'
                  : '-10.161728394506172839450617283945',
              },
            },
          ],
        };
        const saved = await f.adapter.create(trade);
        assert.deepEqual(saved.transaction.postings[0]!.cost, trade.postings[0]!.cost);
        const restarted = createHledgerAdapter({ journalPath: f.journalPath, hledgerPath });
        assert.equal((await restarted.create(trade)).replayed, true);
        const reordered = structuredClone(trade);
        const cost = reordered.postings[0]!.cost!;
        cost.amount = { value: cost.amount.value, commodity: cost.amount.commodity };
        assert.equal((await restarted.create(reordered)).replayed, true);
        assert.deepEqual(
          (await restarted.read()).transactions.at(-1)!.postings[0]!.cost,
          trade.postings[0]!.cost,
        );
        const changed = structuredClone(trade);
        changed.postings[0]!.cost!.amount.value = '1';
        await assert.rejects(restarted.create(changed));
      }
    }
    const journal = await readFile(f.journalPath, 'utf8');
    assert.match(journal, / @ 20\.123456789012345678901234567890 "USD"/);
    assert.match(journal, / @@ 10\.061728394506172839450617283945 "USD"/);
    await writeFile(
      f.journalPath,
      journal.replace(
        /@ 20\.123456789012345678901234567890/,
        '@ 20.123456789012345678901234567891',
      ),
    );
    await assert.rejects(f.adapter.read());
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('cost commodity journal injection is rejected before writing', async () => {
  const f = await fixture();
  try {
    const trade: CreateTransactionInput = {
      idempotencyKey: 'unsafe-cost',
      date: '2026-10-20',
      description: 'Stock',
      postings: [
        {
          accountName: 'assets:stock',
          amount: { commodity: 'ABC', value: '1' },
          cost: { type: 'UNIT', amount: { commodity: 'USD; injected', value: '10' } },
        },
        { accountName: 'assets:cash', amount: { commodity: 'USD; injected', value: '-10' } },
      ],
    };
    await assert.rejects(f.adapter.create(trade), { code: 'INVALID_INPUT' });
    assert.equal(await readFile(f.journalPath, 'utf8'), '');
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('external cost annotations preserve fractions beyond JSON precision and localized styles', async () => {
  const f = await fixture(`commodity USD
  format 1.000,000000000000000000000000000000 USD
2026-10-20 External
    assets:stock  0.5 ABC @ 20,123456789012345678901234567890 USD
    assets:cash  -10,061728394506172839450617283945 USD
`);
  try {
    const snapshot = await f.adapter.read();
    assert.deepEqual(snapshot.transactions[0]!.postings[0]!.cost, {
      type: 'UNIT',
      amount: { commodity: 'USD', value: '20.123456789012345678901234567890' },
    });
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('external virtual stock postings fail closed before being counted as ordinary holdings', async () => {
  const f = await fixture(`2026-10-20 Virtual stock
    assets:stock  1 ABC @ 10 USD
    assets:cash  -10 USD
    (memo:tracked)  1 ABC @ 10 USD
`);
  try {
    await assert.rejects(
      f.adapter.read(),
      (error) =>
        error instanceof Error &&
        (error as { code?: string }).code === 'UPSTREAM_FORMAT' &&
        /virtual posting/.test(error.message),
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('external lot cost basis annotations fail closed instead of disappearing from copy', async () => {
  const f = await fixture(`2026-10-20 Lot basis
    assets:stock  1 ABC {10 USD} @ 10 USD
    assets:cash  -10 USD
`);
  try {
    await assert.rejects(
      f.adapter.read(),
      (error) =>
        error instanceof Error &&
        (error as { code?: string }).code === 'UPSTREAM_FORMAT' &&
        /cost basis/.test(error.message),
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test('read-only inspection preserves pending recovery and generic reads do not reconstruct managed books', async () => {
  const f = await fixture('');
  try {
    const malformed = {
      ...input('malformed-book'),
      tags: [
        { key: 'book.action', value: 'PURCHASE' },
        { key: 'book.copy', value: 'bad' },
      ],
    };
    await f.adapter.create(malformed);
    assert.equal((await f.adapter.inspectReadOnly!()).transactions.length, 1);
    assert.equal((await f.adapter.read()).transactions.length, 1);
    const journal = await readFile(f.journalPath);
    const pendingPath = `${f.journalPath}.hledger-app.pending`;
    const pending = Buffer.from('incomplete pending metadata');
    await writeFile(pendingPath, pending);
    await assert.rejects(f.adapter.inspectReadOnly!(), { code: 'WRITE_RECOVERY_REQUIRED' });
    assert.deepEqual(await readFile(f.journalPath), journal);
    assert.deepEqual(await readFile(pendingPath), pending);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
