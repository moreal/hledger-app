import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { currencyIcons, type CurrencyIconSize } from '../../design-tokens/src/currency-icons';
import { tokens } from '../../design-tokens/src';
import { CurrencyIcon } from './CurrencyIcon';

const meta = {
  title: 'Identity/CurrencyIcon',
  component: CurrencyIcon,
  args: { commodity: 'KRW', size: 'large', label: '대한민국 원 KRW' },
  argTypes: { size: { control: 'select', options: ['small', 'medium', 'large'] } },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CurrencyIcon>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = {};

function CurrencyCatalog() {
  const [query, setQuery] = useState('');
  const [size, setSize] = useState<CurrencyIconSize>('large');
  const shown = currencyIcons.filter((icon) =>
    `${icon.code} ${icon.name} ${icon.glyph}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <section
      style={{ fontFamily: tokens.fontFamily.web, color: tokens.colors.text, maxWidth: 1100 }}
    >
      <h1 style={{ fontSize: 24 }}>통화 아이콘</h1>
      <p style={{ color: tokens.colors.muted }}>
        공통 네이비 팔레트 · 기호와 ISO 코드를 함께 표시합니다.
      </p>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <label>
          통화 검색{' '}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="USD, dollar, ₩"
            type="search"
            style={{
              minHeight: 44,
              fontSize: 16,
              border: `1px solid ${tokens.colors.borderStrong}`,
              borderRadius: 10,
              padding: '0 12px',
            }}
          />
        </label>
        <label>
          크기{' '}
          <select
            value={size}
            onChange={(event) => setSize(event.target.value as CurrencyIconSize)}
            style={{ minHeight: 44, fontSize: 16 }}
          >
            <option value="small">Small · 24</option>
            <option value="medium">Medium · 32</option>
            <option value="large">Large · 48</option>
          </select>
        </label>
        <span role="status">
          {shown.length} / {currencyIcons.length}
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))',
          gap: 12,
        }}
      >
        {shown.map((icon) => (
          <div
            key={icon.code}
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              padding: 16,
              borderRadius: 16,
              border: `1px solid ${tokens.colors.border}`,
              minWidth: 0,
            }}
          >
            <CurrencyIcon commodity={icon.code} size={size} />
            <div style={{ minWidth: 0 }}>
              <strong>{icon.code}</strong>
              <div
                style={{
                  fontSize: 13,
                  color: tokens.colors.muted,
                  marginTop: 4,
                  overflowWrap: 'anywhere',
                }}
              >
                {icon.name}
              </div>
            </div>
          </div>
        ))}
      </div>
      {shown.length === 0 && <p>일치하는 통화가 없습니다.</p>}
    </section>
  );
}
export const AllCurrencies: Story = { render: () => <CurrencyCatalog /> };
export const SizesAndSharedSymbols: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
      {['KRW', 'USD', 'CAD', 'AUD', 'EUR', 'JPY', 'CNY', 'GBP', 'INR'].map((code) => (
        <div key={code} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {(['small', 'medium', 'large'] as const).map((size) => (
            <CurrencyIcon key={size} commodity={code} size={size} label={`${code} ${size}`} />
          ))}
        </div>
      ))}
    </div>
  ),
};
export const CustomCommodities: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
      {['usd', 'BTC', '005930', '삼성전자', 'MY VERY LONG CUSTOM COMMODITY', ''].map((code) => (
        <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CurrencyIcon commodity={code} size="large" />
          <span>{code || '(빈 단위)'}</span>
        </div>
      ))}
    </div>
  ),
};
