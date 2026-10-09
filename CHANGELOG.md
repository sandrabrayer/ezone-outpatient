# Changelog

All notable changes to the E-ZONE Outpatient Dashboard are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Daily backup coverage
- Extend the existing nightly backup to Leads and both removal archives as
  well as Clients. Capture under the save lock, then release it before backup
  writes. Verify typed values and literal text in a new sheet before replacing
  the prior daily copy; keep it on write/verification failure. Retention covers
  only the four daily families and runs after all four succeed.
- Add 15 regression cases and six passing native Google helper/restore
  scenarios on synthetic data. Full serial suite: 1,134 passed, 0 failed,
  0 skipped. Production binding, web version 92 and the existing Head trigger
  were inspected read-only. Not deployed; see `CHANGELOG-daily-backup-coverage.md`.
- After Sandra's backup-only approval, create and independently verify an
  owner-only full production workbook copy: all 18 sheets, 3,649 entered
  cells and populated-range cell metadata match. Source unchanged; normal
  writes may resume. Recheck freshness/live version before an approved release.

### Lead save preservation
- Preserve leads added by another user or app when an older tab saves a full
  snapshot. Keep intentional removal and conversion, prevent stale resurrection,
  and retain existing per-row conflict checks and server-owned stamps. No UI,
  financial calculation, schema or dependency change. Adds 18 tests executing
  the real Apps Script handlers. See `CHANGELOG-concurrent-leads.md`.
- Add three browser scenarios through the real UI, signed-session proxy and
  Apps Script handlers against in-memory Sheets. Reuse one Google-runtime
  fixture across unit/browser coverage. A separate `lead-save-browser` CI job
  requires a browser and fails instead of skipping these scenarios.
- Prepare a separate native Google Sheets fixture with synthetic records and
  headers checked against the identified outpatient workbook. Verify the
  existing 18-column removal archive without reading production rows. Four
  sequential stale-snapshot scenarios also passed in the real Google Apps
  Script runtime, using a separate bound project with current-document-only
  access. Keep the runner and evidence outside the production clasp root.
  A native backup/restore drill now also passes on synthetic records across
  Leads, Clients and both archives, with exact typed-cell readback. After
  Sandra's specific approval, all three combined browser/proxy/Google HTTP
  scenarios passed on dummy data. The temporary endpoint was then archived
  and stopped returning application data. Full serial suite: 1,119 passed,
  0 failed, 0 skipped. Daily lead/archive backup coverage and the full production
  backup were completed in the follow-up above; separate production approval
  and pre-deployment freshness/version checks remain required.
- Record Sandra's current approval and cross-agent handoff requirements in
  `CLAUDE.md` and `AGENTS.md`; green CI alone no longer authorizes a release.
  Budget guidance now permits justified spending without a numeric cap,
  with advance notice for material commitments or new recurring charges.

### Added
- **`GET /api/version`** — public, `no-store`, returns only `{ commit, builtAt }`
  (`commit` = hex-validated `RAILWAY_GIT_COMMIT_SHA`, else `null`) so a merge
  can be verified live. Plus **`CLAUDE.md`** with repo facts and autonomous-work
  rules, and an `npm audit fix` clearing the critical `proxy-addr` advisory.
  See `CHANGELOG-api-version-claude-md.md`.
- **תקופת כיסוי — the coverage period a payment actually bought**
  (`coverageStart` / `coverageEnd`, appended to `Payments`) — ported from
  E-Zone-Dashboard PR #135. A payment's period was **inferred** (`dueDate` +
  one month − 1 day) and nothing recorded whether that was true, so a payment
  covering something else landed in the wrong month on **הכנסות חודשיות** and
  was refunded against the wrong window by the **credits ledger**, with no
  screen able to say so. The period is now **recorded on the row**, defaulted
  to the cycle that was previously inferred (so the normal case costs zero
  clicks and **moves no figure**), and **editable** on any persisted row —
  **paid rows included**, since a settled payment is exactly the one whose
  period must be correctable. **NOTHING IS BACKFILLED**: a blank pair is legal,
  is what every historical row carries, and reads as the old inference
  **derived on read** — no old row is rewritten. `CreditsLedger.paymentCoverage`
  stays the **single source of truth** and now returns `{ start, end, source }`
  with the recorded period winning and the inference as the fallback; the
  credits ledger, `buildMonthlyRevenue` and the גבייה row all read it (the
  no-fork guard was widened to pin every consumer). **No arithmetic changed** —
  only where `[start, end]` comes from. The גבייה row now shows the period in
  the app's date format (`06/09/2026 – 05/10/2026`, never ISO) with the
  **automatic split by calendar month** underneath
  (`ספטמבר · 25 ימים · ₪2,500` / `אוקטובר · 5 ימים · ₪500`), computed with the
  **same `allocate()`** the monthly view uses, VAT-inclusive like the row,
  denominated by the **window's own length**, summing to the payment exactly,
  updating **live** while the period is edited, with the later month marked
  **נדחה**. **חיובים נוספים חד פעמיים keep their existing allocation** — a
  one-off covers **its own day**, is never stamped with a window, never
  editable, never split; `paymentDate` remains the **cash** date and still
  plays no part in allocation. Validation is one rule on both sides (half-
  filled, malformed, impossible day, backwards, > 366 days; overlaps and gaps
  between rows are **deliberately allowed**), pinned by a **441-pair
  client/server parity sweep**; the server validates **before the lock and
  before any cell is written**, returns the Hebrew reason **verbatim**, and the
  two columns are **text-forced** so a date-typed cell cannot drift −1 day and
  move revenue between months. **No new endpoint; `server.js` unchanged.**
  52 new tests (1,059 total). See `CHANGELOG-payment-coverage-period.md`.
- **Credits / refunds ledger (`Credits` sheet)** — ported from
  E-Zone-Dashboard PR #124, **money only**. Records what the clinic owes
  **back** to a patient when treatment ends: a month paid in advance, a
  mid-month exit, or the explicit decision that **nothing** is owed (a zero
  is still a row). **No session-level or cancellation logic is ported** —
  that stays in the therapists app, and this ledger has **no relation to
  `Clients.creditsOwed`**, the per-*session* balance `_recordSessionOutcome`
  keeps (sessions vs. ₪; guard-tested that `_upsertCredit` never touches it).
  New pure module `public/credits-ledger.js`: per Payments row, window =
  `[dueDate, dueDate + 1 month − 1 day]`, `unusedDays` = days in it strictly
  after the exit, `rate` = **that row's** `amountPaid ÷ 30` (a fixed
  constant, never the month length), `raw` = rate × days **capped at that
  row's `amountPaid`**. Classified by the window: starting on/before the exit
  → `days_unused`; starting after it → `prepaid_return`, returned **in full
  at `amountPaid`**, not rate × windowDays. Overlapping windows credit only
  days an earlier window did not (`creditedFrom` /
  `alreadyCreditedThrough` in `basis`). **Policy: pro-rata at any tenure.**
  The Dashboard's 14-day cutoff and last-7-days rule are **deliberately not
  ported** — they are residential bed rules with no outpatient meaning (their
  absence is guard-tested). Differences from the Dashboard schema: `clientId`
  is a real persistent key, so the dual `patientId`/`patientKey` columns
  **collapse to one**, and `houseId`/`facilityType` are dropped; `dueDate`
  and `paymentDate` already existed, so the window logic ported unchanged.
  Payout: `decidedDate`, `payoutDate` derived server-side as the 15th on or
  after it, `status` `pending|paid|cancelled`, and **marking paid is
  explicit** (`paidDate` + `method` required — nothing flips when the payout
  date passes). New "זיכויים ממתינים לתשלום" view on **גבייה**, grouped by
  payout date with per-date and grand totals. Override: `calculatedAmount`
  and `amount` **both persist**, `calculatedAmount` immutable,
  `overrideReason` required when they differ, `approvedBy` recorded.
  Security: **no new endpoint and `server.js` unchanged** — `getCredits` /
  `saveCredit` ride the session-cookie-gated `/api/sheets` proxy;
  `createdBy`/`updatedBy` come from the **signed cookie** via `_requestUser`,
  never the payload; everything re-validated server-side; only
  `CREDIT_EDITABLE_COLUMNS` are taken from an edit payload; stale-save
  refusal names who saved first; refusals are never swallowed by the client.
  **Requires an Apps Script redeploy** (no new Script Property). `sw.js` cache
  `ezone-outpatient-v5` -> `v6` (index.html changed, per the house rule); the
  v5 assertion in `test/add-user-yarden.test.js` hard-pinned that exact
  version, so it now asserts the **floor** (`>= v5`) plus its own documented
  bump — same intent, without freezing `sw.js` against every future bump (its
  monotonicity checks are unchanged). Tests: new `test/credits-ledger.test.js`
  (61); suite 883 -> 944. See `CHANGELOG-credits-ledger.md`.
- **ירדן added as an outpatient user.** `lib/users.js` `SESSION_USERS`
  `[ורד, שירן, יעל]` -> `[ורד, שירן, יעל, ירדן]` (appended, existing order
  kept) and the matching `<option>ירדן</option>` on the single
  `<select name="assignedTo">` in `index.html`, which a test pins equal to
  the list. That one list drives all three places a name appears: the login
  **name picker** (`GET /api/users`), the `user` that `POST /api/verify-pin`
  will embed in the session cookie, and the leads **משוייך ל** dropdown.
  **Same permissions as everyone else, no new role** — the list is an
  allow-list of names, not a role table; editor/viewer is decided by which
  PIN button was used, never by which name was picked. `server.js`,
  `app.js` and `_saveAll` needed no change (all read the list). Verified
  against the real code: a save by ירדן stamps `updatedBy = ירדן` on a
  changed client, a changed lead and a new row, and the stale-save conflict
  refusal works for her in both directions (her stale save is refused with
  a `[conflict]` line naming her; a row she stamped refuses someone else’s
  stale save as `sheetUpdatedBy: ירדן`). `Code.gs` comment-only touch (the
  `assignedTo` note listed the three old names). `sw.js` cache
  `ezone-outpatient-v4` -> `v5`. Tests: new `test/add-user-yarden.test.js`
  (17); suite 855 -> 872. See `CHANGELOG-add-user-yarden.md`.
- **Hardened `@claude` GitHub Actions workflow.** New
  `.github/workflows/claude.yml`, copied **byte-for-byte** from
  `ezone-helpdesk` (blob `ec00836`) with no adaptation, so all six E-ZONE
  copies stay diffable against one original. It runs
  `anthropics/claude-code-action@v1` when `@claude` is mentioned on an issue
  or PR, and only for the repo owner: the job's `if:` gates on
  `github.actor == 'sandrabrayer'`, `&&`-ed *in front of* the four mention
  checks (`issue_comment`, `pull_request_review_comment`,
  `pull_request_review`, `issues`), so no other account can start a run —
  E-ZONE staff reach the helpdesk through its own intake, never through
  GitHub. A non-owner `@claude` mention produces **no run at all**; that is
  the intended outcome, not a bug to be "fixed" by loosening the `if:`.
  Permissions are declared once at workflow level and are exactly
  `contents: write`, `pull-requests: write`, `issues: write`,
  `id-token: write`, `actions: read` — nothing beyond. Cost is capped with
  `claude_args: '--max-turns 15'`. The credential appears only as
  `${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`; nothing is hard-coded and no
  other secret is named. **Setup required after merge:** that secret is not
  yet set here (Actions secrets hold only `APP_PIN`, `CLASPRC_JSON`,
  `DEPLOYMENT_ID`), so until it is added the workflow is inert — add it under
  Settings → Secrets and variables → Actions with the value from
  `claude setup-token`. The deploy branch
  `claude/youthful-volta-laarnk` is also the GitHub default branch, so agent
  PRs target what Railway serves. Workflow file only — no application code,
  no `Code.gs` (no clasp redeploy), no frontend asset (no SW bump), no new
  dependencies, no new env vars. Contract and rationale:
  `docs/github-actions.md` in `ezone-helpdesk`.
- **End-user guide (Hebrew, RTL).** New `docs/USER-GUIDE.he.md` — the
  first user-facing document in the repo: login (the bot never hands out
  passwords), daily operations (leads/outpatients incl. `לא רלוונטי` with a
  reason, renewals, treatment plans, editing a card), therapist payouts
  (present but not in use yet), working rules that prevent conflicts
  (refresh before editing, one editor per patient at a time, verify after
  save), common problems (duplicates — never delete on your own; a
  "disappeared" record — check other statuses then report, never re-enter;
  unsaved changes) and who to contact. Wrapped in `<div dir="rtl" lang="he">`
  so GitHub renders it right-to-left. README links to it. No runtime change.
  Guard test `test/user-guide.test.js` (12) pins the sections, the RTL
  wrapper, the absence of anything secret-looking, and that the UI wording the
  guide relies on still exists in `public/index.html`; suite 848 → 860. See
  `CHANGELOG-user-guide.md`.
- **Name picker + stale-save conflict refusal (Outpatient PR 2).** Port of
  E-Zone-Dashboard PR #114 on top of PR 1. After a correct PIN the client
  reads `GET /api/me`; an empty `user` opens a one-screen RTL name picker
  (one button per `lib/users.js` name via the new session-gated
  `GET /api/users`, no free text) that re-posts `/api/verify-pin` with
  `{ pin, user }` — the PIN lives in a closure for that single call, the
  cookie is re-issued with the name inside and the same 7-day TTL. The
  header shows `מחובר/ת כ: <name> · החלף` (החלף = logout → PIN → picker); a
  remembered editor session without a name is sent through PIN → picker once
  on next load. `Code.gs _saveAll`: for each id-matched client/lead, when the
  sheet's `updatedAt` and the tab's echoed `updatedAt` are both non-empty and
  differ AND a non-meta column changed (`_clientDiffCols` / `_leadDiffCols`),
  the row is REFUSED — the sheet row is written back unchanged in its place
  and reported in the additive `conflicts` response field (absent when none),
  with a `[conflict]` execution-log line. Empty echo (pre-stamping tab),
  empty sheet stamp, equal stamp, pure echo and new rows keep today's
  behaviour; still under the lock, preserve-by-id blocks untouched. Client:
  `public/conflicts.js` `conflictsMessage(res)` builds the banner
  `השינוי ל־<names> לא נשמר — <updatedBy> עדכן/ה קודם. הנתונים רועננו.`
  (blank editor → `מישהו/י`), shown in a dismissible banner, then `loadAll()`;
  never retried. `sw.js` cache `ezone-outpatient-v3` → `v4`. Tests: new
  `test/name-picker-conflicts.test.js` (29, incl. two Playwright e2e cases);
  suite 819 → 848. See `CHANGELOG-name-picker-conflicts.md`.
- **Signed session cookie + who/when stamping (Outpatient PR 1).** Port of
  E-Zone-Dashboard PRs #113/#114. `POST /api/verify-pin` now mints a signed
  HttpOnly `ezone_session` cookie (HMAC over `SESSION_SECRET`, 7 days,
  SameSite=Lax, Secure behind HTTPS; legacy `expiry.sig` and user-bearing
  `expiry.userB64.sig` tokens) and accepts an optional `user` **only** from
  `lib/users.js` (`ורד` / `שירן` / `יעל` — the `assignedTo` names). Every
  browser-only data route (`/api/sheets` GET+POST, `/api/continuation-roster`,
  new `GET /api/me`, `/api/debug/*`) requires the cookie (401 otherwise);
  `POST /api/sheets` always overwrites `body.user` from the cookie; new
  `POST /api/logout` expires it (the יציאה button calls it). **Fail-closed:**
  no `SESSION_SECRET` → verify-pin 500 + a clear log line, data routes 401.
  No Railway route serves another app (therapists / dashboard call the Apps
  Script `/exec` directly — verified), so nothing cross-app changed. Schema:
  `updatedAt`, `updatedBy` appended at the END of `CLIENTS_HEADERS` (36
  cols), `LEADS_HEADERS` and both tombstone literals, text-forced.
  `Code.gs` stamps are SERVER-OWNED: `_saveAll` diffs each client/lead
  against its on-sheet row by id (`_clientDiffCols` / `_leadDiffCols`
  ignore id + stamps + the two server-managed cells) — changed or new →
  stamp now + user, unchanged → carry the sheet's stamps, payload stamps
  never trusted, preserved rows untouched, explicit deletes stamp the
  deleter on the tombstone; every single-cell Clients writer stamps its row
  (blank user for cross-app receivers). Client: one `apiFetch` 401 handler
  → PIN screen; data loads after the PIN. **Railway: set `SESSION_SECRET`
  BEFORE merging** (variables apply only to deployments started after
  saving). Tests: +32 (`session-who-when`, `session-fail-closed`), 17 pins
  updated; suite 819 green. See `CHANGELOG-session-who-when.md` (incl. the
  PR 2 plan: name picker + `updatedAt` conflict refusal).
- **`getTreatmentPlans`: project `renewalDate` (date only).** The cross-app
  projection now includes each client's package-end/renewal date so the E-Zone
  Therapists app can prompt a "renew next week" conversation. SAME value Vered's
  גבייה הבאה chip and renewal banner show: the stored `nextBillingDate`, else
  anchor (`packageChangeDate` → `paymentDate` → `startDate`) + 1 calendar month
  with the short-month clamp — new Code.gs helpers `_renewalDueDate` /
  `_addMonthIso` mirror `nextRenewalDueDate` / `addMonth` in
  `public/charges-logic.js` (clamp equality is asserted against the real
  charges-logic function in `test/treatment-plans.test.js`). `''` when no
  anchor. **Date only — the `nextBillingDate` key itself is NOT projected and
  no payment rows/amounts/statuses cross**; a contract-guard test locks the key
  set to exactly the previous projection + `renewalDate`. No sheet schema
  change, no new secret. Apps Script redeploys automatically via clasp CI on
  merge.
- **רעננה הפרדס (canonical id `pardes`) — new house wired in.** The dashboard's
  `createLead` for pardes discharges (`house:'pardes'`) now stores this repo's
  stable key `raanana_pardes` (Code.gs alias — matches the continuation tab's
  existing mapping), and `HOUSE_OF_ORIGIN_LABELS` labels verbatim-stored
  `'pardes'` rows written before the redeploy. All other house surfaces
  (LOCATIONS, בית מוצא selects, continuation labels/mapping) already carried
  the house. New guard `test/house-enumerations.test.js` asserts every house
  enumeration covers the canonical 5-house list; no per-house sheet tabs,
  parameters, PINs or digests exist in this repo. Apps Script redeploys
  automatically via clasp CI on merge (new version, same `/exec` URL). See
  `CHANGELOG-add-pardes-house.md`.
- **מטופלים לא פעילים — dedicated top-level tab + the לא פעיל fix.** A lead
  is someone who has not started treatment, so discharged patients no longer
  sit in שימור לידים (now leads-only): both inactive kinds — `סיים טיפול`
  (manual discharge) and `לא פעיל` (deleted in the therapists app) — moved to
  a new eighth nav tab with per-kind sections, badges and per-tab search.
  Fixes the live inconsistency where `לא פעיל` patients still appeared in the
  main patients list and kept generating גבייה due items: `renderClients`,
  `clientsDueOn` and `renewalInfo` now exclude both inactive statuses
  (`הפסקה זמנית` still bills). The שחזר לטיפול restore now covers `לא פעיל`
  too — flipping the status re-adds the patient to the cross-app projections,
  so the therapists roster picks them up again with no sender call. Still
  frontend-only (no Code.gs change, no new column, no redeploy). New
  `test/inactive-patients-tab.test.js` (11 cases);
  `test/restore-client.test.js` updated in lockstep. See
  `CHANGELOG-inactive-patients-tab.md`.
- **שחזר לטיפול — restore a discharged patient from the retention tab.** The
  "סיימו טיפול" cards in שימור לידים (previously display-only) now carry an
  editor-only restore button, mirroring the שחזר לליד pattern. A confirm modal
  lists the patient's active extra charges (they resume billing untouched),
  then an optimistic write sets `status='פעיל'`, clears `exitDate`, and
  re-anchors billing to the restore date (`packageChangeDate=today` + clearing
  the stale `nextBillingDate`, so גבייה הבאה = restore + 1 month instead of an
  instant months-overdue flag). Discharge-only by design — the cross-app
  `'לא פעיל'` status is not restorable from the UI. Frontend-only: rides the
  ordinary `saveAll`; **no Code.gs change, no new column, no redeploy.** New
  `test/restore-client.test.js` (12 cases). See `CHANGELOG-restore-client.md`.
- **`getTreatmentPlans`: project the treatment period (`startDate` + `exitDate`).**
  The cross-app projection now includes each client's treatment start date and
  end date, consumed by the E-Zone Therapists patient card. Both columns already
  exist on the Clients sheet and are already read by `_readAll` (a Date cell
  comes back as a `yyyy-MM-dd` string; `exitDate` is blank for still-active
  patients), so this is an additive projection change — **no sheet schema change,
  no new secret, the minimal no-payer/no-billing contract is unchanged.** The
  mirror test in `test/treatment-plans.test.js` is updated in lockstep. See
  `CHANGELOG-treatment-plans-dates.md`.

### Fixed
- **Outpatient patients no longer vanish silently from the therapists app —
  `getTreatmentPlans` emits a validated join phone + `phoneIssue`.** The
  E-Zone Therapists roster is keyed by phone and drops rows with none. Both of
  its base feeds projected
  `_recoverPhone(phone) || _recoverPhone(treatmentContactPhone)` unvalidated,
  so a client with no number disappeared with no explanation. A malformed,
  non-empty `phone` also short-circuited the `||` and hid a valid contact
  phone.
  - **The new rule** is one documented rule (`public/phone-issue.js`),
    mirrored in `Code.gs` (`_canonicalPhone` / `_crossAppPhone`) and
    `public/debt-status.js`:
    - candidates are `phone`, then `treatmentContactPhone` (never
      `payerPhone`);
    - each is normalized with `_recoverPhone` (separators stripped,
      `+972` / `972` / `00972` → `0`, a Sheets-dropped leading zero restored);
    - a candidate is accepted **only** when it is canonical, `/^0\d{9}$/`;
    - otherwise `phone: ''` and `phoneIssue: 'missing' | 'invalid'`. The code
      never guesses: nothing is truncated, padded or split.
  - **`getDebtStatus`** emits the same phone (value only, no new key), so the
    roster's two sources always agree on a client's key.
  - **Contract:** the only change is the `phoneIssue` key on
    `getTreatmentPlans`. No billing keys, and `CLIENTS_HEADERS` is untouched.
  - **Patient cards** show an amber «⚠ חסר טלפון» / «⚠ טלפון לא תקין» chip,
    under the same rule, so Vered can fix them. SW `v7 → v8`.
  - **Phase 0** (live read-only audit): 13 of the 14 reported patients have
    **no phone in any column**. This is a data-entry gap, not a format bug.
  - **Order:** `phone` stays first. A contact-first order would re-key the
    one live row that has a legacy contact phone to another person's number.
  - **Tests:** 35 new, including a 1,521-pair parity sweep that runs the real
    `Code.gs` (1,094 total). See `CHANGELOG-treatment-plans-phone-issue.md`.
- **A re-marked session no longer rewrites therapist pay on a row already
  forwarded to payroll.** `SessionLog.forwardedToPayroll` stamps the `YYYY-MM`
  payroll cycle a session was handed to חשבת שכר in. Only that **stamp**
  survived an outcome upsert — `therapistPay` was recomputed unconditionally
  from the new outcome — so re-marking (or re-sending) an already-forwarded
  session silently overwrote the pay on a row payroll had **already paid out**.
  Nothing surfaced it: the payout view filters forwarded rows out, so the
  rewritten figure never appears in a total again and the sheet quietly stops
  agreeing with the money that actually left. The worst case is a forwarded
  `happened` (paid the rate) re-marked to `therapist_cancelled`, which rewrote
  the row to **₪0** — the shekels were paid, the record says they were not.
  `_recordSessionOutcome` now derives `wasForwarded` once and, when set,
  carries the **stored** `therapistPay` across the upsert via a new
  `_toNumberOrZero` helper (a blank or stray string coerces to 0, never `NaN`
  into the cell); the returned `therapistPay` reads from the row object, so a
  caller sees the frozen figure rather than the discarded recomputation.
  **The freeze applies to every outcome** — `happened`, `patient_no_show` and
  `therapist_cancelled` alike — because the question is not what the session
  turned out to be, it is what payroll was already sent. Everything else about
  the correction still runs: `outcome`, `sessionStatus` and the **credit
  engine** are unchanged (`creditsOwed` is a separate, still-open ledger, so a
  cancellation credit is still granted on a forwarded row), validation still
  runs **before** the freeze (an unknown therapist still rejects and writes
  nothing), and the stamp itself is still preserved. A genuine pay correction
  on a settled row belongs in the next cycle as a **הפרש**, not as a silent
  rewrite. Un-forwarded rows are untouched — they still recompute from scratch
  and still pick up a `TherapistRates` change. **No schema change**
  (`SESSION_LOG_HEADERS` is unmodified), no new endpoint, `server.js`
  unchanged, and `PAID_OUTCOMES` stays the plain outcome-based map. **Requires
  an Apps Script redeploy** to take effect. Tests: new
  `test/forwarded-pay-freeze.test.js` (24, incl. source-scan guards that assert
  the guard exists in the real `Code.gs`); suite 944 -> 968. See
  `CHANGELOG-forwarded-pay-freeze.md`.
- **The package chip toggles paid ⇄ unpaid reliably again.** After the cycle
  fix (#95) the chip's click was still gated on the underlying Payments ROW
  status, while its visible state comes from the anchor (`packagePaidState`) —
  whenever the two disagreed the click was a silent no-op, so the chip felt
  stuck: a legacy paid row whose anchor never advanced couldn't be marked
  paid; a paid-up patient whose paid row sits under a different month than
  the computed previous cycle couldn't be unmarked. Three fixes in
  `setCurrentMonthPaid`:
  - The toggle is now gated on `packagePaidState` itself (the state the chip
    renders), never on a row. When the row already says the new status it is
    simply not rewritten — only the anchor moves, preserving the row's real
    `paymentDate`/amount history (which the שולם ב line then shows).
  - Marking paid with an anchor several cycles stale used to advance one
    cycle into the PAST (chip stayed לא שולם after a successful click); the
    mark now lands the anchor on the first cycle strictly AFTER today.
  - Unmarking without this session's pre-mark memory used to revert the
    anchor to the settled row's due date, which for an advance-paid row is
    still ahead (chip stayed green); the revert now lands strictly behind
    today (one more cycle back when needed), and the settled row is found via
    the remembered mark → the latest paid base row → the computed previous
    cycle.
  Regression tests in `test/package-chip-cycle.test.js` /
  `test/month-paid-advances-billing.test.js` (stale-anchor mark lands after
  today; advance-paid unmark lands behind today; toggle gated on the package
  state); full suite 750 green.
- **Paid/due everywhere follows the billing CYCLE, not the calendar month.**
  After #94 the card chip still keyed "paid" to a calendar-month Payments row
  (`paymentForClientOn(currentMonthBaseDueDate)`), while packages are cycles
  (paid date → next billing date) — so every patient whose cycle straddles a
  month boundary (e.g. paid 31/8, גבייה הבאה 30/09) showed `לא שולם` while the
  banner correctly counted to 30/09. Single source of truth now: since #94
  `nextBillingDate` advances exactly when a payment is recorded, so **paid-up ⇔
  `nextBillingDate` non-blank and ≥ today** — new pure `packagePaidState(c,
  todayIso) → { paid, until }` in `public/charges-logic.js`, mirrored in
  `app.js` (keep-in-sync + parity test). On that rule:
  - **Chip**: paid → `שולם עד 30/09 ✓` (green, unmark), unpaid → `לא שולם ✓`
    (pink, mark); tooltips name the next collection / the advance.
  - **Chip mark** writes the CYCLE row — `cyclePaymentDueDate`: the stored
    `nextBillingDate` when past/today, else the current month's base due — the
    SAME row id חידוש ותשלום writes (parity-tested), then advances per the #94
    rule with `paymentDate = today`. **Unmark** reverts to the pre-mark values
    (the remembered rollback now also carries the settled row's due date;
    reload fallback = `prevCycleDueDateBefore`, the anchor un-advanced).
  - **Edit-modal propagation** reuses the same helper — one implementation,
    same cycle row, same advance.
  - **גבייה tab**: a client is due on X iff their `nextBillingDate` is X (not
    a billing-day calendar match); extras unchanged; the base row lookup then
    resolves to the cycle row and the day's totals follow. A note above the
    list says "לפי גבייה הבאה של כל מטופל". NOTE: the monthly summary (סיכום
    חודשי) still counts by calendar-month Payments rows — unchanged here.
  - **Card שולם ב** shows the payment date of the row covering the current
    cycle (the cycle one month before the advanced anchor).
  - **`renewalInfo`** keys "settled" on `packagePaidState` (same anchor the
    banner counts to — chip and banner can no longer disagree); the #94 grace
    window is kept. `getTreatmentPlans` / `getDebtStatus` contracts untouched.
  New `test/package-chip-cycle.test.js` (22 tests: the rule, the עידו/מנשה
  labels, chip↔renew↔edit row-id parity, mark/unmark round trip, the גבייה
  cycle listing + totals, wiring guards) plus lockstep updates to the #94
  suites; full suite 748 green.
- **One-off repair of stale `nextBillingDate` (dry-run + apply).** Many active
  clients' monthly payments were recorded with the card chip (חבילה: לא שולם ✓ —
  `setCurrentMonthPaid`), which writes the month's Payments row but never
  advances `Clients.nextBillingDate` (only חידוש ותשלום advances it), so on the
  1st of the month `renewalInfo()` saw a past stored date plus no current-month
  row and every such card turned red 🛑 עצור טיפול. New Code.gs repair: pure
  `_nextCycleDueDate` (billing day = `billingDay` else `startDate` day-of-month,
  clamped to the month's last day, rolled forward past today) +
  `_planStaleNextBillingRepair` classify every active client with a stale
  (non-blank, past) `nextBillingDate` into `fix` / `skippedOverdue` (an
  explicit unpaid/partial base row for the previous month keeps its red
  banner) / `skippedNoAnchor`. New INTERNAL POST action
  `repairStaleNextBilling` (same trust level as `savePayment`; the Node proxy
  forwards it verbatim): dry-run by default returns the plan and writes
  NOTHING; `apply: '1'` writes `nextBillingDate` cell-by-cell via the
  `_writeCreditsOwed` single-cell pattern under `LockService` — never
  `_writeAll`, no header change, every write `Logger.log`ged. Editor helpers
  `previewStaleNextBillingRepairNow()` / `applyStaleNextBillingRepairNow()`
  for the one-off run. Locked by `test/stale-next-billing-repair.test.js`
  (real-code extraction of the pure helpers, a vm sandbox asserting dry-run
  performs zero writes and apply writes exactly the planned cells, and
  source-scan guards incl. the frozen 34-column `CLIENTS_HEADERS`). Apps
  Script redeploys automatically via clasp CI on merge.

### Changed
- **Month-paid chip advances `nextBillingDate`; explicit month label; no false
  stop banner on the 1st.** Stops the stale-`nextBillingDate` recurrence at its
  source (the one-off repair above fixes the existing rows):
  - `setCurrentMonthPaid(c, true)` now ALSO advances the client:
    `nextBillingDate` → the next cycle due date AFTER the month being marked
    (`nextCycleDueDateAfter` — anchored on the due date, never the paid date)
    and `paymentDate` → today. Unmarking restores the pre-mark values
    (remembered per client for the session; post-reload fallback is the
    month's own due date). The client fields persist through the saveAll path
    only AFTER a fresh `loadAll`, so a stale tab never clear-and-rewrites
    Clients from old state; the payment row still goes through the single
    `savePayment` path with optimistic update + rollback.
  - The chip names the month it settles: `חבילה 09/2026: לא שולם ✓` /
    `חבילה 09/2026: שולם ↺` (month from `currentMonthBaseDueDate`); tooltips
    unchanged.
  - `renewalInfo`: when the current month's row is absent/unpaid, today is
    before the current-month due date, AND the previous month's base row is
    paid → `due_soon` counting to the current-month due date — never the false
    🛑 overdue a stale stored date used to produce on the 1st. Overdue stays
    reserved for an explicit unpaid/partial `paymentStatus` or a due date that
    already passed without a paid row.
  - **One month, not 30 days.** Every `nextBillingDate` write now uses the
    next-cycle rule (billing day, else the startDate day-of-month, clamped to
    the month's end — new `nextCycleDueDate` / `nextCycleDueDateAfter` in
    `public/charges-logic.js`, inline-mirrored in `public/app.js` and matching
    Code.gs `_nextCycleDueDate`, keep-in-sync comments + a realm parity test):
    renew-and-pay (billing-day-4 renewed on 30/08 → 04/10, not 29/09), direct
    intake and lead activation (keep the day-of-month), the agreement payment,
    and the legacy on-load derive (now anchored on the paid row's DUE date).
    The edit modal no longer recomputes `nextBillingDate` unconditionally —
    only a deliberately changed paid date with status paid re-anchors it, via
    the same rule.
  - Contracts untouched: `getTreatmentPlans`' `renewalDate` still reads the
    stored value; Payments row semantics, `getDebtStatus`, and the Clients
    headers are unchanged. New `test/month-paid-advances-billing.test.js`
    (+ updated derive/renew tests) lock all of the above; full suite 726 green.

### Testing / CI
- **LF line endings in the working tree too (`.gitattributes`).** Git for
  Windows ships `core.autocrlf=true` in its SYSTEM config, so every fresh
  clone on Windows checked each text file out with CRLF. The committed blobs
  were always LF — nothing was wrong in the repo — but the many tests that
  read a source file and match it with `\n`-anchored regexes then failed
  locally while passing in CI on Ubuntu: **39 false failures out of 877,
  across 18 test files**, reproduced on a fresh clone before the fix and gone
  after it. New `.gitattributes` with `* text=auto eol=lf` — `eol=lf` is the
  half that matters, overriding `core.autocrlf` for this repo so a Windows
  checkout matches what CI sees. **No content churn:** all 200 tracked blobs
  were already LF (196 text + 4 binary), so the commit adds files and
  renormalises nothing. `text=auto` still auto-detects binary, leaving the
  three PWA icons and `test/session-who-when.test.js` (NUL bytes in a
  control-character fixture) byte-for-byte alone. Same fix as
  `ezone-helpdesk` PR #30. New `test/line-endings.test.js` (6) guards both
  directions: the rule still exists and still says `eol=lf`, no tracked blob
  or working-tree text file carries CRLF, binaries stay auto-detected, and
  the `\n`-anchored source reads that used to break still hold.
  Suite 877 → 883.
- **Automated test CI + coverage for the priority modules.** Added
  `.github/workflows/test.yml` — runs `npm ci && npm test` (Node 22, the
  built-in `node --test` runner) on **every pull request and every push to
  `main`**, with a `concurrency` group so re-pushes cancel superseded runs.
  New tests, all offline (no live Apps Script call; `global.fetch` stubbed and
  Code.gs logic mirrored; dummy secrets only): `test/winback-source.test.js`
  (the shared-secret `getWinbackSource` endpoint — `_winbackAuthOk` fail-closed
  on a configured secret / open when unset, plus the lost-lead + discharged
  projection, with the doGet/doPost caller mocked), `test/server-routes.test.js`
  (`/healthz`, `/api/debug/env` no-leak, and the `/api/verify-pin` auth gate:
  200 / 401 / 429 rate-limit), and `test/server-fail-closed.test.js`
  (`/api/sheets` and `/api/continuation-roster` return 500 fail-closed and never
  reach upstream when their env is unset; `/api/verify-pin` rejects when
  `APP_PIN` is unset). Suite: 521 → 538 tests. See `CHANGELOG-billing-test-automation.md`.

### Docs
- README: added a **Testing** section (how to run the suite, the offline/mock
  guarantee, coverage highlights, and the CI trigger).
- clasp CI rollout marked COMPLETE (verified 22/07/2026). `EZONE-ECOSYSTEM-STATUS.md` updated to the July 22 version — new "Apps Script deployment" section (automatic via GitHub Actions, clasp 3.3.0, hardened; trigger = merge to the deployed branch `claude/youthful-volta-laarnk` touching `apps-script/**`; redeploys the EXISTING deployment so the `/exec` URL is unchanged; per-repo secrets `CLASPRC_JSON` + `DEPLOYMENT_ID`; token-refresh = `clasp login` → update `CLASPRC_JSON` in all six repos with the same value), a per-app deployed-branch table verified 22/07/2026, and ezone-kitchen + ezone-coordinators added to the app table. All manual copy-paste redeploy instructions marked OBSOLETE (superseded by clasp CI; emergency fallback only), in the doc and `DEPLOY.md`.
- CI: bumped `actions/checkout` and `actions/setup-node` to **v5** in the Deploy Apps Script workflow, clearing the Node 20 deprecation warning (both v5 run on Node 24; clasp `node-version` pin stays `22`).

### Housekeeping
- **Stale `claude/*` branch audit + cleanup.** `2026-07-04` — audited every
  remote `claude/*` branch against the canonical production branch
  `claude/youthful-volta-laarnk` using `git log volta..<branch> --no-merges`.
  **24 branches** carry zero unique non-merge commits (fully contained in volta,
  safe to delete): `adoring-lamport-bbnb5p`, `amazing-darwin-8y5zh4`,
  `dazzling-knuth-39fk3j`, `deactivate-client-receiver`, `dreamy-clarke-eu1xp2`,
  `dup-clients-and-pick`, `epic-pascal-7ea5of`, `ezone-billing-fixes-round2`,
  `ezone-card-charge-mark-paid`, `ezone-patient-card-redesign`,
  `ezone-payment-renewal-bugs-wd1xo7`, `ezone-role-badge-remove`,
  `festive-mccarthy-4w5cft`, `funny-mendel-9o68mu`, `happy-meitner-qjpnj9`,
  `lead-assignee`, `loving-fermi-70yplo`, `merge-dup-clients`, `nice-edison-5bvwiz`,
  `quirky-mccarthy-vJ1Td`, `server-side-pin-verification-0vt8b0`,
  `session-credits-eu1xp2`, `stopflag-phone-match`, `wizardly-brahmagupta-5eddut`.
  **17 branches** still carry unique non-merge commits (mostly squash-merge
  duplicates now living on volta under different SHAs) and were **preserved, not
  deleted**, per the audit rule: `add-psychiatric-service-fyqjF`,
  `billing-day-picker`, `clinical-treatment-type-receiver`,
  `compassionate-ramanujan-mkgzt9`, `festive-allen-hb1tbt`, `loving-davinci-9l9ask`,
  `magical-ptolemy-LPUx2`, `magical-ramanujan-zsum4p`, `patients-mark-paid-toggle`,
  `practical-goodall-x93nou`, `quirky-franklin-vm5mkm`, `relaxed-cray-l84qqb`,
  `remove-responsible-person`, `serene-hawking-b6hx4j`, `therapist-pay-table`,
  `vibrant-shannon-h3qsb4`, `zealous-cray-O7NbR`. **Protected (kept regardless):**
  `claude/youthful-volta-laarnk` (canonical) and `claude/ezone-outpatient-dashboard-hKjf9`
  (grace period). `feature/*` branches were out of scope and left untouched. The
  24 deletions could not be executed from the automation sandbox (egress policy
  denies delete-pushes with 403); they must be run manually.

### Changed
- **Topbar header rebrand.** `2026-07-27` — dropped the "E-ZONE" text from the
  topbar logo; the header now shows the app's existing emblem (manifest icon
  `icon-v1-192.png`, 30px desktop / 28px mobile) next to the Hebrew name
  **"טיפולי חוץ"**. Cosmetic only — icon and colours unchanged, RTL-correct,
  no-wrap. Guarded by `test/header-branding.test.js`. See
  `CHANGELOG-header-ezone-removal.md`.
- **Unified the two diverged production lines (volta + dashboard).** `2026-07-04`
  — the live `claude/youthful-volta-laarnk` line (payouts) and the
  `claude/ezone-outpatient-dashboard-hKjf9` line (~26 orphaned feature commits,
  June 28–July 1) were merged into one. Payout/rates code (therapist pay &
  payout view, `_recordSessionOutcome`, `_writeCreditsOwed`, `renderPayouts`,
  parallel `loadAll`) stays on the live volta implementation; the following
  dashboard features are restored on top: `createLead` inbound endpoint with
  fail-closed auth, `LockService` around `_saveAll`, persisted
  `paymentStatus` / `paymentDate` / `nextBillingDate` columns, editable/backdated
  payment date, renewal anchored on the stored `nextBillingDate`, card
  extra-charge paid/unpaid toggle, optimistic patient saves, urgency sort of the
  מטופלים cards, the patient-card two-panel redesign + tint tokens, the סניף
  location dropdown + source-of-truth, session frequency unit (שבוע/חודש), the
  מעקב פסיכיאטרי /חודש fix, extra-charges inside the treatment panel, and the
  removed role badge. `CLIENTS_HEADERS` unifies both schemas **append-only**:
  volta's exact live column order is preserved verbatim and the three dashboard
  columns (`paymentStatus`, `paymentDate`, `nextBillingDate`) are appended at the
  END, after `assignedTo`. Because `_readAll`/`_writeAll` are positional and
  `_ensureSheet` does not migrate, appending (rather than reordering) means the
  live Clients sheet needs **no migration** — existing rows read the three new
  columns back blank until their next save. No deploy blocker.

### Added
- **`deactivateClient` cross-app receiver (delete-propagation).** A new
  fail-closed, shared-secret POST action on the Apps Script web app
  (`apps-script/Code.gs`) that pairs with the E-Zone Therapists delete-propagation
  sender (ezone-therapists PR #24, `_postDeactivateClient`): when a patient is
  **deleted in the therapists app**, it POSTs `{ action:'deactivateClient', secret,
  phone }` here so the patient stops appearing in outpatient's roster (the
  therapists roster unions `getTreatmentPlans` / `getDebtStatus` as base sources,
  so a still-active outpatient Client would be re-added). Gated by a **dedicated,
  new `DEACTIVATE_CLIENT_SECRET`** Script Property — **fail-closed**
  (unset/empty/mismatched rejects), and deliberately **its own secret, NOT reused
  from `STOP_FLAG_SECRET`** (least authority; the sender provisions the same value
  on both Apps Scripts). **Deactivate, not hard-delete** (reversible — the row plus
  billing/session history are preserved): every Client matching the **canonical
  phone** (`_recoverPhone`, leading-zero recovered, across `phone` /
  `treatmentContactPhone` / `payerPhone`) has its `status` set to a new dedicated
  value **`לא פעיל`** (`DEACTIVATED_CLIENT_STATUS_HE`), which `_getTreatmentPlans`
  and `_getDebtStatus` now **exclude** — so the patient leaves the roster union.
  This status is **distinct from `סיים טיפול`** (Vered's manual discharge), which
  is still included in `getDebtStatus` (**debt survives discharge**) and the
  win-back list — only the explicit deactivation status is dropped. **Orphan-safe:**
  no match → `{ ok:true, deactivated:0 }` (a successful no-op, never a crash, so the
  sender's local delete still proceeds); idempotent (an already-deactivated row is
  skipped). Returns `{ ok:true, deactivated:N }`. Matches by canonical phone alone
  (mirrors `_resolveStopFlagByPhone`); **no `server.js` / Railway change** (Apps
  Script → Apps Script). `test/deactivate-client.test.js` (16 cases) parses
  `CLIENTS_HEADERS` + the status value out of Code.gs and locks the sender contract,
  fail-closed dedicated-secret auth, phone + dropped-leading-zero matching,
  orphan-safety, idempotency, and exclusion from **both** projections (discharged
  clients NOT excluded). **Requires an Apps Script redeploy + a new
  `DEACTIVATE_CLIENT_SECRET` Script Property (same value on both Apps Scripts).**
  See `CHANGELOG-deactivate-client.md`.
- **Therapist-payout steps 2–4 — correct, Excel export, mark-forwarded
  (`public/therapist-payout.js`, `public/payout-export.js`, `public/app.js`,
  `public/index.html`, `apps-script/Code.gs`).** The תשלומי מטפלים screen grows
  from read-only into מורן's full monthly payout workflow.
  **(1) Correct** — מורן can fix a logged session's outcome
  (`happened ↔ therapist_cancelled ↔ patient_no_show`) or add a session that was
  never logged, from a single modal. Both POST the internal (no-secret)
  `correctSessionOutcome` action into the **existing `_recordSessionOutcome`
  rules engine**: pay + credit are **recomputed** and the prior effect reversed
  (upsert by `sessionId`); a new id appends. **No raw amount override** — the
  server prices every correction from the rate/billing tables.
  **(2) Excel export** — the **ייצוא לאקסל** button downloads a UTF-8-BOM CSV
  (Excel-native) of the selected month: per-therapist rows (name, paid session
  count, pre-VAT, VAT, total incl VAT), a totals row, and a **הפרשים** section
  for late prior-month sessions. Built by the new pure `PayoutExport` module from
  the same on-screen summary.
  **(3) Mark-forwarded** — a per-therapist **הועבר לחשבת שכר** button stamps every
  that-therapist/that-month `SessionLog` row with a new append-only
  `forwardedToPayroll = 'YYYY-MM'` column (via the internal `markForwarded`
  action / `_markForwarded`). Forwarded rows drop out of the view permanently;
  forwarding is **per-therapist independent**. A session logged **late** for an
  already-forwarded month surfaces as a **הפרש** in the next cycle until מורן
  forwards that month again. **Requires an Apps Script redeploy** (new
  `forwardedToPayroll` column + `correctSessionOutcome` / `markForwarded`
  actions). `test/payout-forwarding.test.js` (12), `test/payout-export.test.js`
  (7), plus the add-session + header coverage extended in
  `test/session-outcome.test.js`. See `CHANGELOG-payout-correct-export-forward.md`.

### Fixed
- **Patient phone now shows on OUT client cards + is editable (`public/app.js`,
  `public/index.html`).** Active client cards previously displayed **no phone**
  even though the `phone` column was populated by the create / activate flows —
  the card render had no phone line at all, and the edit modal read/wrote only
  the **legacy `treatmentContactPhone`** field (usually empty for active
  clients). Now a `clientPhone(c)` helper resolves the patient's number as
  …8055 tokens truncated…that
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

## 2026-07-04 — Payout follow-ups (visibility, unknown therapists, save speed)

### Fixed
- **Invisible headings**: תשלומי מטפלים and שימור לידים headings used `#1a2e4a`
  (dark navy) on the dark theme — now `#9fcfcf`.
- **unknown_therapist on valid therapists**: pay rates were hardcoded maps — any
  therapist not listed (or spelled differently than in ezone-therapists) was
  rejected. Rates now live in a **TherapistRates sheet** (auto-seeded from the
  constants on first run; columns: name / flatRate / intakeRate / followupRate).
  Add a therapist = add a row; no redeploy. Cached 120s (edits apply ≤2 min).
  Unknown names still fail closed — a pay rate is never invented.
- **Slow save**: `_recordSessionOutcome` rewrote the whole Clients sheet to
  persist one credit balance — now a single-cell write (`_writeCreditsOwed`).

### Tests
- `test/payout-followups.test.js` (7 source-guard tests).

### Deploy
- Frontend: Railway auto-deploy on commit to this branch; hard-refresh.
- **Apps Script: manual redeploy required** (paste Code.gs → Save → new version
  of the EXISTING deployment). The TherapistRates sheet is created and seeded on
  the next recorded session — then add missing therapists' rows.

## 2026-07-04 — Load-time fix

### Fixed
- **Slow app load**: `loadAll` made six SERIAL Apps Script round-trips (main
  data, payments, charges, stop-flags, extra-requests, settings) — 6–18s worst
  case. Now fired in parallel via `Promise.all`; total load equals the slowest
  single call. Same failure semantics (non-critical reads fall back to empty;
  only the main load is fatal).

### Tests
- Source guard in `test/payout-followups.test.js`: loadAll must stay parallel.
- **Invisible headings**: the תשלומי מטפלים and שימור לידים tab headings used
  `#1a2e4a` (dark navy) on the dark theme — now `#9fcfcf` (established light accent).
- **Credit engine silently no-oping**: `creditsOwed` was missing from
  `CLIENTS_HEADERS` on this branch (port defect vs the source branch), so the
  session-quota credit balance was never persisted. Column restored (append-only,
  schema guard updated); `_ensureSheet` self-heals the header row on first touch.
- **unknown_therapist on valid therapists**: pay rates were a hardcoded 16-name
  map — any therapist not listed (or spelled differently than in ezone-therapists)
  was rejected. Rates now live in a **TherapistRates sheet** (auto-seeded from the
  old constants on first run, columns: name / flatRate / intakeRate / followupRate).
  Add a therapist = add a row; no redeploy. Cached 120s, so edits apply within
  ~2 minutes. Unknown names still fail closed — a pay rate is never invented.
- **Slow save**: `_recordSessionOutcome` rewrote the entire Clients sheet to
  persist one credit balance. Now a single-cell write (`_writeCreditsOwed`,
  id-column scan like the SessionLog upsert).

### Tests
- `test/payout-followups.test.js` (7 source-guard tests, create-lead pattern).
- Schema guard in `test/stop-flag-match.test.js` extended for the appended column.

### Deploy notes
- Frontend: Railway auto-deploy on commit; hard-refresh.
- **Apps Script: manual redeploy required** (paste Code.gs → Save → new version of
  the EXISTING deployment). On the next recorded session the TherapistRates sheet
  is created and seeded automatically — then add the missing therapists' rows.
