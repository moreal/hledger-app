import { arePostingsBalanced, type TradePosting } from '../domain/src/trade.ts';
/** Pure contract guards. Scalars throw TypeError; input validators collect field errors. */
export type JSONValue = null | boolean | number | string | JSONValue[] | JSONObject;
export type JSONObject = { [key: string]: JSONValue };
export interface ValidationIssue { path: string; code: string; message: string }

export function parseDecimal(value: unknown): string {
  if (typeof value !== 'string' || !/^-?[0-9]+(?:\.[0-9]+)?$/.test(value) || value.endsWith('\n')) {
    throw new TypeError('Decimal must be an exact decimal string without exponent notation');
  }
  return value;
}

export function parseDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.length !== 10) throw new TypeError('Date must be YYYY-MM-DD');
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]!) throw new TypeError('Date is not a valid Gregorian calendar date');
  return value;
}

/** RFC 3339 string with an explicit offset. Leap seconds are not accepted. */
export function parseDateTime(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('DateTime must be a string');
  const match = /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.[0-9]+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match || match[0].length !== value.length) throw new TypeError('DateTime must include a timezone');
  parseDate(match[1]);
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59 || (match[5] && (Number(match[6]) > 23 || Number(match[7]) > 59))) throw new TypeError('DateTime contains an invalid clock or offset');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function parseJSONObject(value: unknown): JSONObject {
  if (!isRecord(value)) throw new TypeError('JSONObject requires a plain JSON object');
  const ancestors = new Set<object>();
  const visit = (item: unknown): void => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (!Array.isArray(item) && !isRecord(item)) throw new TypeError('JSONObject contains a non-JSON value');
    if (ancestors.has(item)) throw new TypeError('JSONObject cannot contain cycles');
    ancestors.add(item);
    if (Reflect.ownKeys(item).some((key) => typeof key !== 'string')) throw new TypeError('JSONObject cannot contain symbol keys');
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index++) visit(item[index]);
    } else {
      for (const child of Object.values(item)) visit(child);
    }
    ancestors.delete(item);
  };
  visit(value);
  return value as JSONObject;
}

function integerRange(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) throw new TypeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  return value;
}

export function validateFirst(value?: unknown): number {
  return value === null || value === undefined ? 50 : integerRange(value, 1, 200, 'first');
}

/** Structural guard only; the server must verify the cursor's scope and revision. */
export function validateAfter(value?: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) throw new TypeError('after must be a nonempty opaque cursor');
  return value;
}

export function validateDepth(value: unknown, output = false): number {
  return integerRange(value, 1, output ? 20 : 10, 'depth');
}

/** Use for all nonnegative Int counts, totals and indexer lag. Never truncate. */
export function validateGraphQLCount(value: unknown): number {
  return integerRange(value, 0, 2147483647, 'count');
}

function issue(issues: ValidationIssue[], path: string, message: string, code = 'INVALID_INPUT'): void {
  issues.push({ path, code, message });
}

function checkString(issues: ValidationIssue[], path: string, value: unknown, min: number, max = Infinity, optional = false): boolean {
  if (optional && (value === null || value === undefined)) return true;
  if (typeof value !== 'string' || [...value].length < min || [...value].length > max) {
    issue(issues, path, `Expected a string of ${min}–${max === Infinity ? 'unlimited' : max} characters`);
    return false;
  }
  return true;
}

function checkScalar(issues: ValidationIssue[], path: string, value: unknown, parser: (value: unknown) => unknown): boolean {
  try { parser(value); return true; } catch (error) { issue(issues, path, error instanceof Error ? error.message : 'Invalid scalar'); return false; }
}

export function validateTags(value: unknown, path = 'tags'): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (value === null || value === undefined) return issues;
  if (!Array.isArray(value)) { issue(issues, path, 'Expected a list of tags'); return issues; }
  const keys = new Set<string>();
  value.forEach((tag, index) => {
    const location = `${path}[${index}]`;
    if (!isRecord(tag)) { issue(issues, location, 'Expected a tag object'); return; }
    if (checkString(issues, `${location}.key`, tag.key, 0)) {
      if (keys.has(tag.key as string)) issue(issues, `${location}.key`, 'Tag keys must be unique', 'DUPLICATE_TAG');
      keys.add(tag.key as string);
    }
    checkString(issues, `${location}.value`, tag.value, 0);
  });
  return issues;
}

function filterRecord(value: unknown, issues: ValidationIssue[]): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return {};
  if (!isRecord(value)) { issue(issues, 'filter', 'Expected a filter object'); return undefined; }
  return value;
}

function dateRange(filter: Record<string, unknown>, issues: ValidationIssue[]): void {
  const fromValid = filter.from == null || checkScalar(issues, 'from', filter.from, parseDate);
  const toValid = filter.to == null || checkScalar(issues, 'to', filter.to, parseDate);
  if (fromValid && toValid && typeof filter.from === 'string' && typeof filter.to === 'string' && filter.from > filter.to) issue(issues, 'to', 'to must be on or after from');
}

export function validateAccountFilter(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const filter = filterRecord(value, issues);
  if (!filter) return issues;
  if (filter.includeEmpty != null && typeof filter.includeEmpty !== 'boolean') issue(issues, 'includeEmpty', 'Expected a Boolean');
  if (filter.depth != null) checkScalar(issues, 'depth', filter.depth, validateDepth);
  if (filter.asOf != null) checkScalar(issues, 'asOf', filter.asOf, parseDate);
  checkString(issues, 'query', filter.query, 1, 200, true);
  return issues;
}

export function validateTransactionFilter(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const filter = filterRecord(value, issues);
  if (!filter) return issues;
  dateRange(filter, issues);
  checkString(issues, 'query', filter.query, 1, 200, true);
  checkString(issues, 'accountId', filter.accountId, 1, Infinity, true);
  checkString(issues, 'commodity', filter.commodity, 1, 32, true);
  if (filter.includeSubaccounts != null && typeof filter.includeSubaccounts !== 'boolean') issue(issues, 'includeSubaccounts', 'Expected a Boolean');
  issues.push(...validateTags(filter.tags));
  return issues;
}

export function validatePriceFilter(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const filter = filterRecord(value, issues);
  if (!filter) return issues;
  dateRange(filter, issues);
  checkString(issues, 'commodity', filter.commodity, 1, 32, true);
  checkString(issues, 'quoteCommodity', filter.quoteCommodity, 1, 32, true);
  return issues;
}

/** GraphQL rejects unknown fields; this helper validates domain rules after coercion. */
export function validateCreateTransactionInput(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) { issue(issues, 'input', 'Expected a transaction object'); return issues; }
  checkString(issues, 'idempotencyKey', value.idempotencyKey, 1, 128);
  checkScalar(issues, 'date', value.date, parseDate);
  checkString(issues, 'description', value.description, 1, 512);
  checkString(issues, 'code', value.code, 0, 64, true);
  checkString(issues, 'clientReference', value.clientReference, 0, 128, true);
  issues.push(...validateTags(value.tags));
  if (!Array.isArray(value.postings) || value.postings.length < 2) { issue(issues, 'postings', 'At least two postings are required'); return issues; }
  const amounts: { value: string; commodity: string }[] = [];
  value.postings.forEach((posting, index) => {
    const path = `postings[${index}]`;
    if (!isRecord(posting)) { issue(issues, path, 'Expected a posting object'); return; }
    checkString(issues, `${path}.accountName`, posting.accountName, 1);
    checkString(issues, `${path}.memo`, posting.memo, 0, 1000, true);
    if (!isRecord(posting.amount)) { issue(issues, `${path}.amount`, 'Expected a money amount'); return; }
    const decimalValid = checkScalar(issues, `${path}.amount.value`, posting.amount.value, parseDecimal);
    const commodityValid = checkString(issues, `${path}.amount.commodity`, posting.amount.commodity, 1, 32);
    if (decimalValid && commodityValid) amounts.push(posting.amount as { value: string; commodity: string });
    if (posting.cost != null) {
      if (!isRecord(posting.cost) || !isRecord(posting.cost.amount)) { issue(issues, `${path}.cost`, 'Expected a cost with type and amount'); return; }
      if (!['UNIT', 'TOTAL'].includes(String(posting.cost.type))) issue(issues, `${path}.cost.type`, 'Expected UNIT or TOTAL');
      const validCost = checkScalar(issues, `${path}.cost.amount.value`, posting.cost.amount.value, parseDecimal);
      checkString(issues, `${path}.cost.amount.commodity`, posting.cost.amount.commodity, 1, 32);
      if (validCost && (String(posting.cost.amount.value).startsWith('-') || !/[1-9]/.test(String(posting.cost.amount.value)))) issue(issues, `${path}.cost.amount.value`, 'Cost must be positive');
      if (posting.cost.amount.commodity === posting.amount.commodity) issue(issues, `${path}.cost.amount.commodity`, 'Cost must use a different settlement asset');
      if (decimalValid && !/[1-9]/.test(String(posting.amount.value))) issue(issues, `${path}.amount.value`, 'A costed quantity must be nonzero');
    }
  });
  if (issues.length || amounts.length !== value.postings.length) return issues;
  try {
    const postings = value.postings as unknown as TradePosting[];
    if (!arePostingsBalanced(postings)) {
      const code = !postings.some(p => p.cost) && new Set(amounts.map(a => a.commodity)).size > 1 ? 'MIXED_COMMODITY' : 'UNBALANCED';
      issue(issues, 'postings', 'Posting amounts converted at their transaction costs must sum to exactly zero in each settlement asset', code);
    }
  } catch (error) { issue(issues, 'postings', error instanceof Error ? error.message : 'Invalid costed postings'); }

  return issues;
}
