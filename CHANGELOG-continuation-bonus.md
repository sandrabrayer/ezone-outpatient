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
