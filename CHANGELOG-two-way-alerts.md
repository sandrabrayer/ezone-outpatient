# Two-way treatment alerts (stop + resume) with Vered-side undo

**Date:** 2026-07-07

Extends the stop-treatment alert flow into a **two-way** signal. Vered can now
**resume** a patient she previously flagged for a stop — either silently undoing
an alert Yarden hasn't seen yet, or (if Yarden already read it) sending Yarden a
matching **resume** alert. The overdue row shows the live sent-state across
sessions, not just optimistically.

## Schema — `התראות עצירת טיפול`

`STOP_ALERTS_HEADERS` gains two APPEND-ONLY columns (order preserved; a legacy
row shorter than the header pads to `''`):

```
… , 'reason', 'type', 'cancelledAt'
```

- **`type`** — stable key `'stop' | 'resume'`. A legacy empty cell is treated as
  `'stop'` everywhere it is read.
- **`cancelledAt`** — ISO timestamp stamped when a stop is cancelled; else `''`.

`CLIENTS_HEADERS` is untouched.

## Backend (`apps-script/Code.gs`)

- **`createStopAlert`** now writes `type: 'stop'` (and `cancelledAt: ''`) explicitly.
- **`resumeTreatmentAlert`** (POST, **INTERNAL** — same trust level as
  `createStopAlert`; posted same-origin through the Node proxy, **no**
  `STOP_ALERTS_SECRET`). Input `clientId` + `clientName`. Under one `LockService`
  lock, atomically:
  1. every **UNREAD** `'stop'` row for the client → `status: 'cancelled'` +
     `cancelledAt: now` (Yarden never saw it, so it just vanishes);
  2. if any `'stop'` row for the client was already **READ**, append a NEW row
     `type: 'resume'`, `status: 'unread'`, `reason: ''` (Yarden gets a resume
     alert **only** because she saw the stop).
  Returns `{ ok:true, cancelled:<n>, resumeCreated:<bool> }`. `missing_client_id`
  / `missing_client_name` fail-closed. Single-row `setValue`s + one `appendRow`;
  never rewrites the sheet.
- **`getMyStopAlerts`** (GET/POST, **INTERNAL**, no secret) — a lean read of the
  app's OWN sent-state: **`id` / `clientId` / `status` / `type` ONLY** (never
  names/notes/reasons). Legacy empty `type` reads as `'stop'`.
- `getStopAlerts` is unchanged and still returns **all** fields (incl. `type` /
  `cancelledAt`) behind `STOP_ALERTS_SECRET` — the therapists app keeps using it.

## Frontend (`public/app.js`, `public/index.html`, `public/style.css`)

- `state.myStopAlerts` (minimal `id/clientId/status/type` rows) is fetched in
  `loadAll` via `getMyStopAlerts`, so the sent-state survives a page reload.
- The **latest** alert row per client (append order = chronological) drives the
  overdue-row control:
  | latest row | control |
  |---|---|
  | `stop`, unread/read | chip **נשלחה התראת עצירה** + **חידוש טיפול** button (editor) |
  | `stop`, cancelled | chip **ההתראה בוטלה** + the stop-send button |
  | `resume`, unread/read | chip **נשלח חידוש** + the stop-send button |
  | none | the stop-send button |
- **חידוש טיפול** opens a confirm modal explaining the branch (cancels the alert
  if Yarden hasn't read it; otherwise sends a resume), then posts
  `resumeTreatmentAlert`. The change is **optimistic** (mirrors the backend on the
  local minimal rows) with a **snapshot rollback** on failure; the success toast
  reflects the response (`נשלח חידוש` vs `התראת העצירה בוטלה`). Either way the
  stop-send button returns, so a future stop can be raised again.

## Therapists-side contract (follow-up — NOT changed here)

`getStopAlerts` now returns rows with `status: 'cancelled'` and a new
`type: 'resume'`. The therapists app (`ezone-therapists`, separate repo/session)
already filters its unread list by status, so **cancelled** stop alerts drop out
of Yarden's list automatically. **Follow-up required there (run separately):**
hide/label `cancelled` rows explicitly and render `type: 'resume'` alerts in the
`עצירת טיפול` tab. This repo does not modify the therapists app.

## Tests

- `test/two-way-alerts.test.js` — backend mirror (create writes `stop`;
  `resumeTreatmentAlert` cancels-unread / resumes-only-if-read / mixed / scoped /
  fail-closed; `getMyStopAlerts` minimal fields + legacy `''`→`stop`), Code.gs
  source guards (headers order, internal/locked/fail-closed resume, unsecured
  routes, minimal read), frontend wiring guards, and a Playwright e2e (skips
  gracefully with no browser) covering send→chip, resume-unread→cancelled, and
  resume-read→נשלח חידוש.
- `test/stop-alerts.test.js` — headers/mirror updated (`type` then `cancelledAt`
  last; `createStopAlert` writes `type`), legacy-row tolerance for the two new
  columns, and the wiring guards updated to the chip/`stopAlertStanding` model.
- The superseded `test/stop-alert-send-fixes.test.js` (which asserted the old
  "button disables to נשלחה התראה ✓" behavior) was removed — that UI is replaced
  by the chip + resume control; the still-relevant send/clientName evidence lives
  in `two-way-alerts.test.js`.
- `npm test`: only the pre-existing env-dependent `Cannot find module 'express'`
  proxy tests fail (dependencies not installed here).

## MANUAL follow-up (MANDATORY — not automated)

1. **Redeploy the outpatient Apps Script** so the `type` / `cancelledAt` columns,
   `resumeTreatmentAlert`, and `getMyStopAlerts` go live:
   **Deploy → Manage deployments → ✏️ (pencil) on the EXISTING deployment →
   Version: New version → Deploy.** Access must stay **"Anyone"**.
   ⚠️ **Never "New deployment"** — that mints a new `/exec` URL and breaks every
   consumer that shares the single existing deployment.
   Until this redeploy happens, the frontend's `getMyStopAlerts` /
   `resumeTreatmentAlert` calls reach the old backend, which has neither action.
2. No new Script Property is introduced — the two new actions are internal, like
   `createStopAlert`. `STOP_ALERTS_SECRET` still gates only `getStopAlerts` /
   `markStopAlertRead` / `markStopAlertUnread`.
3. Therapists app: hide/label `cancelled` alerts and render `type: 'resume'`
   rows (separate session).
