# Continuation track (מסלול המשך)

A new tab for Yarden that works over the roster of currently-admitted DASHBOARD
patients as potential outpatient leads: record a meeting date + outcome per
patient, and hand a patient off to the לידים pipeline when they move to
outpatient care.

## Feature

New tab **מסלול המשך** (after תשלומי מטפלים). It shows every currently-admitted
patient the E-Zone Dashboard reports, grouped by house, and lets an editor
record — per patient — a meeting date (`תאריך לפגישה`), an outcome
(`תוצאת פגישה`), and an optional short note. Each patient carries a tenure badge
(whole months since admission) with a green emphasis tier for 1 / 2 / 3+ months.

Outcome behaviors:

- **ממשיך באשפוז** (`continuing`) — the row stays active for a future re-meeting;
  an outcome chip is shown.
- **מפסיק טיפול** (`stopping`) — the row moves to a collapsed, dimmed
  "הפסיקו טיפול" group at the bottom of its house section.
- **מועבר לטיפול חוץ** (`to_outpatient`) — a confirm modal appears; on confirm a
  new **lead is created through the exact manual add-lead code path** (so the
  duplicate-phone soft warning and the clear-and-rewrite `_writeAll` semantics
  apply), then the outcome is saved. The row shows a "מועבר לטיפול חוץ" chip and
  moves to a collapsed "הועברו ללידים" group; the lead appears in the לידים tab
  (Vered) immediately.

Editors see the inputs/buttons (existing PIN convention: `state.role === 'editor'`
+ `.edit-only` / `body.viewer`); viewers get a read-only summary. A name search
box filters the roster.

## Data flow

- **Roster (read-only, live):** the browser calls the outpatient server's
  `GET /api/continuation-roster`, which proxies the DASHBOARD Apps Script action
  `getAdmittedRoster` server-side (so the dashboard URL + secret never reach the
  browser). Response shape: `{ ok, patients:[{ sourceApp, name, phone, house,
  entryDate }] }`. A short (≤60s) in-memory cache keeps the tab snappy; `?fresh=1`
  forces a live fetch.
- **Workflow state (persisted):** meeting date / outcome / note live in the
  OUTPATIENT spreadsheet in a NEW sheet, reached through the existing
  `/api/sheets` path (`getContinuation` read, `saveContinuation` single-row
  upsert) — NOT through the roster route. `CLIENTS_HEADERS` is never touched.
- **Join key:** roster rows and workflow rows are joined by
  `key = name + '|' + house + '|' + entryDate`. Missing `entryDate` → tenure
  badge `—`, sorted last.

## Key scheme & stable outcome keys

`key` is built by `ContinuationLogic.buildKey(name, house, entryDate)` (each part
trimmed). The `outcome` column stores a **stable English key**; the Hebrew labels
are render-time only:

| stored key      | Hebrew label      |
|-----------------|-------------------|
| `''`            | `—` (undecided)   |
| `continuing`    | ממשיך באשפוז       |
| `to_outpatient` | מועבר לטיפול חוץ   |
| `stopping`      | מפסיק טיפול        |

## New env vars (outpatient server)

Already set in Railway; empty-string defaults, **fail closed** — the roster
carries PII (names + phones) and the dashboard endpoint requires the secret, so
`/api/continuation-roster` returns a clear `500` unless BOTH are configured:

- `DASHBOARD_SHEETS_URL` — the dashboard Apps Script `/exec` URL.
- `OCCUPANCY_SECRET` — shared secret forwarded as `?secret=` to the dashboard.

Startup logs the two config booleans (`DASHBOARD_SHEETS_URL configured: …`,
`OCCUPANCY_SECRET configured: …`); the secret value is never logged.

## New sheet (outpatient spreadsheet)

`CONTINUATION_SHEET = 'מסלול המשך'`, auto-created on first read via the existing
`_ensureSheet` pattern. Headers (exact order):

```
key | name | house | entryDate | meetingDate | outcome | outcomeDate | note | updatedAt
```

`saveContinuation` is a single-row UPSERT by `key`, wrapped in
`LockService.tryLock(30000)` like the other writes. It validates fail-closed
BEFORE touching the sheet: a missing `key`, an out-of-whitelist `outcome`, or a
malformed date (`meetingDate` / `outcomeDate` must be `''` or `YYYY-MM-DD`)
writes nothing; strings are trimmed; `updatedAt` is server-stamped. Both
`getContinuation` and `saveContinuation` are **unauthenticated**, matching the
posture of the app's own internal actions (`getData` / `saveAll` / `savePayment`)
behind the Railway server — not the secured cross-app receivers.

## New files

- `public/continuation-logic.js` — UMD pure-logic module (same pattern as
  `billing-status.js`): `buildKey`, `monthsSince`, `bucketOf`, `isValidOutcome`,
  `VALID_OUTCOMES`. Loaded with `?v=__BUILD__`; the browser uses it and the
  Node tests import it.
- `test/continuation-logic.test.js`, `test/continuation-code.test.js`,
  `test/continuation-roster-forwarding.test.js` — unit + source-guard tests.

## Deployment (manual — required)

- **Code.gs changed → the outpatient Apps Script must be redeployed by hand.**
  Paste `apps-script/Code.gs` into the existing project → Save → Deploy → manage
  the EXISTING deployment → pencil → **New version** → access **Anyone** → Deploy.
  The `/exec` URL stays the same. (Apps Script never auto-syncs from GitHub.)
- The dashboard-side `entryDate` addition to `getAdmittedRoster` ships
  **separately** in the E-Zone-Dashboard repo. Until it is live the roster has no
  `entryDate`, so tenure badges render `—` and those patients sort last — no
  error, and everything else works.
