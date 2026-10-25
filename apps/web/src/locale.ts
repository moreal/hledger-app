import { resolveLocale, localeStorageKey, type AppLocale } from '../../../packages/i18n/src/index';

type LocaleReader = Pick<Storage, 'getItem'>;
type LocaleWriter = Pick<Storage, 'setItem'>;
export function readLocale(storage?: LocaleReader): AppLocale {
  try { return resolveLocale((storage ?? localStorage).getItem(localeStorageKey)); }
  catch { return 'ko'; }
}
export function persistLocale(locale: AppLocale, storage?: LocaleWriter): void {
  try { (storage ?? localStorage).setItem(localeStorageKey, locale); } catch { /* Device storage may be unavailable. Switching still works for this session. */ }
}
