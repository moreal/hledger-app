import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKindOverview, parseReportHomepage, resolveKindHomepage } from './kind-homepages.ts';
import type { Asset } from '../../packages/domain/src/asset-catalog.ts';
const asset = { source: 'kind', name: '삼성전자', symbol: '005930', exchange: 'KOSPI' } as Asset;
const overview = '<table><th>한글명</th><td><img src="/icon">삼성전자</td><th>종목코드</th><td>005930</td><th>시장구분</th><td>유가증권 상장</td><th>홈페이지</th><td><a href="http://www.samsung.com/sec">www.samsung.com/sec</a></td></table>';
test('official overview requires exact issuer name, symbol and exchange', () => {
    assert.equal(parseKindOverview(overview, asset), 'http://www.samsung.com/sec');
    for (const change of [{name:'삼성전자우'}, {symbol:'005935'}, {exchange:'KOSDAQ'}]) assert.equal(parseKindOverview(overview, {...asset,...change}), null);
    assert.equal(parseKindOverview(overview.replace('http://www.samsung.com/sec', 'javascript:alert(1)'), asset), null);
});
test('resolver follows code declared by exact-name official search and records response hashes', async () => {
    const calls: string[] = [];
    const result = await resolveKindHomepage(asset, async (url, origin) => {
        calls.push(url); assert.equal(origin, 'https://kind.krx.co.kr');
        return { url, mime:'text/html;charset=utf-8', body: Buffer.from(calls.length === 1 ? `<tr><td><a onclick="companysummary_open('00593'); return false;"> 삼성전자</a></td></tr>` : overview) };
    }, new AbortController().signal);
    assert.equal(result?.homepage, 'http://www.samsung.com/sec');
    assert.match(calls[1]!, /strIsurCd=00593/);
    assert.match(result!.inputHash, /^[a-f0-9]{64}$/);
    assert.match(result!.searchInputHash, /^[a-f0-9]{64}$/);
});
test('resolver rejects nonofficial redirect response and a mismatched search identity', async () => {
    await assert.rejects(resolveKindHomepage(asset, async () => ({url:'https://evil.example/',mime:'text/html',body:Buffer.from(overview)}), new AbortController().signal), /source-mismatch/);
    let count=0;
    assert.equal(await resolveKindHomepage(asset, async url => {count++; return {url,mime:'text/html',body:Buffer.from(`<tr><a onclick="companysummary_open('00593')">삼성전자우</a></tr>`)};},new AbortController().signal),null);
    assert.equal(count,1);
});

test('report homepage requires an issuer cover table and ignores subsidiary fields', () => {
    const cover = (name: string, url: string) => `<table><td>회 사 명 :</td><td>주식회사 ${name}</td><td>(홈페이지) ${url}</td></table>`;
    assert.equal(parseReportHomepage(cover('엠씨넥스','http://www.mcnex.com'),'엠씨넥스'), 'http://www.mcnex.com/');
    assert.equal(parseReportHomepage('<td>홈페이지</td><td>https://subsidiary.example</td>','엠씨넥스'), null);
    assert.equal(parseReportHomepage(cover('다른회사','https://other.example'),'엠씨넥스'), null);
});
test('stale overview falls back to latest exact-issuer periodic report with provenance', async () => {
    const calls: string[] = [];
    const result = await resolveKindHomepage(asset, async (url, origin, signal, options) => {
        calls.push(url);
        const bodies = [
            `<tr><a onclick="companysummary_open('00593')">삼성전자</a></tr>`, overview,
            `<tr><a onclick="companysummary_open('00593')">삼성전자</a><a onclick="openDisclsViewer('20260814001620','')">반기보고서(일반법인)</a></tr>`,
            `<h1>삼성전자 (005930)</h1><select id="mainDoc"><option value='20260814005430|Y'>반기보고서(일반법인) (2026.08.14)</option></select>`,
            `parent.setPath('','https://kind.krx.co.kr/external/2026/08/14/001620/20260814005430/11012.htm','','','');`,
            `<table><td>회사명 :</td><td>삼성전자</td><td>(홈페이지) https://new.example.com</td></table>`
        ];
        if (calls.length === 3) {assert.equal(options?.method,'POST'); assert.equal(new URLSearchParams(options!.body).get('repIsuSrtCd'),'A005930');}
        return {url,mime:'text/html;charset=utf-8',body:Buffer.from(bodies[calls.length-1]!)};
    },new AbortController().signal,'https://www.samsung.com/sec');
    assert.equal(result?.homepage,'https://new.example.com/');
    assert.equal(result?.reportDate,'20260814');
    assert.equal(result?.authorityChain?.length,4);
    assert.equal(calls.length,6);
});
test('missing homepage in newest report never falls back to older report', async () => {
    let count = 0;
    const result = await resolveKindHomepage(asset, async url => {
        const bodies = [
            `<tr><a onclick="companysummary_open('00593')">삼성전자</a></tr>`, overview,
            ['20260814001620','20260514001620'].map(acpt => `<tr><a onclick="companysummary_open('00593')">삼성전자</a><a onclick="openDisclsViewer('${acpt}','')">반기보고서(일반법인)</a></tr>`).join(''),
            `<h1>삼성전자 (005930)</h1><select id="mainDoc"><option value='20260814005430|Y'>반기보고서(일반법인) (2026.08.14)</option></select>`,
            `parent.setPath('','https://kind.krx.co.kr/external/2026/08/14/001620/20260814005430/11012.htm','','','');`,
            '<table><td>회사명 :</td><td>삼성전자</td></table><table><td>홈페이지</td><td>https://subsidiary.example</td></table>'
        ];
        assert.ok(count < 6, 'must not request an older report');
        return {url,mime:'text/html',body:Buffer.from(bodies[count++]!)};
    },new AbortController().signal,'https://www.samsung.com/sec');
    assert.equal(count,6);
    assert.equal(result?.homepage,'http://www.samsung.com/sec');
});

test('overview identity mismatch prevents disclosure fallback', async () => {
    for (const wrong of [overview.replace('삼성전자','다른회사'),overview.replace('005930','005935'),overview.replace('유가증권 상장','코스닥 상장')]) {
        let count = 0;
        assert.equal(await resolveKindHomepage(asset, async url => ({url,mime:'text/html',body:Buffer.from(++count === 1 ? `<tr><a onclick="companysummary_open('00593')">삼성전자</a></tr>` : wrong)}),new AbortController().signal,'https://www.samsung.com/sec'),null);
        assert.equal(count,2);
    }
});
