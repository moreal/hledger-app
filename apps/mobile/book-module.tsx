import { useLingui } from '../../packages/i18n/src/react';
import { translateError } from '../../packages/i18n/src';
import type { MessageDescriptor } from '@lingui/core';
import { useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { createLedgerClient, newIdempotencyKey, type BooksQuery } from '../../packages/client';
import { normalizeBookCoverUrl } from '../../packages/domain/src/book-cover-url';
import { normalizeIsbn } from '../../packages/domain/src/books';
import { Button, Notice, Panel, nativeStyles as styles } from '../../packages/ui-native/src';
import { createDurableStorage } from './storage';
import { bookDate as parseDate, bookDecimal as decimal, bookIsbn } from './book-validation';


type BookNotice = string | MessageDescriptor | Error | { retryCause: unknown };
class BookUiError extends Error { constructor(readonly descriptor: MessageDescriptor) { super(typeof descriptor.message === 'string' ? descriptor.message : descriptor.id); } }

type Client = ReturnType<typeof createLedgerClient>;
type Pending = PendingBook;
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const errorNotice = (error: unknown): BookNotice => error instanceof Error ? error : /* i18n */ { id: 'native.books.1', message: '요청을 확인하지 못했습니다.' };

import { acceptsBooksFeature, canTransmitBook, confirmsPendingBook, parsePendingBook, type PendingBook, type BooksFeature } from './book-recovery';

export function useBookController({ client, verified, active, feature, refreshFeature }: { client: Client; verified: boolean; active: boolean; feature: BooksFeature | null; refreshFeature: () => Promise<void> }) {
  const current = useRef({ client, feature }); current.current = { client, feature };
  const [draftIdentity, setDraftIdentity] = useState<string | null>(null);
  useEffect(() => { if (verified && feature?.enabled) setDraftIdentity(identity => identity ?? client.identity); }, [verified, feature, client.identity]);
  const storage = useMemo(() => createDurableStorage('books-pending-v1'), []);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState<BookNotice>('');
  const [books, setBooks] = useState<NonNullable<BooksQuery['books']>>([]);
  const [loadedIdentity, setLoadedIdentity] = useState('');
  const [date, setDate] = useState(today);
  const [isbn, setIsbn] = useState('');
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [metadata, setMetadata] = useState<{ isbn: string; coverUrl?: string | null; sourceUrl: string; attribution: string; coverSource?: string | null; coverSourceUrl?: string | null } | null>(null);
  const [metadataMessage, setMetadataMessage] = useState<BookNotice>('');
  const metadataGeneration = useRef(0);
  const titleEdited = useRef(false);
  const authorsEdited = useRef(false);
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('KRW');
  const [assetAccount, setAssetAccount] = useState('assets:books');
  const [cashAccount, setCashAccount] = useState('assets:cash');
  const [selected, setSelected] = useState('');
  const [kind, setKind] = useState<'SELL' | 'DISCARD'>('SELL');
  const [proceeds, setProceeds] = useState('');
  const [fee, setFee] = useState('0');
  const [gainAccount, setGainAccount] = useState('income:books:gain');
  const [lossAccount, setLossAccount] = useState('expenses:books:loss');
  const [feeAccount, setFeeAccount] = useState('expenses:books:fees');
  const locked = (draftIdentity !== null && draftIdentity !== client.identity) || busy || !ready || pending !== null || !feature?.enabled || !feature.canWrite;
  function changeIsbn(value: string) {
    metadataGeneration.current++; setIsbn(value); setMetadata(null); setMetadataMessage('');
    if (!titleEdited.current) setTitle('');
    if (!authorsEdited.current) setAuthors('');
  }
  async function lookupMetadata() {
    const generation = ++metadataGeneration.current;
    if (!active || !verified || locked || selected || !feature?.canLookupMetadata) return;
    let canonical: string;
    try { canonical = normalizeIsbn(isbn); } catch { return; }
    {
      setMetadataMessage(/* i18n */ { id: 'native.books.2', message: "책 정보를 찾고 있습니다…" });
      void client.bookMetadata(canonical).then(result => {
        if (metadataGeneration.current !== generation || current.current.client !== client || !current.current.feature?.enabled) return;
        const lookup = result.data?.bookMetadata;
        if (result.errors?.length || !lookup) throw new BookUiError(/* i18n */ { id: 'native.books.3', message: "책 정보를 가져오지 못했습니다. 직접 입력할 수 있습니다." });
        if (lookup.status !== 'FOUND' || !lookup.book) { setMetadataMessage(lookup.message || /* i18n */ { id: 'native.books.4', message: "책 정보를 찾지 못했습니다. 제목과 저자를 직접 입력해 주세요." }); return; }
        const book = lookup.book;
        if (normalizeIsbn(book.isbn) !== canonical) throw new BookUiError(/* i18n */ { id: 'native.books.5', message: "조회된 ISBN이 다릅니다. 직접 입력해 주세요." });
        if (!titleEdited.current) setTitle(book.title);
        if (!authorsEdited.current) setAuthors(book.authors.join('\n'));
        setMetadata({ isbn: canonical, coverUrl: normalizeBookCoverUrl(book.coverUrl), sourceUrl: book.sourceUrl, attribution: book.attribution, coverSource: book.coverSource, coverSourceUrl: book.coverSourceUrl });
        setMetadataMessage(/* i18n */ { id: 'native.books.6', message: "책 정보를 채웠습니다. 내용을 확인해 주세요." });
      }).catch(error => { if (metadataGeneration.current === generation && current.current.client === client) { setMetadataMessage(errorNotice(error)); void refreshFeature(); } });
    }
  }
  useEffect(() => () => { metadataGeneration.current++; }, [client, active, feature]);
  useEffect(() => { metadataGeneration.current++; }, [client.identity]);
  useEffect(() => { void storage.load().then(raw => { setPending(parsePendingBook(raw)); setReady(true); }).catch(() => setMessage(/* i18n */ { id: 'native.books.recovery.storageCorrupt', message: '보관된 책 요청을 읽지 못했습니다. 원본을 보존하고 새 요청과 비활성화를 잠급니다.' })); }, [storage]);
  async function refresh() {
    if (!verified || !feature?.enabled || !feature.canRead) return;
    const identity = client.identity;
    try { const result = await client.books(); if (!result.data || result.errors?.length) throw result.errors?.length ? new Error(result.errors.map(item => item.message).join('\n')) : new BookUiError(/* i18n */ { id: 'native.books.8', message: '책 목록 응답이 없습니다.' }); if (!result.data.books) throw new BookUiError(/* i18n */ { id: 'native.books.9', message: "책 목록 응답이 없습니다." }); if (current.current.client !== client || !current.current.feature?.enabled) return; setBooks(result.data.books); setLoadedIdentity(identity); } catch (error) { if (current.current.client === client) { setMessage(errorNotice(error)); void refreshFeature(); } }
  }
  useEffect(() => { if (active && verified && feature?.enabled) void refresh(); }, [active, verified, client, feature]);
  async function send(request: Pending) {
    if (inFlight.current || !canTransmitBook(request, client.identity, verified, ready, feature) || (pending && JSON.stringify(pending) !== JSON.stringify(request))) return;
    inFlight.current = true; setBusy(true);
    try {
      const preserved = parsePendingBook(JSON.stringify(request))!;
      setPending(preserved); await storage.save(JSON.stringify(preserved));
      if (!canTransmitBook(preserved, current.current.client.identity, verified && current.current.client === client, ready, current.current.feature)) return;
      const result = preserved.kind === 'purchase' ? await client.purchaseBook(preserved.input) : await client.disposeBook(preserved.input);
      const payload = result.data && ('purchaseBook' in result.data ? result.data.purchaseBook : result.data.disposeBook);
      if (!payload || result.errors?.length || !payload.book || payload.errors.length || payload.idempotency?.key !== request.input.idempotencyKey) throw result.errors?.length || payload?.errors.length ? new Error(result.errors?.map(item => item.message).join('\n') || payload?.errors.map(item => item.message).join('\n')) : new BookUiError(/* i18n */ { id: 'native.books.10', message: '저장 결과가 불명확합니다. 같은 요청으로 확인해 주세요.' });
      await storage.save('null'); setPending(null); if (current.current.client !== client) return; setSelected(''); if (request.kind === 'purchase') { changeIsbn(''); setTitle(''); setAuthors(''); titleEdited.current = false; authorsEdited.current = false; } setMessage(/* i18n */ { id: 'native.books.11', message: "책과 원장 거래를 저장했습니다." }); await refresh();
    } catch (error) { if (current.current.client === client) setMessage({ retryCause: errorNotice(error) }); }
    finally { inFlight.current = false; setBusy(false); if (current.current.client === client) void refreshFeature(); }
  }
  function submit() {
    if (locked || !verified || !feature?.enabled || !feature.canWrite) return;
    try {
      parseDate(date); if (!cashAccount.trim() || !assetAccount.trim()) throw new BookUiError(/* i18n */ { id: 'native.books.12', message: "책 항목과 현금 항목을 입력해 주세요." });
      const authorNames = authors.split('\n').map(author => author.trim()).filter(Boolean);
      if (!selected && (authorNames.length > 20 || authorNames.some(author => author.length > 200))) throw new BookUiError(/* i18n */ { id: 'native.books.13', message: "저자는 최대 20명, 한 명당 200자까지 입력할 수 있습니다." });
      const idempotencyKey = newIdempotencyKey(randomUUID);
      if (!selected) { if (!title.trim() || title.length > 200) throw new BookUiError(/* i18n */ { id: 'native.books.14', message: "책 제목을 1~200자로 입력해 주세요." }); if (!currency.trim() || currency.length > 32) throw new BookUiError(/* i18n */ { id: 'native.books.15', message: "통화를 1~32자로 입력해 주세요." }); void send({ identity: client.identity, kind: 'purchase', input: { idempotencyKey, date, isbn: bookIsbn(isbn), title: title.trim(), authors: authorNames, ...(metadata ? { coverUrl: metadata.coverUrl ?? null } : {}), purchasePrice: { commodity: currency.trim(), value: decimal(price, true) }, assetAccount: assetAccount.trim(), cashAccount: cashAccount.trim() } }); }
      else { if (!lossAccount.trim() || (kind === 'SELL' && (!gainAccount.trim() || !feeAccount.trim()))) throw new BookUiError(/* i18n */ { id: 'native.books.16', message: "손익과 수수료 항목을 입력해 주세요." }); void send({ identity: client.identity, kind: 'dispose', input: { idempotencyKey, date, copyId: selected, kind, lossAccount: lossAccount.trim(), ...(kind === 'SELL' ? { cashAccount: cashAccount.trim(), saleProceeds: { commodity: currency.trim(), value: decimal(proceeds) }, fee: decimal(fee), gainAccount: gainAccount.trim(), feeAccount: feeAccount.trim() } : {}) } }); }
    } catch (error) { setMessage(errorNotice(error)); }
  }
  async function inspectPending() {
    if (!pending || busy || inFlight.current || !verified || pending.identity !== client.identity || !feature?.canRecover) return;
    inFlight.current = true; setBusy(true);
    try {
      const result = await client.bookRequestStatus(pending);
      if (result.errors?.length || !confirmsPendingBook(result.data?.bookRequestStatus, pending)) {
        if (current.current.client !== client) return;
        setMessage(/* i18n */ { id: 'native.books.recovery.unknown', message: '저장 결과가 아직 불명확합니다. 요청을 보관합니다. 전송하려면 책 기능을 켜고 원래 요청으로 재시도해 주세요.' }); return;
      }
      await storage.save('null'); setPending(null);
      if (current.current.client !== client) return;
      setMessage(/* i18n */ { id: 'native.books.recovery.confirmed', message: '원장에서 원래 책 요청의 저장을 확인했습니다.' });
    } catch (error) { if (current.current.client === client) setMessage(errorNotice(error)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return { draftMismatch: draftIdentity !== null && draftIdentity !== client.identity, identity: client.identity, ready, pending, busy, message, books, loadedIdentity, date, setDate, isbn, title, setTitle, authors, setAuthors, metadata, metadataMessage, price, setPrice, currency, setCurrency, assetAccount, setAssetAccount, cashAccount, setCashAccount, selected, setSelected, kind, setKind, proceeds, setProceeds, fee, setFee, gainAccount, setGainAccount, lossAccount, setLossAccount, feeAccount, setFeeAccount, locked, changeIsbn, titleEdited, authorsEdited, refresh, send, submit, lookupMetadata, inspectPending };
}
export type BookController = ReturnType<typeof useBookController>;

/** Fixed bundled entry: remote capability data can never load executable code. */
export const booksModule = Object.freeze({ id: 'books', migrationVersion: 1, Component: lazy(() => import('./Books').then(module => ({ default: module.Books }))) });
export function BookModuleView({ controller, feature, verified }: { controller: BookController; feature: BooksFeature | null; verified: boolean }) {
  if (!feature?.enabled || !feature.canRead || !acceptsBooksFeature(feature)) return null;
  const Component = booksModule.Component;
  return <Suspense fallback={null}><Component controller={controller} verified={verified} /></Suspense>;
}
export function useBooksFeature(client: Client, verified: boolean, ledgerId?: string) {
  const [snapshot, setSnapshot] = useState<{ identity: string; feature: BooksFeature } | null>(null);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const current = useRef(client); current.current = client;
  const generation = useRef(0);
  const feature = verified && snapshot?.identity === client.identity ? snapshot.feature : null;
  async function refresh() {
    const request = ++generation.current;
    setSnapshot(null); setFailed(false);
    if (!verified || !ledgerId) return;
    try {
      const result = await client.ledgerFeatures();
      if (current.current !== client || request !== generation.current) return;
      const value = result.data?.ledgerFeatures;
      if (result.errors?.length || !value || value.ledgerId !== ledgerId || !acceptsBooksFeature(value.books)) throw new Error('Invalid books feature');
      setSnapshot({ identity: client.identity, feature: value.books });
    } catch { if (current.current === client && request === generation.current) { setSnapshot(null); setFailed(true); } }
  }
  useEffect(() => { setWorking(false); void refresh(); return () => { generation.current++; }; }, [client, verified, ledgerId]);
  async function toggle(enabled: boolean, controller: BookController) {
    if (working || !verified || !feature || !controller.ready || controller.busy || (!enabled && controller.pending)) return;
    setWorking(true); setFailed(false);
    let updateFailed = false;
    try {
      const result = await client.setBooksEnabled(enabled, feature.version, controller.pending !== null);
      if (current.current !== client) return;
      if (result.errors?.length || !result.data?.setBooksEnabled || result.data.setBooksEnabled.errors.length || !acceptsBooksFeature(result.data.setBooksEnabled.feature)) throw new Error('Feature update rejected');
    } catch { updateFailed = true; if (current.current === client) setFailed(true); }
    finally { if (current.current === client) { setWorking(false); await refresh(); if (current.current === client && updateFailed) setFailed(true); } }
  }
  return { feature, working, failed, refresh, toggle };
}
function renderBookNotice(value: unknown, _: ReturnType<typeof useLingui>['_']): string {
  if (value instanceof Error && 'descriptor' in value) return _(value.descriptor as MessageDescriptor);
  if (value && typeof value === 'object' && 'retryCause' in value) return _(/* i18n */ { id: 'books.retryPreserved', message: '{detail}\n입력을 보관했습니다. 같은 요청 키로만 재시도합니다.', values: { detail: renderBookNotice(value.retryCause, _) } });
  if (value && typeof value === 'object' && 'id' in value) return _(value as MessageDescriptor);
  return translateError(value);
}
/** This core pane stays mounted even when the optional module has been removed. */
export function BookRecovery({ controller, client, verified, feature }: { controller: BookController; client: Client; verified: boolean; feature: BooksFeature | null }) {
  const { _ } = useLingui();
  if (controller.ready && !controller.pending && (feature?.enabled || !controller.message)) return null;
  return <Panel><Notice tone="warning" title={_(/* i18n */ { id: 'native.books.recovery.title', message: '책 요청 확인' })}>{controller.message ? renderBookNotice(controller.message, _) : _(/* i18n */ { id: 'native.books.recovery.preserved', message: '저장 결과를 확인할 때까지 원래 요청과 입력을 보관합니다.' })}</Notice>
    {controller.pending && <><Text selectable style={styles.caption}>{controller.pending.input.idempotencyKey}</Text><Text selectable style={styles.caption}>{controller.pending.identity}</Text>
      <Button disabled={controller.busy || !verified || controller.pending.identity !== client.identity || !feature?.canRecover} onPress={() => void controller.inspectPending()}>{_(/* i18n */ { id: 'native.books.recovery.inspect', message: '전송 없이 저장 결과 확인' })}</Button>
      <Button disabled={controller.busy || !canTransmitBook(controller.pending, client.identity, verified, controller.ready, feature)} onPress={() => void controller.send(controller.pending!)}>{_(/* i18n */ { id: 'native.books.recovery.retry', message: '같은 요청으로 재시도' })}</Button></>}
  </Panel>;
}
