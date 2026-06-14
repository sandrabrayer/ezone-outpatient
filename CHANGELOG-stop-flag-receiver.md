# Stop-treatment flag receiver (outpatient side)

**Date:** 2026-06-14

Lets the **E-Zone Therapists** app flag that a patient appears to have stopped
treatment. Flags are surfaced to Vered on the dashboard for **manual
confirmation** — the receiver **never auto-changes patient status**. Vered
remains the sole authority on actual discharge.

## Data — new `StopFlags` tab

Created via the `_ensureSheet` append-only pattern. Columns:

`id, phone, name, clientId, reportedBy, reportedAt, note, status, resolvedBy, resolvedAt`

- `status` is `pending` or `resolved`.
- `phone` is in `PHONE_COLUMNS`, so the column inherits the `@` plain-text format
  and leading-zero read recovery automatically.
- **`Clients` is never modified by this feature.**

## Apps Script (`apps-script/Code.gs`)

- **`flagStop`** (`doPost`) — inbound from the therapists app.
  - **FAIL-CLOSED auth:** the `STOP_FLAG_SECRET` Script Property **must exist and
    match** the request's `secret`. Unlike the read endpoints (open when unset),
    a missing/empty/wrong secret is **rejected** — this is an external write.
  - Validates input (`name` required; phone must normalize to `/^0\d{8,9}$/`),
    normalizes the incoming phone to canonical leading-zero via `_recoverPhone`,
    matches an existing client by **normalized phone (vs `phone` OR
    `treatmentContactPhone`) + exact trimmed name** to fill `clientId`, and
    appends ONE row with `status='pending'`.
- **`getStopFlags`** (`doGet`/`doPost`) — returns all flag rows. Internal/open,
  same trust level as `getData`/`getPayments`.
- **`resolveStopFlag`** (`doPost`) — in-place sets `status='resolved'` +
  `resolvedBy` + `resolvedAt` for one flag id (LockService). Internal/open. Marks
  a flag resolved; it does **not** discharge.

## Frontend (`public/app.js`, `public/index.html`)

- `state.stopFlags`, `apiGetStopFlags`, `normalizeStopFlagFromSheet`; loaded in
  `loadAll` (best-effort, empty on failure).
- Dashboard panel **"⏳ המתנה לאישור הפסקה"** lists pending flags. A flag matched
  to a client shows the client name + phone + a **"סיים טיפול"** button that
  opens the existing exit/discharge modal (`openExitModal`). An unmatched flag
  shows the reported name/phone with **"לא נמצא מטופל תואם"** and no button.
- **Resolve on discharge:** when Vered completes the exit modal for a client
  (from the panel button OR the normal clients-tab discharge), after the
  discharge persists, every pending flag for that `clientId` is marked resolved
  via `resolveStopFlag` (`resolvedBy='Vered'`). Best-effort — a resolve failure
  is logged and never blocks the discharge that already succeeded.

## Auth — where to set the secret

In the Apps Script editor: **⚙ Project Settings → Script Properties → Add script
property** → name **`STOP_FLAG_SECRET`**, value = the shared secret you give the
therapists app. Until it is set, `flagStop` rejects every request (fail-closed).

## Deployment

- **No `server.js` change** — the therapists app POSTs `flagStop` directly to the
  Apps Script `/exec` URL. The outpatient frontend's `getStopFlags` /
  `resolveStopFlag` go through the existing Node `/api/sheets` proxy.
- ⚠️ **Apps Script redeploy required:** Deploy → Manage deployments → ✏️ →
  Version: New version → Deploy.

## Tests

`test/stop-flags.test.js` — fail-closed auth (unset/empty/wrong rejected, exact
accepted), valid append as `pending`, phone-normalized matching (972 / dashes /
`treatmentContactPhone` / 9-digit landline), invalid-phone & missing-name
rejection, resolve transform.

## Inbound contract (for the therapists app)

```
POST <APPS_SCRIPT_EXEC_URL>
Content-Type: application/json

{ "action": "flagStop", "secret": "<STOP_FLAG_SECRET>",
  "phone": "0501234567", "name": "אורי",
  "reportedBy": "therapists-app", "note": "הפסיק להגיע" }

→ { "ok": true, "flag": { ... "status": "pending", "clientId": "c1" | "" } }
→ { "ok": false, "error": "unauthorized" | "invalid_phone" | "missing_name" }
```
