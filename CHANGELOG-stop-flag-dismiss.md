# Dismiss button for stop-flags on Vered's dashboard

**Date:** 2026-06-20

Adds a **"מחק" (dismiss/remove)** control to every row of the **"⏳ המתנה לאישור
הפסקה"** stop-flags panel on the outpatient dashboard, so Vered can clear a flag
**without discharging** — in particular an **orphaned** flag that shows
**"לא נמצא מטופל תואם"** (no matching client, e.g. a made-up test phone like
`0782374928` reported by the therapists app).

Before this, an orphaned flag had **no action at all** — it sat in the panel
forever with only the "no matching client" chip. The matched rows could be
cleared via discharge ("סיים טיפול"), but a false or test flag had no exit.

## Frontend (`public/app.js`)

- **`renderStopFlags`** — every flag row now renders a **`מחק`** button
  (`btn btn-danger edit-only`, `data-action="dismiss-flag"`) in `.renewal-actions`,
  alongside whatever primary action the row already had (`סיים טיפול` / the
  ambiguous picker / the "no match" chip). For an orphaned row it is the **only**
  action. Editor-only (hidden for viewers via the existing `edit-only` class).
- **`handleStopFlagClick`** — the delegated panel handler now routes a
  `dismiss-flag` click to `dismissStopFlag(id)` before the existing
  open-exit / pick-client handling.
- **`dismissStopFlag(flagId)`** (new):
  - editor-gated; **confirms** first
    (*"להסיר את בקשת ההפסקה … מהרשימה? הפעולה אינה מסמנת סיום טיפול …"*) so a
    flag is never removed by accident;
  - **optimistically** marks the flag `status='resolved'` (+ `resolvedBy='Vered'`,
    `resolvedAt`) and re-renders, so the row **disappears immediately** (the panel
    filters `status==='pending'`);
  - persists via the **existing internal** `resolveStopFlag` action **by id**
    (`{ action:'resolveStopFlag', id, resolvedBy:'Vered' }`) — the same action the
    post-discharge cleanup already uses;
  - **rolls back** (restores the previous status, re-renders, toasts the error) if
    the write fails, so the row reappears.

### Why resolve by id (not the new phone endpoint)

The id-based `resolveStopFlag(id)` resolves a row by its **id**, which an orphaned
flag still has (only its `clientId` is blank). So it clears orphans correctly
**and is already deployed** — the dashboard button needs no Apps Script change.
The secured **phone**-based receiver added in PR #37
(`CHANGELOG-resolve-stop-flag-receiver.md`) is the **cross-app** path for the
*therapists* app (which knows the phone, not our row id); it is not needed here.
Dismiss never touches `Clients` and never discharges.

## Tests

`test/stop-flag-dismiss.test.js` — mirrors the dismiss state transition (pure)
plus a **source-scan wiring guard** over `public/app.js`. Locks: a matched flag
dismisses and leaves the pending list; an **orphaned flag (no `clientId`)
dismisses the same way**; dismissing all empties the panel; unknown id is a
no-op; a failed write **rolls back** to pending; and the panel renders the
`dismiss-flag` button and resolves **by id** via `resolveStopFlag` from an
editor-gated, confirm-guarded handler.

## Deployment

**Frontend-only.** Railway auto-deploys `public/app.js` on merge. **No Apps
Script redeploy required** — the button reuses the existing, already-deployed
`resolveStopFlag(id)` action; `Code.gs` is not modified by this change.
