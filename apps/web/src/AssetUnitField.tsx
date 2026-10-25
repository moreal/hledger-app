import { translateError } from '../../../packages/i18n/src/index';
import type { MessageDescriptor } from '@lingui/core';
import { useLingui } from '../../../packages/i18n/src/react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ComponentProps } from 'react';
import { ledgerCommodity } from '../../../packages/domain/src/asset-identity';
import { getAssetUnitOptions } from '../../../packages/domain/src/asset-units';
import { AssetIcon, Button, Field, useAssetMetadata } from '../../../packages/ui-web/src/index';
import type { CatalogAsset } from '../../../packages/ui-web/src/AssetIdentity';
import type { AssetsQuery, LedgerClient } from '../../../packages/client/index';

const rememberedLimit = 100;
const providerNames: Readonly<Record<string, MessageDescriptor>> = { iso4217: /* i18n */ { id: 'asset.provider.currency', message: '기본 통화' }, coingecko: /* i18n */ { id: 'asset.provider.crypto', message: '암호자산' }, nasdaq: /* i18n */ { id: 'asset.provider.nasdaq', message: '나스닥' }, sec: /* i18n */ { id: 'asset.provider.sec', message: '미국 SEC' }, krx: /* i18n */ { id: 'asset.provider.krx', message: '한국거래소' } };
const validChoice = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 32 && Boolean(value.trim());
const mergeChoices = (...groups: readonly (readonly string[])[]) => [...new Set(groups.flat().filter(validChoice))];
type Choices = { scope: string; values: string[] };
type RememberedChoices = Choices & { key?: string; dirty: boolean };

// Only committed choices are saved. Drafts, connection credentials and raw scope identifiers stay in memory.
export function useAssetUnitSuggestions(endpoint: string | undefined, ledgerId: string | undefined, observedValues: readonly string[]) {
  const scope = endpoint && ledgerId ? JSON.stringify([endpoint, ledgerId]) : '';
  const [observed, setObserved] = useState<Choices>({ scope: '', values: [] });
  const [remembered, setRemembered] = useState<RememberedChoices>({ scope: '', values: [], dirty: false });

  useEffect(() => {
    setObserved((previous) => {
      const values = mergeChoices(previous.scope === scope ? previous.values : [], observedValues);
      return previous.scope === scope && previous.values.length === values.length ? previous : { scope, values };
    });
  }, [scope, observedValues]);

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    void (async () => {
      try {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scope));
        const key = `hledger.asset-units.v1.${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
        let saved: string[] = [];
        try {
          const raw = localStorage.getItem(key);
          if (raw && raw.length <= 16_384) {
            const value: unknown = JSON.parse(raw);
            if (Array.isArray(value)) saved = mergeChoices(value.filter(validChoice)).slice(-rememberedLimit);
          }
        } catch { /* Unavailable or malformed settings must not affect the form. */ }
        if (!cancelled) setRemembered((previous) => ({ scope, key, values: mergeChoices(saved, previous.scope === scope ? previous.values : []).slice(-rememberedLimit), dirty: previous.scope === scope && previous.dirty }));
      } catch { /* Suggestions also work without persistent browser storage. */ }
    })();
    return () => { cancelled = true; };
  }, [scope]);

  useEffect(() => {
    if (remembered.scope !== scope || !remembered.key || !remembered.dirty) return;
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(remembered.key!, JSON.stringify(remembered.values)); } catch { /* Persistence is optional. */ }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [remembered, scope]);

  const remember = useCallback((values: readonly string[]) => {
    if (!scope || !values.some(validChoice)) return;
    setRemembered((previous) => {
      const current = previous.scope === scope ? previous : { scope, values: [], dirty: false };
      const next = mergeChoices(current.values, values).slice(-rememberedLimit);
      if (current === previous && next.length === current.values.length && next.every((value, index) => value === current.values[index])) return previous;
      return { ...current, values: next, dirty: true };
    });
  }, [scope]);

  const values = useMemo(() => mergeChoices(observed.scope === scope ? observed.values : [], observedValues, remembered.scope === scope ? remembered.values : []), [observed, observedValues, remembered, scope]);
  return { values, remember };
}

type AssetUnitFieldProps = Omit<ComponentProps<typeof Field>, 'value' | 'list'> & {
  value: string;
  customValues: readonly string[];
  onCommit: (values: readonly string[]) => void;
  onValueChange: (value: string) => void;
  /** Stable identity of the draft being edited; replace it whenever that draft changes. */
  requestContext?: unknown;
};

type AssetUnitRequestScope = { client: LedgerClient | null; value: string; requestContext: unknown };
function sameRequestScope(origin: AssetUnitRequestScope, current: AssetUnitRequestScope) {
  return origin.client === current.client && origin.value === current.value && origin.requestContext === current.requestContext;
}

/** A confirmed metadata write may outlive its draft. Only its original draft can receive a symbol. */
export async function saveAssetUnitSelection({ current, saveBinding, commodity, useSymbol, isAvailable, onValueChange, onCommit }: {
  current: () => AssetUnitRequestScope;
  saveBinding: () => Promise<boolean>;
  commodity: string;
  useSymbol: boolean;
  isAvailable: () => boolean;
  onValueChange: (value: string) => void;
  onCommit: (values: readonly string[]) => void;
}) {
  const origin = current();
  const saved = await saveBinding();
  if (!saved || !sameRequestScope(origin, current()) || !isAvailable()) return false;
  if (useSymbol) { onValueChange(commodity); onCommit([commodity]); }
  return true;
}

export function AssetUnitField({ value, customValues, onCommit, onValueChange, requestContext, onBlur, onFocus, hint, ...props }: AssetUnitFieldProps) {
  const { _, i18n } = useLingui();
  const listId = useId();
  const panelId = `${listId}-search`;
  const root = useRef<HTMLDivElement>(null);
  const metadata = useAssetMetadata();
  const client = metadata?.client ?? null;
  const current = useRef({ client, value, requestContext });
  current.current = { client, value, requestContext };
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<{ client: LedgerClient | null; query: string; result?: NonNullable<AssetsQuery['assets']>; error?: string | MessageDescriptor | { cause: unknown } }>({ client: null, query: '' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | MessageDescriptor | { cause: unknown }>('');
  const [notice, setNotice] = useState<string | MessageDescriptor>('');
  const searchGeneration = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setActionError(''); setNotice(''); }, [client, value, requestContext]);
  useEffect(() => {
    const serial = ++searchGeneration.current;
    if (!open || !client) return;
    const timer = window.setTimeout(() => {
      void client.assets({ query: query.trim(), first: 20 }).then((result) => {
        if (serial !== searchGeneration.current || current.current.client !== client) return;
        setSearch({ client, query, result: result.data?.assets ?? undefined, error: result.errors?.map((error) => error.message).join(' · ') || (!result.data?.assets ? /* i18n */ { id: 'asset.search.unreadable', message: '검색 결과를 읽지 못했습니다.' } : undefined) });
      }).catch((error: unknown) => {
        if (serial === searchGeneration.current && current.current.client === client) setSearch({ client, query, error: { cause: error } });
      });
    }, 250);
    return () => { window.clearTimeout(timer); searchGeneration.current++; };
  }, [client, query, open]);
  const options = useMemo(() => getAssetUnitOptions(customValues, '', i18n.locale), [customValues, i18n.locale]);
  const selected = options.find((option) => option.value === value);
  const binding = metadata?.bindings.get(value);
  const available = search.client === client && search.query === query ? search : undefined;
  const loading = open && Boolean(client) && !available;
  const localOptions = getAssetUnitOptions(customValues, query, i18n.locale).filter((option) => !available?.result?.items.some((asset) => ledgerCommodity(asset) === option.value)).slice(0, query.trim() ? 8 : 6);
  const disabled = () => Boolean(props.disabled || props.readOnly || root.current?.querySelector('input')?.matches(':disabled'));
  async function link(asset: CatalogAsset | null, useSymbol = false) {
    if (busy || disabled() || !metadata) return;
    const origin = current.current;
    const commodity = useSymbol && asset ? ledgerCommodity(asset) : origin.value;
    if (!validChoice(commodity)) { setActionError(/* i18n */ { id: 'web.forms.AssetUnitField.state.1', message: "연결할 자산을 1~32자로 입력해 주세요." }); return; }
    if (!asset && !window.confirm(_(/* i18n */ { id: 'asset.binding.confirmRemove', message: '현재 원장의 모든 화면에서 정확히 “{commodity}”로 기록된 단위의 이름 연결을 해제할까요? 이 입력란뿐 아니라 잔액·거래 내역·시세 표시에도 적용됩니다. 원장에 기록된 자산과 금액은 그대로 유지됩니다.', values: { commodity } }))) return;
    setBusy(true); setActionError(''); setNotice('');
    try {
      const applied = await saveAssetUnitSelection({ current: () => current.current, saveBinding: () => metadata.setBinding(commodity, asset?.id ?? null), commodity, useSymbol, isAvailable: () => mounted.current && !disabled(), onValueChange, onCommit });
      if (!applied) return;
      setNotice(asset ? /* i18n */ { id: 'web.forms.AssetUnitField.state.2', message: "{v0} 이름을 연결했습니다.", values: { v0: asset.name } } : /* i18n */ { id: 'web.forms.AssetUnitField.state.3', message: "이름 연결을 해제했습니다. 자산은 그대로입니다." });
    } catch (error) {
      if (mounted.current && sameRequestScope(origin, current.current)) setActionError(error instanceof Error ? { cause: error } : /* i18n */ { id: 'web.forms.AssetUnitField.state.4', message: "이름 연결을 저장하지 못했습니다. 입력은 그대로 유지합니다." });
    } finally { if (mounted.current) setBusy(false); }
  }
  return <div className="asset-unit-control" ref={root}>
    <Field {...props} value={binding && !editing ? binding.name : value} list={listId} maxLength={32} autoComplete="off" spellCheck={false} className={`asset-unit-field ${props.className ?? ''}`} hint={hint ?? (selected?.kind === 'currency' ? selected.label : _(/* i18n */ { id: 'web.forms.AssetUnitField.1', message: "목록에서 선택하거나 직접 입력" }))} onFocus={(event) => { setEditing(true); onFocus?.(event); }} onBlur={(event) => { setEditing(false); onCommit([value]); onBlur?.(event); }} />
    <datalist id={listId}>{options.map((option) => <option key={option.value} value={option.value} label={metadata?.bindings.get(option.value)?.name ?? option.label}>{metadata?.bindings.get(option.value)?.name ?? option.label}</option>)}</datalist>
    <div className="asset-unit-actions"><Button variant="quiet" disabled={props.disabled || props.readOnly} aria-expanded={open} aria-controls={panelId} onClick={() => { if (!open) setQuery(binding?.name ?? value); setOpen(!open); }}>{_(/* i18n */ { id: 'web.forms.AssetUnitField.2', message: "종목·통화 검색" })}</Button>{binding && <Button variant="quiet" disabled={busy || props.disabled || props.readOnly} onClick={() => void link(null)}>{_(/* i18n */ { id: 'web.forms.AssetUnitField.3', message: "이름 연결 해제" })}</Button>}</div>
    {binding && <p className="asset-unit-linked"><AssetIcon commodity={value} asset={binding} />{binding.name} · {binding.exchange ?? binding.kind} · {binding.source}</p>}
    {(binding || open) && <p className="field__hint">{_(/* i18n */ { id: 'web.forms.AssetUnitField.4', message: "이름 연결과 해제는 현재 원장 전체에 적용됩니다. 같은 단위 문자열의 잔액·거래 내역·시세에 함께 표시됩니다." })}</p>}
    {metadata?.error && <p className="field__hint">{_(/* i18n */ { id: 'web.forms.AssetUnitField.5', message: "이름 연결 조회: " })}{metadata.error}{_(/* i18n */ { id: 'web.forms.AssetUnitField.6', message: " 자산은 직접 입력할 수 있습니다." })}</p>}
    {actionError && <p className="field__error" role="alert">{typeof actionError === 'string' ? actionError : 'cause' in actionError ? translateError(actionError.cause) : _(actionError)}</p>}
    {notice && <p className="asset-search-notice" role="status">{typeof notice === 'string' ? notice : _(notice)}</p>}
    {open && <section className="asset-search" id={panelId} aria-label={_(/* i18n */ { id: 'web.forms.AssetUnitField.7', message: "{v0} 종목·통화 검색", values: { v0: props.label } })} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); } }}>
      <Field label={_(/* i18n */ { id: 'web.forms.AssetUnitField.8', message: "종목 이름·코드·거래소" })} value={query} type="search" maxLength={200} onChange={(event) => setQuery(event.target.value)} placeholder={_(/* i18n */ { id: 'web.forms.AssetUnitField.9', message: "예: 삼성전자, AAPL, Apple" })} autoComplete="off" />
      <p className="field__hint">{_(/* i18n */ { id: 'web.forms.AssetUnitField.10', message: "검색과 직접 입력만으로는 이름이 연결되지 않습니다. “사용 + 이름 연결”은 현재 입력 중인 자산을 선택한 종목의 고유 자산으로 바꿉니다. “현재 자산에 연결”은 입력을 그대로 둡니다. 두 이름 연결 모두 현재 원장 전체의 같은 단위 표시에 적용되며, 원장에 기록된 금액과 단위는 바뀌지 않습니다." })}</p>
      <div className="asset-search-status" role="status">{loading ? _(/* i18n */ { id: 'web.forms.AssetUnitField.11', message: "종목과 통화를 검색하고 있습니다…" }) : !client ? _(/* i18n */ { id: 'web.forms.AssetUnitField.12', message: "원장에 연결하면 종목을 검색하고 이름을 연결할 수 있습니다." }) : available?.error ? _(/* i18n */ { id: 'web.forms.AssetUnitField.13', message: "검색을 완료하지 못했습니다: {v0} 직접 입력은 계속 사용할 수 있습니다.", values: { v0: typeof available.error === 'string' ? available.error : 'cause' in available.error ? translateError(available.error.cause) : _(available.error) } }) : !available?.result?.items.length ? _(/* i18n */ { id: 'web.forms.AssetUnitField.14', message: "일치하는 종목이 없습니다. {unavailable, select, yes {일부 출처를 사용할 수 없습니다. } other {}}자산을 직접 입력할 수 있습니다.", values: { unavailable: available?.result?.providers.some((provider) => provider.status === 'UNAVAILABLE' || provider.status === 'UNCONFIGURED') ? 'yes' : 'no' } }) : _(/* i18n */ { id: 'web.forms.AssetUnitField.15', message: "검색 결과 {v0}개", values: { v0: available.result.items.length } })}</div>
      {Boolean(available?.result?.providers.length) && <details className="asset-source-details"><summary>{_(/* i18n */ { id: 'web.forms.AssetUnitField.16', message: "데이터 출처·상태" })}</summary>{available?.result?.providers.map((provider) => <p key={provider.provider} className="asset-provider-status"><strong>{providerNames[provider.provider] ? _(providerNames[provider.provider]) : provider.provider}</strong> · {{ READY: _(/* i18n */ { id: 'web.forms.AssetUnitField.17', message: "사용 가능" }), STALE: _(/* i18n */ { id: 'web.forms.AssetUnitField.18', message: "갱신 지연" }), UNAVAILABLE: _(/* i18n */ { id: 'web.forms.AssetUnitField.19', message: "조회 불가" }), UNCONFIGURED: _(/* i18n */ { id: 'web.forms.AssetUnitField.20', message: "미설정" }) }[provider.status]}{provider.message ? ` · ${provider.message}` : ''}{provider.updatedAt ? _(/* i18n */ { id: 'web.forms.AssetUnitField.21', message: " · 기준 {v0}", values: { v0: provider.updatedAt } }) : ''}</p>)}</details>}
      <ul className="asset-search-results">{available?.result?.items.map((asset) => <li key={asset.id}>
        <div className="asset-search-result"><AssetIcon commodity={asset.symbol} asset={asset} /><div><strong>{asset.name}</strong><span>{asset.symbol} · {asset.exchange ?? ({ CURRENCY: _(/* i18n */ { id: 'web.forms.AssetUnitField.22', message: "통화" }), STOCK: _(/* i18n */ { id: 'web.forms.AssetUnitField.23', message: "주식" }), CRYPTO: _(/* i18n */ { id: 'web.forms.AssetUnitField.24', message: "암호자산" }) }[asset.kind])} · {asset.source}</span>{asset.isin && <small>ISIN {asset.isin}</small>}{asset.asOf && <small>{_(/* i18n */ { id: 'web.forms.AssetUnitField.25', message: "기준 " })}{asset.asOf}</small>}{/^https?:\/\//.test(asset.sourceUrl) && <a href={asset.sourceUrl} target="_blank" rel="noreferrer">{_(/* i18n */ { id: 'web.forms.AssetUnitField.26', message: "자료 출처" })}</a>}</div></div>
        <div className="asset-search-result__actions"><Button variant="secondary" disabled={busy || props.disabled || props.readOnly || !validChoice(ledgerCommodity(asset))} onClick={() => void link(asset, true)}>{_(/* i18n */ { id: 'asset.binding.useAndLink', message: "{name} 사용 + 이름 연결", values: { name: asset.name } })}</Button>{validChoice(value) && value !== ledgerCommodity(asset) && <Button variant="quiet" disabled={busy || props.disabled || props.readOnly} onClick={() => void link(asset)}>{_(/* i18n */ { id: 'asset.binding.linkCurrent', message: "현재 자산 “{commodity}”에 연결", values: { commodity: value } })}</Button>}</div>
      </li>)}{localOptions.map((option) => <li key={`local-${option.value}`}><div className="asset-search-result"><AssetIcon commodity={option.value} /><div><strong>{metadata?.bindings.get(option.value)?.name ?? option.label}</strong><span>{option.kind === 'currency' ? _(/* i18n */ { id: 'web.forms.AssetUnitField.30', message: "기본 ISO 통화" }) : _(/* i18n */ { id: 'web.forms.AssetUnitField.31', message: "원장·이전에 입력한 단위" })}{_(/* i18n */ { id: 'web.forms.AssetUnitField.32', message: " · 직접 입력 제안" })}</span></div></div><Button variant="quiet" disabled={busy || props.disabled || props.readOnly} onClick={() => { if (!disabled()) { onValueChange(option.value); onCommit([option.value]); } }}>{_(/* i18n */ { id: 'asset.search.enterChoice', message: "{name} 입력", values: { name: metadata?.bindings.get(option.value)?.name ?? option.value } })}</Button></li>)}</ul>
      <Button variant="quiet" onClick={() => setOpen(false)}>{_(/* i18n */ { id: 'web.forms.AssetUnitField.34', message: "검색 닫기" })}</Button>
    </section>}
  </div>;
}
