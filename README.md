# E-ZONE Outpatient Dashboard

Hebrew/RTL dark-theme dashboard for managing outpatient therapy clients in Israel.
Node.js + Express backend, vanilla HTML/JS frontend, Google Sheets as the database
through an Apps Script Web App.

## Screens

1. **Dashboard** – active clients, monthly revenue, breakdowns by service type,
   location, and lead pipeline.
2. **Leads CRM** – kanban with 4 forward stages
   (`ליד חדש → שיחת היכרות → הסכם נחתם → מטופל פעיל`) plus a side-exit
   `לא רלוונטי` button per card. Moving to `מטופל פעיל` opens the activation
   modal (service type, location, sessions/week, price/session, start date).
3. **Clients (מטופלים)** – tabbed by service type; status `פעיל / הפסקה זמנית /
   סיים טיפול`. `סיים טיפול` captures exit date and grays out the card. `✕`
   deletes permanently. Each card shows the patient phone (the `phone` column,
   falling back to `treatmentContactPhone`, leading-zero recovered), and the
   edit modal edits it via the **טלפון מטופל** field.

## Access

- PIN screen on load. The PIN is configured server-side via the `APP_PIN`
  env var and verified by `POST /api/verify-pin`; a correct PIN grants full
  edit access.
- "המשך כצופה בלבד" hides all edit controls (read-only).
- Choice is stored in `sessionStorage` for the session only.

## Stack

- Backend: Node.js + Express (serves static frontend and proxies to Apps Script).
- Frontend: plain HTML/JS/CSS. No build step.
- Database: Google Sheets via Apps Script Web App (`doGet` / `doPost`).

## Google Sheet setup

1. Create a new Google Sheet named **E-ZONE Outpatient**.
2. `Extensions → Apps Script`. Replace `Code.gs` with the contents of
   [`apps-script/Code.gs`](apps-script/Code.gs).
3. `Deploy → New deployment → Web app`
   - **Execute as:** Me
   - **Who has access:** Anyone with the link
4. Copy the deployed `/exec` URL. Tabs `Leads` and `Clients` are created
   automatically with correct headers on first call.

### Sheet schema (created automatically)

**Leads**: `id, name, phone, serviceType, location, note, stage,
sessionsPerWeek, pricePerSession, startDate, created`

**Clients**: `id, name, serviceType, location, sessionsPerWeek,
pricePerSession, startDate, status, exitDate, fromLead`

## Local development

```bash
npm install
export SHEETS_URL="https://script.google.com/macros/s/.../exec"
export APP_PIN="your-edit-pin"
npm start
# open http://localhost:3000
```

## Deploy to Railway

- The repo contains `Procfile` and `railway.json` (Nixpacks).
- Set the environment variables `SHEETS_URL` and `APP_PIN` on the Railway
  service. `APP_PIN` is the edit-mode PIN, checked server-side — if unset,
  `/api/verify-pin` rejects every attempt.
- The app listens on `process.env.PORT`.
- Deploy as a single service — one URL only.

## API (frontend → backend, relative only)

- `GET /api/sheets` → `{ ok, leads, clients }`
- `POST /api/sheets` with `{ leads, clients }` → saves everything
- `POST /api/verify-pin` with `{ pin }` → `{ ok: true }` on match, `401` on
  mismatch, `429` after 10 attempts in 15 minutes from the same IP

### Cross-app read endpoints (shared-secret, read-only)

- `GET /api/sheets?action=getWinbackSource&secret=<WINBACK_SECRET>` → lost
  leads + discharged clients for the win-back call list. No billing data.
- `GET /api/sheets?action=getDebtStatus&secret=<DEBT_STATUS_SECRET>` →
  `{ ok, clients:[{ clientId, name, phone, debtStatus, amountOwed }] }` for the
  E-Zone Therapists intake gate. `phone` is the canonical patient phone (the
  `phone` column, falling back to `treatmentContactPhone`, leading-zero
  recovered) — non-blank for any client with a number. Every
  client is returned with a tri-state `debtStatus` (`debt` / `clear` /
  `unknown`) — never-fail-open: a client with no payment rows is `unknown`, not
  silently "clear", so the consumer can flag it for manual resolution. Each
  secret is an optional Apps Script Script Property — if unset, that action is
  open (URL-obscurity). The Node proxy forwards `?secret=` automatically. See
  `CHANGELOG-debt-status-endpoint.md`.
- `GET /api/sheets?action=getTreatmentPlans&secret=<TREATMENT_PLANS_SECRET>` →
  `{ ok, clients:[{ clientId, name, phone, serviceType, sessions, status }] }`
  for the E-Zone Therapists "מטופלי חוץ — תוכנית טיפול" tab. `phone` is the
  canonical patient phone (the `phone` column, falling back to
  `treatmentContactPhone`, leading-zero recovered) — the cross-app join key, so
  it is non-blank for any client with a number; `sessions` is `sessionsPerWeek`. A minimal,
  read-only projection — no `payerName`/`payerPhone`/`paymentLink`/prices/
  bundles. Auth mirrors the above: optional `TREATMENT_PLANS_SECRET` Script
  Property (separate from `DEBT_STATUS_SECRET` so the two rotate
  independently); if unset the action is open. The Node proxy forwards
  `?secret=` automatically. See `CHANGELOG-treatment-plans-endpoint.md`.

### Stop-treatment flags (inbound, fail-closed write)

- `POST /exec { action:'flagStop', secret:<STOP_FLAG_SECRET>, phone, name, reportedBy?, note? }`
  — the E-Zone Therapists app flags a patient who appears to have stopped
  treatment. **Fail-closed:** `STOP_FLAG_SECRET` (Apps Script Script Property)
  must exist and match, else rejected. Posts directly to Apps Script `/exec`
  (no `server.js` change). The phone is normalized to canonical and matched to a
  client by phone + name; one `pending` row is appended to the `StopFlags` tab.
  **Clients is never modified** — flags are surfaced to Vered on the dashboard
  ("⏳ המתנה לאישור הפסקה") and resolved only when she manually discharges.
  `getStopFlags` / `resolveStopFlag(id)` are internal (via the Node proxy). See
  `CHANGELOG-stop-flag-receiver.md`. **Requires an Apps Script redeploy.**
- `POST /exec { action:'resolveStopFlag', secret:<STOP_FLAG_SECRET>, phone }`
  — the E-Zone Therapists app clears a flag it previously raised (patient
  resumed). **Fail-closed**, reusing the **same** `STOP_FLAG_SECRET` as
  `flagStop`. Matches `StopFlags` rows by **canonical phone alone (no `Clients`
  join)** — so it also clears orphaned flags whose `clientId` is blank — and
  marks every still-pending match `resolved`. Returns `{ ok:true, resolved:N }`
  (N=0 = no match, still ok); idempotent on retry. `doPost` routes by the
  presence of a `secret`, so the internal id-based `resolveStopFlag(id)` above is
  unchanged. See `CHANGELOG-resolve-stop-flag-receiver.md`. **Requires an Apps
  Script redeploy.**
- `POST /exec { action:'setClinicalType', secret:<CLINICAL_TYPE_SECRET>, phone, clinicalTreatmentType }`
  — the E-Zone Therapists app sets a patient's clinical treatment type on the
  outpatient client. **Fail-closed:** `CLINICAL_TYPE_SECRET` (Apps Script Script
  Property) must exist and match, else rejected. Posts directly to Apps Script
  `/exec` (no `server.js` change). The phone is normalized to canonical and
  matched to a client by phone. **Never fail-open, never guess:** a single match
  sets `clinicalTreatmentType` and derives + overwrites `serviceType` through the
  same `_clinicalToBilling` map used on save (`{ ok:true, matched:1 }`); no match
  → `{ ok:false, reason:'no_match' }`, multiple → `{ ok:false,
  reason:'multi_match' }`, an unknown clinical type → `{ ok:false,
  reason:'unknown_type' }` — all three **write nothing**. Only the two fields
  change on the matched row; every other cell is preserved. See
  `CHANGELOG-set-clinical-type.md`. **Requires an Apps Script redeploy.**
- `POST /exec { action:'recordSessionOutcome', secret:<SESSION_OUTCOME_SECRET>,
  sessionId, phone, therapist, clinicalTreatmentType, date, outcome }`
  — the E-Zone Therapists app reports a session outcome; the receiver computes the
  **therapist pay** + **client session value** and logs one reconciliation row to
  the `SessionLog` tab, **upserted by `sessionId`** (a corrected outcome re-sent
  with the same id overwrites the row and recomputes pay — never a duplicate,
  never stale pay). **Fail-closed:** `SESSION_OUTCOME_SECRET` (Apps Script Script
  Property) must exist and match. `outcome ∈ happened | therapist_cancelled |
  patient_no_show` (any other rejects). Pay: `happened`/`patient_no_show` →
  therapist showed up, **paid**; `therapist_cancelled` → **0**; `קבוצה` (group)
  → **0** pay and **0** value. `sessionStatus`: `consumed` / `credited` /
  `forfeited`. `ליווי יומי בקהילה` with no frequency in the event stores
  `clientSessionValue` **null** (flagged, never guessed). An unknown clinical type
  or unknown outcome **writes nothing**; the log is keyed by session so it always
  writes regardless of client match (`matchStatus` = matched/no_match/multi_match).
  **Clients is never modified.** Posts directly to Apps Script `/exec` (no
  `server.js` change). This is the **receiver + compute only** — no therapists-side
  sender. See `CHANGELOG-session-outcome.md`. **Requires an Apps Script redeploy.**
- `POST /exec { action:'deactivateClient', secret:<DEACTIVATE_CLIENT_SECRET>, phone }`
  — the E-Zone Therapists app calls this when a patient is **deleted there**, so
  the patient stops appearing in outpatient's roster (the therapists roster unions
  `getTreatmentPlans` / `getDebtStatus` as base sources). **Fail-closed** on a
  **dedicated, new** `DEACTIVATE_CLIENT_SECRET` (its own secret, **not** reused
  from `STOP_FLAG_SECRET` — least authority; provision the **same value** on both
  Apps Scripts). **Deactivate, not hard-delete** (reversible; row + billing/
  session history kept): every Client matching the **canonical phone**
  (`_recoverPhone`, leading-zero recovered, across `phone`/`treatmentContactPhone`/
  `payerPhone`) has its `status` set to **`לא פעיל`**, which both projections now
  exclude — so the patient leaves the roster union. `סיים טיפול` (Vered's manual
  discharge) is **distinct** and stays in `getDebtStatus` (debt survives
  discharge). **Orphan-safe:** no match → `{ ok:true, deactivated:0 }` (never a
  crash; the sender's local delete still proceeds). Returns `{ ok:true,
  deactivated:N }`; idempotent. Posts directly to Apps Script `/exec` (no
  `server.js` / Railway change). Pairs with ezone-therapists PR #24's
  delete-propagation sender. See `CHANGELOG-deactivate-client.md`. **Requires an
  Apps Script redeploy.**

### Debug endpoints

- `GET /api/debug/env` – confirms `SHEETS_URL` is configured (no secret leak).
- `GET /api/debug/routes` – lists mounted routes.
- `GET /api/debug/last-load` – status of the most recent Sheets load.

## Phone numbers

- **Canonical form:** leading-zero, no separators (e.g. `0501234567`).
  Entry is normalized (strip separators; `+972`/`972`/`00972` → leading `0`)
  then validated; invalid numbers are rejected with a Hebrew message and never
  stored. Mobile-strict (exactly 10 digits) applies to `phone` and
  `treatmentContactPhone` (the cross-app matching key); `payerPhone` also
  accepts a 9-digit Israeli landline.
- **WhatsApp:** the 972 international form is produced only at wa.me link-build
  time (`phoneToWa`), so links keep working while storage stays canonical.
- **Sheets leading-zero fix:** phone columns are forced to plain-text (`@`)
  format on write, and already-corrupted rows are recovered on read
  (`_recoverPhone`) so consumers including E-Zone Therapists get healed numbers.
  No bulk migration — rows heal on read and persist canonical on next save.
  See `CHANGELOG-phone-normalization.md`. **Requires an Apps Script redeploy.**

## Notes / lessons baked in

- Frontend only uses **relative** `/api/sheets` URLs — no hardcoded domain.
- Stage values are stored in **Hebrew** in Sheets and translated to English IDs
  on load; saves translate back. See `heToId` / `idToHe` in `public/app.js`.
- Dates coming from Sheets have their `T…Z` suffix stripped before display.
- `public/index.html` cache-busts `app.js` with `?v=<Date.now()>` on every load.
- Submit buttons are disabled on click and re-enabled on failure.
- On load failure, the user sees a toast — **no silent empty fallback**.
- Apps Script `doPost` parses `e.postData.contents` as JSON and `doGet` accepts
  the same payload as a query param fallback.
- `public/treatment-map.js` is the hardcoded **clinical → billing** vocabulary
  map + price table (incl. VAT): `clinicalToBilling()` and `billingPrice()`. Not
  yet wired into the save flow, form, or `getTreatmentPlans`. Prices: individual
  + variants ₪500, מעקב פסיכיאטרי ₪1,100, אינטייק ₪2,300, ליווי יומי בקהילה by
  monthly frequency (3×→₪15,000 / 5×→₪18,000), **קבוצה ₪0 (intentionally free —
  a decided price, not `null`)**, **טיפול משפחתי ₪600**. `PRICE_FLAG_PER_CLIENT`
  (`null`) stays reserved for any still-undecided type (none today). See
  `CHANGELOG-clinical-billing-map.md`.
- `_readAll`/`_writeAll` map sheet columns **by position**, and `_ensureSheet`
  does not migrate data — so a column can never be dropped from the middle of
  `CLIENTS_HEADERS` without shifting everything after it. The removed אחראי
  fields (`responsiblePerson`, `serviceScope`) are therefore **kept as reserved,
  unread slots** rather than deleted. See `CHANGELOG-remove-responsible-person.md`.
- `public/therapist-pay.js` is the hardcoded **therapist pay table** (what
  E-ZONE pays per session): `therapistPay(name, treatmentType?)`. Rates are
  **pre-VAT** — VAT is added at payment time via the separate `withVat()` helper,
  never inside `therapistPay`. See `CHANGELOG-therapist-pay-table.md`.
- `public/therapist-payout.js` is the monthly payout summary:
  `monthlyPayoutSummary(sessionLogRows, 'YYYY-MM')` groups `SessionLog` rows per
  therapist, sums the pay for paying outcomes (`happened` + `patient_no_show`)
  into a pre-VAT total, derives the +VAT total via `withVat`, and reports the
  excluded `therapist_cancelled` count plus a per-session breakdown. It is
  **forwarding-aware**: rows stamped `forwardedToPayroll` are excluded forever,
  and a session logged late for an already-forwarded month surfaces under
  `differences` (**הפרשים**). It feeds the **תשלומי מטפלים** tab (via the open
  `getSessionLog` read action). See `CHANGELOG-therapist-payout-view.md`.
- The **תשלומי מטפלים** tab is a full payout workflow for מורן:
  **(1) Correct** — fix a logged outcome or add a missing session via the
  internal `correctSessionOutcome` action, which runs the **same
  `_recordSessionOutcome` rules engine** (recomputes pay + reverses credit by
  `sessionId`; no raw-amount override). **(2) Excel export** —
  `public/payout-export.js` (`PayoutExport.buildPayoutCsv`) builds a UTF-8-BOM
  CSV (per-therapist totals + a הפרשים section) for חשבת שכר. **(3) Mark-forwarded**
  — `markForwarded` / `_markForwarded` stamps a therapist's month
  (`forwardedToPayroll = 'YYYY-MM'`, the append-only `SessionLog` column) so those
  sessions never reappear; per-therapist independent. See
  `CHANGELOG-payout-correct-export-forward.md`.
- `clinicalTreatmentType` (Clients column, appended LAST) is the **clinical**
  type as recorded by the therapists app. On save, `_saveAll` derives
  `serviceType` from it via an inline mirror of `treatment-map.js`
  (`_clinicalToBilling`); absent/empty leaves `serviceType` as-is, unknown
  throws. Receiver only — no sender/form yet. See
  `CHANGELOG-clinical-treatment-type-receiver.md`.
