import { isPngDataUrl } from '../../domain/src/icon-url';
import { useEffect, useState, type CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { tokens } from '../../design-tokens/src';
import { AssetIcon, type CatalogAsset } from './AssetIdentity';

type Counts = { processed: number; matched: number; missing: number; failed: number; total: number; bounded: boolean; reasons?: Record<string, number> };
type AutomaticAuthority = { reportDate?: string; reportTitle?: string; authorityChain?: { url: string; inputHash: string }[]; homepage: string; evidenceUrl: string; inputHash: string; name: string; symbol: string; exchange: string; searchEvidenceUrl?: string; searchInputHash?: string };
type Credit = { automaticAuthority?: AutomaticAuthority; fingerprint: string; entity: string; imageUrl: string; sourcePage: string; license: string; source: 'official-website-icon'; authoritySource: 'KIND'; normalizedFormat?: string; originalImageUrl?: string; discoveryMethod?: string; originalHomepage?: string; homepageEvidenceUrls?: string[] };
type Diagnostic = { automaticAuthority?: AutomaticAuthority; inputHash?: string; reason: string; stage?: string; url?: string; error?: string; status?: number | string; format?: string; identity?: { status: string; title?: string }; attemptTrace?: Diagnostic[] };
const reasonLabels: Record<string, string> = { 'official-homepage-not-changed': '공식 자료에서 다른 안전한 주소를 찾지 못함', matched: '이번 점검 성공', 'tls-error': '인증서 오류', timeout: '시간 초과', 'dns-error': 'DNS 오류', 'no-supported-icon': '사용 가능한 아이콘 선언 없음', 'unsupported-or-invalid-icon': '지원하지 않거나 잘못된 이미지', 'homepage-not-provided': '홈페이지 정보 없음', 'unsafe-or-cross-host-url': '외부 호스트 이동·주소 제한', 'identity-review-required': '기업 식별 검토 보류', 'rejected-generic-icon': '일반 플랫폼·빈 아이콘 차단', 'rejected-homepage': '기본·접근 제한 페이지', 'request-failed': '기타 요청 오류' };
const reasonLabel = (reason?: string) => {
  if (!reason) return '아직 점검하지 않음';
  const status = reason.match(/^http-(\d{3})$/)?.[1];
  if (status) return `HTTP ${status} · ${{ '404': '주소 없음', '403': '접근 거부', '406': '서버 요청 거부' }[status] ?? (status.startsWith('5') ? '서버 오류' : '요청 오류')}`;
  return reasonLabels[reason] ?? ({ 'official-authority-document': '공식 근거 자료 확인', 'not-processed': '아직 점검하지 않음' } as Record<string, string>)[reason] ?? `기타 사유 (${reason})`;
};
const stageLabels: Record<string, string> = { 'kind-authority': 'KIND 공식 자료 조회', 'official-homepage': '공식 자료의 홈페이지 요청', 'official-homepage-resolution': '공식 홈페이지 주소 확인', 'identity-review': '기업 식별 검토', 'icon-review': '아이콘 검토', pending: '점검 대기', homepage: '홈페이지 요청', identity: '기업 식별', discovery: '아이콘 탐색', download: '이미지 다운로드', normalize: 'PNG 변환', authority: '공식 주소 확인', complete: '완료', 'homepage-fetch': '홈페이지 요청', 'icon-fetch': '아이콘 요청', 'icon-normalization': '이미지 변환' };
type Preview = { version: 1; updatedAt: string; counts: Counts; records: Credit[]; assets: CatalogAsset[]; allAssets?: (CatalogAsset & { diagnostic?: Diagnostic; originalHomepage?: string; authorityUrl?: string })[]; extraction?: unknown; reproducibility?: { rulesVersion?: string; method?: string; catalogSha256?: string; reviewMode?: string; mixedCachedResults?: boolean; provenanceScope?: string; offlineReviewedAt?: string; previousSnapshotSha256?: string; selectedCount?: number; retainedCount?: number; sources?: { source: string; sha256: string }[] }; rules?: unknown; diagnostics?: Record<string, Diagnostic> };
type State = { status: 'loading' } | { status: 'missing' | 'unavailable'; message: string } | { status: 'ready'; preview: Preview };
const fingerprint = (asset: CatalogAsset) => JSON.stringify([asset.id, asset.name, asset.symbol, asset.exchange]);
const control: CSSProperties = { minHeight: 44, padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: 10, font: 'inherit', fontSize: 16, background: '#fff', color: '#172b43' };
const muted: CSSProperties = { color: '#65758b', lineHeight: 1.6 };
// Remote images are browser-only: reject private destinations before displaying links or images.
const safeUrl = (value: unknown) => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !host.includes('.') || host.endsWith('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host) || host.includes(':') || host.startsWith('[')) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b] = host.split('.').map(Number);
      if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19))) return false;
    }
    return true;
  } catch { return false; }
};
function readPreview(value: unknown): Preview {
  const data = value as Preview;
  if (data?.version !== 1 || !Number.isFinite(Date.parse(data.updatedAt)) || !data.counts ||
    !['processed', 'matched', 'missing', 'failed', 'total'].every(key => Number.isSafeInteger(data.counts[key as keyof Counts]) && Number(data.counts[key as keyof Counts]) >= 0) ||
    typeof data.counts.bounded !== 'boolean' || !Array.isArray(data.assets) || !Array.isArray(data.records)) throw new Error('미리보기 파일 형식이 올바르지 않습니다.');
  for (const record of data.records) {
    if (typeof record.fingerprint !== 'string' || !(safeUrl(record.imageUrl) || isPngDataUrl(record.imageUrl)) || !safeUrl(record.sourcePage) || !safeUrl(record.entity) || typeof record.license !== 'string' || record.source !== 'official-website-icon' || record.authoritySource !== 'KIND') throw new Error('홈페이지 아이콘 출처 정보를 확인하지 못했습니다.');
  }
  const credits = new Map(data.records.map(record => [record.fingerprint, record]));
  if (data.assets.length !== data.counts.matched || data.assets.some(asset => !asset || typeof asset.id !== 'string' || typeof asset.name !== 'string' || typeof asset.symbol !== 'string' || asset.kind !== 'STOCK' || (asset.exchange != null && typeof asset.exchange !== 'string') || (asset.iconText != null && typeof asset.iconText !== 'string') || !credits.has(fingerprint(asset)))) throw new Error('아이콘과 기업 목록이 일치하지 않습니다.');
  if (new Set(data.assets.map(fingerprint)).size !== data.assets.length || data.counts.matched !== data.records.length || new Set(data.records.map(record => record.fingerprint)).size !== data.records.length || data.counts.processed !== data.counts.matched + data.counts.missing + data.counts.failed || data.counts.processed > data.counts.total) throw new Error('아이콘 집계가 결과와 일치하지 않습니다.');
  if (data.allAssets && (!Array.isArray(data.allAssets) || data.allAssets.some(asset => !asset || typeof asset.id !== 'string' || typeof asset.name !== 'string' || typeof asset.symbol !== 'string' || asset.kind !== 'STOCK') || new Set(data.allAssets.map(fingerprint)).size !== data.allAssets.length || data.assets.some(asset => !data.allAssets!.some(candidate => fingerprint(candidate) === fingerprint(asset))))) throw new Error('전체 기업 목록 형식이 올바르지 않습니다.');
  return data;
}
function CompanyCard({ asset, credit, commodity, diagnostic }: { asset: CatalogAsset; credit?: Credit; commodity: string; diagnostic?: Diagnostic }) {
  const [imageState, setImageState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  // This is an explicit display binding. A custom commodity never identifies a company by itself.
  const automaticAuthority = diagnostic?.automaticAuthority ?? credit?.automaticAuthority;
  const originalHomepage = (asset as CatalogAsset & { originalHomepage?: string }).originalHomepage ?? credit?.originalHomepage;
  const boundAsset = { ...asset, iconUrl: credit?.imageUrl ?? null };
  return <article style={{ border: '1px solid #e3e7ed', borderRadius: 16, overflow: 'hidden', minWidth: 0, background: '#fff' }}>
    <div style={{ height: 130, padding: 28, boxSizing: 'border-box', display: 'grid', placeItems: 'center', background: '#f7f9fc', overflow: 'hidden' }}>
      {!credit || imageState === 'failed' ? <span style={{ fontSize: 28, color: '#65758b' }}>{asset.iconText || asset.symbol.slice(0, 2)}</span> : <img src={credit.imageUrl} alt={`${asset.name} 홈페이지 아이콘`} loading="lazy" referrerPolicy="no-referrer" onLoad={() => setImageState('loaded')} onError={() => setImageState('failed')} style={{ width: '100%', maxWidth: '100%', height: 74, minHeight: 0, objectFit: 'contain' }} />}
    </div>
    <div style={{ padding: 20, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><AssetIcon commodity={commodity || asset.symbol} asset={boundAsset} /><strong style={{ overflowWrap: 'anywhere' }}>{asset.name}</strong></div>
      <small style={muted}>{asset.exchange} · {asset.symbol}</small>
      <small style={{ ...muted, color: credit ? '#276346' : '#8a4b32' }}>{credit ? '연결된 아이콘 있음' : '연결된 아이콘 없음'} · {reasonLabel(diagnostic?.reason)}</small>
      {credit && diagnostic && diagnostic.reason !== 'matched' && <p style={{ ...muted, margin: 0 }}>이전 성공 아이콘을 유지했습니다. 아래 진단은 최근 시도의 결과입니다.</p>}
      {diagnostic && <details><summary>최근 점검 진단·원문 주소</summary><dl style={{ fontSize: 13, overflowWrap: 'anywhere' }}><dt>사유</dt><dd>{reasonLabel(diagnostic.reason)}</dd><dt>실패·처리 단계</dt><dd>{diagnostic.stage ? stageLabels[diagnostic.stage] ?? diagnostic.stage : '기록 없음'}</dd>{diagnostic.status != null && <><dt>응답 상태</dt><dd>{diagnostic.status}</dd></>}{diagnostic.error && <><dt>오류 원문</dt><dd>{diagnostic.error}</dd></>}{diagnostic.identity && <><dt>기업 식별</dt><dd>{diagnostic.identity.status}{diagnostic.identity.title ? ` · ${diagnostic.identity.title}` : ''}</dd></>}{diagnostic.url && <><dt>점검한 원문 주소</dt><dd>{safeUrl(diagnostic.url) ? <a href={diagnostic.url} target="_blank" rel="noreferrer">{diagnostic.url} ↗</a> : <span>{diagnostic.url} (안전한 외부 링크로 열 수 없음)</span>}</dd></>}</dl></details>}
      {diagnostic?.attemptTrace?.length ? <details><summary>홈페이지 시도 이력 ({diagnostic.attemptTrace.length}건)</summary><ol style={{ paddingLeft: 22, ...muted, fontSize: 13 }}>{diagnostic.attemptTrace.map((attempt, index) => <li key={index} style={{ marginTop: 8, overflowWrap: 'anywhere' }}>{attempt.stage ? stageLabels[attempt.stage] ?? attempt.stage : '단계 기록 없음'} · {reasonLabel(attempt.reason)}{attempt.status != null ? ` · 상태 ${attempt.status}` : ''}{attempt.url && <div>{safeUrl(attempt.url) ? <a href={attempt.url} target="_blank" rel="noreferrer">{attempt.url} ↗</a> : <span>{attempt.url} (외부 링크 제한)</span>}</div>}{attempt.error && <div>{attempt.error}</div>}{attempt.inputHash && <details><summary>입력 자료 SHA-256</summary><span>{attempt.inputHash}</span></details>}</li>)}</ol></details> : null}
      {automaticAuthority && <details open><summary>공식 자료에서 자동 확인한 주소</summary><p style={{ ...muted, fontSize: 13, overflowWrap: 'anywhere' }}>{safeUrl(automaticAuthority.homepage) ? <a href={automaticAuthority.homepage} target="_blank" rel="noreferrer">{automaticAuthority.homepage} ↗</a> : automaticAuthority.homepage}<br />확인한 기업: {automaticAuthority.name} · {automaticAuthority.symbol} · {automaticAuthority.exchange}</p><p style={{ ...muted, fontSize: 13 }}>조회한 공식 자료에서 기업명·종목 코드·거래소를 대조한 주소입니다. 자료의 작성일이나 최신성을 보증하는 표시는 아닙니다.</p>{safeUrl(automaticAuthority.evidenceUrl) && <a href={automaticAuthority.evidenceUrl} target="_blank" rel="noreferrer">주소 확인 근거 자료 ↗</a>}{(automaticAuthority.reportTitle || automaticAuthority.reportDate) && <p style={{ ...muted, fontSize: 13 }}>선택한 보고서: {automaticAuthority.reportTitle ?? '제목 기록 없음'}{automaticAuthority.reportDate ? ` · 자료에 기록된 날짜 ${automaticAuthority.reportDate.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')}` : ''}</p>}<details><summary>입력 자료 지문·검색 근거</summary>{automaticAuthority.authorityChain?.map((source, index) => <div key={index} style={{ fontSize: 12, overflowWrap: 'anywhere', marginTop: 10 }}>{safeUrl(source.url) ? <a href={source.url} target="_blank" rel="noreferrer">공식 자료 확인 경로 {index + 1} ↗</a> : <span>{source.url} (외부 링크 제한)</span>}<p style={muted}>SHA-256: {source.inputHash}</p></div>)}<p style={{ ...muted, fontSize: 12, overflowWrap: 'anywhere' }}>근거 자료 SHA-256: {automaticAuthority.inputHash}</p>{automaticAuthority.searchEvidenceUrl && safeUrl(automaticAuthority.searchEvidenceUrl) && <a href={automaticAuthority.searchEvidenceUrl} target="_blank" rel="noreferrer">공식 검색 근거 ↗</a>}{automaticAuthority.searchInputHash && <p style={{ ...muted, fontSize: 12, overflowWrap: 'anywhere' }}>검색 자료 SHA-256: {automaticAuthority.searchInputHash}</p>}</details></details>}
      {originalHomepage && <small style={{ ...muted, overflowWrap: 'anywhere' }}>KIND에 기록된 원본 홈페이지: {safeUrl(originalHomepage) ? <a href={originalHomepage} target="_blank" rel="noreferrer">{originalHomepage} ↗</a> : <span>{originalHomepage} (외부 링크 제한)</span>}</small>}
      {!credit && <small style={muted}>홈페이지 정보 기준: <a href="https://kind.krx.co.kr/corpgeneral/corpList.do?method=loadInitPage" target="_blank" rel="noreferrer">KIND 상장법인 목록 ↗</a></small>}
      {credit && <>
      <small style={muted}>{credit.normalizedFormat ? `${credit.normalizedFormat.toUpperCase()} → PNG` : '기존 이미지'} · {diagnostic?.identity?.status === 'verified' ? '홈페이지에서 기업명 확인' : '기업명 추가 확인 필요'}</small>
      {credit.discoveryMethod && <small style={muted}>추출 위치: {({'declared-icon':'페이지 아이콘 선언','manifest-icon':'웹 앱 manifest','favicon-fallback':'기업명 확인 후 표준 favicon 경로','organization-logo':'기업 구조화 데이터의 로고','header-logo':'기업명과 문맥을 확인한 머리글 로고'} as Record<string,string>)[credit.discoveryMethod] ?? credit.discoveryMethod}</small>}
      {credit.homepageEvidenceUrls?.length ? <details><summary>공식 주소 확인 근거</summary>{credit.homepageEvidenceUrls.filter(safeUrl).map((url,index) => <a key={url + index} href={url} target="_blank" rel="noreferrer" style={{display:'block',overflowWrap:'anywhere',fontSize:12}}>{url}</a>)}</details> : null}
      {credit.originalImageUrl && safeUrl(credit.originalImageUrl) && <a href={credit.originalImageUrl} target="_blank" rel="noreferrer" style={{fontSize:13}}>원본 아이콘 ↗</a>}
      {commodity && <small style={{ ...muted, overflowWrap: 'anywhere' }}>{commodity} → {asset.name} · 명시적 연결 예시</small>}
      <small style={{ color: imageState === 'failed' ? '#a34532' : '#476577', minHeight: 18 }}>{imageState === 'loading' ? '이미지 불러오는 중' : imageState === 'loaded' ? '✓ 이미지 로드 완료' : '이미지 로드 실패 · 문자 표시'}</small>
      <a href={credit.sourcePage} target="_blank" rel="noreferrer" style={{ minHeight: 44, display: 'flex', alignItems: 'center', fontSize: 13 }}>공식 홈페이지 ↗</a>
      <small style={{ ...muted, overflowWrap: 'anywhere' }}>{credit.license}<br />홈페이지 정보 출처: <a href="https://kind.krx.co.kr/corpgeneral/corpList.do?method=loadInitPage" target="_blank" rel="noreferrer">{credit.authoritySource}</a></small>
      </>}
    </div>
  </article>;
}
function HomepageGallery() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [exchange, setExchange] = useState('');
  const [commodity, setCommodity] = useState('');
  const [connection, setConnection] = useState('all');
  const [reason, setReason] = useState('');
  const [limit, setLimit] = useState(48);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    void fetch('/homepage-logos.json', { signal: controller.signal, credentials: 'omit', cache: 'no-store' }).then(async response => {
      if (response.status === 404) { setState({ status: 'missing', message: '아직 홈페이지 아이콘 미리보기가 없습니다.' }); return; }
      if (!response.ok) throw new Error(`미리보기를 불러오지 못했습니다 (HTTP ${response.status}).`);
      const preview = readPreview(await response.json());
      if (!controller.signal.aborted) setState({ status: 'ready', preview });
    }).catch((error: unknown) => { if (!controller.signal.aborted) setState({ status: 'unavailable', message: error instanceof Error ? error.message : '미리보기를 읽지 못했습니다.' }); });
    return () => controller.abort();
  }, [revision]);
  const preview = state.status === 'ready' ? state.preview : null;
  const credits = new Map(preview?.records.map(record => [record.fingerprint, record]));
  const allAssets = preview?.allAssets ?? preview?.assets ?? [];
  const diagnosticFor = (asset: CatalogAsset) => ('diagnostic' in asset ? (asset as { diagnostic?: Diagnostic }).diagnostic : undefined) ?? preview?.diagnostics?.[fingerprint(asset)];
  const filtered = allAssets.filter(asset => (!connection || connection === 'all' || (connection === 'connected') === credits.has(fingerprint(asset))) && (!reason || (diagnosticFor(asset)?.reason ?? 'unprocessed') === reason) && (!exchange || asset.exchange === exchange) && `${asset.name} ${asset.symbol} ${asset.exchange}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px', color: '#172b43' }}>
    <span style={{ color: '#506c89', fontSize: 12, letterSpacing: '0.12em', fontWeight: 700 }}>OFFICIAL HOMEPAGE ICONS</span>
    <h1 style={{ margin: '12px 0', fontSize: 32, letterSpacing: '-0.04em' }}>공식 홈페이지에서 찾은 아이콘</h1>
    <p style={muted}>한국 종목의 공식 홈페이지 정보로 찾은 웹사이트 아이콘입니다. 기업 로고의 정확성을 검증한 결과가 아니며 Wikimedia Commons 로고와 별도로 표시합니다.</p>
    <button type="button" style={control} onClick={() => setRevision(value => value + 1)} disabled={state.status === 'loading'}>미리보기 다시 읽기</button>
    {state.status === 'loading' && <p role="status">저장된 미리보기를 불러오는 중…</p>}
    {(state.status === 'missing' || state.status === 'unavailable') && <section role="status" style={{ padding: 24, marginTop: 24, background: '#f7f9fc', borderRadius: 16 }}>
      <h2 style={{ fontSize: 20 }}>{state.status === 'missing' ? '미리보기 생성 필요' : '미리보기 사용 불가'}</h2><p>{state.message}</p>
      <p style={muted}>종목 목록 동기화 후 아래 명령으로 홈페이지 아이콘을 갱신하고 이 페이지를 다시 읽어 주세요. API 키는 필요하지 않습니다. 배포된 Storybook에서는 로컬 수집 결과를 의도적으로 제외하므로 이 안내가 표시될 수 있습니다.</p>
      <code style={{ display: 'block', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>corepack yarn logos:homepages --input /path/to/kind.xls --preview apps/web/.storybook/public/homepage-logos.json</code>
    </section>}
    {preview && <>
      <p style={{ ...muted, fontSize: 13 }}>마지막 갱신: <time dateTime={preview.updatedAt}>{new Date(preview.updatedAt).toLocaleString('ko-KR')}</time> · {preview.counts.bounded ? '일부 종목만 처리한 결과' : '전체 종목 처리 결과'}</p>
      <dl style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '24px 0' }}>{([['전체', preview.counts.total], ['처리', preview.counts.processed], ['일치', preview.counts.matched], ['없음', preview.counts.missing], ['실패', preview.counts.failed]] as const).map(([label, count]) => <div key={label} style={{ padding: '12px 20px', background: '#f7f9fc', borderRadius: 12 }}><dt style={{ ...muted, fontSize: 12 }}>{label}</dt><dd style={{ margin: '6px 0 0', fontSize: 24, fontVariantNumeric: 'tabular-nums' }}>{count.toLocaleString('ko-KR')}</dd></div>)}</dl>
      {preview.counts.reasons && <details style={{ marginBottom: 24 }}><summary>재점검 상세 원인</summary><p style={muted}>기존 성공 아이콘을 유지한 항목은 현재 진단 결과와 표시 여부가 다를 수 있습니다.</p><dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>{Object.entries(preview.counts.reasons).map(([reason,count]) => <div key={reason}><dt>{({matched:'이번 점검 성공','tls-error':'인증서 오류',timeout:'시간 초과','dns-error':'DNS 오류','no-supported-icon':'사용 가능한 선언 없음','unsupported-or-invalid-icon':'지원하지 않거나 잘못된 이미지','homepage-not-provided':'홈페이지 정보 없음','unsafe-or-cross-host-url':'외부 호스트 이동·주소 제한','identity-review-required':'기업 식별 검토 보류','rejected-generic-icon':'일반 플랫폼·빈 아이콘 차단','rejected-homepage':'기본·접근 제한 페이지','request-failed':'기타 요청 오류'} as Record<string,string>)[reason] ?? reason}</dt><dd>{count}</dd></div>)}</dl></details>}
      {!preview.allAssets && <p style={muted}>이전 형식의 미리보기입니다. 연결된 기업만 포함되어 있으며 미연결 기업의 상세 목록은 다시 생성하면 표시됩니다.</p>}
      {Boolean(preview.extraction || preview.reproducibility || preview.rules) && <details><summary>추출 규칙·재현 정보</summary><p style={muted}>이번 실행의 설정·입력 지문입니다. 이전 캐시에서 유지한 결과가 함께 포함될 수 있어 모든 아이콘을 같은 규칙으로 추출했다는 증거는 아닙니다. 사이트 변경과 네트워크 상태에 따라 다음 실행 결과는 달라질 수 있습니다.</p>{preview.reproducibility?.reviewMode && <p style={muted}>오프라인 검토 결과입니다. 추출 출처 정보는 이전 결과에서 이어받았으며, 이전 규칙으로 생성한 캐시가 포함될 수 있습니다.</p>}{preview.reproducibility?.mixedCachedResults && <p style={muted}>서로 다른 실행에서 유지한 캐시 결과가 섞여 있습니다.</p>}{preview.reproducibility?.provenanceScope && <p style={{ ...muted, overflowWrap: 'anywhere' }}>출처 정보 범위: {preview.reproducibility.provenanceScope}</p>}{preview.reproducibility && <dl style={{ ...muted, overflowWrap: 'anywhere' }}><dt>규칙 버전</dt><dd>{preview.reproducibility.rulesVersion ?? '기록 없음'}</dd><dt>추출 방법</dt><dd>{preview.reproducibility.method ?? '기록 없음'}</dd><dt>종목 목록 SHA-256</dt><dd>{preview.reproducibility.catalogSha256 ?? '기록 없음'}</dd>{preview.reproducibility.previousSnapshotSha256 && <><dt>이전 스냅샷 SHA-256</dt><dd>{preview.reproducibility.previousSnapshotSha256}</dd></>}{preview.reproducibility.selectedCount != null && <><dt>이번 실행 대상 수</dt><dd>{preview.reproducibility.selectedCount}</dd></>}{preview.reproducibility.retainedCount != null && <><dt>이전 결과 유지 수</dt><dd>{preview.reproducibility.retainedCount}</dd></>}{preview.reproducibility.sources?.map((source, index) => <div key={index}><dt>입력 출처: {source.source}</dt><dd>SHA-256: {source.sha256}</dd></div>)}</dl>}{Boolean(preview.extraction || preview.rules) && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', ...muted }}>{JSON.stringify({ extraction: preview.extraction, rules: preview.rules }, null, 2)}</pre>}</details>}
      <p style={{ ...muted, fontSize: 13 }}>아래 작은 아이콘은 앱의 AssetIcon입니다. 공식 홈페이지의 웹사이트 아이콘도 기업 로고와 다를 수 있습니다. 사용자 단위는 기업에 명시적으로 연결한 경우에만 아이콘을 표시합니다.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '24px 0' }}>
        <label style={{ flex: '1 1 240px' }}><span style={{ display: 'block', marginBottom: 8 }}>회사명·종목 코드 검색</span><input type="search" value={query} onChange={event => { setQuery(event.target.value); setLimit(48); }} style={{ ...control, width: '100%', boxSizing: 'border-box' }} /></label>
        <label><span style={{ display: 'block', marginBottom: 8 }}>아이콘 연결</span><select value={connection} onChange={event => { setConnection(event.target.value); setLimit(48); }} style={control}><option value="all">전체 기업</option><option value="connected">연결됨</option><option value="unconnected">미연결</option></select></label>
        <label><span style={{ display: 'block', marginBottom: 8 }}>최근 점검 사유</span><select value={reason} onChange={event => { setReason(event.target.value); setLimit(48); }} style={control}><option value="">전체 사유</option>{[...new Set(allAssets.map(asset => diagnosticFor(asset)?.reason ?? 'unprocessed'))].sort().map(value => <option key={value} value={value}>{value === 'unprocessed' ? '아직 점검하지 않음' : reasonLabel(value)}</option>)}</select></label>
        <label><span style={{ display: 'block', marginBottom: 8 }}>거래소</span><select value={exchange} onChange={event => { setExchange(event.target.value); setLimit(48); }} style={control}><option value="">전체</option>{[...new Set(allAssets.map(asset => asset.exchange).filter((value): value is string => Boolean(value)))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
        <label><span style={{ display: 'block', marginBottom: 8 }}>사용자 단위 연결 예시</span><input value={commodity} maxLength={32} placeholder="MY-SHARES" onChange={event => setCommodity(event.target.value)} style={control} /></label>
      </div>
      {commodity && <p style={{ display: 'flex', gap: 10, alignItems: 'center', ...muted }}><AssetIcon commodity={commodity} />연결 전 사용자 단위: {commodity}</p>}
      <p aria-live="polite" style={{ ...muted, fontSize: 13 }}>전체 목록 {allAssets.length.toLocaleString('ko-KR')}개 중 검색 결과 {filtered.length.toLocaleString('ko-KR')}개 · 현재 {Math.min(limit, filtered.length)}개 표시</p>
      {allAssets.length === 0 ? <p>표시할 기업이 없습니다. 위 집계에서 누락·실패를 확인해 주세요.</p> : filtered.length === 0 ? <p>검색 결과가 없습니다.</p> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))', gap: 16 }}>{filtered.slice(0, limit).map(asset => <CompanyCard key={`${preview.updatedAt}:${fingerprint(asset)}`} asset={asset} credit={credits.get(fingerprint(asset))} commodity={commodity} diagnostic={diagnosticFor(asset)} />)}</div>}
      {filtered.length > limit && <button type="button" style={{ ...control, marginTop: 24 }} onClick={() => setLimit(value => value + 48)}>48개 더 보기 ({filtered.length - limit}개 남음)</button>}
    </>}
  </main>;
}
const meta = { title: 'Design System/Homepage Icons', parameters: { layout: 'fullscreen' }, decorators: [(Story) => <div className="ledger-app" style={{ fontFamily: tokens.fontFamily.web }}><Story /></div>] } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const SavedHomepageResults: Story = { render: () => <HomepageGallery /> };
