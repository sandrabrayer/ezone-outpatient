# Payment-verify fix — «נדרש אימות תשלום» after marking paid (2026-11-02)

## Symptom

A patient was set to «שולם» in עריכה. The card then showed «נדרש אימות תשלום»
(a label, not clickable), with no way to resolve it from the card.

Production data (fixture-free summary): the Clients row had
`paymentStatus=paid`, `paymentDate` set, `nextBillingDate` one cycle ahead,
and **no row at all in Payments** for that client.

## Root cause

The edit form wrote a payment row only when the paid **date** changed
(`propagatePaid = paidDateChanged && paymentStatus === 'paid'`). Changing the
**status** to «שולם» while the date stayed as typed at intake saved the client
as paid with no payment row. The card correctly refuses to treat a future
anchor as proof of payment, and showed the review chip.

## Fix (frontend only)

- `missingCyclePayment(c, today)`: when the package is paid-up by its anchor
  but the current cycle has no confirmed payment, builds that cycle's base row
  (id = cycle base id, legacy id kept if one exists; amount = package amount;
  paid date = stored `paymentDate`, clamped to today). Null otherwise.
- **עריכה**: status changed to «שולם» (or date changed) with the anchor already
  ahead and no confirmed row → writes that row; the anchor does not move.
  The old date-change path (anchor due/past) is unchanged.
- **Card chip**: for editors, «נדרש אימות תשלום — לרישום ✓» opens a confirm
  showing amount, cycle and paid date, then writes the row via
  `persistPayment`. Failure → persistent financial-save warning, never a false
  success. Non-editors still see the read-only label.
- SW `v22 → v23`. No Apps Script change (`savePayment` already validates).

## Tests

`test/payment-verify.test.js` (helper contract, edit-form flow, chip wiring).
`test/month-paid-advances-billing.test.js` regex window widened (same intent);
`test-support/financial-ui-fixture.cjs` registers the helpers. Suite 1705/1705.

## Data

Nothing changed by code. The affected card is fixed by one click on the chip
(after verifying the money arrived).
