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

function currencyDisplayNames(locale: string): Intl.DisplayNames | undefined {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      return new Intl.DisplayNames([locale], { type: 'currency', fallback: 'none' });
    }
  } catch {
    // Some native runtimes omit Intl currency names or the requested locale data.
  }
  return undefined;
}

type UnitLocale = 'ko' | 'en';
const currencyNames = { ko: currencyDisplayNames('ko'), en: currencyDisplayNames('en') };
const commonCodes = ['KRW', 'USD', 'EUR', 'JPY'];

function displayName(unit: Iso4217Unit, locale: UnitLocale): string {
  try {
    return currencyNames[locale]?.of(unit.code) || unit.name;
  } catch {
    return unit.name;
  }
}

const sortedFiatUnits = iso4217Units
  .filter(unit => unit.kind === 'currency')
  .sort((left, right) => {
    const leftIndex = commonCodes.indexOf(left.code);
    const rightIndex = commonCodes.indexOf(right.code);
    if (leftIndex !== rightIndex && (leftIndex >= 0 || rightIndex >= 0)) {
      return (leftIndex < 0 ? commonCodes.length : leftIndex)
        - (rightIndex < 0 ? commonCodes.length : rightIndex);
    }
    return left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
  });

const fiatOptionsByLocale = new Map<UnitLocale, readonly (AssetUnitOption & { searchText: string })[]>();
function fiatOptionsForLocale(locale: UnitLocale) {
  let options = fiatOptionsByLocale.get(locale);
  if (!options) {
    options = sortedFiatUnits.map(unit => ({
      value: unit.code,
      label: `${unit.code} · ${displayName(unit, locale)}`,
      kind: 'currency' as const,
      searchText: `${unit.code} ${unit.name} ${displayName(unit, 'ko')} ${displayName(unit, 'en')}`,
    }));
    fiatOptionsByLocale.set(locale, options);
  }
  return options;
}

/**
 * Suggestions, never an allowlist. Custom commodities retain their exact value,
 * including case, numeric identifiers and spaces. Only the search is normalized.
 * Callers own entry validation and local persistence.
 */
export function getAssetUnitOptions(
  customValues: readonly string[] = [],
  query: string = '',
  locale: string = 'ko',
): AssetUnitOption[] {
  const fiatOptions = fiatOptionsForLocale(/^en(?:-|$)/i.test(locale) ? 'en' : 'ko');
  const search = query.trim().toLowerCase();
  const matches = (value: string) => value.toLowerCase().includes(search);
  const seen = new Set(fiatOptions.map(option => option.value));
  const options: AssetUnitOption[] = fiatOptions
    .filter(option => !search || matches(option.searchText))
    .map(({ value, label, kind }) => ({ value, label, kind }));

  for (const value of customValues) {
    if (seen.has(value)) continue;
    seen.add(value);
    if (!search || matches(value)) options.push({ value, label: value, kind: 'custom' });
  }
  return options;
}
