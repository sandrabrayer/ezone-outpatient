# Renewal banner respects the paid current-month row

## The bug

A client could have the **current month's base payment fully paid** (the
paid/unpaid badge correctly showed `שולם`) and still get a red
**🛑 עצור טיפול — לא שולם עבור החודש הנוכחי** banner.

Confirmed with live data — single client `id_mon38qpc_xhpwq1`:

- `startDate: 2026-05-01`, no `billingDay`, today `2026-06-03`.
- Paid base row exists:
  `{ id: "pay::id_mon38qpc_xhpwq1::base::2026-06", dueDate: "2026-06-01",
  status: "paid", amountPaid: 2000 }`.
- Badge → `שולם` (reads the row). Banner → `overdue` (red).

## Root cause

`renewalInfo(c)` was **date-only**. It computed
`renewal = nextRenewalDueDate(c) = anchor + 1 month`
(`anchor = paymentDate || startDate`) and marked the client `overdue` whenever
`daysLeft < 0`, plus an `hasBillingProblem(c)` check on the denormalized
`paymentStatus` flag. It **never read `state.payments`**.

For the client above: `anchor = "2026-05-01"`, `renewal = "2026-06-01"`,
`daysBetween("2026-06-03", "2026-06-01") = -2 < 0` → `overdue`. The paid June
base row (`...::base::2026-06`) was completely invisible to the banner, even
though the badge — which uses `paymentForClientOn(c, currentMonthBaseDueDate(c))`
— could see it. The badge and the banner read from two different sources of
truth and diverged the moment the current month's due date slipped into the
past while that month was already paid.

(An earlier theory that `renewalInfo` called `paymentForClientOn` / had a
`paidThisMonth` variable was false — no such code existed.)

## The fix

`renewalInfo` now uses the **same source of truth as the badge** for "is the
current month settled?":

```js
var curDue = currentMonthBaseDueDate(c);
var paidThisMonth = paymentForClientOn(c, curDue).status === 'paid';
```

- **Paid this month** → the current month is settled. The renewal date becomes
  one cycle out from this month's due date (`addMonth(curDue)`), and the status
  is computed against that future date (`ok` / `due_soon`). A paid client is
  **never** `overdue`. A negative gap (stale data) is clamped to `0` so it can't
  render nonsense like "renew in -5 days".
- **Not paid** → unchanged behavior: `renewal = nextRenewalDueDate(c)`, then
  `hasBillingProblem(c)` / `daysLeft < 0` → `overdue`, `<= 7` → `due_soon`,
  else `ok`.

### Verification against the live values

`curDue = currentMonthBaseDueDate(c) = "2026-06-01"`
(no `billingDay` → `dayOfMonth(startDate) = 1`).
`paymentForClientOn(c, "2026-06-01")` finds
`pay::id_mon38qpc_xhpwq1::base::2026-06` → `status: "paid"` → `paidThisMonth =
true`. `renewal = addMonth("2026-06-01") = "2026-07-01"`,
`daysLeft = daysBetween("2026-06-03", "2026-07-01") = 28` → status **`ok`**.
The red banner clears.

## Files touched

- `public/app.js` — `renewalInfo` only (reuses existing `currentMonthBaseDueDate`,
  `paymentForClientOn`, `addMonth`, `daysBetween` — no new helpers).

**Frontend-only. `Code.gs` / Apps Script are NOT modified** — no redeploy
required; Railway auto-deploys the frontend on merge.
