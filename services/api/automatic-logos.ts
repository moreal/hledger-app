import { readFile, stat, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { readCatalogSnapshot, defaultAssetCatalogPath } from './asset-catalog.ts';
import type { Asset, AssetProviderStatus } from '../../packages/domain/src/asset-catalog.ts';

const MAX = 20 * 1024 * 1024;
export const defaultAutomaticLogoPath = () => resolve(process.env.HLEDGER_COMPANY_LOGOS_PATH ?? '.hledger-app/company-logos.json');
export const exchangeEntities: Record<string, string> = { NASDAQ: 'Q82059', Nasdaq: 'Q82059', NYSE: 'Q13677', 'NYSE American': 'Q846626', KOSPI: 'Q495372', KOSDAQ: 'Q491503' };
export interface LogoCandidate { entity: string; exchange: string; ticker: string; logo: string; labels: string[] }
export interface LogoRecord { fingerprint: string; entity: string; imageUrl: string; sourcePage: string; license: string; artist: string }
interface Snapshot { version: 1; updatedAt: string; records: LogoRecord[]; counts: Counts }
interface Counts { processed: number; matched: number; ambiguous: number; missing: number; failed: number; total: number; bounded: boolean }
export const isPublicDomainLicense = (license: string) => /^(?:Public domain|PD-(?:textlogo|ineligible|US|US-no notice|US-expired|old|old-100|self|author|user|shape|simple))$/i.test(license.trim());
export const assetFingerprint = (asset: Asset) => JSON.stringify([asset.id, asset.name, asset.symbol, asset.exchange]);
const safeImage = (value: string) => { try { const u = new URL(value); return u.protocol === 'https:' && ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(u.hostname) && !u.username && !u.password && /\.(?:png|jpg|jpeg|webp)$/i.test(u.pathname); } catch { return false; } };
const normalize = (name: string) => name.normalize('NFKC').toLowerCase().replace(/\([^)]*\)/g, '').replace(/(?:\s*[-–]\s*.*|\b(?:common stock|ordinary shares|class [a-z] common.*)\b.*)$/i, '').replace(/주식회사|㈜|\(주\)|\b(?:incorporated|corporation|company|limited|holdings|inc|corp|co|ltd|plc)\b/g, '').replace(/[^\p{L}\p{N}]/gu, '');
export function matchCandidates(asset: Asset, candidates: LogoCandidate[]): LogoCandidate[] {
  const exchange = exchangeEntities[asset.exchange ?? '']; const name = normalize(asset.name);
  if (!exchange || name.length < 2) return [];
  const matches = candidates.filter(c => (c.exchange === exchange || (asset.exchange === 'KOSPI' && c.exchange === 'Q495364')) && c.ticker === asset.symbol && c.labels.some(label => normalize(label) === name));
  return [...new Map(matches.map(c => [`${c.entity}:${c.logo}`, c])).values()];
}
async function localJson(path: string): Promise<any> { if ((await stat(path)).size > MAX) throw new Error('Logo data exceeds size limit.'); return JSON.parse(await readFile(path, 'utf8')); }
async function request(url: string, fetcher: typeof fetch, wait: (ms: number) => Promise<unknown> = delay, attempt = 0): Promise<any> {
  const r = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { Accept: 'application/json', 'User-Agent': 'hledger-app-logo-sync/1.0 (public reference metadata)' } });
  if (r.status === 429 || r.status === 503) {
    const retry = r.headers.get('retry-after');
    const requested = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 1000 * 2 ** attempt;
    await r.body?.cancel();
    if (attempt < 3 && Number.isFinite(requested) && requested <= 60_000) { await wait(Math.max(1000, requested)); return request(url, fetcher, wait, attempt + 1); }
  }
  if (!r.ok) throw new Error(`Logo provider ${new URL(url).hostname} HTTP ${r.status}; saved logos preserved.`);
  const reader = r.body?.getReader(); if (!reader) throw new Error('Empty provider response.');
  let size = 0; const chunks: Uint8Array[] = [];
  for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > MAX) { await reader.cancel(); throw new Error('Provider response too large.'); } chunks.push(part.value); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function parseCandidateResults(data: any): LogoCandidate[] {
  if (!Array.isArray(data?.results?.bindings) || data.results.bindings.length > 100_000) throw new Error('Expected a Wikidata SPARQL results export.');
  return data.results.bindings.filter((r: any) => !/^https?:\/\/www.wikidata.org\/\.well-known\/genid\//.test(r.logo?.value ?? '')).map((r: any) => {
    const entity = /^http:\/\/www.wikidata.org\/entity\/(Q\d+)$/.exec(r.entity?.value)?.[1];
    const exchange = /^http:\/\/www.wikidata.org\/entity\/(Q\d+)$/.exec(r.exchange?.value)?.[1];
    const logo = r.logo?.value; const ticker = r.ticker?.value; const label = r.label?.value;
    if (!entity || !exchange || typeof ticker !== 'string' || ticker.length > 64 || typeof label !== 'string' || label.length > 500 || typeof logo !== 'string' || !/^https?:\/\/commons.wikimedia.org\/wiki\/Special:FilePath\/.+/.test(logo)) throw new Error('Invalid structured Wikidata candidate.');
    const filename = decodeURIComponent(new URL(logo).pathname.split('/Special:FilePath/')[1]!);
    if (filename.length > 500 || /[\u0000-\u001f|]/.test(filename)) throw new Error('Invalid Commons filename.');
    return { entity, exchange, ticker, logo: filename, labels: [label] };
  });
}
export function candidateQuery(ids: string[]) { return `SELECT DISTINCT ?entity ?exchange ?ticker ?logo ?label WHERE { VALUES ?exchange { ${ids.map(id => `wd:${id}`).join(' ')} } ?entity p:P414 ?listing; p:P154 ?logoStatement. ?listing ps:P414 ?exchange; pq:P249 ?ticker; wikibase:rank ?listingRank. FILTER(?listingRank != wikibase:DeprecatedRank) FILTER NOT EXISTS { ?listing pq:P582 ?end } ?logoStatement ps:P154 ?logo; wikibase:rank ?logoRank. FILTER(?logoRank != wikibase:DeprecatedRank) FILTER(STRSTARTS(STR(?logo), "http://commons.wikimedia.org/wiki/Special:FilePath/") || STRSTARTS(STR(?logo), "https://commons.wikimedia.org/wiki/Special:FilePath/")) FILTER NOT EXISTS { ?logoStatement pq:P582 ?logoEnd } { ?entity rdfs:label ?label } UNION { ?entity skos:altLabel ?label } FILTER(LANG(?label) IN ('en','ko')) }`; }
function validate(data: any): Snapshot {
  if (data?.version !== 1 || !Number.isFinite(Date.parse(data.updatedAt)) || !Array.isArray(data.records) || data.records.length > 100_000 || !data.counts || !['processed','matched','ambiguous','missing','failed','total'].every(k => Number.isSafeInteger(data.counts[k]) && data.counts[k] >= 0) || typeof data.counts.bounded !== 'boolean') throw new Error('Invalid logo snapshot.');
  const seen = new Set<string>();
  for (const r of data.records) { if (typeof r.fingerprint !== 'string' || r.fingerprint.length > 2000 || seen.has(r.fingerprint) || !/^Q\d+$/.test(r.entity) || !safeImage(r.imageUrl) || typeof r.sourcePage !== 'string' || !r.sourcePage.startsWith('https://commons.wikimedia.org/wiki/File:') || !isPublicDomainLicense(r.license ?? '') || !['license','artist'].every(k => typeof r[k] === 'string' && r[k].length <= 10_000)) throw new Error('Invalid logo record.'); seen.add(r.fingerprint); }
  return data;
}
async function atomic(path: string, data: unknown) { const json = JSON.stringify(data); if (Buffer.byteLength(json) > MAX) throw new Error('Logo snapshot too large.'); await mkdir(dirname(path), { recursive: true }); const tmp = `${path}.${randomUUID()}.tmp`; try { await writeFile(tmp, json, { flag: 'wx', mode: 0o600 }); await rename(tmp, path); } finally { await unlink(tmp).catch(() => {}); } }
export function createAutomaticLogoCatalog(options: { snapshotPath?: string } = {}) {
  const load = async () => {
    let snapshot: Snapshot;
    try { snapshot = validate(await localJson(options.snapshotPath ?? defaultAutomaticLogoPath())); }
    catch { return { get: (_asset: Asset): string | null => null, status: { provider: 'wikimedia', status: 'UNAVAILABLE', updatedAt: null, message: 'No valid saved automatic logos. Run an explicit logo refresh.' } satisfies AssetProviderStatus }; }
    const records = new Map(snapshot.records.map(r => [r.fingerprint, r.imageUrl]));
    return { get: (asset: Asset): string | null => records.get(assetFingerprint(asset)) ?? null, status: { provider: 'wikimedia', status: Date.now() - Date.parse(snapshot.updatedAt) > 30 * 86400_000 ? 'STALE' : 'READY', updatedAt: snapshot.updatedAt, message: `${snapshot.counts.matched}/${snapshot.counts.processed} processed listings have automatic logos (${snapshot.counts.total} total; ${snapshot.counts.bounded ? 'bounded refresh' : 'full refresh'}). Missing or ambiguous identities use initials.` } satisfies AssetProviderStatus };
  };
  return { load };
}
export async function refreshAutomaticLogos(options: { catalogPath?: string; output?: string; input?: string; limit?: number; preview?: string; fetcher?: typeof fetch; wait?: (ms: number) => Promise<unknown> }): Promise<Counts> {
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1)) throw new Error('Limit must be a positive integer.');
  if (options.limit !== undefined && (!options.output || resolve(options.output) === defaultAutomaticLogoPath())) throw new Error('Bounded refresh requires an explicit --output path.');
  const catalog = await readCatalogSnapshot(options.catalogPath ?? defaultAssetCatalogPath());
  const all = catalog.providers.flatMap(p => p.assets).filter(a => a.kind === 'STOCK'); const assets = all.slice(0, options.limit);
  const counts: Counts = { total: all.length, processed: assets.length, matched: 0, ambiguous: 0, missing: 0, failed: 0, bounded: assets.length < all.length };
  const fetcher = options.fetcher ?? fetch; const wait = options.wait ?? delay;
  let candidates: LogoCandidate[];
  try { candidates = options.input ? parseCandidateResults(await localJson(options.input)) : parseCandidateResults(await request(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(candidateQuery([...new Set(assets.flatMap(a => a.exchange === 'KOSPI' ? ['Q495372', 'Q495364'] : [exchangeEntities[a.exchange ?? '']]).filter((id): id is string => Boolean(id)))]))}`, fetcher, wait)); }
  catch (error) { throw new Error(`Wikidata refresh failed; saved logos preserved. ${error instanceof Error ? error.message : ''}`); }
  const pending: { asset: Asset; candidate: LogoCandidate }[] = [];
  for (const asset of assets) { const matches = matchCandidates(asset, candidates); if (!matches.length) counts.missing++; else if (matches.length > 1) counts.ambiguous++; else pending.push({ asset, candidate: matches[0]! }); }
  const files = [...new Set(pending.map(p => p.candidate.logo))]; const images = new Map<string, Omit<LogoRecord, 'fingerprint' | 'entity'>>();
  if (files.length > 5000) throw new Error('Logo refresh exceeds 500-request batch cap; use a bounded output.');
  for (let offset = 0; offset < files.length; offset += 10) {
    if (offset > 0) await wait(1000);
    const titles = files.slice(offset, offset + 10).map(f => `File:${f}`);
    // Small serial metadata batches avoid overloading Commons.
    const result = await request(`https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=url%7Cmime%7Cextmetadata&iiextmetadatafilter=LicenseShortName%7CArtist&iiurlwidth=96&titles=${encodeURIComponent(titles.join('|'))}`, fetcher, wait);
    if (!Array.isArray(result?.query?.pages)) throw new Error('Commons refresh failed; saved logos preserved.');
    for (const page of result.query.pages) { const info = page.imageinfo?.[0]; if (!info || !/^image\//.test(info.mime) || !safeImage(info.thumburl ?? info.url)) continue;
      const metadata = info.extmetadata; const clean = (s: unknown) => typeof s === 'string' ? s.replace(/<[^>]*>/g, '').slice(0, 10_000) : '';
      const license = clean(metadata?.LicenseShortName?.value); if (!isPublicDomainLicense(license)) continue;
      images.set(page.title.replace(/^File:/, '').replace(/_/g, ' '), { imageUrl: info.thumburl ?? info.url, sourcePage: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title).replace(/^File%3A/, 'File:')}`, license, artist: clean(metadata?.Artist?.value) }); }
  }
  const records: LogoRecord[] = [];
  for (const { asset, candidate } of pending) { const info = images.get(candidate.logo.replace(/_/g, ' ')); if (info) { records.push({ fingerprint: assetFingerprint(asset), entity: candidate.entity, ...info }); counts.matched++; } else counts.missing++; }
  const snapshot: Snapshot = { version: 1, updatedAt: new Date().toISOString(), records, counts };
  validate(snapshot); await atomic(options.output ?? defaultAutomaticLogoPath(), snapshot);
  if (options.preview) await atomic(options.preview, { ...snapshot, assets: assets.filter(a => records.some(r => r.fingerprint === assetFingerprint(a))).map(a => ({ ...a, iconUrl: records.find(r => r.fingerprint === assetFingerprint(a))!.imageUrl })) });
  return counts;
}
