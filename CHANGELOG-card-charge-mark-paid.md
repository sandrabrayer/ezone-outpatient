# CHANGELOG — Clickable extra-charge paid/unpaid toggle on the patient card

## Summary
The extra-charge status badge on the patient card (the לא שולם/שולם pill on each
חיוב נוסף row inside the תוכנית טיפול panel) is now a clickable toggle for
editors — one click marks the charge paid or unpaid, using the exact same write
path Vered uses in the גבייה tab. Viewers still see a static badge.

## Behaviour
- **Editor:** the badge renders as a `<button>`; clicking toggles paid ⇄ unpaid.
  A `partial` charge (only settable in the גבייה tab, with an amount) becomes
  paid on click. Marking paid stamps `today()` as the payment date — a plain
  toggle, exactly like the base-package card toggle. Backdating a charge stays in
  the גבייה tab (unchanged).
- **Viewer:** unchanged — the badge is a static `<span>`, no toggle.
- Optimistic: `state.payments` updates and the card re-renders immediately, then
  the write persists in the background; on failure the row is rolled back and an
  error toast is shown. Mirrors the existing `setCurrentMonthPaid` card pattern.

## Single write path — no parallel writer
The toggle reuses `persistPayment` → `savePayment` → server `_savePayment`, the
row-level upsert (find row by id → `setValues` one row, else `appendRow`, under
`LockService`) — the identical path the גבייה tab already uses for extra charges.
The charge's payment row is keyed `pay::<clientId>::chg-<chargeId>::<YYYY-MM|once>`.
No `_writeAll`, no new write path. Frontend-only — confirmed no missing persisted
field (`paymentForSheet` already round-trips `status`/`paymentDate`/`amountPaid`),
so **no Code.gs change and no Apps Script redeploy**.

## Changes
- public/charges-logic.js
  - `togglePaymentRow(existing, makePaid, amount, todayISO)` — pure builder for the
    plain paid/unpaid transition (paid → amountPaid=amount, paymentDate=today;
    unpaid → amountPaid=0, keep date; never emits `partial`). Exported + tested.
- public/app.js (inline mirror + wiring)
  - Charge status badge is role-aware: `<button class="charge-status-toggle"
    data-charge-toggle="<id>">` for editors, `<span>` for viewers.
  - Wired in the existing `state.role === 'editor'` card block (next to the ×
    remove control) → new `setChargePaid(c, ch)`.
  - `setChargePaid` — mirrors `setCurrentMonthPaid` for the extra-charge row via
    `paymentForExtraOn(c, ch, today())`: plain paid⇄unpaid toggle, optimistic
    update + `render()` + background `persistPayment`, rollback on failure.

## Tests
- test/card-charge-mark-paid.test.js (7 cases): unpaid→paid, paid→unpaid (keeps
  prior date), partial→paid, never-partial, id/clientId/dueDate carried (same-row
  upsert), base-row shape, number coercion. All pass.
- Full suite: 163/165. The 2 failures (`debt-status-forwarding`,
  `sheets-secret-forwarding`) are the pre-existing `server.js` forwarding tests
  (EADDRINUSE / network), unrelated to this change.
- The DOM wiring (`setChargePaid` + badge click) is IIFE-bound (no jsdom harness);
  the tested `togglePaymentRow` is the pure transition it mirrors.

## Deploy
Frontend only. Railway auto-deploys. No Apps Script redeploy.

## Verify (manual, after deploy)
- As editor, on a patient with an extra charge: click the charge's לא שולם badge
  → it flips to שולם immediately; reload → still שולם (persisted). Click again →
  back to לא שולם.
- The same charge's status in the גבייה tab matches (single source).
- As viewer, the badge shows status but is not clickable.
