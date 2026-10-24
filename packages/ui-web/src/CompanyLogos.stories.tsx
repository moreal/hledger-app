import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { tokens } from '../../design-tokens/src';
import { companyLogos } from '../../domain/src/company-logos';
import { AssetIcon, type CatalogAsset } from './AssetIdentity';

type CompanyLogo = (typeof companyLogos)[number];
const asAsset = (logo: CompanyLogo): CatalogAsset => ({
  id: `company:${logo.exchange}:${logo.symbol}`, symbol: logo.symbol, name: logo.name,
  kind: 'STOCK', exchange: logo.exchange, isin: null, source: 'public-logo-registry',
  sourceUrl: logo.sourcePage, asOf: null, iconText: logo.name.slice(0, 2), iconUrl: logo.imageUrl,
});

function LogoCard({ logo }: { logo: CompanyLogo }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const asset = asAsset(logo);
  return <article style={{ border: '1px solid #e3e7ed', borderRadius: 16, overflow: 'hidden', background: '#fff', minWidth: 0 }}>
    <div style={{ height: 130, padding: 28, boxSizing: 'border-box', display: 'grid', placeItems: 'center', background: '#f7f9fc', overflow: 'hidden' }}>
      {status === 'failed' ? <span style={{ fontSize: 28, color: '#65758b' }}>{asset.iconText}</span> : <img
        src={logo.imageUrl} alt={`${logo.name} 로고`} referrerPolicy="no-referrer"
        onLoad={() => setStatus('loaded')} onError={() => setStatus('failed')}
        style={{ width: '100%', maxWidth: '100%', height: 74, minHeight: 0, objectFit: 'contain' }} />}
    </div>
    <div style={{ padding: 20, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><AssetIcon commodity={logo.symbol} asset={asset} /><strong>{logo.name}</strong></div>
      <div style={{ color: '#65758b', fontSize: 13 }}>{logo.exchange} · {logo.symbol}</div>
      <div role="status" style={{ fontSize: 12, color: status === 'failed' ? '#a34532' : '#476577', minHeight: 18 }}>
        {status === 'loading' ? '이미지 불러오는 중' : status === 'loaded' ? '✓ 실제 이미지 로드 완료' : '이미지 로드 실패 · 문자 대체 표시'}
      </div>
      <a href={logo.sourcePage} target="_blank" rel="noreferrer" style={{ minHeight: 44, display: 'flex', alignItems: 'center', fontSize: 13 }}>이미지 출처 ↗</a>
      <small style={{ color: '#65758b', overflowWrap: 'anywhere', lineHeight: 1.5 }}>{logo.license}</small>
    </div>
  </article>;
}

function CompanyGallery() {
  const [query, setQuery] = useState('');
  const [market, setMarket] = useState('all');
  const shown = companyLogos.filter(logo => (market === 'all' || logo.exchange === market) && `${logo.name} ${logo.symbol} ${logo.exchange}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  return <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px', color: '#172b43' }}>
    <span style={{ color: '#506c89', fontSize: 12, letterSpacing: '0.12em', fontWeight: 700 }}>COMPANY IDENTITIES</span>
    <h1 style={{ margin: '12px 0', fontSize: 32, letterSpacing: '-0.04em' }}>장부 속 기업을 한눈에</h1>
    <p style={{ color: '#65758b', lineHeight: 1.7 }}>한국과 미국 기업의 공개 로고. 카드 안의 작은 아이콘은 앱에서 사용하는 AssetIcon입니다.</p>
    <p style={{ color: '#65758b', fontSize: 13 }}>API 키 없이 공개 이미지를 불러옵니다. 네트워크 또는 출처 상태에 따라 문자로 대체될 수 있습니다.</p>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '28px 0 20px' }}>
      <label style={{ flex: '1 1 240px' }}><span style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>회사명 또는 종목 코드</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="삼성전자, AAPL…" style={{ width: '100%', boxSizing: 'border-box', minHeight: 44, borderRadius: 10, border: '1px solid #cbd5e1', padding: '10px 14px', fontSize: 16 }} /></label>
      <label><span style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>거래소</span><select value={market} onChange={event => setMarket(event.target.value)} style={{ minHeight: 44, padding: '10px 14px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 16 }}><option value="all">전체 거래소</option>{[...new Set(companyLogos.map(logo => logo.exchange))].map(exchange => <option key={exchange}>{exchange}</option>)}</select></label>
    </div>
    <p aria-live="polite" style={{ fontSize: 13, color: '#65758b' }}>{shown.length}개 기업</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))', gap: 16 }}>{shown.map(logo => <LogoCard key={`${logo.exchange}:${logo.symbol}`} logo={logo} />)}</div>
    {shown.length === 0 && <p style={{ padding: 32 }}>검색 결과가 없습니다.</p>}
  </main>;
}

function ExplicitBinding() {
  const logo = companyLogos[0];
  return <section style={{ padding: 32, display: 'grid', gap: 20, maxWidth: 600 }}>
    <h2>사용자 단위와 회사 연결</h2>
    <p>단위 이름으로 회사를 추측하지 않습니다. 같은 단위도 명시적으로 연결된 경우에만 회사 로고를 표시합니다.</p>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><AssetIcon commodity="MY-SHARES" asset={asAsset(logo)} /><span>MY-SHARES → {logo.name} · 명시적 연결</span></div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><AssetIcon commodity={logo.symbol} /><span>{logo.symbol} · 연결 없는 종목 코드</span></div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><AssetIcon commodity="UNKNOWN" /><span>UNKNOWN · 미등록 단위</span></div>
  </section>;
}

const meta = {
  title: 'Design System/Company Logos',
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="ledger-app" style={{ fontFamily: tokens.fontFamily.web }}><Story /></div>],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const KoreaAndUnitedStates: Story = { render: () => <CompanyGallery /> };
export const ExplicitCommodityBinding: Story = { render: () => <ExplicitBinding /> };
