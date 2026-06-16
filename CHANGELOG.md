# Changelog

All notable changes to the E-ZONE Outpatient Dashboard are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Removed
- **The אחראי (responsible/owner) concept.** Removed the `responsiblePerson`
  name field and its `serviceScope` role selector (individual → "מטפל" /
  program → "מנהל בית") from the app: every form control, model read/write,
  prefill, render (the scope/role chips on renewal rows and client cards), and
  both required-validations. The stop-payment WhatsApp message no longer names
  the responsible (greeting is now a plain "שלום,"). **`treatmentContactPhone`
  (the WhatsApp/billing contact phone) is kept and untouched.** The two sheet
  columns are **deliberately NOT dropped** — `_readAll`/`_writeAll` are
  positional and `_ensureSheet` doesn't migrate data, so removing the mid-array
  headers (positions 20–21) would shift/corrupt every later column incl. the
  `phone` join key. They stay as **reserved, unread slots** in `CLIENTS_HEADERS`
  (no migration; cells blank on a row's next save). `public/app.js`,
  `public/index.html`, `public/style.css`, `apps-script/Code.gs` (comment only).
  `test/responsible-removal.test.js` locks the removal, the reserved-slot
  layout, and positional safety. **No Apps Script redeploy / schema change.**
  See `CHANGELOG-remove-responsible-person.md`.

### Fixed
- **Ambiguous stop-flag "בחר ידנית" did nothing.** The multiple-match case
  rendered a non-interactive `<span>` with no control, and the click handler
  only fired on the single-match button — so Vered could neither pick the right
  client nor clear the flag (its `clientId` was never set, so a manual discharge
  didn't resolve it either). Now `resolveStopFlagClient` returns the candidate
  list, the ambiguous case renders a real **"בחר מטופל"** picker (one button per
  candidate, `data-action="pick-client"`), and picking sets the flag's
  `clientId` and opens the exit modal — reusing the discharge + resolve path so
  the flag clears. `public/app.js`, `public/index.html`, `public/style.css`.

### Added
- **Clinical → billing map module (`public/treatment-map.js`).** A standalone,
  hardcoded source of truth that translates the **clinical** treatment
  vocabulary (the therapists app) into the **billing** vocabulary, plus the
  client-facing price table (incl. VAT). One-to-one over 12 clinical keys; the
  five previously-unmapped clinical types (פסיכודינמי / פסיכותרפי ממוקד טראומה /
  עיסוי טיפולי / טיפול ממוקד התמכרויות / טיפול אינטגרטיבי) enter billing under
  their own names, and two renames are pinned (`פרטני כללי → פרטני`, `מרכז יום →
  ליווי יומי בקהילה` with the day-center/location rule bound to the new name).
  Exposes `clinicalToBilling(clinicalType)` and `billingPrice(billingType,
  frequencyPerWeek?)`: individual + variants ₪500/session, מעקב פסיכיאטרי
  ₪1,100, אינטייק ₪2,300 (billing-only), ליווי יומי בקהילה per month by
  frequency (3×→₪15,000, 5×→₪18,000, other frequencies throw); קבוצה / טיפול
  משפחתי return `null` to flag "no clinic-wide price — set per client" (there is
  no hardcoded price-by-type in the app). `test/treatment-map.test.js` (15
  cases) locks completeness, one-to-one integrity, the renames, price lookup,
  and a loud guard against an unmapped 13th clinical type. **Not wired** into the
  save flow, form, or `getTreatmentPlans` yet — module + tests only. See
  `CHANGELOG-clinical-billing-map.md`.
- **Duplicate-client merge (`mergeClients`).** A guarded cleanup behind the
  duplicate report: pick a **survivor** (radio, defaults to the `פעיל` row), and
  the Apps Script `_mergeClients` action **repoints** every `Payments.clientId` /
  `ClientCharges.clientId` from the dup rows to the survivor (refreshing
  `clientName`) **before** removing the dups — so no billing row is ever
  orphaned — fills only **blank** survivor fields from the dups (never importing
  `id`/`status`/`exitDate`/`fromLead`, so the active survivor keeps its state),
  then deletes the dup client rows, all under one script lock. The UI confirms in
  a modal (survivor, rows to remove, payments/charges to move) — one set at a
  time, explicit confirm, never a bulk purge — and reloads after. **Requires an
  Apps Script redeploy.** `test/merge-clients.test.js` covers survivor default,
  repoint, blank-fill (no status/exitDate import), removal, and validation.
- **Duplicate-client prevention by canonical phone.** A shared
  `findClientByPhone` (via `recoverPhone`) hard-blocks creating a second client
  with the same **patient-identity** phone at **direct-add**, **activation**, and
  the **edit-client treatment-contact phone** — with a Hebrew message naming the
  existing client (`מטופל עם מספר טלפון זה כבר קיים: «…». לא ניתן ליצור כפילות.`).
  Identity = `phone` + `treatmentContactPhone`; **`payerPhone` is deliberately
  excluded** so a payer shared across siblings isn't false-blocked. The lead path
  keeps its existing warn-and-override. Entry-point enforcement only — no
  server-side `_saveAll` dedup. `public/app.js`.
- **Read-only duplicate-clients report** in the clients view
  (`duplicateClientReport` + panel): every canonical phone with more than one
  client row, each row's `id` / `name` / `status` / `phone` and how many
  `Payments` and `ClientCharges` reference it — to identify existing duplicates
  (ליעם / נועם) before any merge. Read-only; **no writes/deletes** this round.
- `test/duplicate-clients.test.js` — picker candidate list, the identity-phone
  duplicate guard (matches phone/treatment-contact, excludes self, ignores
  shared `payerPhone`), and the report grouping with reference counts.

### Fixed
- **Stop-flags showed "no match" for a patient who exists** (e.g. ליעם בריאר,
  `0543123276`). The patient phone had no durable home — `phone` wasn't a
  `Clients` column, so it was dropped on save and blank on reload — and both
  matchers were too strict. Fixed in three parts:
  - **Patient phone now persists** — `phone` appended to `CLIENTS_HEADERS`
    (Apps Script `Code.gs`, **last** column, append-only so existing rows are
    untouched; it's a `PHONE_COLUMN` so it gets the same leading-zero
    text-format/recovery). Populated from the lead on activation, and existing
    clients backfill it in memory from their originating lead at load.
  - **Server write-time match broadened** (`_matchStopFlagClient`) — the
    reported phone is matched against **any** of `phone` / `treatmentContactPhone`
    / `payerPhone`; a phone match alone fills `clientId`; the exact name is only
    a tiebreaker for a shared phone, no longer a hard gate.
  - **Dashboard re-resolves at render** (`resolveStopFlagClient`, `public/app.js`)
    — flags written with an empty `clientId` now resolve in the panel by phone
    across all client phone fields (name soft tiebreaker only), so existing
    flags match without the therapists app re-sending. **Apps Script redeploy
    required** (Clients schema + matcher). `test/stop-flag-match.test.js` guards
    both matchers, the backfill, and the append-only schema.

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
