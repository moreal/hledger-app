/** Decimal display works on strings only: it neither rounds nor converts units. */
export function formatDecimal(value: string): string {
  const match = typeof value === 'string' ? /^(-?)([0-9]+)(\.[0-9]+)?$/.exec(value) : null;
  // JavaScript's $ may match before a final newline; require the entire input.
  if (!match || match[0] !== value) throw new TypeError('Expected a decimal string.');
  const sign = match[1]!;
  const integer = match[2]!;
  const fraction = match[3] ?? '';
  const groups = [integer.slice(0, integer.length % 3 || 3)];
  for (let offset = groups[0]!.length; offset < integer.length; offset += 3) {
    groups.push(integer.slice(offset, offset + 3));
  }
  return `${sign}${groups.join(',')}${fraction}`;
}

/** Preserve the explicit commodity; display does not imply a conversion or sum. */
export function formatMoney(value: string, commodity: string): string {
  if (typeof commodity !== 'string' || commodity.trim().length === 0 || commodity.length > 32) {
    throw new TypeError('Expected a commodity of 1–32 characters.');
  }
  return `${formatDecimal(value)} ${commodity}`;
}

export interface MoneyAmount {
  readonly value: string;
  readonly commodity: string;
}

export interface GalleryAccount {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly parentId: string | null;
  readonly depth: number;
  readonly balances: readonly MoneyAmount[];
  readonly transactionCount: number;
  readonly lastTransactionDate: string | null;
}

export interface GalleryPosting {
  readonly accountId: string | null;
  readonly accountName: string;
  readonly amount: MoneyAmount;
  readonly memo: string | null;
}

export interface GalleryTransaction {
  readonly id: string;
  readonly date: string;
  readonly description: string;
  readonly code: string | null;
  readonly status: 'unmarked' | 'pending' | 'cleared';
  readonly postings: readonly GalleryPosting[];
  readonly tags: readonly { readonly key: string; readonly value: string }[];
  readonly createdAt: null;
  readonly source: 'app' | 'hledger';
}

export interface GalleryPrice {
  readonly commodity: string;
  readonly quoteCommodity: string;
  readonly date: string;
  readonly rate: string;
  readonly source: string | null;
}

export interface GalleryFixtureSet {
  readonly accounts: readonly GalleryAccount[];
  readonly transactions: readonly GalleryTransaction[];
  readonly prices: readonly GalleryPrice[];
}

const longAccountPath = '자산:장기저축:가족과함께준비하는미래계획:주거와교육을위한목적자금:외화와디지털자산:장기간분리하여관리하는준비계정:매우긴이름과공백없는문자열의줄바꿈을확인하는계정:서울특별시성동구에서시작한우리의저축기록';

/** Fictional review data, never a server response or a connection to a ledger. */
export const galleryFixtures: GalleryFixtureSet & { readonly worstCase: GalleryFixtureSet } = {
  accounts: [
    { id: 'demo-bank', name: '생활비 통장', path: '자산:예금:생활비 통장', parentId: 'demo-deposits', depth: 3, balances: [{ value: '2450000', commodity: 'KRW' }], transactionCount: 24, lastTransactionDate: '2026-10-19' },
    { id: 'demo-wallet', name: '해외여행 지갑', path: '자산:현금:해외여행 지갑', parentId: 'demo-cash', depth: 3, balances: [{ value: '320.50', commodity: 'USD' }, { value: '12500', commodity: 'JPY' }], transactionCount: 8, lastTransactionDate: '2026-10-17' },
    { id: 'demo-food', name: '식비', path: '비용:생활:식비', parentId: 'demo-living', depth: 3, balances: [{ value: '186500', commodity: 'KRW' }], transactionCount: 12, lastTransactionDate: '2026-10-19' },
    { id: 'demo-credit', name: '신용카드', path: '부채:카드:신용카드', parentId: 'demo-cards', depth: 3, balances: [{ value: '-420000', commodity: 'KRW' }], transactionCount: 9, lastTransactionDate: '2026-10-18' },
  ],
  transactions: [
    {
      id: 'demo-lunch', date: '2026-10-19', description: '동네 식당에서 점심', code: null, status: 'cleared',
      postings: [
        { accountId: 'demo-food', accountName: '비용:생활:식비', amount: { value: '12500', commodity: 'KRW' }, memo: '점심 식사' },
        { accountId: 'demo-bank', accountName: '자산:예금:생활비 통장', amount: { value: '-12500', commodity: 'KRW' }, memo: null },
      ],
      tags: [{ key: '분류', value: '생활' }], createdAt: null, source: 'hledger',
    },
    {
      id: 'demo-book', date: '2026-10-18', description: '읽고 싶었던 책', code: 'BOOK-018', status: 'pending',
      postings: [
        { accountId: null, accountName: '비용:배움:도서', amount: { value: '24.9900', commodity: 'USD' }, memo: '배송 확인 대기' },
        { accountId: 'demo-wallet', accountName: '자산:현금:해외여행 지갑', amount: { value: '-24.9900', commodity: 'USD' }, memo: null },
      ],
      tags: [{ key: '분류', value: '배움' }], createdAt: null, source: 'app',
    },
  ],
  prices: [
    { commodity: 'USD', quoteCommodity: 'KRW', date: '2026-10-19', rate: '1350.2500', source: '가상 시세 · 실제 환율 아님' },
    { commodity: 'BTC', quoteCommodity: 'USD', date: '2026-10-19', rate: '64200.12345678', source: '가상 시세 · 실제 환율 아님' },
  ],
  worstCase: {
    accounts: [
      { id: 'demo-long', name: '매우 긴 계정 이름과 정밀도 확인', path: longAccountPath, parentId: null, depth: 8, balances: [{ value: '900719925474099312345678901234567890.1234567890123456789000', commodity: 'KRW' }, { value: '0.000000000000000000000000000001', commodity: 'BTC' }], transactionCount: 2147483647, lastTransactionDate: '2026-10-19' },
      { id: 'demo-zero', name: '아직 거래가 없는 계정', path: '자산:예금:아직거래가없는계정', parentId: null, depth: 3, balances: [{ value: '0.00', commodity: 'USD' }], transactionCount: 0, lastTransactionDate: null },
      { id: 'demo-negative', name: '음수와 소수 자릿수', path: '부채:정산:음수와소수자릿수', parentId: null, depth: 3, balances: [{ value: '-12345678901234567890.000100', commodity: 'USD' }], transactionCount: 1, lastTransactionDate: '2026-10-18' },
    ],
    transactions: [
      {
        id: 'demo-precision', date: '2026-10-19', description: '가족과 함께 준비하는 장기 계획의 정산 — 긴 한국어 설명과 여러 줄에 걸친 거래 내용, 원본 소수 자릿수를 보존한 큰 금액 표시를 확인합니다.', code: 'LONG-REFERENCE-2026-10-19', status: 'unmarked',
        postings: [
          { accountId: 'demo-long', accountName: longAccountPath, amount: { value: '900719925474099312345678901234567890.1234567890123456789000', commodity: 'KRW' }, memo: '금액이 화면보다 길어도 정확한 값을 확인할 수 있어야 합니다.' },
          { accountId: null, accountName: '자본:기초잔액', amount: { value: '-900719925474099312345678901234567890.1234567890123456789000', commodity: 'KRW' }, memo: null },
        ],
        tags: [{ key: '검토', value: '긴 설명과 큰 금액' }, { key: '분류', value: '가상 자료' }], createdAt: null, source: 'hledger',
      },
      {
        id: 'demo-tiny', date: '2026-10-18', description: '아주 작은 소수 금액 · 반올림 없는 표시', code: null, status: 'pending',
        postings: [
          { accountId: 'demo-long', accountName: longAccountPath, amount: { value: '0.000000000000000000000000000001', commodity: 'BTC' }, memo: null },
          { accountId: null, accountName: '자본:기초잔액', amount: { value: '-0.000000000000000000000000000001', commodity: 'BTC' }, memo: null },
        ],
        tags: [], createdAt: null, source: 'app',
      },
    ],
    prices: [
      { commodity: 'BTC', quoteCommodity: 'KRW', date: '2026-10-19', rate: '900719925474099312345.1234567890123456789000', source: '정밀도 확인용 가상 시세 · 실제 환율 아님' },
      { commodity: 'DEMO', quoteCommodity: 'BTC', date: '2026-10-18', rate: '0.000000000000000000000000000001', source: null },
    ],
  },
};
