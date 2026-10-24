/** Reference metadata is distinct from the ledger's exact commodity string. */
export interface Asset {
  id: string;
  symbol: string;
  name: string;
  exchange: string | null;
  kind: 'CURRENCY' | 'STOCK' | 'CRYPTO';
  isin: string | null;
  source: string;
  sourceUrl: string;
  asOf: string | null;
  iconText: string;
  iconUrl: string | null;
}
export interface AssetBinding { commodity: string; asset: Asset; updatedAt: string }
export interface AssetProviderStatus {
  provider: string;
  status: 'READY' | 'STALE' | 'UNCONFIGURED' | 'UNAVAILABLE';
  updatedAt: string | null;
  message: string | null;
}
export interface AssetCatalogSearchResult { items: Asset[]; providers: AssetProviderStatus[] }
export interface AssetCatalog {
  search(query: string, first?: number): Promise<AssetCatalogSearchResult>;
  get(id: string): Promise<Asset | null>;
  /** Refresh display-only logos on saved snapshots without changing identity. */
  decorate?(assets: readonly Asset[]): Promise<Asset[]>;
}
