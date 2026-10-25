import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createLedgerClient, newIdempotencyKey, subtractDecimals, type BooksQuery, type PurchaseBookInput, type DisposeBookInput } from '../../../packages/client/index';
import { normalizeBookCoverUrl } from '../../../packages/domain/src/book-cover-url';
import { normalizeIsbn } from '../../../packages/domain/src/books';
import { Badge, Button, Field, Money, Notice } from '../../../packages/ui-web/src/index';

type Client = ReturnType<typeof createLedgerClient>;
type Book = NonNullable<BooksQuery['books']>[number];
type Request = { kind: 'purchase'; input: PurchaseBookInput } | { kind: 'dispose'; input: DisposeBookInput };
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const blankPurchase = () => ({ date: today(), isbn: '', title: '', authors: '', coverUrl: '', price: '', currency: 'KRW', assetAccount: 'assets:books', cashAccount: '' });
const blankDisposal = () => ({ date: today(), kind: 'SELL', proceeds: '', fee: '0', cashAccount: '', gainAccount: 'income:books', lossAccount: 'expenses:books', feeAccount: 'expenses:fees' });
const amount = (value: string) => /^\d+(?:\.\d+)?$/.test(value) && value.length <= 100;
function validRequest(value: unknown): value is Request {
  if (!value || typeof value !== 'object') return false;
  const request = value as { kind?: unknown; input?: Record<string, unknown> };
  const input = request.input;
  if (!input || typeof input !== 'object' || typeof input.idempotencyKey !== 'string' || !input.idempotencyKey || typeof input.date !== 'string') return false;
  if (request.kind === 'purchase') return ['isbn', 'title', 'assetAccount', 'cashAccount'].every((key) => typeof input[key] === 'string') && Boolean(input.purchasePrice && typeof input.purchasePrice === 'object' && typeof (input.purchasePrice as Record<string, unknown>).value === 'string' && typeof (input.purchasePrice as Record<string, unknown>).commodity === 'string');
  return request.kind === 'dispose' && typeof input.copyId === 'string' && ['SELL', 'DISCARD'].includes(String(input.kind));
}
function readPending(key: string): { request: Request | null; error: string } {
  try { const saved = localStorage.getItem(key); if (!saved) return { request: null, error: '' }; const value: unknown = JSON.parse(saved); if (!validRequest(value)) throw new Error(); return { request: value, error: '' }; }
  catch { return { request: null, error: '기존 책 요청의 확인 정보를 읽을 수 없습니다. 브라우저 저장소를 확인하기 전에는 새 요청을 보낼 수 없습니다.' }; }
}


function safeBookUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
function safeBookCoverUrl(value?: string | null): string | undefined {
  return normalizeBookCoverUrl(value) ?? undefined;
}
function CoverCredit({ url, isbn, source, sourceUrl }: { url?: string | null; isbn: string; source?: string | null; sourceUrl?: string | null }) {
  const cover = safeBookCoverUrl(url);
  if (!cover) return null;
  const coverLocation = new URL(cover);
  const aladin = coverLocation.hostname === 'image.aladin.co.kr';
  const openLibrary = coverLocation.hostname === 'covers.openlibrary.org';
  const yes24Id = coverLocation.hostname === 'image.yes24.com' ? /^\/goods\/(\d+)\/xl$/.exec(coverLocation.pathname)?.[1] : undefined;
  let canonicalIsbn: string;
  try { canonicalIsbn = normalizeIsbn(isbn); } catch { return null; }
  const label = aladin ? 'Aladin' : yes24Id ? 'YES24' : openLibrary ? 'Open Library' : '국립중앙도서관';
  const fallback = aladin ? 'https://www.aladin.co.kr/' : yes24Id ? `https://www.yes24.com/Product/Goods/${yes24Id}` : openLibrary ? `https://openlibrary.org/isbn/${canonicalIsbn}` : 'https://www.nl.go.kr/';
  let link = fallback;
  const supplied = safeBookUrl(sourceUrl);
  // YES24 credits always use the exact canonical product route derived from the image.
  if (supplied && source && !yes24Id) {
    const location = new URL(supplied);
    const host = location.hostname;
    if (aladin ? host === 'www.aladin.co.kr' && !location.port && location.pathname === '/shop/wproduct.aspx' && /^\?ItemId=\d+$/.test(location.search) && !location.hash : openLibrary ? ['openlibrary.org', 'www.openlibrary.org'].includes(host) : ['nl.go.kr', 'www.nl.go.kr'].includes(host)) link = supplied;
  }
  return <p className="form-help">표지 출처: <a href={link} target="_blank" rel="noreferrer">{label}</a></p>;
}
function BookCover({ url, title }: { url?: string | null; title: string }) {
  const source = safeBookCoverUrl(url);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  return <div className="book-cover">{source && !failed ? <img src={source} alt={`${title || '책'} 표지`} width={96} height={144} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span>표지 없음</span>}</div>;
}

export function Books({ client, revision, disabled, onPendingChange, onChanged }: { client: Client; revision: number; disabled: boolean; onPendingChange: (pending: boolean) => void; onChanged: () => void }) {
  const storageKey = `hledger.book-request:${client.identity}`;
  const [recovery] = useState(() => readPending(storageKey));
  const [pending, setPending] = useState<Request | null>(recovery.request);
  const [storageError, setStorageError] = useState(recovery.error);
  const [purchase, setPurchase] = useState(blankPurchase);
  const automaticAuthors = useRef<string[] | null>(null);
  const manualMetadata = useRef({ title: false, authors: false });
  const lookupSerial = useRef(0);
  const [lookupRetry, setLookupRetry] = useState(0);
  const [lookup, setLookup] = useState<{ status: 'idle' | 'loading' | 'found' | 'missing' | 'unavailable'; isbn?: string; sourceUrl?: string | null; coverSource?: string | null; coverSourceUrl?: string | null; attribution?: string | null }>({ status: 'idle' });
  const [disposal, setDisposal] = useState(blankDisposal);
  const [selected, setSelected] = useState('');
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('ALL');
  const busy = useRef(false);
  useEffect(() => { onPendingChange(Boolean(pending || saving || storageError)); }, [pending, saving, storageError, onPendingChange]);
  useEffect(() => {
    let active = true; setLoading(true); setLoadError('');
    client.books().then((result) => { if (!active) return; if (result.data?.books) setBooks(result.data.books); setLoadError(result.errors?.map((error) => error.message).join(' · ') || (!result.data?.books ? '책 목록을 확인하지 못했습니다.' : '')); }).catch(() => { if (active) setLoadError('책 목록을 읽지 못했습니다. 연결 상태를 확인해 주세요.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, revision]);
  const book = books.find((item) => item.id === selected);
  const locked = disabled || saving || Boolean(pending || storageError);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  let normalizedIsbn = '';
  try { normalizedIsbn = normalizeIsbn(purchase.isbn); } catch { /* Incomplete ISBNs need no remote request. */ }
  useEffect(() => {
    const serial = ++lookupSerial.current;
    if (!normalizedIsbn || locked) { setLookup({ status: 'idle' }); return; }
    setLookup({ status: 'loading', isbn: normalizedIsbn });
    const timer = window.setTimeout(() => {
      void client.bookMetadata(normalizedIsbn).then((result) => {
        if (serial !== lookupSerial.current || lockedRef.current || busy.current) return;
        const metadata = result.data?.bookMetadata;
        if (result.errors?.length || !metadata || metadata.status === 'UNAVAILABLE') { setLookup({ status: 'unavailable', isbn: normalizedIsbn }); return; }
        if (metadata.status !== 'FOUND' || !metadata.book || metadata.book.isbn !== normalizedIsbn) { setLookup({ status: 'missing', isbn: normalizedIsbn }); return; }
        const found = metadata.book;
        automaticAuthors.current = found.authors;
        setLookup({ status: 'found', isbn: normalizedIsbn, sourceUrl: found.sourceUrl, coverSource: found.coverSource, coverSourceUrl: found.coverSourceUrl, attribution: found.attribution });
        setPurchase((current) => ({ ...current, title: manualMetadata.current.title ? current.title : found.title, authors: manualMetadata.current.authors ? current.authors : found.authors.join('; '), coverUrl: safeBookCoverUrl(found.coverUrl) ?? '' }));
      }).catch(() => { if (serial === lookupSerial.current && !lockedRef.current && !busy.current) setLookup({ status: 'unavailable', isbn: normalizedIsbn }); });
    }, 500);
    return () => { window.clearTimeout(timer); lookupSerial.current++; };
  }, [client, normalizedIsbn, lookupRetry, locked]);
  function updatePurchase(key: keyof typeof purchase, value: string) {
    if (locked) return;
    if (key === 'title' || key === 'authors') manualMetadata.current[key] = true;
    if (key === 'isbn') {
      let nextIsbn = ''; try { nextIsbn = normalizeIsbn(value); } catch { /* Partial input clears stale metadata. */ }
      if (nextIsbn !== normalizedIsbn) { automaticAuthors.current = null; lookupSerial.current++; setLookup({ status: 'idle' }); setPurchase((current) => ({ ...current, isbn: value, title: manualMetadata.current.title ? current.title : '', authors: manualMetadata.current.authors ? current.authors : '', coverUrl: '' })); return; }
    }
    setPurchase((current) => ({ ...current, [key]: value }));
  }
  let net: string | undefined; let gain: string | undefined;
  if (book && amount(disposal.proceeds) && amount(disposal.fee)) { net = subtractDecimals(disposal.proceeds, disposal.fee); gain = subtractDecimals(net, book.purchasePrice.value); }
  async function send(request: Request) {
    if (busy.current || disabled || storageError) return;
    // Persist the exact request and key before any network write, including retries.
    try { localStorage.setItem(storageKey, JSON.stringify(request)); }
    catch { setStorageError('확인 정보를 브라우저에 보관하지 못해 요청을 보내지 않았습니다. 저장소 접근을 복구한 뒤 다시 열어 주세요.'); return; }
    const wasPending = pending !== null;
    busy.current = true; setSaving(true); setPending(request); onPendingChange(true); setMessage('');
    try {
      const result = request.kind === 'purchase' ? await client.purchaseBook(request.input) : await client.disposeBook(request.input);
      const payload = result.data && ('purchaseBook' in result.data ? result.data.purchaseBook : result.data.disposeBook);
      if (payload?.book && payload.idempotency?.key === request.input.idempotencyKey && typeof payload.idempotency.replayed === 'boolean' && !payload.errors.length) {
        try { localStorage.removeItem(storageKey); } catch { setStorageError('저장은 확인했지만 재시도 정보를 지우지 못했습니다. 브라우저 저장소를 복구해 주세요.'); }
        setPending(null); automaticAuthors.current = null; manualMetadata.current = { title: false, authors: false }; setPurchase(blankPurchase()); setSelected(''); setDisposal(blankDisposal()); setMessage('책 기록을 원장에 저장했습니다.'); onChanged();
      } else if (!wasPending && payload?.errors.length && !payload.book) {
        try { localStorage.removeItem(storageKey); setPending(null); } catch { setStorageError('거부된 요청의 확인 정보를 지우지 못했습니다. 브라우저 저장소를 복구해 주세요.'); }
        setMessage(payload.errors.map((error) => error.message).join(' · '));
      } else {
        // Even a rejected retry must not replace an earlier unknown write.
        setMessage(`저장 결과를 확인해야 합니다. 같은 요청으로 다시 확인해 주세요.${payload?.errors.length ? ` ${payload.errors.map((error) => error.message).join(' · ')}` : ''}`);
      }
    } catch { setMessage('저장 결과가 불명확합니다. 입력과 요청 키를 보관했습니다. 같은 요청으로 결과를 확인해 주세요.'); }
    finally { busy.current = false; setSaving(false); }
  }
  function submitPurchase(event: FormEvent) {
    event.preventDefault(); if (locked) return;
    try { normalizeIsbn(purchase.isbn); } catch { setMessage('유효한 ISBN-10 또는 ISBN-13을 입력해 주세요.'); return; }
    if (!purchase.title.trim() || [...purchase.title.trim()].length > 200 || !purchase.date || !amount(purchase.price) || !/[1-9]/.test(purchase.price) || !purchase.currency.trim() || !purchase.assetAccount.trim() || !purchase.cashAccount.trim()) { setMessage('제목, 날짜, 양수인 구입 금액, 통화와 계좌를 입력해 주세요.'); return; }
    const authors = !manualMetadata.current.authors && automaticAuthors.current ? automaticAuthors.current : purchase.authors.split(';').map((name) => name.trim()).filter(Boolean);
    if (authors.length > 20 || authors.some((name) => name.length > 200)) { setMessage('저자는 20명까지, 각 이름은 200자까지 입력해 주세요.'); return; }
    void send({ kind: 'purchase', input: { idempotencyKey: newIdempotencyKey(), date: purchase.date, isbn: purchase.isbn, title: purchase.title.trim(), authors, ...(purchase.coverUrl ? { coverUrl: purchase.coverUrl } : {}), purchasePrice: { value: purchase.price, commodity: purchase.currency.trim() }, assetAccount: purchase.assetAccount.trim(), cashAccount: purchase.cashAccount.trim() } });
  }
  function submitDisposal(event: FormEvent) {
    event.preventDefault(); if (locked || !book) return;
    const sell = disposal.kind === 'SELL';
    if (!disposal.date || !disposal.lossAccount.trim() || (sell && (!amount(disposal.proceeds) || !amount(disposal.fee) || !disposal.cashAccount.trim() || !disposal.gainAccount.trim() || (/[1-9]/.test(disposal.fee) && !disposal.feeAccount.trim())))) { setMessage('처분 날짜와 손실 비용 항목, 판매 금액과 필요한 계좌를 확인해 주세요.'); return; }
    void send({ kind: 'dispose', input: { idempotencyKey: newIdempotencyKey(), copyId: book.id, date: disposal.date, kind: sell ? 'SELL' : 'DISCARD', lossAccount: disposal.lossAccount.trim(), ...(sell ? { cashAccount: disposal.cashAccount.trim(), saleProceeds: { value: disposal.proceeds, commodity: book.purchasePrice.commodity }, fee: disposal.fee, feeAccount: disposal.feeAccount.trim(), gainAccount: disposal.gainAccount.trim() } : {}) } });
  }
  const purchaseField = (key: keyof typeof purchase, label: string, extra = {}) => <Field label={label} value={purchase[key]} onChange={(event) => updatePurchase(key, event.target.value)} required {...extra} />;
  const disposalField = (key: keyof typeof disposal, label: string, extra = {}) => <Field label={label} value={disposal[key]} onChange={(event) => setDisposal({ ...disposal, [key]: event.target.value })} required {...extra} />;
  return <section className="books-view" aria-label="책 관리">
    {storageError && <Notice tone="danger" title="책 요청 확인 정보 보관 필요">{storageError}</Notice>}
    {message && <div role="status"><Notice tone={pending ? 'warning' : 'neutral'} title={pending ? '저장 결과 확인 필요' : '책 기록 안내'}>{message}</Notice></div>}
    {pending && <div className="app-posting"><p>확인 중인 요청: {pending.kind === 'purchase' ? `책 구입 · ${pending.input.title}` : `책 ${pending.input.kind === 'SELL' ? '판매' : '폐기'} · ${pending.input.copyId}`} · {pending.input.date}</p><p className="form-help">입력을 고정했습니다. 다른 화면으로 이동하거나 다시 연결해도 같은 요청으로 결과를 확인합니다.</p><Button disabled={saving || disabled || Boolean(storageError)} onClick={() => void send(pending)}>{saving ? '원장 확인 중…' : '같은 요청으로 결과 확인'}</Button></div>}
    <form onSubmit={submitPurchase} className="app-posting"><h4>책 구입 기록</h4><p className="form-help">구입 금액을 책 자산으로 보관합니다. 같은 ISBN도 구입할 때마다 별개의 한 권으로 등록합니다.</p><fieldset disabled={locked} className="app-fieldset"><div className="app-entry-extra">
      {purchaseField('date', '구입 날짜', { type: 'date' })}{purchaseField('isbn', 'ISBN', { placeholder: '978…', maxLength: 32 })}{purchaseField('title', '책 제목', { maxLength: 200 })}{purchaseField('authors', '저자 (선택)', { required: false, hint: '여러 저자는 세미콜론(;)으로 구분해 주세요.' })}{purchaseField('price', '구입 금액 (장부가액)', { inputMode: 'decimal' })}{purchaseField('currency', '구입 결제 자산', { maxLength: 32 })}{purchaseField('assetAccount', '책 자산 계좌')}{purchaseField('cashAccount', '결제 계좌')}
    </div><div className="book-metadata" aria-live="polite">{purchase.isbn && <BookCover url={purchase.coverUrl} title={purchase.title} />}<div>
      {lookup.status === 'loading' && <p role="status">ISBN으로 책 정보를 찾고 있습니다… 직접 입력해도 됩니다.</p>}
      {lookup.status === 'found' && <p className="form-help">책 정보를 불러왔습니다. 제목과 저자를 확인하고 수정해 주세요.{lookup.attribution && <> {lookup.attribution}</>}{safeBookUrl(lookup.sourceUrl) && <> <a href={safeBookUrl(lookup.sourceUrl)} target="_blank" rel="noreferrer">서지 정보 출처</a></>}</p>}
      <CoverCredit url={purchase.coverUrl} isbn={purchase.isbn} source={lookup.coverSource} sourceUrl={lookup.coverSourceUrl} />
      {lookup.status === 'missing' && <p className="form-help">이 ISBN의 책 정보를 찾지 못했습니다. 제목과 저자를 직접 입력해 주세요.</p>}
      {lookup.status === 'unavailable' && <p className="form-help">책 정보 조회가 잠시 어렵습니다. 제목과 저자를 직접 입력해 기록할 수 있습니다.</p>}
      {!normalizedIsbn && purchase.isbn && <p className="form-help">유효한 ISBN을 입력하면 책 정보를 자동으로 찾습니다.</p>}
      {normalizedIsbn && lookup.status !== 'loading' && <Button variant="quiet" onClick={() => setLookupRetry((value) => value + 1)}>책 정보 다시 찾기</Button>}
    </div></div><div className="form-footer"><p>책 자산 증가 / 결제 계좌 출금</p><Button type="submit">한 권 구입 기록</Button></div></fieldset></form>
    <div className="form-divider"><h4>책 목록 · {books.length}권</h4><label className="field">보유 상태<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">전체</option><option value="HELD">보유</option><option value="SOLD">판매</option><option value="DISCARDED">폐기</option></select></label></div>
    {loading && <p role="status">책을 읽고 있습니다…</p>}{loadError && <Notice tone="danger" title="책 목록을 읽지 못했습니다">{loadError}</Notice>}
    {!loading && !loadError && !books.length && <p className="form-help">아직 등록한 책이 없습니다. ISBN과 제목을 입력해 첫 책을 기록하세요.</p>}
    {books.filter((item) => status === 'ALL' || item.status === status).map((item) => <article className="app-posting" key={item.id}><div className="app-detail-heading"><div className="book-identity"><BookCover url={item.coverUrl} title={item.title} /><div><h4>{item.title}</h4>{item.authors.length > 0 && <p className="form-help">{item.authors.join(' · ')}</p>}<CoverCredit url={item.coverUrl} isbn={item.isbn} /></div></div><Badge>{item.status === 'HELD' ? '보유' : item.status === 'SOLD' ? '판매' : '폐기'}</Badge></div><p className="form-help">ISBN {item.isbn} · 개별 책 {item.id}<br />구입 {item.purchaseDate} · {item.assetAccount}</p><p>구입 장부가액: <Money {...item.purchasePrice} /></p>{item.saleProceeds && <p>판매 금액 (수수료 전): <Money {...item.saleProceeds} /></p>}{item.realizedGain && <p>{item.status === 'DISCARDED' ? '폐기 손실' : '실현 손익 (수수료 반영)'}: <Money {...item.realizedGain} /></p>}{item.disposalDate && <p>처분 {item.disposalDate}</p>}{item.status === 'HELD' && <Button variant="secondary" disabled={locked} onClick={() => { setSelected(item.id); setDisposal(blankDisposal()); setMessage(''); }}>이 책 판매·폐기</Button>}</article>)}
    {book && <form className="app-posting" onSubmit={submitDisposal}><h4>{book.title} · 처분 기록</h4><fieldset className="app-fieldset" disabled={locked}><div className="app-entry-extra"><label className="field">처분 구분<select value={disposal.kind} onChange={(event) => setDisposal({ ...disposal, kind: event.target.value })}><option value="SELL">판매</option><option value="DISCARD">폐기</option></select></label>{disposalField('date', '처분 날짜', { type: 'date' })}
      {disposal.kind === 'SELL' && <>{disposalField('proceeds', `판매 금액 (수수료 전, ${book.purchasePrice.commodity})`, { inputMode: 'decimal' })}{disposalField('fee', '판매 수수료', { inputMode: 'decimal' })}{disposalField('cashAccount', '판매대금 입금 계좌')}{disposalField('feeAccount', '수수료 비용 항목')}{disposalField('gainAccount', '처분 이익 수익 항목')}</>}{disposalField('lossAccount', disposal.kind === 'SELL' ? '처분 손실 비용 항목' : '폐기 손실 비용 항목')}</div>
      <div className="transaction-detail" aria-live="polite"><h4>처분 미리보기</h4><p>책 자산에서 제거할 장부가액: <Money {...book.purchasePrice} /></p>{disposal.kind === 'SELL' ? net !== undefined && gain !== undefined ? <><p>{net.startsWith('-') ? '처분으로 추가 출금' : '판매대금 순 입금'}: <Money value={net} commodity={book.purchasePrice.commodity} /></p><p>수수료: <Money value={disposal.fee} commodity={book.purchasePrice.commodity} /></p><p>실현 손익 (판매 금액 − 수수료 − 장부가액): <Money value={gain} commodity={book.purchasePrice.commodity} /></p></> : <p>판매 금액과 수수료를 입력하면 손익을 확인할 수 있습니다.</p> : <p>폐기 손실: <Money {...book.purchasePrice} /> · 현금 이동 없음</p>}</div><div className="form-footer"><p>선택한 한 권만 원장에 기록합니다.</p><Button type="submit">{disposal.kind === 'SELL' ? '판매 기록' : '폐기 기록'}</Button></div></fieldset></form>}
  </section>;
}
