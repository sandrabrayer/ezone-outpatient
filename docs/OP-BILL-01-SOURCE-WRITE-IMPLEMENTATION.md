# OP-BILL-01 — Source financial policy integration (DRAFT; no production authorization)

## Objective
Correct the monthly collection date for **new verified ordinary monthly receipts**, preserving all previously stored records and their explicit service periods. This document is a work specification, not evidence the write-side correction has been implemented.

## Contract
- `dueDate` identifies the original billing item; it is *not* evidence for the paid service period.
- On **new** fully paid, ordinary monthly receipts without agreed explicit different coverage, set `coverageStart=paymentDate`; set inclusive `coverageEnd = addCalendarMonthsClamped(paymentDate, 1) - 1 day`; set `nextBillingDate = coverageEnd + 1 day`.
- Example 2026-10-25 → through 2026-11-24 → next due 2026-11-25. Example 2026-10-15 → through 2026-11-14 → next due 2026-11-15.
- If an *explicit* agreed coverage interval or advance is recorded, it wins; calculate the next unpaid day from proven contiguous settled periods, not solely from a single receipt.
- A partial, zero, missing, invalid, future or uncertain payment cannot prove an entire month or move billing/paid-through. Never turn unpaid historic arrears into paid; ambiguous legacy rows require review.
- Preserve original historic source rows, auto-stamped coverage, payment IDs, immutable OP-02 operations and pending intent replays; do not silently rewrite.
- Keep credits, refunds, revenue, monthly reports, collection alerts and both views consistent. No second payment store.

## Implementation scope
Existing public/app.js, public/charges-logic.js, public/credits-ledger.js, public/monthly-revenue.js, apps-script/Code.gs; durable renewal reserve/apply/journal and all other monthly payment entry points, including existing paid-date edit, mark-paid, intake/activation and collections. Source guard on actual amounts/dates and exact client IDs; no mutation of old records on ordinary edits. Legacy intent replay must remain possible without accepting *new* old-policy writes.

## Acceptance gates
Synthetic tests executing actual source functions, real browser financial flows, month ends (leap/non-leap), explicit 2-month prepayment, overdue prior debt, partial/unpaid, duplicate/retry, stale operation, missing source, no one-day discrepancy, income and refund allocation. Include negative control and before/after case matrix with CI counts on exact head.

## Boundaries
Isolated DRAFT stacked on #154. Do not merge, deploy, install Apps Script, operate on live customers, perform data repair, change secrets/permission, or activate triggers without Sandra's separate explicit authorization. OP-03 backup/recovery and E-ZONE One CRM release sequencing are independent release prerequisites.
