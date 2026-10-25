import { createPortal } from 'react-dom';
import { useLingui } from '../../../packages/i18n/src/react';
import { translateError } from '../../../packages/i18n/src';
import type { MessageDescriptor } from '@lingui/core';
import { useEffect, useRef, useState, useCallback, lazy, Suspense, type FormEvent } from 'react';
import { createLedgerClient, isValidBookConfirmation, newIdempotencyKey, subtractDecimals, type BooksQuery, type PurchaseBookInput, type DisposeBookInput } from '../../../packages/client/index';
import { normalizeBookCoverUrl } from '../../../packages/domain/src/book-cover-url';
import { normalizeIsbn } from '../../../packages/domain/src/books';



import { Button, Notice } from '../../../packages/ui-web/src/index';
import { ExplicitBookLookup } from './book-lookup';
import { acceptsBooksFeature, updateBooksFeature, inspectPending, readPending } from './book-recovery';
type BookNotice = string | MessageDescriptor;

type Client = ReturnType<typeof createLedgerClient>;
type Book = NonNullable<BooksQuery['books']>[number];
type Request = { kind: 'purchase'; input: PurchaseBookInput } | { kind: 'dispose'; input: DisposeBookInput };
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const blankPurchase = () => ({ date: today(), isbn: '', title: '', authors: '', coverUrl: '', price: '', currency: 'KRW', assetAccount: 'assets:books', cashAccount: '' });
export const blankDisposal = () => ({ date: today(), kind: 'SELL', proceeds: '', fee: '0', cashAccount: '', gainAccount: 'income:books', lossAccount: 'expenses:books', feeAccount: 'expenses:fees' });
const amount = (value: string) => /^\d+(?:\.\d+)?$/.test(value) && value.length <= 100;



function safeBookUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
function safeBookCoverUrl(value?: string | null): string | undefined {
  return normalizeBookCoverUrl(value) ?? undefined;
}
export const booksModule = { moduleId: 'books', version: 1, load: () => import('./Books') };
export const builtInBookModules = [booksModule] as const;
export function useBookController({ client, revision, disabled, enabled, lookupAllowed, onPendingChange, onChanged, onCapabilityRefresh }: { client: Client; revision: number; disabled: boolean; enabled: boolean; lookupAllowed: boolean; onPendingChange: (pending: boolean) => void; onChanged: () => void; onCapabilityRefresh: () => void }) {
  const { _ } = useLingui();
  function displayNotice(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'id' in value) return _(value as MessageDescriptor);
    return translateError(value);
  }
  const storageKey = `hledger.book-request:${client.identity}`;
  const [recovery] = useState(() => readPending(storageKey));
  const [pending, setPending] = useState<Request | null>(recovery.request);
  const [storageError, setStorageError] = useState<BookNotice>(recovery.error);
  const [purchase, setPurchase] = useState(blankPurchase);
  const automaticAuthors = useRef<string[] | null>(null);
  const manualMetadata = useRef({ title: false, authors: false });
  const lookupRequest = useRef(new ExplicitBookLookup());
  const [lookup, setLookup] = useState<{ status: 'idle' | 'loading' | 'found' | 'missing' | 'unavailable'; isbn?: string; sourceUrl?: string | null; coverSource?: string | null; coverSourceUrl?: string | null; attribution?: string | null }>({ status: 'idle' });
  const [disposal, setDisposal] = useState(blankDisposal);
  const [selected, setSelected] = useState('');
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<BookNotice>('');
  const [message, setMessage] = useState<BookNotice>('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('ALL');
  const busy = useRef(false);
  useEffect(() => { onPendingChange(Boolean(pending || saving || storageError)); }, [pending, saving, storageError, onPendingChange]);
  useEffect(() => {
    if (!enabled) return;
    let active = true; setLoading(true); setLoadError('');
    client.books().then((result) => { if (!active) return; if (result.data?.books) setBooks(result.data.books); if (result.errors?.some(error => error.extensions?.code === 'FEATURE_DISABLED')) onCapabilityRefresh(); setLoadError(result.errors?.map((error) => error.message).join(' · ') || (!result.data?.books ? /* i18n */ { id: 'web.books.6', message: "책 목록을 확인하지 못했습니다." } : '')); }).catch(() => { if (active) setLoadError(/* i18n */ { id: 'web.books.7', message: "책 목록을 읽지 못했습니다. 연결 상태를 확인해 주세요." }); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, revision, enabled]);
  const book = books.find((item) => item.id === selected);
  const locked = !enabled || disabled || saving || Boolean(pending || storageError);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  let normalizedIsbn = '';
  try { normalizedIsbn = normalizeIsbn(purchase.isbn); } catch { /* Incomplete ISBNs need no remote request. */ }
  useEffect(() => {
    if (!lookupAllowed || locked) {
      lookupRequest.current.cancel();
      setLookup(current => current.status === 'loading' ? { status: 'idle' } : current);
    }
    return () => { lookupRequest.current.cancel(); };
  }, [client, normalizedIsbn, locked, lookupAllowed]);
  function startLookup() {
    if (!lookupAllowed || !normalizedIsbn || locked) return;
    setLookup({ status: 'loading', isbn: normalizedIsbn });
    void lookupRequest.current.start(() => client.bookMetadata(normalizedIsbn), result => {
      if (lockedRef.current || busy.current) return;
      const metadata = result.data?.bookMetadata;
      if (result.errors?.some(error => error.extensions?.code === 'FEATURE_DISABLED')) onCapabilityRefresh();
      if (result.errors?.length || !metadata || metadata.status === 'UNAVAILABLE') { setLookup({ status: 'unavailable', isbn: normalizedIsbn }); return; }
      if (metadata.status !== 'FOUND' || !metadata.book || metadata.book.isbn !== normalizedIsbn) { setLookup({ status: 'missing', isbn: normalizedIsbn }); return; }
      const found = metadata.book;
      automaticAuthors.current = found.authors;
      setLookup({ status: 'found', isbn: normalizedIsbn, sourceUrl: found.sourceUrl, coverSource: found.coverSource, coverSourceUrl: found.coverSourceUrl, attribution: found.attribution });
      setPurchase(current => ({ ...current, title: manualMetadata.current.title ? current.title : found.title, authors: manualMetadata.current.authors ? current.authors : found.authors.join('; '), coverUrl: safeBookCoverUrl(found.coverUrl) ?? '' }));
    }, () => { if (!lockedRef.current && !busy.current) setLookup({ status: 'unavailable', isbn: normalizedIsbn }); });
  }
  function updatePurchase(key: keyof typeof purchase, value: string) {
    if (locked) return;
    if (key === 'title' || key === 'authors') manualMetadata.current[key] = true;
    if (key === 'isbn') {
      let nextIsbn = ''; try { nextIsbn = normalizeIsbn(value); } catch { /* Partial input clears stale metadata. */ }
      if (nextIsbn !== normalizedIsbn) { automaticAuthors.current = null; lookupRequest.current.cancel(); setLookup({ status: 'idle' }); setPurchase((current) => ({ ...current, isbn: value, title: manualMetadata.current.title ? current.title : '', authors: manualMetadata.current.authors ? current.authors : '', coverUrl: '' })); return; }
    }
    setPurchase((current) => ({ ...current, [key]: value }));
  }
  let net: string | undefined; let gain: string | undefined;
  if (book && amount(disposal.proceeds) && amount(disposal.fee)) { net = subtractDecimals(disposal.proceeds, disposal.fee); gain = subtractDecimals(net, book.purchasePrice.value); }
  async function send(request: Request) {
    if (busy.current || !enabled || disabled || storageError || (pending && JSON.stringify(pending) !== JSON.stringify(request))) return;
    // Persist the exact request and key before any network write, including retries.
    try { localStorage.setItem(storageKey, JSON.stringify(request)); }
    catch { setStorageError(/* i18n */ { id: 'web.books.8', message: "확인 정보를 브라우저에 보관하지 못해 요청을 보내지 않았습니다. 저장소 접근을 복구한 뒤 다시 열어 주세요." }); return; }
    const wasPending = pending !== null;
    busy.current = true; setSaving(true); setPending(request); onPendingChange(true); setMessage('');
    try {
      const result = request.kind === 'purchase' ? await client.purchaseBook(request.input) : await client.disposeBook(request.input);
      onCapabilityRefresh();
      const payload = result.data && ('purchaseBook' in result.data ? result.data.purchaseBook : result.data.disposeBook);
      if (isValidBookConfirmation(payload, request.input.idempotencyKey)) {
        try { localStorage.removeItem(storageKey); } catch { setStorageError(/* i18n */ { id: 'web.books.9', message: "저장은 확인했지만 재시도 정보를 지우지 못했습니다. 브라우저 저장소를 복구해 주세요." }); }
        setPending(null); automaticAuthors.current = null; manualMetadata.current = { title: false, authors: false }; setPurchase(blankPurchase()); setSelected(''); setDisposal(blankDisposal()); setMessage(/* i18n */ { id: 'web.books.10', message: "책 기록을 원장에 저장했습니다." }); onChanged();
      } else if (!wasPending && payload?.errors.length && !payload.book && !payload.errors.some(error => error.code === 'FEATURE_DISABLED')) {
        try { localStorage.removeItem(storageKey); setPending(null); } catch { setStorageError(/* i18n */ { id: 'web.books.11', message: "거부된 요청의 확인 정보를 지우지 못했습니다. 브라우저 저장소를 복구해 주세요." }); }
        setMessage(payload.errors.map((error) => error.message).join(' · '));
      } else {
        // Even a rejected retry must not replace an earlier unknown write.
        setMessage(/* i18n */ { id: 'web.books.unconfirmed', message: '저장 결과를 확인해야 합니다. 같은 요청으로 다시 확인해 주세요.{detail}', values: { detail: payload?.errors.length ? ` ${payload.errors.map((error) => error.message).join(' · ')}` : '' } });
      }
    } catch { onCapabilityRefresh(); setMessage(/* i18n */ { id: 'web.books.12', message: "저장 결과가 불명확합니다. 입력과 요청 키를 보관했습니다. 같은 요청으로 결과를 확인해 주세요." }); }
    finally { busy.current = false; setSaving(false); }
  }
  function submitPurchase(event: FormEvent) {
    event.preventDefault(); if (locked) return;
    try { normalizeIsbn(purchase.isbn); } catch { setMessage(/* i18n */ { id: 'web.books.13', message: "유효한 ISBN-10 또는 ISBN-13을 입력해 주세요." }); return; }
    if (!purchase.title.trim() || [...purchase.title.trim()].length > 200 || !purchase.date || !amount(purchase.price) || !/[1-9]/.test(purchase.price) || !purchase.currency.trim() || !purchase.assetAccount.trim() || !purchase.cashAccount.trim()) { setMessage(/* i18n */ { id: 'web.books.14', message: "제목, 날짜, 양수인 구입 금액, 통화와 계좌를 입력해 주세요." }); return; }
    const authors = !manualMetadata.current.authors && automaticAuthors.current ? automaticAuthors.current : purchase.authors.split(';').map((name) => name.trim()).filter(Boolean);
    if (authors.length > 20 || authors.some((name) => name.length > 200)) { setMessage(/* i18n */ { id: 'web.books.15', message: "저자는 20명까지, 각 이름은 200자까지 입력해 주세요." }); return; }
    void send({ kind: 'purchase', input: { idempotencyKey: newIdempotencyKey(), date: purchase.date, isbn: purchase.isbn, title: purchase.title.trim(), authors, ...(purchase.coverUrl ? { coverUrl: purchase.coverUrl } : {}), purchasePrice: { value: purchase.price, commodity: purchase.currency.trim() }, assetAccount: purchase.assetAccount.trim(), cashAccount: purchase.cashAccount.trim() } });
  }
  function submitDisposal(event: FormEvent) {
    event.preventDefault(); if (locked || !book) return;
    const sell = disposal.kind === 'SELL';
    if (!disposal.date || !disposal.lossAccount.trim() || (sell && (!amount(disposal.proceeds) || !amount(disposal.fee) || !disposal.cashAccount.trim() || !disposal.gainAccount.trim() || (/[1-9]/.test(disposal.fee) && !disposal.feeAccount.trim())))) { setMessage(/* i18n */ { id: 'web.books.16', message: "처분 날짜와 손실 비용 항목, 판매 금액과 필요한 계좌를 확인해 주세요." }); return; }
    void send({ kind: 'dispose', input: { idempotencyKey: newIdempotencyKey(), copyId: book.id, date: disposal.date, kind: sell ? 'SELL' : 'DISCARD', lossAccount: disposal.lossAccount.trim(), ...(sell ? { cashAccount: disposal.cashAccount.trim(), saleProceeds: { value: disposal.proceeds, commodity: book.purchasePrice.commodity }, fee: disposal.fee, feeAccount: disposal.feeAccount.trim(), gainAccount: disposal.gainAccount.trim() } : {}) } });
  }
  async function recover() {
    if (!pending || saving || storageError) return;
    setSaving(true);
    try { if (await inspectPending(pending, storageKey, async request => (await client.bookRequestStatus(request)).data?.bookRequestStatus, localStorage)) { setPending(null); onChanged(); } } catch { /* Unknown outcomes retain the exact durable request. */ } finally { setSaving(false); }
  }
  return { displayNotice, storageError, message, pending, saving, send, purchase, updatePurchase, disposal, setDisposal, selected, setSelected, books, loading, loadError, locked, normalizedIsbn, lookup, startLookup, net, gain, book, status, setStatus, submitPurchase, submitDisposal, setMessage, disabled, recover };
}
export type BookController = ReturnType<typeof useBookController>;

const LazyBooks = lazy(() => booksModule.load().then(module => ({ default: module.Books })));
export function BookModuleHost({ client, ledgerId, revision, settings, visible, disabled, onPendingChange, onChanged, onEnabled }: { client: Client; ledgerId: string; revision: number; settings: boolean; visible: boolean; disabled: boolean; onPendingChange: (pending: boolean) => void; onChanged: () => void; onEnabled: (enabled: boolean) => void }) {
  const { _ } = useLingui();
  const [feature, setFeature] = useState<Awaited<ReturnType<Client['ledgerFeatures']>>['data']>();
  const [featureError, setFeatureError] = useState(false);
  const [changing, setChanging] = useState(false);
  const [operationError, setOperationError] = useState(false);
  const refreshSerial = useRef(0);
  const refresh = useCallback(() => { const serial = ++refreshSerial.current; setFeature(undefined); void client.ledgerFeatures().then(result => { if (serial !== refreshSerial.current) return; if (result.errors?.length || result.data?.ledgerFeatures.ledgerId !== ledgerId || !acceptsBooksFeature(result.data?.ledgerFeatures.books)) { setFeatureError(true); return; } setFeature(result.data); setFeatureError(false); }).catch(() => { if (serial === refreshSerial.current) setFeatureError(true); }); }, [client, ledgerId]);
  const capabilities = acceptsBooksFeature(feature?.ledgerFeatures.books) ? feature!.ledgerFeatures.books : undefined;
  const enabled = capabilities?.enabled === true && capabilities.moduleId === booksModule.moduleId && capabilities.canRead === true;
  const controller = useBookController({ client, revision, enabled, lookupAllowed: visible && !settings && capabilities?.canLookupMetadata === true, disabled: disabled || changing || !capabilities?.canWrite, onPendingChange, onChanged, onCapabilityRefresh: refresh });
  useEffect(() => { refresh(); return () => { refreshSerial.current++; }; }, [refresh, revision]);
  useEffect(() => { onEnabled(enabled); }, [enabled, onEnabled]);
  useEffect(() => { const update = () => refresh(); window.addEventListener('online', update); return () => window.removeEventListener('online', update); }, [refresh]);
  async function toggle() {
    if (!capabilities || changing || (enabled && (controller.pending || controller.storageError || controller.saving))) return;
    setChanging(true); setOperationError(false);
    const updated = await updateBooksFeature(() => client.setBooksEnabled(!enabled, capabilities.version, Boolean(controller.pending || controller.storageError || controller.saving)), refresh);
    setOperationError(!updated); setChanging(false);
  }
  const moduleTarget = document.getElementById('books-module-content');
  return <>
    {settings && <section><h3>{_(/* i18n */ { id: 'books.module.optional', message: '선택 기능 · 책' })}</h3><Button disabled={!capabilities || changing || Boolean(enabled && (controller.pending || controller.storageError || controller.saving))} onClick={() => void toggle()}>{enabled ? _(/* i18n */ { id: 'books.module.disable', message: '책 기능 끄기' }) : _(/* i18n */ { id: 'books.module.enable', message: '책 기능 켜기' })}</Button>{(featureError || operationError) && <p role="alert">{_(/* i18n */ { id: 'books.module.capabilityError', message: '책 기능 상태를 확인하지 못했습니다. 다시 연결해 주세요.' })}</p>}</section>}
    {(controller.pending || controller.storageError) && <section><Notice title={_(/* i18n */ { id: 'books.recovery.required', message: '책 요청 결과 확인 필요' })}>{controller.displayNotice(controller.storageError) || _(/* i18n */ { id: 'books.recovery.retained', message: '같은 요청과 키를 보관했습니다. 결과가 불명확하면 책 기능을 켠 뒤 명시적으로 다시 보내세요.' })}</Notice><Button disabled={!controller.pending || controller.saving || Boolean(controller.storageError)} onClick={() => void controller.recover()}>{_(/* i18n */ { id: 'books.recovery.inspect', message: '저장 결과만 확인' })}</Button></section>}
    {enabled && visible && !settings && moduleTarget && createPortal(<Suspense fallback={null}><LazyBooks controller={controller} /></Suspense>, moduleTarget)}
  </>;
}
