# Approved-session report order — hardening candidate on draft PR #186 (not merged, not deployed)

Base: OUT #186/c4496524d9a202f6debff7294b540d0fb9fbaa47.
Paired work: THR #156 (precision/V2), THR #157/72d94ec (sender revision).

## What changes
- Only genuinely legacy rows can accept legacy external reports without a revision. Once a valid revision is recorded, an unversioned external event is refused with invalid_report_revision before SessionLog/pay/credit changes.
- An equal revision with differing persisted identity/result is source_outcome_conflict. Exact persisted replays return the existing result without repricing, credit reversal/application or log rewrite. These are existing terminal refusal categories in THR #157.
- reportRevision accepts explicit ISO instants or source Date cells, preserves milliseconds, and rejects ambiguous day-only/local timestamps and invalid calendar dates. Invalid stored evidence is never treated as a blank legacy revision.
- Only the reportRevision Date column receives full-instant read handling. Normal appointment/payment Date columns keep their existing behavior. New/updated report cells and SessionLog rewrites pin the revision as text.
- The existing proxy-authenticated correctSessionOutcome dispatcher passes a server literal 'outpatient' to the common handler. No JSON source/actor flag can select it. It retains its deliberate correction behavior and cannot invent the sender revision. Cross-app source authorization and Node roles are unchanged.
- No new column, accounting engine, secret, role, endpoint, SW asset or live migration. Existing forwarded-pay freeze and one-time writer remain unchanged.

## Intentional conservative limits
The schema stores no original frequency payload. An equal-revision day-centre event carrying an explicit frequency cannot be proved identical and is refused for reconciliation. The CURRENT THR #157 sender carries no frequency, so its ordinary retry remains supported. This is not a universal immutable-payload fingerprint design. Malformed historical revisions require separately authorized reconciliation; this patch does not repair historical rows automatically.

A newer authorized report may still follow a deliberate local correction. No cross-application transaction/rollback guarantee or crash-atomic credit/log write has been added. STAB-02 unknown-write recovery and other patient identity/scheduling concerns remain separate.

## Evidence and mandatory remaining gates
37 local selected-source scenarios: 37 pass, zero failures/skips. Same assertions on the selected baseline: 10 pass, 27 fail. The harness executes the inspected receiver/read/write functions with synthetic Sheets, locks, pricing and plan helpers. These counts are NOT full Code.gs, Express, real Google or production acceptance.

test/report-order-hardening.test.js runs against the COMPLETE existing Apps Script sandbox (real Code.gs doPost/auth, synthetic Sheets). Executed in the full repository on 2026-11-15 on top of c449652: full `npm test` 2387/2387 pass, 0 skipped (local; CI result is recorded on the PR). One bundled fixture was corrected (day-centre frequency 2 is not a valid frequency; now 3). Two source-scan tests that pinned the old `_recordSessionOutcome(payload)` text (test/payout-followups.test.js, test/session-who-when.test.js) now pin the new signature/dispatch literal. The old test explicitly accepting a legacy overwrite is replaced by the correct refusal expectation. Regenerate the operational drill with its own builder; run full repository tests and the combined THR #156+#157/OUT #186 paired suite at exact candidate heads. Test the mixed-version approval preflight→POST rollback and both late/repeated/conflicting events. Existing CI before this patch cannot certify it. No merge/deployment authorized.
