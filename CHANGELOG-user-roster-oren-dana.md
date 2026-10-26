# User roster: שירן → אורן, יעל → דנה, with personal PINs (2026-10-26)

## What changed

- **Roster** (`lib/users.js`): `SESSION_USERS` is now `['ורד', 'אורן', 'דנה']`. שירן and יעל left; they are in
  `RETIRED_SESSION_USERS` next to ירדן, so they are not offered at sign-in, `/api/verify-pin` refuses them (403), and any
  still-valid 7-day cookie that carries their name is refused by every session-gated route (401). Historical
  `updatedBy` / `assignedTo` text in the sheets is never rewritten.
- **Personal PINs** (`lib/users.js` `resolveUserPins`, `server.js`): ורד keeps the shared `APP_PIN` (unchanged).
  אורן and דנה each sign in with their own PIN, read from Railway variables `USER_PIN_OREN` / `USER_PIN_DANA`.
  - A name's PIN is the only code that signs in as that name: `APP_PIN` does **not** sign in as אורן or דנה, and one
    person's PIN does not sign in as another.
  - Fail-closed: a variable that is unset, not 4–6 digits (the PIN field has `maxlength=6`), equal to `APP_PIN`, or equal to
    the other personal PIN leaves that name unable to sign in. Only the variable **name** is logged, never a value.
  - Comparison stays constant-time (`lib/pin.js checkPin`); the per-IP rate limit (10 / 15 min) is unchanged.
  - The name-less PIN stage (`{pin}` only) accepts any configured PIN and reaches nothing but the name picker; the
    named login is always checked against the chosen name's own PIN.
- **משוייך ל dropdown** (`public/index.html`): שירן / יעל → אורן / דנה (pinned equal to `SESSION_USERS` by test). Editing an
  old lead assigned to a departed person keeps that name as a one-off option instead of blanking it (`public/app.js`, text-only).
- **SW cache** v19 → v20 (`public/sw.js`), because `index.html` and `app.js` changed.
- `apps-script/**` is **not** touched: no Apps Script release is needed.

## Not changed

- ורד's PIN, `CATALOG_ADMIN_USERS` (only ורד opens pricing), roles (none), session format, cookies, `therapist-pay` rates
  (שירן there is a therapist name, unrelated to the login roster).

## Security notes / residual risk

- No PIN value appears in code, tests, docs, logs or git. Tests use throwaway fixture values.
- **Residual:** שירן and יעל may still know the shared `APP_PIN`, which signs in as ורד (including pricing). Rotating `APP_PIN`
  + `SESSION_SECRET` revokes that (signs everyone out once) — a deliberate operator step, not done here.

## Operator steps (Railway → ezone-outpatient service → Variables)

1. Add `USER_PIN_OREN` and `USER_PIN_DANA` (4–6 digits each; different from `APP_PIN` and from each other).
2. Save; variables apply only to deployments started after saving, so set them **before** merging (or redeploy after).
3. After deploy: hard refresh, check `/sw.js` shows `v20`, sign in as אורן and as דנה with their own PINs.

## Tests

`test/user-roster-personal-pins.test.js` (new) plus roster updates in the existing suites. Full suite green.
