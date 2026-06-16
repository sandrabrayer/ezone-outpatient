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
   deletes permanently.

## Access

- PIN screen on load. `2107` grants full edit access.
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
npm start
# open http://localhost:3000
```

## Deploy to Railway

- The repo contains `Procfile` and `railway.json` (Nixpacks).
- Set the environment variable `SHEETS_URL` on the Railway service.
- The app listens on `process.env.PORT`.
- Deploy as a single service — one URL only.

## API (frontend → backend, relative only)

- `GET /api/sheets` → `{ ok, leads, clients }`
- `POST /api/sheets` with `{ leads, clients }` → saves everything

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
  `getStopFlags` / `resolveStopFlag` are internal (via the Node proxy). See
  `CHANGELOG-stop-flag-receiver.md`. **Requires an Apps Script redeploy.**

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
  yet wired into the save flow, form, or `getTreatmentPlans`. See
  `CHANGELOG-clinical-billing-map.md`.
- `_readAll`/`_writeAll` map sheet columns **by position**, and `_ensureSheet`
  does not migrate data — so a column can never be dropped from the middle of
  `CLIENTS_HEADERS` without shifting everything after it. The removed אחראי
  fields (`responsiblePerson`, `serviceScope`) are therefore **kept as reserved,
  unread slots** rather than deleted. See `CHANGELOG-remove-responsible-person.md`.
