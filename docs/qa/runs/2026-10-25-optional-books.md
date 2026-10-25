# Optional Books module and international ISBN QA — 2026-10-25

## Scope and environment

Built-in, ledger-scoped Books module with an authoritative server feature sidecar; Open Library exact-ISBN metadata and cover-ID lookup; disabled-mode core recovery. This is focused regression QA, not a rerun of all 54 historical cases. Native artifacts are fresh local Rollipop release builds, not a new GitHub Actions run or store-signed device distribution.

All writes target isolated synthetic lifecycle `optional-books-001`. Web uses an empty ledger through loopback proxy4208; iOS and Android use copies containing139 transactions/5 books through proxies4206/4207. Real user ledgers are not used for test writes. SeoJi is absent from all three fixture API environments, so international lookup is independent of that service. Tokens remain in mode0600 local files and are absent from evidence and this repository.

## Checklist

| ID | Check | Web | iOS | Android |
|---|---|---|---|---|
| BOOK-001 | New ledger off; verified existing book data migrates on | PASS | PASS | PASS |
| BOOK-002 | Off hides Books UI while generic ledger records remain | PASS | PASS | PASS |
| BOOK-003 | Re-enable retains existing book records and draft/manual input | PASS | PASS | PASS |
| BOOK-004 | Explicit ISBN lookup returns real overseas title, author and cover pixels | PASS | PASS | PASS |
| BOOK-005 | NOT_FOUND permits manual entry and saving | PASS | PASS | PASS |
| BOOK-006 | Pre-forward failure preserves original request/key; known pending blocks local disable | PASS | PASS | PASS |
| BOOK-007 | External disable retains pending; read-only UNKNOWN does not alter journal/sidecars | PASS | PASS | PASS |
| BOOK-008 | Confirmed stored request clears pending while disabled without writing | PASS | PASS | PASS |
| BOOK-009 | Retry preserves input/key; final journal has no duplicate write keys | PASS | PASS | PASS |
| BOOK-010 | Off/on or screen return does not automatically issue metadata lookup | PASS | PASS | PASS |
| BOOK-011 | Release shared UI dates/status/a11y render interpolated text | Catalog regression PASS | PASS | PASS |

BOOK-001 native coverage is existing-ledger migration; new-empty off was verified by the shared API and web fixture, not a separate native empty-ledger UI run. The final Android build002 real-cover screenshot was independently inspected at `android/final002-ol-real-cover-pixels.png`; final iOS evidence is `ios/52-final-cover-shot/image-1.jpg`.

## Web evidence

- Live ISBN9780140328721 returned **Fantastic Mr. Fox**, **Roald Dahl**, Edition `OL7353617M`, cover ID15152634. Real cover pixels and attribution were inspected in the browser; final screenshot: `/private/tmp/hledger-optional-books-qa/web/open-library-final.png`.
- Valid but unlisted ISBN9799999999990 returned NOT_FOUND; manual title/author remained and a purchase was recorded.
- Draft ISBN/title/author/amount/accounts survived Settings→off→on. After fixing an automatic relookup bug, the final UI cycle retained the found metadata/cover and the proxy's metadata-operation count stayed5→5.
- Pre-forward502 left zero transactions; disabled UNKNOWN proof left journal SHA256 `c193d2ac15aef5750449f847812f21ff369332bf0f58768fcd8435067db8dd73` and all sidecar bytes unchanged.
- The first socket-close fault triggered a browser transport resend. The identical idempotency key/input produced exactly one transaction, so this was useful retry evidence but did not test pending retention. The QA proxy was corrected to return502 after a successful commit, and a second independent purchase then tested disabled CONFIRMED recovery.
- Final web ledger contains2 transactions/2 books, no duplicate keys. Before/after CONFIRMED proof:3613 bytes, SHA256 `fba7b250589ff125862b75a8349b889111f9cfe272a1ba481c648ab679c9a8e7`; all sidecars identical. The pending UI disappeared only after proof. Re-enabling exposed both saved books; off-mode generic accounts still showed their units.

## Automated checks and review

- Shared domain/client/API suite:306/306 passed, including actual hledger persistence and HTTP client tests.
- Web/mobile recovery, lookup cancellation and validation suite:21/21 passed.
- Locale/runtime tests:18/18; catalog tests:5/5. Both catalogs contain793 messages, zero missing translations; compile and freshness checks passed.
- Full TypeScript checks, GraphQL schema/operation validation, production web and Storybook builds passed. Web build retains the existing large-chunk advisory.
- Independent backend, provider and client spec/quality reviews passed. Web lookup follow-up review and its10 focused tests passed.

## Fixes discovered during verification

1. Web lookup originally retained a retry trigger across off/on, causing a new request on return. Lookup now starts only from the explicit button; hidden/disabled/changed-ISBN responses are invalidated. In-flight fetches may finish upstream, but their results are ignored and return does not start another request.
2. Lingui silently skipped the wildcard `packages/ui-*` include directory. Development fallback compilation hid missing shared UI messages; release cards displayed literal placeholders. Explicit UI directories,19 translated catalog entries and a real-config production-interpolation regression test fix this.

## Limits and provenance

An exact matching upstream ISBN/Edition and cover ID are checked; Open Library itself can still contain erroneous catalog associations. This is a successful live example, not a coverage claim for all overseas books. Missing metadata or covers remain editable/optional. TLS, host, redirect, size and image validation remain enabled. Public source pages, downloaded covers and runtime cache data are not committed. Screenshots and provider observations are local temporary QA evidence only.

No-off-lookup evidence combines gated API tests, proxy-operation intervals and actual unmounted UI. It is not a complete packet capture of all device image traffic. No external plugin installation, runtime third-party code loader, or stock/book accounting rewrite was added.

## Native recovery evidence

The iOS native UI preserved the exact pending payload/key through external disable, relaunch and reauthentication. Read-only UNKNOWN retained it without changing139 baseline transactions/30272 bytes. Explicit re-enable and same-key retry committed once; an upstream-success→502 fault left the pending request visible. External disable followed by CONFIRMED proof cleared only the active pending record, without appending or changing journal sidecars. Final iOS journal:140 transactions,32087 bytes, SHA256 `ee19046c71c2f10711255329041ab3dde8a16739b9c1a0e96f07b0df1edca784`; the internal request key occurs exactly once. The measured disabled interval contained no Books, metadata or purchase operations. Native durable storage preserves its older journal generation as designed; active generation is null after proof.

## Native artifacts and cleanup

Android also retained its exact pending request through update installation of build002, app relaunch and reauthentication while Books remained disabled. Its UNKNOWN proof left139 transactions/30272 bytes and all sidecars unchanged. Build002 Korean/English transaction date/status interpolation was visually checked. Android CONFIRMED recovery also cleared the active pending UI; the journal remained140 transactions/32122 bytes, SHA256 `f6551f1fe50bff609d379513ab37ce59f0b347736694a184438e861d2f97c4b4`, and the derived request key occurs once. The first proof audit interval overlapped a later feature toggle: only `.features.json` changed, so that interval must not be described as all-sidecar unchanged. A separate disabled same-request CONFIRMED proof was then run between isolated snapshots with no intervening toggle. Journal and all sidecar bytes matched (`android-confirmed-isolated-{before,response,after}.json`). No new pending request or purchase was created for that repeat.

### Final local release identity

Both final build002 artifacts use Node26.12.1, Yarn4.12.0, Expo58.0.16, React Native0.88.0 and Rollipop1.0.0-beta.1, with the documented local reused-node-modules mode. iOS uses the frozen Bundler/CocoaPods setup. Fresh staging source hashes match69 iOS and57 Android source/catalog files. No native runtime source changed between build001 recovery tests and build002; the final build adds corrected compiled catalogs.

| Artifact | SHA256 / evidence |
|---|---|
| iOS simulator `.app` Hermes bundle,2245107 bytes | `17e36f786fda26f90c0a152788c2dccd1477735ce883f4e1611918de0b3d8cab` |
| Android original unsigned APK | `5520e29a8b5354a30116687f497626681ed033a8b36d0ba0a243baa855cb56a7` |
| Android QA-signed and installed APK | `387e4840fcb8ba18154a6b046497b3ab5d5c43b5ac9df6c5a7cf1432679cee94` |
| Android Hermes bundle,1850476 bytes | `67ecaa1f03e91f7cedd7d56261c3aab8600abe799135162e3804857611eaf57b` |

The Android signature is a local QA derivative using the existing test key; its Hermes bundle equals the original unsigned artifact and installed APK hash matches. iOS artifact: `/private/tmp/hledger-optional-books-ios-output-002/HledgerDesignGallery.app`. Android original: `/private/tmp/hledger-optional-books-android-output-002/app-release-unsigned.apk`. Detailed evidence is in `/private/tmp/hledger-optional-books-qa/{ios/result.json,android/result.json,android/provenance.json,control}`. Android final off metadata count stayed3→3; its initial off/on restored existing records, and no extra final off→on cycle is claimed. iOS final off/on retained manual title/amount with metadata count4→4. iPhone17 simulator and Android API35 emulator were used, not physical devices.

### Final audit and cleanup

`control/final-summary.json` records final `hledger check` exit0 for all three fixtures and no duplicate keys: iOS140 transactions/6 books, Android140 transactions/6 books, web2 transactions/2 books. Native devices were returned to Korean with blank token inputs; the QA browser tab was closed after clearing its token. Existing unrelated outboxes/templates and durable journal generations remain intact. Only the three owned QA proxies, named fixture processes and owned iOS bridge were stopped; evidence and test ledgers were retained. Existing development services remain running. The existing development API alone was intentionally restarted to load the new schema, and its existing local SeoJi service was explicitly configured in the local untracked launcher; GraphQL health is OK.

## Change inventory

Implementation and documentation files (generated GraphQL output is reproducibly regenerated and remains ignored by Git):

- `apps/mobile/Books.tsx`
- `apps/mobile/LedgerApp.tsx`
- `apps/mobile/book-module.tsx`
- `apps/mobile/book-recovery.test.ts`
- `apps/mobile/book-recovery.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/Books.tsx`
- `apps/web/src/book-lookup.test.ts`
- `apps/web/src/book-lookup.ts`
- `apps/web/src/book-module.tsx`
- `apps/web/src/book-recovery.test.ts`
- `apps/web/src/book-recovery.ts`
- `docs/books.md`
- `docs/i18n.md`
- `docs/qa/runs/2026-10-25-optional-books.md`
- `docs/superpowers/plans/2026-10-25-optional-books.md`
- `docs/superpowers/specs/2026-10-25-optional-books-design.md`
- `lingui.config.ts`
- `packages/api-contract/operations.graphql`
- `packages/api-contract/schema.graphql`
- `packages/client/books.test.ts`
- `packages/client/index.ts`
- `packages/domain/src/book-cover-url.test.ts`
- `packages/domain/src/book-cover-url.ts`
- `packages/i18n/locales/en/messages.po`
- `packages/i18n/locales/en/messages.ts`
- `packages/i18n/locales/ko/messages.po`
- `packages/i18n/locales/ko/messages.ts`
- `scripts/i18n-check.test.mjs`
- `services/api/README.md`
- `services/api/book-covers.test.ts`
- `services/api/book-covers.ts`
- `services/api/book-metadata.test.ts`
- `services/api/book-metadata.ts`
- `services/api/books.test.ts`
- `services/api/books.ts`
- `services/api/feature-integration.test.ts`
- `services/api/feature-settings.test.ts`
- `services/api/feature-settings.ts`
- `services/api/hledger.test.ts`
- `services/api/hledger.ts`
- `services/api/open-library.test.ts`
- `services/api/open-library.ts`
- `services/api/schema.ts`
- `services/api/seoji.test.ts`
- `services/api/server.ts`
- `services/api/types.ts`
