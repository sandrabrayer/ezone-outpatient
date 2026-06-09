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
  `{ ok, debtors:[{ clientId, name, phone, amountOwed }] }` for the E-Zone
  Therapists debt-block. `phone` is `treatmentContactPhone`; only clients with
  an open balance are returned. Each secret is an optional Apps Script Script
  Property — if unset, that action is open (URL-obscurity). The Node proxy
  forwards `?secret=` to Apps Script automatically. See
  `CHANGELOG-debt-status-endpoint.md`.

### Debug endpoints

- `GET /api/debug/env` – confirms `SHEETS_URL` is configured (no secret leak).
- `GET /api/debug/routes` – lists mounted routes.
- `GET /api/debug/last-load` – status of the most recent Sheets load.

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
