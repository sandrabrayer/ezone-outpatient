# OP-BILL-01 — explicit second-payment confirmation for the next future cycle

**Status:** DRAFT candidate only; no production activation, data migration or schema change. Source owner: Outpatient (existing #152), E-ZONE One #331.

**Current-base preparation, 6 Nov 2026:** the narrow guard from existing draft
PR #164 was adapted locally onto `213ffa4609c3453d8ddf5a6eb8a890eacedac3dd`.
The newer busy-spinner path, pricing recovery and treatment-session counters
are preserved. SW v31 → v32. No remote PR update, new issue/PR, merge or deploy.
The local branch is a review candidate for reusing #164, not a second work item.
The native Google drill was regenerated locally with a disabled placeholder
script ID (`runnable:false`); it was not uploaded or run against Google.

Eight focused tests pass: the five existing #164 tests plus three dynamic
UI/source tests using the real submit handler and the existing in-memory
Apps Script sandbox (cancel = zero reserve/apply calls and unchanged rows;
confirm = strict marker in the source journal; another paid date = no dialog).
No real-browser validation is implied by the DOM adapter.

Initial local validation: `npm test` reported **2,233 total, 2,160 pass, 0 fail,
73 skipped** before browser tooling was available. `npm audit` reports zero findings;
`git diff --check` passes. The eight focused regressions against the unmodified
base yield two passes and six expected failures. The current-base candidate
passes all eight. This distinguishes the regression from an assertion that
passes on both versions; it does not assert six production incidents.
The deployment branch still points to the stated base at the final read-only
check. Before any approved integration, refresh the existing #164 rather than
opening another PR; recheck the base and SW number if concurrent work advances.

**Browser acceptance completed locally, 6 Nov 2026:** installed the existing CI's
isolated Playwright 1.51.1 / Chromium 134 tooling outside the application's
dependencies. Reused the existing financial browser fixture (real UI + Express +
Code.gs; Google replaced by synthetic in-memory Sheets; non-local browser traffic
blocked). Added 1280px and 360px cases that cancel a same-date future payment
with zero reserve calls, deliberately confirm one separate payment, acknowledge
it, reopen the next month's renewal, and cancel again. Only one payment remains;
the journal retains strict confirmation and the cycle advances exactly once.
Existing loss/retry recovery, roles, lead saves, pricing and spinner scenarios
also pass. Final complete suite: **2,235 pass, 0 fail, 0 skipped**, including the
73 previously skipped browser cases and two new browser regressions. Source data
and production were not accessed. This is synthetic browser acceptance, not a
claim of a production financial transaction or a native Google runtime drill.

## Real incident grounding (without patient identifiers)
Read-only live production Sheets, 4 Nov 2026:
- Existing two paid monthly entries for the **same client**, both bearing actual payment date 25 Oct 2026, have different deterministic cycle IDs: November (01–30 Nov coverage) and December (01–31 Dec coverage), each same amount. The December record matches an **acknowledged** FinancialOps operation created **1 Nov 2026**; the November record has no matching FinancialOps record in the journal. Thus it was a separate future-cycle renewal, not a duplicate ID insert.
- Whether the finance source received one actual payment or two is **UNVERIFIED**; only Ortal can reconcile receipts/bank. Do not delete/change any row from this audit.
- Existing `_getRenewalState` only returns **active** journal operations. After acknowledgement the next cycle becomes selectable. A new click generates a fresh op ID and can settle that next cycle, even when the entered paid date exactly matches the earlier receipt. This is the specific gap this change bounds.

## Guard, reuse and allowed advance
1. In «חידוש ותשלום», when the **current source** client already has the entered payment date and the **next due** is in the future, require an unmistakable confirmation that another distinct payment was received for the displayed cycle. Cancel creates no operation. Never imply an unsuccessful UI response means a save did not commit.
2. In Apps Script `_finIntentError` under `_reserveRenewal`'s existing lock, reject such a future-cycle same-date reserve unless the request includes **strict boolean** `advanceConfirmed:true`. This marker persists in the existing FinancialOps JSON intent for audit/retry and is validated on the server; string `"true"` or missing flag cannot bypass.
3. Existing `opId` idempotency, source snapshots, lock, abort on uncertain replies, paid-date coverage `max(paymentDate, contractualCycleDate)`, old rows and posted journals are retained. Existing stored intents are not retroactively revalidated; `advanceConfirmed` is optional for older completed operations.
4. Deliberate prepaid second calendar months remain possible when staff explicitly confirms another paid receipt. This confirmation records **staff intent**, NOT proof that the bank has two receipts, and never invents extra cash.
5. No extra ledger, new sheet, new financial field, backfill, debt recalculation or historical repair.

## Synthetic acceptance, no production data
- Successful November payment, acknowledged journal, then accidental attempt to pay December on the **same payment date** → `renewal_advance_confirmation_required`, no new rows, client unchanged.
- Separate real advance confirmed → second period written to December with exact coverage, FinancialOps records confirmation.
- Different payment date remains allowed without duplicate-date warning.
- String-forged confirmation refused, no source mutation.
- UI guard/source parity check; existing renewal/recovery, partial, advance, leap, browser and OP03 suites retained.

## Release boundaries / limitations
- Client.paymentDate is a source-backed last-paid-date indicator, **not a bank-confirmed remittance ledger**. Detection is intentionally limited to same recorded date + future cycle. Different date / already due cycle is not automatically adjudicated as fraudulent or duplicate.
- Existing quick «שולם» path can still have uncertain-response UX issues distinct from journalled renewals; review in CRM #339 before claiming complete application-wide idempotency.
- Before release, review/update the existing #164 and run exact-head remote CI. Local synthetic browser checks are complete. An Apps Script source deploy still requires explicit Sandra approval; no live patient or financial row is to be created as a test.
