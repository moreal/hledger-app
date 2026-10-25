import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAddress, homepageUrl, declaredIcons, validRaster, parseHomepageRows } from './homepage-logos.ts';
test('public transport excludes private and IPv6 transition addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.1.1', '169.254.169.254', '192.168.1.1', '100.64.1.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2002:0808:0808::1', '64:ff9b::808:808', '2001::1', '2001:0000:1234::1', '2001:0db8::1'])
        assert.equal(isPublicAddress(ip), false, ip);
    assert.equal(isPublicAddress('8.8.8.8'), true);
    assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});
test('homepages reject portals and credentials and force HTTPS', () => {
    assert.equal(homepageUrl('http://www.example.com/a'), 'https://www.example.com/a');
    for (const url of ['https://naver.com/a', 'https://user:pass@example.com', 'https://127.0.0.1', 'https://foo.local'])
        assert.equal(homepageUrl(url), null);
});
test('only declared same-host icons qualify, never social images or arbitrary favicon guesses', () => {
    assert.deepEqual(declaredIcons('<meta property="og:image" content="/card.png"><link href="/apple.png" rel="apple-touch-icon"><link rel="icon" href="https://cdn.example.net/a.png">', 'https://example.com'), ['https://example.com/apple.png']);
});
test('raster validates MIME against magic', () => {
    assert.equal(validRaster(Buffer.from('89504e470d0a1a0a', 'hex'), 'image/png'), false);
    assert.equal(validRaster(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64'), 'image/png'), true);
    assert.equal(validRaster(Buffer.from('<svg/>'), 'image/png'), false);
});
test('KIND homepage maps exact market issuer code and name', () => {
    assert.deepEqual(parseHomepageRows('<tr><th>회사명</th><th>시장구분</th><th>종목코드</th><th>홈페이지</th></tr><tr><td>삼성전자</td><td>유가</td><td>005930</td><td>http://www.samsung.com</td></tr>'), [{ name: '삼성전자', exchange: 'KOSPI', symbol: '005930', homepage: 'https://www.samsung.com/' }]);
});
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshHomepageLogos, createHomepageLogoCatalog } from './homepage-logos.ts';
test('corrupt existing cache is preserved and runtime loading fails closed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'homepage-logo-'));
    try {
        const output = join(dir, 'logos.json'), catalogPath = join(dir, 'catalog.json');
        await writeFile(output, 'bad cache');
        await writeFile(catalogPath, JSON.stringify({ version: 1, providers: [{ provider: 'kind', updatedAt: new Date().toISOString(), assets: [{ id: 'kind:KOSPI:005930', name: '삼성전자', symbol: '005930', exchange: 'KOSPI', kind: 'STOCK', isin: null, source: 'kind', sourceUrl: 'https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13&currentPageSize=3000&pageIndex=1', asOf: '2026-10-22', iconText: '삼성', iconUrl: null }] }] }));
        await assert.rejects(refreshHomepageLogos({ catalogPath, output }), /saved file preserved/);
        assert.equal(await readFile(output, 'utf8'), 'bad cache');
        assert.equal((await createHomepageLogoCatalog({ snapshotPath: output }).load()).status.status, 'UNAVAILABLE');
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('refresh matches exact KIND identity, records missing homepages and resumes without repeating attempts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'homepage-resume-'));
 try {
 const output=join(dir,'logos.json'),catalogPath=join(dir,'catalog.json'),input=join(dir,'kind.xls');
 const asset={id:'kind:KOSPI:005930',name:'삼성전자',symbol:'005930',exchange:'KOSPI',kind:'STOCK',isin:null,source:'kind',sourceUrl:'https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13&currentPageSize=3000&pageIndex=1',asOf:'2026-10-22',iconText:'삼성',iconUrl:null};
 await writeFile(catalogPath,JSON.stringify({version:1,providers:[{provider:'kind',updatedAt:new Date().toISOString(),assets:[asset]}]}));
 const entity=(value:string)=>[...value].map(c=>`&#${c.codePointAt(0)};`).join('');
 await writeFile(input,`<tr><th>${entity('회사명')}</th><th>${entity('시장구분')}</th><th>${entity('종목코드')}</th><th>${entity('홈페이지')}</th></tr><tr><td>${entity('삼성전자')}</td><td>${entity('유가')}</td><td>005930</td><td></td></tr>`);
 const first=await refreshHomepageLogos({catalogPath,output,inputFiles:[input],limit:1});
 assert.equal(first.processed,1);assert.equal(first.missing,1);assert.equal(first.matched,0);
 const second=await refreshHomepageLogos({catalogPath,output,inputFiles:[input],limit:1});
 assert.deepEqual(second,first);
 } finally {await rm(dir,{recursive:true,force:true});}
});

import { decodeHtml, homepageIdentity } from './homepage-logos.ts';
test('declaration parser handles case, unquoted attributes and does not truncate candidates', () => {
 const html = '<LINK REL=ICON HREF=/a.ico><link rel=icon href=/b.svg><link rel=icon href=/c.ico><link REL=apple-touch-icon HREF=/apple.png>';
 const icons = declaredIcons(html, 'https://example.com/');
 assert.equal(icons.length, 4); assert.ok(icons.includes('https://example.com/apple.png'));
});
test('HTML decoding respects declared Korean charset', () => {
 assert.equal(decodeHtml(Buffer.from([0xbb, 0xef, 0xbc, 0xba]), 'text/html; charset=EUC-KR'), '삼성');
});
test('identity uses issuer text and explicitly marks unknown English pages', () => {
 assert.equal(homepageIdentity('<title>삼성전자</title>', '삼성전자').status, 'verified');
 assert.equal(homepageIdentity('<title>Samsung Electronics</title>', '삼성전자').status, 'unknown');
 assert.equal(homepageIdentity('<title>Domain for sale</title>', '삼성전자').status, 'rejected');
 assert.equal(homepageIdentity('<title>Access Denied</title>', '삼성전자').status, 'rejected');
});
test('refresh preserves success and discovery diagnostic reasons and normalized format', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'homepage-diagnostics-'));
 try {
  const output = join(dir,'logos.json'), catalogPath = join(dir,'catalog.json'), input = join(dir,'kind.xls');
  const asset = {id:'kind:KOSPI:005930',name:'삼성전자',symbol:'005930',exchange:'KOSPI',kind:'STOCK',isin:null,source:'kind',sourceUrl:'https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13&currentPageSize=3000&pageIndex=1',asOf:'2026-10-22',iconText:'삼성',iconUrl:null};
  await writeFile(catalogPath,JSON.stringify({version:1,providers:[{provider:'kind',updatedAt:new Date().toISOString(),assets:[asset]}]}));
  const entity=(value:string)=>[...value].map(c=>`&#${c.codePointAt(0)};`).join('');
  await writeFile(input,`<tr><th>${entity('회사명')}</th><th>${entity('시장구분')}</th><th>${entity('종목코드')}</th><th>${entity('홈페이지')}</th></tr><tr><td>${entity(asset.name)}</td><td>${entity('유가')}</td><td>005930</td><td>https://example.com/</td></tr>`);
  const transport = async (url:string) => ({url,mime:url.endsWith('.svg')?'image/svg+xml':'text/html',body:Buffer.from(url.endsWith('.svg')?'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>':'<title>삼성전자</title><link rel=icon href=/brand.svg>')});
  const result = await refreshHomepageLogos({catalogPath,output,inputFiles:[input],transport});
  assert.equal(result.reasons?.matched,1);
  let saved=JSON.parse(await readFile(output,'utf8'));
  assert.equal(Object.values(saved.diagnostics).map((d:any)=>d.reason)[0],'matched');
  assert.equal(saved.records[0].normalizedFormat,'svg');
  assert.equal(Object.values(saved.diagnostics).map((d:any)=>d.format)[0],'svg');
  const headerTransport = async (url:string) => ({url,mime:url.endsWith('.svg')?'image/svg+xml':'text/html',body:Buffer.from(url.endsWith('.svg')?'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>':'<title>삼성전자</title><header><h1><img class="logo" src="/brand.svg"></h1></header>')});
  const excluded = await refreshHomepageLogos({catalogPath,output,inputFiles:[input],symbols:['999999'],audit:true,transport:async()=>{throw new Error('must not fetch excluded issuer');}});
  assert.equal(excluded.total,1); assert.equal(excluded.matched,1);
  await refreshHomepageLogos({catalogPath,output,inputFiles:[input],symbols:['005930'],audit:true,transport:headerTransport});
  saved=JSON.parse(await readFile(output,'utf8'));
  assert.equal(saved.records[0].discoveryMethod,'header-logo');
  assert.equal(Object.values(saved.diagnostics).map((d:any)=>d.method)[0],'header-logo');
  assert.equal(saved.records[0].originalHomepage,'https://example.com/');
  await refreshHomepageLogos({catalogPath,output,inputFiles:[input],audit:true,transport:async(url)=>{
   if(url.endsWith('/favicon.ico')) throw new Error('HTTP 404');
   return {url,mime:'text/html',body:Buffer.from('<title>삼성전자</title><header><img class="logo" src="/brand.svg" alt="삼성전자서비스"></header>')};
  }});
  saved=JSON.parse(await readFile(output,'utf8')); assert.equal(saved.records.length,0,'successful page invalidates ineligible cached header');
  await refreshHomepageLogos({catalogPath,output,inputFiles:[input],retry:true,transport:headerTransport});
  await refreshHomepageLogos({catalogPath,output,inputFiles:[input],audit:true,transport:async()=>{throw new Error('TLS certificate failure');}});
  saved=JSON.parse(await readFile(output,'utf8')); assert.equal(saved.records.length,1,'network failure preserves cached success');

  const originalInput = await readFile(input,'utf8');
  await writeFile(input, originalInput.replace('005930', '999999'));
  await refreshHomepageLogos({catalogPath,output,inputFiles:[input],audit:true,transport});
  saved=JSON.parse(await readFile(output,'utf8'));
  assert.equal(saved.records.length,0); assert.equal(saved.counts.reasons['issuer-row-not-unique'],1);
  await writeFile(input,originalInput);
  await refreshHomepageLogos({catalogPath,output,inputFiles:[input],retry:true,transport});

  await refreshHomepageLogos({catalogPath,output,inputFiles:[input],audit:true,transport:async(url)=>({url,mime:'text/html',body:Buffer.from('<title>Domain for sale</title>')})});
  saved=JSON.parse(await readFile(output,'utf8'));
  assert.equal(saved.records.length,0); assert.equal(saved.counts.reasons['rejected-homepage'],1);
  await refreshHomepageLogos({catalogPath,output,inputFiles:[input],retry:true,transport:async(url)=>({url,mime:'text/html',body:Buffer.from('<title>English issuer</title>')})});
  saved=JSON.parse(await readFile(output,'utf8'));
  assert.equal(saved.counts.reasons['no-supported-icon'],1);
 } finally { await rm(dir,{recursive:true,force:true}); }
});
import { homepageIdentityReviewRequired } from './homepage-logos.ts';
test('review holds require complete exact issuer identity', () => {
 for (const [symbol,name] of [['035620','바른손이앤에이'],['018700','졸스']]) assert.equal(homepageIdentityReviewRequired({id:`kind:KOSDAQ:${symbol}`,name,symbol,exchange:'KOSDAQ',source:'kind'} as any),true);
 const base = {id:'kind:KOSPI:044820',name:'코스맥스비티아이',symbol:'044820',exchange:'KOSPI',kind:'STOCK',source:'kind'} as any;
 assert.equal(homepageIdentityReviewRequired(base),true);
 for(const replacement of [{name:'코스맥스'},{source:'other'},{symbol:'044821'},{exchange:'KOSDAQ'},{id:'other'}]) assert.equal(homepageIdentityReviewRequired({...base,...replacement}),false);
 assert.equal(homepageIdentityReviewRequired({...base,id:'kind:KOSDAQ:0068Y0',name:'비엔케이제3호스팩',symbol:'0068Y0',exchange:'KOSDAQ'}),true);
});
test('runtime suppresses held cached icon with exact fingerprint', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'homepage-hold-'));
 try {
  const output=join(dir,'logos.json');
  const asset={id:'kind:KOSPI:044820',name:'코스맥스비티아이',symbol:'044820',exchange:'KOSPI',source:'kind'} as any;
  const fingerprint=JSON.stringify([asset.id,asset.name,asset.symbol,asset.exchange]);
  await writeFile(output,JSON.stringify({version:1,updatedAt:new Date().toISOString(),records:[{fingerprint,entity:'https://example.com/',sourcePage:'https://example.com/',imageUrl:'https://example.com/icon.png',source:'official-website-icon',authoritySource:'KIND',license:'공식 홈페이지 아이콘 · 권리 미확인'}],attempts:{[fingerprint]:'matched'},counts:{processed:1,matched:1,missing:0,failed:0,total:1,bounded:false}}));
  const catalog=await createHomepageLogoCatalog({snapshotPath:output}).load();
  assert.equal(catalog.status.status,'READY'); assert.equal(catalog.get(asset),null);
 } finally {await rm(dir,{recursive:true,force:true});}
});
import { reviewHomepageCache, rejectedHomepageIconHashes } from './homepage-logos.ts';
test('offline review prunes generic artwork and rebuilds diagnostic counts and preview',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'homepage-generic-'));
 try {
  const output=join(dir,'logos.json'),catalogPath=join(dir,'catalog.json'),preview=join(dir,'preview.json');
  const asset={id:'kind:KOSPI:005930',name:'삼성전자',symbol:'005930',exchange:'KOSPI',kind:'STOCK',isin:null,source:'kind',sourceUrl:'https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13&currentPageSize=3000&pageIndex=1',asOf:'2026-10-22',iconText:'삼성',iconUrl:null};
  const fingerprint=JSON.stringify([asset.id,asset.name,asset.symbol,asset.exchange]);
  await writeFile(catalogPath,JSON.stringify({version:1,providers:[{provider:'kind',updatedAt:new Date().toISOString(),assets:[asset]}]}));
  await writeFile(output,JSON.stringify({version:1,updatedAt:new Date().toISOString(),records:[{fingerprint,entity:'https://example.com/',sourcePage:'https://example.com/',imageUrl:'https://example.com/icon.png',normalizedPng:'7d57f608e02f45bf94e9e2f2165067491e39889c33aad78734bc21be89755223.png',source:'official-website-icon',authoritySource:'KIND',license:'공식 홈페이지 아이콘 · 권리 미확인'}],attempts:{[fingerprint]:'matched'},counts:{processed:1,matched:1,missing:0,failed:0,total:1,bounded:false}}));
  const catalog=await createHomepageLogoCatalog({snapshotPath:output}).load();
  assert.equal(catalog.status.status,'READY'); assert.equal(catalog.get(asset as any),null);
  const counts=await reviewHomepageCache({output,catalogPath,preview});
  assert.equal(counts.matched,0);assert.equal(counts.missing,1);assert.equal(counts.reasons?.['rejected-generic-icon'],1);
  const saved=JSON.parse(await readFile(output,'utf8'));assert.equal(saved.records.length,0);assert.equal(saved.attempts[fingerprint],'missing');
  assert.equal(JSON.parse(await readFile(preview,'utf8')).assets.length,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});

import { officialLogoCandidates } from './homepage-logos.ts';
test('issuer logo discovery excludes social cards, external hosts, footer badges and other organizations', () => {
 const html = `<meta property="og:image" content="/social.png"><header><h1><a href="/"><img class="logo" src="/brand.svg" alt="테스트회사"></a></h1><img src="https://cdn.other.com/logo.png" class="logo"></header><footer><div class="logo"><img src="/footer-logo.png"></div></footer><header><div class="partner"><img src="/partner-logo.png"></div><img src="/ad.png" alt="other"><img class="logo" src="/shop/ad/logo.png"><img class="logo" style="display:none" src="/blank.png"></header>
 <script type="application/ld+json">{"@graph":[{"@type":"Corporation","name":"테스트회사","logo":{"url":"/structured.png"}},{"@type":"Organization","name":"다른회사","logo":"/foreign.png"}]}</script>`;
 assert.deepEqual(officialLogoCandidates(html, 'https://example.com/', '테스트회사'), [
  {url:'https://example.com/structured.png',method:'organization-logo'},
  {url:'https://example.com/brand.svg',method:'header-logo'},
 ]);
});
test('issuer logo extraction stays bounded and ignores scripts, hidden elements and unrelated body logos', () => {
 const html = `<script>"<header><img class='logo' src='/script.png'></header>"</script><main><img class="logo" src="/body.png"></main><header style="display:none"><img class="logo" src="/hidden.png"></header><header>${Array.from({length:12},(_,i)=>`<img class="logo" src="/${i}.png">`).join('')}</header>`;
 const result = officialLogoCandidates(html,'https://example.com','테스트');
 assert.equal(result.length,8);
 assert.equal(result[0]?.url,'https://example.com/0.png');
});
test('header logo rejects conflicting labels, external anchors and group/product ancestry', () => {
 for (const html of [
  '<header><a href="https://advertiser.example/"><img class="logo" src="/logo.png" alt="다른회사"></a></header>',
  '<header><img class="logo" src="/logo.png" alt="다른회사"></header>',
  '<header><img class="logo" src="/logo.png" title="Other Brand"></header>',
  '<header><a href="//advertiser.example/"><img class="logo" src="/logo.png" alt="logo"></a></header>',
  '<header><div aria-label="Group companies"><img class="logo" src="/logo.png"></div></header>',
  '<header><div class="product"><img class="logo" src="/logo.png"></div></header>',
  '<header><a title="파트너"><img class="logo" src="/logo.png"></a></header>',
 ]) assert.deepEqual(officialLogoCandidates(html,'https://example.com/','테스트회사'),[],html);
 assert.deepEqual(officialLogoCandidates('<header><a href="/"><img class="logo" src="/logo.png" alt="테스트회사 로고" title="홈으로"></a></header>','https://example.com/','테스트회사'),[{url:'https://example.com/logo.png',method:'header-logo'}]);
});
test('issuer label does not accept subsidiary names sharing issuer prefix', () => {
 for (const alt of ['삼성전자서비스', '삼성전자서비스 로고', '삼성전자 자회사 로고']) assert.deepEqual(officialLogoCandidates(`<header><img class="logo" src="/logo.png" alt="${alt}"></header>`,'https://example.com/','삼성전자'),[]);
 assert.equal(officialLogoCandidates('<header><img class="logo" src="/logo.png" alt="삼성전자 로고"></header>','https://example.com/','삼성전자').length,1);
});

import { officialEntryPages, homepageExtractionRules } from './homepage-logos.ts';
test('published entry discovery is bounded, same-host HTTPS and ignores script/comment links', () => {
 const html = `<!-- <a href="/comment">한국어</a> --><script>"<a href='/script'>한국어</a>"</script><a href="https://other.example/">한국어</a><a href="http://example.com/insecure">한국어</a><a href="/ko">한국어</a><a href="/ko#x">한국어</a><a href="/a" hreflang="ko">국내</a><a href="/b">Home</a><a href="/c">Enter</a><a href="/sale">Shop</a>`;
 assert.deepEqual(officialEntryPages(html,'https://example.com/'),['https://example.com/ko','https://example.com/a','https://example.com/b']);
});
test('empty-cache refresh follows published Korean entry and exports reproducible full diagnostics', async () => {
 const dir=await mkdtemp(join(tmpdir(),'homepage-entry-'));
 try {
  const output=join(dir,'logos.json'),catalogPath=join(dir,'catalog.json'),input=join(dir,'kind.xls'),preview=join(dir,'preview.json');
  const asset={id:'kind:KOSPI:005930',name:'삼성전자',symbol:'005930',exchange:'KOSPI',kind:'STOCK',isin:null,source:'kind',sourceUrl:'https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13&currentPageSize=3000&pageIndex=1',asOf:'2026-10-22',iconText:'삼성',iconUrl:null};
  await writeFile(catalogPath,JSON.stringify({version:1,providers:[{provider:'kind',updatedAt:new Date().toISOString(),assets:[asset,{...asset,id:'kind:KOSPI:000001',symbol:'000001',name:'미제공'}]}]}));
  const entity=(value:string)=>[...value].map(c=>`&#${c.codePointAt(0)};`).join('');
  await writeFile(input,`<tr><th>${entity('회사명')}</th><th>${entity('시장구분')}</th><th>${entity('종목코드')}</th><th>${entity('홈페이지')}</th></tr><tr><td>${entity(asset.name)}</td><td>${entity('유가')}</td><td>005930</td><td>https://example.com/old</td></tr>`);
  const seen:string[]=[];
  await refreshHomepageLogos({catalogPath,output,inputFiles:[input],preview,transport:async(url)=>{
   seen.push(url);
   if(url.endsWith('.svg'))return {url,mime:'image/svg+xml',body:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>')};
   return {url,mime:'text/html',body:Buffer.from(url.endsWith('/ko')?'<title>삼성전자</title><link rel=icon href=/brand.svg>':'<title>Welcome</title><a href="/ko">한국어</a><a href="https://other.example/">Home</a>')};
  }});
  assert.deepEqual(seen,['https://example.com/old','https://example.com/ko','https://example.com/brand.svg']);
  const saved=JSON.parse(await readFile(output,'utf8')), view=JSON.parse(await readFile(preview,'utf8'));
  assert.equal(saved.records[0].sourcePage,'https://example.com/ko');
  assert.equal(saved.reproducibility.rulesVersion,homepageExtractionRules);
  assert.match(saved.reproducibility.sources[0].sha256,/^[a-f0-9]{64}$/);
  assert.equal(view.assets.length,1);assert.equal(view.allAssets.length,2);
  assert.equal(view.allAssets[1].iconUrl,null);assert.equal(view.allAssets[1].diagnostic.reason,'issuer-row-not-unique');
  assert.equal(view.allAssets[0].originalHomepage,'https://example.com/old');
  assert.equal(saved.allAssets[1].authorityUrl,asset.sourceUrl);
  await refreshHomepageLogos({catalogPath,output,inputFiles:[input],symbols:['999999'],transport:async()=>{throw new Error('unexpected fetch');}});
  const retained=JSON.parse(await readFile(output,'utf8'));
  assert.equal(retained.reproducibility.selectedCount,0);
  assert.equal(retained.reproducibility.retainedCount,2);
  assert.equal(retained.reproducibility.mixedCachedResults,true);
  assert.match(retained.reproducibility.previousSnapshotSha256,/^[a-f0-9]{64}$/);
  await refreshHomepageLogos({catalogPath,output,inputFiles:[input],audit:true,transport:async(url)=>{
   if(url.endsWith('/ko'))throw new Error('TLS certificate failure');
   return {url,mime:'text/html',body:Buffer.from('<title>Welcome</title><a href="/ko">한국어</a>')};
  }});
  const traced=JSON.parse(await readFile(output,'utf8'));
  assert.equal(traced.allAssets[0].diagnostic.attemptTrace[0].reason,'tls-error');
  assert.equal(traced.allAssets[0].diagnostic.attemptTrace[0].url,'https://example.com/ko');
  traced.records[0].homepageEvidenceUrls=['https://example.com/human-researched'];
  await writeFile(output,JSON.stringify(traced));
  await refreshHomepageLogos({catalogPath,output,inputFiles:[input],symbols:['999999'],transport:async()=>{throw new Error('unexpected fetch');}});
  const invalidated=JSON.parse(await readFile(output,'utf8'));
  assert.equal(invalidated.records.length,0);
  assert.equal(invalidated.allAssets[0].attempt,'unprocessed');
  assert.equal(invalidated.allAssets[0].diagnostic.reason,'not-processed');
  assert.equal(invalidated.counts.reasons.matched,undefined);

  seen.length=0;
  await refreshHomepageLogos({catalogPath,output,inputFiles:[input],audit:true,transport:async(url)=>{
   seen.push(url);
   if(url.endsWith('/old'))throw new Error('HTTP 404');
   return {url,mime:'text/html',body:Buffer.from('<title>Other issuer</title>')};
  }});
  assert.deepEqual(seen,['https://example.com/old','https://example.com/']);
  const failure=JSON.parse(await readFile(output,'utf8'));
  assert.equal(failure.allAssets[0].diagnostic.stage,'official-root');
  assert.equal(failure.allAssets[0].diagnostic.url,'https://example.com/');
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('TLS authority recovery is opt-in, retains original failure and only uses exact official evidence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'homepage-authority-'));
 try {
  const output=join(dir,'logos.json'),catalogPath=join(dir,'catalog.json'),input=join(dir,'kind.xls');
  const asset={id:'kind:KOSPI:005930',name:'삼성전자',symbol:'005930',exchange:'KOSPI',kind:'STOCK',isin:null,source:'kind',sourceUrl:'https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13&currentPageSize=3000&pageIndex=1',asOf:'2026-10-22',iconText:'삼성',iconUrl:null};
  await writeFile(catalogPath,JSON.stringify({version:1,providers:[{provider:'kind',updatedAt:new Date().toISOString(),assets:[asset]}]}));
  const entity=(value:string)=>[...value].map(c=>`&#${c.codePointAt(0)};`).join('');
  await writeFile(input,`<tr><th>${entity('회사명')}</th><th>${entity('시장구분')}</th><th>${entity('종목코드')}</th><th>${entity('홈페이지')}</th></tr><tr><td>${entity(asset.name)}</td><td>${entity('유가')}</td><td>005930</td><td>https://old.example.com/</td></tr>`);
  const calls:string[]=[];
  let homepage='http://new.example.com/';
  const transport=async(url:string,origin:string)=>{
   calls.push(url);
   if(url==='https://old.example.com/')throw new Error('TLS certificate expired');
   if(url.includes('method=searchCorpList'))return {url,mime:'text/html',body:Buffer.from(`<tr><a onclick="companysummary_open('00593')">삼성전자</a></tr>`)};
   if(url.includes('method=searchCompanySummaryOvrvwDetail'))return {url,mime:'text/html',body:Buffer.from(`<th>한글명</th><td>삼성전자</td><th>종목코드</th><td>005930</td><th>시장구분</th><td>유가증권 상장</td><th>홈페이지</th><td><a href="${homepage}">홈페이지</a></td>`)};
   assert.equal(origin,'https://new.example.com/');
   if(url.endsWith('.svg'))return {url,mime:'image/svg+xml',body:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>')};
   return {url,mime:'text/html',body:Buffer.from('<title>삼성전자</title><link rel=icon href=/brand.svg>')};
  };
  await refreshHomepageLogos({catalogPath,output,inputFiles:[input],transport});
  assert.deepEqual(calls,['https://old.example.com/']);
  calls.length=0;
  await refreshHomepageLogos({catalogPath,output,inputFiles:[input],retry:true,resolveOfficialHomepages:true,transport});
  const saved=JSON.parse(await readFile(output,'utf8'));
  assert.equal(saved.records[0].sourcePage,'https://new.example.com/');
  assert.equal(saved.records[0].originalHomepage,'https://old.example.com/');
  assert.equal(saved.records[0].automaticAuthority.homepage,'http://new.example.com/');
  assert.equal(saved.records[0].homepageEvidenceUrls,undefined);
  const diag=Object.values(saved.diagnostics)[0] as any;
  assert.equal(diag.attemptTrace[0].reason,'tls-error');
  assert.equal(diag.attemptTrace.filter((a:any)=>a.reason==='official-authority-document').length,2);
  assert.match(diag.automaticAuthority.inputHash,/^[a-f0-9]{64}$/);
  homepage='https://127.0.0.1/';calls.length=0;
  await refreshHomepageLogos({catalogPath,output,inputFiles:[input],audit:true,resolveOfficialHomepages:true,transport});
  const rejected=JSON.parse(await readFile(output,'utf8'));
  assert.equal(rejected.records.length,1,'previous success survives failed authority recovery');
  assert.equal(calls.length,3,'unsafe official declaration is never fetched');
  assert.equal((Object.values(rejected.diagnostics)[0] as any).stage,'official-homepage-resolution');
  assert.equal((Object.values(rejected.diagnostics)[0] as any).reason,'official-homepage-not-changed');
  const legacyDiagnostic=Object.values(rejected.diagnostics)[0] as any;
  legacyDiagnostic.reason='request-failed';
  rejected.reproducibility.rulesVersion='official-published-links-v2';
  await writeFile(output,JSON.stringify(rejected));
  await reviewHomepageCache({catalogPath,output});
  const migrated=JSON.parse(await readFile(output,'utf8'));
  assert.equal((Object.values(migrated.diagnostics)[0] as any).reason,'official-homepage-not-changed');
  assert.equal(migrated.reproducibility.rulesVersion,'official-published-links-v2','offline review preserves original extraction provenance');
  assert.equal(migrated.reproducibility.reviewRulesVersion,'official-published-links-v3');
  assert.equal(migrated.reproducibility.observedAuthorityAttempts,true);
  assert.equal(migrated.counts.reasons['official-homepage-not-changed'],1);

  homepage='https://old.example.com/';
  let postSeen=false;
  await refreshHomepageLogos({catalogPath,output,inputFiles:[input],audit:true,resolveOfficialHomepages:true,transport:async(url,origin,signal,options)=>{
   if(options){
    postSeen=true;assert.equal(options.method,'POST');validateOfficialRequest(url,origin,options);
    throw new Error('HTTP 503');
   }
   return transport(url,origin);
  }});
  assert.equal(postSeen,true,'authority wrapper forwards the restricted disclosure POST');
  const postFailure=JSON.parse(await readFile(output,'utf8'));
  assert.equal(postFailure.records.length,1);
  assert.ok((Object.values(postFailure.diagnostics)[0] as any).attemptTrace.some((entry:any)=>entry.reason==='http-503' && entry.url==='https://kind.krx.co.kr/disclosure/searchdisclosurebycorp.do'));

 }finally{await rm(dir,{recursive:true,force:true});}
});

import { validateOfficialRequest, officialRedirect } from './homepage-logos.ts';
test('official POST permits only bounded fixed KIND disclosure fields and never redirects a body',()=>{
 const endpoint='https://kind.krx.co.kr/disclosure/searchdisclosurebycorp.do';
 const params=new URLSearchParams({method:'searchDisclosureByCorpSub',forward:'searchdisclosurebycorp_sub',repIsuSrtCd:'A005930',searchCodeType:'number',fromDate:'2024-10-22',toDate:'2026-10-22',currentPageSize:'100',pageIndex:'1',orderMode:'1',orderStat:'D',reportNm:'보고서'});
 const options={method:'POST' as const,body:params.toString()};
 assert.doesNotThrow(()=>validateOfficialRequest(endpoint,'https://kind.krx.co.kr',options));
 for(const url of ['https://evil.example/disclosure/searchdisclosurebycorp.do','https://kind.krx.co.kr/other','http://kind.krx.co.kr/disclosure/searchdisclosurebycorp.do',endpoint+'?extra=1']) assert.throws(()=>validateOfficialRequest(url,'https://kind.krx.co.kr',options),/Unsafe/);
 for(const [key,value] of [['method','delete'],['currentPageSize','9999'],['repIsuSrtCd','arbitrary'],['unexpected','value'],['fromDate','20241022']]){
  const invalid=new URLSearchParams(params);invalid.set(key,value);assert.throws(()=>validateOfficialRequest(endpoint,'https://kind.krx.co.kr',{...options,body:invalid.toString()}),/Unsafe/);
 }
 assert.throws(()=>validateOfficialRequest(endpoint,'https://kind.krx.co.kr',{...options,body:options.body+'&method=searchDisclosureByCorpSub'}),/Unsafe/);
 assert.throws(()=>officialRedirect(endpoint,'https://kind.krx.co.kr','https://evil.example/',options),/POST redirect/);
 assert.throws(()=>officialRedirect(endpoint,'https://kind.krx.co.kr','/same-host',options),/POST redirect/);
 assert.throws(()=>officialRedirect('https://example.com/','https://example.com/','https://evil.example/'),/cross-host/);
 assert.equal(officialRedirect('https://example.com/','https://example.com/','/allowed'),'https://example.com/allowed');
});
