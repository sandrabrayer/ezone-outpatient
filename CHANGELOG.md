# Changelog

All notable changes to the E-ZONE Outpatient Dashboard are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Fixed
- **GET /api/sheets now forwards the `secret` query parameter to Apps Script,**
  so authenticated endpoints (e.g. `getWinbackSource`) work. `server.js:82`.

- **False "stop treatment" alerts for every existing patient.**
  `renewalInfo()` in `public/app.js` treated any patient whose
  `paymentStatus` was not exactly `'paid'` as overdue. Patient records
  created before the `paymentStatus` field existed carry an empty value
  (`''`), so every legacy patient — all of whom had in fact paid — was
  falsely flagged with the 🛑 stop-treatment alert and red card banner.

  The rule is now: only an **explicit** `partial` or `unpaid` status
  triggers the alert. An empty / unknown / legacy status is assumed paid
  and produces no alert. This clears all false alarms instantly with **no
  manual re-entry** of existing patients, while keeping the alert fully
  functional for anyone genuinely marked partial/unpaid going forward.

  Affected, all via the single fixed function `renewalInfo()`:
  - the "⚠️ חידושים ועצירות טיפול" alerts list,
  - the per-patient red "🛑 עצור טיפול" card banner,
  - the WhatsApp stop-treatment message button.

### Added
- **`getDebtStatus` — read-only cross-app debt endpoint** (Apps Script
  `Code.gs`). Returns the minimal debtor projection (`clientId`, `name`,
  `phone`, `amountOwed`) for the E-Zone Therapists app's debt-block. Auth
  mirrors `getWinbackSource`: optional shared secret via the
  `DEBT_STATUS_SECRET` Script Property. Billing/payer fields are deliberately
  excluded. See `CHANGELOG-debt-status-endpoint.md`.
- `public/debt-status.js` — canonical, framework-free debt rule
  (`computeDebtors`, `rowOwed`, `amountOwedForRows`), shared single source of
  truth mirrored inline by `Code.gs` and tested in `test/debt-status.test.js`.
- `test/debt-status.test.js` + `test/debt-status-forwarding.test.js` —
  cover the debt reduction (paid/legacy/partial/unpaid, discharge, empty
  inputs) and the `?secret` forwarding for `getDebtStatus`.
- `public/billing-status.js` — canonical, framework-free definition of the
  "is this patient a billing problem?" rule (`hasBillingProblem`,
  `resolvePaymentStatus`), usable from both Node and the browser.
- `test/billing-status.test.js` — regression tests covering the empty /
  legacy status case plus paid / partial / unpaid (Hebrew and English),
  garbage input, and null clients.
- `npm test` script using Node's built-in test runner (no new dependencies).

### Notes
- No change to data, schema, or the Apps Script backend.
- The payment-status dropdown already existed in the "ערוך פרטי טיפול"
  patient modal; it was not the cause of the bug and was left as-is.
- `public/app.js` implements the rule inline (no browser build step). It is
  kept in sync with `public/billing-status.js` by hand; any change to the
  rule must update both, and the tests guard the canonical module.
