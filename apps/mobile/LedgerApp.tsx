import { i18n, formatOutboxMessage, formatStorageMessage } from '../../packages/i18n/src';
import { translateError, type AppLocale } from '../../packages/i18n/src';
import { useLingui } from '../../packages/i18n/src/react';
import type { createLocalePreference } from './locale';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { randomUUID } from 'expo-crypto';
import {
  addDecimals, createLedgerClient, newIdempotencyKey, previousDate,
  type AccountsQuery, type AccountsQueryVariables, type AccountTransactionsQuery,
  type AccountTransactionsQueryVariables, type CreateTransactionInput, type HealthQuery,
  type PricesQuery, type PricesQueryVariables, type TransactionsQuery, type TransactionsQueryVariables,
  type TransactionFieldsFragment,
} from '../../packages/client';
import { createOutbox, type OutboxRecord, type OutboxTemplate } from '../../packages/client/outbox';
import { tokens } from '../../packages/design-tokens/src';
import { type GalleryTransaction } from '../../packages/domain/src';
import type { AssetBinding } from '../../packages/domain/src/asset-catalog';
import { AccountRow, AssetIdentity, AssetMetadataProvider, Badge, Button, Field, Heading, Money, Notice, Panel, PostingRow, TransactionRow, nativeStyles as textStyles } from '../../packages/ui-native/src';
import { createDurableStorage } from './storage';
import { arePostingsBalanced } from '../../packages/domain/src/trade';
import { TradeFields, newTradeInput } from './TradeFields';
import { AssetUnitField } from './AssetUnitField';
import { BookModuleView, BookRecovery, useBookController, useBooksFeature } from './book-module';


type TabScreen = 'accounts' | 'transactions' | 'entry' | 'prices' | 'books' | 'sync';
type Screen = TabScreen | 'settings';
type AccountConnection = NonNullable<AccountsQuery['accounts']>;
type Account = AccountConnection['edges'][number]['node'];
type AccountDetail = NonNullable<AccountTransactionsQuery['account']>;
type TransactionConnection = NonNullable<TransactionsQuery['transactions']>;
type PriceConnection = NonNullable<PricesQuery['prices']>;
type Draft = Omit<CreateTransactionInput, 'postings' | 'tags'> & {
  postings: { accountName: string; amount: { commodity: string; value: string }; memo?: string | null; cost?: CreateTransactionInput['postings'][number]['cost'] }[];
  tags: { key: string; value: string }[];
};
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const freshKey = () => newIdempotencyKey(randomUUID);
const newDraft = (): Draft => ({ idempotencyKey: freshKey(), date: today(), description: '', code: '', clientReference: '',
  postings: [{ accountName: '', amount: { commodity: 'KRW', value: '' }, memo: '' }, { accountName: '', amount: { commodity: 'KRW', value: '' }, memo: '' }], tags: [] });
const queueMessages = { queued: (/* i18n */ { id: 'native.ledgerapp.queue.queued', message: "기기에 저장 · 전송 대기" }), sending: (/* i18n */ { id: 'native.ledgerapp.queue.sending', message: "전송 중 · 결과 대기" }), succeeded: (/* i18n */ { id: 'native.ledgerapp.queue.succeeded', message: "원장 저장 확인" }), blocked: (/* i18n */ { id: 'native.ledgerapp.queue.blocked', message: "전송 중단 · 수정 또는 인증 필요" }), needsReview: (/* i18n */ { id: 'native.ledgerapp.queue.needsReview', message: "확인 필요 · 저장 결과 불명확" }) };
class LocalizedError extends Error { constructor(readonly descriptor: { id: string; message?: string }) { super(descriptor.id); } }
type LocalMessage = string | Error | { state: OutboxRecord['state'] } | { id: string; message?: string; values?: Record<string, unknown> };
const renderMessage = (value: unknown): string => ( value instanceof LocalizedError ? i18n._(value.descriptor) : value && typeof value === 'object' && 'state' in value ? i18n._(queueMessages[value.state as OutboxRecord['state']]) : value && typeof value === 'object' && 'id' in value ? i18n._(value as { id: string; message?: string }) : typeof value === 'string' ? formatStorageMessage(value) : translateError(value));
const explain = (cause: unknown): LocalMessage => cause instanceof Error ? cause : translateError(cause);
const graphErrors = (errors?: { message: string; extensions?: Record<string, unknown> }[]) => errors?.map(error => `${error.extensions?.code ? `${error.extensions.code}: ` : ''}${error.message}`).join('\n') ?? '';
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).valueOf()) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const galleryTransaction = (transaction: TransactionFieldsFragment): GalleryTransaction => ({ ...transaction, createdAt: null,
  status: transaction.status.toLowerCase() as GalleryTransaction['status'], source: transaction.source.toLowerCase() as GalleryTransaction['source'],
  code: transaction.code ?? null, postings: transaction.postings.map(posting => ({ ...posting, accountId: posting.accountId ?? null, memo: posting.memo ?? null })) });

function checkDraft(draft: Draft): string[] {
  const errors: string[] = [];
  if (!validDate(draft.date)) errors.push(i18n._(/* i18n */ { id: 'native.ledgerapp.validation.date', message: "거래일: 실제 날짜를 YYYY-MM-DD 형식으로 입력해 주세요." }));
  if (!draft.description.trim() || draft.description.length > 512) errors.push(i18n._(/* i18n */ { id: 'native.ledgerapp.validation.description', message: "내용: 1~512자로 입력해 주세요." }));
  if ((draft.code?.length ?? 0) > 64) errors.push(i18n._(/* i18n */ { id: 'native.ledgerapp.validation.reference', message: "참고 번호: 64자 이하로 입력해 주세요." }));
  if ((draft.clientReference?.length ?? 0) > 128) errors.push(i18n._(/* i18n */ { id: 'native.ledgerapp.validation.clientReference', message: "연동 참조: 128자 이하로 입력해 주세요." }));
  if (draft.postings.length < 2) errors.push(i18n._(/* i18n */ { id: 'native.ledgerapp.validation.minimumPostings', message: "항목별 내역은 최소 두 개가 필요합니다." }));

  for (const [index, posting] of draft.postings.entries()) {
    if (!posting.accountName.trim()) errors.push(i18n._(/* i18n */ { id: 'native.ledgerapp.validation.accountRequired', message: "내역 {value0}: 항목 경로가 필요합니다.", values: { value0: index + 1 } }));
    if (!posting.amount.commodity.trim() || posting.amount.commodity.length > 32) errors.push(i18n._(/* i18n */ { id: 'native.ledgerapp.validation.commodity', message: "내역 {value0}: 자산을 1~32자로 입력해 주세요.", values: { value0: index + 1 } }));
    if (posting.cost && (!posting.cost.amount.commodity.trim() || posting.cost.amount.commodity.length > 32)) errors.push(i18n._(/* i18n */ { id: 'native.ledgerapp.validation.costCommodity', message: "내역 {value0}: 원가 자산을 확인해 주세요.", values: { value0: index + 1 } }));
    if ((posting.memo?.length ?? 0) > 1000) errors.push(i18n._(/* i18n */ { id: 'native.ledgerapp.validation.memo', message: "내역 {value0}: 메모는 1000자 이하입니다.", values: { value0: index + 1 } }));
  }
  try { if (!arePostingsBalanced(draft.postings)) errors.push(i18n._(/* i18n */ { id: 'native.ledgerapp.validation.balance', message: "원가를 반영한 자산별 합계를 0으로 맞춰 주세요." })); } catch { errors.push(i18n._(/* i18n */ { id: 'native.ledgerapp.validation.decimal', message: "금액·수량은 정확한 소수, 원가는 양수로 입력해 주세요." })); }
  if (new Set(draft.tags.map(tag => tag.key)).size !== draft.tags.length) errors.push(i18n._(/* i18n */ { id: 'native.ledgerapp.validation.duplicateTags', message: "태그 키가 중복되었습니다." }));
  return errors;
}


/** An uncertain write can only be resolved with its original key, including through templates. */
export function blocksFreshRequest(records: readonly OutboxRecord[], selectedId: string | null, input?: Omit<CreateTransactionInput, 'idempotencyKey'>): boolean {
  const uncertain = records.filter(record => record.state === 'needsReview' || record.state === 'sending');
  if (selectedId && uncertain.some(record => record.id === selectedId)) return true;
  if (!input) return false;
  const fingerprint = (value: Omit<CreateTransactionInput, 'idempotencyKey'>) => JSON.stringify({
    date: value.date, description: value.description, code: value.code ?? '', clientReference: value.clientReference ?? '',
    postings: value.postings.map(posting => ({ accountName: posting.accountName, amount: { commodity: posting.amount.commodity, value: posting.amount.value }, cost: posting.cost ?? null, memo: posting.memo ?? '' })),
    tags: [...(value.tags ?? [])].map(tag => ({ key: tag.key, value: tag.value })).sort((left, right) => left.key.localeCompare(right.key)),
  });
  const candidate = fingerprint(input);
  return uncertain.some(record => fingerprint(record.input) === candidate);
}

/** Retains failure semantics so an already visible notice follows the active language. */
class ConnectionAttemptError extends Error {
  constructor(readonly originalCause: unknown, readonly hadVerifiedConnection: boolean) {
    super('Connection attempt failed');
  }
}

export default function LedgerApp({ onOpenGallery, localePreference }: { onOpenGallery?: () => void; localePreference: ReturnType<typeof createLocalePreference> }) {
  const { _, i18n } = useLingui();
  const [localeError, setLocaleError] = useState(false);
  const selectLocale = (locale: AppLocale) => { setLocaleError(false); void localePreference.select(locale).catch(() => setLocaleError(true)); };

  const tabs: [TabScreen, string][] = [['accounts', _(/* i18n */ { id: 'nav.accounts', message: '항목' })],['transactions', _(/* i18n */ { id: 'nav.transactions', message: '거래' })],['entry', _(/* i18n */ { id: 'nav.entry', message: '입력' })],['prices', _(/* i18n */ { id: 'nav.prices', message: '시세' })],['books', _(/* i18n */ { id: 'nav.books', message: '책' })],['sync', _(/* i18n */ { id: 'nav.sync', message: '동기화' })]];
  const titles: Record<Screen, string> = {accounts: _(/* i18n */ { id: 'title.accounts', message: '내 항목' }),transactions: _(/* i18n */ { id: 'title.transactions', message: '거래 기록' }),entry: _(/* i18n */ { id: 'title.entry', message: '새 거래' }),prices: _(/* i18n */ { id: 'title.prices', message: '시세' }),books: _(/* i18n */ { id: 'title.books', message: '내 책' }),sync: _(/* i18n */ { id: 'title.sync', message: '동기화' }),settings: _(/* i18n */ { id: 'title.settings', message: '설정' })};
  const [screen, setScreen] = useState<Screen>('accounts');
  const [screenBeforeSettings, setScreenBeforeSettings] = useState<TabScreen>('accounts');
  const [connection, setConnection] = useState({ endpoint: 'http://localhost:4000/graphql', token: '', ledgerId: undefined as string | undefined, verified: false });
  const [endpoint, setEndpoint] = useState(connection.endpoint);
  const [token, setToken] = useState('');
  const [settingsReady, setSettingsReady] = useState(false);
  const [storageWarning, setStorageWarning] = useState<LocalMessage>('');
  const [storageError, setStorageError] = useState<LocalMessage>('');
  const [notice, setNotice] = useState<LocalMessage>('');
  const [error, setError] = useState<unknown>('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<HealthQuery['health']>(null);
  const [healthError, setHealthError] = useState<unknown>('');
  const [queue, setQueue] = useState<OutboxRecord[]>([]);
  const [templates, setTemplates] = useState<OutboxTemplate[]>([]);
  const [queueReady, setQueueReady] = useState(false);
  const settings = useMemo(() => createDurableStorage('connection-v1', setStorageWarning), []);
  const storage = useMemo(() => createDurableStorage('outbox-v1', setStorageWarning), []);
  const assetUnitStorage = useMemo(() => createDurableStorage('asset-units-v1', () => setStorageWarning((/* i18n */ { id: 'native.ledgerapp.assetHistory.recovered', message: "자산 제안의 마지막 정상 저장 사본을 복구했습니다." }))), []);
  const assetUnitHistory = useRef<Record<string, string[]> | null>(null);
  const assetUnitHydration = useRef<Promise<void>>(Promise.resolve());
  const [rememberedAssetUnits, setRememberedAssetUnits] = useState<Record<string, string[]>>({});
  const client = useMemo(() => createLedgerClient(connection), [connection]);
  const booksCapability = useBooksFeature(client, connection.verified, connection.ledgerId);
  const bookController = useBookController({ client, verified: connection.verified, active: screen === 'books' && booksCapability.feature?.enabled === true, feature: booksCapability.feature, refreshFeature: booksCapability.refresh });
  const [assetMetadata, setAssetMetadata] = useState<{ identity: string; bindings: AssetBinding[] }>({ identity: '', bindings: [] });
  const [assetMetadataError, setAssetMetadataError] = useState<LocalMessage>('');
  const [assetMetadataReload, setAssetMetadataReload] = useState(0);
  const assetMetadataOverrides = useRef(new Map<string, AssetBinding | null>());
  const assetBindingPending = useRef(false);
  const activeClient = useRef(client);
  activeClient.current = client;
  const outbox = useMemo(() => createOutbox(storage, client), [storage, client]);
  const request = useRef(0);
  const healthRequest = useRef(0);
  const scrollView = useRef<ComponentRef<typeof ScrollView>>(null);
  const [accounts, setAccounts] = useState<AccountConnection | null>(null);
  const [accountScope, setAccountScope] = useState<AccountsQueryVariables>({});
  const [accountFiltersOpen, setAccountFiltersOpen] = useState(false);
  const [transactionFiltersOpen, setTransactionFiltersOpen] = useState(false);
  const [accountQuery, setAccountQuery] = useState('');
  const [depth, setDepth] = useState('');
  const [includeEmpty, setIncludeEmpty] = useState(true);
  const [includeSubaccounts, setIncludeSubaccounts] = useState(false);
  const [from, setFrom] = useState(`${today().slice(0, 7)}-01`);
  const [to, setTo] = useState(today());
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [accountDetail, setAccountDetail] = useState<AccountDetail | null>(null);
  const [detailScope, setDetailScope] = useState<AccountTransactionsQueryVariables | null>(null);
  const [transactions, setTransactions] = useState<TransactionConnection | null>(null);
  const [transactionScope, setTransactionScope] = useState<TransactionsQueryVariables>({});
  const [query, setQuery] = useState('');
  const [transactionFrom, setTransactionFrom] = useState('');
  const [transactionTo, setTransactionTo] = useState('');
  const [filterAccount, setFilterAccount] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [filterTagValue, setFilterTagValue] = useState('');
  const [transactionCommodity, setTransactionCommodity] = useState('');
  const [transactionSubaccounts, setTransactionSubaccounts] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionFieldsFragment | null>(null);
  const [recent, setRecent] = useState<TransactionFieldsFragment[]>([]);
  const [prices, setPrices] = useState<PriceConnection | null>(null);
  const [priceScope, setPriceScope] = useState<PricesQueryVariables>({});
  const [priceCommodity, setPriceCommodity] = useState('');
  const [quoteCommodity, setQuoteCommodity] = useState('');
  const [priceFrom, setPriceFrom] = useState('');
  const [priceTo, setPriceTo] = useState('');
  const [draft, setDraft] = useState<Draft>(newDraft);
  const [tradeInput, setTradeInput] = useState(newTradeInput);
  const [tradeError, setTradeError] = useState<unknown>('');
  const [entryMode, setEntryMode] = useState<'general' | 'trade'>('general');
  const [draftLedger, setDraftLedger] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const draftErrors = checkDraft(draft);
  const locked = submittedId !== null;
  const draftMismatch = draftLedger !== null && draftLedger !== client.identity;
  const freshRequestBlocked = blocksFreshRequest(queue, submittedId, draft);
  const draftGuard = useRef({ locked, busy, draftMismatch, freshRequestBlocked });
  draftGuard.current = { locked, busy, draftMismatch, freshRequestBlocked };
  const assetUnitValues = useMemo(() => [
    ...(rememberedAssetUnits[client.identity] ?? []),
    ...(accounts?.edges.flatMap(({ node }) => node.balances.map(amount => amount.commodity)) ?? []),
    ...(accountDetail ? [...accountDetail.opening, ...accountDetail.movements].map(amount => amount.commodity) : []),
    ...[...(transactions?.edges.map(({ node }) => node) ?? []), ...(accountDetail?.transactions?.edges.map(({ node }) => node) ?? []),
      ...recent, ...(selectedTransaction ? [selectedTransaction] : [])].flatMap(transaction => transaction.postings.map(posting => posting.amount.commodity)),
    ...(prices?.edges.flatMap(({ node }) => [node.commodity, node.quoteCommodity]) ?? []),
    ...queue.filter(record => record.endpoint === client.identity).flatMap(record => record.input.postings.map(posting => posting.amount.commodity)),
    ...templates.flatMap(template => template.input.postings.map(posting => posting.amount.commodity)),
  ], [rememberedAssetUnits, client.identity, accounts, accountDetail, transactions, recent, selectedTransaction, prices, queue, templates]);

  // Only explicit completion, selection, lookup or saving records a unit, never a keystroke.
  async function rememberAssetUnits(values: readonly string[]) {
    if (!connection.ledgerId) return;
    const identity = client.identity;
    await assetUnitHydration.current;
    if (!assetUnitHistory.current) return;
    const completed = values.filter(value => value.trim().length > 0 && value.length <= 32);
    const previous = assetUnitHistory.current[identity] ?? [];
    const next = [...new Set([...completed, ...previous])].slice(0, 100);
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    const history = { ...assetUnitHistory.current, [identity]: next };
    assetUnitHistory.current = history;
    setRememberedAssetUnits(history);
    try { await assetUnitStorage.save(JSON.stringify({ version: 1, scopes: history })); }
    catch { setStorageWarning((/* i18n */ { id: 'native.ledgerapp.assetHistory.saveFailed', message: "자산 제안을 기기에 기억하지 못했습니다. 입력과 거래 저장은 계속 사용할 수 있습니다." })); }
  }
  const rememberAssetUnit = (value: string) => { void rememberAssetUnits([value]); };
  function openSettings() {
    if (busy || screen === 'settings') return;
    setScreenBeforeSettings(screen); setScreen('settings');
  }
  function closeSettings() { if (!busy) setScreen(screenBeforeSettings); }
  useEffect(() => {
    if (screen !== 'settings') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!busy) setScreen(screenBeforeSettings);
      return true;
    });
    return () => subscription.remove();
  }, [screen, screenBeforeSettings, busy]);
  useEffect(() => {
    if (connection.ledgerId) setDraftLedger(current => current ?? client.identity);
  }, [client.identity, connection.ledgerId]);
  useEffect(() => {
    let active = true;
    assetMetadataOverrides.current = new Map();
    setAssetMetadata({ identity: client.identity, bindings: [] }); setAssetMetadataError('');
    if (!connection.verified) return;
    void client.assetBindings().then(response => {
      if (!active || activeClient.current !== client) return;
      if (response.errors?.length || !response.data?.assetBindings) throw (graphErrors(response.errors) ? new Error(graphErrors(response.errors)) : new LocalizedError(/* i18n */ { id: 'native.ledgerapp.assetMetadata.missing', message: "자산 표시 정보를 받지 못했습니다." }));
      const overrides = assetMetadataOverrides.current;
      setAssetMetadata({ identity: client.identity, bindings: [
        ...response.data.assetBindings.filter(binding => !overrides.has(binding.commodity)),
        ...[...overrides.values()].filter((binding): binding is AssetBinding => binding !== null),
      ] });
    }).catch(cause => { if (active && activeClient.current === client) setAssetMetadataError(explain(cause)); });
    return () => { active = false; };
  }, [client, connection.verified, assetMetadataReload]);
  useEffect(() => { scrollView.current?.scrollTo({ y: 0, animated: false }); }, [screen]);

  async function bindAsset(commodity: string, assetId: string | null) {
    const bindingClient = client;
    if (!connection.verified || activeClient.current !== bindingClient) throw new LocalizedError(/* i18n */ { id: 'native.ledgerapp.connection.verify', message: "설정에서 원장 연결을 확인해 주세요." });
    if (draftGuard.current.busy || assetBindingPending.current) throw new LocalizedError(/* i18n */ { id: 'native.ledgerapp.assetBinding.busy', message: "진행 중인 요청이 끝난 후 다시 선택해 주세요." });
    assetBindingPending.current = true;
    try {
      const response = await bindingClient.setAssetBinding({ commodity, assetId });
      if (activeClient.current !== bindingClient) throw new LocalizedError(/* i18n */ { id: 'native.ledgerapp.assetBinding.connectionChanged', message: "원장 연결이 변경되었습니다. 현재 원장에서 다시 선택해 주세요." });
      const payload = response.data?.setAssetBinding;
      if (response.errors?.length || !payload || payload.commodity !== commodity || (assetId !== null && (payload.binding?.asset.id !== assetId || payload.binding.commodity !== commodity))
        || (assetId === null && payload.binding !== null)) throw (graphErrors(response.errors) ? new Error(graphErrors(response.errors)) : new LocalizedError(/* i18n */ { id: 'native.ledgerapp.assetBinding.unconfirmed', message: "표시 정보 저장을 확인하지 못했습니다." }));
      assetMetadataOverrides.current.set(commodity, payload.binding);
      setAssetMetadata(current => ({ identity: bindingClient.identity,
        bindings: [...(current.identity === bindingClient.identity ? current.bindings : []).filter(binding => binding.commodity !== commodity),
          ...(payload.binding ? [payload.binding] : [])] }));
    } finally { assetBindingPending.current = false; }
  }

  useEffect(() => {
    let active = true;
    assetUnitHydration.current = assetUnitStorage.load().then(raw => {
      let scopes: Record<string, string[]> = {};
      if (raw) {
        const saved = JSON.parse(raw) as { version?: unknown; scopes?: unknown };
        if (saved.version !== 1 || !saved.scopes || typeof saved.scopes !== 'object' || Array.isArray(saved.scopes)
          || !Object.values(saved.scopes).every(values => Array.isArray(values) && values.every(value => typeof value === 'string' && value.trim().length > 0 && value.length <= 32))) {
          throw new Error('Invalid asset unit history.');
        }
        scopes = saved.scopes as Record<string, string[]>;
      }
      assetUnitHistory.current = scopes;
      if (active) setRememberedAssetUnits(scopes);
    }).catch(() => { if (active) setStorageWarning((/* i18n */ { id: 'native.ledgerapp.assetHistory.loadFailed', message: "기억한 자산 제안을 읽지 못했습니다. 저장된 사본을 보존하고 기본 목록과 원장 제안을 사용합니다." })); });
    return () => { active = false; };
  }, [assetUnitStorage]);

  useEffect(() => {
    let active = true;
    settings.load().then(raw => {
      if (!raw || !active) return;
      const saved = JSON.parse(raw) as { endpoint: unknown; ledgerId?: unknown };
      if (typeof saved.endpoint !== 'string') throw new LocalizedError(/* i18n */ { id: 'native.ledgerapp.connection.invalidStorage', message: "연결 설정 형식을 읽을 수 없습니다." });
      const url = validateEndpoint(saved.endpoint);
      setEndpoint(url); setConnection({ endpoint: url, token: '', ledgerId: typeof saved.ledgerId === 'string' ? saved.ledgerId : undefined, verified: false });
    }).catch(cause => { if (active) setStorageWarning(explain(cause)); }).finally(() => { if (active) setSettingsReady(true); });
    return () => { active = false; };
  }, [settings]);

  useEffect(() => {
    if (!settingsReady) return;
    let active = true;
    setQueueReady(false); setStorageError('');
    outbox.hydrate().then(records => {
      if (active) { setQueue(records); setTemplates(outbox.listTemplates()); setQueueReady(true); }
    }).catch(cause => { if (active) setStorageError(explain(cause)); });
    return () => { active = false; };
  }, [outbox, settingsReady]);

  useEffect(() => {
    if (!settingsReady) return;
    request.current += 1; healthRequest.current += 1;
    setError(''); setNotice(''); setLoading(false);
    if (!connection.verified) { setLoading(false); if (screen === 'settings') void loadHealth(); return; }
    if (screen === 'accounts') void loadAccounts();
    if (screen === 'transactions') void loadTransactions();
    if (screen === 'prices') void loadPrices();
    if (screen === 'entry') void loadRecent();
    if (screen === 'settings') void loadHealth();
    return () => { request.current += 1; };
  }, [screen, client, settingsReady]);

  function validateEndpoint(value: string): string {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new LocalizedError(/* i18n */ { id: 'native.ledgerapp.connection.invalidUrl', message: "사용자 정보, 쿼리, # 없이 HTTP 또는 HTTPS 주소를 입력해 주세요." });
    }
    return url.toString();
  }
  async function applyConnection() {
    if (busy || !settingsReady) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const validated = validateEndpoint(endpoint);
      const handshake = await createLedgerClient({ endpoint: validated, token }).health();
      const ledgerId = handshake.data?.health?.details?.ledgerId;
      if (typeof ledgerId !== 'string' || !ledgerId) throw (graphErrors(handshake.errors) ? new Error(graphErrors(handshake.errors)) : new LocalizedError(/* i18n */ { id: 'native.ledgerapp.connection.missingIdentity', message: "인증된 원장 식별자를 확인하지 못했습니다. 주소와 인증 토큰을 확인해 주세요." }));
      await settings.save(JSON.stringify({ endpoint: validated, ledgerId }));
      setHealth(handshake.data?.health ?? null);
      setSelectedAccount(null); setAccountDetail(null); setSelectedTransaction(null); setAccounts(null); setTransactions(null); setPrices(null); setRecent([]);
      setConnection({ endpoint: validated, token, ledgerId, verified: true });
      setNotice(/* i18n */ { id: 'connection.applied', message: '연결 설정을 적용했습니다. 인증 토큰은 이 앱 실행 중에만 보관합니다.' });
    } catch (cause) { setError(new ConnectionAttemptError(cause, connection.verified)); }
    finally { setBusy(false); }
  }
  async function read<T>(work: () => Promise<{ data?: T | null; errors?: { message: string; extensions?: Record<string, unknown> }[] }>, apply: (data: T) => void) {
    if (!connection.verified) { setError(/* i18n */ { id: 'connection.verify', message: '설정 화면에서 주소와 인증 토큰을 적용해 원장을 확인해 주세요.' }); return; }
    const id = ++request.current;
    setLoading(true); setError('');
    try {
      const response = await work();
      if (id !== request.current) return;
      if (response.data) apply(response.data);
      const failures = graphErrors(response.errors);
      if (failures) setError(failures);
      else if (!response.data) setError((/* i18n */ { id: 'native.ledgerapp.query.missingData', message: "서버가 조회 자료를 반환하지 않았습니다." }));
    } catch (cause) { if (id === request.current) setError(cause); }
    finally { if (id === request.current) setLoading(false); }
  }
  async function loadAccounts(after?: string, scope?: AccountsQueryVariables) {
    let variables: AccountsQueryVariables;
    try {
      if (!after && ((!validDate(to)) || (from && (!validDate(from) || from > to)))) throw new LocalizedError(/* i18n */ { id: 'native.ledgerapp.validation.period', message: "기간을 실제 날짜로 입력하고 시작일을 종료일 이전으로 지정해 주세요." });
      if (depth && !/^(?:[1-9]|10)$/.test(depth)) throw new LocalizedError(/* i18n */ { id: 'native.ledgerapp.validation.depth', message: "계층 깊이는 1~10 또는 빈칸입니다." });
      variables = after ? { ...accountScope, after } : scope ?? { first: 30, asOf: to, includeSubaccounts,
        filter: { includeEmpty, ...(accountQuery.trim() ? { query: accountQuery.trim() } : {}), ...(depth ? { depth: Number(depth) } : {}) } };
    } catch (cause) { setError(cause); return; }
    await read(() => client.accounts(variables), data => {
      setAccountScope(variables);
      setAccounts(data.accounts ? after && accounts ? { ...data.accounts, edges: [...accounts.edges, ...data.accounts.edges] } : data.accounts : null);
      if (!after) { setSelectedAccount(null); setAccountDetail(null); setAccountFiltersOpen(false); }
    });
  }
  async function loadAccountDetail(account: Account, after?: string) {
    let variables: AccountTransactionsQueryVariables;
    try {
      if (!validDate(from) || !validDate(to) || from > to) throw new LocalizedError(/* i18n */ { id: 'native.ledgerapp.validation.detailPeriod', message: "유효한 시작일과 종료일을 입력해 주세요." });
      variables = after && detailScope ? { ...detailScope, after } : { id: account.id, first: 20, from, to, asOf: from === '0001-01-01' ? undefined : previousDate(from), includeSubaccounts,
        filter: { from, to, includeSubaccounts } };
    } catch (cause) { setError(cause); return; }
    setSelectedAccount(account);
    if (!after) setAccountDetail(null);
    await read(() => client.accountTransactions(variables), data => {
      setDetailScope(variables);
      const detail = data.account;
      if (!detail) { setAccountDetail(null); setError((/* i18n */ { id: 'native.ledgerapp.accounts.missing', message: "항목을 찾을 수 없습니다. 목록을 새로 불러와 주세요." })); return; }
      const normalized = variables.from === '0001-01-01' ? { ...detail, opening: detail.opening.map(amount => ({ ...amount, value: '0' })) } : detail;
      setAccountDetail(after && accountDetail && normalized.transactions && accountDetail.transactions ? {
        ...normalized, transactions: { ...normalized.transactions, edges: [...accountDetail.transactions.edges, ...normalized.transactions.edges] },
      } : normalized);
    });
  }
  async function loadTransactions(after?: string, override?: TransactionsQueryVariables) {
    if (!after && ((transactionFrom && !validDate(transactionFrom)) || (transactionTo && !validDate(transactionTo)) || (transactionFrom && transactionTo && transactionFrom > transactionTo))) {
      setError((/* i18n */ { id: 'native.ledgerapp.validation.transactionPeriod', message: "유효한 거래 기간을 입력해 주세요." })); return;
    }
    const variables: TransactionsQueryVariables = after ? { ...transactionScope, after } : override ?? { first: 20, filter: {
      ...(query.trim() ? { query: query.trim() } : {}), ...(transactionFrom ? { from: transactionFrom } : {}), ...(transactionTo ? { to: transactionTo } : {}),
      ...(filterAccount ? { accountId: filterAccount } : {}), includeSubaccounts: transactionSubaccounts,
      ...(transactionCommodity ? { commodity: transactionCommodity } : {}), ...(filterTag ? { tags: [{ key: filterTag, value: filterTagValue }] } : {}),
    } };
    if (!after) { setTransactions(null); setSelectedTransaction(null); }
    await read(() => client.transactions(variables), data => {
      if (!after && variables.filter?.commodity) rememberAssetUnit(variables.filter.commodity);
      setTransactionScope(variables);
      if (!after) setTransactionFiltersOpen(false);
      setTransactions(data.transactions ? after && transactions ? { ...data.transactions, edges: [...transactions.edges, ...data.transactions.edges] } : data.transactions : null);
    });
  }
  async function loadRecent() {
    await read(() => client.transactions({ first: 5 }), data => setRecent(data.transactions?.edges.map(edge => edge.node) ?? []));
  }
  async function loadPrices(after?: string) {
    if (!after && ((priceFrom && !validDate(priceFrom)) || (priceTo && !validDate(priceTo)) || (priceFrom && priceTo && priceFrom > priceTo))) { setError((/* i18n */ { id: 'native.ledgerapp.validation.pricePeriod', message: "유효한 시세 기간을 입력해 주세요." })); return; }
    const variables: PricesQueryVariables = after ? { ...priceScope, after } : { first: 30, filter: {
      ...(priceCommodity ? { commodity: priceCommodity } : {}), ...(quoteCommodity ? { quoteCommodity } : {}),
      ...(priceFrom ? { from: priceFrom } : {}), ...(priceTo ? { to: priceTo } : {}),
    } };
    if (!after) setPrices(null);
    await read(() => client.prices(variables), data => {
      if (!after) void rememberAssetUnits([variables.filter?.commodity ?? '', variables.filter?.quoteCommodity ?? '']);
      setPriceScope(variables);
      setPrices(data.prices ? after && prices ? { ...data.prices, edges: [...prices.edges, ...data.prices.edges] } : data.prices : null);
    });
  }
  async function loadHealth() {
    void booksCapability.refresh();
    const id = ++healthRequest.current;
    setHealthError('');
    try {
      const result = await client.health();
      if (id !== healthRequest.current) return;
      setHealth(result.data?.health ?? null); setHealthError(graphErrors(result.errors));
    } catch (cause) { if (id === healthRequest.current) { setHealth(null); setHealthError(cause); } }
  }
  function syncQueue() { setQueue(outbox.list()); setTemplates(outbox.listTemplates()); }
  async function queueAction(action: () => Promise<unknown>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (cause) { setError(cause); }
    finally { syncQueue(); setBusy(false); }
  }
  async function save(send: boolean) {
    setAttempted(true);
    if (blocksFreshRequest(outbox.list(), submittedId, draft)) { setError((/* i18n */ { id: 'native.ledgerapp.save.uncertain', message: "저장 결과가 불명확한 요청입니다. 동기화 화면에서 같은 요청 키로 확인·재시도해 주세요." })); return; }
    if (draftErrors.length || !queueReady || !connection.ledgerId || (send && !connection.verified) || locked || draftMismatch) return;
    await queueAction(async () => {
      try {
        const result = await outbox.enqueue(draft, { send });
        void rememberAssetUnits(draft.postings.map(posting => posting.amount.commodity));
        setSubmittedId(result.id);
        setNotice(result.state === 'succeeded' ? (/* i18n */ { id: 'native.ledgerapp.save.confirmed', message: "원장에서 거래 저장을 확인했습니다." }) : (/* i18n */ { id: 'native.ledgerapp.save.queued', message: "거래를 기기에 보관했습니다. 동기화 화면에서 상태를 확인해 주세요." }));
      } finally {
        if (outbox.list().some(record => record.id === draft.idempotencyKey)) setSubmittedId(draft.idempotencyKey);
      }
    });
  }
  function copy(input: Omit<CreateTransactionInput, 'idempotencyKey'>) {
    if (blocksFreshRequest(outbox.list(), submittedId, input)) {
      setError((/* i18n */ { id: 'native.ledgerapp.copy.uncertain', message: "결과 확인 전에는 이 요청을 복사하거나 템플릿으로 새 요청을 만들 수 없습니다. 동기화 화면에서 같은 요청 키로 확인·재시도해 주세요." })); return;
    }
    setEntryMode('general');
    setTradeInput(newTradeInput()); setTradeError('');
    setDraft({ ...input, idempotencyKey: freshKey(), code: input.code ?? '', clientReference: input.clientReference ?? '',
      postings: input.postings.map(posting => ({ ...posting, amount: { ...posting.amount }, cost: posting.cost ? { ...posting.cost, amount: { ...posting.cost.amount } } : posting.cost, memo: posting.memo ?? '' })), tags: input.tags?.map(tag => ({ ...tag })) ?? [] });
    setDraftLedger(connection.ledgerId ? client.identity : null);
    setSubmittedId(null); setAttempted(false); setNotice((/* i18n */ { id: 'native.ledgerapp.copy.completed', message: "항목별 내역과 태그를 새 입력으로 복사했습니다. 날짜와 금액을 확인해 주세요." })); setError(''); setScreen('entry');
  }
  async function saveTemplate() {
    setAttempted(true);
    if (blocksFreshRequest(outbox.list(), submittedId, draft)) { setError((/* i18n */ { id: 'native.ledgerapp.template.uncertain', message: "불명확한 저장 결과를 같은 요청 키로 확인한 후 템플릿을 저장해 주세요." })); return; }
    if (!draftErrors.length) await queueAction(async () => { await outbox.saveTemplate(templateName.trim(), draft); void rememberAssetUnits(draft.postings.map(posting => posting.amount.commodity)); setNotice((/* i18n */ { id: 'native.ledgerapp.template.saved', message: "입력 템플릿을 기기에 저장했습니다." })); });
  }
  function copyTransaction(transaction: TransactionFieldsFragment) {
    copy({ date: transaction.date, description: transaction.description, code: transaction.code,
      postings: transaction.postings.map(posting => ({ accountName: posting.accountName, amount: { commodity: posting.amount.commodity, value: posting.amount.value }, cost: posting.cost, memo: posting.memo })),
      tags: transaction.tags.map(tag => ({ key: tag.key, value: tag.value })) });
  }
  function changePosting(index: number, update: Partial<Draft['postings'][number]>) {
    if (draftGuard.current.locked || draftGuard.current.busy) return;
    setDraft(current => ({ ...current, postings: current.postings.map((posting, i) => i === index ? { ...posting, ...update } : posting) }));
  }
  function changePostingCommodity(index: number, commodity: string) {
    const guard = draftGuard.current;
    if (guard.locked || guard.busy || guard.draftMismatch || guard.freshRequestBlocked) return;
    setDraft(current => ({ ...current, postings: current.postings.map((posting, i) => i === index
      ? { ...posting, amount: { ...posting.amount, commodity } } : posting) }));
  }
  function resetDraft() { setTradeInput(newTradeInput()); setTradeError(''); setEntryMode('general'); setDraft(newDraft()); setDraftLedger(connection.ledgerId ? client.identity : null); setSubmittedId(null); setAttempted(false); setNotice(''); setError(''); }
  const selectedRecord = queue.find(record => record.id === submittedId);
  const queueNames = Object.fromEntries(Object.entries(queueMessages).map(([state, message]) => [state, _(message)])) as Record<OutboxRecord['state'], string>;
  const pendingCount = queue.filter(record => record.state !== 'succeeded').length;
  const periodRows = accountDetail ? [...new Set([...accountDetail.opening, ...accountDetail.movements].map(amount => amount.commodity))].map(commodity => {
    const opening = accountDetail.opening.find(amount => amount.commodity === commodity)?.value ?? '0';
    const movement = accountDetail.movements.find(amount => amount.commodity === commodity)?.value ?? '0';
    return { commodity, opening, movement, ending: addDecimals(opening, movement) };
  }) : [];
  const renderTransactions = (items: TransactionConnection | null | undefined) => items?.edges.map(({ node }) => <TransactionRow key={node.id} transaction={galleryTransaction(node)} selected={selectedTransaction?.id === node.id} onPress={() => setSelectedTransaction(node)} />);
  const noResults = !loading && !error;

  return <AssetMetadataProvider bindings={connection.verified && assetMetadata.identity === client.identity ? assetMetadata.bindings : []}>
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
    <StatusBar barStyle="dark-content" />
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView ref={scrollView} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={styles.header}><Text accessibilityRole="header" style={[styles.brand, styles.flex]}>hledger</Text><Badge tone={pendingCount ? 'warning' : 'neutral'}>{pendingCount ? _(/* i18n */ { id: 'native.ledgerapp.queue.pendingCount', message: "대기 {value0}건", values: { value0: pendingCount } }) : _(/* i18n */ { id: 'native.ledgerapp.connection.live', message: "실제 원장" })}</Badge>{onOpenGallery && <Button variant="quiet" disabled={busy} onPress={onOpenGallery}>{_(/* i18n */ { id: 'nav.gallery', message: '갤러리' })}</Button>}<View testID={screen === 'settings' ? 'nav-back' : 'nav-settings'}><Button variant="quiet" disabled={busy} onPress={screen === 'settings' ? closeSettings : openSettings}>{screen === 'settings' ? _(/* i18n */ { id: 'nav.back', message: '뒤로' }) : _(/* i18n */ { id: 'nav.settings', message: '설정' })}</Button></View></View>
        {screen !== 'settings' && <View style={styles.navigation}>{tabs.filter(([tab]) => tab !== 'books' || booksCapability.feature?.enabled).map(([tab, label]) => <Button key={tab} selected={screen === tab} disabled={busy} onPress={() => { setSelectedAccount(null); setAccountDetail(null); setSelectedTransaction(null); setScreen(tab); }}>{label}</Button>)}</View>}
        <Heading>{titles[screen]}</Heading>
        {!connection.verified && screen !== 'settings' && <Notice title={_(/* i18n */ { id: 'connection.required', message: '설정에서 원장을 연결해 주세요' })} tone="accent" action={{ label: _(/* i18n */ { id: 'connection.openSettings', message: '설정 열기' }), onPress: openSettings }}>{_(/* i18n */ { id: 'connection.guidance', message: '주소와 인증 토큰을 적용하면 원장을 확인하고 조회·전송을 시작합니다. 이전 연결이 있다면 오프라인 임시 저장은 가능합니다.' })}</Notice>}
        {loading && <Notice title={_(/* i18n */ { id: 'common.loading', message: '불러오는 중' })}>{_(/* i18n */ { id: 'common.requesting', message: '원장에 요청하고 있습니다.' })}</Notice>}
        {error ? <Notice title={_(/* i18n */ { id: 'common.requestFailed', message: '요청을 완료하지 못했어요' })} tone="danger">{error instanceof ConnectionAttemptError
          ? [renderMessage(error.originalCause), _(/* i18n */ { id: 'connection.notApplied', message: '입력한 설정을 적용하지 않았습니다.' }), error.hadVerifiedConnection
            ? _(/* i18n */ { id: 'connection.previousRetained', message: '이전에 인증한 연결을 계속 사용합니다. 현재 사용 중인 주소를 아래에서 확인해 주세요.' })
            : _(/* i18n */ { id: 'connection.none', message: '현재 인증된 연결이 없습니다.' })].join('\n')
          : renderMessage(error)}</Notice> : null}
        {assetMetadataError && connection.verified ? <Notice title={_(/* i18n */ { id: 'native.ledgerapp.assetMetadata.failed', message: "자산 표시 정보를 불러오지 못했어요" })} tone="warning"
          action={{ label: _(/* i18n */ { id: 'native.ledgerapp.assetMetadata.reload', message: "표시 정보 다시 불러오기" }), onPress: () => setAssetMetadataReload(value => value + 1) }}>
          {renderMessage(assetMetadataError)} {_(/* i18n */ { id: 'native.ledgerapp.assetMetadata.unchanged', message: "원장의 자산와 금액은 그대로 표시합니다." })}</Notice> : null}
        {notice ? <Notice title={_(/* i18n */ { id: 'common.notice', message: '알림' })} tone="accent">{renderMessage(notice)}</Notice> : null}
        {storageWarning ? <Notice title={_(/* i18n */ { id: 'common.storageNotice', message: '기기 저장소 알림' })} tone="warning">{renderMessage(storageWarning)}</Notice> : null}
        {storageError ? <Notice title={_(/* i18n */ { id: 'common.storageUnavailable', message: '기기 저장소를 사용할 수 없어요' })} tone="danger">{renderMessage(storageError)} {_(/* i18n */ { id: 'native.ledgerapp.storage.stopped', message: "입력을 유지하며 전송을 중단했습니다. 앱을 다시 열어 저장 자료를 확인해 주세요." })}</Notice> : null}

        {screen === 'accounts' && <>
          {(selectedAccount ?? accounts?.edges[0]?.node) && <View style={styles.feature}><Text style={styles.featureLabel}>{(selectedAccount ?? accounts?.edges[0]?.node)?.fullName}</Text><Text style={styles.featureMuted}>{_(/* i18n */ { id: 'native.ledgerapp.accounts.asOf.sentence', message: "{value0} 기준 · {value1}", values: { value0: accountScope.asOf, value1: accountScope.includeSubaccounts ? _(/* i18n */ { id: 'native.ledgerapp.accounts.includeChildren', message: "하위 항목 포함" }) : _(/* i18n */ { id: 'native.ledgerapp.accounts.ownBalance', message: "항목 자체 잔액" }) } })}</Text>
            {(selectedAccount ?? accounts?.edges[0]?.node)?.balances.map(amount => <Money key={amount.commodity} value={amount.value} commodity={amount.commodity} surface="feature" prominent />)}
          </View>}
          <Panel style={styles.filterPanel}>
            <View style={styles.filterSummary}><Text style={textStyles.caption}>{from} ~ {accountScope.asOf ?? to}</Text><Button variant="quiet" expanded={accountFiltersOpen} onPress={() => setAccountFiltersOpen(!accountFiltersOpen)}>{_(/* i18n */ { id: 'native.ledgerapp.accounts.filters.sentence', message: "기간·항목 필터 {value0}", values: { value0: accountFiltersOpen ? _(/* i18n */ { id: 'native.ledgerapp.common.collapse', message: "접기" }) : _(/* i18n */ { id: 'native.ledgerapp.common.expand', message: "열기" }) } })}</Button></View>
            {accountFiltersOpen && <View style={styles.filterFields}><Field label={_(/* i18n */ { id: 'native.ledgerapp.accounts.search', message: "항목 검색" })} value={accountQuery} onChangeText={setAccountQuery} returnKeyType="search" onSubmitEditing={() => void loadAccounts()} />
            <View style={styles.fields}><Field label={_(/* i18n */ { id: 'native.ledgerapp.accounts.from', message: "기간 시작일" })} value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" autoCapitalize="none" /><Field label={_(/* i18n */ { id: 'native.ledgerapp.accounts.to', message: "기준일·기간 종료일" })} value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" autoCapitalize="none" /></View>
            <Field label={_(/* i18n */ { id: 'native.ledgerapp.accounts.depth', message: "계층 깊이 (1~10, 빈칸은 전체)" })} value={depth} onChangeText={setDepth} keyboardType="number-pad" />
            <Toggle label={_(/* i18n */ { id: 'native.ledgerapp.accounts.includeEmpty', message: "잔액이 0인 항목 포함" })} value={includeEmpty} onChange={setIncludeEmpty} /><Toggle label={_(/* i18n */ { id: 'native.ledgerapp.accounts.includeSubaccounts', message: "잔액·기간에 하위 항목 포함" })} value={includeSubaccounts} onChange={setIncludeSubaccounts} />
            <Button variant="primary" disabled={loading} onPress={() => void loadAccounts()}>{_(/* i18n */ { id: 'native.ledgerapp.accounts.apply', message: "항목·기준일 적용" })}</Button>
            </View>}
          </Panel>

          <Panel>{accounts?.edges.map(({ node }) => <View key={node.id} style={{ paddingLeft: Math.min(node.depth - 1, 4) * tokens.space.sm }}><AccountRow account={{ ...node, path: node.fullName, lastTransactionDate: node.lastPostedDate ?? null, parentId: node.parentId ?? null }} selected={selectedAccount?.id === node.id} onPress={() => void loadAccountDetail(node)} /></View>)}
            {noResults && accounts?.edges.length === 0 && <Text style={textStyles.muted}>{_(/* i18n */ { id: 'native.ledgerapp.accounts.empty', message: "조건에 맞는 항목이 없습니다." })}</Text>}
            {accounts?.pageInfo.hasNextPage && <Button disabled={loading} onPress={() => void loadAccounts(accounts.pageInfo.endCursor ?? undefined)}>{_(/* i18n */ { id: 'native.ledgerapp.accounts.more', message: "항목 더 보기" })}</Button>}
          </Panel>
          {selectedAccount && <Panel><Heading subtitle={_(/* i18n */ { id: 'native.ledgerapp.accounts.inclusivePeriod', message: "{value0} ~ {value1} · 양 끝 날짜 포함", values: { value0: detailScope?.from ?? from, value1: detailScope?.to ?? to } })}>{selectedAccount.fullName}</Heading>
            <Button disabled={loading} onPress={() => void loadAccountDetail(selectedAccount)}>{_(/* i18n */ { id: 'native.ledgerapp.accounts.refreshDetail', message: "현재 기간으로 상세 새로고침" })}</Button>
            {periodRows.map(row => <View key={row.commodity} style={styles.fact}><AssetIdentity commodity={row.commodity} /><Text style={textStyles.muted}>{_(/* i18n */ { id: 'native.ledgerapp.accounts.opening', message: "기초" })}</Text><Money value={row.opening} commodity={row.commodity} /><Text style={textStyles.muted}>{_(/* i18n */ { id: 'native.ledgerapp.accounts.movement', message: "기간 증감" })}</Text><Money value={row.movement} commodity={row.commodity} /><Text style={textStyles.strong}>{_(/* i18n */ { id: 'native.ledgerapp.accounts.ending', message: "기말" })}</Text><Money value={row.ending} commodity={row.commodity} /></View>)}
            {renderTransactions(accountDetail?.transactions)}
            {noResults && accountDetail?.transactions?.edges.length === 0 && <Text style={textStyles.muted}>{_(/* i18n */ { id: 'native.ledgerapp.accounts.noTransactions', message: "이 기간의 거래가 없습니다." })}</Text>}
            {accountDetail?.transactions?.pageInfo.hasNextPage && <Button disabled={loading} onPress={() => void loadAccountDetail(selectedAccount, accountDetail.transactions?.pageInfo.endCursor ?? undefined)}>{_(/* i18n */ { id: 'native.ledgerapp.accounts.moreTransactions', message: "항목 거래 더 보기" })}</Button>}
          </Panel>}
        </>}

        {<View style={screen === 'transactions' ? undefined : { display: 'none' }}>
          <Panel style={styles.filterPanel}>
            <View style={styles.filterSummary}><Text style={textStyles.caption}>{transactionScope.filter?.from ?? _(/* i18n */ { id: 'native.ledgerapp.transactions.allDates', message: "전체 기간" })}{transactionScope.filter?.to ? ` ~ ${transactionScope.filter.to}` : ''}{transactionScope.filter?.accountId ? _(/* i18n */ { id: 'native.ledgerapp.transactions.accountSelected', message: " · 항목 선택" }) : _(/* i18n */ { id: 'native.ledgerapp.transactions.allAccounts', message: " · 전체 항목" })}</Text><Button variant="quiet" expanded={transactionFiltersOpen} onPress={() => setTransactionFiltersOpen(!transactionFiltersOpen)}>{_(/* i18n */ { id: 'native.ledgerapp.transactions.filters.sentence', message: "거래 필터 {value0}", values: { value0: transactionFiltersOpen ? _(/* i18n */ { id: 'native.ledgerapp.filters.collapse', message: "접기" }) : _(/* i18n */ { id: 'native.ledgerapp.filters.expand', message: "열기" }) } })}</Button></View>
            {transactionFiltersOpen && <View style={styles.filterFields}><Field label={_(/* i18n */ { id: 'native.ledgerapp.transactions.search', message: "거래 검색" })} value={query} onChangeText={setQuery} placeholder={_(/* i18n */ { id: 'native.ledgerapp.transactions.searchHint', message: "내용, 항목 또는 태그" })} returnKeyType="search" onSubmitEditing={() => void loadTransactions()} />
            <Field label={_(/* i18n */ { id: 'native.ledgerapp.transactions.from', message: "시작일 (선택)" })} value={transactionFrom} onChangeText={setTransactionFrom} placeholder="YYYY-MM-DD" /><Field label={_(/* i18n */ { id: 'native.ledgerapp.transactions.to', message: "종료일 (선택)" })} value={transactionTo} onChangeText={setTransactionTo} placeholder="YYYY-MM-DD" />
            <Text style={textStyles.strong}>{_(/* i18n */ { id: 'native.ledgerapp.transactions.account', message: "항목 필터" })}</Text><View style={styles.wrap}><Button selected={!filterAccount} onPress={() => setFilterAccount('')}>{_(/* i18n */ { id: 'native.ledgerapp.transactions.allAccountsOption', message: "전체 항목" })}</Button>{accounts?.edges.map(({ node }) => <Button key={node.id} selected={filterAccount === node.id} onPress={() => setFilterAccount(node.id)}>{node.fullName}</Button>)}</View>
            {!accounts && <Button disabled={loading} onPress={() => void loadAccounts()}>{_(/* i18n */ { id: 'native.ledgerapp.transactions.loadAccounts', message: "항목 선택 목록 불러오기" })}</Button>}
            <Toggle label={_(/* i18n */ { id: 'native.ledgerapp.transactions.subaccounts', message: "선택 항목의 하위 항목 포함" })} value={transactionSubaccounts} onChange={setTransactionSubaccounts} />
            <AssetUnitField label={_(/* i18n */ { id: 'native.ledgerapp.transactions.commodity', message: "자산 필터 (선택)" })} value={transactionCommodity} onChangeText={setTransactionCommodity} customValues={assetUnitValues} onComplete={rememberAssetUnit} editable={!busy} catalogClient={connection.verified ? client : undefined} onBind={bindAsset} />
            <Field label={_(/* i18n */ { id: 'native.ledgerapp.transactions.tag', message: "태그 키 (선택)" })} value={filterTag} onChangeText={setFilterTag} /><Field label={_(/* i18n */ { id: 'native.ledgerapp.transactions.tagValue', message: "태그 값" })} value={filterTagValue} onChangeText={setFilterTagValue} />
            <Button variant="primary" disabled={loading} onPress={() => void loadTransactions()}>{_(/* i18n */ { id: 'native.ledgerapp.transactions.apply', message: "필터 적용·새로고침" })}</Button>
            </View>}
          </Panel>
          <Panel>{renderTransactions(transactions)}{noResults && transactions?.edges.length === 0 && <Text style={textStyles.muted}>{_(/* i18n */ { id: 'native.ledgerapp.transactions.empty', message: "조건에 맞는 거래가 없습니다." })}</Text>}
            {transactions?.pageInfo.hasNextPage && <Button disabled={loading} onPress={() => void loadTransactions(transactions.pageInfo.endCursor ?? undefined)}>{_(/* i18n */ { id: 'native.ledgerapp.transactions.more', message: "거래 더 보기" })}</Button>}
          </Panel>
        </View>}
        {selectedTransaction && (screen === 'transactions' || screen === 'accounts') && <Panel><Heading subtitle={selectedTransaction.date}>{selectedTransaction.description}</Heading>
          <Badge>{({ UNMARKED: _(/* i18n */ { id: 'native.ledgerapp.transaction.unmarked', message: "미확인" }), PENDING: _(/* i18n */ { id: 'native.ledgerapp.transaction.pending', message: "보류" }), CLEARED: _(/* i18n */ { id: 'native.ledgerapp.transaction.cleared', message: "확인됨" }) } as const)[selectedTransaction.status]}</Badge>
          <Text style={textStyles.caption}>{_(/* i18n */ { id: 'native.ledgerapp.transaction.reference.sentence', message: "참고 번호 {value0} · 출처 {value1}", values: { value0: selectedTransaction.code ?? _(/* i18n */ { id: 'native.ledgerapp.transaction.noReference', message: "없음" }), value1: selectedTransaction.source } })}</Text>
          <Text style={textStyles.caption}>{_(/* i18n */ { id: 'native.ledgerapp.transaction.createdAt.sentence', message: "실제 생성 시각 {value0}", values: { value0: selectedTransaction.createdAt ?? _(/* i18n */ { id: 'native.ledgerapp.transaction.unknownCreation', message: "원장에 기록되지 않음" }) } })}</Text>
          {selectedTransaction.tags.map(tag => <Text key={tag.key} style={textStyles.caption}>{_(/* i18n */ { id: 'native.ledgerapp.transaction.tags.sentence', message: "태그 {value0}: {value1}", values: { value0: tag.key, value1: tag.value } })}</Text>)}
          {selectedTransaction.postings.map((posting, index) => <PostingRow key={index} posting={{ ...posting, accountId: posting.accountId ?? null, memo: posting.memo ?? null }} />)}
          <Button variant="primary" disabled={busy} onPress={() => copyTransaction(selectedTransaction)}>{_(/* i18n */ { id: 'native.ledgerapp.transaction.copy', message: "항목별 내역을 새 거래로 복사" })}</Button><Button onPress={() => setSelectedTransaction(null)}>{_(/* i18n */ { id: 'native.ledgerapp.transaction.close', message: "상세 닫기" })}</Button>
        </Panel>}

        {<View style={screen === 'entry' ? undefined : { display: 'none' }}>
          <Panel><Heading subtitle={_(/* i18n */ { id: 'native.ledgerapp.recent.copyHint', message: "날짜, 항목별 내역, 태그를 함께 복사합니다." })}>{_(/* i18n */ { id: 'native.ledgerapp.recent.title', message: "최근 거래에서 시작" })}</Heading><Button disabled={loading} onPress={() => void loadRecent()}>{_(/* i18n */ { id: 'native.ledgerapp.recent.refresh', message: "최근 거래 새로고침" })}</Button>
            {recent.map(transaction => <View key={transaction.id} style={styles.fact}><Text style={textStyles.strong}>{transaction.description}</Text><Text style={textStyles.caption}>{_(/* i18n */ { id: 'native.ledgerapp.recent.postingLabel.sentence', message: "{value0} · 내역 {value1}개", values: { value0: transaction.date, value1: transaction.postings.length } })}</Text><Button disabled={busy} onPress={() => copyTransaction(transaction)}>{_(/* i18n */ { id: 'native.ledgerapp.recent.copy', message: "이 거래 복사" })}</Button></View>)}
            {noResults && recent.length === 0 && <Text style={textStyles.muted}>{_(/* i18n */ { id: 'native.ledgerapp.recent.empty', message: "복사할 최근 거래가 없습니다." })}</Text>}
          </Panel>
          <Panel><Heading>{_(/* i18n */ { id: 'native.ledgerapp.templates.title', message: "저장한 입력 템플릿" })}</Heading>{templates.map(template => <View key={template.id} style={styles.fact}><Text style={textStyles.strong}>{template.name}</Text><Button disabled={busy || freshRequestBlocked || blocksFreshRequest(queue, null, template.input)} onPress={() => copy(template.input)}>{_(/* i18n */ { id: 'native.ledgerapp.templates.use', message: "템플릿으로 새 거래" })}</Button></View>)}{templates.length === 0 && <Text style={textStyles.muted}>{_(/* i18n */ { id: 'native.ledgerapp.templates.hint', message: "아래 입력을 템플릿으로 저장할 수 있습니다." })}</Text>}</Panel>
          <Panel><Heading subtitle={locked ? freshRequestBlocked ? _(/* i18n */ { id: 'native.ledgerapp.entry.uncertainHint', message: "저장 결과가 불명확합니다. 동기화 화면에서 원래 요청 키로 확인·재시도해 주세요." }) : _(/* i18n */ { id: 'native.ledgerapp.entry.lockedHint', message: "이 입력은 기기에 저장되어 잠겨 있습니다. 수정하려면 새 입력으로 복사하세요." }) : _(/* i18n */ { id: 'native.ledgerapp.entry.balanceHint', message: "원가를 반영한 자산별 합계를 0으로 맞춰 주세요." })}>{_(/* i18n */ { id: 'native.ledgerapp.entry.title', message: "거래 입력" })}</Heading>
            {freshRequestBlocked && <Notice title={_(/* i18n */ { id: 'native.ledgerapp.entry.uncertainTitle', message: "같은 요청 키로 결과를 확인해 주세요" })} tone="warning" action={{ label: _(/* i18n */ { id: 'native.ledgerapp.entry.retry', message: "원래 요청 확인·재시도" }), onPress: () => setScreen('sync') }}>{_(/* i18n */ { id: 'native.ledgerapp.entry.uncertainCopyBlocked', message: "결과가 불명확한 거래의 복사와 템플릿 사용·저장을 중단했습니다." })}</Notice>}
            {draftMismatch && <Notice title={_(/* i18n */ { id: 'native.ledgerapp.entry.otherLedger', message: "다른 원장에서 시작한 입력입니다" })} tone="warning" action={{ label: _(/* i18n */ { id: 'native.ledgerapp.entry.copyToLedger', message: "현재 원장에 맞춰 새 입력으로 복사" }), onPress: () => copy(draft) }}>{_(/* i18n */ { id: 'native.ledgerapp.entry.otherLedgerHint', message: "원래 연결로 돌아가거나 현재 원장에 새 입력으로 명시적으로 복사한 후 항목과 금액을 확인해 주세요." })}</Notice>}
            <Button disabled={locked || busy || draftMismatch || freshRequestBlocked} onPress={() => setEntryMode(entryMode === 'general' ? 'trade' : 'general')}>{_(/* i18n */ { id: 'native.ledgerapp.entry.modeLabel.sentence', message: "입력 방식: {value0} · 누르면 변경", values: { value0: entryMode === 'general' ? _(/* i18n */ { id: 'native.ledgerapp.entry.general', message: "일반 거래" }) : _(/* i18n */ { id: 'native.ledgerapp.entry.trade', message: "주식 매매" }) } })}</Button>
            {entryMode === 'trade' && <TradeFields input={tradeInput} setInput={setTradeInput} error={tradeError} setError={setTradeError} key={draft.idempotencyKey} disabled={locked || busy || draftMismatch || freshRequestBlocked} customValues={assetUnitValues} onComplete={rememberAssetUnit} catalogClient={connection.verified ? client : undefined} onBind={bindAsset} requestContext={draft} onApply={postings => { const guard = draftGuard.current; if (!guard.locked && !guard.busy && !guard.draftMismatch && !guard.freshRequestBlocked) setDraft(current => ({ ...current, postings })); }} />}
            <Field label={_(/* i18n */ { id: 'native.ledgerapp.entry.date', message: "거래일" })} value={draft.date} onChangeText={date => setDraft({ ...draft, date })} editable={!locked && !busy} placeholder="YYYY-MM-DD" />
            <Field label={_(/* i18n */ { id: 'native.ledgerapp.entry.description', message: "내용" })} value={draft.description} onChangeText={description => setDraft({ ...draft, description })} editable={!locked && !busy} maxLength={512} />
            <Field label={_(/* i18n */ { id: 'native.ledgerapp.entry.reference', message: "참고 번호 (선택)" })} hint={_(/* i18n */ { id: 'native.ledgerapp.entry.referenceHint', message: "영수증 번호나 주문 번호가 있으면 적어 주세요. 비워 두어도 됩니다." })} value={draft.code ?? ''} onChangeText={code => setDraft({ ...draft, code })} editable={!locked && !busy} maxLength={64} />
            <Heading subtitle={_(/* i18n */ { id: 'native.ledgerapp.entry.postingsHint', message: "거래로 돈이 늘거나 줄어든 항목과 금액입니다. 예: 현금 -12,500원, 식비 12,500원." })}>{_(/* i18n */ { id: 'native.ledgerapp.entry.postings', message: "항목별 내역" })}</Heading>
            {draft.postings.map((posting, index) => <View key={`${draft.idempotencyKey}:${draft.postings.length}:${index}`} style={styles.posting}><Text style={textStyles.strong}>{_(/* i18n */ { id: 'native.ledgerapp.posting.label.sentence', message: "내역 {value0}", values: { value0: index + 1 } })}</Text>
              <Field label={_(/* i18n */ { id: 'native.ledgerapp.posting.account', message: "내역 {value0} 항목 경로", values: { value0: index + 1 } })} value={posting.accountName} onChangeText={accountName => changePosting(index, { accountName })} editable={!locked && !busy} autoCapitalize="none" />
              <Field label={_(/* i18n */ { id: 'native.ledgerapp.posting.amount', message: "내역 {value0} 금액/수량 (부호 포함)", values: { value0: index + 1 } })} value={posting.amount.value} onChangeText={value => changePosting(index, { amount: { ...posting.amount, value } })} editable={!locked && !busy} keyboardType="numbers-and-punctuation" autoCapitalize="none" placeholder={_(/* i18n */ { id: 'native.ledgerapp.posting.amountHint', message: "예: -12500.00" })} />
              <AssetUnitField label={_(/* i18n */ { id: 'native.ledgerapp.posting.commodity', message: "내역 {value0} 자산", values: { value0: index + 1 } })} value={posting.amount.commodity} onChangeText={commodity => changePostingCommodity(index, commodity)} editable={!locked && !busy && !draftMismatch && !freshRequestBlocked} customValues={assetUnitValues} onComplete={rememberAssetUnit} catalogClient={connection.verified ? client : undefined} onBind={bindAsset} requestContext={draft} />
              {posting.cost && <Text style={textStyles.caption}>{_(/* i18n */ { id: 'native.ledgerapp.posting.preservedCost.sentence', message: "보존된 원가: {value0} {value1} {value2} · 원가를 바꾸려면 주식 매매 입력을 사용해 주세요.", values: { value0: posting.cost.type === 'UNIT' ? _(/* i18n */ { id: 'native.ledgerapp.posting.unitCost', message: "단가" }) : _(/* i18n */ { id: 'native.ledgerapp.posting.totalCost', message: "총액" }), value1: posting.cost.amount.value, value2: posting.cost.amount.commodity } })}</Text>}
              <Field label={_(/* i18n */ { id: 'native.ledgerapp.posting.memo', message: "내역 {value0} 메모 (선택)", values: { value0: index + 1 } })} value={posting.memo ?? ''} onChangeText={memo => changePosting(index, { memo })} editable={!locked && !busy} multiline maxLength={1000} />
              <Button disabled={locked || busy || draft.postings.length <= 2} onPress={() => setDraft({ ...draft, postings: draft.postings.filter((_, i) => i !== index) })}>{_(/* i18n */ { id: 'native.ledgerapp.posting.deleteLabel.sentence', message: "내역 {value0} 삭제", values: { value0: index + 1 } })}</Button>
            </View>)}
            <Button disabled={locked || busy} onPress={() => setDraft({ ...draft, postings: [...draft.postings, { accountName: '', amount: { commodity: draft.postings[0]?.amount.commodity ?? 'KRW', value: '' }, memo: '' }] })}>{_(/* i18n */ { id: 'native.ledgerapp.posting.add', message: "내역 추가" })}</Button>
            <Text style={textStyles.strong}>{_(/* i18n */ { id: 'native.ledgerapp.entry.tags', message: "태그" })}</Text>{draft.tags.map((tag, index) => <View key={index} style={styles.posting}>
              <Field label={_(/* i18n */ { id: 'native.ledgerapp.tag.key', message: "태그 {value0} 키", values: { value0: index + 1 } })} value={tag.key} editable={!locked && !busy} onChangeText={key => setDraft({ ...draft, tags: draft.tags.map((item, i) => i === index ? { ...item, key } : item) })} />
              <Field label={_(/* i18n */ { id: 'native.ledgerapp.tag.value', message: "태그 {value0} 값", values: { value0: index + 1 } })} value={tag.value} editable={!locked && !busy} onChangeText={value => setDraft({ ...draft, tags: draft.tags.map((item, i) => i === index ? { ...item, value } : item) })} />
              <Button disabled={locked || busy} onPress={() => setDraft({ ...draft, tags: draft.tags.filter((_, i) => i !== index) })}>{_(/* i18n */ { id: 'native.ledgerapp.tag.deleteLabel.sentence', message: "태그 {value0} 삭제", values: { value0: index + 1 } })}</Button>
            </View>)}
            <Button disabled={locked || busy} onPress={() => setDraft({ ...draft, tags: [...draft.tags, { key: '', value: '' }] })}>{_(/* i18n */ { id: 'native.ledgerapp.tag.add', message: "태그 추가" })}</Button>
            <Field label={_(/* i18n */ { id: 'native.ledgerapp.entry.clientReference', message: "연동 참조 (선택)" })} hint={_(/* i18n */ { id: 'native.ledgerapp.entry.clientReferenceHint', message: "다른 앱과 연동할 때 쓰는 식별자입니다. 참고 번호와 별개이며 비워 두어도 됩니다." })} value={draft.clientReference ?? ''} editable={!locked && !busy} onChangeText={clientReference => setDraft({ ...draft, clientReference })} maxLength={128} />
            {attempted && draftErrors.length > 0 && <Notice title={_(/* i18n */ { id: 'native.ledgerapp.entry.validationTitle', message: "입력을 확인해 주세요" })} tone="danger">{draftErrors.join('\n')}</Notice>}
            {selectedRecord && <Notice title={queueNames[selectedRecord.state]} tone={selectedRecord.state === 'succeeded' ? 'success' : 'warning'}>{formatOutboxMessage(selectedRecord) || _(/* i18n */ { id: 'native.ledgerapp.entry.retryHint', message: "기기에 보관된 요청은 같은 중복 방지 키로만 재시도합니다." })}</Notice>}
            {!queueReady && !storageError && <Text style={textStyles.muted}>{_(/* i18n */ { id: 'native.ledgerapp.entry.restoring', message: "기기 저장 자료를 복구하고 있습니다." })}</Text>}
            <Button variant="primary" disabled={busy || locked || freshRequestBlocked || draftMismatch || !queueReady || !connection.verified} onPress={() => void save(true)}>{busy ? _(/* i18n */ { id: 'native.ledgerapp.entry.processing', message: "처리 중…" }) : _(/* i18n */ { id: 'native.ledgerapp.entry.save', message: "기기에 보관하고 원장에 저장" })}</Button>
            <Button disabled={busy || locked || freshRequestBlocked || draftMismatch || !queueReady || !connection.ledgerId} onPress={() => void save(false)}>{_(/* i18n */ { id: 'native.ledgerapp.entry.saveOffline', message: "오프라인 임시 저장 · 전송하지 않음" })}</Button>
            <Field label={_(/* i18n */ { id: 'native.ledgerapp.template.name', message: "템플릿 이름" })} value={templateName} onChangeText={setTemplateName} editable={!busy} />
            <Button disabled={busy || freshRequestBlocked || !queueReady || !templateName.trim()} onPress={() => void saveTemplate()}>{_(/* i18n */ { id: 'native.ledgerapp.template.save', message: "입력을 템플릿으로 저장" })}</Button>
            {locked && <Button disabled={busy || freshRequestBlocked} onPress={() => copy(draft)}>{_(/* i18n */ { id: 'native.ledgerapp.entry.copy', message: "이 입력을 새 거래로 복사" })}</Button>}
            <Button disabled={busy} onPress={resetDraft}>{_(/* i18n */ { id: 'native.ledgerapp.entry.new', message: "빈 새 거래" })}</Button>
          </Panel>
        </View>}

        <BookRecovery controller={bookController} client={client} verified={connection.verified} feature={booksCapability.feature} />
        {screen === 'books' && <BookModuleView controller={bookController} verified={connection.verified} feature={booksCapability.feature} />}

        {<View style={screen === 'prices' ? undefined : { display: 'none' }}><Panel><AssetUnitField label={_(/* i18n */ { id: 'native.ledgerapp.prices.commodity', message: "자산 (선택)" })} value={priceCommodity} onChangeText={setPriceCommodity} customValues={assetUnitValues} onComplete={rememberAssetUnit} editable={!busy} catalogClient={connection.verified ? client : undefined} onBind={bindAsset} /><AssetUnitField label={_(/* i18n */ { id: 'native.ledgerapp.prices.quoteCommodity', message: "기준 자산 (선택)" })} value={quoteCommodity} onChangeText={setQuoteCommodity} customValues={assetUnitValues} onComplete={rememberAssetUnit} editable={!busy} catalogClient={connection.verified ? client : undefined} onBind={bindAsset} />
          <Field label={_(/* i18n */ { id: 'native.ledgerapp.prices.from', message: "시세 시작일 (선택)" })} value={priceFrom} onChangeText={setPriceFrom} placeholder="YYYY-MM-DD" /><Field label={_(/* i18n */ { id: 'native.ledgerapp.prices.to', message: "시세 종료일 (선택)" })} value={priceTo} onChangeText={setPriceTo} placeholder="YYYY-MM-DD" /><Button variant="primary" disabled={loading} onPress={() => void loadPrices()}>{_(/* i18n */ { id: 'native.ledgerapp.prices.load', message: "시세 조회" })}</Button></Panel>
          <Panel>{prices?.edges.map(({ node }, index) => <View key={`${node.date}-${node.commodity}-${node.quoteCommodity}-${index}`} style={styles.fact}><View style={styles.wrap}><AssetIdentity commodity={node.commodity} /><Text style={textStyles.strong}>→</Text><AssetIdentity commodity={node.quoteCommodity} /></View><Money value={node.rate} commodity={node.quoteCommodity} /><Text style={textStyles.caption}>{_(/* i18n */ { id: 'native.ledgerapp.prices.asOf.sentence', message: "기준일 {value0} · 출처 {value1}", values: { value0: node.date, value1: node.source ?? _(/* i18n */ { id: 'native.ledgerapp.prices.noSource', message: "기록 없음" }) } })}</Text></View>)}
            {noResults && prices?.edges.length === 0 && <Text style={textStyles.muted}>{_(/* i18n */ { id: 'native.ledgerapp.prices.empty', message: "조건에 맞는 시세가 없습니다." })}</Text>}{prices?.pageInfo.hasNextPage && <Button disabled={loading} onPress={() => void loadPrices(prices.pageInfo.endCursor ?? undefined)}>{_(/* i18n */ { id: 'native.ledgerapp.prices.more', message: "시세 더 보기" })}</Button>}
          </Panel></View>}

        {screen === 'settings' && <>
          <Panel><Heading>{_(/* i18n */ { id: 'native.books.settings.title', message: '책 기능' })}</Heading>
            <Text style={textStyles.muted}>{_(/* i18n */ { id: 'native.books.settings.description', message: '이 원장에서 책 구매·판매·폐기와 ISBN 조회를 사용합니다. 꺼도 기존 원장 기록과 입력은 보관합니다.' })}</Text>
            <Button disabled={!booksCapability.feature || booksCapability.working || !bookController.ready || bookController.busy || (!!booksCapability.feature.enabled && !!bookController.pending)} onPress={() => void booksCapability.toggle(!booksCapability.feature?.enabled, bookController)}>{booksCapability.feature?.enabled ? _(/* i18n */ { id: 'native.books.settings.disable', message: '책 기능 끄기' }) : _(/* i18n */ { id: 'native.books.settings.enable', message: '책 기능 켜기' })}</Button>
            <Button disabled={!connection.verified || booksCapability.working} onPress={() => void booksCapability.refresh()}>{_(/* i18n */ { id: 'native.books.settings.refresh', message: '기능 설정 새로고침' })}</Button>
            {booksCapability.failed && <Notice tone="warning" title={_(/* i18n */ { id: 'native.books.settings.unavailable', message: '기능 설정을 확인하지 못했습니다. 연결과 설정을 새로고침해 주세요.' })}>{_(/* i18n */ { id: 'native.books.settings.closed', message: '설정을 확인할 때까지 책 기능을 잠급니다.' })}</Notice>}
          </Panel>
          <Panel><Heading>{_(/* i18n */ { id: 'settings.language', message: '언어' })}</Heading>
            <View style={styles.wrap}>{(['ko', 'en'] as const).map(locale => <Pressable key={locale} testID={`locale-${locale}`} accessibilityRole="button" accessibilityState={{ selected: i18n.locale === locale }} accessibilityLabel={locale === 'ko' ? '한국어' : 'English'} onPress={() => selectLocale(locale)} style={styles.posting}><Text style={textStyles.strong}>{locale === 'ko' ? '한국어' : 'English'}</Text></Pressable>)}</View>
            {localeError && <Notice tone="warning" title={_(/* i18n */ { id: 'settings.languageSaveFailed', message: '언어 설정을 저장하지 못했습니다. 다시 선택해 주세요.' })}>{_(/* i18n */ { id: 'settings.languageSaveHint', message: '현재 언어를 유지합니다. 앱을 다시 열기 전에 언어를 다시 선택해 주세요.' })}</Notice>}
          </Panel>
          <Panel><Heading subtitle={_(/* i18n */ { id: 'native.settings.01', message: '인증 토큰은 앱을 닫으면 지워집니다.' })}>{_(/* i18n */ { id: 'native.settings.06', message: '연결 설정' })}</Heading><Field label={_(/* i18n */ { id: 'native.settings.02', message: 'GraphQL 주소' })} value={endpoint} onChangeText={setEndpoint} editable={!busy} autoCapitalize="none" autoCorrect={false} keyboardType="url" hint={_(/* i18n */ { id: 'native.settings.03', message: '실제 기기에서는 컴퓨터의 LAN 주소를 사용하세요. localhost는 기기 자신입니다.' })} />
            <Field label={_(/* i18n */ { id: 'native.settings.04', message: '인증 토큰' })} value={token} onChangeText={setToken} editable={!busy} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="none" autoComplete="off" />
            <Button variant="primary" disabled={busy || !settingsReady} onPress={() => void applyConnection()}>{_(/* i18n */ { id: 'native.settings.07', message: '연결 적용 · 주소 기억' })}</Button>
            <Button disabled={busy} onPress={() => { setToken(''); setConnection({ ...connection, token: '', verified: false }); setHealth(null); setNotice(/* i18n */ { id: 'native.settings.30', message: '이 실행의 인증 토큰을 지웠습니다.' }); }}>{_(/* i18n */ { id: 'native.settings.08', message: '인증 토큰 지우기' })}</Button>
          </Panel>
          <Panel><Heading>{_(/* i18n */ { id: 'native.settings.09', message: '연결 상태' })}</Heading><Button disabled={busy} onPress={() => void loadHealth()}>{_(/* i18n */ { id: 'native.settings.10', message: '상태 새로고침' })}</Button>
            <Text selectable style={textStyles.strong}>{_(/* i18n */ { id: 'native.settings.31.sentence', message: "현재 사용 중인 주소: {value0}", values: { value0: connection.endpoint } })}</Text>
            {!!healthError && <Notice title={_(/* i18n */ { id: 'native.settings.05', message: '연결 상태를 확인하지 못했어요' })} tone="danger">{renderMessage(healthError)}</Notice>}
            <Text selectable style={textStyles.caption}>{_(/* i18n */ { id: 'native.settings.32.sentence', message: "원장 식별자 {value0} · {value1}", values: { value0: connection.ledgerId ?? _(/* i18n */ { id: 'native.settings.22', message: '연결 확인 전' }), value1: connection.verified ? _(/* i18n */ { id: 'native.settings.23', message: '이 실행에서 인증 확인' }) : _(/* i18n */ { id: 'native.settings.24', message: '새 인증 확인 필요' }) } })}</Text>
            <Text style={textStyles.strong}>{_(/* i18n */ { id: 'native.settings.33.sentence', message: "서버 상태 {value0} · 원장 연결 {value1}", values: { value0: health?.status ?? _(/* i18n */ { id: 'native.settings.25', message: '확인 전' }), value1: health?.connectionStatus ?? 'UNKNOWN' } })}</Text>
            <Text style={textStyles.muted}>{_(/* i18n */ { id: 'native.settings.34.sentence', message: "마지막 성공 동기화 {value0}", values: { value0: health?.lastSuccessfulSyncAt ?? _(/* i18n */ { id: 'native.settings.26', message: '성공 이력 없음·확인되지 않음' }) } })}</Text>
            <Text style={textStyles.caption}>{_(/* i18n */ { id: 'native.settings.35.sentence', message: "서버 버전 {value0} · 인덱서 지연 {value1}", values: { value0: health?.version ?? _(/* i18n */ { id: 'native.settings.27', message: '확인 전' }), value1: health?.indexerLagSeconds == null ? _(/* i18n */ { id: 'native.settings.28', message: '알 수 없음' }) : _(/* i18n */ { id: 'native.settings.38', message: '초' }) + ` ${health.indexerLagSeconds}` } })}</Text>
            <Text style={textStyles.caption}>{_(/* i18n */ { id: 'native.settings.11', message: '상태 조회 성공과 원장 읽기·쓰기 권한은 별도로 확인됩니다.' })}</Text>
          </Panel>
        </>}
        {screen === 'sync' && <>
          <Panel><Heading subtitle={_(/* i18n */ { id: 'native.ledgerapp.sync.hint', message: "자동 재전송하지 않습니다. 확인 필요 거래는 같은 키로 원장 결과를 조회·재시도합니다." })}>{_(/* i18n */ { id: 'native.ledgerapp.sync.title', message: "기기에 저장한 거래" })}</Heading>
            {queue.length === 0 && queueReady && <Text style={textStyles.muted}>{_(/* i18n */ { id: 'native.ledgerapp.sync.empty', message: "기기에 저장한 거래가 없습니다." })}</Text>}
            {queue.map(record => <View key={record.id} style={styles.fact}><Text style={textStyles.strong}>{record.input.description}</Text><Text style={textStyles.caption}>{_(/* i18n */ { id: 'native.ledgerapp.sync.postingLabel.sentence', message: "{value0} · 내역 {value1}개", values: { value0: record.input.date, value1: record.input.postings.length } })}</Text>
              <Badge tone={record.state === 'succeeded' ? 'success' : record.state === 'blocked' || record.state === 'needsReview' ? 'warning' : 'neutral'}>{queueNames[record.state]}</Badge>
              <Text selectable style={textStyles.caption}>{_(/* i18n */ { id: 'native.ledgerapp.sync.endpoint.sentence', message: "연결 {value0}", values: { value0: record.endpoint } })}</Text><Text selectable style={textStyles.caption}>{_(/* i18n */ { id: 'native.ledgerapp.sync.requestKey.sentence', message: "요청 키 {value0}", values: { value0: record.id } })}</Text>
              {record.message && <Text style={textStyles.muted}>{formatOutboxMessage(record)}</Text>}
              {record.endpoint !== client.identity && <Text style={textStyles.muted}>{_(/* i18n */ { id: 'native.ledgerapp.sync.otherEndpoint', message: "현재 연결과 다릅니다. 원래 주소로 연결한 후 재시도해 주세요." })}</Text>}
              {record.state !== 'succeeded' && <Button disabled={busy || !queueReady || record.endpoint !== client.identity || !connection.verified} onPress={() => void queueAction(async () => { const result = await outbox.retry(record.id); setNotice(result.state === 'succeeded' ? (/* i18n */ { id: 'native.ledgerapp.sync.confirmed', message: "원장에서 거래 저장을 확인했습니다." }) : { state: result.state }); })}>{_(/* i18n */ { id: 'native.ledgerapp.sync.retry', message: "같은 요청 키로 확인·재시도" })}</Button>}
              <Button disabled={busy || blocksFreshRequest(queue, submittedId, record.input)} onPress={() => copy(record.input)}>{_(/* i18n */ { id: 'native.ledgerapp.sync.copy', message: "내용을 새 거래로 복사" })}</Button>
              {(record.state === 'queued' || record.state === 'blocked' || record.state === 'succeeded') && <Button disabled={busy} onPress={() => void queueAction(() => outbox.discard(record.id))}>{record.state === 'succeeded' ? _(/* i18n */ { id: 'native.ledgerapp.sync.clearRecord', message: "기기 기록 지우기" }) : _(/* i18n */ { id: 'native.ledgerapp.sync.clearQueued', message: "대기 요청 지우기" })}</Button>}
              {record.state === 'needsReview' && <Text style={textStyles.caption}>{_(/* i18n */ { id: 'native.ledgerapp.sync.retainUncertain', message: "불명확한 요청 기록을 유지합니다. 원장 거래 목록에서 결과를 확인한 뒤 같은 키로 재시도하세요." })}</Text>}
            </View>)}
          </Panel>
        </>}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView></AssetMetadataProvider>;
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return <View style={styles.toggle}><Text style={[textStyles.body, styles.flex]}>{label}</Text><Switch accessibilityLabel={label} value={value} onValueChange={onChange} /></View>;
}
const styles = StyleSheet.create({
  flex: { flex: 1 }, safe: { flex: 1, backgroundColor: tokens.colors.background },
  page: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: tokens.space.lg, paddingBottom: tokens.space.xxl, gap: tokens.space.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: tokens.space.sm },
  brand: { color: tokens.colors.text, fontSize: 24, fontWeight: '600' },
  navigation: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.xs, padding: tokens.space.xs, borderRadius: tokens.radius.panel, backgroundColor: tokens.colors.surfaceSubtle },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm }, fields: { gap: tokens.space.md },
  feature: { backgroundColor: tokens.colors.featureBackground, borderRadius: tokens.radius.feature, padding: tokens.space.xl, gap: tokens.space.md },
  featureLabel: { ...tokens.typography.label, color: tokens.colors.featureText }, featureMuted: { ...tokens.typography.supporting, color: tokens.colors.featureMuted },
  featureAmount: { ...tokens.typography.hero, color: tokens.colors.featureText, fontVariant: ['tabular-nums'], flexShrink: 1, maxWidth: '100%' },
  filterPanel: { paddingVertical: tokens.space.sm, gap: tokens.space.sm },
  filterSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: tokens.space.xs },
  filterFields: { gap: tokens.space.lg, paddingBottom: tokens.space.sm },
  fact: { gap: tokens.space.sm, borderTopWidth: 1, borderColor: tokens.colors.border, paddingTop: tokens.space.md },
  posting: { padding: tokens.space.md, gap: tokens.space.md, borderRadius: tokens.radius.control, backgroundColor: tokens.colors.background },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.md, minHeight: tokens.size.controlMin },
});
