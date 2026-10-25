import { isPngDataUrl } from '../../domain/src/icon-url';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AssetFieldsFragment, LedgerClient } from '../../client/index';
import { getAssetUnitOptions } from '../../domain/src/asset-units';
import { CurrencyIcon } from './CurrencyIcon';
import { getCurrencyIcon } from '../../design-tokens/src/currency-icons';

export type CatalogAsset = AssetFieldsFragment;
type Metadata = {
  client: LedgerClient | null;
  bindings: ReadonlyMap<string, CatalogAsset>;
  error: string;
  setBinding: (commodity: string, assetId: string | null) => Promise<boolean>;
};
const emptyBindings = new Map<string, CatalogAsset>();
const AssetMetadataContext = createContext<Metadata | null>(null);
const message = (error: unknown) =>
  error instanceof Error ? error.message : '이름 연결을 저장하지 못했습니다.';

/** Display metadata is scoped to the authenticated client, never to transaction drafts. */
export function AssetMetadataProvider({
  client,
  revision = 0,
  children,
}: {
  client: LedgerClient | null;
  revision?: number;
  children: ReactNode;
}) {
  const [state, setState] = useState<{
    client: LedgerClient | null;
    bindings: ReadonlyMap<string, CatalogAsset>;
    error: string;
  }>({ client: null, bindings: emptyBindings, error: '' });
  const [refresh, setRefresh] = useState(0);
  const active = useRef(client);
  active.current = client;
  const readGeneration = useRef(0);
  const writes = useRef(new Map<string, LedgerClient>());
  useEffect(() => {
    const serial = ++readGeneration.current;
    if (!client) return;
    void client
      .assetBindings()
      .then((result) => {
        if (active.current !== client || serial !== readGeneration.current) return;
        if (result.errors?.length || !result.data?.assetBindings)
          throw new Error(
            result.errors?.map((item) => item.message).join(' · ') ||
              '이름 연결 정보를 읽지 못했습니다.',
          );
        setState({
          client,
          bindings: new Map(
            result.data.assetBindings.map((binding) => [binding.commodity, binding.asset]),
          ),
          error: '',
        });
      })
      .catch((error: unknown) => {
        if (active.current === client && serial === readGeneration.current)
          setState((old) => ({
            client,
            bindings: old.client === client ? old.bindings : emptyBindings,
            error: message(error),
          }));
      });
    return () => {
      readGeneration.current++;
    };
  }, [client, revision, refresh]);
  const setBinding = useCallback(
    async (commodity: string, assetId: string | null) => {
      if (!client || active.current !== client) return false;
      if (!commodity.trim() || commodity.length > 32)
        throw new Error('자산을 1~32자로 입력해 주세요.');
      if (writes.current.get(commodity) === client)
        throw new Error('이 단위의 이름 연결을 저장 중입니다. 잠시 후 다시 시도해 주세요.');
      writes.current.set(commodity, client);
      readGeneration.current++;
      try {
        const result = await client.setAssetBinding({ commodity, assetId });
        if (active.current !== client) return false;
        const saved = result.data?.setAssetBinding;
        if (
          result.errors?.length ||
          !saved ||
          saved.commodity !== commodity ||
          (assetId === null
            ? saved.binding !== null
            : saved.binding?.asset.id !== assetId || saved.binding.commodity !== commodity)
        )
          throw new Error(
            result.errors?.map((item) => item.message).join(' · ') ||
              '이름 연결 저장을 확인하지 못했습니다. 입력은 그대로 유지합니다.',
          );
        setState((old) => {
          const bindings = new Map(old.client === client ? old.bindings : emptyBindings);
          if (saved.binding) bindings.set(commodity, saved.binding.asset);
          else bindings.delete(commodity);
          return { client, bindings, error: '' };
        });
        setRefresh((value) => value + 1);
        return true;
      } finally {
        if (writes.current.get(commodity) === client) writes.current.delete(commodity);
      }
    },
    [client],
  );
  const current = state.client === client ? state : { bindings: emptyBindings, error: '' };
  return (
    <AssetMetadataContext.Provider
      value={{ client, bindings: current.bindings, error: current.error, setBinding }}
    >
      {children}
    </AssetMetadataContext.Provider>
  );
}

export const useAssetMetadata = () => useContext(AssetMetadataContext);
const currencyNames = new Map(
  getAssetUnitOptions().map((option) => [
    option.value,
    option.label.split(' · ').slice(1).join(' · '),
  ]),
);
export function assetDisplayName(commodity: string, asset?: CatalogAsset) {
  return asset?.name ?? currencyNames.get(commodity) ?? commodity;
}

export function AssetIcon({
  commodity,
  asset,
  className = '',
}: {
  commodity: string;
  asset?: CatalogAsset;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState('');
  const url =
    asset?.iconUrl &&
    (asset.iconUrl.startsWith('https://') ||
      /^\/(?![/\\])/.test(asset.iconUrl) ||
      isPngDataUrl(asset.iconUrl))
      ? asset.iconUrl
      : '';
  const currency = asset
    ? asset.kind === 'CURRENCY'
    : getCurrencyIcon(commodity).kind === 'currency';
  if ((!url || url === failedUrl) && currency)
    return <CurrencyIcon commodity={asset?.symbol ?? commodity} className={className} />;
  const text = (asset?.iconText || commodity.trim()).slice(0, 2) || '·';
  return (
    <span
      className={`asset-icon asset-icon--${asset?.kind.toLowerCase() ?? (currency ? 'currency' : 'custom')} ${className}`}
      aria-hidden="true"
    >
      {url && url !== failedUrl ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        text
      )}
    </span>
  );
}
export function AssetIdentity({ commodity }: { commodity: string }) {
  const metadata = useAssetMetadata();
  const asset = metadata?.bindings.get(commodity);
  const name = assetDisplayName(commodity, asset);
  return (
    <span className="asset-identity" title={commodity}>
      <AssetIcon commodity={commodity} asset={asset} />
      <span className="asset-identity__copy">
        <span>{name}</span>
        {name !== commodity && <small>{asset?.symbol ?? commodity}</small>}
      </span>
    </span>
  );
}
