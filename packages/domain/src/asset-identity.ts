import type { Asset } from './asset-catalog.ts';

/**
 * Ledger identity is independent of a catalog provider's Asset.id.
 * Unknown markets keep their exact symbol rather than guessing an identity.
 */
export function ledgerCommodity(
  asset: Pick<Asset, 'kind' | 'exchange' | 'symbol' | 'source'>,
): string {
  if (asset.kind !== 'STOCK') return asset.symbol;

  const exchange = asset.exchange?.toUpperCase();
  const market = exchange && ['KOSPI', 'KOSDAQ', 'KONEX'].includes(exchange)
    ? 'krx'
    : exchange && ['NASDAQ', 'NYSE', 'AMEX'].includes(exchange)
      ? exchange.toLowerCase()
      : null;
  if (!market) return asset.symbol;

  const commodity = `asset:stock:${market}:${asset.symbol}`;
  // Never truncate a symbol: that could merge two different assets.
  return [...commodity].length <= 32 ? commodity : asset.symbol;
}
