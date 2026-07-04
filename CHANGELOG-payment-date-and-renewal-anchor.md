# Editable payment date + renewal alert anchored on גבייה הבאה

Two related billing-card bugs, fixed in three commits (smallest/safest first).

---

## Bug 1 — Mark-as-paid hard-wrote today's date

### The bug

When a payment was marked `שולם` from the גבייה tab, the `שולם ב` field recorded
`today()` (the data-entry date) instead of the actual payment date. Vered had no
way to backdate (e.g. entered today, but actually paid on 22/06).

### Root cause

`recompute()` inside `buildBillingRow` (`public/app.js`) wrote a hardcoded
`paymentDate: newStatus === 'paid' ? today() : (payment.paymentDate || '')`. The
schema already stored a **separate** `paymentDate` (distinct from `dueDate`) in
the Payments sheet — there was simply no UI to enter it.

### The fix (Commit 1 — frontend only)

`buildBillingRow` now renders an editable `<input type="date" class="billing-paid-date">`
defaulting to `payment.paymentDate || today()`. `recompute()` reads it instead of
hardcoding `today()`:

```js
paymentDate: newStatus === 'paid'
  ? ((paidDateInput && paidDateInput.value) || today())
  : (payment.paymentDate || ''),
```

A `change` listener on the date input persists a backdate through the **same**
single save path (`saveBillingRow` → `persistPayment`) when the row is already
paid; it is a no-op while unpaid/partial. The patient-card `שולם ב` chip reflects
the new value automatically (it already renders `basePay.paymentDate`) — no new
render code.

`setCurrentMonthPaid` and the renew-and-pay modal are intentionally untouched.

**Round-trip safety:** a single payment save goes through `_upsertPayment`
(row-level `setValues` by `id` across all `PAYMENTS_HEADERS`, `paymentDate`
included) — not `_writeAll`. Backdating round-trips with no field drop.

**No schema change, no Apps Script redeploy** for this bug.

---

## Bug 2 — Renewal alert used the wrong anchor

### The bug

The countdown banner (`חידוש בעוד X ימים`) computed from `תחילת טיפול + ~30 days`
instead of from the next-billing date (`גבייה הבאה`). The `גבייה הבאה` value
itself was correct — the alert just read a different source.

### Root cause — two layers

1. **Divergent computation.** The `גבייה הבאה` chip rendered the stored
   `c.nextBillingDate` (`addDays(anchor, 30)`), while `renewalInfo(c)` computed
   its own anchor — `addMonth(c.paymentDate || c.startDate)` in the unpaid branch
   and `addMonth(currentMonthBaseDueDate(c))` in the paid branch. Three formulas,
   no single source of truth (the same badge-vs-overdue pattern as a prior bug).
2. **Persistence gap.** `paymentStatus`, `paymentDate`, and `nextBillingDate`
   were written by `clientForSheet` but were **absent from `CLIENTS_HEADERS`** in
   `apps-script/Code.gs`. Because `_readAll`/`_writeAll` map positionally to the
   header array, those three fields were **silently dropped on every client
   save** and came back blank on reload. With `paymentDate`/`nextBillingDate`
   gone, `renewalInfo` fell back to `c.startDate` — exactly the "counts from
   תחילת טיפול" symptom.

### The fix (Commits 2 + 3)

**Commit 2 — `apps-script/Code.gs` (requires Apps Script redeploy).**
Appended `paymentStatus`, `paymentDate`, `nextBillingDate` to the **end** of
`CLIENTS_HEADERS` (append-only, no backfill — per the existing positional rule).
These now persist, so the alert can anchor on a stored `nextBillingDate`. This
also repairs the pre-existing silent drop of all three client-level fields.

> ⚠️ **Redeploy required:** Apps Script → Manage deployments → existing
> deployment → pencil → New version. Existing Clients rows stay blank for the new
> columns until the next save of that client (no backfill).

**Commit 3 — `public/app.js` + `public/charges-logic.js`.**
`renewalInfo` no longer recomputes the anchor. It reads `nextRenewalDueDate(c)`,
which now **prefers the stored `c.nextBillingDate`** — the same value the chip
shows — falling back to the legacy `paymentDate || startDate + 1mo` calc only for
rows saved before the field was persisted:

```js
function nextRenewalDueDate(c) {
  if (!c) return '';
  if (c.nextBillingDate) return c.nextBillingDate;   // same source as the chip
  var anchor = c.paymentDate || c.startDate || '';   // legacy fallback only
  if (!anchor) return '';
  return addMonth(anchor);
}
```

Both `renewalInfo` branches (paid / unpaid) now read this one anchor; the
independent `addMonth` paths are gone. The paid-this-month "never overdue" guard
(and the negative-gap clamp to 0) is preserved. The `חידוש ותשלום` button already
calls `nextRenewalDueDate`, so it aligns through the shared helper. The mirror in
`public/charges-logic.js` is updated identically (the two are kept in sync by
contract).

---

## Tests

`test/charges.test.js` — new parity tests locking the chip-vs-alert formula in
the pure module: `nextRenewalDueDate` prefers a stored `nextBillingDate`, equals
the chip source verbatim (same anchor in → same date out), and still falls back
to the legacy calc when `nextBillingDate` is blank.

`test/stop-flag-match.test.js` — the Clients schema guard updated from
"`phone` is LAST" to assert the new append-only tail
`['phone', 'paymentStatus', 'paymentDate', 'nextBillingDate']`.

Pre-existing `test/sheets-secret-forwarding.test.js` (EADDRINUSE) and
`test/debt-status-forwarding.test.js` (`express` not installed) are environmental
and unrelated to this change.

---

## Files touched

- `public/app.js` — `buildBillingRow` (editable paid-date), `nextRenewalDueDate`,
  `renewalInfo`.
- `public/charges-logic.js` — `nextRenewalDueDate` (mirror).
- `public/style.css` — `.billing-row` grid column + `.billing-paid-date` styling.
- `apps-script/Code.gs` — `CLIENTS_HEADERS` append (**redeploy required**).
- `test/charges.test.js`, `test/stop-flag-match.test.js`.

**Bug 1 is frontend-only. Bug 2's durable fix requires the Apps Script redeploy
(Commit 2).**
