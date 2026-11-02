# Server-side money scope — דנה is operational (OP-CRM-3A, 2026-10-31)

Phase A of the Outpatient CRM program (issue #141). Draft only; no merge, no Apps Script / Railway deploy.

## Decision implemented
CRM spec §2 / `docs/crm/OUTPATIENT-STAGE0.md` G3: **דנה never receives financial information from the server** — prices, billing arrangement, payment state, collection amounts, debts, balances, revenue, therapist pay, bank details, exports — and cannot change stored money through a manipulated or indirect save. ורד keeps everything (pricing still gated by `CATALOG_ADMIN_USERS`); אורן keeps his current authorized functionality. Billing calculations and collections are unchanged.

## What changed
- **`lib/money-scope.js`** (new, pure): `OPS_USERS = ['דנה']`; `scopeOf(name)` → `'full' | 'ops'`, decided only from the session name the proxy reads out of the signed cookie and **failing closed** (blank / unknown / retired → `ops`); `MONEY_GET_ACTIONS` / `MONEY_POST_ACTIONS`; `MONEY_KEYS` + deep `stripMoney()`; `MONEY_STATIC = ['therapist-pay.js']`.
- **`server.js`**
  - `GET /api/sheets`: money actions → `403 forbidden_money_action` **before any upstream call**; every other answer to an ops session is projected through `stripMoney` — fresh (`MISS`), cached (`HIT`) and stale (`STALE`) alike. The cache is shared across users, so the projection happens at response time and never mutates the cached object.
  - `POST /api/sheets`: money actions → 403; `moneyScope` in a browser body → `400 forbidden_field`; the server stamps `body.moneyScope` (`full`/`ops`) on every forwarded write; responses are projected too.
  - `/therapist-pay.js` (pay-rate constants) → 403 for ops; `treatment-map.js` (no amounts) stays.
  - `/api/me` adds `moneyScope` (informational for the UI).
  - Unnamed / invalid / retired sessions were already refused on data routes (401) — unchanged.
- **`apps-script/Code.gs`**: `_saveAll` receives `moneyScope`; for `'ops'`, `OPS_CLIENT_MONEY_KEYS` / `OPS_LEAD_MONEY_KEYS` are carried from the on-sheet row (existing) or left blank (new) **before** the diff/stale logic, so a stripped field never reads as an edit and a tampered value never lands. Absent scope (legacy callers) → unchanged behaviour.
- **`public/app.js` / `style.css`**: `state.moneyScope` is read from `/api/me` before the app opens (UI-only — the server strips/refuses regardless); `applyMoneyScopeUI()` hides גבייה / הכנסות / תשלומי מטפלים / תמחור tabs and ⚙️ for ops, disables + hides money inputs in every form (disabled inputs are not serialized), hides money sections; `renewalInfo()` returns `unknown` for ops (no false «לא שולם» from stripped data) and no paid/unpaid chip is rendered; the refused `therapist-pay.js` is tolerated for ops so boot never fails.

## Security notes
- Authorization derives from the signed cookie only; the browser's `moneyScope` is advisory and a browser-supplied value is refused.
- Fail closed: a name not on `SESSION_USERS` (or retired) is `ops`.
- No new secrets, routes with credentials, or logging of values.

## Tests
- `test/money-scope.test.js` (9): pure scope/strip; routes — ורד/אורן get money, דנה never (MISS/HIT/STALE), money actions 403 with zero upstream calls, operational writes stay open, server-stamped scope, tampered `moneyScope` refused, pay constants 403/200, `/api/me`, invalid/unnamed sessions; Code.gs ops/full/legacy saves; source guard (lists mirror, UI hooks).
- `test/money-scope-browser.test.js` (2, real Chromium, added to the `lead-save-browser` CI job): דנה — boots, tabs hidden, no money in DOM, no money read succeeds, operational edit keeps the stored price; ורד — everything visible.
- Pins updated: `/api/me` shape (`session-who-when`, `name-picker-conflicts`), revenue e2e stub, saveAll dispatch guard.
