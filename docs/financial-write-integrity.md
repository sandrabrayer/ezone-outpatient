# OP-02 — Outpatient financial write integrity

Owner: Codex. Review date: 2026-10-16. Source base:
`afa9e8c0d4e3e04a9eabd7230db59a27030dee67`.
One active implementation at a time. OP-01 #115 is ready but waiting for owner
configuration and separate release approval; preparing OP-02a is a documented
queue decision, not closure or deployment of OP-01.

## OP-02a: source lock refusal — candidate ready

| Operation | Finding | Candidate behavior / evidence |
| --- | --- | --- |
| savePayment / updatePayment | Ignored refused script lock | Return `busy` before Sheets access; no unowned release |
| saveCharge / updateCharge | Same ignored result | Same refusal boundary |
| Four single/bulk payment/charge deletes | `waitLock` already throws before write block | Behavior unchanged; timeout, write error and repeated deletion tested |
| Retrying a saved row | Existing upsert searches its id | Same-id retry after ambiguous append keeps one row; a new id is a different operation |

All 30 new tests execute the real source handlers. Ten fail on the unmodified
base; all pass with the two-line fix. Full suite: 1,155 pass, 0 fail, 9 browser
skips. No live financial data was read or changed. The in-memory interleaving
is a deterministic contention simulation, not a real Google concurrency/load
measurement. No claim of atomicity across client, charge and payment writes.

## OP-02b: UI partial saves — next, unresolved

Run `TZ=UTC node test-support/financial-ui-failure-probe.cjs`. It extracts and
executes actual `public/app.js` submit handlers and actual date/id helpers,
replacing only UI services and persistence with synthetic fixtures. It is a
diagnostic, not a green acceptance test. Current `app.js` SHA-256:
`06775907725989375b0ec1f65f1028b8a0e957e1a8a15a234ef0a0e720737110`.

### 1. Renewal retry can advance to the next unpaid cycle

The renewal handler saves the client first, then the payment. In the fixture,
the client's due date is 2026-10-01 and the first payment save is refused:

| Step | Payment id attempted | Saved next billing date | Payment state |
| --- | --- | --- | --- |
| First submit | `pay::fixture-client::base::2026-10` | 2026-11-01 | Rejected; zero saved payments |
| Same form submitted again | `pay::fixture-client::base::2026-11` | 2026-12-01 | Retry targets November, leaving October unrecorded |

The code comment claiming the retry uses the same deterministic id is false
for this failure sequence: the next submit recomputes the due date from the
already advanced client. This reproduction is synthetic; it does not prove
that any actual client's account has been affected.

Acceptance for the repair: keep the intended billing cycle/payment id stable
after a partial failure, including close/reopen/reload and ambiguous server
success; prevent advancing the cycle twice or overwriting an unrelated
payment. Separate client-save failure from payment-save failure. Cover package
changes, backdated payments, short months, double-clicks and a stale second
tab. Preserve approved amount/coverage calculations. A transient in-memory
variable alone is insufficient for durable recovery.

### 2. Additional charge remains shown paid after its payment is rejected

With a synthetic additional charge marked paid, the charge save succeeds and
the payment save fails. The real handler retains the optimistic paid row,
emits a failure notice followed by the success notice `הטיפול נוסף`, and closes
the modal. Thus local paid state is not evidence of a saved payment.

Acceptance for the repair: retain the successfully saved charge, remove or
clearly mark unconfirmed payment state, retain a visible partial-success
message, and reconcile uncertain outcomes by the original payment id. Retrying
the payment must not create a second charge. Verify the actual Hebrew/RTL
flow in browser before release and bump the SW from its live version.

### Additional routes to include in the same review

Source inspection, not yet full failure-injection coverage:

- Direct client intake and lead activation also insert a paid row before
  payment confirmation and catch the payment error inside a success chain.
- Orphan-payment removal removes its local row before the source confirms;
  the catch reports an error without restoring the row.
- Review the edit-modal paid-date propagation and existing month-paid rollback
  flow before choosing a shared repair. Do not overwrite a legitimate saved
  payment when a later client update fails.

## Sequence and release boundary

Continue with OP-02b in this app before OP-04 performance. OP-03 scheduled
backup evidence and financial coverage remain open; OP-05 business controls
and OP-06 legacy `recordTreatmentGiven` integration remain separate. The
ten-app plan and return points live in Sandra's existing work-plan Page.

Do not open a second PR while OP-01 #115 is active. Preserve its exact reviewed
auth candidate; store this work on its own branch, then refresh/rebase and run
combined CI when it reaches the PR queue. No production release is authorized
by this document. See `CHANGELOG-financial-write-locks.md` for checks and gates.
