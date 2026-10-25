# Domain Lingui verification — 2026-10-25

Focused follow-up to [core UI localization](2026-10-25-lingui.md), implementing the [domain plan](../../superpowers/plans/2026-10-25-domain-lingui.md). This report does not claim a rerun of the earlier complete native checklist or a new remote CI run.

## Scope and automated verification

Transaction entry, stock helpers, book purchase/disposal/lookup, asset search and domain validation now render in Korean/English. Each catalog contains 756 extracted messages, excluding the PO header. User metadata, exact decimal strings, account paths, asset identifiers, ISBNs and arbitrary server diagnostics remain unchanged.

| Check | Result |
| --- | --- |
| Full shared/API/domain suite | 276 passed |
| Locale and preference suite (`test:i18n`) | 18 passed |
| Nonmutating catalog checker tests | 4 passed |
| Native book validation | 5 passed |
| Mobile connection and book regressions | 7 passed; overlaps the 5 book checks above |
| Full typecheck | PASS |
| Web production build | PASS |
| Storybook production build | PASS |
| Extraction, translation completeness and generated catalog freshness | PASS |

These automated results are coordinator-reported. Catalog count was independently checked in both PO files: 757 `msgid` entries each, including the header.

Outbox snapshots remain version 1, with validated optional semantic `messageInfo` alongside retained legacy `message`. Tests cover old records, new metadata, corrupt metadata, exact legacy mappings, raw diagnostics, uncertainty after a rejected retry, and same-key success. Rendering changes language without mutating saved requests or sending them. Native trade state is controlled by the ledger screen; hidden mounted views preserve state through settings navigation.

## Web observations

| Scenario | Evidence and result |
| --- | --- |
| General draft switches to English | [General draft](/private/tmp/hledger-domain-lingui/web/general-en.txt): `123.4500`, `-123.4500` and `REF-001` retained |
| Stock helper and validation | [Korean stock](/private/tmp/hledger-domain-lingui/web/stock-ko.txt) and [English validation](/private/tmp/hledger-domain-lingui/web/stock-error-en.txt): `2.5000`, deliberately invalid `-2.5000`, price `70000.00` and fee `150.00` retain exact text |
| Book draft switches language | [Korean book draft](/private/tmp/hledger-domain-lingui/web/books-ko.txt): manually entered title/author, ISBN `9780000000002` and `12500.00` retained |
| Uncertain book write switches language | [Korean pending](/private/tmp/hledger-domain-lingui/web/pending-ko.txt) → [English pending](/private/tmp/hledger-domain-lingui/web/pending-en.txt): uncertainty warning and locked fields remain |
| Explicit retry resolves saved result | [Retry result](/private/tmp/hledger-domain-lingui/web/retry-result.txt): success notice and one copy for the scenario |

The first fault probe dropped the socket after the server saved successfully. The browser transparently retried it, so that probe did not establish a visible uncertain state. A separate `502_AFTER_SUCCESS` scenario returned HTTP 502 after a successful server save, producing the observed pending warning. After the language switch, only the explicit retry repeated that scenario request. [Proxy events](/private/tmp/hledger-domain-lingui/web/proxy-events.jsonl) show identical idempotency key and input hash for its initial request and retry. The fixture has two books total: one from the initial socket-drop probe and one from the visible uncertainty scenario; do not interpret the total as a duplicate caused by language switching.

## Native observations

General, stock and book draft checks and persisted outbox recovery pass on both native platforms. All requested focused web, iOS and Android checks pass.

[iOS results](/private/tmp/hledger-domain-lingui/ios/result.json) contain 26 screenshots and native-driver inspections. The general draft retained `REF-ios-001`, accounts, memos, tags, client reference and exact amounts `-123.4500` / `123.4500`. Stock retained deliberately invalid quantity `-2.5000`, price `123.4500` and fee `0.0500` while the same visible error translated without resubmission. Book entry retained ISBN `9788936434120`, author `Domain iOS author`, invalid price `0.0000` and the actual mixed title `소년이 온Domain iOS manual title` across language changes. ISBN metadata arrived during initial typing; the shorter intended title is not claimed as the observed value. The visible positive-amount validation translated without a write.

iOS explicitly persisted an offline request, translated its queued/unknown notices across Korean and English, then confirmed the original key `5ec9d624-90c3-406e-bb10-29228dae5b61`. [Before retry](/private/tmp/hledger-domain-lingui/review/ios-before-queue-retry.json), [after dropped response](/private/tmp/hledger-domain-lingui/review/ios-after-drop.json), and [after same-key confirmation](/private/tmp/hledger-domain-lingui/review/ios-after-same-key-confirm.json) audits show transaction totals `139 → 140 → 140`, owned-key counts `0 → 1 → 1` and no duplicate keys. The journal fingerprint is identical after the dropped response and confirmation. Final Korean preference, blank token and retained succeeded record were verified, and its temporary bridge was stopped.

Android [general](/private/tmp/hledger-domain-lingui/android/general-result.json), [trade](/private/tmp/hledger-domain-lingui/android/trade-result.json) and [book](/private/tmp/hledger-domain-lingui/android/book-result.json) results verify retained values and visible validation retranslation. General retained `123.4500` / `-123.4500`, `DA-001`, memos and client reference. Stock retained `AAPL`, `-2.5000`, `225.123400` and `1.2300`. Books retained ISBN `9780306406158`, title `Domain Android Book001`, author `QA Author001` and `100.2300`; the previously visible ISBN validation message followed Korean → English → Korean. [Final Android results](/private/tmp/hledger-domain-lingui/android/result.json) confirm queued and unknown states persisted across Korean → English → Korean, followed by an explicit same-key confirmation for `9ab41293-d1d2-4b51-85ef-aa1c2550f844`. [Before retry](/private/tmp/hledger-domain-lingui/review/android-before-queue-retry.json), [after dropped response](/private/tmp/hledger-domain-lingui/review/android-after-drop.json) and [after confirmation](/private/tmp/hledger-domain-lingui/review/android-after-same-key-confirm.json) show `139 → 140 → 140` transactions and exactly one row for that key, no duplicate keys and an unchanged journal fingerprint across confirmation. Final Korean preference and blank token were verified; the succeeded record and older outbox records remain.

[Final fixture audit](/private/tmp/hledger-domain-lingui/review/final-fixture.json) records 140 transactions / 5 books in each populated native fixture and 2 transactions / 2 books in the web fixture. Temporary fixture shutdown follows this audit.

A nonblocking visual polish follow-up remains on both native platforms: synchronization labels concatenate their values without a separator (`Connectionhttp://`, `Request keyUUID`). It does not affect recovery or localization checks; the tested release artifacts retain this observed behavior.

## Local release artifacts and source provenance

Both packages use Node 26.12.1, Yarn 4.12.0, Expo 58.0.16, React Native 0.88.0, Rollipop 1.0.0-beta.1 and Hermes 99 with reused local dependencies. Native installs updated existing app data without uninstall/reset.

| Artifact | Provenance |
| --- | --- |
| Android unsigned release | [APK](/private/tmp/hledger-domain-lingui-android-output-004/app-release-unsigned.apk); SHA256 `796163ca11a8e4b97e71e7540697e743963b1401b1cbfb156969deee74fbfa7b` |
| Android installed QA derivative | [APK](/private/tmp/hledger-domain-lingui/android/lingui-release-test-signed.apk); SHA256 `407637eeb6ddf3d1f5a589e3de49d4e10744dd9fbc46412cbccbfe90fefc8798`; embedded bundle identical |
| Android Hermes | 1,819,196 bytes; SHA256 `b4552b28187c5271c180f549f188c7b82fbbc4aa9b872b67db31442ab2ecde7d` |
| iOS simulator release | [App](/private/tmp/hledger-domain-lingui-ios-output-001/HledgerDesignGallery.app) |
| iOS Hermes | 2,210,248 bytes; SHA256 `a4313e3528c31d28291812800c10ec9550857bc82e251787bfc9daa38ba646dd` |

[Android provenance](/private/tmp/hledger-domain-lingui/android/provenance.json), [Android source match](/private/tmp/hledger-domain-lingui/android/source-match.json) and [iOS source match](/private/tmp/hledger-domain-lingui/ios/source-match.json) record the staged sources. Native runtime source and native-used messages match the tested code. Native staging preceded final corrections to two web-only English IDs, `web.books.34` (Payment asset) and `web.books.count` (1 copy / 2 copies). Those web corrections were tested in the current runtime; the complete English catalog bytes therefore differ from the staged native catalogs.

Evidence uses isolated synthetic QA data. These are local simulator/emulator release checks; no distribution signing, physical-device verification or successful remote GitHub Actions run is claimed.
