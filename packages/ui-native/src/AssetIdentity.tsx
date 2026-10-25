import { isPngDataUrl } from '../../domain/src/icon-url';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { Asset, AssetBinding } from '../../domain/src/asset-catalog';
import { getAssetUnitOptions } from '../../domain/src/asset-units';
import { tokens } from '../../design-tokens/src';
import { CurrencyIcon } from './CurrencyIcon';
import { getCurrencyIcon } from '../../design-tokens/src/currency-icons';

const AssetMetadata = createContext<ReadonlyMap<string, Asset>>(new Map());
const currencyNames = new Map(
  getAssetUnitOptions().map((option) => [
    option.value,
    option.label.slice(option.value.length + 3),
  ]),
);

/** Only explicit, ledger-scoped bindings identify securities. Raw tickers never do. */
export function AssetMetadataProvider({
  bindings,
  children,
}: {
  bindings: readonly AssetBinding[];
  children: ReactNode;
}) {
  return (
    <AssetMetadata.Provider
      value={new Map(bindings.map((binding) => [binding.commodity, binding.asset]))}
    >
      {children}
    </AssetMetadata.Provider>
  );
}

export function useAssetIdentity(commodity: string) {
  const asset = useContext(AssetMetadata).get(commodity);
  return { asset, name: asset?.name ?? currencyNames.get(commodity) };
}

export function AssetIcon({
  commodity,
  asset,
  size = 24,
}: {
  commodity: string;
  asset?: Asset;
  size?: number;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url =
    asset?.iconUrl && (isPngDataUrl(asset.iconUrl) || /^https?:\/\//i.test(asset.iconUrl))
      ? asset.iconUrl
      : null;
  const currency = asset
    ? asset.kind === 'CURRENCY'
    : getCurrencyIcon(commodity).kind === 'currency';
  if ((!url || failedUrl === url) && currency)
    return <CurrencyIcon commodity={asset?.symbol ?? commodity} size={size} />;
  const mark =
    asset?.iconText ||
    [...commodity]
      .filter((character) => !/\s/.test(character))
      .slice(0, 2)
      .join('') ||
    '·';
  return (
    <View
      accessible={false}
      style={[styles.mark, { width: size, height: size, borderRadius: size / 2 }]}
    >
      {url && failedUrl !== url ? (
        <Image
          accessible={false}
          source={{ uri: url }}
          resizeMode="contain"
          style={{ width: size * 0.8, height: size * 0.8 }}
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <Text numberOfLines={1} style={[styles.markText, { fontSize: size * 0.43 }]}>
          {mark}
        </Text>
      )}
    </View>
  );
}

export function AssetIdentity({ commodity }: { commodity: string }) {
  const { asset, name } = useAssetIdentity(commodity);
  return (
    <View style={styles.identity}>
      <AssetIcon commodity={commodity} asset={asset} />
      <Text style={styles.name}>{name ?? commodity}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.xs, minWidth: 0 },
  mark: {
    backgroundColor: tokens.colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  markText: { color: tokens.colors.muted, fontWeight: '600' },
  name: { ...tokens.typography.supporting, color: tokens.colors.muted, flexShrink: 1 },
});
