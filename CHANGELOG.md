# Changelog

All notable changes to the E-ZONE Outpatient Dashboard are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Fixed
- **GET /api/sheets now forwards the `secret` query parameter to Apps Script,**
  so authenticated endpoints (e.g. `getWinbackSource`) work. `server.js:82`.
- **`server.js` now exports the Express app and only calls `listen` when run
  directly** (`require.main === module`), exposing a `start(port)` helper. The
  `*-forwarding.test.js` tests start their own server in `before` and
  `server.close()` it in `after`, so the test runner exits cleanly instead of
  leaking a listening socket (which caused `EADDRINUSE` / hangs across runs).

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
- **`flagStop` — inbound cross-app stop-treatment flag** (Apps Script
  `Code.gs`, new `StopFlags` sheet). The E-Zone Therapists app POSTs
  `{ action:'flagStop', secret, phone, name, reportedBy, note }` to record a
  **pending** "a therapist reports this patient stopped" note. It **never**
  changes `Clients.status` — Vered confirms it in the outpatient UI and performs
  the actual discharge as today, remaining the sole discharge authority. Auth is
  **fail-closed** (the opposite of the read endpoints): if the `STOP_FLAG_SECRET`
  Script Property is unset, the write is refused outright. Companion dashboard
  actions `getStopFlags` (list pending) and `resolveStopFlag` (mark handled) are
  unauthenticated like the rest of the dashboard surface. No `server.js` change —
  the proxy already forwards the POST body and the GET action. See
  `CHANGELOG-stop-flags.md`.
- **Pending stop-flags panel in the clients view** (`public/app.js`,
  `index.html`, `style.css`). "המתנה לאישור הפסקה" lists each pending flag,
  matches it to a client by **name + normalized phone** (`treatmentContactPhone`,
  reduced to national significant digits so `050…` / `+972…` / `00972…` all
  match), and offers **אשר הפסקה** (opens the existing exit modal for the matched
  client; on discharge the flag is auto-resolved) or **התעלם** (resolve without
  discharge). No match / ambiguous match is shown so Vered can act manually.
- `test/stop-flags.test.js` — locks the fail-closed auth, the
  identifier-required + pending-by-default flag shape, the pending-only listing,
  and the `phoneKey`/`matchClientForFlag` matching (format-agnostic phone,
  name disambiguation, no-match never guesses). `test/stop-flags-forwarding.test.js`
  — locks the Node proxy pass-through for `flagStop` (POST body incl. secret) and
  `getStopFlags` (GET action).
- **`getTreatmentPlans` — read-only cross-app treatment-plan endpoint** (Apps
  Script `Code.gs`). Returns each client's plan projection — `clientId`,
  `name`, `phone` (`treatmentContactPhone`), `serviceType`, `sessions`
  (`sessionsPerWeek`), `status` — for the E-Zone Therapists "מטופלי חוץ —
  תוכנית טיפול" tab. A minimal, read-only projection: **no**
  `payerName`/`payerPhone`/`paymentLink`/prices/bundles. Auth mirrors
  `getWinbackSource`/`getDebtStatus`: optional shared secret via the
  `TREATMENT_PLANS_SECRET` Script Property (separate from `DEBT_STATUS_SECRET`
  so the two endpoints rotate independently); if unset the action is open
  (URL-obscurity). The Node proxy already forwards `?secret=`, so no
  `server.js` change. See `CHANGELOG-treatment-plans-endpoint.md`.
- `test/treatment-plans.test.js` — locks the minimal projection contract
  (phone is `treatmentContactPhone`, no payer/billing leak, missing-id rows
  skipped, blanks default to empty strings).
- **`getDebtStatus` — read-only cross-app debt endpoint** (Apps Script
  `Code.gs`). Returns the **full client roster** with a **tri-state**
  `debtStatus` — `debt` / `clear` / `unknown` — plus `clientId`, `name`,
  `phone`, `amountOwed`, for the E-Zone Therapists intake gate. Never-fail-open:
  a client with **no payment rows** is `unknown` (→ consumer flags for manual
  resolution), not silently "clear"; the consumer also flags a phone that
  matches no client or more than one. Auth mirrors `getWinbackSource`: optional
  shared secret via the `DEBT_STATUS_SECRET` Script Property. Billing/payer
  fields are deliberately excluded. See `CHANGELOG-debt-status-endpoint.md`.
- `public/debt-status.js` — canonical, framework-free debt rule
  (`computeClientDebt`, `clientDebtStatus`, `rowOwed`, `amountOwedForRows`),
  shared single source of truth mirrored inline by `Code.gs` and tested in
  `test/debt-status.test.js`.
- `test/debt-status.test.js` + `test/debt-status-forwarding.test.js` —
  cover the tri-state rule (debt/clear/unknown, per-row paid/blank/partial/unpaid,
  discharge, empty inputs) and the `?secret` forwarding for `getDebtStatus`.
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
