import { parseDate, parseDecimal } from '../../packages/api-contract/validation';
import { normalizeIsbn } from '../../packages/domain/src/books';

export function bookDate(value: string): string {
  try { return parseDate(value); } catch { throw new Error('날짜를 YYYY-MM-DD 형식의 올바른 날짜로 입력해 주세요.'); }
}

export function bookIsbn(value: string): string {
  try { return normalizeIsbn(value); } catch { throw new Error('ISBN을 올바른 ISBN-10 또는 ISBN-13 번호로 입력해 주세요.'); }
}

export function bookDecimal(value: string, positive = false): string {
  try { parseDecimal(value); } catch { throw new Error('금액을 숫자와 소수점으로 정확하게 입력해 주세요.'); }
  if (value.startsWith('-') || (positive && !/[1-9]/.test(value))) throw new Error(positive ? '금액은 정확한 양수로 입력해 주세요.' : '금액은 0 이상으로 입력해 주세요.');
  return value;
}
