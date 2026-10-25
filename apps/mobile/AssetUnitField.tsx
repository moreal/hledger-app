import { i18n, translateError } from '../../packages/i18n/src';
import { useLingui } from '../../packages/i18n/src/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AssetFieldsFragment, AssetsQuery, createLedgerClient } from '../../packages/client';
import { ledgerCommodity } from '../../packages/domain/src/asset-identity';
import { getAssetUnitOptions } from '../../packages/domain/src/asset-units';
import { tokens } from '../../packages/design-tokens/src';
import {
  AssetIcon,
  AssetIdentity,
  Button,
  Field,
  nativeStyles,
  useAssetIdentity,
} from '../../packages/ui-native/src';

class LocalizedError extends Error {
  constructor(readonly descriptor: { id: string; message?: string }) {
    super(descriptor.id);
  }
}
const renderError = (error: unknown) =>
  error && typeof error === 'object' && 'descriptor' in error
    ? i18n._((error as LocalizedError).descriptor)
    : translateError(error);
type Client = ReturnType<typeof createLedgerClient>;
type CatalogResult = NonNullable<AssetsQuery['assets']>;
const providerLabels = {
  READY: /* i18n */ { id: 'native.assetunitfield.provider.ready', message: '사용 가능' },
  STALE: /* i18n */ { id: 'native.assetunitfield.provider.stale', message: '이전 자료' },
  UNCONFIGURED: /* i18n */ {
    id: 'native.assetunitfield.provider.unconfigured',
    message: '설정되지 않음',
  },
  UNAVAILABLE: /* i18n */ {
    id: 'native.assetunitfield.provider.unavailable',
    message: '이용 불가',
  },
};

export function AssetUnitField({
  label,
  value,
  onChangeText,
  customValues,
  onComplete,
  editable = true,
  catalogClient,
  onBind,
  requestContext,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  customValues: readonly string[];
  onComplete: (value: string) => void;
  editable?: boolean;
  catalogClient?: Client;
  onBind?: (commodity: string, assetId: string | null) => Promise<void>;
  /** Stable owner state reference, so a delayed selection cannot edit a replacement form. */
  requestContext?: unknown;
}) {
  const { _, i18n } = useLingui();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<CatalogResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<unknown>('');
  const [bindingError, setBindingError] = useState<unknown>('');
  const [bindingNotice, setBindingNotice] = useState<{ target: string; name?: string } | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [providerDetails, setProviderDetails] = useState(false);
  const pendingRef = useRef(false);
  const mounted = useRef(true);
  const searchRequest = useRef(0);
  const latest = useRef({
    editable,
    value,
    catalogClient,
    onChangeText,
    onComplete,
    onBind,
    requestContext,
  });
  latest.current = {
    editable,
    value,
    catalogClient,
    onChangeText,
    onComplete,
    onBind,
    requestContext,
  };
  const options = useMemo(
    () => getAssetUnitOptions(customValues, query, i18n.locale),
    [customValues, query, i18n.locale],
  );
  const { asset: currentAsset } = useAssetIdentity(value);
  const visible = expanded && editable;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setResult(null);
    setSearchError('');
    setBindingError('');
    setBindingNotice(null);
    setProviderDetails(false);
  }, [catalogClient]);
  useEffect(() => {
    setClearConfirm(false);
  }, [value, catalogClient, requestContext, editable]);
  useEffect(() => {
    const generation = ++searchRequest.current;
    setResult(null);
    setSearchError('');
    setSearching(false);
    if (!visible || !catalogClient || !query.trim()) return;
    setSearching(true);
    const timer = setTimeout(() => {
      void catalogClient
        .assets({ query: query.trim(), first: 6 })
        .then((response) => {
          if (
            generation !== searchRequest.current ||
            latest.current.catalogClient !== catalogClient
          )
            return;
          if (response.errors?.length || !response.data?.assets)
            throw response.errors?.map((error) => error.message).join('\n')
              ? new Error(response.errors?.map((error) => error.message).join('\n'))
              : new LocalizedError(
                  /* i18n */ {
                    id: 'native.assetunitfield.search.missingResult',
                    message: '자산 검색 결과를 받지 못했습니다.',
                  },
                );
          setResult(response.data.assets);
        })
        .catch((error) => {
          if (generation === searchRequest.current) setSearchError(error);
        })
        .finally(() => {
          if (generation === searchRequest.current) setSearching(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      searchRequest.current += 1;
    };
  }, [query, visible, catalogClient]);

  function selectLocal(next: string) {
    if (!latest.current.editable || pendingRef.current) return;
    latest.current.onChangeText(next);
    latest.current.onComplete(next);
    setExpanded(false);
  }
  async function bind(asset: AssetFieldsFragment | null, useSelectedAsset: boolean) {
    const current = latest.current;
    if (!current.editable || pendingRef.current || !current.catalogClient || !current.onBind)
      return;
    const target = useSelectedAsset && asset ? ledgerCommodity(asset) : current.value;
    if (!target.trim() || target.length > 32) return;
    pendingRef.current = true;
    setPending(true);
    setClearConfirm(false);
    setBindingError('');
    setBindingNotice(null);
    try {
      await current.onBind(target, asset?.id ?? null);
      const active = latest.current;
      if (
        !mounted.current ||
        active.catalogClient !== current.catalogClient ||
        active.value !== current.value ||
        active.requestContext !== current.requestContext
      )
        return;
      // A save, queue transition or field replacement while the request runs cannot edit that draft.
      if (useSelectedAsset && asset && active.editable) {
        active.onChangeText(target);
        active.onComplete(target);
        setExpanded(false);
      }
      setBindingNotice({ target, name: asset?.name });
    } catch (error) {
      if (mounted.current && latest.current.catalogClient === current.catalogClient) {
        setBindingError(error);
      }
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return (
    <View style={styles.field}>
      <Field
        label={label}
        value={value}
        editable={editable && !pending}
        maxLength={32}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        returnKeyType="done"
        hint={_(
          /* i18n */ {
            id: 'native.assetunitfield.inputHint',
            message: 'KRW·USD 또는 BTC·AAPL·005930 등 직접 입력',
          },
        )}
        onChangeText={(next) => {
          if (latest.current.editable && !pendingRef.current) onChangeText(next);
        }}
        onSubmitEditing={() => {
          if (latest.current.editable && !pendingRef.current) {
            onComplete(value);
            setExpanded(false);
          }
        }}
      />
      {value ? <AssetIdentity commodity={value} /> : null}
      {currentAsset && (
        <Text style={nativeStyles.caption}>
          {[
            currentAsset.exchange,
            currentAsset.source,
            currentAsset.asOf
              ? _(
                  /* i18n */ {
                    id: 'native.assetunitfield.asOf',
                    message: '자료 {value0}',
                    values: { value0: currentAsset.asOf },
                  },
                )
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      )}
      {editable && (
        <Button
          variant="quiet"
          expanded={visible}
          disabled={pending}
          label={_(
            /* i18n */ {
              id: 'native.assetunitfield.search.toggle',
              message: '{value0} 검색 {action, select, collapse {접기} other {열기}}',
              values: { value0: label, action: visible ? 'collapse' : 'expand' },
            },
          )}
          onPress={() => {
            if (!expanded) setQuery('');
            setExpanded(!expanded);
          }}
        >
          {visible
            ? _(/* i18n */ { id: 'native.assetunitfield.search.collapse', message: '검색 접기' })
            : _(/* i18n */ { id: 'native.assetunitfield.search.open', message: '통화·종목 찾기' })}
        </Button>
      )}
      {bindingError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {_(
            /* i18n */ {
              id: 'native.asset.bindingKept.sentence',
              message: '{value0} 입력한 자산은 유지됩니다.',
              values: { value0: renderError(bindingError) },
            },
          )}
        </Text>
      ) : null}
      {bindingNotice ? (
        <Text accessibilityLiveRegion="polite" style={nativeStyles.caption}>
          {bindingNotice.name
            ? _(
                /* i18n */ {
                  id: 'native.asset.bound',
                  message: '{target}에 {name} 표시 정보를 연결했습니다.',
                  values: { target: bindingNotice.target, name: bindingNotice.name },
                },
              )
            : _(
                /* i18n */ {
                  id: 'native.asset.unbound',
                  message: '표시 정보 연결을 해제했습니다. 자산는 유지됩니다.',
                },
              )}
        </Text>
      ) : null}
      {visible && (
        <View style={styles.suggestions}>
          <Field
            label={_(
              /* i18n */ {
                id: 'native.assetunitfield.search.label',
                message: '{value0} 검색',
                values: { value0: label },
              },
            )}
            value={query}
            onChangeText={setQuery}
            editable={!pending}
            maxLength={200}
            placeholder={_(
              /* i18n */ {
                id: 'native.assetunitfield.search.placeholder',
                message: '통화 코드, 종목명, 티커 검색',
              },
            )}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
          />
          <Text style={nativeStyles.strong}>
            {_(
              /* i18n */ {
                id: 'native.assetunitfield.local.title',
                message: '기본 통화 · 내 원장의 자산',
              },
            )}
          </Text>
          <Text accessibilityLiveRegion="polite" style={nativeStyles.caption}>
            {options.length
              ? _(
                  /* i18n */ {
                    id: 'native.assetunitfield.local.count',
                    message: '{value0}개 중 {value1}개 · 선택하면 자산에 적용',
                    values: { value0: options.length, value1: Math.min(4, options.length) },
                  },
                )
              : _(
                  /* i18n */ {
                    id: 'native.assetunitfield.local.empty',
                    message: '일치하는 자산이 없습니다. 직접 입력한 자산을 사용할 수 있습니다.',
                  },
                )}
          </Text>
          {options.slice(0, 4).map((option) => (
            <Button
              key={option.value}
              selected={value === option.value}
              disabled={pending}
              label={_(
                /* i18n */ {
                  id: 'native.assetunitfield.local.select',
                  message:
                    '{value0}, {kind, select, currency {기본 통화} other {사용자 자산}}, 선택',
                  values: { value0: option.label, kind: option.kind },
                },
              )}
              onPress={() => selectLocal(option.value)}
            >
              {option.label}
            </Button>
          ))}
          <Text style={nativeStyles.strong}>
            {_(/* i18n */ { id: 'native.assetunitfield.catalog.title', message: '자산 목록 검색' })}
          </Text>
          <Text style={nativeStyles.caption}>
            {_(
              /* i18n */ {
                id: 'native.assetunitfield.catalog.selectionHint',
                message: '종목을 선택하면 이름과 아이콘이 표시됩니다.',
              },
            )}
          </Text>
          <Text style={nativeStyles.caption}>
            {_(
              /* i18n */ {
                id: 'native.assetunitfield.catalog.scopeHint',
                message:
                  '표시 정보 연결·해제는 현재 원장에서 자산 코드가 정확히 같은 모든 항목·거래·시세의 이름과 아이콘에 함께 적용됩니다.',
              },
            )}
          </Text>
          {!catalogClient ? (
            <Text style={nativeStyles.caption}>
              {_(
                /* i18n */ {
                  id: 'native.assetunitfield.catalog.connectHint',
                  message:
                    '설정에서 원장을 연결하면 종목을 검색할 수 있습니다. 기본 통화와 원장의 자산은 오프라인에서도 사용할 수 있습니다.',
                },
              )}
            </Text>
          ) : !query.trim() ? (
            <Text style={nativeStyles.caption}>
              {_(
                /* i18n */ {
                  id: 'native.assetunitfield.catalog.queryHint',
                  message: '이름이나 티커를 입력해 주세요.',
                },
              )}
            </Text>
          ) : null}
          {searching ? (
            <Text accessibilityLiveRegion="polite" style={nativeStyles.caption}>
              {_(
                /* i18n */ {
                  id: 'native.assetunitfield.catalog.loading',
                  message: '자산 목록을 검색하고 있습니다…',
                },
              )}
            </Text>
          ) : null}
          {searchError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {_(
                /* i18n */ {
                  id: 'native.assetunitfield.catalog.manualHint.sentence',
                  message: '{value0} 직접 입력은 계속 사용할 수 있습니다.',
                  values: { value0: renderError(searchError) },
                },
              )}
            </Text>
          ) : null}
          {result?.providers.some(
            (provider) => provider.status === 'UNAVAILABLE' || provider.status === 'UNCONFIGURED',
          ) ? (
            <Text style={nativeStyles.caption}>
              {_(
                /* i18n */ {
                  id: 'native.assetunitfield.catalog.limited',
                  message: '일부 자산 목록을 이용할 수 없어 검색 결과가 제한될 수 있습니다.',
                },
              )}
            </Text>
          ) : null}
          {result?.providers.some((provider) => provider.status === 'STALE') ? (
            <Text style={nativeStyles.caption}>
              {_(
                /* i18n */ {
                  id: 'native.assetunitfield.catalog.stale',
                  message: '일부 자산 정보는 이전에 받은 자료입니다.',
                },
              )}
            </Text>
          ) : null}
          {result?.providers.length ? (
            <Button
              variant="quiet"
              expanded={providerDetails}
              onPress={() => setProviderDetails((open) => !open)}
            >
              {_(
                /* i18n */ {
                  id: 'native.assetunitfield.provider.details',
                  message: '데이터 출처·상태',
                },
              )}
            </Button>
          ) : null}
          {providerDetails &&
            result?.providers.map((provider) => (
              <Text key={provider.provider} style={nativeStyles.caption}>
                {provider.provider} · {_(providerLabels[provider.status])}
                {provider.updatedAt ? ` · ${provider.updatedAt}` : ''}
                {provider.message ? ` · ${provider.message}` : ''}
              </Text>
            ))}
          {result && result.items.length === 0 ? (
            <Text accessibilityLiveRegion="polite" style={nativeStyles.caption}>
              {_(
                /* i18n */ {
                  id: 'native.assetunitfield.catalog.empty',
                  message:
                    '검색 결과가 없습니다. 제공처 상태를 확인하거나 다른 이름으로 검색해 주세요.',
                },
              )}
            </Text>
          ) : null}
          {result?.items.map((asset) => (
            <View key={asset.id} style={styles.result}>
              <View style={styles.identity}>
                <AssetIcon commodity={asset.symbol} asset={asset} size={30} />
                <Text style={[nativeStyles.strong, styles.flex]}>{asset.name}</Text>
              </View>
              <Text style={nativeStyles.caption}>
                {[
                  asset.symbol,
                  asset.exchange,
                  asset.source,
                  asset.asOf
                    ? _(
                        /* i18n */ {
                          id: 'native.assetunitfield.result.asOf',
                          message: '자료 {value0}',
                          values: { value0: asset.asOf },
                        },
                      )
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              <Button
                disabled={pending || !onBind}
                label={_(
                  /* i18n */ {
                    id: 'native.assetunitfield.result.select',
                    message: '{value0} 선택',
                    values: { value0: asset.name },
                  },
                )}
                onPress={() => void bind(asset, true)}
              >
                {_(
                  /* i18n */ {
                    id: 'native.assetunitfield.result.selectLabel.sentence',
                    message: '{value0} 선택',
                    values: { value0: asset.name },
                  },
                )}
              </Button>
              {value.trim() && value !== ledgerCommodity(asset) ? (
                <Button
                  variant="quiet"
                  disabled={pending || !onBind || value.length > 32}
                  onPress={() => void bind(asset, false)}
                >
                  {_(
                    /* i18n */ {
                      id: 'native.assetunitfield.binding.currentAsset.sentence',
                      message: '현재 자산 {value0}에 연결',
                      values: { value0: value },
                    },
                  )}
                </Button>
              ) : null}
            </View>
          ))}
          {currentAsset &&
            (clearConfirm ? (
              <View style={styles.result}>
                <Text style={nativeStyles.caption}>
                  {_(
                    /* i18n */ {
                      id: 'native.assetunitfield.unbind.currentLedger.sentence',
                      message:
                        '현재 원장에서 자산이 정확히 {value0}인 모든 항목·거래·시세의 {value1} 표시 정보 연결을 해제할까요? 자산과 금액/수량은 유지됩니다.',
                      values: { value0: value, value1: currentAsset.name },
                    },
                  )}
                </Text>
                <Button
                  disabled={pending || !catalogClient || !onBind}
                  onPress={() => void bind(null, false)}
                >
                  {_(
                    /* i18n */ {
                      id: 'native.assetunitfield.unbind.all.sentence',
                      message: '모든 {value0} 표시 정보 연결 해제',
                      values: { value0: value },
                    },
                  )}
                </Button>
                <Button variant="quiet" disabled={pending} onPress={() => setClearConfirm(false)}>
                  {_(/* i18n */ { id: 'native.assetunitfield.common.cancel', message: '취소' })}
                </Button>
              </View>
            ) : (
              <Button
                variant="quiet"
                disabled={pending || !catalogClient || !onBind}
                onPress={() => setClearConfirm(true)}
              >
                {_(
                  /* i18n */ {
                    id: 'native.assetunitfield.unbind.actionLabel.sentence',
                    message: '표시 정보 연결 해제 · {value0} 유지',
                    values: { value0: value },
                  },
                )}
              </Button>
            ))}
          {pending ? (
            <Text accessibilityLiveRegion="polite" style={nativeStyles.caption}>
              {_(
                /* i18n */ {
                  id: 'native.assetunitfield.binding.saving',
                  message: '원장에 표시 정보를 저장하고 있습니다…',
                },
              )}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: tokens.space.xs },
  suggestions: {
    gap: tokens.space.sm,
    padding: tokens.space.sm,
    borderRadius: tokens.radius.control,
    backgroundColor: tokens.colors.surfaceSubtle,
  },
  result: {
    gap: tokens.space.xs,
    paddingVertical: tokens.space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: tokens.colors.border,
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.sm },
  flex: { flex: 1 },
  error: { ...tokens.typography.supporting, color: tokens.colors.danger },
});
