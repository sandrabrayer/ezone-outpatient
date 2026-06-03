# מטופלים — סמן חודש כשולם מכרטיס המטופל (Mark month paid from patient card)

## Behavior

The monthly payment status on each patient card (the `חבילה: …` chip) is now a
**clickable button** for editors when the current month is not yet paid.
Clicking it marks the **current month's base payment** as paid.

Crucially, the chip is now **driven by the same per-month payment row** that the
גבייה (billing) tab uses — `paymentForClientOn(client, currentMonthBaseDueDate)`
— instead of the old client-level `c.paymentStatus` field. Reading and writing
the same row is what keeps the two tabs consistent: mark paid on the card and
the row shows paid in גבייה, and vice versa.

### Before

The chip read `c.paymentStatus` (a single client-level field) and had no click
handler — clicking it did nothing (see the prior investigation: it was a plain
`<span>` with no listener and no `data-*` target).

### After

- Status comes from the current month's base payment row.
- Editor + not-paid → rendered as `<button class="chip chip-unpaid month-pay-btn"
  data-action="mark-month-paid">חבילה: לא שולם ✓</button>`.
- Editor + already paid, or viewer role → rendered as the previous read-only
  `<span class="chip …">`.

## Single write path — same as גבייה

On click, `markCurrentMonthPaid(c)`:

1. Resolves the current month's base row via `paymentForClientOn(c,
   currentMonthBaseDueDate(c))` (returns the existing row if one exists under the
   new or legacy id, else a fresh template).
2. If it's already `paid`, no-op.
3. Builds the paid row exactly like the גבייה `recompute('paid')` does —
   `amountPaid = amountDue`, `status: 'paid'`, `paymentDate: today()`.
4. **Optimistically** upserts it into `state.payments` (by id), re-renders the
   active view, then calls **`persistPayment(updated)`** — the same
   `savePayment` action the גבייה tab uses.
5. **On failure**: rolls back `state.payments` to the previous value (or removes
   the row if it was newly added), re-renders, and shows an error toast.

No new persistence function and no new Apps Script action are introduced — the
write goes through the existing `persistPayment` → `apiPostAction('savePayment',
…)` → `_upsertPayment` path. `_upsertPayment` keys on `payment.id`, so the
write is an idempotent per-row upsert.

### Payment id / month keying

The base monthly id scheme is unchanged: `pay::<clientId>::base::<YYYY-MM>` (see
`CHANGELOG-extra-charges.md`). `currentMonthBaseDueDate(c)` builds the due date
for the current month using the client's billing day (`c.billingDay`, else the
start-date day-of-month), clamped to the last day of the month — matching
`clientsDueOn()` so the card and the גבייה list agree on the row's `dueDate`.
The id keys only on the month, so the day alignment is cosmetic/consistency, not
identity.

## No confirm dialog (deliberate)

The גבייה tab marks paid via a `<select>` change with **no** confirmation
prompt. To stay consistent, the card button also does **not** prompt. (There is
no `showConfirm` helper in the codebase, and adding a confirm only here would
diverge the two flows.)

## Files touched

- `public/app.js`
  - `currentMonthBaseDueDate(c)` — new helper (current-month base billing date,
    mirroring `clientsDueOn` day selection).
  - `markCurrentMonthPaid(c)` — new handler (optimistic upsert + rollback +
    `persistPayment`, re-renders the active view).
  - `clientCard()` — the `חבילה: …` chip now reads the per-month payment row and
    renders as a button (editor + unpaid) wired to `markCurrentMonthPaid`.
- `public/style.css` — `button.month-pay-btn` (cursor: pointer + hover/active
  affordance).

**Code.gs is NOT modified.** No Apps Script redeploy required — `savePayment` /
`_upsertPayment` already exist. Railway frontend deploy is sufficient.

## Manual test checklist (live URL, editor role)

a. Open מטופלים → a patient whose current month is unpaid → the `חבילה: לא שולם`
   chip shows as a button (pointer cursor, hover highlight).
b. Click it → toast "החודש סומן כשולם", chip flips to `חבילה: שולם` (read-only),
   and a "שולם ב: <today>" chip appears.
c. Open גבייה, set the date to that client's current-month billing day → the
   base row shows as paid with today's `paymentDate` and full amount.
d. Reload → status persists (no duplicate row; same id upserts).
e. Viewer role → chip is a plain read-only span, not clickable.
f. Simulate a save failure (offline) → chip reverts to unpaid and an error toast
   shows.
