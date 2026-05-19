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
