# CHANGELOG — Server-side bulk payment cleanup on patient delete

## Summary
Deleting a patient now removes their Payments rows through ONE server-side
bulk action (`removePaymentsForClient`, the exact `removeChargesForClient`
pattern) instead of a client-side per-row loop. The cleanup works off the
sheet — not off whatever the browser happened to load — and failures surface
instead of being silently swallowed.

## Problem (two orphan paths, both part of the 2026-08-26 incident anatomy)
The old `removePaymentsForClient` in public/app.js iterated `state.payments`
and called `removePayment` per row:
- `loadAll` falls back to `payments: []` when `getPayments` fails, so a
  delete in that session removed ZERO payment rows while erasing the client —
  every paid row became an orphan;
- each per-row failure was `console.warn`-swallowed, so a partial cleanup
  still toasted "נמחק" as if complete.
Orphaned payment rows are exactly what kept a deleted patient visible in the
גבייה monthly summary with no card anywhere.

## Changes
- apps-script/Code.gs  (** auto-deploys via clasp CI — touches
  `apps-script/**` **)
  - New `_removePaymentsForClient(clientId)`: LockService-guarded bulk delete
    of every Payments row for the clientId, bottom-up so row indices stay
    valid, each removal logged for an audit trail. Idempotent: no rows →
    `{ ok:true, removed:0 }`. Blank clientId is rejected (`missing_clientId`)
    — never a mass delete. Mirrors `_removeChargesForClient` exactly.
  - `doPost` routes `removePaymentsForClient` (internal dashboard action,
    same trust level as `removeChargesForClient`).
- public/app.js
  - `removePaymentsForClient(clientId)`: filters the local `state.payments`
    optimistically, then posts the single bulk action. No per-row loop, no
    `console.warn` swallow — an error PROPAGATES to the ✕ delete flow's
    existing `.catch`, which toasts it. Returns the server's removed count.
  - The ✕ delete flow itself is unchanged: `persist({explicitRemovedIds})` →
    `removeChargesForClient` → `removePaymentsForClient`.

## Note
The single-row `removePayment` action stays — the גבייה orphan-row "הסר"
button still uses it.

## Verification
- test/remove-payments-for-client.test.js: pure mirror of the bulk removal
  (removes all rows for the client, keeps others, idempotent, blank clientId
  rejected) + source-scan guards (lock / bottom-up / audit log / route; the
  app.js function is one bulk call with no per-row loop and no warn-swallow;
  the ✕ flow still runs the cleanup).
- `npm test`: full suite green.
