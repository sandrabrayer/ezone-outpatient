# Paid/unpaid badge on client-card charge rows

Each extra-charge row on a client card now shows a paid / partial / unpaid
status pill so Vered can scan a client's outstanding extras without
opening גבייה.

## What changed

### `public/app.js`
- New inline helper `chargeStatusFor(client, charge)` next to
  `paymentForExtraOn`. Looks up the relevant payment row in
  `state.payments` and returns `'paid' | 'partial' | 'unpaid'`. Default
  when no payment row exists is `'unpaid'` — the row hasn't been touched
  yet.
- `clientCard` charge-row template renders a
  `<span class="charge-status charge-status-{status}">` between the label
  and the `×` remove button. Hebrew label: `שולם` / `שולם חלקית` / `לא שולם`.

### `public/charges-logic.js`
- New pure `chargeStatusFor(payments, client, charge, todayISO)`. Same
  rules as the inline copy in `app.js`. Exposed for tests.

### `public/style.css`
- `.client-charges .charge-status` — base pill geometry (11px,
  `border-radius: 999px`), reused from the existing `.status-badge`
  values.
- `.charge-status-paid` / `.charge-status-partial` / `.charge-status-unpaid` —
  reuse the same palette as the client status badges (`.status-active`
  / `.status-pause` / `.status-done`). No new design tokens.

### `test/charges.test.js`
- 6 new cases for `chargeStatusFor`: paid / partial / no-row-yet /
  explicit-unpaid / monthly-uses-current-month / one_time-uses-::once-id.

## Design decision: current-month-only for monthly extras

For a monthly extra, the badge reflects ONLY the current month's
payment row (`paymentId(client, today(), 'extra', chargeId)`).

If a prior month is still unpaid, that prior-month row stays in גבייה
as a יתרות פתוחות (open-balance) carry row — same behavior as the base
monthly subscription, so this needs no special handling. The card pill
is a "where are we right now" snapshot; the historical state lives in
the billing view.

## Not changed

- No backend changes.
- No schema or sheet changes.
- No migration.
- The payment-id scheme is unchanged.
- `clientsDueOn` / `renderBilling*` / `buildBillingRow` are untouched.

## Deployment

Frontend-only. Railway auto-deploys on merge. No Apps Script redeploy
needed.

## Manual test checklist on the live URL

a. Client with a one-time extra, unpaid → card shows `לא שולם`.
b. Mark that charge paid in גבייה → reload the Clients tab → card shows
   `שולם`.
c. Client with a monthly extra, current month unpaid → card shows
   `לא שולם`.
d. Mark current month paid in גבייה → card shows `שולם`.
e. Monthly extra where the current month is paid but a prior month is
   unpaid → card shows `שולם` (current-month rule). Confirm the prior
   month still appears in גבייה's `יתרות פתוחות`.
