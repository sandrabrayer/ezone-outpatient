# Therapist-payout steps 2–4 — correct · Excel export · mark-forwarded

Builds on the step-1 read view (`CHANGELOG-therapist-payout-view.md`). The
תשלומי מטפלים screen becomes מורן's full monthly payout workflow: fix/add
sessions, hand payroll a spreadsheet, and close each therapist's month.

All three capabilities reuse what already exists — the corrections go through the
**same `_recordSessionOutcome` rules engine** the Therapists app writes through,
and the view/export are computed by the **same pure `monthlyPayoutSummary`**.

## 1. Correct (`correctSessionOutcome` → `_recordSessionOutcome`)

מורן opens one modal (✏️ **תקן** on a session row, or **+ הוסף סשן חסר** in the
toolbar) to:

- **fix an outcome** — re-send the existing `sessionId` with a corrected outcome
  (`happened ↔ therapist_cancelled ↔ patient_no_show`). The engine **upserts by
  `sessionId`**: it reverses the old row's pay + credit effect and applies the
  new one (e.g. `happened`→`therapist_cancelled` recomputes pay to 0 and hands
  the drawn/granted credit back). No duplicate row, no stale pay.
- **add a missing session** — a session the Therapists app never logged. A fresh
  `sessionId` (`uid()`) **appends** a new row; pay + value + credit are computed
  from the rules.

**There is NO raw-amount field.** Every correction is priced server-side from the
rate/billing tables, so the audit trail (rules-derived pay, credit reversal) is
preserved.

`correctSessionOutcome` is an **internal, no-secret** dashboard action — same
trust level as the by-id `resolveStopFlag` / `savePayment` writes, NOT the
secured cross-app receiver. It dispatches straight into `_recordSessionOutcome`.
An already-`forwardedToPayroll` stamp is **preserved** across the upsert (a
correction never silently un-forwards a session payroll already received).

## 2. Excel export (`public/payout-export.js`)

The **ייצוא לאקסל** button builds a UTF-8-**BOM** CSV (so Excel renders Hebrew
correctly) of exactly what is on screen for the selected month and downloads it as
`payout-YYYY-MM.csv`. Layout:

- title row · blank · header (`מטפל · סשנים משולמים · לפני מע״מ · מע״מ · כולל מע״מ`)
- one row per therapist + a **סה״כ** totals row
- a **הפרשים** section (only when late differences exist) with its own header
  (incl. a **חודש** column), one row per therapist, and a הפרשים total.

The VAT column is `total − preVat` (so `preVat + vat` round-trips to the incl-VAT
total). `PayoutExport` is a pure UMD module (`buildPayoutRows` / `buildPayoutCsv`)
— no SheetJS / no new dependency; CSV is the dependency-free, Excel-native choice.

## 3. Mark-forwarded (`markForwarded` → `_markForwarded`)

A per-therapist **הועבר לחשבת שכר** button (with a confirm) stamps every
still-unstamped `SessionLog` row for that **(therapist, month)** with the new
append-only **`forwardedToPayroll = 'YYYY-MM'`** column.

- **Settled rows never appear again** — `monthlyPayoutSummary` excludes any row
  with a `forwardedToPayroll` stamp from every view.
- **Per-therapist + per-month independent** — forwarding one therapist's month
  never touches another's, nor a different month. Idempotent (a re-run stamps 0).
- **הפרשים (late catch-ups)** — a session logged for a month that is *already
  closed* for that therapist (a sibling row is stamped) but is itself still
  unstamped surfaces as a **הפרש** in the current cycle, carrying its originating
  month. Forwarding that month again settles it (stamps the late row) and the
  הפרש clears. Months are matched with `_payoutMonthOf`, which mirrors the view's
  `monthOf` (handles both ISO and the raw `JS Date.toString()` dates real
  `SessionLog` rows carry).

## SessionLog column

`SESSION_LOG_HEADERS` gains a trailing, append-only **`forwardedToPayroll`**
(after `creditStatus`). Empty = not forwarded. Written only by `_markForwarded`;
preserved across outcome upserts; defaults to empty on every new/ corrected row.

## Frontend

- **treatment-map.js + payout-export.js** are now loaded in the browser (the
  add-session form needs the clinical-type list; export needs the CSV builder).
- The payout view renders a **mark-forwarded** button + a **תקן** button per
  session (editor role only), and a **הפרשים** block below the live month.
- The session modal is shared by correct + add; the frequency field appears only
  for the day-center (ליווי) clinical type.

## Tests

- `test/payout-forwarding.test.js` (12) — `_markForwarded` mirror + source-scan
  guard; stamps only the right (therapist, month) rows; per-therapist
  independence; idempotency; rejects missing therapist / invalid month; matches
  raw JS-Date dates; **view**: forwarded rows excluded, late session → הפרש,
  re-forwarding settles it.
- `test/payout-export.test.js` (7) — per-therapist rows + VAT round-trip, totals
  row, הפרשים section appears only with differences (with its own header/total),
  CSV comma-quoting, empty-summary safety.
- `test/session-outcome.test.js` — add-missing-session appends + computes
  pay/value; header assertions updated for the appended column.
- `test/session-credits.test.js` — header assertion updated (creditStatus now
  second-to-last). Credit reversal-on-correction was already locked here.

`npm test` → all pass.

## Files

- `public/therapist-payout.js` — forwarding-aware summary + `differences`
  (הפרשים); session objects carry `phone`/`month`, therapist entries carry
  `months`.
- `public/payout-export.js` — **new** pure CSV builder.
- `apps-script/Code.gs` — `forwardedToPayroll` column; `_payoutMonthOf`;
  `_markForwarded`; `correctSessionOutcome` + `markForwarded` dispatch; stamp
  preserved across upsert. **Requires redeploy.**
- `public/index.html` — toolbar buttons, session modal, script includes.
- `public/app.js` — export download, session modal (correct + add), per-session
  correct, mark-forwarded, הפרשים rendering, SessionLog reload after writes.
- `test/payout-forwarding.test.js`, `test/payout-export.test.js` — new.
- `CHANGELOG.md`, this file, `README.md`.

## Deploy / config

**Redeploy the Apps Script web app** (Deploy → Manage deployments → ✏️ → New
version → Deploy): the new `forwardedToPayroll` column and the
`correctSessionOutcome` / `markForwarded` actions live in `Code.gs`. The Node
proxy (`server.js`) forwards arbitrary actions transparently, so **no server
change** is needed; the frontend ships on the next Railway auto-deploy.
