import type { MoneyAmount } from './index';

export interface PostingAtCost {
  readonly amount: MoneyAmount;
  readonly cost?: { readonly type: 'UNIT' | 'TOTAL'; readonly amount: MoneyAmount } | null;
}
export interface TradePosting extends PostingAtCost { readonly accountName: string }
export interface TradeInput {
  side: 'BUY' | 'SELL';
  quantity: string;
  commodity: string;
  priceType: 'UNIT' | 'TOTAL';
  price: string;
  settlementCommodity: string;
  securityAccount: string;
  cashAccount: string;
  fee?: string;
  feeAccount?: string;
}
type Decimal = { units: bigint; scale: number };
function decimal(value: string): Decimal {
  const match = typeof value === 'string' ? /^(-?)([0-9]+)(?:\.([0-9]+))?$/.exec(value) : null;
  if (!match || match[0] !== value) throw new TypeError('Expected an exact decimal string.');
  return { units: BigInt(`${match[1]}${match[2]}${match[3] ?? ''}`), scale: match[3]?.length ?? 0 };
}
function render({ units, scale }: Decimal): string {
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  const value = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, '') : digits;
  return `${units < 0n ? '-' : ''}${value}`;
}
function add(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  return { units: a.units * 10n ** BigInt(scale - a.scale) + b.units * 10n ** BigInt(scale - b.scale), scale };
}
function multiply(a: Decimal, b: Decimal): Decimal { return { units: a.units * b.units, scale: a.scale + b.scale }; }
function text(value: string, label: string, max = Infinity): void {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max) throw new TypeError(`${label} is required${max < Infinity ? ` and must be at most ${max} characters` : ''}.`);
}
/** Build balanced acquisition/disposal postings. A fee above sale proceeds means cash is paid. */
export function buildTradePostings(input: TradeInput): TradePosting[] {
  if (input.side !== 'BUY' && input.side !== 'SELL') throw new TypeError('Invalid trade side.');
  if (input.priceType !== 'UNIT' && input.priceType !== 'TOTAL') throw new TypeError('Invalid price type.');
  text(input.commodity, 'Asset', 32); text(input.settlementCommodity, 'Settlement asset', 32);
  text(input.securityAccount, 'Asset account'); text(input.cashAccount, 'Cash account');
  if (input.commodity === input.settlementCommodity) throw new TypeError('Asset and settlement commodity must differ.');
  if (input.securityAccount === input.cashAccount) throw new TypeError('Asset and cash accounts must differ.');
  const quantity = decimal(input.quantity), price = decimal(input.price), fee = decimal(input.fee ?? '0');
  if (quantity.units <= 0n || price.units <= 0n) throw new TypeError('Quantity and price must be positive.');
  if (fee.units < 0n) throw new TypeError('Fee must be nonnegative.');
  if (fee.units > 0n) {
    text(input.feeAccount!, 'Fee account');
    if (input.feeAccount === input.cashAccount || input.feeAccount === input.securityAccount) throw new TypeError('Fee account must differ from trade accounts.');
  }
  const gross = input.priceType === 'UNIT' ? multiply(quantity, price) : price;
  const sign = input.side === 'BUY' ? 1n : -1n;
  const postings: TradePosting[] = [
    { accountName: input.securityAccount, amount: { value: render({ ...quantity, units: quantity.units * sign }), commodity: input.commodity }, cost: { type: input.priceType, amount: { value: input.price, commodity: input.settlementCommodity } } },
    { accountName: input.cashAccount, amount: { value: render(add({ ...gross, units: -sign * gross.units }, { ...fee, units: -fee.units })), commodity: input.settlementCommodity } },
  ];
  if (fee.units > 0n) postings.push({ accountName: input.feeAccount!, amount: { value: input.fee!, commodity: input.settlementCommodity } });
  return postings;
}
/** TOTAL costs take the quantity's sign; UNIT costs multiply its exact signed quantity. */
export function sumPostingsAtCost(postings: readonly PostingAtCost[]): MoneyAmount[] {
  const sums = new Map<string, Decimal>();
  for (const posting of postings) {
    const quantity = decimal(posting.amount.value);
    let amount = quantity, commodity = posting.amount.commodity;
    if (posting.cost) {
      const cost = decimal(posting.cost.amount.value);
      if (cost.units <= 0n) throw new TypeError('Cost must be positive.');
      if (posting.cost.type === 'UNIT') amount = multiply(quantity, cost);
      else if (posting.cost.type === 'TOTAL') amount = { ...cost, units: quantity.units < 0n ? -cost.units : quantity.units === 0n ? 0n : cost.units };
      else throw new TypeError('Invalid cost type.');
      commodity = posting.cost.amount.commodity;
    }
    sums.set(commodity, add(sums.get(commodity) ?? { units: 0n, scale: 0 }, amount));
  }
  return [...sums].map(([commodity, amount]) => ({ commodity, value: render(amount) }));
}
export function arePostingsBalanced(postings: readonly PostingAtCost[]): boolean {
  return sumPostingsAtCost(postings).every(amount => decimal(amount.value).units === 0n);
}
