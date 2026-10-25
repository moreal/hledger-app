# Lingui Korean/English foundation

User approved immediate implementation of the recommended incremental scope with Sol 6.1 agents, without another design approval round.

Use shared ko/en PO catalogs, compiled before builds, and ordinary annotated Lingui descriptors. This avoids a new macro transformer in Rollipop/Vite. Korean remains the default; explicit device-local language choice persists. Unknown saved values fall back to Korean. Both catalogs are packaged for offline native switching.

First migrate navigation, settings, connection guidance and shared transport error messages. Other domain forms/gallery content remain Korean until subsequent migration; do not label this a complete English product. Add Storybook language toolbar and a representative translated story. Ledger account names, asset IDs, book metadata, exact decimal strings, dates on the wire and request keys are data, not translation targets. Language changes must not remount the ledger app or clear drafts/outbox/authentication.

Shared interface: AppLocale='ko'|'en', supportedLocales, defaultLocale='ko', localeStorageKey='hledger.locale', resolveLocale(unknown), activateLocale(AppLocale), i18n singleton, createAppI18n(locale?), translateError(unknown). React bindings re-export I18nProvider/useLingui. Each platform owns annotated literal descriptors in its files; a single catalog owner extracts/compiles after edits. Web persists localStorage; native reuses a separate durable locale namespace (never connection/outbox namespace). Error translation preserves the warning that a write result may be unknown.

Verify locale fallback, interpolation/plurals, missing messages, transport error semantics, persistence and unchanged draft/data; typecheck/test/web/Storybook builds and Rollipop production iOS/Android packages plus native language switching/relaunch. Keep network/TLS protection and existing developer services. Use only synthetic fixture data for UI verification.
