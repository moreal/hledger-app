import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { assetFingerprint } from './automatic-logos.ts';
import { readCatalogSnapshot, defaultAssetCatalogPath, KIND_URL } from './asset-catalog.ts';
import type { Asset, AssetProviderStatus } from '../../packages/domain/src/asset-catalog.ts';
import { normalizeIcon } from './icon-rasterizer.ts';
import { resolveKindHomepage } from './kind-homepages.ts';
// Reviewed issuer/group ambiguity; see docs logo identity audit evidence.
// These are held for review, not classified as proven incorrect. Match every identity field.
export const homepageIdentityReviewRequired = (asset: Asset): boolean => asset.source === 'kind' && [
    ['kind:KOSPI:044820', 'KOSPI', '044820', '코스맥스비티아이'],
    ['kind:KOSDAQ:0068Y0', 'KOSDAQ', '0068Y0', '비엔케이제3호스팩'],
    ['kind:KOSPI:214390', 'KOSPI', '214390', '경보제약'],
    ['kind:KOSPI:019180', 'KOSPI', '019180', '티에이치엔'],
    ['kind:KOSDAQ:035620', 'KOSDAQ', '035620', '바른손이앤에이'],
    ['kind:KOSDAQ:018700', 'KOSDAQ', '018700', '졸스'],
].some(([id, exchange, symbol, name]) => asset.id === id && asset.exchange === exchange && asset.symbol === symbol && asset.name === name);
// Visually audited framework/platform defaults and blank artwork.
export const rejectedHomepageIconHashes = new Set([
 '1aaaeb5b9ba7df773a8b24d8d096e14eb86909e3580c3bd836603ed4328de008.png',
 '6f03a84a7d517262927b8a3e0bbfac212fa1ae5c399d9042789337ea767574ad.png',
 '85cef7d693dfb45633de0c4b3e61a095ccf15f6f3d98bbd123d49af1207fe024.png',
 '24f522247ace8484a14ef08c3474839c216aca3b28a43a18ce1c16db2babfc76.png',
 '7d57f608e02f45bf94e9e2f2165067491e39889c33aad78734bc21be89755223.png',
]);
const MAX = 2 * 1024 * 1024;
export const defaultHomepageLogoPath = () => resolve(process.env.HLEDGER_HOMEPAGE_LOGOS_PATH ?? '.hledger-app/homepage-logos.json');
export function isPublicAddress(ip: string): boolean {
    if (isIP(ip) === 4) {
        const p = ip.split('.').map(Number);
        const a = p[0]!, b = p[1]!;
        return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51) || a === 203 && b === 0);
    }
    // Only native global unicast IPv6. Reject mapped, transition, multicast, local and documentation ranges.
    if (isIP(ip) !== 6)
        return false;
    const segments = ip.split(':');
    const first = parseInt(segments[0] || '0', 16);
    const second = parseInt(segments[1] || '0', 16);
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && !(first === 0x2001 && (second < 0x200 || second === 0xdb8));
}
const hostKey = (h: string) => h.toLowerCase().replace(/^www\./, '');
export function homepageUrl(value: string): string | null { try {
    const u = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port && u.port !== '443' || isIP(u.hostname.replace(/[\[\]]/g, '')) || !u.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(u.hostname) || /(?:^|\.)(?:naver\.com|daum\.net|google\.com|facebook\.com|instagram\.com|youtube\.com|twitter\.com|x\.com|tistory\.com|wixsite\.com|notion\.site)$/.test(u.hostname))
        return null;
    u.protocol = 'https:';
    u.hash = '';
    return u.href;
}
catch {
    return null;
} }
function sameHost(a: string, b: string) { return hostKey(new URL(a).hostname) === hostKey(new URL(b).hostname); }
const unescapeHtml = (s: string) => s.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, v) => String.fromCharCode(Number(v)));
const attributes = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m => [m[1]!.toLowerCase(), unescapeHtml(m[2] ?? m[3] ?? m[4] ?? '')]));
export function declaredIcons(html: string, base: string): string[] { const result: string[] = []; for (const tag of (html.match(/<link\b[^>]*>/gi) ?? []).sort((a, b) => Number(/apple-touch-icon/i.test(b)) - Number(/apple-touch-icon/i.test(a)))) {
    const a = attributes(tag);
    if (!/(?:^|\s)(?:icon|apple-touch-icon|apple-touch-icon-precomposed)(?:\s|$)/i.test(a.rel ?? ''))
        continue;
    try {
        const u = new URL(a.href!, base);
        if (homepageUrl(u.href) && sameHost(u.href, base))
            result.push(u.href);
    }
    catch { }
} return [...new Set(result)];  }
/** Follow only explicitly published same-host entry links; never invent paths or domains. */
export function officialEntryPages(html: string, base: string): string[] {
    const clean = html.replace(/<!--[^]*?-->/g, '').replace(/<(script|style)\b[^>]*>[^]*?<\/\1>/gi, '');
    const pages: string[] = [];
    for (const match of clean.matchAll(/<a\b([^>]*)>([^]*?)<\/a>/gi)) {
        const attrs = attributes(match[1]!);
        if (!attrs.href || attrs.download !== undefined || /^(?:#|javascript:|mailto:|tel:)/i.test(attrs.href)) continue;
        const label = unescapeHtml(match[2]!.replace(/<[^>]*>/g, ' ')).trim();
        if (!/^(?:한국어|국문|Korean|KO|KR|홈|홈페이지|메인|Home|Enter|바로가기|홈페이지 바로가기)$/i.test(label) && !/^(?:ko|ko-kr)$/i.test(attrs.hreflang ?? '')) continue;
        try {
            const url = new URL(attrs.href, base); url.hash = '';
            if (homepageUrl(url.href) === url.href && sameHost(url.href, base) && url.href !== base && !/\.(?:pdf|zip|exe|xlsx?)(?:$|\?)/i.test(url.pathname) && !pages.includes(url.href)) pages.push(url.href);
        } catch { }
    }
    return pages.slice(0, 3);
}
export const homepageExtractionRules = 'official-published-links-v3';
export interface OfficialLogoCandidate { url: string; method: 'organization-logo' | 'header-logo' }
/** Only call on an issuer-verified page; never promotes social metadata or footer badges. */
export function officialLogoCandidates(html: string, base: string, issuer: string): OfficialLogoCandidate[] {
    const result: OfficialLogoCandidate[] = [];
    const normalize = (value: string) => value.toLowerCase().replace(/주식회사|㈜|\(주\)|[\s.,()-]/g, '');
    const add = (value: unknown, method: OfficialLogoCandidate['method']) => {
        if (typeof value !== 'string' || !value.trim()) return;
        try { const url = new URL(unescapeHtml(value), base).href; if (homepageUrl(url) && sameHost(url, base) && !result.some(c => c.url === url)) result.push({ url, method }); } catch { }
    };
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (attributes(script[1]!).type?.toLowerCase() !== 'application/ld+json') continue;
        try {
            const visit = (node: unknown, depth = 0): void => {
                if (depth > 8 || !node || typeof node !== 'object') return;
                if (Array.isArray(node)) { for (const child of node.slice(0, 50)) visit(child, depth + 1); return; }
                const item = node as Record<string, any>;
                const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
                if (types.some((t: unknown) => t === 'Organization' || t === 'Corporation') && typeof item.name === 'string' && normalize(item.name) === normalize(issuer)) add(typeof item.logo === 'string' ? item.logo : item.logo?.url ?? item.logo?.contentUrl, 'organization-logo');
                if (item['@graph']) visit(item['@graph'], depth + 1);
            };
            visit(JSON.parse(script[2]!));
        } catch { }
    }
    // A token stack preserves footer/aside boundaries, including nested div wrappers.
    const clean = html.replace(/<!--([\s\S]*?)-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    const stack: { tag: string; attrs: Record<string, string> }[] = [];
    const excluded = /(?:^|[\s_./-])(?:footer|aside|ad|ads|advert|advertisement|banner|badge|trust|partner|sponsor|vendor|group|product|affiliate|subsidiary|family|hidden)(?:$|[\s_./-])/i;
    const hasExcludedLabel = (attrs: Record<string, string>) => excluded.test(`${attrs.id ?? ''} ${attrs.class ?? ''} ${attrs.title ?? ''} ${attrs['aria-label'] ?? ''}`) || /파트너|계열사|그룹사|광고|제품|관계사/.test(`${attrs.title ?? ''} ${attrs['aria-label'] ?? ''}`);
    const issuerLabel = normalize(issuer);
    const issuerLabelMatches = (label: string) => {
        const value = normalize(label);
        return value === issuerLabel || value.replace(/^(?:logo|homepage|home|main|로고|홈으로이동|홈으로|홈|메인으로이동|메인으로|메인)+|(?:logo|homepage|home|main|로고|홈으로이동|홈으로|홈|메인으로이동|메인으로|메인)+$/gi, '') === issuerLabel;
    };
    const labelAllowed = (label: string | undefined) => !label?.trim() || issuerLabelMatches(label) || /^(?:logo|home|homepage|main|로고|홈|홈으로|메인|메인으로|메인으로이동|홈으로이동)$/i.test(normalize(label));
    const foreignAnchor = (node: { tag: string; attrs: Record<string, string> }) => {
        if (node.tag !== 'a' || !node.attrs.href) return false;
        try { return !sameHost(new URL(node.attrs.href, base).href, base); } catch { return true; }
    };
    for (const token of clean.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/gi)) {
        const tag = token[2]!.toLowerCase();
        if (token[1]) { const index = stack.map(n => n.tag).lastIndexOf(tag); if (index >= 0) stack.length = index; continue; }
        const attrs = attributes(token[3]!);
        if (tag === 'img' && !stack.some(n => ['footer', 'aside'].includes(n.tag) || hasExcludedLabel(n.attrs) || foreignAnchor(n) || n.attrs['aria-hidden'] === 'true' || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(n.attrs.style ?? ''))) {
            const context = stack.some(n => ['header', 'nav', 'h1'].includes(n.tag) || /(?:^|[\s_-])(?:header|gnb|logo)(?:$|[\s_-])/i.test(`${n.attrs.id ?? ''} ${n.attrs.class ?? ''}`));
            const marker = `${attrs.id ?? ''} ${attrs.class ?? ''} ${attrs.src ?? ''}`;
            const altMatches = !!attrs.alt && issuerLabelMatches(attrs.alt);
            if (context && labelAllowed(attrs.alt) && labelAllowed(attrs.title) && labelAllowed(attrs['aria-label']) && !hasExcludedLabel(attrs) && !excluded.test(marker) && attrs['aria-hidden'] !== 'true' && !/display\s*:\s*none|visibility\s*:\s*hidden/i.test(attrs.style ?? '') && (altMatches || /(?:^|[\s_./-])logo\d*(?:$|[\s_./-])/i.test(marker))) add(attrs.src, 'header-logo');
        }
        if (!/\/$/.test(token[3]!) && !['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'].includes(tag)) stack.push({ tag, attrs });
    }
    return result.slice(0, 8);
}
export function validRaster(b: Buffer, mime: string): boolean {
    const m = mime.split(';')[0]!.trim().toLowerCase();
    if (m === 'image/png')
        return b.length >= 45 && b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && b.readUInt32BE(8) === 13 && b.toString('ascii', 12, 16) === 'IHDR' && b.readUInt32BE(16) > 0 && b.readUInt32BE(20) > 0 && b.toString('ascii', b.length - 8, b.length - 4) === 'IEND';
    if (['image/jpeg', 'image/jpg'].includes(m))
        return b.length >= 32 && b[0] === 255 && b[1] === 216 && b[2] === 255 && b[b.length - 2] === 255 && b[b.length - 1] === 217;
    return m === 'image/webp' && b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' && b.readUInt32LE(4) + 8 === b.length && ['VP8 ', 'VP8L', 'VP8X'].includes(b.toString('ascii', 12, 16));
}
export function parseHomepageRows(html: string): {
    name: string;
    exchange: string;
    symbol: string;
    homepage: string | null;
}[] { const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(r => [...r[1]!.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => unescapeHtml(c[1]!.replace(/<[^>]+>/g, '').trim()))); const header = rows.shift() ?? []; const indexes = ['회사명', '시장구분', '종목코드', '홈페이지'].map(s => header.indexOf(s)); if (indexes.some(n => n < 0))
    throw new Error('KIND export missing official homepage columns.'); return rows.filter(r => r.length === header.length).map(r => ({ name: r[indexes[0]!]!, exchange: ({ '유가': 'KOSPI', '코스닥': 'KOSDAQ', '코넥스': 'KONEX' } as Record<string, string>)[r[indexes[1]!]!] ?? '', symbol: r[indexes[2]!]!, homepage: homepageUrl(r[indexes[3]!]!) })); }
export interface OfficialRequestOptions { method: 'POST'; body: string }
/** Only the published, read-only KIND disclosure search accepts a request body. */
export function validateOfficialRequest(url: string, origin: string, options?: OfficialRequestOptions): void {
    if (!options) return;
    if (url !== 'https://kind.krx.co.kr/disclosure/searchdisclosurebycorp.do' || new URL(origin).origin !== 'https://kind.krx.co.kr' || options.method !== 'POST' || typeof options.body !== 'string' || Buffer.byteLength(options.body) > 4096) throw new Error('Unsafe official POST request.');
    const params = new URLSearchParams(options.body);
    const fixed: Record<string,string> = {method:'searchDisclosureByCorpSub',forward:'searchdisclosurebycorp_sub',searchCodeType:'number',currentPageSize:'100',pageIndex:'1',orderMode:'1',orderStat:'D'};
    const allowed = new Set([...Object.keys(fixed),'repIsuSrtCd','fromDate','toDate','reportNm']);
    if ([...params.keys()].some(key => !allowed.has(key) || params.getAll(key).length !== 1) || Object.entries(fixed).some(([key,value])=>params.get(key)!==value) || !/^A[A-Z0-9]{6}$/.test(params.get('repIsuSrtCd') ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(params.get('fromDate') ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(params.get('toDate') ?? '') || params.has('reportNm') && params.get('reportNm') !== '보고서') throw new Error('Unsafe official POST fields.');
}
export function officialRedirect(url: string, origin: string, location: string, options?: OfficialRequestOptions): string {
    if (options) throw new Error('Unsafe official POST redirect.');
    const next = new URL(location, url).href;
    if (!homepageUrl(next) || new URL(next).protocol !== 'https:' || !sameHost(next, origin)) throw new Error('Unsafe URL or cross-host redirect.');
    return next;
}
/** DNS is checked once and the approved address is pinned into the TLS request lookup. */
async function publicGet(url: string, origin: string, signal: AbortSignal, options?: OfficialRequestOptions, redirects = 0): Promise<{
    body: Buffer;
    mime: string;
    url: string;
}> {
    if (!homepageUrl(url) || new URL(url).protocol !== 'https:' || !sameHost(url, origin))
        throw new Error('Unsafe URL or cross-host redirect.');
    validateOfficialRequest(url, origin, options);
    const u = new URL(url);
    const responseLimit = u.origin === 'https://kind.krx.co.kr' && /^\/external\/[A-Za-z0-9/_-]+\.htm$/.test(u.pathname) ? 8 * 1024 * 1024 : MAX;
    const addresses = await Promise.race([lookup(u.hostname, { all: true }), new Promise<never>((_, reject) => { if (signal.aborted) {
            reject(signal.reason);
            return;
        } signal.addEventListener('abort', () => reject(signal.reason), { once: true }); })]);
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address)))
        throw new Error('Non-public DNS address.');
    const chosen = addresses[0]!;
    const result = await new Promise<{
        body: Buffer;
        mime: string;
        location?: string;
        status: number;
    }>((res, rej) => { const req = httpsRequest(u, { signal, method: options?.method ?? 'GET', lookup: ((_host: any, _options: any, callback: any) => _options.all ? callback(null, [{ address: chosen.address, family: chosen.family }]) : callback(null, chosen.address, chosen.family)) as any, headers: { 'User-Agent': 'hledger-app-homepage-icons/1.0', 'Accept': 'text/html,image/png,image/jpeg,image/webp,application/manifest+json', ...(options ? {'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','Content-Length':Buffer.byteLength(options.body).toString()} : {}) } }, r => { const status = r.statusCode ?? 0; if (status >= 300 && status < 400) {
        r.destroy();
        res({ body: Buffer.alloc(0), mime: '', location: r.headers.location, status });
        return;
    } if (status !== 200) {
        r.destroy();
        rej(new Error(`HTTP ${status}`));
        return;
    } const chunks: Buffer[] = []; let bytes = 0; r.on('data', (c: Buffer) => { bytes += c.length; if (bytes > responseLimit) {
        req.destroy(new Error('Response too large.'));
        return;
    } chunks.push(c); }); r.on('end', () => res({ body: Buffer.concat(chunks), mime: r.headers['content-type'] ?? '', status })); r.on('error', rej); }); req.on('error', rej); req.end(options?.body); });
    if (result.location) {
        if (redirects >= 3)
            throw new Error('Too many redirects.');
        return publicGet(officialRedirect(url, origin, result.location, options), origin, signal, undefined, redirects + 1);
    }
    return { ...result, url };
}
export interface HomepageLogoRecord {
    automaticAuthority?: NonNullable<Awaited<ReturnType<typeof resolveKindHomepage>>>;
    fingerprint: string;
    entity: string;
    sourcePage: string;
    imageUrl: string;
    source: 'official-website-icon';
    license: string;
    authoritySource: 'KIND';
    normalizedPng?: string;
    normalizedFormat?: string;
    discoveryMethod?: string;
    originalHomepage?: string;
    authorityUrl?: string;
    homepageEvidenceUrls?: readonly string[];
}
export interface LogoDiagnostic { automaticAuthority?: NonNullable<Awaited<ReturnType<typeof resolveKindHomepage>>>; attemptTrace?: { reason: string; stage: string; url?: string; inputHash?: string }[]; method?: string; format?: string; reason: string; stage: string; url?: string; status?: number; error?: string; identity?: { status: 'verified' | 'unknown' | 'rejected'; title: string; issuerMention: boolean } }
interface Counts {
    processed: number;
    matched: number;
    missing: number;
    failed: number;
    total: number;
    bounded: boolean;
    reasons?: Record<string, number>;
}
interface Snapshot {
    version: 1;
    updatedAt: string;
    records: HomepageLogoRecord[];
    attempts: Record<string, 'matched' | 'missing' | 'failed'>;
    counts: Counts;
    diagnostics?: Record<string, LogoDiagnostic>;
    reproducibility?: Record<string, unknown>;
    allAssets?: ReturnType<typeof previewAssets>;
}
async function readSnapshot(path: string): Promise<Snapshot> { if ((await stat(path)).size > 20 * 1024 * 1024)
    throw new Error('Cache too large.'); const s = JSON.parse(await readFile(path, 'utf8')) as Snapshot; if (s.version !== 1 || !Number.isFinite(Date.parse(s.updatedAt)) || !Array.isArray(s.records) || !s.attempts || !s.counts)
    throw new Error('Invalid cache.'); for (const r of s.records)
    if ((r.normalizedPng !== undefined && !/^[a-f0-9]{64}\.png$/.test(r.normalizedPng)) || typeof r.fingerprint !== 'string' || homepageUrl(r.imageUrl) !== r.imageUrl || homepageUrl(r.sourcePage) !== r.sourcePage || !sameHost(r.imageUrl, r.sourcePage) || r.entity !== r.sourcePage || r.source !== 'official-website-icon' || r.authoritySource !== 'KIND' || r.license !== '공식 홈페이지 아이콘 · 권리 미확인')
        throw new Error('Invalid icon record.');
    if (new Set(s.records.map(r => r.fingerprint)).size !== s.records.length || !['processed','matched','missing','failed','total'].every(k => Number.isSafeInteger((s.counts as any)[k]) && (s.counts as any)[k] >= 0) || typeof s.counts.bounded !== 'boolean' || s.counts.matched !== s.records.length || Array.isArray(s.attempts) || Object.entries(s.attempts).some(([key,value]) => key.length > 2000 || !['matched','missing','failed'].includes(value))) throw new Error('Invalid cache counts or attempts.');
    return s; }
async function atomic(path: string, value: unknown) { await mkdir(dirname(path), { recursive: true }); const tmp = `${path}.${randomUUID()}.tmp`; await writeFile(tmp, JSON.stringify(value), { mode: 0o600 }); await rename(tmp, path); }
export function createHomepageLogoCatalog(options: {
    snapshotPath?: string;
} = {}) { return { load: async () => { try {
        const s = await readSnapshot(options.snapshotPath ?? defaultHomepageLogoPath());
        const map = new Map(await Promise.all(s.records.filter(r => !rejectedHomepageIconHashes.has(r.normalizedPng ?? '')).map(async r => [r.fingerprint, await displayIcon(r, options.snapshotPath ?? defaultHomepageLogoPath())] as const)));
        return { get: (a: Asset): string | null => homepageIdentityReviewRequired(a) ? null : map.get(assetFingerprint(a)) ?? null, status: { provider: 'official-website-icon', status: Date.now() - Date.parse(s.updatedAt) > 30 * 86400000 ? 'STALE' : 'READY', updatedAt: s.updatedAt, message: `${s.records.length} saved official homepage icons; rights unverified.` } satisfies AssetProviderStatus };
    }
    catch {
        return { get: (_a: Asset): string | null => null, status: { provider: 'official-website-icon', status: 'UNAVAILABLE', updatedAt: null, message: 'No saved official homepage icons.' } satisfies AssetProviderStatus };
    } } }; }
export async function refreshHomepageLogos(options: {
    catalogPath?: string;
    output?: string;
    inputFiles?: string[];
    limit?: number;
    concurrency?: number;
    preview?: string;
    retry?: boolean;
    audit?: boolean;
    resolveOfficialHomepages?: boolean;
    symbols?: string[];
    /** Trusted transport override for deterministic refresh tests. */
    transport?: typeof publicGet;
    onProgress?: (counts: Counts) => void;
} = {}): Promise<Counts> {
    if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1))
        throw new Error('Invalid limit.');
    const concurrency = options.concurrency ?? 6;
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8)
        throw new Error('Concurrency must be 1–8.');
    const get = options.transport ?? publicGet;
    const catalog = await readCatalogSnapshot(options.catalogPath ?? defaultAssetCatalogPath());
    const assets = catalog.providers.flatMap(p => p.assets).filter(a => a.kind === 'STOCK' && ['KOSPI', 'KOSDAQ', 'KONEX'].includes(a.exchange ?? ''));
    const output = options.output ?? defaultHomepageLogoPath();
    let previous: Snapshot | undefined;
    try {
        previous = await readSnapshot(output);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            throw new Error('Existing homepage cache is invalid; saved file preserved.');
    }
    const sourceInputs = options.inputFiles?.length
        ? await Promise.all(options.inputFiles.map(async path => ({ source: path, body: await readFile(path) })))
        : await Promise.all(['stockMkt', 'kosdaqMkt', 'konexMkt'].map(async market => {
            const source = `${KIND_URL}&marketType=${market}`;
            const response = await get(source, KIND_URL, AbortSignal.timeout(8000));
            return { source, body: response.body };
        }));
    const rows = sourceInputs.flatMap(input => parseHomepageRows(new TextDecoder('euc-kr').decode(input.body)));
    const reproducibility = { rulesVersion: homepageExtractionRules, provenanceScope: 'current run only; retained cached results may predate these rules and inputs', previousSnapshotSha256: previous ? createHash('sha256').update(await readFile(output)).digest('hex') : null, selectedCount: 0, retainedCount: 0, mixedCachedResults: false, resolveOfficialHomepages: options.resolveOfficialHomepages === true, method: 'deterministic current-run extraction; no LLM or curated homepage mapping', catalogSha256: createHash('sha256').update(await readFile(options.catalogPath ?? defaultAssetCatalogPath())).digest('hex'), sources: sourceInputs.map(input => ({ source: input.source, sha256: createHash('sha256').update(input.body).digest('hex') })) };
    const fingerprints = new Set(assets.map(assetFingerprint));
    const records = new Map((previous?.records ?? []).filter(r => fingerprints.has(r.fingerprint) && !r.homepageEvidenceUrls?.length).map(r => [r.fingerprint, r]));
    const attempts = { ...previous?.attempts };
    for (const record of previous?.records ?? []) if (record.homepageEvidenceUrls?.length) delete attempts[record.fingerprint];
    const diagnostics = Object.fromEntries(Object.entries(previous?.diagnostics ?? {}).filter(([fp]) => fingerprints.has(fp)));
    for (const record of previous?.records ?? []) if (record.homepageEvidenceUrls?.length) delete diagnostics[record.fingerprint]; 
    if (options.symbols?.some(symbol => !/^[A-Z0-9]{6}$/.test(symbol))) throw new Error('Invalid symbols.');
    const selected = assets.filter(a => !options.symbols?.length || options.symbols.includes(a.symbol ?? '')).filter(a => options.audit ? true : options.retry ? !records.has(assetFingerprint(a)) : !attempts[assetFingerprint(a)]).slice(0, options.limit);
    reproducibility.selectedCount = selected.length;
    const selectedFingerprints = new Set(selected.map(assetFingerprint));
    reproducibility.retainedCount = assets.filter(asset => !selectedFingerprints.has(assetFingerprint(asset)) && !!attempts[assetFingerprint(asset)]).length;
    reproducibility.mixedCachedResults = reproducibility.retainedCount > 0;
    let finished = 0;
    const counts = (): Counts => { const states = assets.map(a => attempts[assetFingerprint(a)]).filter(Boolean); return { total: assets.length, processed: states.length, matched: records.size, missing: states.filter(s => s === 'missing').length, failed: states.filter(s => s === 'failed').length, bounded: states.length < assets.length, reasons: Object.fromEntries([...new Set(Object.values(diagnostics).map(d => d.reason))].map(reason => [reason, Object.values(diagnostics).filter(d => d.reason === reason).length])) }; };
    let saving = Promise.resolve();
    const save = () => { saving = saving.then(() => {
        const inherited = new Set(assets.filter(asset => !selectedFingerprints.has(assetFingerprint(asset)) && !!attempts[assetFingerprint(asset)]).map(assetFingerprint));
        for (const record of previous?.records ?? []) if (records.get(record.fingerprint) === record) inherited.add(record.fingerprint);
        reproducibility.retainedCount = inherited.size;
        reproducibility.mixedCachedResults = inherited.size > 0;
        return atomic(output, { version: 1, updatedAt: new Date().toISOString(), records: [...records.values()].sort((a,b)=>a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0), attempts, diagnostics, reproducibility, allAssets: previewAssets(assets, rows, attempts, diagnostics), counts: counts() });
    }); return saving; };
    let cursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (cursor < selected.length) {
            const asset = selected[cursor++]!;
            const fp = assetFingerprint(asset);
            const matches = rows.filter(r => r.symbol === asset.symbol && r.name === asset.name && r.exchange === asset.exchange);
            let stage = 'kind-match', currentUrl: string | undefined;
            let automaticAuthority: Awaited<ReturnType<typeof resolveKindHomepage>> = null;
            const attemptTrace: NonNullable<LogoDiagnostic['attemptTrace']> = [];
            const trace = (entry: LogoDiagnostic & { inputHash?: string }) => { if (attemptTrace.length < 12) attemptTrace.push({reason:entry.reason,stage:entry.stage,url:entry.url,inputHash:entry.inputHash}); };
            const previousRecord = records.get(fp);
            let rejectedGeneric = rejectedHomepageIconHashes.has(previousRecord?.normalizedPng ?? '');
            if (rejectedGeneric) records.delete(fp);
            try {
                if (homepageIdentityReviewRequired(asset)) {
                    records.delete(fp); attempts[fp] = 'missing';
                    diagnostics[fp] = { reason: 'identity-review-required', stage: 'identity-review' };
                    continue;
                }
                if (matches.length !== 1 || !matches[0]!.homepage) {
                    records.delete(fp);
                    attempts[fp] = 'missing';
                    diagnostics[fp] = { reason: matches.length !== 1 ? 'issuer-row-not-unique' : 'homepage-not-provided', stage };
                }
                else {
                    let homepage = matches[0]!.homepage!;
                    let signal = AbortSignal.timeout(15000);
                    stage = 'homepage'; currentUrl = homepage;
                    let page;
                    try { page = await get(homepage, homepage, signal); }
                    catch (error) {
                        if (options.resolveOfficialHomepages && diagnostic(error, stage, currentUrl).reason === 'tls-error') {
                            trace(diagnostic(error, stage, currentUrl));
                            stage = 'official-homepage-resolution'; currentUrl = KIND_URL;
                            automaticAuthority = await resolveKindHomepage(asset, async (url, origin, authoritySignal, requestOptions) => {
                                currentUrl = url;
                                try {
                                    const response = await get(url, origin, authoritySignal, requestOptions);
                                    trace({reason:'official-authority-document',stage:'official-homepage-resolution',url:response.url,inputHash:createHash('sha256').update(response.body).digest('hex')});
                                    return response;
                                } catch (authorityError) { trace(diagnostic(authorityError, 'official-homepage-resolution', url)); throw authorityError; }
                            }, AbortSignal.timeout(30000), matches[0]!.homepage!);
                            const replacement = automaticAuthority?.homepage ? homepageUrl(automaticAuthority.homepage) : null;
                            if (!replacement || replacement === homepage) {
                                trace({reason:'official-homepage-not-changed',stage,url:currentUrl});
                                throw new Error('Official authority did not provide a different safe homepage.');
                            }
                            homepage = replacement;
                            stage = 'resolved-homepage'; currentUrl = homepage;
                            signal = AbortSignal.timeout(15000);
                            // A newly authority-published host becomes a fresh pinned TLS origin.
                            // Its redirects still cannot cross hosts.
                            page = await get(homepage, homepage, signal);
                        } else {
                            const root = new URL('/', homepage).href;
                            if (!(error instanceof Error) || !/HTTP 404\b/.test(error.message) || root === homepage) throw error;
                            stage = 'official-root'; currentUrl = root;
                            page = await get(root, homepage, signal);
                            if (!/text\/html/i.test(page.mime) || homepageIdentity(decodeHtml(page.body, page.mime), asset.name).status !== 'verified') throw new Error('Root fallback issuer identity unverified.');
                        }
                    }
                    if (!/text\/html/i.test(page.mime))
                        throw new Error('Expected homepage HTML.');
                    let html = decodeHtml(page.body, page.mime);
                    let identity = homepageIdentity(html, asset.name);
                    // One hop and at most three published entry pages, sharing the issuer timeout.
                    if (identity.status !== 'rejected' && (identity.status !== 'verified' || (!declaredIcons(html, page.url).length && !officialLogoCandidates(html, page.url, asset.name).length))) {
                        for (const entry of officialEntryPages(html, page.url)) {
                            try {
                                stage = 'entry-page'; currentUrl = entry;
                                const linked = await get(entry, homepage, signal);
                                if (!/text\/html/i.test(linked.mime)) continue;
                                const linkedHtml = decodeHtml(linked.body, linked.mime);
                                const linkedIdentity = homepageIdentity(linkedHtml, asset.name);
                                if (linkedIdentity.status === 'verified') { page = linked; html = linkedHtml; identity = linkedIdentity; break; }
                            } catch (error) { diagnostics[fp] = diagnostic(error, stage, currentUrl, identity); trace(diagnostics[fp]!); signal.throwIfAborted(); }
                        }
                    }
                    diagnostics[fp] = { reason: 'no-supported-icon', stage: 'discovery', url: page.url, identity };
                    if (identity.status === 'rejected') { records.delete(fp); attempts[fp] = 'missing'; diagnostics[fp]!.reason = 'rejected-homepage'; continue; }
                    const icons = declaredIcons(html, page.url);
                    const methods = new Map<string, string>(icons.map(url => [url, 'declared-icon']));
                    const manifests = (html.match(/<link\b[^>]*>/gi) ?? []).map(attributes).filter(a => /(?:^|\s)manifest(?:\s|$)/i.test(a.rel ?? ''));
                    // Resolve manifests regardless of whether HTML declares unsupported icons.
                    for (const manifest of manifests) {
                        try {
                            if (!manifest.href) continue;
                            const manifestUrl = new URL(manifest.href, page.url).href;
                            stage = 'manifest'; currentUrl = manifestUrl;
                            const response = await get(manifestUrl, homepage, signal);
                            const data = JSON.parse(response.body.toString('utf8'));
                            for (const entry of Array.isArray(data.icons) ? data.icons : []) {
                                if (typeof entry.src !== 'string') continue;
                                const candidate = new URL(entry.src, manifestUrl).href;
                                if (homepageUrl(candidate) && sameHost(candidate, homepage)) { icons.push(candidate); methods.set(candidate, 'manifest-icon'); }
                            }
                        } catch (error) { diagnostics[fp] = diagnostic(error, stage, currentUrl, identity); }
                    }
                    if (identity.status === 'verified') {
                        const officialCandidates = officialLogoCandidates(html, page.url, asset.name);
                        // A successful, verified page provides evidence that a previously inferred
                        // header/organization image is no longer eligible. Network failures above
                        // leave the saved record intact; image fetch failures cannot restore it.
                        if (previousRecord && ['header-logo', 'organization-logo'].includes(previousRecord.discoveryMethod ?? '') && !officialCandidates.some(candidate => candidate.url === previousRecord.imageUrl && candidate.method === previousRecord.discoveryMethod)) records.delete(fp);
                        for (const candidate of officialCandidates) { icons.push(candidate.url); methods.set(candidate.url, candidate.method); }
                        const favicon = new URL('/favicon.ico', page.url).href; icons.push(favicon); if (!methods.has(favicon)) methods.set(favicon, 'favicon-fallback');
                    }
                    let chosen: string | undefined, normalizedPng: string | undefined, normalizedFormat: string | undefined;
                    for (const icon of [...new Set(icons)]) {
                        try {
                            stage = 'icon'; currentUrl = icon;
                            const image = await get(icon, homepage, signal);
                            const normalized = await normalizeIcon(image.body, image.mime);
                            normalizedFormat = normalized.format;
                            normalizedPng = `${createHash('sha256').update(normalized.png).digest('hex')}.png`;
                            if (rejectedHomepageIconHashes.has(normalizedPng)) { rejectedGeneric = true; continue; }
                            await mkdir(resolve(dirname(output), 'homepage-icons'), { recursive: true });
                            await writeFile(resolve(dirname(output), 'homepage-icons', normalizedPng), normalized.png, { mode: 0o600 });
                            chosen = image.url; break;
                        } catch (error) { diagnostics[fp] = { ...diagnostic(error, stage, currentUrl, identity), method: methods.get(icon) }; signal.throwIfAborted(); }
                    }
                    if (chosen) {
                        records.set(fp, { fingerprint: fp, entity: page.url, sourcePage: page.url, imageUrl: chosen, normalizedPng, normalizedFormat, source: 'official-website-icon', license: '공식 홈페이지 아이콘 · 권리 미확인', authoritySource: 'KIND', discoveryMethod: methods.get(currentUrl!), originalHomepage: matches[0]!.homepage ?? undefined, automaticAuthority: automaticAuthority ?? undefined, authorityUrl: asset.sourceUrl });
                        attempts[fp] = 'matched';
                        diagnostics[fp] = { reason: 'matched', stage: 'complete', url: chosen, identity, format: normalizedFormat, method: methods.get(currentUrl!) };
                    }
                    else
                        attempts[fp] = previousRecord && records.has(fp) ? 'matched' : 'missing';
                    if (!chosen && rejectedGeneric) { records.delete(fp); attempts[fp] = 'missing'; diagnostics[fp] = { reason: 'rejected-generic-icon', stage: 'icon-review', identity }; }
                }
            }
            catch (error) {
                diagnostics[fp] = rejectedGeneric ? { reason: 'rejected-generic-icon', stage: 'icon-review', identity: diagnostics[fp]?.identity } : diagnostic(error, stage, currentUrl, diagnostics[fp]?.identity);
                attempts[fp] = previousRecord && records.has(fp) ? 'matched' : 'failed';
            }
            finally {
                if (diagnostics[fp] && automaticAuthority) diagnostics[fp]!.automaticAuthority = automaticAuthority;
                if (diagnostics[fp] && attemptTrace.length) diagnostics[fp]!.attemptTrace = attemptTrace;
                finished++;
                if (finished % 25 === 0) {
                    await save();
                    options.onProgress?.(counts());
                }
            }
        }
    }));
    await save();
    if (options.preview)
        await atomic(options.preview, { version: 1, updatedAt: new Date().toISOString(), counts: counts(), reproducibility, allAssets: previewAssets(assets, rows, attempts, diagnostics), diagnostics, records: await Promise.all([...records.values()].sort((a,b)=>a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0).map(async r => ({ ...r, originalImageUrl: r.imageUrl, imageUrl: await displayIcon(r, output) }))), assets: await Promise.all(assets.filter(a => records.has(assetFingerprint(a))).map(async a => ({ ...a, iconUrl: await displayIcon(records.get(assetFingerprint(a))!, output) }))) });
    return counts();
}

function previewAssets(assets: Asset[], rows: ReturnType<typeof parseHomepageRows>, attempts: Snapshot['attempts'], diagnostics: Record<string, LogoDiagnostic>) {
    return assets.map(asset => {
        const fingerprint = assetFingerprint(asset);
        const matches = rows.filter(row => row.symbol === asset.symbol && row.name === asset.name && row.exchange === asset.exchange);
        return { ...asset, iconUrl: null, fingerprint, attempt: attempts[fingerprint] ?? 'unprocessed', authoritySource: 'KIND', authorityUrl: asset.sourceUrl, originalHomepage: matches.length === 1 ? matches[0]!.homepage : null, diagnostic: { url: matches.length === 1 ? matches[0]!.homepage ?? asset.sourceUrl : asset.sourceUrl, ...(diagnostics[fingerprint] ?? { stage: 'pending', reason: 'not-processed' }) } };
    });
}

export function decodeHtml(body: Buffer, mime: string): string {
    const head = body.subarray(0, 4096).toString('ascii');
    const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(mime)?.[1] ?? /charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ?? 'utf-8';
    try { return new TextDecoder(charset).decode(body); } catch { return body.toString('utf8'); }
}
export function homepageIdentity(html: string, issuer: string): NonNullable<LogoDiagnostic['identity']> {
    const title = unescapeHtml(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/<[^>]*>/g, '').trim().slice(0, 300);
    const text = unescapeHtml(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' '));
    const normalize = (s: string) => s.toLowerCase().replace(/주식회사|㈜|\(주\)|[\s.,()-]/g, '');
    const issuerMention = normalize(text).includes(normalize(issuer));
    const rejected = /domain (?:is )?(?:for sale|parked)|buy this domain|sedo domain|parkingcrew|account suspended|default web site page|welcome to nginx|apache2? (?:ubuntu )?default page|access denied|request rejected|도메인 판매|접근이 거부/i.test(title + ' ' + text.slice(0, 10000));
    return { status: rejected ? 'rejected' : issuerMention ? 'verified' : 'unknown', title, issuerMention };
}
function diagnostic(error: unknown, stage: string, url?: string, identity?: LogoDiagnostic['identity']): LogoDiagnostic {
    const raw = error instanceof Error ? error.message : 'Unknown failure';
    const status = /HTTP (\d{3})/.exec(raw)?.[1];
    const reason = raw === 'Official authority did not provide a different safe homepage.' ? 'official-homepage-not-changed' : status ? `http-${status}` : /abort|timeout/i.test(raw) ? 'timeout' : /certificate|TLS|SSL/i.test(raw) ? 'tls-error' : /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw) ? 'dns-error' : /cross-host|Unsafe/.test(raw) ? 'unsafe-or-cross-host-url' : stage === 'icon' ? 'unsupported-or-invalid-icon' : 'request-failed';
    return { reason, stage, url: url ? (() => { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; })() : undefined, status: status ? Number(status) : undefined, error: raw.replace(/https?:\/\/\S+/g, '[URL]').slice(0, 240), identity };
}
async function displayIcon(record: HomepageLogoRecord, snapshot: string): Promise<string> {
    if (!record.normalizedPng) return record.imageUrl;
    const file = resolve(dirname(snapshot), 'homepage-icons', record.normalizedPng);
    if ((await stat(file)).size > MAX) throw new Error('Normalized icon too large.');
    const png = await readFile(file);
    if (!validRaster(png, 'image/png')) throw new Error('Invalid normalized PNG.');
    return `data:image/png;base64,${png.toString('base64')}`;
}

/** Apply reviewed identity/content holds to an existing snapshot without network access. */
export async function reviewHomepageCache(options: { output?: string; catalogPath?: string; preview?: string } = {}): Promise<Counts> {
 const output = options.output ?? defaultHomepageLogoPath();
 const snapshot = await readSnapshot(output);
 const catalog = await readCatalogSnapshot(options.catalogPath ?? defaultAssetCatalogPath());
 const assets = catalog.providers.flatMap(p => p.assets).filter(a => a.kind === 'STOCK' && ['KOSPI','KOSDAQ','KONEX'].includes(a.exchange ?? ''));
 const byFingerprint = new Map(assets.map(a => [assetFingerprint(a), a]));
 const diagnostics = {...snapshot.diagnostics};
 for (const entry of Object.values(diagnostics)) if (entry.error === 'Official authority did not provide a different safe homepage.') entry.reason = 'official-homepage-not-changed';
 snapshot.records = snapshot.records.filter(record => {
  const asset = byFingerprint.get(record.fingerprint);
  const reason = asset && homepageIdentityReviewRequired(asset) ? 'identity-review-required' : rejectedHomepageIconHashes.has(record.normalizedPng ?? '') ? 'rejected-generic-icon' : null;
  if (!reason) return true;
  snapshot.attempts[record.fingerprint] = 'missing';
  diagnostics[record.fingerprint] = {reason, stage: reason === 'identity-review-required' ? 'identity-review' : 'icon-review'};
  return false;
 });
 snapshot.records.sort((a,b)=>a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0);
 const states = assets.map(a => snapshot.attempts[assetFingerprint(a)]).filter(Boolean);
 snapshot.diagnostics = diagnostics;
 snapshot.updatedAt = new Date().toISOString();
 snapshot.reproducibility = {...snapshot.reproducibility, reviewMode:'offline review only; extraction provenance is inherited and may include cached results from prior rules', reviewRulesVersion:homepageExtractionRules, observedAuthorityAttempts:Object.values(diagnostics).some(entry => !!entry.automaticAuthority || entry.attemptTrace?.some(attempt => attempt.stage === 'official-homepage-resolution')), offlineReviewedAt:snapshot.updatedAt};
 snapshot.counts = {total: assets.length, processed: states.length, matched: snapshot.records.length, missing: states.filter(s => s === 'missing').length, failed: states.filter(s => s === 'failed').length, bounded: states.length < assets.length, reasons: Object.fromEntries([...new Set(Object.values(diagnostics).map(d => d.reason))].map(reason => [reason,Object.values(diagnostics).filter(d => d.reason === reason).length]))};
 snapshot.allAssets = previewAssets(assets, [], snapshot.attempts, diagnostics).map(a => ({...a, originalHomepage: snapshot.allAssets?.find(previous => previous.fingerprint === a.fingerprint)?.originalHomepage ?? null}));
 await atomic(output, snapshot);
 if (options.preview) {
  const records = await Promise.all(snapshot.records.map(async r => ({...r,originalImageUrl:r.imageUrl,imageUrl:await displayIcon(r,output)})));
  const images = new Map(records.map(r => [r.fingerprint,r.imageUrl]));
  await atomic(options.preview,{...snapshot,records,allAssets:snapshot.allAssets,assets:assets.filter(a=>images.has(assetFingerprint(a))).map(a=>({...a,iconUrl:images.get(assetFingerprint(a))}))});
 }
 return snapshot.counts;
}
