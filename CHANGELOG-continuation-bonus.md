# Changelog — Outpatient-Continuation Bonus

Tracks the OUTPATIENTS side of the cross-app "outpatient-continuation bonus"
project. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

This file covers **step 1 only**: reliably computing the correct per-house
monthly 5% figure inside OUTPATIENTS. Steps 2–4 (hand-off to DASHBOARD,
DASHBOARD pass-through, MANAGERS display) are out of scope here and will be
logged separately when they begin.

## [Unreleased]

### Added

- **`public/continuation-bonus.js`** — pure, dependency-free module that
  computes the outpatient-continuation bonus from the `Clients` data the app
  already loads. Mirrors the UMD pattern of `billing-status.js` so it runs in
  Node tests and the browser with no build step.

  - Output is **per source house** (`house_of_origin`), not per manager.
    OUTPATIENTS has no manager identity; the house→manager mapping lives
    downstream (DASHBOARD/MANAGERS) where it already exists. Emitting
    per-house avoids this app owning data it does not have.
  - Two unconfirmed business questions are **configurable**, not hardcoded:
    - `basis`: `'package'` (contracted monthly package amount —
      `Clients.pricePerSession`, the app's own `monthlyRevenue()` figure) or
      `'treatments'` (best-available proxy for treatments received that
      month; documented approximation).
    - `ratePct`: the percentage (default `5`).
  - Cadence is **every continuing month** (confirmed), realised by iterating
    each month in the requested window in which the patient is continuing.
  - Exclusions, by design: `external` (not a payable house), missing/unknown
    `house_of_origin`, status `סיים טיפול` (finished). Status `הפסקה זמנית`
    (temporary pause) is excluded by default, includable via
    `countPausedStatus`.
  - Month-window bounds respect `startDate`/`exitDate`; missing values are
    treated as "ongoing" / "open-ended" respectively.
  - `previewText()` produces a human-readable dry-run so the money impact can
    be reviewed **before** any number is sent anywhere. The module performs
    **no I/O, no network, and mutates nothing**; it does not touch occupancy
    logic and does not write to any sheet.

- **`test/continuation-bonus.test.js`** — 20 tests (Node built-in runner)
  covering: normal case, multi-patient/multi-house aggregation, zero/missing
  package, external & unknown house exclusion, status handling
  (finished/paused/active/legacy-empty), month-window boundaries, both
  `basis` modes, configurable rate, fail-fast on invalid config, window
  roll-up, preview text, input-immutability, and non-array safety.

### Security / safety

- No new dependencies.
- Module is read-only and side-effect-free; cannot affect existing flows,
  occupancy logic, billing, or the `getWinbackSource` cross-app endpoint.
- Invalid `basis`/`ratePct` config throws immediately (fail fast) rather than
  silently producing a wrong money figure.

### Notes

- Pre-existing unrelated test failure: `test/sheets-secret-forwarding.test.js`
  fails on this branch exactly as it does without these changes (it is a
  server/port/fetch-stub test untouched by this work). 27/28 suite pass;
  the new module's 20 tests all pass.
- Open items still to confirm with stakeholders before step 2:
  - final `basis` (`package` vs `treatments`);
  - whether the `treatments` proxy is acceptable or a real per-month
    delivered-treatment figure must be sourced.

## [Unreleased] — revision after stakeholder clarification

### Changed

- **Locked the basis to the contracted monthly package; removed the
  `treatments` mode entirely.** Stakeholder clarified the package is charged
  **upfront**, so the manager's 5% is earned in the month the package is
  billed/collected — it does not wait for sessions to be delivered.
  Carry-over sessions (paid 4, used 3, 1 rolls over) are a purely
  operational matter with **zero bonus implication** (the money was already
  collected). Config surface is now just `ratePct` and `countPausedStatus`.

### Removed

- `treatmentsReceivedAmount()`, the `basis` option, and `weeksPerMonth`.
  The session-delivery idea is dead, not dormant: because billing is
  upfront, a per-session/delivery figure is neither needed nor correct for
  the bonus. Test count adjusted to 19 (all pass); the removed tests covered
  only the deleted mode.

### Explicitly NOT a dependency

- Session attendance, carry-over tracking, and daily room scheduling are a
  **separate future operational system** (different owner — not Vered).
  The bonus computation does not read, need, or wait on that system. This
  is recorded so no future change re-couples them.

## [Unreleased] — step 2 source (OUTPATIENTS export endpoint)

### Added

- **`getContinuationBonus` read-only cross-app endpoint in
  `apps-script/Code.gs`.** This is the source side of step 2 (hand-off):
  DASHBOARD will pull from it, then pass the figure through additively to
  MANAGERS.
  - Returns the **current month only**, per-source-house: minimal
    projection `{ ok, sourceApp, kind, month, ratePct, byHouse, total }`.
    No patient names, phones, billing, payer, or per-patient lines — same
    deliberate restriction `getWinbackSource` applies to its own output.
  - Logic is a faithful re-implementation of the canonical, unit-tested
    `public/continuation-bonus.js` (Apps Script cannot `require()` it —
    same dual-implementation arrangement as `billing-status.js` ↔
    `app.js`). Basis = upfront monthly package; real houses only;
    finished/paused excluded; start/exit month window respected; rate 5%.
  - Wired into both `doGet` and `doPost`.

### Security

- **Auth is fail-closed and REQUIRED** (stronger than `getWinbackSource`,
  whose secret is optional). `_bonusAuthOk` returns `false` unless a
  Script Property `BONUS_SECRET` exists **and** the request's `?secret=`
  matches exactly. No secret configured ⇒ endpoint denies all requests.
  Rationale: this is a money endpoint.
- No `server.js` change required: the existing `/api/sheets` proxy already
  forwards arbitrary `action` + `secret` upstream (covered by
  `test/sheets-secret-forwarding.test.js`), so the new action rides the
  same path with no new surface.
- Endpoint is read-only and additive; it does not modify any sheet, does
  not alter existing actions, and does not touch occupancy logic.

### Tests

- **`test/continuation-bonus-appsscript-parity.test.js`** (5 tests): proves
  the Code.gs port produces byte-identical `byHouse`/`total` to the
  canonical module on a shared mixed dataset and a boundary case (guards
  against silent drift between the two implementations), asserts the
  minimal projection leaks no PII/billing keys, and verifies the
  fail-closed + exact-match auth behaviour. All pass.
- Suite: 31/32 pass; the single failure is the pre-existing, unrelated
  `sheets-secret-forwarding.test.js` (unchanged by this work).

### Operator setup (required before DASHBOARD can consume)

1. In the OUTPATIENTS Apps Script project: **Project Settings → Script
   Properties → add `BONUS_SECRET`** with a strong random value.
2. Re-deploy the Web App (new version) so the new action is live.
3. Verify:
   `GET <SHEETS_URL>?action=getContinuationBonus&secret=<BONUS_SECRET>`
   returns `{ ok:true, month:"YYYY-MM", byHouse:{...}, total:... }`.
   Without the secret it must return `{ ok:false, error:"unauthorized" }`.

### Still blocked (steps 2 wiring + 3) — needs the DASHBOARD repo

- The consumer side (DASHBOARD pulling this endpoint and additively
  threading the figure into its own feed without touching occupancy) cannot
  be designed until the DASHBOARD codebase/sheet/Apps Script is available.
