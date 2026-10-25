# Full native QA automation implementation plan

> **For agentic workers:** Use subagent-driven development with exclusive file ownership and evidence-based completion.

**Goal:** Re-execute all 54 existing checklist procedures on both newest CI native artifacts and retain repeatable automation.

**Architecture:** Maestro exercises native accessibility controls; platform runners preserve artifacts and per-ID results. Separate loopback fixture services provide deterministic pagination, balances, book states and controllable response loss. Native screenshots and ledger audits complement UI assertions.

**Tech Stack:** Existing Maestro 2.6.0, Android ADB, iOS Simulator, Node.js fixture CLI, current Rollipop release artifacts.

**Spec:** User request and `docs/qa/mobile-release-checklist.md` (54 existing sub-IDs).

## Constraints

- Test CI run 40165612461 / source 366a0f99c2a77e042f9389b92f9bd8aa133c57ee without rebuilding or modifying bundled application code.
- Never write to the real ledger or reuse old write-test records. Create new named fixtures on loopback ports 4200–4204.
- Preserve TLS/network protections and authentication. Tokens stay in local restricted files, never in repository flows or reports.
- Assign every checklist ID a fresh platform-specific result and evidence. No previous PASS inheritance or aggregate flow-success substitution.
- Unsupported automatic stock gain calculation remains a documented conditional N/A; supported buy/sell/cost/fee behavior must execute.

## Owned tasks

- [x] Fixture worker: `scripts/qa/fixture.mjs`, `scripts/qa/fixture.test.mjs`. Seed, start, controlled proxy, audit and stop with isolated paths and overwrite refusal; verify no real-ledger access.
- [x] Android worker: four `.maestro/android/*.yaml` files and `scripts/qa/android-runner.py`. Probe installed Maestro, implement repeatable flows, execute 54 procedures, record exact UI and ledger outcomes.
- [x] iOS worker: four `.maestro/ios/*.yaml` files and `scripts/qa/ios-runner.mjs`. Probe current Simulator compatibility, execute the same independent procedure set, record limitations honestly.
- [x] Documentation worker: checklist, `docs/qa/automation.md`, `docs/qa/runs/2026-10-25-full-native.md`. Maintain the fresh 108-result matrix and executable instructions.
- [x] Coordinator: this plan, shared development-server stop/restore window, artifact provenance review, cross-platform evidence review and final integration.

## Review focus

1. Failed connection candidates must not replace the active authenticated connection.
2. A failed or lost mutation response must retain the same request key and produce exactly one ledger transaction on retry.
3. Pagination needs sufficient seeded accounts, account transactions, transactions and prices; missing fixture is not PASS.
4. Actual covers and keyboard visibility require screenshot review, not merely URLs or field values.
5. Stored tokens, downloaded book/company images and generated runtime journals must not enter source control.

## Execution and completion

Probe tool compatibility before authoring large flows. Use assertions and observed controls, retain command failures and bounded retries. Stop only the known development service for cold-launch verification, then restore it. Audit successful writes and request-key uniqueness in each isolated ledger. Review all 54 rows per platform, report defects or blockers explicitly, and persist flows, instructions and evidence references after validation.

## Progress evidence

- Isolated fixture native-full-003 is active; initial native ledgers have 139 transactions, 70 nonzero accounts, 67 prices and five book copies. Exact seed tag/reference added without count changes.
- Both CI apps passed cold launch while the known Rollipop service was stopped; the service was restored.
- Added `scripts/qa/validate-results.mjs` and its tests to reject unknown/duplicate IDs, missing evidence, stale metadata and incomplete final gates.
- Added a serial persistent Maestro MCP bridge with token redaction, image evidence extraction and refusal to continue after a timed-out operation. Non-private or symlink token files are rejected before starting Maestro. Combined fixture/validator/bridge tests: 14 passed (local socket test required execution outside the filesystem sandbox).
- Android final canonical: 54 PASS, strict completion validator passed. Independently reviewed write/recovery audits, full outbox deletion traversal, native book results and long-input preservation. Its isolated ledger has 148 transactions (nine authorized additions); runtime token cleared.
- iOS final canonical: 54 PASS, strict completion validator passed. Native filter/pagination, keyboard/layout, actual covers, purchases/sale/discard, templates and exact-key recovery were independently reviewed. Its isolated ledger has 148 transactions (nine authorized additions); seven owned outbox records were removed, leaving an empty list.
- Independent automation review found a retained-token append risk in the Android authentication flow. Added `eraseText` before token input and checked the replacement sequence; the revised flow has not been replayed natively.
- Both platforms total 108 PASS with no pending/blocked rows. Unsupported automatic stock realized-gain calculation remains an explicitly excluded subcondition. Pagination proves additional native pages, not an exhaustive whole-ledger no-duplicate/no-omission audit.
- Final QA helper tests: 14/14 passed. All eight Maestro YAML files parsed. iOS complete books/write YAML suites remain guarded drafts; tested smaller Maestro flows and direct native observations are distinguished in the report.
- Follow-ups: English unknown-write-result body remains on both platforms; optional stock helper inputs reset after visiting settings, while already-generated postings were preserved. No application source changes were made during this QA run.
