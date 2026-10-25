# Domain forms and durable diagnostics localization

Approved scope: Korean/English Lingui for remaining transaction, stock, book and asset-selection forms; saved synchronization errors; preserve existing input and explicit retry state when switching language.

## Ownership

- Client worker: `packages/client/{outbox.ts,index.ts,outbox.test.ts}` — optional validated semantic error metadata, backward-compatible version 1, unchanged request/recovery semantics.
- Shared localization worker: `packages/i18n/src/{index.ts,index.test.ts}` — render-time outbox/trade/error formatting and immutable locale-switch tests.
- Web worker: `apps/web/src/{App,TradeFields,AssetUnitField}.tsx` — reactive labels/notices and retained drafts.
- Native worker: `apps/mobile/{LedgerApp,TradeFields,AssetUnitField}.tsx` — reactive labels/notices and retained stock helper state across settings navigation.
- Books worker: both `Books.tsx`, mobile `book-validation.ts` and its test — reactive purchase/disposal/lookup validation without changing pending requests.
- Coordinator: this plan, catalogs and generated catalogs, `docs/i18n.md`, focused QA report. Native QA workers own only isolated temporary artifacts and devices assigned explicitly.

## Invariants

Locale changes must not recreate clients, requests, input, idempotency keys or pending writes. Unknown server diagnostics and ledger data remain verbatim. Durable snapshots stay version 1 and retain legacy messages. Semantic metadata augments new records. Legacy localization matches only known app-generated messages. Earlier uncertain writes stay uncertain after a rejected retry. No automatic retry or storage migration on language switch.

## Verification

1. Unit tests: legacy/new saved diagnostics, raw diagnostic preservation, no mutation, exact-key retries, domain validation.
2. Catalog extraction/English completion/compilation/freshness, all typechecks and relevant regressions.
3. Web: filled transaction/stock/book drafts and visible errors across settings language switch.
4. Fresh Rollipop release iOS/Android: same draft checks, persisted synchronization error language and same-key recovery, isolated fixture ledger audit.
5. Record exact artifacts, passing checks and any blocked checks without overstating remote CI or distribution signing.
