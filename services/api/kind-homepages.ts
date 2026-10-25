import { createHash } from 'node:crypto';
import type { Asset } from '../../packages/domain/src/asset-catalog.ts';

const ORIGIN = 'https://kind.krx.co.kr';
const MAX_BYTES = 2 * 1024 * 1024;
export type KindPublicGet = (url: string, origin: string, signal: AbortSignal, options?: { method: 'POST'; body: string }) => Promise<{ body: Buffer; mime: string; url: string }>;
export type KindHomepageResolution = {
    homepage: string; evidenceUrl: string; inputHash: string; name: string; symbol: string; exchange: string;
    searchEvidenceUrl: string; searchInputHash: string; reportDate?: string; reportTitle?: string; authorityChain?: {url:string; inputHash:string}[]; reportSearchBody?: string;
};
const decode = (s: string) => s.replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const text = (s: string) => decode(s.replace(/<[^>]*>/g, '')).trim().replace(/\s+/g, ' ');
const hash = (body: Buffer) => createHash('sha256').update(body).digest('hex');
function checkedBody(response: Awaited<ReturnType<KindPublicGet>>, expected: string): string {
    // A redirect or a proxy response must never acquire KIND authority.
    if (new URL(response.url).href !== expected || new URL(response.url).origin !== ORIGIN) throw new Error('kind-official-source-mismatch');
    if (response.body.length > (new URL(expected).pathname.startsWith('/external/') ? 8 * MAX_BYTES / 2 : MAX_BYTES) || !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.mime)) throw new Error('kind-invalid-response');
    return new TextDecoder(/charset\s*=\s*[\"']?euc-kr/i.test(response.mime + response.body.subarray(0, 1500).toString('ascii')) ? 'euc-kr' : 'utf-8').decode(response.body);
}
function matchingOverviewFields(html: string, asset: Pick<Asset, 'name' | 'symbol' | 'exchange'>): Map<string,string> | null {
    const fields = new Map<string, string>();
    for (const match of html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/gi)) {
        const key = text(match[1]!);
        if (fields.has(key)) return null;
        fields.set(key, match[2]!);
    }
    const market = text(fields.get('시장구분') ?? '');
    const exchange = /^유가증권(?: 상장)?$/.test(market) ? 'KOSPI' : /^코스닥(?: 상장)?$/.test(market) ? 'KOSDAQ' : /^코넥스(?: 상장)?$/.test(market) ? 'KONEX' : null;
    if (text(fields.get('한글명') ?? '') !== asset.name || text(fields.get('종목코드') ?? '') !== asset.symbol || exchange !== asset.exchange) return null;
    return fields;
}
export function parseKindOverview(html: string, asset: Pick<Asset, 'name' | 'symbol' | 'exchange'>): string | null {
    const fields = matchingOverviewFields(html, asset);
    if (!fields) return null;
    const cell = fields.get('홈페이지') ?? '';
    const links = [...cell.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)];
    if (links.length !== 1) return null;
    try {
        const url = new URL(decode(links[0]![1]!));
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        return url.href;
    } catch { return null; }
}
/** Official search supplies the issuer code; the overview must independently match all identity fields. */
export async function resolveKindHomepage(asset: Asset, get: KindPublicGet, signal: AbortSignal, originalHomepage?: string): Promise<KindHomepageResolution | null> {
    if (asset.source !== 'kind' || !/^[0-9A-Z]{6}$/.test(asset.symbol) || !asset.name || asset.name.length > 200) return null;
    const search = new URL('/corpgeneral/corpList.do', ORIGIN);
    search.search = new URLSearchParams({ method: 'searchCorpList', currentPageSize: '100', pageIndex: '1', comAbbrv: asset.name }).toString();
    const searchResponse = await get(search.href, ORIGIN, signal);
    const html = checkedBody(searchResponse, search.href);
    const codes = new Set<string>();
    for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const links = [...row[1]!.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
        for (const link of links) {
            const code = link[1]!.match(/companysummary_open\(\s*'([0-9A-Z]{5})'\s*\)/);
            if (code && text(link[2]!) === asset.name) codes.add(code[1]!);
        }
    }
    if (codes.size !== 1) return null;
    const detail = new URL('/common/companysummary.do', ORIGIN);
    detail.search = new URLSearchParams({ method: 'searchCompanySummaryOvrvwDetail', strIsurCd: [...codes][0]! }).toString();
    const response = await get(detail.href, ORIGIN, signal);
    const detailHtml = checkedBody(response, detail.href);
    if (!matchingOverviewFields(detailHtml, asset)) return null;
    const homepage = parseKindOverview(detailHtml, asset);
    const resolved = homepage ? { homepage, evidenceUrl: detail.href, inputHash: hash(response.body), name: asset.name, symbol: asset.symbol, exchange: asset.exchange!, searchEvidenceUrl: search.href, searchInputHash: hash(searchResponse.body) } : null;
    if (!originalHomepage || (homepage && comparable(homepage) !== comparable(originalHomepage))) return resolved;
    return await resolveReportHomepage(asset, get, signal, [...codes][0]!) ?? resolved;
}

const comparable = (value: string) => { try { const u = new URL(value); return u.hostname.replace(/^www\./, '').toLowerCase() + u.pathname.replace(/\/$/, ''); } catch { return value; } };
export function parseReportHomepage(html: string, issuerName: string): string | null {
    const canonical = (value: string) => value.replace(/\s+/g, '').replace(/^(?:주식회사|\(주\)|㈜)/, '').replace(/(?:주식회사|\(주\)|㈜)$/, '');
    // The issuer cover table contains both its company-name field and its parenthesized homepage field.
    const candidates = new Set<string>();
    for (const table of html.slice(0, 100_000).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
        const cells = [...table[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => text(m[1]!));
        const company = cells.findIndex(value => value.replace(/\s/g, '') === '회사명:');
        if (company < 0 || canonical(cells[company + 1] ?? '') !== canonical(issuerName)) continue;
        for (const value of cells) {
            const raw = value.match(/^\(홈\s*페이지\)\s*(https?:\/\/[^\s<>]+)\s*$/i)?.[1];
            if (!raw) continue;
            try { const u = new URL(raw); if (!u.username && !u.password) candidates.add(u.href); } catch { /* malformed declaration */ }
        }
    }
    return candidates.size === 1 ? [...candidates][0]! : null;
}
async function resolveReportHomepage(asset: Asset, get: KindPublicGet, signal: AbortSignal, issuerCode: string): Promise<KindHomepageResolution | null> {
    const end = new Date(); const start = new Date(end); start.setUTCFullYear(start.getUTCFullYear() - 2);
    const searchUrl = ORIGIN + '/disclosure/searchdisclosurebycorp.do';
    const body = new URLSearchParams({method:'searchDisclosureByCorpSub',forward:'searchdisclosurebycorp_sub',repIsuSrtCd:'A'+asset.symbol,searchCodeType:'number',fromDate:start.toISOString().slice(0,10),toDate:end.toISOString().slice(0,10),currentPageSize:'100',pageIndex:'1',orderMode:'1',orderStat:'D',reportNm:'보고서'}).toString();
    const response = await get(searchUrl, ORIGIN, signal, {method:'POST', body});
    const searchHtml = checkedBody(response, searchUrl);
    const chain = [{url: searchUrl, inputHash: hash(Buffer.concat([Buffer.from(body), response.body]))}];
    const reports: {acpt: string; title: string}[] = [];
    for (const row of searchHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const links = [...row[1]!.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
        if (!links.some(link => link[1]!.includes("companysummary_open('" + issuerCode + "')") && text(link[2]!) === asset.name)) continue;
        for (const link of links) {
            const match = link[1]!.match(/openDisclsViewer\('([0-9]{14})',''\)/);
            const title = text(link[2]!);
            if (match && /^(?:\[정정\])?(?:사업|반기|분기)보고서(?:\(일반법인\))?$/.test(title)) reports.push({acpt:match[1]!,title});
        }
    }
    reports.sort((a,b) => b.acpt.localeCompare(a.acpt));
    for (const report of reports.slice(0,1)) {
        const viewerUrl = ORIGIN + '/common/disclsviewer.do?' + new URLSearchParams({method:'searchInitInfo',acptNo:report.acpt,docNo:''});
        const viewer = await get(viewerUrl, ORIGIN, signal); const viewerHtml = checkedBody(viewer, viewerUrl);
        chain.push({url:viewerUrl,inputHash:hash(viewer.body)});
        if (![...viewerHtml.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].some(m => text(m[1]!) === asset.name + ' (' + asset.symbol + ')')) continue;
        const select = viewerHtml.match(/<select\b[^>]*id=["']mainDoc["'][^>]*>([\s\S]*?)<\/select>/i)?.[1] ?? '';
        const docs = [...select.matchAll(/<option\b[^>]*value=["']([0-9]{14})\|Y["'][^>]*>([\s\S]*?)<\/option>/gi)];
        if (docs.length !== 1 || !text(docs[0]![2]!).startsWith(report.title)) continue;
        const pathUrl = ORIGIN + '/common/disclsviewer.do?' + new URLSearchParams({method:'searchContents',docNo:docs[0]![1]!});
        const path = await get(pathUrl, ORIGIN, signal); const pathHtml = checkedBody(path, pathUrl);
        chain.push({url:pathUrl,inputHash:hash(path.body)});
        const documentUrl = pathHtml.match(/parent\.setPath\('[^']*','(https:\/\/kind\.krx\.co\.kr\/external\/[^']+\.htm)'/)?.[1];
        if (!documentUrl || !new URL(documentUrl).pathname.includes('/'+docs[0]![1]!+'/')) continue;
        const document = await get(documentUrl, ORIGIN, signal);
        const homepage = parseReportHomepage(checkedBody(document, documentUrl), asset.name);
        chain.push({url:documentUrl,inputHash:hash(document.body)});
        if (homepage) return {homepage,evidenceUrl:documentUrl,inputHash:hash(document.body),name:asset.name,symbol:asset.symbol,exchange:asset.exchange!,searchEvidenceUrl:searchUrl,searchInputHash:chain[0]!.inputHash,reportDate:report.acpt.slice(0,8),reportTitle:report.title,authorityChain:chain,reportSearchBody:body};
    }
    return null;
}
