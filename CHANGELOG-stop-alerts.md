# Stop-treatment alerts (outpatient → therapists)

**Date:** 2026-07-05

The outpatient app's **"הודעת עצירת טיפול"** button (on the overdue-renewals
panel) now **CREATES a persistent stop-treatment alert** for **Yarden** instead
of opening a WhatsApp link. The E-Zone **Therapists** app (separate session)
reads these alerts in a new **"עצירת טיפול"** tab and marks each one **read**
after acting. Alerts **persist** at status `unread` until explicitly marked read
there — this backend never auto-resolves them.

`Clients` is never touched — the feature only writes to its own sheet.

## Schema — new sheet `התראות עצירת טיפול`

Auto-created via the existing `_ensureSheet` pattern. Exact header order:

```
['id', 'clientId', 'clientName', 'createdAt', 'createdBy', 'status', 'readAt', 'note']
```

| Column | Value |
|---|---|
| `id` | `stop-<uuid>` (`'stop-' + Utilities.getUuid()`) |
| `clientId` | the outpatient client id (required) |
| `clientName` | client display name (required) |
| `createdAt` | ISO timestamp (`new Date().toISOString()`) |
| `createdBy` | who raised it (`'Vered'`), may be empty |
| `status` | `'unread'` on create → `'read'` when marked |
| `readAt` | ISO timestamp, empty until marked read |
| `note` | free text, optional, capped at 1000 chars |

## Actions (`apps-script/Code.gs`)

- **`createStopAlert`** (POST, **INTERNAL** — same trust level as `saveAll`; the
  outpatient app posts it same-origin through the Node proxy, **no cross-app
  secret**). Validates `clientId` + `clientName`, then under a `LockService`
  lock `_ensureSheet(...)` + `appendRow(...)` one `unread` row with a
  `stop-<uuid>` id and ISO `createdAt`. Returns `{ ok:true, alert }`.
- **`getStopAlerts`** (GET) — returns `{ ok:true, stopAlerts:[…] }`. **Secured.**
- **`markStopAlertRead`** (POST) — single-row update **by id**: `status → 'read'`
  + `readAt = now`. `LockService` lock, in-place `setValue` (never rewrites the
  sheet). Returns `{ ok:true }` / `{ ok:false, error:'not_found' }`. **Secured.**

### Auth — new shared secret `STOP_ALERTS_SECRET`

`getStopAlerts` and `markStopAlertRead` (the cross-app endpoints the therapists
app calls) are **fail-closed** behind `STOP_ALERTS_SECRET`, mirroring the
`SESSION_OUTCOME_SECRET` pattern exactly:

- read **only** from a Script Property named **`STOP_ALERTS_SECRET`**
  (`PropertiesService.getScriptProperties().getProperty('STOP_ALERTS_SECRET')`);
- if the property is **unset**, **every** request is **rejected** (never open);
  an empty/wrong secret is rejected too;
- never hardcoded, never logged.

`createStopAlert` carries **no** secret — it is an internal write, exactly like
`saveAll`.

## Frontend (`public/app.js`)

- The overdue-panel button `data-action` changed `wa-stop` → **`stop-alert`**;
  the delegated handler routes it to the new **`sendStopAlert(c)`**.
- `sendStopAlert`: confirm modal → optional note (`prompt`) → `createStopAlert`
  with `clientId` / `clientName` (+ `createdBy:'Vered'`, `note`). On success a
  toast **"נשלחה התראת עצירה לירדן"**; **optimistic** (the alert is pushed to
  `state.stopAlerts`) with **rollback** (spliced out) if the write fails.
- **Trivial-duplicate guard:** if an `unread` alert for this `clientId` already
  exists in `state.stopAlerts`, the confirm says one is already pending and asks
  whether to send another. `state.stopAlerts` is tracked **in-session** (seeded
  empty at boot and appended on each create) — the outpatient service does **not**
  hold `STOP_ALERTS_SECRET`, so it cannot read `getStopAlerts`; the guard catches
  the common repeat-send case within a session.
- The old WhatsApp flow's **`treatmentContactPhone` read is removed** from this
  path. The `treatmentContactPhone` **column stays** (still round-tripped and used
  for cross-app matching elsewhere), and `buildStopTreatmentMsg` remains defined.

## Tests (`test/stop-alerts.test.js`, `node --test`)

Mirrors the un-importable Apps Script logic (approach of `test/create-lead.test.js`)
plus source-guards on `Code.gs` and a wiring guard on `public/app.js`:

- create appends one `unread` row with a `stop-<id>` and ISO `createdAt`; requires
  `clientId` + `clientName`; note optional, capped at 1000;
- `markStopAlertRead` flips only the matching row to `read` + stamps `readAt`;
  `missing_id` / `not_found` handled;
- `getStopAlerts` / `markStopAlertRead` auth is **fail-closed** (unset property
  rejects every request);
- **source guards:** `STOP_ALERTS_HEADERS` exact order; `createStopAlert` routed
  with **no** secret + `LockService` + `stop-<uuid>` + `status:'unread'` +
  `appendRow`; `_stopAlertsAuthOk` fail-closed reading `STOP_ALERTS_SECRET`; **both**
  read + mark routes gate on `_stopAlertsAuthOk`; `markStopAlertRead` takes a lock
  and updates a single row in place;
- **wiring guard:** button dispatches `stop-alert`; `sendStopAlert` calls
  `createStopAlert`, confirms, is optimistic + rollback, checks for a pending
  alert, and reads **no** `treatmentContactPhone` / opens **no** WhatsApp link.

## MANUAL follow-ups (not automated)

1. **Redeploy the outpatient Apps Script** so the new actions go live:
   **Deploy → Manage deployments → ✏️ (pencil) on the EXISTING deployment →
   Version: New version → Deploy.** Access must stay **"Anyone"**.
   ⚠️ **Never "New deployment"** — that mints a new `/exec` URL and breaks every
   consumer that shares the single existing deployment.
2. **Set `STOP_ALERTS_SECRET`** as a Script Property on the **outpatient** Apps
   Script (⚙ Project Settings → Script Properties → Add). Until it is set,
   `getStopAlerts` / `markStopAlertRead` reject every request (fail-closed).
3. **Set the same value as a Railway variable on the therapists service** so the
   therapists app can send it with its `getStopAlerts` / `markStopAlertRead`
   calls. (Railway variable changes apply only to deployments started after
   saving.)
4. Therapists-app side (separate session): the new **"עצירת טיפול"** tab that
   reads `getStopAlerts` and calls `markStopAlertRead`.

## Commits

- _pending_ — add `createStopAlert` / `getStopAlerts` / `markStopAlertRead`
  (+ `_stopAlertsAuthOk`, `STOP_ALERTS_HEADERS`, `doGet`/`doPost` routes), the
  `sendStopAlert` frontend flow, `test/stop-alerts.test.js`, this changelog.
