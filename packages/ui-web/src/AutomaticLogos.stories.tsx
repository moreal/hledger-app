import { useEffect, useState, type CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { tokens } from '../../design-tokens/src';
import { AssetIcon, type CatalogAsset } from './AssetIdentity';

type Counts = { processed: number; matched: number; ambiguous: number; missing: number; failed: number; total: number; bounded: boolean };
type Credit = { fingerprint: string; entity: string; imageUrl: string; sourcePage: string; license: string; artist: string };
type Preview = { version: 1; updatedAt: string; counts: Counts; records: Credit[]; assets: CatalogAsset[] };
type State = { status: 'loading' } | { status: 'missing' | 'unavailable'; message: string } | { status: 'ready'; preview: Preview };
const fingerprint = (asset: CatalogAsset) => JSON.stringify([asset.id, asset.name, asset.symbol, asset.exchange]);
const control: CSSProperties = { minHeight: 44, padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: 10, font: 'inherit', fontSize: 16, background: '#fff', color: '#172b43' };
const muted: CSSProperties = { color: '#65758b', lineHeight: 1.6 };
const safeUrl = (value: unknown, host: string) => {
  try { const url = new URL(String(value)); return url.protocol === 'https:' && url.hostname === host && !url.username && !url.password; } catch { return false; }
};
function readPreview(value: unknown): Preview {
  const data = value as Preview;
  if (data?.version !== 1 || !Number.isFinite(Date.parse(data.updatedAt)) || !data.counts ||
    !['processed', 'matched', 'ambiguous', 'missing', 'failed', 'total'].every(key => Number.isSafeInteger(data.counts[key as keyof Counts]) && Number(data.counts[key as keyof Counts]) >= 0) ||
    typeof data.counts.bounded !== 'boolean' || !Array.isArray(data.assets) || !Array.isArray(data.records)) throw new Error('미리보기 파일 형식이 올바르지 않습니다.');
  for (const record of data.records) {
    if (typeof record.fingerprint !== 'string' || !['upload.wikimedia.org', 'thumb.wikimedia.org'].some(host => safeUrl(record.imageUrl, host)) || !safeUrl(record.sourcePage, 'commons.wikimedia.org') || typeof record.license !== 'string' || typeof record.artist !== 'string') throw new Error('로고 출처 정보를 확인하지 못했습니다.');
  }
  const credits = new Map(data.records.map(record => [record.fingerprint, record]));
  if (data.assets.length !== data.counts.matched || data.assets.some(asset => !asset || typeof asset.id !== 'string' || typeof asset.name !== 'string' || typeof asset.symbol !== 'string' || asset.kind !== 'STOCK' || !credits.has(fingerprint(asset)))) throw new Error('로고와 기업 목록이 일치하지 않습니다.');
  return data;
}
function CompanyCard({ asset, credit, commodity }: { asset: CatalogAsset; credit: Credit; commodity: string }) {
  const [imageState, setImageState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  // This is an explicit display binding. A custom commodity never identifies a company by itself.
  const boundAsset = { ...asset, iconUrl: credit.imageUrl };
  return <article style={{ border: '1px solid #e3e7ed', borderRadius: 16, overflow: 'hidden', minWidth: 0, background: '#fff' }}>
    <div style={{ height: 130, padding: 28, boxSizing: 'border-box', display: 'grid', placeItems: 'center', background: '#f7f9fc', overflow: 'hidden' }}>
      {imageState === 'failed' ? <span style={{ fontSize: 28, color: '#65758b' }}>{asset.iconText || asset.symbol.slice(0, 2)}</span> : <img src={credit.imageUrl} alt={`${asset.name} 로고`} loading="lazy" referrerPolicy="no-referrer" onLoad={() => setImageState('loaded')} onError={() => setImageState('failed')} style={{ width: '100%', maxWidth: '100%', height: 74, minHeight: 0, objectFit: 'contain' }} />}
    </div>
    <div style={{ padding: 20, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><AssetIcon commodity={commodity || asset.symbol} asset={boundAsset} /><strong style={{ overflowWrap: 'anywhere' }}>{asset.name}</strong></div>
      <small style={muted}>{asset.exchange} · {asset.symbol}</small>
      {commodity && <small style={{ ...muted, overflowWrap: 'anywhere' }}>{commodity} → {asset.name} · 명시적 연결 예시</small>}
      <small style={{ color: imageState === 'failed' ? '#a34532' : '#476577', minHeight: 18 }}>{imageState === 'loading' ? '이미지 불러오는 중' : imageState === 'loaded' ? '✓ 이미지 로드 완료' : '이미지 로드 실패 · 문자 표시'}</small>
      <a href={credit.sourcePage} target="_blank" rel="noreferrer" style={{ minHeight: 44, display: 'flex', alignItems: 'center', fontSize: 13 }}>Wikimedia Commons 출처 ↗</a>
      <small style={{ ...muted, overflowWrap: 'anywhere' }}>{credit.license}<br />{credit.artist || '제작자 정보는 출처 페이지 참조'}</small>
    </div>
  </article>;
}
function AutomaticGallery() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [exchange, setExchange] = useState('');
  const [commodity, setCommodity] = useState('');
  const [limit, setLimit] = useState(48);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    void fetch('/automatic-logos.json', { signal: controller.signal, credentials: 'omit', cache: 'no-store' }).then(async response => {
      if (response.status === 404) { setState({ status: 'missing', message: '아직 자동 로고 미리보기가 없습니다.' }); return; }
      if (!response.ok) throw new Error(`미리보기를 불러오지 못했습니다 (HTTP ${response.status}).`);
      const preview = readPreview(await response.json());
      if (!controller.signal.aborted) setState({ status: 'ready', preview });
    }).catch((error: unknown) => { if (!controller.signal.aborted) setState({ status: 'unavailable', message: error instanceof Error ? error.message : '미리보기를 읽지 못했습니다.' }); });
    return () => controller.abort();
  }, [revision]);
  const preview = state.status === 'ready' ? state.preview : null;
  const credits = new Map(preview?.records.map(record => [record.fingerprint, record]));
  const filtered = preview?.assets.filter(asset => (!exchange || asset.exchange === exchange) && `${asset.name} ${asset.symbol} ${asset.exchange}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? [];
  return <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px', color: '#172b43' }}>
    <span style={{ color: '#506c89', fontSize: 12, letterSpacing: '0.12em', fontWeight: 700 }}>AUTOMATIC COMPANY IDENTITIES</span>
    <h1 style={{ margin: '12px 0', fontSize: 32, letterSpacing: '-0.04em' }}>자동으로 찾은 기업 로고</h1>
    <p style={muted}>한국·미국 종목 목록을 공개 Wikidata·Wikimedia Commons 정보와 대조한 실제 저장 결과입니다. 갤러리에는 일치한 기업만 표시합니다.</p>
    <button type="button" style={control} onClick={() => setRevision(value => value + 1)} disabled={state.status === 'loading'}>미리보기 다시 읽기</button>
    {state.status === 'loading' && <p role="status">저장된 미리보기를 불러오는 중…</p>}
    {(state.status === 'missing' || state.status === 'unavailable') && <section role="status" style={{ padding: 24, marginTop: 24, background: '#f7f9fc', borderRadius: 16 }}>
      <h2 style={{ fontSize: 20 }}>{state.status === 'missing' ? '미리보기 생성 필요' : '미리보기 사용 불가'}</h2><p>{state.message}</p>
      <p style={muted}>종목 목록 동기화 후 아래 명령으로 공개 로고를 갱신하고 이 페이지를 다시 읽어 주세요. API 키는 필요하지 않습니다.</p>
      <code style={{ display: 'block', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>yarn logos:sync --preview apps/web/.storybook/public/automatic-logos.json</code>
    </section>}
    {preview && <>
      <p style={{ ...muted, fontSize: 13 }}>마지막 갱신: <time dateTime={preview.updatedAt}>{new Date(preview.updatedAt).toLocaleString('ko-KR')}</time> · {preview.counts.bounded ? '일부 종목만 처리한 결과' : '전체 종목 처리 결과'}</p>
      <dl style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '24px 0' }}>{([['전체', preview.counts.total], ['처리', preview.counts.processed], ['일치', preview.counts.matched], ['모호함', preview.counts.ambiguous], ['없음', preview.counts.missing], ['실패', preview.counts.failed]] as const).map(([label, count]) => <div key={label} style={{ padding: '12px 20px', background: '#f7f9fc', borderRadius: 12 }}><dt style={{ ...muted, fontSize: 12 }}>{label}</dt><dd style={{ margin: '6px 0 0', fontSize: 24, fontVariantNumeric: 'tabular-nums' }}>{count.toLocaleString('ko-KR')}</dd></div>)}</dl>
      <p style={{ ...muted, fontSize: 13 }}>모호하거나 찾지 못한 기업은 로고를 추측하지 않습니다. 아래 작은 아이콘은 앱의 AssetIcon이며, 사용자 단위도 기업에 명시적으로 연결한 경우에만 로고를 표시합니다.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '24px 0' }}>
        <label style={{ flex: '1 1 240px' }}><span style={{ display: 'block', marginBottom: 8 }}>회사명·종목 코드 검색</span><input type="search" value={query} onChange={event => { setQuery(event.target.value); setLimit(48); }} style={{ ...control, width: '100%', boxSizing: 'border-box' }} /></label>
        <label><span style={{ display: 'block', marginBottom: 8 }}>거래소</span><select value={exchange} onChange={event => { setExchange(event.target.value); setLimit(48); }} style={control}><option value="">전체</option>{[...new Set(preview.assets.map(asset => asset.exchange).filter((value): value is string => Boolean(value)))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
        <label><span style={{ display: 'block', marginBottom: 8 }}>사용자 단위 연결 예시</span><input value={commodity} maxLength={32} placeholder="MY-SHARES" onChange={event => setCommodity(event.target.value)} style={control} /></label>
      </div>
      {commodity && <p style={{ display: 'flex', gap: 10, alignItems: 'center', ...muted }}><AssetIcon commodity={commodity} />연결 전 사용자 단위: {commodity}</p>}
      <p aria-live="polite" style={{ ...muted, fontSize: 13 }}>일치 기업 {preview.assets.length.toLocaleString('ko-KR')}개 중 검색 결과 {filtered.length.toLocaleString('ko-KR')}개 · 현재 {Math.min(limit, filtered.length)}개 표시</p>
      {preview.assets.length === 0 ? <p>갱신은 완료되었지만 일치한 로고가 없습니다. 위 집계에서 누락·모호함을 확인해 주세요.</p> : filtered.length === 0 ? <p>검색 결과가 없습니다.</p> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))', gap: 16 }}>{filtered.slice(0, limit).map(asset => <CompanyCard key={asset.id} asset={asset} credit={credits.get(fingerprint(asset))!} commodity={commodity} />)}</div>}
      {filtered.length > limit && <button type="button" style={{ ...control, marginTop: 24 }} onClick={() => setLimit(value => value + 48)}>48개 더 보기 ({filtered.length - limit}개 남음)</button>}
    </>}
  </main>;
}
const meta = { title: 'Design System/Automatic Logos', parameters: { layout: 'fullscreen' }, decorators: [(Story) => <div className="ledger-app" style={{ fontFamily: tokens.fontFamily.web }}><Story /></div>] } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const SavedAutomaticResults: Story = { render: () => <AutomaticGallery /> };
