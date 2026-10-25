import { localeStorageKey, resolveLocale, type AppLocale } from '../../packages/i18n/src';

type LocaleStorage = { load(): Promise<string | null>; save(value: string): Promise<void> };

/** Keeps hydration and writes independent from ledger settings and draft state. */
export function createLocalePreference(storage: LocaleStorage, activate: (locale: AppLocale) => void) {
  let locale: AppLocale = 'ko';
  let selection = 0;
  let writes: Promise<void> = Promise.resolve();
  let hydration: Promise<void> | undefined;
  return {
    current: () => locale,
    hydrate: () => hydration ??= (async () => {
      const revision = selection;
      let saved: unknown;
      try { const raw = await storage.load(); saved = raw === null ? undefined : JSON.parse(raw)?.[localeStorageKey]; } catch { saved = undefined; }
      if (revision !== selection) return;
      locale = resolveLocale(saved);
      activate(locale);
    })(),
    select: (next: AppLocale) => {
      selection += 1;
      locale = next;
      activate(next);
      const write = writes.then(() => storage.save(JSON.stringify({ [localeStorageKey]: next })));
      writes = write.catch(() => undefined);
      return write;
    },
  };
}
