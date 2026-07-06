# Stop-alerts: markStopAlertUnread (reopen) action

**Date:** 2026-07-06

Adds a `markStopAlertUnread` action to the outpatient Apps Script — the exact
inverse of `markStopAlertRead`. The E-Zone **Therapists** app (PR #34) already
calls it through its `/api/stop-alerts/unread` proxy, so Yarden can **undo a
mistaken "mark read"** and push an alert back to the `unread` state in the
`עצירת טיפול` tab.

## Backend (`apps-script/Code.gs`)

- **`markStopAlertUnread`** (POST) — single-row update **by id**:
  `status → 'unread'` and **`readAt` cleared**. A mirror of `_markStopAlertRead`:
  - **fail-closed** behind the same **`STOP_ALERTS_SECRET`** gate
    (`_stopAlertsAuthOk`) — a missing/empty/wrong secret rejects every request;
  - **`LockService`** lock, in-place `setValue` per cell, **never** rewrites the
    sheet (`_ensureSheet` + ranged `getValues` + `setValue`, same as the read path);
  - `missing_id` when no id is passed; `not_found` when the id matches no row.
  - Returns `{ ok:true }` / `{ ok:false, error:'missing_id'|'not_found' }`.
- Routed in `doPost` immediately after `markStopAlertRead`, using the same
  `payload.secret → params.secret` bridge and `_stopAlertsAuthOk` check.

`CLIENTS_HEADERS` and every other contract are untouched; no schema change (it
reuses the existing `התראות עצירת טיפול` sheet and its `status`/`readAt` columns).

## Tests (`test/stop-alerts.test.js`, `node --test`)

Mirroring the `markStopAlertRead` coverage:

- **behavior mirror:** `markStopAlertUnread` flips only the matching row back to
  `unread` and clears its `readAt`, leaving other rows untouched; `missing_id`
  and `not_found` handled.
- **source guards:** `_markStopAlertUnread` requires an id, takes a `LockService`
  lock, sets `status` to `'unread'`, clears `readAt` (`setValue('')`), reports
  `not_found`, and does **not** `_writeAll`; and the `doPost` route is gated on
  `_stopAlertsAuthOk` (same shape as the `markStopAlertRead` route guard).

## MANUAL follow-up (MANDATORY — not automated)

1. **Redeploy the outpatient Apps Script** so the new `markStopAlertUnread` action
   goes live: **Deploy → Manage deployments → ✏️ (pencil) on the EXISTING
   deployment → Version: New version → Deploy.** Access must stay **"Anyone"**.
   ⚠️ **Never "New deployment"** — that mints a new `/exec` URL and breaks every
   consumer that shares the single existing deployment.
   Until this redeploy happens the therapists app's "mark unread" call reaches the
   old backend, which has no such action and rejects it.
2. **`STOP_ALERTS_SECRET`** must already be set as a Script Property on the
   outpatient Apps Script (it gates this action too) and match the value the
   therapists service sends — no new secret is introduced.
