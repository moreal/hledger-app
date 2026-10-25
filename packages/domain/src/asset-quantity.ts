import type { Asset } from './asset-catalog';
import { formatMoney } from './index';

/** Display only: never rewrite ledger quantities or infer a security from a raw ticker. */
export function formatAssetQuantity(
  value: string,
  commodity: string,
  asset?: Pick<Asset, 'kind' | 'symbol'>,
): string {
  const unit =
    asset?.kind === 'STOCK'
      ? '주'
      : (asset?.kind === 'CURRENCY' ? asset.symbol : commodity) === 'KRW'
        ? '원'
        : commodity;
  const formatted = formatMoney(value, unit);
  return unit === '주' || unit === '원' ? formatted.replace(/ (주|원)$/, '$1') : formatted;
}
