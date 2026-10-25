# Optional Books and Open Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Follow file ownership; coordinator integrates commits.

**Goal:** Make Books an opt-in built-in module while retaining ledger data and pending recovery, and retrieve international ISBN metadata/covers independently of SeoJi.
**Architecture:** A durable ledger-scoped feature store gates server operations. Core-owned client recovery and drafts survive module unmount. Fixed GraphQL contracts expose features and read-only recovery; provider adapters validate exact normalized ISBN candidates.
**Tech Stack:** TypeScript, GraphQL, React, Expo/React Native, Lingui, Rollipop, hledger.
**Spec:** ../specs/2026-10-25-optional-books-design.md (approved by user 2026-10-25).

## Global Constraints

- Existing bearer authentication authorizes feature settings; production uses `${canonicalJournal}.features.json` and existing canonical ledger ID.
- New ledgers default off; verified existing managed book records preserve use through one-time migration. Corrupt settings/evidence fail closed.
- Feature writes and book mutations share a cross-process feature lock; preserve journal locking and reserved metadata guards.
- Disabled means no new book operations or external metadata/cover requests, including client images. Generic ledger reads remain available.
- Preserve legacy pending storage keys/formats, exact input/idempotency/ledger identity, drafts and language. Never silently discard or regenerate pending requests.
- `adapter.read()` may recover interrupted writes. Disabled recovery must use a genuinely read-only inspection or return UNKNOWN.
- Central SDL/operations/codegen remain fixed; no runtime foreign code installation.
- External provider traffic contains only ISBN/provider credentials/app identity. No ledger/token forwarding, no TLS bypass, no bundled third-party pages/images.
- Root owns catalog extraction/compilation, integration docs and commits; source workers do not edit catalogs/generated code without assignment.

## Review Focus

- Another client disables while a pending write exists: keep recovery, reject new writes, never infer unsaved from missing proof.
- Concurrent toggle/write and process restart: settings CAS and durable gate serialize admission.
- Same key with different book input: read-only proof must not falsely confirm.
- Misassociated ISBN/Work/cover and malformed or slow provider responses: reject unmatched candidates and preserve manual edits.
- Module off/unmount or locale/connection switch: no hidden external requests and no draft/pending loss.

## Shared interfaces

- `ledgerFeatures: LedgerFeatures!` contains `ledgerId`, `books { moduleId version migrationVersion enabled migratedExistingData canRead canWrite canLookupMetadata canRecover }`.
- `setBooksEnabled(enabled:Boolean!,expectedVersion:Int!,hasPending:Boolean=false): BooksFeaturePayload!` returns `feature` and existing `FieldError` errors.
- `bookRequestStatus(input:BookRequestStatusInput!): BookRequestStatus!`; input has optional `purchase:PurchaseBookInput` and `disposal:DisposeBookInput`, exactly one required. Result `status:CONFIRMED|UNKNOWN`, optional `book:BookCopy`, `idempotency:IdempotencyInfo`.
- Client `ledgerFeatures()`, `setBooksEnabled(enabled,expectedVersion,hasPending=false)`, `bookRequestStatus(request:{kind:'purchase',input:PurchaseBookInput}|{kind:'dispose',input:DisposeBookInput})`.
- `lookupBookMetadata(isbn, options?)` in new `services/api/book-metadata.ts` preserves existing metadata lookup envelope; Open Library primary, explicitly configured SeoJi fallback.
- `LedgerAdapter.inspectReadOnly?():Promise<LedgerSnapshot>` must not recover/write; missing method means proof UNKNOWN. Durable proof helper in books.ts validates full original request against stored evidence without invoking mutation.

### Task 1: Durable feature gate
**Files:** services/api/feature-settings.ts, feature-settings.test.ts, feature-integration.test.ts, schema.ts, server.ts.
- [x] Test new off, existing-record migration, restart, corrupt settings, stale version, unauthenticated access, concurrent disable/write, and disabled direct query/mutation/lookup.
- [x] Implement disk and explicit test-memory stores; gated resolver registration; production sidecar wiring and no implicit enabled fallback.
- [x] Verify focused tests; report interfaces to contract/client owners; review gate.

### Task 2: Read-only book recovery
**Files:** services/api/types.ts, hledger.ts, hledger.test.ts, books.ts, books.test.ts.
- [x] Test confirmed purchase/disposal replay proof, changed input UNKNOWN/conflict, missing proof UNKNOWN, interrupted write files unchanged, and generic reads independent from book reconstruction.
- [x] Add read-only adapter inspection and full-request proof helper; remove books.ts runtime dependency on SeoJi normalization.
- [x] Update book API tests with explicit feature stores; verify real hledger journaling, no duplicate writes; review gate.

### Task 3: Fixed contract and client
**Files:** packages/api-contract/schema.graphql, operations.graphql, packages/client/index.ts, books.test.ts, generated/** (generated ownership exception).
- [x] Add fields/types/typed operations and generate contracts.
- [x] Test typed settings/recovery operations and hostile/missing confirmation handling.
- [x] Verify schema validation, codegen and client tests; review gate.

### Task 4: ISBN metadata and cover providers
**Files A:** services/api/open-library.ts, open-library.test.ts, book-metadata.ts, book-metadata.test.ts.
**Files B:** services/api/book-covers.ts, book-covers.test.ts, packages/domain/src/book-cover-url.ts, book-cover-url.test.ts.
- [x] Test exact ISBN10/13/979, wrong Edition/Work, oversized/malformed responses, timeout/rate limits/cache, provider independence and safe redirects/images.
- [x] Implement Open Library bounded metadata provider and independent router; support verified Edition cover IDs without weakening host/format checks.
- [x] Perform a small live ISBN probe with key-free public APIs and retain provenance in temporary QA evidence only; review gates.

### Task 5: Web module and core recovery
**Files:** apps/web/src/App.tsx, Books.tsx, book-recovery.ts, book-recovery.test.ts, book-module.tsx.
- [x] Test legacy storage read, immutable pending input/key, corruption fail-closed, disabled recovery and retained draft state.
- [x] Hoist pending and drafts into core-owned controller; register lazy module entry, settings toggle, capability refresh, no off image/metadata activity; preserve manual edits and Lingui.
- [x] Validate web typecheck and browser off/on, existing data, pending, foreign metadata and cover rendering; review gate.

### Task 6: Native module and core recovery
**Files:** apps/mobile/LedgerApp.tsx, Books.tsx, book-recovery.ts, book-recovery.test.ts, book-module.tsx.
- [x] Test legacy durable namespace, immutable pending/key/identity, corruption fail-closed, and disabled recovery.
- [x] Keep core recovery/drafts mounted while module UI unmounts off; settings toggle and capability refresh; translate all new UI and stop off image/lookup activity.
- [x] Validate native typecheck and fresh Rollipop iOS/Android release execution with real overseas metadata/cover and state-preservation QA; review gate.

### Task 7: Integration and verification
**Files:** root-owned Lingui catalogs, docs/books.md, docs/i18n.md, new focused QA report, this plan.
- [x] Extract/translate/compile catalogs; full tests/typecheck/web+Storybook builds; review cross-layer integration and safety boundaries.
- [x] Isolated test ledgers only; verify disabled generic records, pending across off/reconnect/relaunch, same-key recovery and exact no-duplicate audit, real international cover pixels on web/iOS/Android.
- [x] Record artifact hashes, source match, limits and cleanup.
- [x] Prepare verified changes for signed publication on the existing work branch; user confirmed Secretive readiness after the first signing refusal. Publication result is recorded in Git history.

## Coordination rulings

- Use current live source checkout and existing isolated publishing checkout; do not reset the unborn main .git or create conflicting copies. Existing source/file ownership workflow is retained.
- Parallel workers own disjoint files, as required by project AGENTS.md. Contracts above coordinate shared boundaries; root handles generated/catalog writes and integration.
- User explicitly approved execution with Sol 6.1; no repeated design/plan approval is needed.

## Execution ledger

- Backend gate, read-only recovery, typed contract and providers implemented; independent spec/quality reviews passed. Full shared/API suite306/306 passed including real hledger/HTTP.
- Web/native core controllers implemented; capability validation, stale-client responses and toggle error persistence reviewed/fixed. Legacy unbounded account values and original request bytes remain readable.
- Web manual fallback, existing records, off/on draft retention, disabled UNKNOWN/CONFIRMED proofs and real Open Library cover pixels passed. Both proof intervals left journal/sidecars unchanged. Browser socket-close resend was idempotent; deterministic post-commit502 tested retained pending separately.
- QA found web automatic metadata relookup after returning from off/hidden. Explicit single-start lookup/cancellation and2 regression tests fix it; final UI request count5→5. Independent follow-up review passed.
- QA found missing shared UI catalog IDs hidden by development fallback. Explicit Lingui UI directories and real-config production interpolation regression fix19 missing IDs.793 messages/locale, zero missing; runtime18/catalog5/client21 checks and web/Storybook/typecheck passed.
- Native fresh build001 displayed real foreign covers and fallback; final build002 includes catalog fix and passed actual cover/date/state smoke. Native recovery and final hledger checks passed. Detailed evidence is tracked in docs/qa/runs/2026-10-25-optional-books.md.
- Purchase recovery may return current SOLD/DISCARDED copy after proving original purchase; stable purchase fields are compared without erasing later state.
- Additional assigned files: web book-lookup.ts/test; lingui.config.ts and scripts/i18n-check.test.mjs; docs/books.md and services/api/README.md. All worker ownership returned after changes. Root retains catalogs/plan/QA/docs integration.
