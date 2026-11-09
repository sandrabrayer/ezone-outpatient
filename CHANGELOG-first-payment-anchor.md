# First-payment billing-cycle anchor + עוז קורסיה one-off repair — 2026-11-09

## The live bug

עוז קורסיה paid his first payment on **2026-10-25** (two months were recorded —
the agreement month plus an advance renewal by אורן on 01.11, both with paid
date 25.10). His card showed **גבייה הבאה 01/01/2027**; the correct figure is
**25/12/2026** (two calendar months from the payment date, per the OP-BILL-01
requested rule: *one ordinary monthly payment covers a calendar month FROM
paymentDate* — 25.10 → 25.11 → 25.12).

### Root cause

At every client-creation path the billing cycle was anchored on the
**startDate**, not the payment date:

- `billingDay: dayOfMonth(startDate)` — his startDate is 01.11, so billingDay
  became **1**;
- the paid intake/activation coverage was computed as
  `paymentDateCoverage(payDate, startDate)` — the `max(payDate, cycleDate)`
  rule then anchored coverage on **01.11**, keyed his rows `base::2026-11` /
  `base::2026-12` (due 01.11 / 01.12) and advanced the anchor to **01.01**;
- the agreement path used `nextCycleDueDateAfter(lead, agPayDate)`, which
  snaps to the startDate day-of-month.

The renewal design ("the advance anchors on the DUE date, never the paid date,
so the billing day stops drifting") is correct for *renewals of an established
cycle* — but at creation it made the arbitrary startDate day the cycle, while
the patient's real collection day is the day he actually pays.

## The fix (creation paths only; renewals unchanged)

When a new client is created with a recorded paid/partial payment, the **first
payment defines the cycle**:

- `billingDay` = the payment date's day-of-month (an explicitly entered billing
  day in direct intake still wins; startDate's day remains the no-payment
  fallback);
- the paid first cycle = `paymentDateCoverage(payDate, payDate)` — covers one
  calendar month from the payment (25.10 → 25.10-24.11), `nextBillingDate` =
  payDate + 1 month (short-month clamp);
- the intake payment row's `dueDate` (and month key) = the payment date, and a
  fully-paid row records `coverageStart`/`coverageEnd` explicitly;
- the agreement payment sets `lead.nextBillingDate = addMonth(agPayDate)`;
- the **pay-before-start refusal is removed** from the two creation guards —
  paying in advance before the treatment start date is the normal pattern this
  rule embraces (a future/malformed date is still refused).

Renewals, the month-paid chip, the edit modal and `nextCycleDueDateAfter`
(billing-day kept, no drift) are untouched.

## One-off data repair for עוז (editor-run)

`previewOzBillingCycleRepairNow()` / `applyOzBillingCycleRepairNow()` in
`apps-script/Code.gs` (NOT routed through doGet/doPost):

| Target | From | To |
| --- | --- | --- |
| Client `id_mvxnplnn_t6w0k6` | billingDay 1, nextBillingDate 2027-01-01 | billingDay 25, nextBillingDate **2026-12-25** |
| `pay::…::base::2026-11` | due 2026-11-01, coverage 01.11-30.11 | id `…base::2026-10`, due 2026-10-25, coverage 25.10-24.11 |
| `pay::…::base::2026-12` | due 2026-12-01, coverage 01.12-31.12 | id `…base::2026-11`, due 2026-11-25, coverage 25.11-24.12 |

Every current value is verified byte-for-byte before anything is written; any
drift (including a second run) refuses with a `state_mismatch` report. The
re-key order frees `base::2026-11` before reusing it, so two rows never share
an id even transiently, and the December month key becomes free — the 25.12
renewal (cycle 2026-12-25 → id `base::2026-12`) creates its row cleanly.

## Tests

`test/first-payment-cycle-anchor.test.js` (13): the payment-date arithmetic,
עוז's end-to-end figures (25.10 → 25.11; advance of cycle 25.11 → **25.12**),
source contracts on all three creation paths, and the repair's dry-run /
apply / drift-refusal / collision / not-routed behavior.
`test/month-paid-advances-billing.test.js` — the agreement-path assertion
updated to the new rule (deliberate).
