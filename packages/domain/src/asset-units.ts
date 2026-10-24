import snapshot from './iso4217.json';

/** Metadata only: minorUnit never constrains ledger amount precision. */
export interface Iso4217Unit {
  readonly code: string;
  readonly name: string;
  readonly numericCode: string;
  readonly minorUnit: number | null;
  readonly kind: 'currency' | 'fund' | 'metal' | 'special';
}

export const iso4217PublishedAt = snapshot.publishedAt;
export const iso4217SourceUrl = snapshot.sourceUrl;
export const iso4217Units: readonly Iso4217Unit[] = snapshot.entries as Iso4217Unit[];

export interface AssetUnitOption {
  readonly value: string;
  readonly label: string;
  readonly kind: 'currency' | 'custom';
}

function koreanCurrencyNames(): Intl.DisplayNames | undefined {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      return new Intl.DisplayNames(['ko'], { type: 'currency', fallback: 'none' });
    }
  } catch {
    // Some native runtimes omit Intl currency names or Korean locale data.
  }
  return undefined;
}

const currencyNames = koreanCurrencyNames();
const commonCodes = ['KRW', 'USD', 'EUR', 'JPY'];

function displayName(unit: Iso4217Unit): string {
  try {
    return currencyNames?.of(unit.code) || unit.name;
  } catch {
    return unit.name;
  }
}

const fiatOptions = iso4217Units
  .filter(unit => unit.kind === 'currency')
  .sort((left, right) => {
    const leftIndex = commonCodes.indexOf(left.code);
    const rightIndex = commonCodes.indexOf(right.code);
    if (leftIndex !== rightIndex && (leftIndex >= 0 || rightIndex >= 0)) {
      return (leftIndex < 0 ? commonCodes.length : leftIndex)
        - (rightIndex < 0 ? commonCodes.length : rightIndex);
    }
    return left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
  })
  .map(unit => ({
    value: unit.code,
    label: `${unit.code} · ${displayName(unit)}`,
    kind: 'currency' as const,
    englishName: unit.name,
  }));

/**
 * Suggestions, never an allowlist. Custom commodities retain their exact value,
 * including case, numeric identifiers and spaces. Only the search is normalized.
 * Callers own entry validation and local persistence.
 */
export function getAssetUnitOptions(
  customValues: readonly string[] = [],
  query: string = '',
): AssetUnitOption[] {
  const search = query.trim().toLowerCase();
  const matches = (value: string) => value.toLowerCase().includes(search);
  const seen = new Set(fiatOptions.map(option => option.value));
  const options: AssetUnitOption[] = fiatOptions
    .filter(option => !search || matches(`${option.value} ${option.label} ${option.englishName}`))
    .map(({ value, label, kind }) => ({ value, label, kind }));

  for (const value of customValues) {
    if (seen.has(value)) continue;
    seen.add(value);
    if (!search || matches(value)) options.push({ value, label: value, kind: 'custom' });
  }
  return options;
}
