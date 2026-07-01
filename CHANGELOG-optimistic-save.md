# CHANGELOG — Optimistic patient save (no felt wait)

## Summary
Patient saves now update the UI and close the modal **immediately**, persisting
in the background, so Vered no longer waits ~5s on the network. On failure the
change is rolled back to its pre-save snapshot and an error toast is shown.

## Problem
Every save calls `persist()` (a full `saveAll` rewrite of the Leads + Clients
sheets — see the slow-save investigation). The edit/activate/direct-create
handlers kept the modal open with the submit button disabled until that ~5s
round-trip resolved, so the latency was felt on every edit.

## Change (frontend-only — reorders UI vs. network; payload/server unchanged)
The blocking `persist().then(close + render)` was reordered to the optimistic
pattern already used by `setCurrentMonthPaid`: apply the change to in-memory
`state`, `render()` + close the modal / navigate **before** awaiting, then
`persist()` in the background with rollback on failure.

- **Edit patient** (`editClientForm` submit) — priority. Applies the mutated
  client, closes the modal, renders; persists in the background. The base-payment
  propagation (`propagatePaid`) is now applied to `state.payments` optimistically
  too, with its own rollback snapshot. On failure: restores the client from the
  existing `prev` snapshot **and** the payment row, re-renders, error toast.
- **Direct-create** (`directClientForm` submit) — pushes the client, closes,
  renders; on failure removes the just-added client + error toast (rollback
  already existed; only the ordering changed).
- **Activate lead** (`activateForm` submit) — pushes the client + mutates the
  lead, closes the modal, switches to the clients view; on failure removes the
  client and restores the lead. **A lead snapshot (`leadPrev`) was added** — this
  path previously had *no* rollback, so an optimistic failure needed one to avoid
  leaving state diverged from the Sheet.
- **Status change** (active ⇄ הפסקה זמנית on the card) — applies + renders now;
  **a `prevStatus` snapshot was added** for reliable rollback (this path also had
  none), re-syncing on failure.

Success toasts now fire on confirmation (after the background persist resolves),
matching `setCurrentMonthPaid`; failure toasts read "שמירה נכשלה: …".

## What did NOT change
- `persist()` still sends the full leads+clients dataset (`saveAll`). No payload
  or server change; no Apps Script redeploy. This only removes the *felt* wait —
  the actual write speed is unchanged (that's the separate C / server-upsert work).

## Reliability / security
- No new data exposure — same payload, same endpoint.
- Every optimistic path has a reliable rollback snapshot (existing `prev` for
  edit; `id`-filter for direct-create; **newly added** `leadPrev` for activate and
  `prevStatus` for status change), so a failed save reverts in-memory state and
  surfaces a toast rather than silently diverging from the Sheet. The next
  `getData` load remains the source of truth.
- Recently-added rollback fields (`sessionsUnit`, `location`) in the edit `prev`
  snapshot are preserved.

## Tests
No unit test added: the optimistic reorder lives entirely inside DOM submit/
change handlers in the `public/app.js` IIFE (not exported; no jsdom harness in the
repo). The pure logic it leans on is unchanged. Full suite: 156/158 (the 2
failures are the pre-existing `server.js` forwarding tests, unrelated).

## Deploy
Frontend only. Railway auto-deploys. No Apps Script redeploy.

## Verify (manual, after deploy)
- Edit a patient → modal closes instantly, card shows the change; "נשמר" toast
  appears a moment later once the background save confirms.
- Simulate a failure (offline) → the change reverts and a "שמירה נכשלה" toast
  shows.
