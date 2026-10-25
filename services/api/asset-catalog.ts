import { readFile, mkdir, rename, writeFile, stat, unlink, readdir, rm, rmdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { iso4217Units, iso4217PublishedAt, iso4217SourceUrl } from '../../packages/domain/src/asset-units.ts';
import { createHomepageLogoCatalog } from './homepage-logos.ts';
import { createAutomaticLogoCatalog } from './automatic-logos.ts';
import { getCompanyLogo } from '../../packages/domain/src/company-logos.ts';
import type { Asset, AssetCatalog, AssetProviderStatus } from '../../packages/domain/src/asset-catalog.ts';
export type { Asset, AssetCatalog, AssetProviderStatus } from '../../packages/domain/src/asset-catalog.ts';

export const NASDAQ_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt';
export const NASDAQ_OTHER_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';
export const SEC_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
export const KIND_URL = 'https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13&currentPageSize=3000&pageIndex=1';
export const KRX_BASE_URL = 'https://data-dbg.krx.co.kr/svc/apis/sto/';
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_RECORDS = 100_000;
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
export type CatalogProvider = 'nasdaq' | 'sec' | 'krx' | 'kind';
export interface CatalogSnapshot {
  version: 1;
  providers: { provider: CatalogProvider; updatedAt: string; assets: Asset[] }[];
}
export const defaultAssetCatalogPath = () => resolve(process.env.HLEDGER_ASSET_CATALOG_PATH ?? '.hledger-app/asset-catalog.json');
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const requiredString = (value: unknown, label: string, max = 500): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
};
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const isTimestamp = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)) && isDate(value.slice(0, 10));
const stockId = (provider: string, exchange: string, symbol: string) => `${provider}:${encodeURIComponent(exchange)}:${encodeURIComponent(symbol)}`;
function stock(provider: CatalogProvider, exchange: string, symbol: string, name: string, asOf: string, sourceUrl: string, isin: string | null = null): Asset {
  requiredString(symbol, 'symbol', 64); requiredString(name, 'security name'); requiredString(exchange, 'exchange', 64);
  if (!isDate(asOf)) throw new Error('Invalid reference date.');
  return { id: stockId(provider, exchange, symbol), symbol, name, exchange, kind: 'STOCK', isin, source: provider, sourceUrl, asOf, iconText: symbol.slice(0, 2), iconUrl: null };
}
function uniqueAssets(assets: Asset[]): Asset[] {
  if (!assets.length || assets.length > MAX_RECORDS) throw new Error('Provider returned an empty or oversized catalog.');
  const seen = new Set<string>();
  for (const asset of assets) {
    if (seen.has(asset.id)) throw new Error('Provider returned duplicate listing IDs.');
    seen.add(asset.id);
  }
  return assets;
}

/** Official Nasdaq pipe format, including completion footer and test issue filter. */
export function parseNasdaqDirectory(input: string, directory: 'nasdaqlisted' | 'otherlisted', asOf: string): Asset[] {
  if (!isDate(asOf)) throw new Error('Invalid reference date.');
  if (Buffer.byteLength(input) > MAX_BYTES) throw new Error('Provider response exceeds size limit.');
  const lines = input.trim().split(/\r?\n/);
  const columns = lines.shift()!.replace(/^\uFEFF/, '').split('|');
  const symbolColumn = directory === 'nasdaqlisted' ? 'Symbol' : 'ACT Symbol';
  const needed = [symbolColumn, 'Security Name', 'Test Issue', ...(directory === 'otherlisted' ? ['Exchange'] : [])];
  if (needed.some(column => !columns.includes(column)) || !lines.at(-1)?.startsWith('File Creation Time:')) throw new Error('Incomplete Nasdaq directory.');
  const footer = lines.pop()!;
  const stamp = /^File Creation Time: (\d{2})(\d{2})(\d{4})\d{2}:?\d{2}/.exec(footer);
  if (!stamp) throw new Error('Invalid Nasdaq creation timestamp.');
  const referenceDate = `${stamp[3]}-${stamp[1]}-${stamp[2]}`;
  if (!isDate(referenceDate)) throw new Error('Invalid Nasdaq creation date.');
  const exchangeNames: Record<string, string> = { A: 'NYSE American', N: 'NYSE', P: 'NYSE Arca', Z: 'Cboe BZX', V: 'IEX' };
  const assets: Asset[] = [];
  for (const line of lines) {
    const cells = line.split('|');
    if (cells.length !== columns.length) throw new Error('Invalid Nasdaq directory row.');
    const field = (name: string) => cells[columns.indexOf(name)]!;
    const test = field('Test Issue');
    if (test === 'Y') continue;
    if (test !== 'N') throw new Error('Invalid Nasdaq test issue flag.');
    const exchangeCode = directory === 'nasdaqlisted' ? 'NASDAQ' : field('Exchange');
    if (!/^[A-Z]+$/.test(exchangeCode)) throw new Error('Invalid Nasdaq listing exchange.');
    // Preserve newly introduced upstream codes until their display names are verified.
    const exchange = directory === 'nasdaqlisted' ? 'NASDAQ' : exchangeNames[exchangeCode] ?? `NASDAQ_CODE:${exchangeCode}`;
    assets.push(stock('nasdaq', exchange, field(symbolColumn), field('Security Name'), referenceDate, directory === 'nasdaqlisted' ? NASDAQ_LISTED_URL : NASDAQ_OTHER_URL));
  }
  return uniqueAssets(assets);
}

/** SEC exchange-aware schema. Older ticker-only files cannot identify a listing. */
export function parseSecCatalog(input: unknown, asOf: string): Asset[] {
  if (!isObject(input) || !Array.isArray(input.fields) || !Array.isArray(input.data)) throw new Error('Invalid SEC response.');
  const fields = input.fields;
  const needed = ['name', 'ticker', 'exchange'];
  if (needed.some(field => !fields.includes(field))) throw new Error('SEC response lacks listing fields.');
  const assets: Asset[] = [];
  for (const row of input.data) {
    if (!Array.isArray(row) || row.length !== fields.length) throw new Error('Invalid SEC row.');
    const value = (key: string) => row[fields.indexOf(key)];
    if (value('exchange') === null) continue; // Unlisted issuers have no exchange-qualified listing.
    assets.push(stock('sec', requiredString(value('exchange'), 'exchange', 64), requiredString(value('ticker'), 'ticker', 64), requiredString(value('name'), 'name'), asOf, SEC_URL));
  }
  return uniqueAssets(assets);
}

export function parseKrxCatalog(input: unknown, market: 'KOSPI' | 'KOSDAQ' | 'KONEX', basisDate: string): Asset[] {
  if (!/^\d{8}$/.test(basisDate)) throw new Error('KRX requires --basis-date YYYYMMDD.');
  if (!isObject(input) || !Array.isArray(input.OutBlock_1)) throw new Error('Invalid KRX response.');
  const asOf = `${basisDate.slice(0, 4)}-${basisDate.slice(4, 6)}-${basisDate.slice(6)}`;
  const endpoint = { KOSPI: 'stk_isu_base_info', KOSDAQ: 'ksq_isu_base_info', KONEX: 'knx_isu_base_info' }[market];
  return uniqueAssets(input.OutBlock_1.map(row => {
    if (!isObject(row)) throw new Error('Invalid KRX listing.');
    const isin = requiredString(row.ISU_CD, 'ISIN', 12);
    if (!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) throw new Error('Invalid KRX ISIN.');
    return stock('krx', market, requiredString(row.ISU_SRT_CD, 'symbol', 64), requiredString(row.ISU_NM, 'name'), asOf, `${KRX_BASE_URL}${endpoint}`, isin);
  }));
}


/** KIND's Excel download is an HTML table (not a binary XLS workbook).
 * Dates describe retrieval/export, not listing dates or market-data timestamps. */
export function decodeKindCatalog(input: Uint8Array): string {
  if (input.byteLength > MAX_BYTES) throw new Error('Provider response exceeds size limit.');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(input); }
  // Official exports can contain invalid bytes in unused product descriptions;
  // the parser rejects replacement characters in the identity fields it retains.
  catch { return new TextDecoder('euc-kr').decode(input); }
}
export function parseKindCatalog(input: string, asOf: string, expectedMarket?: 'KOSPI' | 'KOSDAQ' | 'KONEX'): Asset[] {
  if (!isDate(asOf) || Buffer.byteLength(input) > MAX_BYTES) throw new Error('Invalid KIND export or reference date.');
  const text = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, entity => {
    const named: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
    if (entity[1] !== '#') return named[entity.toLowerCase()]!;
    const number = entity[2]?.toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    if (!Number.isInteger(number) || number < 1 || number > 0x10ffff || (number >= 0xd800 && number <= 0xdfff)) throw new Error('Invalid KIND HTML entity.');
    return String.fromCodePoint(number);
  }).replace(/\s+/g, ' ').trim();
  if ((input.match(/<tr\b/gi)?.length ?? 0) !== (input.match(/<\/tr\s*>/gi)?.length ?? 0) || /<form\b[^>]*(?:login|signin)/i.test(input)) throw new Error('Incomplete KIND export.');
  const tables = [...input.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)];
  const candidates = tables.map(table => [...table[1]!.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].map(row => [...row[1]!.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]\s*>/gi)].map(cell => text(cell[1]!))))
    .filter(rows => rows[0]?.includes('회사명') && rows[0]?.includes('종목코드'));
  if (candidates.length !== 1) throw new Error('Invalid KIND company-list table. Import the official Excel HTML export.');
  const [columns, ...rows] = candidates[0]!;
  if (!columns || new Set(columns).size !== columns.length || rows.length >= 3000) throw new Error('Invalid or potentially truncated KIND export.');
  const markets: Record<string, string> = { '유가': 'KOSPI', '유가증권': 'KOSPI', '유가증권시장': 'KOSPI', '코스피': 'KOSPI', KOSPI: 'KOSPI', '코스닥': 'KOSDAQ', KOSDAQ: 'KOSDAQ', '코넥스': 'KONEX', KONEX: 'KONEX' };
  const assets = rows.map(row => {
    if (row.length !== columns.length) throw new Error('Invalid KIND company row.');
    const field = (name: string) => row[columns.indexOf(name)]!;
    let symbol = field('종목코드');
    // Excel may remove leading zeroes from legacy numeric codes. New KRX codes may contain letters.
    if (/^\d{1,6}$/.test(symbol)) symbol = symbol.padStart(6, '0');
    if (!/^[A-Z0-9]{6}$/.test(symbol)) throw new Error('Invalid KIND company symbol.');
    if (/\uFFFD/.test(field('회사명'))) throw new Error('Invalid KIND company name encoding.');
    const marketText = columns.includes('시장구분') ? field('시장구분') : null;
    const market = marketText === null ? expectedMarket ?? 'KRX' : markets[marketText];
    if (!market || (expectedMarket && market !== expectedMarket)) throw new Error('Invalid KIND company market.');
    return stock('kind', market, symbol, field('회사명'), asOf, KIND_URL);
  });
  const symbols = new Set(assets.map(asset => asset.symbol));
  if (symbols.size !== assets.length) throw new Error('Duplicate KIND company symbols.');
  return uniqueAssets(assets);
}

function validateSnapshot(value: unknown): CatalogSnapshot {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.providers) || value.providers.length > 4) throw new Error('Invalid catalog snapshot.');
  const providers = new Set<string>();
  for (const part of value.providers) {
    if (!isObject(part) || !['nasdaq', 'sec', 'krx', 'kind'].includes(String(part.provider)) || providers.has(String(part.provider)) || typeof part.updatedAt !== 'string' || !isTimestamp(part.updatedAt) || !Array.isArray(part.assets)) throw new Error('Invalid catalog provider.');
    providers.add(String(part.provider));
    uniqueAssets(part.assets as Asset[]);
    for (const asset of part.assets) {
      if (!isObject(asset) || asset.source !== part.provider || asset.kind !== 'STOCK' || asset.iconUrl !== null) throw new Error('Invalid cached asset.');
      const symbol = requiredString(asset.symbol, 'symbol', 64);
      const exchange = requiredString(asset.exchange, 'exchange', 64);
      if (part.provider === 'kind' && (!/^[A-Z0-9]{6}$/.test(symbol) || !['KOSPI', 'KOSDAQ', 'KONEX', 'KRX'].includes(exchange) || asset.isin !== null)) throw new Error('Invalid cached KIND company.');
      requiredString(asset.name, 'name'); requiredString(asset.iconText, 'icon', 64);
      if (asset.id !== stockId(String(part.provider), exchange, symbol) || typeof asset.asOf !== 'string' || !isDate(asset.asOf) || (asset.isin !== null && (typeof asset.isin !== 'string' || !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(asset.isin)))) throw new Error('Invalid cached listing identity.');
      const allowed = part.provider === 'nasdaq' ? [NASDAQ_LISTED_URL, NASDAQ_OTHER_URL] : part.provider === 'sec' ? [SEC_URL] : part.provider === 'kind' ? [KIND_URL] : ['stk', 'ksq', 'knx'].map(prefix => `${KRX_BASE_URL}${prefix}_isu_base_info`);
      if (!allowed.includes(String(asset.sourceUrl))) throw new Error('Invalid cached source URL.');
    }
  }
  return value as unknown as CatalogSnapshot;
}
export async function readCatalogSnapshot(path: string): Promise<CatalogSnapshot> {
  if ((await stat(path)).size > MAX_BYTES) throw new Error('Catalog snapshot exceeds size limit.');
  return validateSnapshot(JSON.parse(await readFile(path, 'utf8')));
}

/** Publish the complete owner marker atomically; only a dead PID may be reclaimed. */
async function lockCatalog(path: string): Promise<() => Promise<void>> {
  const lockPath = `${path}.lock`;
  const owner = `${process.pid}.${randomUUID()}`;
  const staged = `${lockPath}.${randomUUID()}`;
  const deadline = Date.now() + 5000;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await mkdir(staged, { mode: 0o700 });
  try {
    await writeFile(join(staged, owner), '', { flag: 'wx', mode: 0o600 });
    while (true) {
      try {
        await rename(staged, lockPath);
        return async () => {
          await rm(join(lockPath, owner), { force: true });
          try { await rmdir(lockPath); } catch { /* Never remove a newer, nonempty owner's directory. */ }
        };
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        try {
          const owners = await readdir(lockPath);
          const match = owners.length === 1 ? /^([1-9]\d*)\.[\w-]+$/.exec(owners[0]!) : null;
          const pid = match ? Number(match[1]) : NaN;
          if (Number.isSafeInteger(pid)) {
            try { process.kill(pid, 0); }
            catch (check) {
              if ((check as NodeJS.ErrnoException).code === 'ESRCH') {
                // A unique marker prevents racing reclaimers from unlinking a replacement owner.
                await rm(join(lockPath, owners[0]!), { force: true });
                try { await rmdir(lockPath); } catch { /* Another contender may own the directory now. */ }
                continue;
              }
            }
          }
        } catch { /* Unknown ownership fails closed rather than stealing a live lock. */ }
        if (Date.now() >= deadline) throw new Error('Timed out waiting for catalog refresh lock.');
        await delay(20);
      }
    }
  } finally { await rm(staged, { recursive: true, force: true }); }
}

/** Replace only after all requested provider responses have parsed successfully. */
export async function writeCatalogSnapshot(path: string, provider: CatalogProvider, assets: Asset[], updatedAt: string): Promise<void> {
  path = resolve(path);
  const providerAssets = structuredClone(assets);
  const release = await lockCatalog(path);
  try {
    // The read/merge/replace transaction shares the lock across refresh processes.
    let previous: CatalogSnapshot = { version: 1, providers: [] };
    try { previous = await readCatalogSnapshot(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Existing snapshot is invalid; preserve it and choose another output path.'); }
    const next = validateSnapshot({ version: 1, providers: [...previous.providers.filter(part => part.provider !== provider), { provider, assets: providerAssets, updatedAt }] });
    const json = `${JSON.stringify(next)}\n`;
    if (Buffer.byteLength(json) > MAX_BYTES) throw new Error('Catalog snapshot exceeds size limit.');
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, json, { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
    finally { await unlink(temporary).catch(() => {}); }
  } finally { await release(); }
}

const builtins: Asset[] = [
  ...iso4217Units.filter(unit => unit.kind === 'currency').map(unit => ({ id: `iso4217:${unit.code}`, symbol: unit.code, name: unit.name, exchange: null, kind: 'CURRENCY' as const, isin: null, source: 'iso4217', sourceUrl: iso4217SourceUrl, asOf: iso4217PublishedAt, iconText: ({ KRW: '₩', USD: '$', EUR: '€', JPY: '¥', GBP: '£' } as Record<string, string>)[unit.code] ?? unit.code, iconUrl: null })),
  { id: 'coingecko:bitcoin', symbol: 'BTC', name: 'Bitcoin', exchange: null, kind: 'CRYPTO', isin: null, source: 'coingecko', sourceUrl: 'https://www.coingecko.com/en/coins/bitcoin', asOf: null, iconText: '₿', iconUrl: null },
  { id: 'coingecko:ethereum', symbol: 'ETH', name: 'Ethereum', exchange: null, kind: 'CRYPTO', isin: null, source: 'coingecko', sourceUrl: 'https://www.coingecko.com/en/coins/ethereum', asOf: null, iconText: 'Ξ', iconUrl: null },
];
export function createAssetCatalog(options: { snapshotPath?: string; brandfetchClientId?: string; automaticLogoPath?: string; homepageLogoPath?: string } = {}): AssetCatalog {
  const path = options.snapshotPath ?? defaultAssetCatalogPath();
  const automatic = createAutomaticLogoCatalog({ snapshotPath: options.automaticLogoPath ?? process.env.HLEDGER_COMPANY_LOGOS_PATH ?? resolve(dirname(path), 'company-logos.json') });
  const homepage = createHomepageLogoCatalog({ snapshotPath: options.homepageLogoPath ?? process.env.HLEDGER_HOMEPAGE_LOGOS_PATH ?? resolve(dirname(path), 'homepage-logos.json') });
  async function load() {
    const [autoLogos, homepageLogos] = await Promise.all([automatic.load(), homepage.load()]);
    let snapshot: CatalogSnapshot | null = null;
    let invalid = false;
    try { snapshot = await readCatalogSnapshot(path); }
    catch (error) { invalid = (error as NodeJS.ErrnoException).code !== 'ENOENT'; }
    const providers: AssetProviderStatus[] = [
      { provider: 'iso4217', status: 'READY', updatedAt: null, message: `Bundled ISO 4217 currency metadata, published ${iso4217PublishedAt}.` },
      { provider: 'coingecko', status: 'READY', updatedAt: null, message: 'Curated Bitcoin and Ethereum identities; no live market data.' },
    ];
    for (const provider of ['nasdaq', 'sec', 'krx', 'kind'] as const) {
      const part = snapshot?.providers.find(item => item.provider === provider);
      const oldestReference = part ? part.assets.reduce((oldest, asset) => Math.min(oldest, Date.parse(asset.asOf!)), Date.parse(part.updatedAt)) : 0;
      const age = part ? Date.now() - oldestReference : 0;
      providers.push({ provider, status: part ? (age > STALE_MS || age < -60_000 ? 'STALE' : 'READY') : invalid ? 'UNAVAILABLE' : provider === 'krx' && !process.env.HLEDGER_KRX_API_KEY && !process.env.HLEDGER_KRX_API_KEY_FILE ? 'UNCONFIGURED' : 'UNAVAILABLE', updatedAt: part?.updatedAt ?? null, message: part ? (age > STALE_MS ? 'Saved catalog is more than seven days old. Run an explicit refresh.' : provider === 'kind' ? 'KIND listed-company reference only; excludes preferred shares, ETFs and other securities. Reference date is export/retrieval date.' : null) : invalid ? 'Saved catalog is invalid or unreadable.' : provider === 'krx' ? 'KRX requires an approved API key and explicit catalog refresh.' : 'No saved catalog. Run the catalog refresh command.' });
    }
    providers.push(autoLogos.status, homepageLogos.status);
    const assets = [...builtins, ...(snapshot?.providers.flatMap(part => part.assets) ?? [])];
    // Reviewed public logos need no credentials; optional ISIN lookup extends coverage.
    const decorate = (asset: Asset): Asset => ({ ...asset, iconUrl: getCompanyLogo(asset)?.imageUrl ?? autoLogos.get(asset) ?? homepageLogos.get(asset) ?? (options.brandfetchClientId && asset.isin ? `https://cdn.brandfetch.io/isin/${encodeURIComponent(asset.isin)}/w/64/h/64/fallback/404?c=${encodeURIComponent(options.brandfetchClientId)}` : null) });
    return { assets, providers, decorate };
  }
  return {
    async search(query, first = 20) {
      if (typeof query !== 'string' || query.length > 200) throw new TypeError('Search must be at most 200 characters.');
      if (!Number.isInteger(first) || first < 1 || first > 100) throw new TypeError('Search limit must be an integer from 1 to 100.');
      const { assets, providers, decorate } = await load();
      const needle = query.trim().toLocaleLowerCase('en');
      const score = (asset: Asset) => { const symbol = asset.symbol.toLocaleLowerCase('en'); const name = asset.name.toLocaleLowerCase('en'); return symbol === needle ? 0 : symbol.startsWith(needle) ? 1 : name.startsWith(needle) ? 2 : 3; };
      return { items: assets.filter(asset => !needle || `${asset.symbol} ${asset.name} ${asset.exchange ?? ''} ${asset.isin ?? ''}`.toLocaleLowerCase('en').includes(needle)).sort((a, b) => score(a) - score(b) || a.symbol.localeCompare(b.symbol, 'en') || a.id.localeCompare(b.id, 'en')).slice(0, first).map(decorate), providers };
    },
    async decorate(assets) { const { decorate } = await load(); return assets.map(decorate); },
    async get(id) { const { assets, decorate } = await load(); const asset = assets.find(item => item.id === id); return asset ? decorate(asset) : null; },
  };
}

async function fetchBytes(url: string, headers: Record<string, string> = {}): Promise<Buffer> {
  let response: Response;
  try { response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000), redirect: 'error' }); }
  catch { throw new Error('Provider request failed or timed out.'); }
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length') ?? '0') > MAX_BYTES) throw new Error('Provider response exceeds size limit.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Provider response has no body.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Provider response exceeds size limit.'); } chunks.push(part.value); }
  return Buffer.concat(chunks);
}
async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> { return (await fetchBytes(url, headers)).toString('utf8'); }
export async function refreshCatalog(options: { provider: CatalogProvider; output: string; input?: string; otherInput?: string; basisDate?: string }): Promise<{ count: number; updatedAt: string }> {
  const updatedAt = new Date().toISOString();
  let assets: Asset[];
  const local = async (path: string) => { if ((await stat(path)).size > MAX_BYTES) throw new Error('Import exceeds size limit.'); return readFile(path, 'utf8'); };
  if (options.provider === 'nasdaq') {
    if (Boolean(options.input) !== Boolean(options.otherInput)) throw new Error('Nasdaq offline import requires --input nasdaqlisted.txt and --other-input otherlisted.txt.');
    const listed = options.input ? await local(options.input) : await fetchText(NASDAQ_LISTED_URL);
    const other = options.otherInput ? await local(options.otherInput) : await fetchText(NASDAQ_OTHER_URL);
    assets = uniqueAssets([...parseNasdaqDirectory(listed, 'nasdaqlisted', updatedAt.slice(0, 10)), ...parseNasdaqDirectory(other, 'otherlisted', updatedAt.slice(0, 10))]);
  } else if (options.provider === 'sec') {
    const userAgent = process.env.HLEDGER_SEC_USER_AGENT;
    if (!options.input && (!userAgent || !/\S+@\S+/.test(userAgent))) throw new Error('SEC requires HLEDGER_SEC_USER_AGENT containing your real contact email, or --input official exchange JSON.');
    assets = parseSecCatalog(JSON.parse(options.input ? await local(options.input) : await fetchText(SEC_URL, { 'User-Agent': userAgent! })), updatedAt.slice(0, 10));
  } else if (options.provider === 'kind') {
    if (options.otherInput) throw new Error('KIND does not accept --other-input.');
    if (options.input) {
      if (!options.basisDate || !/^\d{8}$/.test(options.basisDate)) throw new Error('KIND offline import requires --basis-date YYYYMMDD matching the export date.');
      const reference = `${options.basisDate.slice(0, 4)}-${options.basisDate.slice(4, 6)}-${options.basisDate.slice(6)}`;
      if ((await stat(options.input)).size > MAX_BYTES) throw new Error('Import exceeds size limit.');
      assets = parseKindCatalog(decodeKindCatalog(await readFile(options.input)), reference);
    } else {
      if (options.basisDate) throw new Error('KIND live reference date is retrieval date; --basis-date is for offline imports.');
      assets = [];
      for (const [market, code] of [['KOSPI', 'stockMkt'], ['KOSDAQ', 'kosdaqMkt'], ['KONEX', 'konexMkt']] as const) {
        assets.push(...parseKindCatalog(decodeKindCatalog(await fetchBytes(`${KIND_URL}&marketType=${code}`)), updatedAt.slice(0, 10), market));
      }
      uniqueAssets(assets);
    }
  } else {
    const basisDate = options.basisDate;
    if (!basisDate || !/^\d{8}$/.test(basisDate)) throw new Error('KRX requires --basis-date YYYYMMDD.');
    const key = process.env.HLEDGER_KRX_API_KEY ?? (process.env.HLEDGER_KRX_API_KEY_FILE ? (await readFile(process.env.HLEDGER_KRX_API_KEY_FILE, 'utf8')).trim() : undefined);
    if (options.input) {
      const payload: unknown = JSON.parse(await local(options.input));
      if (!isObject(payload)) throw new Error('KRX import must contain KOSPI, KOSDAQ and KONEX official response objects.');
      assets = uniqueAssets((['KOSPI', 'KOSDAQ', 'KONEX'] as const).flatMap(market => parseKrxCatalog(payload[market], market, basisDate)));
    } else {
      if (!key) throw new Error('KRX is UNCONFIGURED: set HLEDGER_KRX_API_KEY or HLEDGER_KRX_API_KEY_FILE.');
      assets = [];
      for (const [market, endpoint] of [['KOSPI', 'stk'], ['KOSDAQ', 'ksq'], ['KONEX', 'knx']] as const) assets.push(...parseKrxCatalog(JSON.parse(await fetchText(`${KRX_BASE_URL}${endpoint}_isu_base_info?basDd=${basisDate}`, { AUTH_KEY: key })), market, basisDate));
      uniqueAssets(assets);
    }
  }
  await writeCatalogSnapshot(options.output, options.provider, assets, updatedAt);
  return { count: assets.length, updatedAt };
}
