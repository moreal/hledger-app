import type { Meta, StoryObj } from '@storybook/react-vite';
import { AssetIcon, type CatalogAsset } from './AssetIdentity';

const asset = (overrides: Partial<CatalogAsset>): CatalogAsset => ({
  id: 'example:asset', symbol: 'USD', name: 'Example asset', kind: 'CURRENCY',
  exchange: null, isin: null, source: 'example', sourceUrl: '', asOf: null,
  iconText: 'EX', iconUrl: null, ...overrides,
});
const meta = {
  title: 'Design System/Asset Identity',
  component: AssetIcon,
  args: { commodity: 'USD' },
  parameters: { layout: 'centered' },
  decorators: [(Story) => <div className="ledger-app"><Story /></div>],
  tags: ['autodocs'],
} satisfies Meta<typeof AssetIcon>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CurrencyFallback: Story = {};
export const BoundCurrency: Story = {
  args: { commodity: 'travel-dollars', asset: asset({ symbol: 'USD' }) },
};
export const LogoSuccess: Story = {
  args: { commodity: 'EXAMPLE', asset: asset({ kind: 'STOCK', symbol: 'EXAMPLE', name: 'Fictional example brand', iconUrl: '/asset-logo.svg' }) },
};
export const LogoFailure: Story = {
  args: { commodity: 'travel-dollars', asset: asset({ iconUrl: 'https://example.invalid/missing-logo.svg' }) },
};
export const CustomCommodity: Story = { args: { commodity: 'POINTS' } };
export const ExplicitStock: Story = {
  args: { commodity: 'USD', asset: asset({ kind: 'STOCK', symbol: 'USD', iconText: 'US' }) },
};
