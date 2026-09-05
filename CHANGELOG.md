# Changelog

All notable changes to the E-ZONE Outpatient Dashboard are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
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
  `recoverPhone(phone) || recoverPhone(treatmentContactPhone)` (leading-zero
  recovery applied, so a Sheets-coerced 9-digit number shows the full canonical
  10-digit form), the client card renders a **טלפון** line, and the edit modal
  gained a **טלפון מטופל** field that reads and writes `phone`. The
  `treatmentContactPhone` field stays intact and separately editable (it remains
  the WhatsApp / cross-app matching key), and both identity phones are still
  deduped on save. `phone` was already serialized in `clientForSheet`, so this is
  **frontend-only — no Apps Script redeploy required** (Railway auto-deploys on
  merge). `test/patient-phone-display.test.js` (7) locks display, fallback,
  leading-zero recovery, and the edit round-trip.

### Added
- **Vered dashboard alerts — credit owed + renewal due (`public/vered-alerts.js`,
  `public/app.js`, `public/index.html`).** Two display-only OUT-dashboard
  notices on the existing panel pattern. **(a) Credit alert**
  (`🎟️ קרדיט מפגשים להשלמה`) lists **active** patients with `creditsOwed > 0`
  (name + count) so Vered knows a make-up is owed — previously visible only on
  the individual patient card. **(b) Renewal alert**: the existing
  `⏰ חידושים השבוע` banner's 7-day window is now the named constant
  **`RENEWAL_WINDOW_DAYS = 7`** (no duplicate list). The **treatment-month end**
  date is the renewal anchor + 1 month, anchor = `paymentDate` (last payment)
  else `startDate`; a patient with **no cycle date** is **flagged, not crashed**.
  Pure logic lives in `public/vered-alerts.js` (UMD, same pattern as
  `charges-logic.js`; `app.js` keeps an inline mirror). **Frontend-only — no
  Apps Script redeploy required** (Railway auto-deploys on merge).
  `test/vered-alerts.test.js` (10) locks the credit filter, the 7-day window
  edges, and graceful no-cycle-date handling. See `CHANGELOG-vered-alerts.md`.
- **Session accounting + credits (auto-draw) — `Clients.creditsOwed` +
  `SessionLog.creditStatus`.** A per-patient monthly **credit ledger** in
  `apps-script/Code.gs`'s `recordSessionOutcome`: a `therapist_cancelled` session
  banks **+1 credit**; a `happened` session **beyond the monthly quota** (weekly
  frequency × 4, from the plan's `sessionsPerWeek`) **auto-draws** a credit when
  one is available — that session becomes **free to the patient**
  (`clientSessionValue` 0) while the **therapist is still paid normally**. Credits
  **carry forward** across months; the delivered count is recounted per month by
  **session date**. Because the balance is a stateful running total, the
  sessionId upsert **reverses the prior row's credit effect before applying the
  new one**, so a correction (e.g. happened→cancelled undoes a draw *and* adds a
  credit) is exact and an identical re-send is idempotent. No plan frequency / no
  date → **no draw, row flagged** (`quota_unknown`); group/0-value sessions never
  waste a credit. The balance is **server-managed**: `_saveAll` preserves
  `creditsOwed` by id (ignoring a stale dashboard value) so a save can't revert
  earned credits. Both columns are **append-only** (positions preserved). The
  patient card shows **קרדיט מפגשים: N**. `test/session-credits.test.js` (16)
  locks the model + a source-scan guard; existing "last column" guards updated.
  **Requires an Apps Script redeploy** (`…FOwWYIw`). See
  `CHANGELOG-session-credits.md`.
- **"מחק" dismiss button on Vered's stop-flags panel (`public/app.js`).** Every
  row of **"⏳ המתנה לאישור הפסקה"** now has an editor-only, confirm-guarded
  dismiss control that clears the flag **without discharging** — the only action
  for an **orphaned** flag showing **"לא נמצא מטופל תואם"** (no matching client,
  e.g. a made-up test phone like `0782374928`), which previously had no exit.
  `dismissStopFlag` optimistically marks the flag `resolved` (so the row drops
  from the `pending` filter immediately) and persists via the **existing
  internal** `resolveStopFlag` action **by id** — which works for orphans (they
  have an id, just no `clientId`) and is **already deployed**, so this is
  **frontend-only, no Apps Script redeploy required** (Railway auto-deploys on
  merge). A failed write rolls the row back. `Clients` is never touched. The
  secured **phone**-based receiver (PR #37) remains the cross-app *therapists*
  path. `test/stop-flag-dismiss.test.js` locks matched + orphaned dismiss, the
  empty-panel case, no-op on unknown id, rollback, and the by-id wiring guard.
  See `CHANGELOG-stop-flag-dismiss.md`.
- **Secured `resolveStopFlag` receiver — the therapists app can clear a flag by
  phone.** Complements `flagStop` (raise) with a matching **resolve** over the
  same fail-closed contract: `{ action:'resolveStopFlag', secret, phone }` reuses
  the existing `STOP_FLAG_SECRET` (unset/empty/wrong → `unauthorized`), so the
  therapists app can withdraw a stop-treatment flag when the patient resumes. It
  matches `StopFlags` rows by **canonical phone ALONE — no `Clients` join** (using
  `_recoverPhone`, so a Sheets-dropped leading zero still matches), which lets it
  clear **orphaned** flags (e.g. `יעל`) whose `clientId` is blank. Marks every
  still-pending matching row `status='resolved'` (+ `resolvedBy`/`resolvedAt`),
  returns `{ ok:true, resolved:N }` (N=0 is a successful no-match), and is
  idempotent on retry. `doPost` routes by the presence of a `secret`, so the
  **internal** id-based `resolveStopFlag(id)` (Vered's dashboard, on discharge)
  is unchanged. Mirrors `_flagStop` (script lock, `_ensureSheet`, positional
  writes); `Clients` is never touched. `test/resolve-stop-flag.test.js` locks
  phone resolve, orphaned-flag resolve, dropped-leading-zero match, fail-closed
  auth, invalid phone, no-match→0, and idempotency. **Requires an Apps Script
  redeploy** (`…FOwWYIw`) for the new path. See
  `CHANGELOG-resolve-stop-flag-receiver.md`.
- **Therapist-payout read view (step 1 of 4) — `public/therapist-payout.js` +
  תשלומי מטפלים tab.** A **read-only** per-therapist monthly payout summary
  computed from the `SessionLog` tab. A pure module
  `monthlyPayoutSummary(rows, 'YYYY-MM')` groups rows by therapist for the
  selected month (filtered on the **session `date`**, not `recordedAt`), sums the
  pay for outcomes that pay — `happened` + `patient_no_show` — into a **pre-VAT**
  total, derives the **+VAT** total via `TherapistPay.withVat` (0.18), and surfaces
  the **excluded** `therapist_cancelled` count (pay 0) plus a per-session
  breakdown (date, patient, type, outcome, pay). A new **open** `getSessionLog`
  read action in `apps-script/Code.gs` (same trust level as `getPayments`;
  forwarded transparently by the Node proxy, no server change) feeds a new Hebrew
  RTL dark-theme tab with a month picker (defaults to current month), KPI strip,
  and expandable per-therapist cards. **Display only** — no corrections, export,
  or forward-marking (steps 2–4). `test/therapist-payout.test.js` locks the sum
  rule, grouping, session-date filter, pre-VAT and +VAT totals, mixed outcomes, and
  empty-month safety. **Requires an Apps Script redeploy** (`…FOwWYIw`) for the
  new read action. See `CHANGELOG-therapist-payout-view.md`.

### Changed
- **Replaced the therapist pay roster with the final list** (from the therapists
  app's Therapists tab; names match character-for-character). `FLAT_RATES` in
  `public/therapist-pay.js` and its `THERAPIST_FLAT_RATES` mirror in
  `apps-script/Code.gs` are now **16 therapists** (₪180–₪250: thirteen at ₪250,
  דליה מלמד ₪230, נועה זיפמן ₪210, אסתר ₪180); `PSYCHIATRIST_RATES` is now **3**
  (ד″ר שפרינץ, ד″ר נטליה, ד″ר דנגור — אינטייק ₪900 / מעקב פסיכיאטרי ₪700). All
  earlier names not on the final list were removed from both the module and the
  mirror. `test/therapist-pay.test.js` and the `Code.gs` sync-guard in
  `test/session-outcome.test.js` were updated to the new roster and stay green
  (each flat name returns its rate, the 3 doctors return 900/700 by type and
  require a valid type, unknown therapist throws, completeness guard passes).
  Because the `Code.gs` mirror changed, this **requires an Apps Script redeploy**
  (`…FOwWYIw`). See `CHANGELOG-therapist-pay-table.md`.
- **Priced the two open billing types in `public/treatment-map.js`.** `קבוצה` →
  **₪0** (**intentionally free** — bundled inside larger packages; a *decided*
  price of zero, **not** `null`) and `טיפול משפחתי` → **₪600 / session**. Both
  previously returned `null` (`PRICE_FLAG_PER_CLIENT`) to flag "set per client".
  A comment now distinguishes `0` (free, decided) from `null` (undecided).
  `PRICE_FLAG_PER_CLIENT` is **kept** as the sentinel for any genuinely-undecided
  type — but after this change **no** billing type is flagged `null`. No other
  price and no map structure changed. The **Code.gs mirror carries only the
  clinical→billing name map, not prices**, so it is **unchanged** and **no Apps
  Script redeploy is required**; the mirror sync-guard
  (`test/clinical-derive.test.js`) compares names only and stays green.
  `test/treatment-map.test.js` updated (`billingPrice('קבוצה')===0`,
  `billingPrice('טיפול משפחתי')===600`, plus a "no null prices remain" guard).
  See `CHANGELOG-clinical-billing-map.md`.

### Added
- **Session-outcome receiver + pay/value compute (task 4.8-step3-out).** A new
  fail-closed, shared-secret POST action on the Apps Script web app
  (`apps-script/Code.gs`): the E-Zone Therapists app reports a session outcome and
  the receiver computes the **therapist pay** + **client session value**, then logs
  one reconciliation row to a new **`SessionLog`** tab, **upserted by `sessionId`**
  (a corrected outcome re-sent with the same id overwrites the row and recomputes
  pay — never a duplicate, never stale pay). `POST /exec { action:
  'recordSessionOutcome', secret, sessionId, phone, therapist,
  clinicalTreatmentType, date, outcome }`, gated by a new `SESSION_OUTCOME_SECRET`
  Script Property — **fail-closed** (unset/empty/mismatched secret rejects), same
  model as `flagStop`/`setClinicalType`, **not** the fail-open read pattern.
  `outcome ∈ happened | therapist_cancelled | patient_no_show` (any other value
  rejects, writes nothing). Pay: `happened`/`patient_no_show` → therapist showed
  up, **paid** (`_therapistPay`); `therapist_cancelled` → **0** (never delivered);
  `קבוצה` (group) → **0** pay and **0** value. `sessionStatus`:
  `consumed`/`credited`/`forfeited`. `clientSessionValue` = `_billingPrice(billing,
  freq?)`; `ליווי יומי בקהילה` with no frequency in the event stores **null**
  (flagged, never guessed — distinct from a real `0`). Unknown clinical type /
  unknown outcome / (for paid non-group outcomes) unknown therapist all **write
  nothing**. The log is keyed by session, so it always writes regardless of client
  match (`matchStatus` = matched/no_match/multi_match; a single phone hit fills
  `clientId`+`patientName`). **Clients is never modified.** Pay rates and billing
  prices are now **mirrored server-side** (`THERAPIST_FLAT_RATES` /
  `PSYCHIATRIST_RATES` / `BILLING_PRICES` / `DAY_CENTER_MONTHLY_BY_FREQ`), each with
  a parse-and-deep-equal **sync-guard** in `test/session-outcome.test.js` so they
  can't drift from `public/therapist-pay.js` / `public/treatment-map.js` (same
  discipline as the clinical-map mirror). **Receiver + compute only — no
  therapists-side sender** (next task). See `CHANGELOG-session-outcome.md`.
  **Requires an Apps Script redeploy + a new `SESSION_OUTCOME_SECRET` Script
  Property.**
- **Secured `setClinicalType` write endpoint (task 4.5b).** A new fail-closed,
  shared-secret, phone-matched POST action on the Apps Script web app
  (`apps-script/Code.gs`): the E-Zone Therapists app can set a patient's clinical
  treatment type on the outpatient client. `POST /exec { action:'setClinicalType',
  secret, phone, clinicalTreatmentType }`, gated by a new `CLINICAL_TYPE_SECRET`
  Script Property — **fail-closed** (unset/empty/mismatched secret rejects), the
  same model as `flagStop`, NOT the fail-open read pattern. Matches a client by
  canonical phone (reusing `_recoverPhone`, across `phone` /
  `treatmentContactPhone` / `payerPhone`). **Never fail-open, never guess:** a
  single match sets `clinicalTreatmentType` and derives + overwrites `serviceType`
  via the **existing** `_clinicalToBilling` / `_deriveClientServiceType` map from
  4.5a (no duplicated map), writes the row, returns `{ ok:true, matched:1 }`; no
  match → `{ ok:false, reason:'no_match' }`, multiple → `{ ok:false,
  reason:'multi_match' }`, unknown clinical type → `{ ok:false,
  reason:'unknown_type' }` — all three **write nothing**. Only the two fields
  change on the matched row; positional column mapping is preserved.
  `test/set-clinical-type.test.js` locks fail-closed auth, single-match
  write+derive (incl. the `פרטני כללי→פרטני` and `ליווי יומי בקהילה` renames and a
  newly-billable type), no-match/multi-match/unknown-type write-nothing, and
  positional safety on a legacy row. **Requires an Apps Script redeploy and the
  `CLINICAL_TYPE_SECRET` Script Property.** See `CHANGELOG-set-clinical-type.md`.

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
- **Payout modules were committed to wrong nested paths — payouts tab failed
  with "מודול החישוב לא נטען" (calculation module not loaded).** `2026-07-04` —
  `therapist-payout.js` and `payout-export.js` had landed under
  `public/public/…` (and duplicate copies under `apps-script/public/…`), so the
  `<script>` tags in `public/index.html` (which reference them at the `public/`
  root) 404'd and `window.TherapistPayout` never defined. Moved both modules to
  `public/therapist-payout.js` and `public/payout-export.js`, moved
  `therapist-pay.test.js` back to `test/`, restored the missing
  `test/payout-export.test.js` (6 cases), and deleted the stray duplicate copies
  and now-empty nested `public/` / `apps-script/public/` folders. Full payout
  suite green again: `test/therapist-pay.test.js` (12),
  `test/therapist-payout.test.js` (9), `test/payout-export.test.js` (6) — 27
  passing. No changes to `apps-script/Code.gs`.
- **Orphaned "additional treatment" charges from deleted patients.** Charge
  rows (`ClientCharges`, keyed by `clientId`) survived patient deletion as
  orphans and leaked into the dashboard. Two-layer fix: (1) display-time
  `excludeOrphanCharges(charges, clients)` hides any charge whose `clientId` no
  longer matches a live patient — applied right after charges load in
  `loadAll`, so pre-existing orphans (the test patients on `0543123270`) vanish
  immediately; (2) root cause — the permanent-delete (`✕`) flow now prunes the
  patient's charges locally and calls the new backend bulk action
  `removeChargesForClient(clientId)` (`_removeChargesForClient` in
  `apps-script/Code.gs`, one round-trip, idempotent, logs each removed row), so
  no new orphans are ever created. Pure helper mirrored in
  `public/charges-logic.js` ↔ inline copy in `public/app.js`.
  `test/charge-orphans.test.js`. **Apps Script redeploy required** (see below).

### Added
- **Editable patient phone in the edit-client modal + on the card.** The
  patient's own `phone` is now shown as a chip on each client card (`📞 …`) and
  is editable via a new **"טלפון מטופל"** field in `#editClientModal`, validated
  as a strict 10-digit leading-zero mobile through the shared `acceptPhone`
  guard. Read-side normalization (leading-zero recovery on the Sheets
  stripped-zero case) was already in place via `recoverPhone` /
  `backfillClientPhones`. `public/index.html`, `public/app.js`.

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
- **Clinical-treatment-type receiver (`clinicalTreatmentType` + on-save derive).**
  New `clinicalTreatmentType` column on the Clients sheet (Apps Script
  `Code.gs`, **appended LAST** after `phone`, append-only so existing rows are
  untouched and positional mapping is preserved). On save, `_saveAll` runs each
  client's `clinicalTreatmentType` through a clinical→billing map
  (`_clinicalToBilling`, an inline **mirror** of `public/treatment-map.js`) and
  **overwrites `serviceType`** — clinical is the source of truth. Absent/empty
  clinical leaves `serviceType` untouched (back-compat for legacy / not-yet-
  migrated rows); an **unknown** clinical value **throws** rather than silently
  blanking. `public/app.js` preserves the field through `normalizeClientFromSheet`
  / `clientForSheet` (data-layer passthrough only — **no form control, no
  therapists-side sender** in this step). `test/clinical-derive.test.js` parses
  the Code.gs map + headers and locks: every clinical value derives correctly
  (incl. the 2 renames and the 5 newly-billable types), the mirror deep-equals
  `treatment-map.js`, empty leaves serviceType, unknown throws, and the column
  is last with `phone` intact. **Requires an Apps Script redeploy.** See
  `CHANGELOG-clinical-treatment-type-receiver.md`.
- **Therapist pay table module (`public/therapist-pay.js`).** A standalone,
  hardcoded source of truth for the **pay** side — what E-ZONE pays each
  therapist per session (counterpart to `treatment-map.js`, the billing side).
  All rates are **pre-VAT**: the table stores raw numbers and `therapistPay()`
  returns them untouched; VAT is added at payment time via a separate
  `withVat(amount, rate=0.18)` helper, never inside `therapistPay`. Two
  structures: (1) **flat per-session keyed per therapist** — the rate follows
  the individual, not a grade, so two grade-A therapists differ (מעיין דלומי
  ₪250 vs דליה מלמד ₪230); 15 therapists from ₪180–₪250. (2) **psychiatrists
  pay by type** — ד″ר שפרינץ / ד″ר דנגור: אינטייק ₪900, מעקב פסיכיאטרי ₪700, so
  a psychiatrist lookup requires a valid treatment type (throws otherwise).
  `therapistPay(name, treatmentType?)` throws on an unknown therapist.
  `test/therapist-pay.test.js` (12 cases) locks every rate, per-person (not
  per-grade) pricing, the psychiatrist by-type rule, VAT staying out, and a
  loud completeness guard. **Not wired** anywhere — module + tests only. See
  `CHANGELOG-therapist-pay-table.md`.
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
