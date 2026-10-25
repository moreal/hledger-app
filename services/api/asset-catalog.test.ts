import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { getCompanyLogo } from '../../packages/domain/src/company-logos.ts';
import type { Asset } from '../../packages/domain/src/asset-catalog.ts';
import {
  createAssetCatalog,
  parseKindCatalog,
  decodeKindCatalog,
  KIND_URL,
  parseNasdaqDirectory,
  parseSecCatalog,
  parseKrxCatalog,
  readCatalogSnapshot,
  writeCatalogSnapshot,
  refreshCatalog,
} from './asset-catalog.ts';

const currentStamp = new Date()
  .toISOString()
  .slice(0, 10)
  .replace(/(\d{4})-(\d{2})-(\d{2})/, '$2$3$1');
const listed = `Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N
ZZZT|Test Security|Q|Y|N|100|N|N
File Creation Time: ${currentStamp}21:31|||||||
`;
const others = `ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
AAPL|An unrelated issuer|N|AAPL|N|100|N|AAPL
BRK.B|Berkshire Hathaway Class B|N|BRK.B|N|100|N|BRK.B
File Creation Time: ${currentStamp}21:31|||||||
`;
const date = '2026-10-20';
const fresh = () => new Date().toISOString();
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'asset-catalog-'));
  return {
    dir,
    path: join(dir, 'catalog.json'),
    dispose: () => rm(dir, { recursive: true, force: true }),
  };
}

test('Nasdaq validates complete official files and excludes test issues', () => {
  const items = parseNasdaqDirectory(listed, 'nasdaqlisted', date);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.id, 'nasdaq:NASDAQ:AAPL');
  assert.equal(items[0]!.iconUrl, null);
  assert.throws(
    () => parseNasdaqDirectory(listed.replace(/File Creation Time:.*\n/, ''), 'nasdaqlisted', date),
    /Incomplete/,
  );
  assert.throws(
    () => parseNasdaqDirectory(listed.replace('|Q|N|N|', '|Q|maybe|N|'), 'nasdaqlisted', date),
    /flag/,
  );
  assert.throws(
    () =>
      parseNasdaqDirectory(listed.replace('AAPL|Apple', 'AAPL|extra|Apple'), 'nasdaqlisted', date),
    /row/,
  );
});

test('exchange-qualified IDs preserve ticker punctuation and disambiguate symbols', () => {
  const one = parseNasdaqDirectory(listed, 'nasdaqlisted', date)[0]!;
  const two = parseNasdaqDirectory(others, 'otherlisted', date);
  assert.notEqual(one.id, two[0]!.id);
  assert.equal(two[1]!.symbol, 'BRK.B');
  assert.equal(two[1]!.id, 'nasdaq:NYSE:BRK.B');
});

test('SEC parser requires exchange-aware official schema and does not invent listing exchanges', () => {
  const items = parseSecCatalog(
    {
      fields: ['cik', 'name', 'ticker', 'exchange'],
      data: [
        [320193, 'Apple Inc.', 'AAPL', 'Nasdaq'],
        [123, 'Unlisted issuer', 'PRIVATE', null],
      ],
    },
    date,
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]!.source, 'sec');
  assert.throws(
    () => parseSecCatalog({ '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple' } }, date),
    /Invalid SEC/,
  );
  assert.throws(
    () => parseSecCatalog({ fields: ['name', 'ticker'], data: [] }, date),
    /listing fields/,
  );
});

test('KRX parser preserves six-digit codes, exact ISIN and named market', () => {
  const [item] = parseKrxCatalog(
    { OutBlock_1: [{ ISU_CD: 'KR7005930003', ISU_SRT_CD: '005930', ISU_NM: '삼성전자' }] },
    'KOSPI',
    '20261020',
  );
  assert.equal(item!.symbol, '005930');
  assert.equal(item!.isin, 'KR7005930003');
  assert.equal(item!.asOf, date);
  assert.equal(item!.id, 'krx:KOSPI:005930');
  assert.throws(() => parseKrxCatalog({ OutBlock_1: [] }, 'KOSPI', '20261020'), /empty/);
  assert.throws(
    () => parseKrxCatalog({ OutBlock_1: [{ ISU_CD: 'bad' }] }, 'KOSPI', '20261020'),
    /ISIN/,
  );
  assert.throws(() => parseKrxCatalog({}, 'KOSPI', '2026-10-20'), /basis-date/);
});

test('missing cache serves sourced currencies and curated crypto with useful provider status', async () => {
  const f = await fixture();
  try {
    const catalog = createAssetCatalog({ snapshotPath: f.path });
    const usd = await catalog.search('USD');
    assert.equal(usd.items[0]!.symbol, 'USD');
    assert.equal(usd.items[0]!.source, 'iso4217');
    assert.equal(usd.providers.find((p) => p.provider === 'iso4217')!.updatedAt, null);
    for (const provider of usd.providers) {
      if (provider.updatedAt !== null)
        assert.match(provider.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
    }
    const btc = await catalog.search('BTC');
    assert.equal(btc.items[0]!.iconText, '₿');
    assert.equal(btc.items[0]!.iconUrl, null);
    assert.equal(btc.items[0]!.asOf, null);
    assert.equal((await catalog.search('my arbitrary ledger unit')).items.length, 0);
    assert.equal(await catalog.get('nasdaq:NASDAQ:AAPL'), null);
    assert.equal(usd.providers.find((p) => p.provider === 'nasdaq')!.status, 'UNAVAILABLE');
  } finally {
    await f.dispose();
  }
});

test('snapshot-backed searches rank exact ticker before prefixes and names, with stable exchange ties', async () => {
  const f = await fixture();
  try {
    const assets = [
      ...parseNasdaqDirectory(listed, 'nasdaqlisted', date),
      ...parseNasdaqDirectory(others, 'otherlisted', date),
    ];
    assets.push({ ...assets[0]!, id: 'nasdaq:NASDAQ:AAPLX', symbol: 'AAPLX', name: 'Prefix' });
    assets.push({ ...assets[0]!, id: 'nasdaq:NASDAQ:OTHER', symbol: 'OTHER', name: 'AAPL Fund' });
    await writeCatalogSnapshot(f.path, 'nasdaq', assets, fresh());
    const catalog = createAssetCatalog({ snapshotPath: f.path });
    const result = await catalog.search('  aapl  ');
    assert.deepEqual(
      result.items.map((item) => item.symbol),
      ['AAPL', 'AAPL', 'AAPLX', 'OTHER'],
    );
    assert.deepEqual(
      result.items.slice(0, 2).map((item) => item.exchange),
      ['NASDAQ', 'NYSE'],
    );
    assert.equal(result.providers.find((p) => p.provider === 'nasdaq')!.status, 'READY');
    assert.deepEqual(await catalog.get(assets[0]!.id), {
      ...assets[0],
      iconUrl: getCompanyLogo(assets[0]!)!.imageUrl,
    });
    assert.equal(result.items[1]!.iconUrl, null);
    assert.equal((await catalog.search('aapl', 1)).items.length, 1);
    for (const limit of [0, -1, 101, 1.5, NaN])
      await assert.rejects(catalog.search('a', limit), /limit/);
    await assert.rejects(catalog.search('a'.repeat(201)), /200/);
  } finally {
    await f.dispose();
  }
});

test('a stale cache remains searchable and invalid snapshots fail gracefully', async () => {
  const f = await fixture();
  try {
    const catalog = createAssetCatalog({ snapshotPath: f.path });
    await writeCatalogSnapshot(
      f.path,
      'nasdaq',
      parseNasdaqDirectory(listed, 'nasdaqlisted', date),
      '2000-01-01T00:00:00Z',
    );
    let result = await catalog.search('AAPL');
    assert.equal(result.items.length, 1);
    assert.equal(result.providers.find((p) => p.provider === 'nasdaq')!.status, 'STALE');
    await writeFile(f.path, '{truncated');
    result = await catalog.search('USD');
    assert.equal(result.items.length, 1);
    assert.equal(result.providers.find((p) => p.provider === 'nasdaq')!.status, 'UNAVAILABLE');
    await assert.rejects(
      writeCatalogSnapshot(
        f.path,
        'nasdaq',
        parseNasdaqDirectory(listed, 'nasdaqlisted', date),
        fresh(),
      ),
      /preserve/,
    );
    assert.equal(await readFile(f.path, 'utf8'), '{truncated');
  } finally {
    await f.dispose();
  }
});

test('provider refresh preserves other providers and rejected imports preserve the last good file', async () => {
  const f = await fixture();
  try {
    const sec = parseSecCatalog(
      { fields: ['name', 'ticker', 'exchange'], data: [['Apple Inc.', 'AAPL', 'Nasdaq']] },
      date,
    );
    await writeCatalogSnapshot(f.path, 'sec', sec, fresh());
    const input = join(f.dir, 'nasdaqlisted.txt');
    const otherInput = join(f.dir, 'otherlisted.txt');
    await writeFile(input, listed);
    await writeFile(otherInput, others);
    const result = await refreshCatalog({ provider: 'nasdaq', output: f.path, input, otherInput });
    assert.equal(result.count, 3);
    assert.equal((await readCatalogSnapshot(f.path)).providers.length, 2);
    const before = await readFile(f.path, 'utf8');
    await writeFile(otherInput, 'partial invalid response');
    await assert.rejects(
      refreshCatalog({ provider: 'nasdaq', output: f.path, input, otherInput }),
      /Incomplete/,
    );
    assert.equal(await readFile(f.path, 'utf8'), before);
  } finally {
    await f.dispose();
  }
});

test('reviewed public logos take priority; optional Brandfetch covers other exact ISINs', async () => {
  const f = await fixture();
  try {
    const krx = parseKrxCatalog(
      { OutBlock_1: [{ ISU_CD: 'KR7005930003', ISU_SRT_CD: '005930', ISU_NM: '삼성전자' }] },
      'KOSPI',
      '20261020',
    );
    await writeCatalogSnapshot(f.path, 'krx', krx, fresh());
    const keyless = createAssetCatalog({ snapshotPath: f.path });
    assert.equal(
      (await keyless.search('005930')).items[0]!.iconUrl,
      getCompanyLogo(krx[0]!)!.imageUrl,
    );
    const catalog = createAssetCatalog({
      snapshotPath: f.path,
      brandfetchClientId: 'public-client',
    });
    assert.equal(
      (await catalog.search('005930')).items[0]!.iconUrl,
      getCompanyLogo(krx[0]!)!.imageUrl,
    );
    const other = { ...krx[0]!, id: 'krx:KOSPI:000001', symbol: '000001', name: 'Other issuer' };
    await writeCatalogSnapshot(f.path, 'krx', [other], fresh());
    assert.match(
      (await catalog.search('000001')).items[0]!.iconUrl!,
      /^https:\/\/cdn\.brandfetch\.io\/isin\/KR7005930003\//,
    );
    assert.equal((await catalog.search('USD')).items[0]!.iconUrl, null);
    assert.ok((await catalog.search('000001')).items[0]!.iconText);
  } finally {
    await f.dispose();
  }
});

test('new official exchange codes are retained without guessing an exchange name', () => {
  const input = others.replace('|N|AAPL|', '|F|AAPL|');
  const item = parseNasdaqDirectory(input, 'otherlisted', date)[0]!;
  assert.equal(item.exchange, 'NASDAQ_CODE:F');
  assert.equal(item.id, 'nasdaq:NASDAQ_CODE%3AF:AAPL');
});

test('simultaneous provider writes in the same process retain both complete catalogs', async () => {
  const f = await fixture();
  try {
    const sec = parseSecCatalog(
      { fields: ['name', 'ticker', 'exchange'], data: [['Apple Inc.', 'AAPL', 'Nasdaq']] },
      date,
    );
    const krx = parseKrxCatalog(
      { OutBlock_1: [{ ISU_CD: 'KR7005930003', ISU_SRT_CD: '005930', ISU_NM: '삼성전자' }] },
      'KOSPI',
      '20261020',
    );
    await Promise.all([
      writeCatalogSnapshot(f.path, 'sec', sec, fresh()),
      writeCatalogSnapshot(f.path, 'krx', krx, fresh()),
    ]);
    const result = await readCatalogSnapshot(f.path);
    assert.deepEqual(result.providers.map((p) => p.provider).sort(), ['krx', 'sec']);
    assert.deepEqual(result.providers.find((p) => p.provider === 'sec')!.assets, sec);
    assert.deepEqual(result.providers.find((p) => p.provider === 'krx')!.assets, krx);
  } finally {
    await f.dispose();
  }
});

function independentWriter(path: string, provider: 'sec' | 'krx', assets: Asset[]) {
  // Delay the data-file replacement to force overlapping refreshes without relying on scheduling.
  const source = `import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    import {setTimeout as delay} from 'node:timers/promises';
    const originalRename = fs.rename;
    fs.rename = async function(from, to) { if (from.endsWith('.tmp')) await delay(100); return originalRename(from, to); };
    syncBuiltinESMExports();
    const {writeCatalogSnapshot} = await import(${JSON.stringify(new URL('./asset-catalog.ts', import.meta.url).href)});
    process.send('ready');
    await new Promise(resolve => process.once('message', resolve));
    try { await writeCatalogSnapshot(${JSON.stringify(path)}, ${JSON.stringify(provider)}, ${JSON.stringify(assets)}, ${JSON.stringify(fresh())}); }
    catch (error) { console.error(error); process.exitCode = 1; }
    finally { process.disconnect(); }`;
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr!.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const ready = once(child, 'message');
  const completed = once(child, 'close').then(([code]) => {
    assert.equal(code, 0, stderr);
  });
  return { child, ready, completed };
}

test('separate refresh processes serialize the read/merge/replace transaction', async () => {
  const f = await fixture();
  const writers: ReturnType<typeof independentWriter>[] = [];
  try {
    await writeCatalogSnapshot(
      f.path,
      'nasdaq',
      parseNasdaqDirectory(listed, 'nasdaqlisted', date),
      fresh(),
    );
    const sec = parseSecCatalog(
      { fields: ['name', 'ticker', 'exchange'], data: [['Apple Inc.', 'AAPL', 'Nasdaq']] },
      date,
    );
    const krx = parseKrxCatalog(
      { OutBlock_1: [{ ISU_CD: 'KR7005930003', ISU_SRT_CD: '005930', ISU_NM: '삼성전자' }] },
      'KOSPI',
      '20261020',
    );
    writers.push(independentWriter(f.path, 'sec', sec), independentWriter(f.path, 'krx', krx));
    await Promise.all(writers.map((writer) => writer.ready));
    for (const writer of writers) writer.child.send('start');
    await Promise.all(writers.map((writer) => writer.completed));
    const result = await readCatalogSnapshot(f.path);
    assert.deepEqual(result.providers.map((p) => p.provider).sort(), ['krx', 'nasdaq', 'sec']);
    assert.deepEqual(result.providers.find((p) => p.provider === 'sec')!.assets, sec);
    assert.deepEqual(result.providers.find((p) => p.provider === 'krx')!.assets, krx);
    assert.deepEqual(await readdir(f.dir), ['catalog.json']);
  } finally {
    for (const writer of writers) writer.child.kill();
    await f.dispose();
  }
});

test('a terminated refresh owner is reclaimable and temporary lock directories are removed', async () => {
  const f = await fixture();
  try {
    const deadOwner = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    await once(deadOwner, 'close');
    assert.ok(deadOwner.pid);
    await mkdir(`${f.path}.lock`);
    await writeFile(join(`${f.path}.lock`, `${deadOwner.pid}.dead-refresh`), '');
    const sec = parseSecCatalog(
      { fields: ['name', 'ticker', 'exchange'], data: [['Apple Inc.', 'AAPL', 'Nasdaq']] },
      date,
    );
    await writeCatalogSnapshot(f.path, 'sec', sec, fresh());
    assert.equal((await readCatalogSnapshot(f.path)).providers[0]!.provider, 'sec');
    assert.deepEqual(await readdir(f.dir), ['catalog.json']);
  } finally {
    await f.dispose();
  }
});

test('provider timestamps reject publication-only dates before they reach GraphQL DateTime fields', async () => {
  const f = await fixture();
  try {
    const assets = parseNasdaqDirectory(listed, 'nasdaqlisted', date);
    await assert.rejects(
      writeCatalogSnapshot(f.path, 'nasdaq', assets, '2026-10-20'),
      /Invalid catalog provider/,
    );
    await writeCatalogSnapshot(f.path, 'nasdaq', assets, fresh());
    const result = await createAssetCatalog({ snapshotPath: f.path }).search('AAPL');
    for (const provider of result.providers) {
      if (provider.updatedAt !== null)
        assert.match(provider.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
    }
  } finally {
    await f.dispose();
  }
});

const kindExport = `<html><table><tr><th>회사명</th><th>시장구분</th><th>종목코드</th><th>상장일</th></tr><tr><td>삼성전자</td><td>유가증권</td><td style="mso-number-format:'@'">005930</td><td>1975-06-11</td></tr><tr><td>새회사 &amp; 파트너</td><td>코스닥</td><td>0013Y0</td><td>2026-10-22</td></tr></table></html>`;
test('KIND Excel HTML preserves names, six character codes and reliable market identities', () => {
  const items = parseKindCatalog(kindExport, date);
  assert.deepEqual(
    items.map((item) => [item.id, item.symbol, item.name, item.exchange]),
    [
      ['kind:KOSPI:005930', '005930', '삼성전자', 'KOSPI'],
      ['kind:KOSDAQ:0013Y0', '0013Y0', '새회사 & 파트너', 'KOSDAQ'],
    ],
  );
  assert.equal(
    parseKindCatalog(kindExport.replace('유가증권', '유가'), date)[0]!.exchange,
    'KOSPI',
  );
  assert.equal(items[0]!.sourceUrl, KIND_URL);
  assert.equal(items[0]!.isin, null);
  assert.equal(items[0]!.asOf, date);
  assert.equal(parseKindCatalog(kindExport.replace('005930', '5930'), date)[0]!.symbol, '005930');
  assert.equal(
    parseKindCatalog(kindExport.replace('1975-06-11', 'unused \uFFFD description'), date)[0]!.name,
    '삼성전자',
  );
  const legacy =
    '<table><tr><th>회사명</th><th>종목코드</th></tr><tr><td>삼성전자</td><td>005930</td></tr></table>';
  assert.equal(parseKindCatalog(legacy, date)[0]!.exchange, 'KRX');
  assert.equal(parseKindCatalog(legacy, date, 'KOSPI')[0]!.exchange, 'KOSPI');
  assert.throws(() => parseKindCatalog(kindExport, date, 'KOSPI'), /market/);
});
test('KIND decoding supports UTF-8 and official EUC-KR Korean headers', () => {
  assert.equal(decodeKindCatalog(Buffer.from(kindExport)), kindExport);
  // EUC-KR bytes for 회사명, from the official export header.
  assert.equal(decodeKindCatalog(Uint8Array.from([0xc8, 0xb8, 0xbb, 0xe7, 0xb8, 0xed])), '회사명');
});
test('KIND rejects empty, malformed, login, duplicate and potentially truncated exports', () => {
  for (const input of [
    '',
    '<html><form action="login">Login</form></html>',
    '<table><tr><th>회사명</th><th>종목코드</th></tr></table>',
    kindExport.replace('005930', 'bad'),
    kindExport.replace('코스닥', 'unknown'),
    kindExport.replace('0013Y0', '005930'),
    kindExport.replace('</tr></table>', '</table>'),
    kindExport.replace('삼성전자', '\uFFFD'),
  ])
    assert.throws(() => parseKindCatalog(input, date));
  const row = '<tr><td>삼성전자</td><td>005930</td></tr>';
  assert.throws(
    () =>
      parseKindCatalog(
        '<table><tr><th>회사명</th><th>종목코드</th></tr>' + row.repeat(3000) + '</table>',
        date,
      ),
    /truncated/,
  );
});
test('KIND offline refresh keeps export age honest and failed imports preserve previous catalogs', async () => {
  const f = await fixture();
  try {
    await writeCatalogSnapshot(
      f.path,
      'sec',
      parseSecCatalog(
        { fields: ['name', 'ticker', 'exchange'], data: [['Apple', 'AAPL', 'Nasdaq']] },
        date,
      ),
      fresh(),
    );
    const input = join(f.dir, 'kind.xls');
    await writeFile(input, kindExport);
    await assert.rejects(
      refreshCatalog({ provider: 'kind', output: f.path, input }),
      /export date/,
    );
    await refreshCatalog({ provider: 'kind', output: f.path, input, basisDate: '20000101' });
    const result = await createAssetCatalog({ snapshotPath: f.path }).search('삼성');
    assert.equal(result.items[0]!.symbol, '005930');
    assert.equal(result.providers.find((p) => p.provider === 'kind')!.status, 'STALE');
    assert.equal((await readCatalogSnapshot(f.path)).providers.length, 2);
    const before = await readFile(f.path, 'utf8');
    await writeFile(input, '<html>로그인</html>');
    await assert.rejects(
      refreshCatalog({ provider: 'kind', output: f.path, input, basisDate: '20261022' }),
      /KIND/,
    );
    assert.equal(await readFile(f.path, 'utf8'), before);
  } finally {
    await f.dispose();
  }
});

test('KIND live refresh downloads each official market without credentials and rejects partial failures atomically', async (context) => {
  const f = await fixture();
  const requested: string[] = [];
  let fail = false;
  context.mock.method(globalThis, 'fetch', async (url: string) => {
    requested.push(url);
    const market = new URL(url).searchParams.get('marketType');
    if (fail && market === 'kosdaqMkt') return new Response('<html>Access denied</html>');
    const [name, code] =
      market === 'stockMkt'
        ? ['유가증권', '005930']
        : market === 'kosdaqMkt'
          ? ['코스닥', '0013Y0']
          : ['코넥스', '000001'];
    return new Response(
      `<table><tr><th>회사명</th><th>시장구분</th><th>종목코드</th></tr><tr><td>회사 ${name}</td><td>${name}</td><td>${code}</td></tr></table>`,
    );
  });
  try {
    const refreshed = await refreshCatalog({ provider: 'kind', output: f.path });
    assert.equal(refreshed.count, 3);
    assert.deepEqual(
      requested.map((url) => new URL(url).searchParams.get('marketType')),
      ['stockMkt', 'kosdaqMkt', 'konexMkt'],
    );
    const snapshot = await readCatalogSnapshot(f.path);
    assert.ok(
      snapshot.providers[0]!.assets.every(
        (asset) => asset.asOf === refreshed.updatedAt.slice(0, 10),
      ),
    );
    const before = await readFile(f.path, 'utf8');
    fail = true;
    await assert.rejects(refreshCatalog({ provider: 'kind', output: f.path }), /KIND/);
    assert.equal(await readFile(f.path, 'utf8'), before);
  } finally {
    await f.dispose();
  }
});
