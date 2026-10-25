import { useLingui } from '../../packages/i18n/src/react';
import { translateError } from '../../packages/i18n/src';
import type { MessageDescriptor } from '@lingui/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Linking, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { createLedgerClient, newIdempotencyKey, type PurchaseBookInput, type DisposeBookInput, type BooksQuery } from '../../packages/client';
import { normalizeBookCoverUrl } from '../../packages/domain/src/book-cover-url';
import { normalizeIsbn } from '../../packages/domain/src/books';
import { Badge, Button, Field, Heading, Money, Notice, Panel, nativeStyles as styles } from '../../packages/ui-native/src';
import { createDurableStorage } from './storage';
import { bookDate as parseDate, bookDecimal as decimal, bookIsbn } from './book-validation';


type BookNotice = string | MessageDescriptor | Error | { retryCause: unknown };
class BookUiError extends Error { constructor(readonly descriptor: MessageDescriptor) { super(typeof descriptor.message === 'string' ? descriptor.message : descriptor.id); } }

type Client = ReturnType<typeof createLedgerClient>;
type Pending = { identity: string } & ({ kind: 'purchase'; input: PurchaseBookInput } | { kind: 'dispose'; input: DisposeBookInput });
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const errorNotice = (error: unknown): BookNotice => error instanceof Error ? error : /* i18n */ { id: 'native.books.1', message: '요청을 확인하지 못했습니다.' };

export function Books({ client, verified, active }: { client: Client; verified: boolean; active: boolean }) {
  const { _ } = useLingui();
  function displayNotice(value: unknown): string {
    if (value instanceof Error && 'descriptor' in value) return _(value.descriptor as MessageDescriptor);
    if (value && typeof value === 'object' && 'retryCause' in value) return _(/* i18n */ { id: 'books.retryPreserved', message: '{detail}\n입력을 보관했습니다. 같은 요청 키로만 재시도합니다.', values: { detail: displayNotice(value.retryCause) } });
    if (typeof value === 'string') return translateError(value);
    if (value && typeof value === 'object' && 'id' in value) return _(value as MessageDescriptor);
    return translateError(value);
  }
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
  const [metadataRetry, setMetadataRetry] = useState(0);
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
  const locked = busy || !ready || pending !== null;
  function changeIsbn(value: string) {
    metadataGeneration.current++; setIsbn(value); setMetadata(null); setMetadataMessage('');
    if (!titleEdited.current) setTitle('');
    if (!authorsEdited.current) setAuthors('');
  }
  useEffect(() => {
    const generation = ++metadataGeneration.current;
    if (!active || !verified || locked || selected) return;
    let canonical: string;
    try { canonical = normalizeIsbn(isbn); } catch { return; }
    const timer = setTimeout(() => {
      setMetadataMessage(/* i18n */ { id: 'native.books.2', message: "책 정보를 찾고 있습니다…" });
      void client.bookMetadata(canonical).then(result => {
        if (metadataGeneration.current !== generation) return;
        const lookup = result.data?.bookMetadata;
        if (result.errors?.length || !lookup) throw new BookUiError(/* i18n */ { id: 'native.books.3', message: "책 정보를 가져오지 못했습니다. 직접 입력할 수 있습니다." });
        if (lookup.status !== 'FOUND' || !lookup.book) { setMetadataMessage(lookup.message || /* i18n */ { id: 'native.books.4', message: "책 정보를 찾지 못했습니다. 제목과 저자를 직접 입력해 주세요." }); return; }
        const book = lookup.book;
        if (normalizeIsbn(book.isbn) !== canonical) throw new BookUiError(/* i18n */ { id: 'native.books.5', message: "조회된 ISBN이 다릅니다. 직접 입력해 주세요." });
        if (!titleEdited.current) setTitle(book.title);
        if (!authorsEdited.current) setAuthors(book.authors.join('\n'));
        setMetadata({ isbn: canonical, coverUrl: normalizeBookCoverUrl(book.coverUrl), sourceUrl: book.sourceUrl, attribution: book.attribution, coverSource: book.coverSource, coverSourceUrl: book.coverSourceUrl });
        setMetadataMessage(/* i18n */ { id: 'native.books.6', message: "책 정보를 채웠습니다. 내용을 확인해 주세요." });
      }).catch(error => { if (metadataGeneration.current === generation) setMetadataMessage(errorNotice(error)); });
    }, 450);
    return () => { clearTimeout(timer); metadataGeneration.current++; };
  }, [isbn, metadataRetry, client, verified, active, locked, selected]);
  useEffect(() => { setSelected(''); setMetadata(null); metadataGeneration.current++; }, [client.identity]);
  useEffect(() => { void storage.load().then(raw => { if (raw) { const item = JSON.parse(raw) as Pending | null; if (item && (!item.identity || !item.input?.idempotencyKey || !['purchase', 'dispose'].includes(item.kind))) throw new BookUiError(/* i18n */ { id: 'native.books.7', message: "보관된 책 요청을 확인하지 못했습니다." }); setPending(item); } setReady(true); }).catch(error => setMessage(errorNotice(error))); }, [storage]);
  async function refresh() {
    if (!verified) return;
    const identity = client.identity;
    try { const result = await client.books(); if (!result.data || result.errors?.length) throw result.errors?.length ? new Error(result.errors.map(item => item.message).join('\n')) : new BookUiError(/* i18n */ { id: 'native.books.8', message: '책 목록 응답이 없습니다.' }); if (!result.data.books) throw new BookUiError(/* i18n */ { id: 'native.books.9', message: "책 목록 응답이 없습니다." }); setBooks(result.data.books); setLoadedIdentity(identity); } catch (error) { setMessage(errorNotice(error)); }
  }
  useEffect(() => { if (active && verified) void refresh(); }, [active, verified, client]);
  async function send(request: Pending) {
    if (inFlight.current || !verified || request.identity !== client.identity) return;
    const wasPending = pending !== null;
    inFlight.current = true; setBusy(true);
    try {
      await storage.save(JSON.stringify(request)); setPending(request);
      const result = request.kind === 'purchase' ? await client.purchaseBook(request.input) : await client.disposeBook(request.input);
      const payload = result.data && ('purchaseBook' in result.data ? result.data.purchaseBook : result.data.disposeBook);
      if (!wasPending && payload && !result.errors?.length && !payload.book && payload.errors.length > 0) {
        await storage.save('null'); setPending(null); setMessage(payload.errors.map(item => `${item.path}: ${item.message}`).join('\n')); return;
      }
      if (!payload || result.errors?.length || !payload.book || payload.errors.length || payload.idempotency?.key !== request.input.idempotencyKey) throw result.errors?.length || payload?.errors.length ? new Error(result.errors?.map(item => item.message).join('\n') || payload?.errors.map(item => item.message).join('\n')) : new BookUiError(/* i18n */ { id: 'native.books.10', message: '저장 결과가 불명확합니다. 같은 요청으로 확인해 주세요.' });
      await storage.save('null'); setPending(null); setSelected(''); if (request.kind === 'purchase') { changeIsbn(''); setTitle(''); setAuthors(''); titleEdited.current = false; authorsEdited.current = false; } setMessage(/* i18n */ { id: 'native.books.11', message: "책과 원장 거래를 저장했습니다." }); await refresh();
    } catch (error) { setMessage({ retryCause: errorNotice(error) }); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function submit() {
    try {
      parseDate(date); if (!cashAccount.trim() || !assetAccount.trim()) throw new BookUiError(/* i18n */ { id: 'native.books.12', message: "책 항목과 현금 항목을 입력해 주세요." });
      const authorNames = authors.split('\n').map(author => author.trim()).filter(Boolean);
      if (!selected && (authorNames.length > 20 || authorNames.some(author => author.length > 200))) throw new BookUiError(/* i18n */ { id: 'native.books.13', message: "저자는 최대 20명, 한 명당 200자까지 입력할 수 있습니다." });
      const idempotencyKey = newIdempotencyKey(randomUUID);
      if (!selected) { if (!title.trim() || title.length > 200) throw new BookUiError(/* i18n */ { id: 'native.books.14', message: "책 제목을 1~200자로 입력해 주세요." }); if (!currency.trim() || currency.length > 32) throw new BookUiError(/* i18n */ { id: 'native.books.15', message: "통화를 1~32자로 입력해 주세요." }); void send({ identity: client.identity, kind: 'purchase', input: { idempotencyKey, date, isbn: bookIsbn(isbn), title: title.trim(), authors: authorNames, ...(metadata ? { coverUrl: metadata.coverUrl ?? null } : {}), purchasePrice: { commodity: currency.trim(), value: decimal(price, true) }, assetAccount: assetAccount.trim(), cashAccount: cashAccount.trim() } }); }
      else { if (!lossAccount.trim() || (kind === 'SELL' && (!gainAccount.trim() || !feeAccount.trim()))) throw new BookUiError(/* i18n */ { id: 'native.books.16', message: "손익과 수수료 항목을 입력해 주세요." }); void send({ identity: client.identity, kind: 'dispose', input: { idempotencyKey, date, copyId: selected, kind, lossAccount: lossAccount.trim(), ...(kind === 'SELL' ? { cashAccount: cashAccount.trim(), saleProceeds: { commodity: currency.trim(), value: decimal(proceeds) }, fee: decimal(fee), gainAccount: gainAccount.trim(), feeAccount: feeAccount.trim() } : {}) } }); }
    } catch (error) { setMessage(errorNotice(error)); }
  }
  return <View style={{ gap: 16 }}>
    {!verified && <Notice title={_(/* i18n */ { id: 'native.books.17', message: "연결이 필요해요" })} tone="warning">{_(/* i18n */ { id: 'native.books.18', message: "책 구매·판매·폐기는 원장 연결 후 저장할 수 있습니다. 오프라인에서는 전송을 기다립니다." })}</Notice>}
    {Boolean(message) && <Notice title={_(/* i18n */ { id: 'native.books.19', message: "책 기록 안내" })}>{displayNotice(message)}</Notice>}
    {pending && <Panel><Notice title={_(/* i18n */ { id: 'native.books.20', message: "확인 대기 중" })} tone="warning">{_(/* i18n */ { id: 'native.books.21', message: "저장 결과를 확인할 때까지 다른 책 기록을 잠급니다. 원래 연결에서 같은 요청으로 재시도해 주세요." })}</Notice><Text selectable style={styles.caption}>{_(/* i18n */ { id: 'native.books.22', message: "요청 키" })} {pending.input.idempotencyKey}</Text><Button disabled={busy || !verified || pending.identity !== client.identity} onPress={() => void send(pending)}>{_(/* i18n */ { id: 'native.books.23', message: "같은 요청으로 확인·재시도" })}</Button></Panel>}
    <Panel><Heading subtitle={_(/* i18n */ { id: 'native.books.24', message: "동일한 ISBN도 실물 한 권씩 구분합니다." })}>{_(/* i18n */ { id: 'native.books.25', message: "내 책" })}</Heading><Button disabled={busy || !verified} onPress={() => void refresh()}>{_(/* i18n */ { id: 'native.books.26', message: "목록 새로고침" })}</Button>
      {loadedIdentity === client.identity && books.map(book => <View key={book.id} style={{ gap: 8 }}><BookCover uri={book.coverUrl} title={book.title} /><Text style={styles.strong}>{book.title}</Text>{book.authors.length > 0 && <Text style={styles.muted}>{book.authors.join(', ')}</Text>}<Text selectable style={styles.caption}>{book.isbn} · {book.id}</Text><Badge>{book.status === 'HELD' ? _(/* i18n */ { id: 'native.books.27', message: "보유 중" }) : book.status === 'SOLD' ? _(/* i18n */ { id: 'native.books.28', message: "판매 완료" }) : _(/* i18n */ { id: 'native.books.29', message: "폐기 완료" })}</Badge><Text style={styles.caption}>{_(/* i18n */ { id: 'native.books.30', message: "장부 가치" })}</Text><Money value={book.status === 'HELD' ? book.purchasePrice.value : '0'} commodity={book.purchasePrice.commodity} /><Text style={styles.caption}>{_(/* i18n */ { id: 'native.books.31', message: "취득 원가" })} {book.purchasePrice.value} {book.purchasePrice.commodity}</Text>{book.realizedGain && <><Text style={styles.caption}>{_(/* i18n */ { id: 'native.books.32', message: "실현 손익 (수수료 반영)" })}</Text><Money value={book.realizedGain.value} commodity={book.realizedGain.commodity} /></>}<Button disabled={locked || book.status !== 'HELD'} onPress={() => { setSelected(book.id); setCurrency(book.purchasePrice.commodity); }}>{_(/* i18n */ { id: 'native.books.33', message: "이 책 판매·폐기" })}</Button></View>)}
      {loadedIdentity === client.identity && books.length === 0 && <Text style={styles.muted}>{_(/* i18n */ { id: 'native.books.34', message: "등록한 책이 없습니다." })}</Text>}
    </Panel>
    <Panel><Heading>{selected ? _(/* i18n */ { id: 'native.books.35', message: "선택한 책 판매·폐기" }) : _(/* i18n */ { id: 'native.books.36', message: "책 한 권 구매" })}</Heading>
      {selected && <><Text selectable style={styles.caption}>{_(/* i18n */ { id: 'native.books.37', message: "실물 식별자" })} {selected}</Text><Button disabled={locked} selected={kind === 'SELL'} onPress={() => setKind('SELL')}>{_(/* i18n */ { id: 'native.books.38', message: "판매" })}</Button><Button disabled={locked} selected={kind === 'DISCARD'} onPress={() => setKind('DISCARD')}>{_(/* i18n */ { id: 'native.books.39', message: "폐기" })}</Button></>}
      <Field label={_(/* i18n */ { id: 'native.books.40', message: "거래일" })} value={date} onChangeText={setDate} editable={!locked} placeholder="YYYY-MM-DD" />
      {!selected && <><Field label="ISBN" value={isbn} onChangeText={changeIsbn} editable={!locked} /><Field label={_(/* i18n */ { id: 'native.books.41', message: "책 제목" })} maxLength={200} value={title} onChangeText={value => { titleEdited.current = true; setTitle(value); }} editable={!locked} /><Field label={_(/* i18n */ { id: 'native.books.42', message: "저자 (선택 · 한 줄에 한 명)" })} value={authors} multiline onChangeText={value => { authorsEdited.current = true; setAuthors(value); }} editable={!locked} />{metadataMessage ? <Text style={styles.muted}>{displayNotice(metadataMessage)}</Text> : null}{metadata && <><BookCover uri={metadata.coverUrl} title={title} source={metadata.coverSource} sourceUrl={metadata.coverSourceUrl} /><Text style={styles.caption}>{metadata.attribution}</Text><Text selectable style={styles.caption}>{metadata.sourceUrl}</Text></>}<Button disabled={locked || !verified} onPress={() => setMetadataRetry(value => value + 1)}>{_(/* i18n */ { id: 'native.books.43', message: "ISBN 정보 다시 조회" })}</Button><Field label={_(/* i18n */ { id: 'native.books.44', message: "구매 금액" })} value={price} onChangeText={setPrice} editable={!locked} keyboardType="decimal-pad" /><Field label={_(/* i18n */ { id: 'native.books.45', message: "책 항목" })} value={assetAccount} onChangeText={setAssetAccount} editable={!locked} /></>}
      {(!selected || kind === 'SELL') && <><Field label={_(/* i18n */ { id: 'native.books.46', message: "통화" })} value={currency} onChangeText={setCurrency} editable={!locked && !selected} /><Field label={_(/* i18n */ { id: 'native.books.47', message: "현금 항목" })} value={cashAccount} onChangeText={setCashAccount} editable={!locked} /></>}
      {selected && <><Field label={_(/* i18n */ { id: 'native.books.48', message: "손실 항목" })} value={lossAccount} onChangeText={setLossAccount} editable={!locked} />{kind === 'SELL' && <><Field label={_(/* i18n */ { id: 'native.books.49', message: "판매 대금 (수수료 차감 전)" })} value={proceeds} onChangeText={setProceeds} editable={!locked} keyboardType="decimal-pad" /><Field label={_(/* i18n */ { id: 'native.books.50', message: "수수료" })} value={fee} onChangeText={setFee} editable={!locked} keyboardType="decimal-pad" /><Field label={_(/* i18n */ { id: 'native.books.51', message: "이익 항목" })} value={gainAccount} onChangeText={setGainAccount} editable={!locked} /><Field label={_(/* i18n */ { id: 'native.books.52', message: "수수료 항목" })} value={feeAccount} onChangeText={setFeeAccount} editable={!locked} /></>}</>}
      <Button variant="primary" disabled={locked || !verified} onPress={submit}>{busy ? _(/* i18n */ { id: 'native.books.53', message: "처리 중…" }) : selected ? (kind === 'SELL' ? _(/* i18n */ { id: 'native.books.54', message: "판매와 실현 손익 기록" }) : _(/* i18n */ { id: 'native.books.55', message: "폐기와 손실 기록" })) : _(/* i18n */ { id: 'native.books.56', message: "이 실물 책 구매 기록" })}</Button>
      {selected && <Button disabled={locked} onPress={() => setSelected('')}>{_(/* i18n */ { id: 'native.books.57', message: "구매 입력으로 돌아가기" })}</Button>}
    </Panel>
  </View>;
}

function BookCover({ uri, title, source, sourceUrl }: { uri?: string | null; title: string; source?: string | null; sourceUrl?: string | null }) {
  const { _ } = useLingui();
  const [failed, setFailed] = useState(false);
  const safeUri = normalizeBookCoverUrl(uri);
  useEffect(() => { setFailed(false); }, [uri]);
  if (!safeUri || failed) return <Text style={styles.caption}>{_(/* i18n */ { id: 'native.books.58', message: "표지 없음" })}</Text>;
  const imageUrl = new URL(safeUri);
  const aladin = imageUrl.hostname === 'image.aladin.co.kr';
  const openLibrary = imageUrl.hostname === 'covers.openlibrary.org';
  const yes24Id = imageUrl.hostname === 'image.yes24.com' ? /^\/goods\/(\d+)\/xl$/.exec(imageUrl.pathname)?.[1] : undefined;
  const fallbackLink = aladin ? 'https://www.aladin.co.kr/' : yes24Id ? `https://www.yes24.com/Product/Goods/${yes24Id}` : openLibrary ? `https://openlibrary.org/isbn/${imageUrl.pathname.split('/')[3]?.slice(0, 13)}` : 'https://www.nl.go.kr/';
  let link = fallbackLink;
  try {
    const url = new URL(sourceUrl || fallbackLink);
    const safeConnection = url.protocol === 'https:' && !url.username && !url.password && !url.port;
    const matchingYes24Product = url.hostname === 'www.yes24.com' && url.pathname === `/Product/Goods/${yes24Id}` && !url.search && !url.hash;
    const matchingAladinProduct = url.hostname === 'www.aladin.co.kr' && url.pathname === '/shop/wproduct.aspx' && /^\?ItemId=\d+$/.test(url.search) && !url.hash;
    if (safeConnection && (aladin ? matchingAladinProduct : yes24Id ? matchingYes24Product : ['openlibrary.org', 'www.openlibrary.org', 'nl.go.kr', 'www.nl.go.kr', 'seoji.nl.go.kr'].includes(url.hostname))) link = url.href;
  } catch { /* Keep the known provider URL. */ }
  return <View style={{ gap: 4 }}><Image source={{ uri: safeUri }} accessibilityLabel={_(/* i18n */ { id: 'books.coverAlt', message: '{title} 표지', values: { title: title || _(/* i18n */ { id: 'native.books.59', message: "책" }) } })} style={{ width: 80, height: 112 }} resizeMode="contain" onError={() => setFailed(true)} /><Text accessibilityRole="link" style={styles.caption} onPress={() => { void Linking.openURL(link).catch(() => undefined); }}>{_(/* i18n */ { id: 'native.books.60', message: "표지 제공:" })} {aladin ? 'Aladin' : yes24Id ? 'YES24' : source === 'OPEN_LIBRARY' || openLibrary ? 'Open Library' : _(/* i18n */ { id: 'native.books.61', message: "국립중앙도서관" })}</Text></View>;
}
