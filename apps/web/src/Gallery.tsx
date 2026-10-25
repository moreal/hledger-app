import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { galleryFixtures } from '../../../packages/domain/src/index';
import { tokens } from '../../../packages/design-tokens/src/index';
import { AccountRow, Badge, Button, Field, Icon, Money, Notice, PostingRow, TransactionRow, type Tone } from '../../../packages/ui-web/src/index';

const screens = [{ id: 'accounts', label: '계정', icon: 'accounts' }, { id: 'transactions', label: '거래', icon: 'transactions' }, { id: 'entry', label: '새 거래', icon: 'plus' }, { id: 'prices', label: '시세', icon: 'prices' }, { id: 'sync', label: '동기화', icon: 'sync' }] as const;
type Screen = typeof screens[number]['id'];
type DemoState = 'normal' | 'loading' | 'empty' | 'error' | 'saving' | 'offline' | 'success';
const states: { value: DemoState; label: string }[] = [{ value: 'normal', label: '기본' }, { value: 'loading', label: '불러오는 중' }, { value: 'empty', label: '빈 목록' }, { value: 'error', label: '오류' }, { value: 'saving', label: '저장 중' }, { value: 'offline', label: '오프라인' }, { value: 'success', label: '성공' }];
const screenCopy: Record<Screen, { title: string; subtitle: string }> = {
  accounts: { title: '나의 계정', subtitle: '매일의 기록, 한눈에.' }, transactions: { title: '거래 내역', subtitle: '거래를 선택하면 전체 분개가 펼쳐집니다.' }, entry: { title: '새로운 거래', subtitle: '두 분개의 합계가 0이 되도록 입력해 보세요.' }, prices: { title: '통화와 시세', subtitle: '각 통화의 가치를 정확하게 살펴봅니다.' }, sync: { title: '연결과 동기화', subtitle: '연결 정보와 재시도 상태를 확인합니다.' },
};

function SectionHeading({ number, title, description, aside }: { number: string; title: string; description: string; aside?: ReactNode }) {
  return <div className="section-heading"><div><span className="eyebrow">{number}</span><h2>{title}</h2><p>{description}</p></div>{aside}</div>;
}

function EmptyState({ search, reset }: { search: string; reset: () => void }) {
  return <div className="empty-state"><span className="empty-glyph" aria-hidden="true"><Icon name={search ? 'search' : 'accounts'} /></span><h4>{search ? '일치하는 기록이 없습니다' : '아직 기록이 없습니다'}</h4><p>{search ? `“${search}” 대신 다른 검색어를 입력해 보세요.` : '첫 기록이 들어올 공간입니다. 지금은 빈 목록의 디자인 예시입니다.'}</p><Button variant="secondary" onClick={reset}>{search ? '검색 초기화' : '기본 예시 보기'}</Button></div>;
}

function LoadingState() {
  return <div className="loading-state" role="status" aria-label="데모 자료 불러오는 중"><span className="sr-only">데모 자료를 불러오는 중입니다.</span>{[1, 2, 3, 4].map((item) => <div className="skeleton-row" key={item}><span className="skeleton skeleton-icon" /><span className="skeleton-copy"><span className="skeleton" /><span className="skeleton" /></span><span className="skeleton skeleton-number" /></div>)}</div>;
}

function isBalanced(values: readonly string[]) {
  if (!values.every((value) => /^-?[0-9]+(\.[0-9]+)?$/.test(value))) return false;
  const places = Math.max(...values.map((value) => value.split('.')[1]?.length ?? 0));
  return values.reduce((total, value) => {
    const [whole, decimal = ''] = value.replace('-', '').split('.');
    const exact = BigInt(`${whole}${decimal.padEnd(places, '0')}`);
    return total + (value.startsWith('-') ? -exact : exact);
  }, 0n) === 0n;
}

export function Gallery() {
  const [screen, setScreen] = useState<Screen>('accounts');
  const [demoState, setDemoState] = useState<DemoState>('normal');
  const [worstCase, setWorstCase] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<string | null>(null);
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const [description, setDescription] = useState('동네 카페에서 커피');
  const [date, setDate] = useState('2026-10-19');
  const [postingAccounts, setPostingAccounts] = useState(['비용:식비:카페', '자산:보통예금']);
  const [amounts, setAmounts] = useState(['6500', '-6500']);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [validationAnnouncement, setValidationAnnouncement] = useState('');
  const validationAttempt = useRef(0);
  const pendingInvalidFocus = useRef<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [paletteText, setPaletteText] = useState('동네 카페');
  const pendingAction = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pendingAction.current) clearTimeout(pendingAction.current); }, []);
  useEffect(() => {
    const inputId = pendingInvalidFocus.current;
    if (!inputId) return;
    pendingInvalidFocus.current = null;
    document.getElementById(inputId)?.focus();
  }, [fieldErrors]);
  const data = worstCase ? galleryFixtures.worstCase : galleryFixtures;
  const selected = data.accounts.find((account) => account.id === selectedAccount);
  const featured = selected ?? data.accounts[0];
  const cleanQuery = query.trim().toLocaleLowerCase('ko');
  const accounts = data.accounts.filter((account) => `${account.name} ${account.path}`.toLocaleLowerCase('ko').includes(cleanQuery));
  const transactions = data.transactions.filter((transaction) => `${transaction.description} ${transaction.postings.map((posting) => posting.accountName).join(' ')}`.toLocaleLowerCase('ko').includes(cleanQuery) && (!accountFilter || transaction.postings.some((posting) => posting.accountId === accountFilter)));
  const prices = data.prices.filter((price) => `${price.commodity} ${price.quoteCommodity}`.toLocaleLowerCase('ko').includes(cleanQuery));
  const accountGroups = Array.from(new Set(accounts.map((account) => account.path.split(':')[0]))).map((name) => ({ name, accounts: accounts.filter((account) => account.path.split(':')[0] === name) }));
  const balanced = isBalanced(amounts);
  const busy = demoState === 'saving' || demoState === 'loading';

  function changeScreen(next: Screen) { setScreen(next); setQuery(''); setFeedback(''); setSelectedTransaction(null); setAccountFilter(null); }
  function changeState(next: DemoState) { if (pendingAction.current) clearTimeout(pendingAction.current); setDemoState(next); setFeedback(''); }
  function retry() {
    changeState('loading');
    pendingAction.current = setTimeout(() => { setDemoState('normal'); setFeedback('데모 재시도를 완료했습니다. 가상 자료를 다시 표시합니다.'); }, 700);
  }
  function clearFieldError(id: string) {
    setFieldErrors((previous) => { const next = { ...previous }; delete next[id]; return next; });
  }
  function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const errors: Record<string, string> = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors['entry-date'] = '거래 날짜를 선택해 주세요.';
    if (!description.trim()) errors['entry-description'] = '어떤 거래인지 내용을 입력해 주세요.';
    postingAccounts.forEach((account, index) => {
      if (!account.trim()) errors[`posting-${index + 1}-account`] = '계정 이름이나 경로를 입력해 주세요.';
      if (!/^-?[0-9]+(\.[0-9]+)?$/.test(amounts[index])) errors[`posting-${index + 1}-amount`] = '쉼표 없이 숫자를 입력해 주세요. 예: -6500.00';
    });
    if (!Object.keys(errors).length && !balanced) errors['posting-2-amount'] = '두 분개의 합계가 0이 되도록 금액을 맞춰 주세요.';
    const firstInvalid = Object.keys(errors)[0];
    pendingInvalidFocus.current = firstInvalid ?? null;
    setFieldErrors(errors);
    if (firstInvalid) {
      validationAttempt.current += 1;
      setValidationAnnouncement(`입력 검토 ${validationAttempt.current}회. 수정이 필요한 항목이 ${Object.keys(errors).length}개 있습니다. ${errors[firstInvalid]}`);
      return;
    }
    setValidationAnnouncement('');
    if (demoState === 'offline') { setFeedback('오프라인 임시 저장의 데모입니다. 이 입력은 메모리에만 있으며 새로고침하면 사라집니다.'); return; }
    setDemoState('saving');
    pendingAction.current = setTimeout(() => { setDemoState('success'); setFeedback('입력 검토 데모가 완료되었습니다. 실제 원장이나 기기에 저장하지 않았습니다.'); }, 750);
  }
  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % screens.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + screens.length) % screens.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = screens.length - 1;
    else return;
    event.preventDefault(); changeScreen(screens[next].id); document.getElementById(`screen-tab-${screens[next].id}`)?.focus();
  }
  const resetResults = () => { setQuery(''); setAccountFilter(null); setDemoState('normal'); };

  return <div className="gallery-shell">
    <a className="skip-link" href="#main">본문으로 이동</a>
    <div className="main-shell">
      <header id="overview" className="topbar"><a className="brand" href="#screens" aria-label="hledger 디자인 갤러리"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><h1>hledger<span className="brand-caption">개인 원장</span></h1></a><nav className="gallery-nav" aria-label="갤러리 탐색"><a href="#foundations">컴포넌트</a><a href="#references">참고 자료</a></nav><Badge tone="accent">데모</Badge></header>
      <main id="main">
        <section id="screens" className="gallery-section product-section" aria-label="화면과 상태">
          <div className="review-bar"><span>디자인 갤러리 · 가상 데이터</span><details className="review-options"><summary><Icon name="layers" />화면 검토<Icon className="review-chevron" name="chevron" /></summary><div className="preview-controls"><div className="state-select"><label htmlFor="demo-state">화면 상태</label><select id="demo-state" value={demoState} onChange={(event) => changeState(event.target.value as DemoState)}>{states.map((state) => <option value={state.value} key={state.value}>{state.label}</option>)}</select></div><label className="toggle-label"><input type="checkbox" checked={worstCase} onChange={(event) => { setWorstCase(event.target.checked); setSelectedAccount(null); setAccountFilter(null); }} /><span className="toggle-track" aria-hidden="true" /><span>긴 이름·큰 금액</span></label></div></details></div>
          <div className="screen-preview">
            <div className="screen-tabs" role="tablist" aria-label="화면 예시">{screens.map((item, index) => <button key={item.id} role="tab" id={`screen-tab-${item.id}`} aria-controls="screen-panel" aria-selected={screen === item.id} tabIndex={screen === item.id ? 0 : -1} onKeyDown={(event) => handleTabKey(event, index)} onClick={() => changeScreen(item.id)}><Icon name={item.icon} />{item.label}</button>)}</div>
            <div className="screen-body" id="screen-panel" role="tabpanel" aria-labelledby={`screen-tab-${screen}`} tabIndex={0}>
              <div className="screen-heading"><div><span className="eyebrow">2026년 10월 19일 · 개인 원장</span><h3>{screenCopy[screen].title}</h3><p>{screenCopy[screen].subtitle}</p></div>{screen === 'accounts' ? <Button onClick={() => changeScreen('entry')}><Icon name="plus" />거래 입력</Button> : <Badge>2026.10.19 기준</Badge>}</div>
              {(demoState === 'offline') && <Notice tone="warning" title="오프라인 상태의 예시입니다">표시된 자료는 가상 자료입니다. 임시 입력은 현재 화면의 메모리에만 남습니다.</Notice>}
              {(demoState === 'saving') && <Notice tone="accent" title="저장 중 화면의 데모입니다">실제 저장 요청을 보내지 않습니다. 상태 선택에서 다른 화면으로 바꿀 수 있습니다.</Notice>}
              {(demoState === 'success') && <Notice tone="success" title="완료 화면의 데모입니다">실제 원장에는 저장되지 않았습니다. 입력 내용은 새로고침하면 사라집니다.</Notice>}
              <div className="action-feedback" aria-live="polite">{feedback}</div>
              {demoState === 'loading' ? <LoadingState /> : demoState === 'error' ? <div className="error-state"><Notice tone="danger" title="자료를 불러오지 못했습니다 · 데모">연결 오류 상황을 보여주는 예시입니다. 아래 버튼으로 재시도를 확인해 보세요.</Notice><Button variant="secondary" onClick={retry}>다시 시도 <Icon name="sync" /></Button></div> : demoState === 'empty' ? <EmptyState search="" reset={resetResults} /> : <>
                {(screen === 'transactions' || screen === 'prices') && <div className="list-toolbar"><Field label={screen === 'prices' ? '통화 검색' : '거래 검색'} type="search" placeholder={screen === 'prices' ? '통화 코드 검색' : '내용이나 계정 검색'} value={query} onChange={(event) => setQuery(event.target.value)} /><span className="result-count" role="status">{screen === 'prices' ? prices.length : transactions.length}개 {accountFilter && <Button variant="quiet" onClick={() => setAccountFilter(null)}>계정 필터 해제</Button>}</span></div>}
                {screen === 'accounts' && <div className="accounts-layout"><aside className="account-overview" aria-label="대표 계정 잔액"><div className="balance-feature"><div className="balance-feature__top"><span><Icon name="accounts" />{selected ? '선택한 계정' : '대표 계정'}</span><span className="feature-demo">가상 자료</span></div><h4>{featured.name}</h4><p className="feature-path">{featured.path}</p><div className="feature-balances">{featured.balances.map((balance, index) => <Money key={`${balance.commodity}-${index}`} {...balance} />)}</div><div className="feature-meta"><span>최근 거래</span><strong>{featured.lastTransactionDate ?? '아직 없음'}</strong></div><Button className="feature-action" variant="secondary" onClick={() => { setScreen('transactions'); setQuery(''); setAccountFilter(featured.id); }}>이 계정의 거래 <Icon name="arrow" /></Button></div><p className="overview-note"><Icon name="info" />각 계정의 잔액을 통화별로 표시합니다.<br />통화가 다른 금액은 합산하지 않습니다.</p></aside><div className="accounts-ledger"><div className="accounts-ledger__heading"><h4>전체 계정 <span>{accounts.length}</span></h4><span>계정별 잔액</span></div><div className="list-toolbar account-search"><span className="search-glyph" aria-hidden="true"><Icon name="search" /></span><Field label="계정 검색" type="search" placeholder="계정 이름이나 경로 검색" value={query} onChange={(event) => setQuery(event.target.value)} /><span className="sr-only" role="status">검색된 계정 {accounts.length}개</span></div>{accounts.length ? <div className="account-list">{accountGroups.map((group) => <section className="account-group" key={group.name} aria-label={`${group.name} 계정`}><div className="account-group__heading"><h5>{group.name}</h5><span>{group.accounts.length}개 계정</span></div>{group.accounts.map((account) => <AccountRow key={account.id} name={account.name} path={account.path} depth={account.depth} balances={account.balances} count={account.transactionCount} selected={selectedAccount === account.id} onClick={() => setSelectedAccount(selectedAccount === account.id ? null : account.id)} />)}</section>)}</div> : <EmptyState search={query} reset={resetResults} />}</div></div>}
                {screen === 'transactions' && (transactions.length ? <><div className="list-column-labels"><span>날짜 / 내용</span><span>첫 분개 금액</span></div>{transactions.map((transaction) => <div key={transaction.id}><TransactionRow date={transaction.date} description={transaction.description} account={transaction.postings.map((posting) => posting.accountName).join(' → ')} amount={transaction.postings[0].amount} status={transaction.status} selected={selectedTransaction === transaction.id} onClick={() => setSelectedTransaction(selectedTransaction === transaction.id ? null : transaction.id)} />{selectedTransaction === transaction.id && <div className="transaction-detail"><span className="eyebrow">전체 분개 · {transaction.postings.length}개</span>{transaction.postings.map((posting, index) => <div className="detail-posting" key={index}><span>{posting.accountName}{posting.memo && <small>{posting.memo}</small>}</span><Money {...posting.amount} /></div>)}<div className="detail-tags">{transaction.tags.map((tag) => <Badge key={tag.key}>{tag.key}: {tag.value}</Badge>)}<span>출처: {transaction.source} · 가상 자료</span></div></div>}</div>)}<div className="list-footnote">금액은 첫 번째 분개 기준입니다. 거래를 선택하면 전체 분개를 볼 수 있습니다.</div></> : <EmptyState search={query} reset={resetResults} />)}
                {screen === 'entry' && <form className="entry-form" noValidate onSubmit={submitEntry} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); event.currentTarget.requestSubmit(); } }}><div className="sr-only" role="alert" aria-atomic="true">{validationAnnouncement}</div><div className="entry-basics"><Field id="entry-date" error={fieldErrors['entry-date']} label="날짜" type="date" value={date} onChange={(event) => { setDate(event.target.value); clearFieldError('entry-date'); }} required disabled={busy} /><Field id="entry-description" error={fieldErrors['entry-description']} label="내용" hint="거래 내역에서 알아볼 수 있는 내용으로 적어 주세요." value={description} onChange={(event) => { setDescription(event.target.value); clearFieldError('entry-description'); }} placeholder="어떤 거래였나요?" required maxLength={512} disabled={busy} /></div><div className="form-divider"><h4>분개</h4><Badge>KRW · 단일 통화</Badge></div><p className="form-help">받는 계정과 보내는 계정의 합계가 0이 되도록 기록합니다.</p>{postingAccounts.map((account, index) => <PostingRow key={index} index={index + 1} account={account} amount={amounts[index]} commodity="KRW" accountError={fieldErrors[`posting-${index + 1}-account`]} amountError={fieldErrors[`posting-${index + 1}-amount`]} disabled={busy} onAccountChange={(value) => { setPostingAccounts((previous) => previous.map((item, itemIndex) => itemIndex === index ? value : item)); clearFieldError(`posting-${index + 1}-account`); }} onAmountChange={(value) => { setAmounts((previous) => previous.map((item, itemIndex) => itemIndex === index ? value : item)); clearFieldError(`posting-${index + 1}-amount`); }} />)}<div className={`balance-check ${balanced ? 'is-balanced' : ''}`} role="status"><Icon name={balanced ? 'check' : 'alert'} />{balanced ? '균형이 맞습니다 · 분개 합계 0 KRW' : '두 분개의 합계가 0이 되도록 금액을 맞춰 주세요.'}</div><div className="form-footer"><p>가상 입력을 검토합니다.<br /><span>실제 원장에는 저장하지 않습니다.</span></p><Button type="submit" disabled={busy}>{busy ? '데모 진행 중…' : demoState === 'offline' ? '임시 저장 데모' : '입력 검토 데모'}<Icon name="arrow" /></Button></div></form>}
                {screen === 'prices' && (prices.length ? <><div className="list-column-labels"><span>통화 / 기준</span><span>1단위당 시세</span></div>{prices.map((price, index) => <div className="price-row" key={`${price.commodity}-${index}`}><span className="currency-symbol" aria-hidden="true">{price.commodity.slice(0, 1)}</span><span className="row-copy"><strong>{price.commodity} <span className="muted">/ {price.quoteCommodity}</span></strong><span>{price.date} · {price.source ?? '출처 미기록'}</span></span><Money value={price.rate} commodity={price.quoteCommodity} /></div>)}<div className="list-footnote">시세는 가상 자료입니다. 잔액의 자동 환산이나 통화 간 합산에 사용하지 않습니다.</div></> : <EmptyState search={query} reset={resetResults} />)}
                {screen === 'sync' && <div className="sync-view"><div className="sync-summary"><span className="sync-icon"><Icon name="sync" /></span><Badge tone={demoState === 'offline' ? 'warning' : 'success'}>{demoState === 'offline' ? '오프라인 예시' : '연결 정상 예시'}</Badge><h4>{demoState === 'offline' ? '다시 연결되기를 기다립니다' : '기록을 읽을 준비가 되었습니다'}</h4><p>연결 상태를 살펴보는 데모입니다.</p></div><dl className="sync-details"><div><dt>연결 대상</dt><dd>가상 원장 · 실제 서버 미연결</dd></div><div><dt>마지막 성공 동기화</dt><dd>2026.10.19 09:41 KST <span>(예시)</span></dd></div><div><dt>인덱서 지연</dt><dd>알 수 없음 · 미연결</dd></div><div><dt>임시 저장</dt><dd>실제 저장 기능 미구현</dd></div></dl><Button variant="secondary" onClick={retry}>동기화 재시도 데모 <Icon name="sync" /></Button></div>}
              </>}
              <div className="demo-footer"><Icon name="info" /> 디자인 검토용 예시입니다. 실제 원장과 연결되어 있지 않습니다.</div>
            </div>
          </div>
        </section>

        <section id="foundations" className="gallery-section foundations">
          <SectionHeading number="02 / 컴포넌트" title="컴포넌트와 기준" description="역할에 맞는 강조, 읽기 쉬운 글자, 행동을 안내하는 상태를 비교합니다." />
          <div className="foundation-grid">
            <div className="foundation-card component-card"><div className="card-kicker">BUTTON</div><h3>행동의 우선순위</h3><p>핵심 행동에만 강한 색을 사용합니다. 선택된 탐색은 약한 배경으로 구분합니다.</p><div className="component-buttons"><Button onClick={() => setFeedback('주요 버튼 데모를 실행했습니다.')}>주요 행동</Button><Button variant="secondary" onClick={() => { setPaletteText(''); setFeedback('입력 예시를 비웠습니다.'); }}>보조 행동</Button><Button disabled>사용 불가</Button></div><div className="component-feedback" role="status">{feedback || 'Tab 키로 포커스를, 클릭으로 동작을 확인하세요.'}</div></div>
            <div className="foundation-card"><div className="card-kicker">FIELD</div><h3>입력 상태 비교</h3><div className="field-examples"><Field label="정상 · 거래 내용" value={paletteText} onChange={(event) => setPaletteText(event.target.value)} hint="어떤 거래인지 알아볼 수 있게 적어 주세요." /><Field label="읽기 전용 · 원장 통화" value="KRW" readOnly hint="원장에서 정한 통화입니다." /><Field label="오류 · 금액" defaultValue="6,500" error="쉼표 없이 입력해 주세요. 예: 6500" hint="소수점과 음수를 사용할 수 있습니다." inputMode="decimal" /></div></div>
            <div className="foundation-card"><div className="card-kicker">COLOR & FEEDBACK</div><h3>색의 역할과 상태</h3><div className="swatches">{([{ key: 'text', label: '본문' }, { key: 'accent', label: '강조' }, { key: 'success', label: '성공' }, { key: 'warning', label: '주의' }, { key: 'danger', label: '오류' }] as const).map((color) => <div key={color.key}><span className="swatch" style={{ backgroundColor: tokens.colors[color.key] }} /><strong>{color.label}</strong><small>{tokens.colors[color.key]}</small></div>)}</div><div className="badge-palette">{([{ tone: 'success', label: '확인 완료' }, { tone: 'warning', label: '확인 필요' }, { tone: 'danger', label: '연결 오류' }] as { tone: Tone; label: string }[]).map((item) => <Badge key={item.tone} tone={item.tone}>{item.label}</Badge>)}</div><Notice tone="accent" title="다음 행동을 함께 안내합니다">색 외에도 상태 문구와 아이콘으로 의미를 전합니다.</Notice></div>
            <div className="foundation-card typography-card"><div className="card-kicker">TYPOGRAPHY & AMOUNT</div><h3>역할에 따른 글자</h3><div className="type-roles"><div><span>제목</span><strong className="type-heading">거래 내역</strong></div><div><span>본문 · 16px</span><strong>보통예금</strong></div><div><span>보조 정보 · 14px</span><span>자산:은행:보통예금</span></div></div><Money value="1234567.0000" commodity="KRW" /><p>통화와 소수 자릿수를 보존합니다. 좁은 화면은 금액을 다음 줄에 배치하며, 글자 확대에 따라 크기도 함께 커집니다.</p></div>
          </div>
        </section>
        <section id="references" className="gallery-section references">
          <SectionHeading number="03 / 참고 자료" title="공식 자료에서 적용한 기준" description="각 자료의 원칙을 이 갤러리의 사용 맥락에 맞게 적용했습니다." />
          <div className="reference-grid">
            <a href="https://tossmini-docs.toss.im/tds-mobile/components/ListRow/list-row-overview/" target="_blank" rel="noreferrer"><strong>Toss TDS <Icon name="arrow" /></strong><span>행의 정보 위계</span><p>계정 이름·경로·금액을 공통 행 구조로 정리하고, 긴 정보는 자연스럽게 줄바꿈합니다.</p></a>
            <a href="https://spectrum.adobe.com/foundations/composition/attention-hierarchy" target="_blank" rel="noreferrer"><strong>Adobe Spectrum <Icon name="arrow" /></strong><span>주목도의 우선순위</span><p>화면 예시를 앞에 두고, 주요 행동과 선택된 탐색의 강조를 구분합니다.</p></a>
            <a href="https://seed-design.io/foundations/color/color-role" target="_blank" rel="noreferrer"><strong>Daangn SEED <Icon name="arrow" /></strong><span>역할에 따른 색</span><p>전경·배경·경계와 hover·pressed·disabled 상태를 공통 토큰으로 사용합니다.</p></a>
            <a href="https://developer.apple.com/design/human-interface-guidelines/accessibility" target="_blank" rel="noreferrer"><strong>Apple HIG <Icon name="arrow" /></strong><span>확대와 접근성</span><p>시스템 서체, 확대 가능한 글자, 키보드 포커스와 충분한 조작 영역을 제공합니다.</p></a>
          </div>
          <p className="reference-note">14px·16px 글자 크기와 44px 조작 영역은 이 프로젝트의 구현 기준입니다. 각 회사의 공식 구현이나 전체 디자인 시스템을 재현한 것은 아닙니다.</p>
        </section>
        <footer className="page-footer"><a className="footer-brand" href="#overview">hledger 디자인 시스템</a><p>웹 · 모바일 공통 컴포넌트 검토용</p><span>2026.10</span></footer>
      </main>
    </div>
  </div>;
}
