# חידוש ותשלום — Renew & Pay (v1: amount only)

## Behavior

A new editor-only **"חידוש ותשלום"** button on each patient card. It does two
things in one confirm:

1. Records **next month's base payment** as paid-in-advance, with a manually
   entered amount.
2. Updates the client's `pricePerSession` to that amount, as the new
   going-forward monthly default.

The button is gated exactly like ✏️ ערוך and + הוסף טיפול: rendered only when
`state.role === 'editor'`, with the same `.btn`/`.btn-ghost`/`.edit-only`
styling and inside `.client-actions`.

Clicking it opens a small RTL Hebrew modal (`#renewModal`, static markup in
`index.html`, toggled via `.hidden`, following the `openEditClientModal`
pattern: `form.reset()`, set values, `.hidden = false`; a single submit handler
registered once at init with `e.preventDefault()` and a `submit.disabled`
guard). The modal shows:

- A read-only line: `חידוש עבור: <client name> — <month>`, where the month is
  derived from `renewalInfo(c).renewalDate` (formatted via `monthLabel`).
- An editable amount field (`renewAmount`), pre-filled with `c.pricePerSession`.

### Scope (v1)

Amount only. `serviceType` / `sessionsPerWeek` are intentionally **not** touched
here — service-type changes stay in the existing ✏️ ערוך modal.

### Due date / billed month

The billed month is `renewalInfo(c).renewalDate`, obtained through the shared
helper `nextRenewalDueDate(c)`. The button **must** use this so it can never
diverge from the renewal banner. We do not compute `today() + 1 month`
independently anywhere in this flow.

### Payment id

`paymentId(c, renewalDate, 'base')` => `pay::<clientId>::base::<YYYY-MM>` for the
renewal month. This is the same deterministic, layered scheme used everywhere
else (see `CHANGELOG-extra-charges.md`), so the row upserts in place.

## Submit ordering — client persist FIRST, payment SECOND (deliberate)

On confirm:

1. Snapshot `prev = { pricePerSession: c.pricePerSession }` for rollback.
2. Mutate `c.pricePerSession = entered amount`.
3. `await persist()` — full clear-and-rewrite of clients/leads via `saveAll`.
   - On failure: `Object.assign(c, prev)`, show error, re-render, **abort**
     (do not write the payment).
4. Build the base payment object and call `persistPayment(payment)`
   (action `savePayment`, per-row upsert by id — idempotent, safe to repeat):

   ```js
   { id: paymentId(c, renewalDate, 'base'),
     clientId: c.id, clientName: c.name, billingType: 'monthly',
     dueDate: renewalDate, amountDue: amount, amountPaid: amount,
     status: 'paid', paymentDate: today(), method: '', notes: '',
     bundleSize: '', sessionsUsed: '' }
   ```

   - On failure: show error, but **do NOT roll back** `pricePerSession`. The
     client default change is legitimately saved; the payment can be retried via
     the גבייה tab or by clicking the button again — same deterministic id, no
     duplicate. The user is told the amount was updated but the payment write
     failed and to retry.
5. On full success: `toast('חודש שולם מראש')`, close modal, upsert into
   `state.payments` in memory (by id, so גבייה reflects it without a reload),
   re-render.

### Rationale

Persist-first because a half-applied `_writeAll` of clients/leads is the worse
failure: it can corrupt the whole sheet. The payment row, by contrast, is a
single idempotent per-row upsert keyed on a deterministic id, so leaving it for
retry is cheap and safe — re-clicking just re-writes the same row.

## `paymentDate = today()` — walk-forward is intended

The payment is written with `paymentDate = today()`. Because `renewalInfo`
anchors the next renewal on `paymentDate || startDate` and adds a month, this
advances the renewal banner to roughly `today + 1 month`. This is the accepted
**"paid in advance"** behavior — documented here so the walk-forward is a known,
intended property rather than a surprise.

## New pure helper

`nextRenewalDueDate(client)` extracted into `public/charges-logic.js` (UMD
export). It anchors on `paymentDate` when present, else `startDate`, then adds
one calendar month with short-month clamp (reusing the `addMonth` / `monthKey`
logic). `public/app.js` carries an inline copy of the same helper (the browser
has no build step) and `renewalInfo()` now calls it, so the banner and the
button share a single source of truth. Per the existing sync convention, any
rule change must update **both** copies together.

## Tests

Added to `test/charges.test.js` (`node:test` + `node:assert/strict`, same
pattern as the existing `paymentId` test):

- `nextRenewalDueDate` anchors on `paymentDate` when present, else `startDate`.
- +1 month with short-month clamp (Jan 31 -> Feb 28, leap-year Jan 31 -> Feb 29).
- `paymentId(client.id, nextRenewalDueDate(client), 'base')` produces
  `pay::<id>::base::<YYYY-MM>` for the renewal month.
- Idempotency: same client+month -> identical id.

## Files touched

- `public/app.js` — inline `nextRenewalDueDate`, `renewalInfo` refactor, card
  button, `openRenewModal`/`closeRenewModal`, submit handler.
- `public/charges-logic.js` — pure `nextRenewalDueDate` + `addMonth`, exported.
- `public/index.html` — `#renewModal` static markup.
- `test/charges.test.js` — renewal helper + idempotency tests.

**Code.gs is NOT modified** — the `savePayment` action already exists in
`apps-script/Code.gs`. No Apps Script redeploy is required; Railway alone is
enough.

## Deploy steps

1. Railway auto-deploys the frontend on merge.
2. Apps Script: **not required** for this PR (no `Code.gs` change). For
   reference, the normal Apps Script redeploy is: paste `Code.gs` -> Ctrl+S ->
   Deploy -> Manage deployments -> existing deployment -> pencil -> New version
   -> Deploy.

## Manual test checklist (live URL)

a. Open a patient -> **"חידוש ותשלום"** -> modal shows the correct next month
   and the pre-filled current amount.
b. Change the amount -> confirm -> toast appears, modal closes.
c. Open גבייה, set the date to that renewal month's billing day -> the base row
   shows as paid with the entered amount and today's `paymentDate`.
d. Reopen the patient card -> the renewal banner is recomputed (~next month).
e. Click **"חידוש ותשלום"** again the same day -> no duplicate payment row in
   גבייה (same id upserts).
f. Edit the patient via ✏️ ערוך -> confirm the new monthly amount persisted as
   the default.
