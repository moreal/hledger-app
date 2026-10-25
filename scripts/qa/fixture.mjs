#!/usr/bin/env node
// Isolated fake QA data. Never reads an existing journal or the user's API configuration.
import { mkdir, readFile, writeFile, realpath, stat, unlink, appendFile } from 'node:fs/promises';
import { openSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE = '/private/tmp/hledger-qa-full-fixture';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PORTS = { ios: 4200, android: 4201, empty: 4204 };
export function runPath(name) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name ?? ''))
    throw Error('A named run (letters, digits, _ or -) is required');
  return `${BASE}/${name}`;
}
export function seedJournal() {
  let text = '; SYNTHETIC QA ONLY — no personal data\n';
  for (const account of [
    '자산',
    '자산:예금',
    '자산:예금:생활비 통장',
    '자산:현금',
    '자산:현금:해외여행 지갑',
    '자산:책',
    '자산:증권',
    '비용:생활:식비',
    '비용:배움:도서',
    '비용:투자수수료',
    '수입:투자손익',
    '자본:기초잔액',
    'assets:qa-zero:history',
    'equity:qa-zero',
    ...Array.from({ length: 65 }, (_, i) => `자산:QA:${String(i + 1).padStart(3, '0')}`),
  ])
    text += `account ${account}\n`;
  for (let i = 1; i <= 65; i++) text += `P 2026-10-24 "QA${String(i).padStart(3, '0')}" ${i} KRW\n`;
  text += 'P 2026-10-24 USD 1350 KRW\nP 2026-10-24 AAPL 225 USD\n';
  for (let i = 1; i <= 65; i++)
    text += `\n2026-10-20 * ${i === 1 ? '(QA001) ' : ''}QA 가상 거래 ${String(i).padStart(3, '0')}${i === 1 ? '  ; qa: native' : ''}\n    자산:예금:생활비 통장  ${i} KRW\n    자본:기초잔액  -${i} KRW\n`;
  for (let i = 1; i <= 65; i++)
    text += `\n2026-10-19 * QA 계정 잔액 ${i}\n    자산:QA:${String(i).padStart(3, '0')}  1 KRW\n    자본:기초잔액  -1 KRW\n`;
  text +=
    '\n2026-10-01 * QA005 historical nonzero\n    assets:qa-zero:history  10 KRW\n    equity:qa-zero  -10 KRW\n\n2026-10-02 * QA005 historical zero\n    assets:qa-zero:history  -10 KRW\n    equity:qa-zero  10 KRW\n';
  return text;
}
async function load(name) {
  const root = runPath(name);
  if ((await realpath(root)) !== root) throw Error('Symlink run directories are forbidden');
  const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'));
  if (manifest.kind !== 'hledger-synthetic-full-qa-v1' || manifest.name !== name)
    throw Error('Unrecognized fixture manifest');
  for (const platform of Object.keys(PORTS)) {
    const journal = `${root}/${platform}/ledger.journal`;
    if (
      (await realpath(journal)) !== journal ||
      manifest.ledgers[platform] !== createHash('sha256').update(journal).digest('hex')
    )
      throw Error('Fixture ledger identity mismatch');
  }
  return { root, manifest };
}
export async function newRun(name) {
  const root = runPath(name);
  await mkdir(BASE, { recursive: true });
  if ((await realpath(BASE)) !== BASE) throw Error('Symlink fixture base is forbidden');
  await mkdir(root); // Deliberately fails if the run already exists: never silently reset UI state.
  const ledgers = {};
  const { createHledgerAdapter } = await import(`${REPO}/services/api/hledger.ts`);
  const { purchaseBook, disposeBook } = await import(`${REPO}/services/api/books.ts`);
  for (const platform of Object.keys(PORTS)) {
    const dir = `${root}/${platform}`;
    await mkdir(dir);
    const journalPath = `${dir}/ledger.journal`;
    await writeFile(journalPath, platform === 'empty' ? '; SYNTHETIC EMPTY QA\n' : seedJournal());
    await writeFile(`${dir}/token`, randomBytes(24).toString('hex'), { mode: 0o600 });
    ledgers[platform] = createHash('sha256').update(journalPath).digest('hex');
    if (platform === 'empty') continue;
    const adapter = createHledgerAdapter({ journalPath, hledgerPath: '/opt/homebrew/bin/hledger' });
    for (const state of ['held', 'sell', 'discard', 'sell-ready', 'discard-ready']) {
      const { book } = await purchaseBook(adapter, {
        idempotencyKey: `fixture-${state}`,
        date: '2026-10-24',
        isbn: '9780306406157',
        title: `QA 가상 ${state} 책`,
        authors: ['QA 가상 저자'],
        purchasePrice: { commodity: 'KRW', value: '15000' },
        assetAccount: '자산:책',
        cashAccount: '자산:예금:생활비 통장',
      });
      if (['sell', 'discard'].includes(state))
        await disposeBook(adapter, {
          idempotencyKey: `fixture-dispose-${state}`,
          date: '2026-10-24',
          copyId: book.id,
          kind: state === 'sell' ? 'SELL' : 'DISCARD',
          cashAccount: '자산:예금:생활비 통장',
          ...(state === 'sell' ? { saleProceeds: { commodity: 'KRW', value: '16000' } } : {}),
        });
    }
  }
  await writeFile(
    `${root}/manifest.json`,
    JSON.stringify({ kind: 'hledger-synthetic-full-qa-v1', name, ledgers, ports: PORTS }, null, 2),
  );
  return { root, ports: PORTS };
}
async function gql(root, platform, query, variables = {}) {
  const token = (await readFile(`${root}/${platform}/token`, 'utf8')).trim();
  const response = await fetch(`http://127.0.0.1:${PORTS[platform]}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json();
  if (!response.ok || body.errors) throw Error(JSON.stringify(body));
  const expected = createHash('sha256').update(`${root}/${platform}/ledger.journal`).digest('hex');
  if (body.data?.health?.details?.ledgerId !== expected)
    throw Error('Server ledger identity mismatch');
  return body.data;
}
async function start(name) {
  const { root } = await load(name);
  // Reserve every requested listener before launching anything; another run must not be displaced.
  const reservations = [];
  try {
    for (const port of [...Object.values(PORTS), 4202, 4203]) {
      const listener = createServer();
      await new Promise((ok, fail) => {
        listener.once('error', fail);
        listener.listen(port, '127.0.0.1', ok);
      });
      reservations.push(listener);
    }
  } finally {
    for (const listener of reservations) await new Promise((done) => listener.close(done));
  }
  for (const platform of [...Object.keys(PORTS), 'proxy-ios', 'proxy-android']) {
    const dir = `${root}/${platform.replace('proxy-', '')}`,
      pidPath = `${dir}/${platform.startsWith('proxy-') ? 'proxy' : 'api'}.pid`;
    try {
      const pid = Number(await readFile(pidPath, 'utf8'));
      process.kill(pid, 0);
      throw Error(`Already running: ${platform}`);
    } catch (e) {
      if (!['ENOENT', 'ESRCH'].includes(e.code)) throw e;
    }
    const proxy = platform.startsWith('proxy-'),
      log = openSync(`${dir}/${proxy ? 'proxy' : 'api'}.log`, 'a');
    const args = proxy
      ? [fileURLToPath(import.meta.url), 'serve-proxy', name, platform.slice(6)]
      : ['--import', `${REPO}/node_modules/tsx/dist/loader.mjs`, `${REPO}/services/api/server.ts`];
    const token = await readFile(`${dir}/token`, 'utf8');
    const child = spawn(process.execPath, args, {
      cwd: REPO,
      detached: true,
      stdio: ['ignore', log, log],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        HLEDGER_JOURNAL: `${dir}/ledger.journal`,
        HLEDGER_API_TOKEN: token,
        HLEDGER_HOST: '127.0.0.1',
        HLEDGER_PORT: String(PORTS[platform]),
        HLEDGER_BIN: '/opt/homebrew/bin/hledger',
        HLEDGER_DEFAULT_COMMODITY: 'KRW',
        HLEDGER_ASSET_CATALOG_PATH: `${dir}/catalog.json`,
        HLEDGER_ASSET_METADATA_PATH: `${dir}/assets.json`,
      },
    });
    child.unref();
    await writeFile(pidPath, String(child.pid));
  }
  for (let i = 0; i < 40; i++) {
    try {
      for (const p of Object.keys(PORTS)) await gql(root, p, '{ health { status details } }');
      return { started: name };
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw Error('Fixture startup timed out; inspect run logs');
}
async function stop(name) {
  const { root } = await load(name);
  for (const p of Object.keys(PORTS))
    for (const kind of ['api', 'proxy']) {
      const path = `${root}/${p}/${kind}.pid`;
      let pid;
      try {
        pid = Number(await readFile(path, 'utf8'));
      } catch (e) {
        if (e.code === 'ENOENT') continue;
        throw e;
      }
      let command;
      try {
        command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
      } catch {
        continue;
      }
      if (kind === 'api') {
        const env = execFileSync('ps', ['eww', '-p', String(pid), '-o', 'command='], {
          encoding: 'utf8',
        });
        if (
          !command.includes(`${REPO}/services/api/server.ts`) ||
          !env.includes(`HLEDGER_JOURNAL=${root}/${p}/ledger.journal`)
        )
          throw Error('Refusing to stop unowned PID');
      } else if (!command.includes(`serve-proxy ${name} ${p}`))
        throw Error('Refusing to stop unowned proxy PID');
      process.kill(pid, 'SIGTERM');
      await unlink(path);
    }
  return { stopped: name };
}
async function audit(name) {
  const { root } = await load(name),
    report = {};
  for (const p of Object.keys(PORTS)) {
    if (((await stat(`${root}/${p}/token`)).mode & 0o777) !== 0o600)
      throw Error('Token permissions must be 0600');
    const data = await gql(
      root,
      p,
      '{ health { status details } books { id title status } transactions(first:200) { edges { node { id } } pageInfo { hasNextPage } } accounts(first:200) { edges { node { id } } } prices(first:200) { edges { node { commodity } } } }',
    );
    report[p] = {
      health: data.health.status,
      transactions: data.transactions.edges.length,
      accounts: data.accounts.edges.length,
      prices: data.prices.edges.length,
      bookStates: data.books.map((b) => b.status),
    };
    if (p === 'empty') {
      if (report[p].transactions || data.books.length) throw Error('Empty fixture is not empty');
    } else if (
      report[p].transactions <= 60 ||
      report[p].accounts <= 60 ||
      report[p].prices <= 60 ||
      !['HELD', 'SOLD', 'DISCARDED'].every((s) => report[p].bookStates.includes(s))
    )
      throw Error('Missing full QA seed data');
    if (p !== 'empty') {
      const pages = await gql(
        root,
        p,
        '{ health { details } accounts(first:50) { pageInfo { hasNextPage } } prices(first:50) { pageInfo { hasNextPage } } transactions(first:50,filter:{query:"QA 가상 거래"}) { edges { node { id } } pageInfo { hasNextPage } } before:accounts(filter:{query:"assets:qa-zero:history",asOf:"2026-10-01"}) { edges { node { balances(asOf:"2026-10-01") { value } } } } after:accounts(filter:{query:"assets:qa-zero:history",asOf:"2026-10-02"}) { edges { node { id } } } emptyZero:accounts(filter:{query:"assets:qa-zero:history",asOf:"2026-10-02",includeEmpty:true}) { edges { node { balances(asOf:"2026-10-02") { value } } } } }',
      );
      if (
        !pages.accounts.pageInfo.hasNextPage ||
        !pages.prices.pageInfo.hasNextPage ||
        !pages.transactions.pageInfo.hasNextPage ||
        pages.transactions.edges.length !== 50 ||
        pages.before.edges[0]?.node.balances[0]?.value !== '10' ||
        pages.after.edges.length ||
        pages.emptyZero.edges[0]?.node.balances[0]?.value !== '0'
      )
        throw Error('Pagination or historical zero audit failed');
      report[p].seedAvailabilityAndHistoricalZero = 'PASS';
    }
  }
  await writeFile(`${root}/audit.json`, JSON.stringify(report, null, 2));
  return report;
}
async function proxy(name, platform) {
  const { root } = await load(name);
  if (!['ios', 'android'].includes(platform)) throw Error('Proxy platform must be ios or android');
  const dir = `${root}/${platform}`;
  createServer(async (req, res) => {
    try {
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > 1048576) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(c);
      }
      const raw = Buffer.concat(chunks);
      let body = {};
      try {
        body = JSON.parse(raw);
      } catch {}
      const upstream = await fetch(`http://127.0.0.1:${PORTS[platform]}${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : raw,
        signal: AbortSignal.timeout(12000),
      });
      const response = Buffer.from(await upstream.arrayBuffer());
      let payload = {};
      try {
        payload = JSON.parse(response);
      } catch {}
      let arm;
      try {
        arm = JSON.parse(await readFile(`${dir}/proxy-arm.json`, 'utf8'));
      } catch {}
      const key = body.variables?.input?.idempotencyKey;
      const selected = arm && /^\s*mutation\b/.test(body.query ?? '') && key === arm.idempotencyKey;
      const success =
        upstream.ok &&
        !payload.errors?.length &&
        Object.values(payload.data ?? {}).some((v) => v && v.errors?.length === 0 && v.idempotency);
      const drop = Boolean(selected && success);
      if (drop) await unlink(`${dir}/proxy-arm.json`);
      await appendFile(
        `${dir}/proxy-events.jsonl`,
        JSON.stringify({
          idempotencyKey: key ?? null,
          action: drop ? 'DROP_AFTER_SUCCESS' : 'PASS',
          upstreamStatus: upstream.status,
        }) + '\n',
      );
      if (drop) {
        res.destroy();
        return;
      }
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(response);
    } catch {
      res.writeHead(502).end('{}');
    }
  }).listen(platform === 'ios' ? 4202 : 4203, '127.0.0.1');
}
export async function main([action, name, platform, key] = process.argv.slice(2)) {
  if (['help', '--help', '-h'].includes(action))
    return {
      usage: 'node --import tsx scripts/qa/fixture.mjs COMMAND RUN [PLATFORM] [KEY]',
      commands: [
        'new-run (fails if named run exists; never resets)',
        'start (retains journal state)',
        'stop (only owned recorded PIDs)',
        'audit (health, ledger identity, token mode, seed counts; API seed availability only, not native UI evidence)',
        'proxy-arm RUN ios|android EXACT_IDEMPOTENCY_KEY (drop one successful committed response)',
        'proxy-disarm RUN ios|android',
      ],
      root: BASE,
      ports: PORTS,
      proxyPorts: { ios: 4202, android: 4203 },
      tokens: 'RUN/ios/token, RUN/android/token, RUN/empty/token; mode 0600; never print contents',
      positiveTagFilter: { tags: [{ key: 'qa', value: 'native' }] },
      referenceCode: 'QA001',
      dates:
        '2026-10-01 +10 KRW historical balance; 2026-10-02 -10 KRW; pagination 2026-10-19/20; books/prices 2026-10-24',
    };
  if (action === 'new-run') return newRun(name);
  if (action === 'start') return start(name);
  if (action === 'stop') return stop(name);
  if (action === 'audit') return audit(name);
  if (action === 'serve-proxy') return proxy(name, platform);
  if (['proxy-arm', 'proxy-disarm'].includes(action)) {
    const { root } = await load(name);
    if (!['ios', 'android'].includes(platform)) throw Error('Choose ios or android');
    const path = `${root}/${platform}/proxy-arm.json`;
    if (action === 'proxy-arm') {
      if (!key?.trim()) throw Error('An exact idempotency key is required');
      await writeFile(path, JSON.stringify({ idempotencyKey: key }), { flag: 'wx' });
    } else
      await unlink(path).catch((e) => {
        if (e.code !== 'ENOENT') throw e;
      });
    return { action, platform };
  }
  throw Error(
    'Usage: node --import tsx scripts/qa/fixture.mjs new-run|start|stop|audit RUN; proxy-arm RUN ios|android KEY; proxy-disarm RUN ios|android',
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main()
    .then((result) => {
      if (result) console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
