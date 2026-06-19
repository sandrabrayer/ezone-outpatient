# Therapist-payout read view (step 1 of 4)

A **read-only** per-therapist monthly payout summary, computed from the
`SessionLog` tab (the reconciliation rows written by `recordSessionOutcome`).
This is **step 1 of 4** — **display only**: no corrections, no export, no
forward-marking. Those are steps 2–4.

## What it shows

For a selected month (`YYYY-MM`), grouped per therapist:

- **Paid sessions** — outcomes that pay: `happened` + `patient_no_show` (the
  therapist showed up, so a patient no-show still pays).
- **Pre-VAT total** — the sum of each paid row's stored `therapistPay`.
- **+VAT total** — the pre-VAT total run through `TherapistPay.withVat`
  (`DEFAULT_VAT_RATE = 0.18`); VAT is never re-applied to individual rows.
- **Excluded (cancelled)** — count of `therapist_cancelled` sessions, surfaced
  for trust/visibility (pay 0, excluded from the total).
- **Per-session breakdown** (expandable) — date, patient, type, outcome, pay.

The month filter keys on each row's **`date` (the session/treatment date)**, not
`recordedAt` (the write timestamp).

## Pure module (`public/therapist-payout.js`)

`monthlyPayoutSummary(sessionLogRows, 'YYYY-MM')` → `{ month, therapists:[…],
totals }`. UMD like `therapist-pay.js`: `require()` in Node/tests, `window.
TherapistPayout` in the browser (it reuses `window.TherapistPay.withVat`, so
`therapist-pay.js` is now loaded in the browser too, before `app.js`). Pure and
side-effect-free; the month arg accepts `YYYY-MM` or a full `YYYY-MM-DD`. An
empty/non-matching month or non-array rows → empty summary (no crash).

## Read endpoint (`getSessionLog`)

New **open** read action in `apps-script/Code.gs` (`_getSessionLog` → dispatched
in both `doGet` and `doPost`), returning `{ ok:true, sessionLog:[…] }`. Same
trust level as `getPayments` / `getStopFlags` — an internal dashboard read, NOT a
cross-app endpoint, so it is **not** behind a shared secret. The Node proxy
(`server.js`) forwards arbitrary read actions transparently, so **no server
change** was needed. The frontend fetches it lazily, only when the payout tab is
first opened.

## Frontend

New tab **תשלומי מטפלים** (`data-view="payouts"`) with a month picker defaulting
to the current month, KPI strip (therapists / paid sessions / pre-VAT / incl.
VAT), and per-therapist cards with an expandable session table. Hebrew RTL,
matching the existing dark theme. **No writes** — no correct, no export, no
forward.

## Tests (`test/therapist-payout.test.js`)

Sums only `happened` + `patient_no_show` and excludes `therapist_cancelled` from
the total · groups by therapist and filters by **session date** (a row whose
`recordedAt` is in a different month still lands in its session-date month) ·
pre-VAT and +VAT totals correct (via `withVat`) · a therapist with mixed outcomes
totals correctly with a full per-session breakdown · empty / non-matching /
junk month and non-array rows → empty summary, no crash · `YYYY-MM-DD` month arg
· numeric-string `therapistPay` coercion. `node --test
test/therapist-payout.test.js` → all pass.

## Files

- `public/therapist-payout.js` — new pure module.
- `test/therapist-payout.test.js` — new.
- `apps-script/Code.gs` — `_getSessionLog` + `getSessionLog` dispatch.
  **Requires an Apps Script redeploy.**
- `public/index.html` — new tab, view section, `therapist-pay.js` +
  `therapist-payout.js` script includes.
- `public/app.js` — `apiGetSessionLog`, `renderPayouts`, lazy load, month
  picker + detail-toggle wiring, payout state.
- `CHANGELOG.md`, `CHANGELOG-therapist-payout-view.md`, `README.md`.

## Deploy / config (required before this shows data live)

1. **Redeploy the Apps Script web app** to the existing deployment (`…FOwWYIw`):
   Apps Script editor → **Deploy → Manage deployments → ✏️ → Version: New
   version → Deploy**. The new `getSessionLog` read action lives in `Code.gs`, so
   a fresh `/exec` version is required for the tab to fetch rows.
2. The pay-table fix (PR #34) must be merged **and redeployed** so `SessionLog`
   rows carry correct pay; otherwise this view faithfully displays whatever
   (wrong/zero) pay the rows already hold.

## Not in this step (steps 2–4)

No correction/edit of logged outcomes, no export (CSV/print), no
forward-marking (paid/settled). Read and display only.
