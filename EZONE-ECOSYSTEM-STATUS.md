# Outpatient current handoff — 2026-10-20

Latest Git base: `8b68cd7547d394a00483da51a11cab086be62eca`, SW18 assets,
branch `claude/youthful-volta-laarnk` (#127/#128/#129 now merged). Last direct
live check this morning was Node f7b37d7 / SW15 and Apps Script @99
(run 39298379832); refresh live evidence before release. #121/#123/#122/#126
remain released. Therapists #105 merged to d38d85b1 and #107 advanced its deploy
branch to a8a1afbc. Merges alone do not prove the latest live package flow.
Never push merged branches or repeat releases. Source deployment remains an
explicit dispatch AFTER matching healthy Node, with the approved full merge SHA.
Historical all-app automatic-deploy text never overrides this repo's DEPLOY.md.

Codex owns isolated OP-03 issue #124 implementation, branch
`codex/op03-operational-backup-20261019`. The prior eight-table nightly set loses
session replay identity/payroll state and custom rates on whole-workbook recovery.
Candidate extends the set and adds inventory, validation and recovery hold.
See docs/operational-recovery.md. It is not deployed. Unknown/manual tabs,
real Google round-trip with nonempty journal/session data, scheduled evidence,
independent review and separate final production approval remain open.

OP-03 now integrates base 8b68cd75, retaining #122/#126 and the newer sign-in,
calculator and favicon work. The production source logic is unchanged from
PR125 head29195b24; public assets exactly match the latest base. Its registry retains
both package datasets; the package lock rechecks recovery hold after acquisition.
A real catalog + approved request survives manifest-checked local restore and
an exact submission retry without another row. The full integrated UTC suite
passes 1,640 tests with 37 skipped (1,677 total), including sixteen failure-path
and coordination regressions added after Claude's bounded static reviews. Removing the new package-lock
check makes both queued-writer regressions fail. Google execution is separate. A reproduced capture/recovery overlap is now gated
by a whole-run backup marker admitted under ScriptLock. Begin reports draining;
finish refuses until all old-job writes complete. Interrupted-run markers stay
fail-closed for operator investigation, without automatic expiry.

Read-only source inspection Oct 20: Sheet1 has no cell values/formulas in its
entire 1,000 x 26 grid. Copy of Clients has 21 unique-id rows and 33 headers;
all 21 ids exist in Clients, but values were not equated. It is retained as a
historical archive, never merged into Clients. No source cell was changed.
The private full safety copy of Oct20 has20 tabs including packages; the Oct19
copy is historical. Neither proves restoration. Unknown-tab recovery stays
blocked pending review. The phased synthetic Google drill is prepared at
docs/google-operational-drill.md; seven local service-double tests pass. An
authorized isolated Apps Script runtime is still needed; no native run is claimed.

Keep FinancialOps history/marker and both operation kinds. Never roll source
back to 97. Remaining OP-02b2 intake/activation/edit-paid/month toggles and
existing negative-timezone date-helper drift stay open; OP-04 latency/journal
scans, OP-05 queues/bank/document controls, OP-06 delivery and legacy
recordTreatmentGiven remain. CRM Outpatient #114 / Dashboard #220 are unchanged.

Ten-app order: Outpatient → Therapists → Staffing → Coordinators → Dashboard →
Managers → Logistics → Kitchen → Hadrachot → Helpdesk. For each cover structure,
workflow, logic, missing information/features, privacy, integrity/recovery,
backup, speed and controls. One implementation owner; Claude review where
available, with exact commit and executed/static evidence distinguished. No
subscriptions, check-ins or unapproved production release.

## Outpatient: packages and pricing access (released #122 / #126; Oct 20, 2026)

#122 merged at `3c1d2607e166ad3d09565ac4cc47b365647fbe42`; its explicit source
deploy workflow 39298379832 confirmed the existing deployment at @99. #126 merged at
`f7b37d70691caa775b81f6ab1fab32b1fb79e54e` and changes Node/UI only. Public
The morning /api/version check reported f7b37d7 with healthy /healthz. PackageCatalog and
PackageRequests exist in the source workbook. This does not independently
verify every configured secret or manager end-to-end usage.

Sandra's removal of the extra catalog PIN is recorded in #126. Access uses the
signed-in name allowlist (Vered), a scoped 15-minute session bound to the unique
base login, server revocation and a body-bound source HMAC. Anyone with shared
APP_PIN can choose Vered; name-only access is an accepted limitation in that
owner record, not personal authentication. The catalog PIN/limiter are gone.
Do not reintroduce the superseded PIN gate or describe it as still required.

Claude owns continuation of package verification. Therapists #105 merged at
`d38d85b1c0554b419f7da352d0069363dbe3c5eb`; do not merge it again.
It supplies the managers' price-free catalog/status and idempotent request flow;
current configuration and live end-to-end evidence still need verification here. Keep two distinct
PACKAGE_* secrets. Quotes remain integer-agorot immutable snapshots; priced is
not paid, attach stores a reference, and package quotes do not create charges.
Sandra's current prices, VAT, Solo tiers/extensions and Vered continuation
ownership are documented by Claude; do not ask for those decisions again.
See docs/package-catalog.md and docs/package-release-checklist.md for design and
remaining rollout steps; older draft/release labels there are historical until
reconciled by the package owner.

## Outpatient: price / pay constants protection (released #123, Oct 19, 2026)

Price assets require a signed session, use no-store, load after sign-in and are
removed on logout; SW excludes them. Shared APP_PIN holders still see them after
sign-in. Therapists #106 removes browser amounts while preserving the debt gate.
Neither released branch needs another push or release. See
CHANGELOG-protect-price-constants.md for the original change.

## Browser-tab favicons (Oct 20, 2026 — merged; live release verification separate)

Assets: Therapists = pink **T** on `#2c1a28`, Outpatient = green **O** on `#071410`
(same palette as each app's PWA icons, so the two tabs differ by letter AND colour).
Files in each app's `public/`: `favicon.ico` (16/32/48), `favicon.svg`,
`favicon-16x16.png`, `favicon-32x32.png`, generated by `scripts/gen-favicons.js`
(no deps); served by explicit public routes in `server.js`; how to replace:
`docs/favicons.md`. SW: therapists v48, outpatient v18. PWA/home-screen icons unchanged.


## Outpatient → Therapists: `plannedExitDate` (Oct 18, 2026)

- `getTreatmentPlans` gains one optional key: `plannedExitDate`. It is the
  planned discharge date (`'yyyy-MM-dd'`) of an ACTIVE client, and `''` when
  there is none, the value is invalid, or the client is not active. No existing
  key changed. It comes from a new append-only Clients column (position 37) set
  in the edit-client modal. `exitDate` is still the actual discharge date.
  Details: `CHANGELOG-planned-exit-date.md`.

# E-ZONE Ecosystem Status — updated September 10, 2026

Add this file to the knowledge of EVERY E-Zone app Project (all eight), replacing
the July 22 version, so any future chat/session starts from the true state. This
Sep 10 revision is the UNION of every repo's copy (the per-repo sections that had
drifted — Dashboard git history, Therapists roster source, Managers Sep 5–10 work,
Logistics access code — are folded in below); the same file now lives in all repos.

## Deployment ground truth (branches re-verified July 22, 2026)

| App | Repo | Deploys branch |
|---|---|---|
| Outpatient | ezone-outpatient | **claude/youthful-volta-laarnk** (UNIFIED — see below) |
| Dashboard | E-Zone-Dashboard | claude/build-ezone-dashboard-QOg5s |
| Therapists | ezone-therapists | claude/inspiring-tesla-jipobw |
| Managers | ezone-managers | main |
| Staffing | ezone-staffing | main |
| Kitchen | ezone-kitchen | main |
| Coordinators | ezone-coordinators | main |
| Logistics | sandrabrayer-ezone-logistics | main |

⚠️ Verify the Railway-connected branch in the Railway dashboard before any work —
it is NOT stored in the repo and has been silently switched before (July 3:
outpatient was switched dashboard-hKjf9 → volta, orphaning a day of work). The
clasp CI deploy workflow, by contrast, DOES store the deployed branch (its
`branches:` list) in the repo — see "Apps Script deployment" below.

## Apps Script deployment — clasp CI (Outpatient: EXPLICIT dispatch, no push trigger)

> **Correction (Oct 2026).** The sections below describe the July 2026 rollout in
> which a push to the deployed branch triggered the deploy. **That no longer holds
> for Outpatient:** `deploy-apps-script.yml` has **no push trigger** (it deadlocked
> with Railway's *Wait for CI*, PR #115). After an approved merge and once
> `GET /api/version` serves the merge SHA, the releasing agent/operator runs
> *Actions → Deploy Apps Script → Run workflow* on `claude/youthful-volta-laarnk`
> with `expected_commit` = the full merge SHA. Nothing is ever pasted by hand and
> no new deployment is created. Check each other app's own workflow before
> assuming either behaviour. See `DEPLOY.md`.

(Historical, July 2026 — kept for the clasp setup details:)

Every E-Zone app's Apps Script backend deploys from GitHub Actions via
clasp (Outpatient: on explicit dispatch, see the correction above). No more hand-pasting `Code.gs` into the editor. The rollout is complete
and was verified green across all six apps on 22/07/2026 (ezone-therapists
already ran this exact setup — it was the template the six were matched to).

- **GitHub Actions + clasp (Outpatient: explicit dispatch, not automatic)** — `.github/workflows/deploy-apps-script.yml`,
  clasp pinned to `@google/clasp@3.3.0`, hardened workflow: it fails loudly and
  early (before touching the live deployment) if a secret is missing or
  `CLASPRC_JSON` isn't valid JSON, and it requires clasp's `Deployed …@<version>`
  confirmation on the redeploy step — so a rejected deployment ID can never pass
  as a green no-op. Runners use `actions/checkout@v5` + `actions/setup-node@v5`
  (Node 24 native — clears the Node 20 deprecation warning) with the clasp
  toolchain on `node-version: '22'`.
- **Trigger** — *historical (July 2026):* a push/merge to the deployed branch that
  touched `apps-script/**`. **Outpatient today:** `workflow_dispatch` only, with a
  required `expected_commit` input and a pre-credential readiness gate (see the
  correction above). A `concurrency` group serializes runs so two dispatches can't
  race the same deployment.
- **Redeploys the EXISTING deployment (same `/exec` URL)** — `clasp push -f`
  uploads `apps-script/**`, then `clasp deploy -i <DEPLOYMENT_ID>` republishes
  the existing deployment as a NEW VERSION. The deployment ID is reused, so **the
  `/exec` URL never changes** and no consumer (Railway `APPS_SCRIPT_URL`, sibling
  apps) has to be re-pointed.
- **Secrets (per repo)** — `CLASPRC_JSON` (clasp OAuth tokens from a local
  `clasp login`) + `DEPLOYMENT_ID` (the existing Web App deployment ID, starts
  with `AKfyc…`). Both live ONLY in GitHub Secrets, never in git; the workflow
  `rm`s the runner's token copy at job end (`if: always()`).
- **Token-refresh procedure** — clasp OAuth tokens expire / can be revoked. To
  refresh: run `clasp login` locally (clasp 3.x) → copy the fresh
  `~/.clasprc.json` → update the **`CLASPRC_JSON`** secret **in all six repos**
  (the SAME value everywhere — they share one deploying Google account) → re-run
  the failed deploy job. `DEPLOYMENT_ID` and the per-repo Script IDs are
  unchanged.

### Per-app deployed branch (verified 22/07/2026)

| App | Repo | Deployed branch |
|---|---|---|
| Staffing | ezone-staffing | `main` |
| Kitchen | ezone-kitchen | `main` |
| Coordinators | ezone-coordinators | `main` |
| Outpatient | ezone-outpatient | `claude/youthful-volta-laarnk` |
| Logistics | sandrabrayer-ezone-logistics | `main` |
| Dashboard | E-Zone-Dashboard | `claude/build-ezone-dashboard-QOg5s` |

Each app's workflow `branches:` list and its `.clasp.json` Script ID are the
source of truth for that app's deploy; the deployment ID lives only in the
repo's `DEPLOYMENT_ID` secret. Setup, token-refresh, and the manual fallback are
documented per repo in `DEPLOY.md`.

### ⛔ OBSOLETE — manual copy-paste redeploy (superseded by clasp CI)

The old manual procedure — open the Apps Script editor, paste `Code.gs`, Save,
Deploy → Manage deployments → New version of the EXISTING deployment — is
**SUPERSEDED** by the clasp CI above and must no longer be used for routine
deploys. It is retained only as an emergency fallback (see each repo's
`DEPLOY.md` → "Manual fallback", which uses clasp locally, not the editor). The
CI path is the ecosystem's standard; hand-pasting was the ecosystem's most
error-prone operation (accidental "New deployment" → the `/exec` URL changes →
every consumer breaks).

## Coordinators (רכזים) — Sep 10, 2026: PRs #139–#148 shipped (all merged to `main`, Code.gs redeployed)

Ten coordinators PRs merged Sep 9–10, 2026, one at a time off `main`, Railway
auto-deployed each, and every `Code.gs` change went out as an isolated commit +
manual "Deploy Apps Script" run afterwards (no auto-deploy trigger — policy unchanged).
Suite at #148: **1221 tests green** (`node --test --test-concurrency=1`).

| PR | What shipped | Code.gs |
|---|---|---|
| #139 | **Guide roster is staffing-owned.** `getGuides` syncs from staffing's read-only `getGuidesForCoordinators` feed on every read (name match, phone as secondary key, upsert under LockService; local rows never deleted/renamed; feed down → zero writes, `rosterSource:'local'` + amber notice). Add / remove / rename retired in the app (410 routes, denylist); only «עריכת מינימום» stays. Inactive guides greyed in the picker, red chips on today/future. | yes |
| #140 | **Guide-name migration** `migrateGuideNamesNow(dryRun)` — editor-run, dry-run default; aligns three guide spellings to staffing's and deactivates one departed guide; rewrites references house-scoped across ShiftAssignments / SwapRequests / PickupRequests / Constraints / TrainingRecords. | yes |
| #141 | **קופה קטנה limit 1,000 → 2,000 ₪/month** — single `PETTY_CASH_LIMIT` constant (guard test forbids other literals), admin-only `POST /api/petty-cash/migrate-limit` (dry run unless `confirm:true`), Guide §14. | yes |
| #142 | **Perf**: `getHouseBundle` (one execution per house open) + `getCorrectionState`, sheet cache TTL 300 s, staffing sync `tryLock(2s)`; proxy request **coalescing**, targeted invalidation (`WRITE_INVALIDATES`), stale-while-revalidate (`X-Cache: HIT / STALE / MISS`), warm-up ≤3 in flight. Diagnosis + Railway verification in `docs/perf-bundle.md`. | yes |
| #143 | **Soft delete** in תקציב רווחה + קופה קטנה — 🗑 with a required reason (2–120), `deletedAt/deletedBy/reason` appended columns, summaries skip deleted rows, «רישומים שנמחקו» collapsed section, amber «תיקון עודף» instead of a negative balance. | yes |
| #144 | **Hard block on manual edits** — double shift + one free day per week (+ cap 6) enforced on every manual path (tap-to-correct, draft override, post-publish correction, swap request, swap approval) via `getCorrectionState`; no override flag; picker greys violators with the reason; one shared Hebrew reason map (`REASON_HE`). | no |
| #145 | **WhatsApp group send** — «📤 שליחה לקבוצת המדריכים — כל החודש»: the full schedule (every date × shift, ❗ on unfilled from the board model), `wa.me/?text=` without a number, «העתקה», weekly parts «חלק i/n» over 1,200 chars; the same week button on the ראשי card and the weekly view. Pure builder `lib/whatsapp.js scheduleMessage`. | no |
| #146 | **Team-meeting day per house** — `Houses.MEETING_DAY` (raanana Tue · ramot Mon · rehab Tue · pardes Sun · efroni Thu) is the source of truth; scheduler soft term 50,000 (≥1 shift/week on the meeting day, below the 100,000 minimum, above load); «ישיבת צוות» chip on the board, ראשי and «המשמרות שלי». | no |
| #147 | **Visit order + psychiatrists** — `InpatientSessions.visitOrder` (appended), `inpatientSession` op `move`, «פסיכיאטר/ית» tag from `Therapists.role`. (Superseded on the UI side by #148: order is now by time.) | yes |
| #148 | **לוז מטפלים restructured, therapist-first + timed** — `InpatientSessions.time` (appended, 'HH:MM' text) **required** on add, **no two sessions of one therapist at the same time on a day**, op `setTime`; UI = «שיבוץ לפי מטפל/ת» cards (workdays from `TherapistWorkdays` → «HH:MM · מטופל» slots, off-day confirm) + derived read-only «לוז שבועי» with filters; legacy rows «ללא שעה» + «הגדרת שעה». **Also: house labels always Hebrew** — `Houses.label()` everywhere, staffing ids (`asher` / `ofroni` / `hapardes`) mapped at read, `hapardes → pardes` in the staffing sync map, `test/house-label-guard.test.js`. | yes |

### Script Properties added in this run (never in code)

| App | Property | Purpose |
|---|---|---|
| **Staffing** | `COORDINATORS_READ_SECRET` | Unlocks ONLY the read-only `doGet?action=getGuidesForCoordinators` feed (name · phone · active · houses · startDate — no financial data). Set on the staffing Apps Script (staffing PR #26). |
| **Coordinators** | `STAFFING_SHEETS_URL` | The staffing Apps Script `/exec` URL the guide sync calls. |
| **Coordinators** | `STAFFING_GUIDES_SECRET` | = staffing's `COORDINATORS_READ_SECRET`. Missing / mismatched → sync skipped, local roster served, amber «לא סונכרן מהסטאפינג» notice. |

Both coordinators properties are set and verified (roster line shows «מנוהלת במערכת
הסטאפינג»). The `script.external_request` scope was authorized once by running
`previewStaffingGuideSyncNow` from the editor. No Railway variables were added.

### Coordinators conventions confirmed this run

- One PR at a time, branched off `main`, PR base `main`; explicit-path `git add`;
  CHANGELOG + Guide.html + tests in every PR; SW cache bumped on any asset change
  (now `v120`); `Code.gs` changes in isolated commits, deploy manual after merge.
- Sheets headers are append-only — new columns this run: `WelfareLog` /
  `PettyCashLog` (`deletedAt`, `deletedBy`, `reason`), `InpatientSessions`
  (`visitOrder`, `time`). `_ensureSheet` writes a new header cell on the first
  write after deploy; `_isTimeHeader` pins `time` columns to text.
- The staffing feed is the roster's source of truth; `InpatientAssignments` stays
  dead; no financial data beyond תקציב רווחה + קופה קטנה.

## Outpatient: the two production lines are UNIFIED (July 4, PR #56)

- `claude/ezone-outpatient-dashboard-hKjf9` and `claude/youthful-volta-laarnk`
  had **no common git ancestor** (unrelated histories) and both accumulated real
  features. PR #56 merged dashboard INTO volta (`--allow-unrelated-histories`).
- **claude/youthful-volta-laarnk is now the single canonical production branch.**
  Treat `dashboard-hKjf9` as dead — do not commit there.
- Restored dashboard features now live on volta: createLead endpoint
  (fail-closed via `CREATE_LEAD_SECRET`), LockService around `_saveAll`,
  persisted paymentStatus/paymentDate/nextBillingDate, backdated payment dates,
  renewal anchored on stored nextBillingDate, card extra-charge paid/unpaid
  toggle, optimistic saves, urgency-sorted patient cards, two-panel patient-card
  redesign, סניף location dropdown/source-of-truth, frequency unit שבוע/חודש.
- **CLIENTS_HEADERS is APPEND-ONLY** (33 cols). `_readAll/_writeAll` map the
  live sheet BY POSITION and `_ensureSheet` never migrates data — NEVER reorder
  or remove mid-array columns; append only. Guard tests enforce the exact order.

## Outpatient: PAYMENTS_HEADERS is APPEND-ONLY too (תקופת כיסוי, Sep 2026)

- `coverageStart` / `coverageEnd` appended to `Payments` (positions 14–15) —
  the period a payment ACTUALLY covered, ported from E-Zone-Dashboard PR #135.
  Same append-only rule as `CLIENTS_HEADERS`: `_readAll` maps BY POSITION, so
  never insert or reorder — append only. Guard tests pin the exact order.
- Both columns are **text-forced** (`PAYMENT_TEXT_COLUMNS`,
  `_ensurePaymentsSheet` + per-row before write): a date-typed cell would read
  back as a Date, serialize UTC and drift −1 day in Israel — here that moves
  revenue between months.
- **Blank is legal and is never backfilled.** Every pre-existing row keeps blank
  cells and reads as the previously inferred cycle
  (`[dueDate, dueDate + 1 month − 1 day]`), derived on read.
  `CreditsLedger.paymentCoverage` is the single source of truth for the credits
  ledger, הכנסות חודשיות and the גבייה row alike.
- חיוב נוסף חד פעמי is unchanged: it covers its own due day, is never
  stamped with a window and is never split across months.
- Validation is server-authoritative (`_coveragePeriodError`, before the lock
  and before any write), mirrored client-side, pinned by a 441-pair parity
  sweep. No new endpoint; `server.js` unchanged.

## Outpatient → Therapists: validated join phone + `phoneIssue` (Sep 28, 2026)

- The therapists roster is keyed by phone and silently DROPS a row with none.
  `getTreatmentPlans` and `getDebtStatus` (its two base sources) now emit the
  SAME validated phone, following one rule (`public/phone-issue.js`, mirrored in
  `Code.gs` `_crossAppPhone`):
  - candidates are `phone`, then `treatmentContactPhone` (never `payerPhone`);
  - normalization is `_recoverPhone`: separators stripped, `+972`/`972` → `0`,
    a lost leading zero restored;
  - a value is accepted only if it matches `/^0\d{9}$/`; otherwise `''`, never
    a guess.
- `getTreatmentPlans` gains ONE key: `phoneIssue` = `''` | `'missing'` |
  `'invalid'`, so the therapists app can list patients it cannot key (a
  therapists-side follow-up; its roster ignores the key today).
  `getDebtStatus` keys are unchanged. `CLIENTS_HEADERS` is untouched.
- The live audit found 13 of the 14 hidden outpatient patients have NO phone
  in any column. The fix is data entry; outpatient cards now show an amber
  «חסר טלפון» / «טלפון לא תקין» chip. Details:
  `CHANGELOG-treatment-plans-phone-issue.md` (ezone-outpatient).

## Outpatient therapist-payout subsystem (shipped July 1–4)

- "תשלומי מטפלים" tab: monthly per-therapist totals (pre-VAT / with VAT),
  detail toggle, mark-forwarded-to-payroll, Excel/CSV export (UTF-8 BOM).
- Pipeline: therapists app marks a session → posts `recordSessionOutcome`
  (secret `SESSION_OUTCOME_SECRET`, set on BOTH Apps Scripts, fail-closed) →
  outpatient writes a `SessionLog` row → payout tab reads `getSessionLog`.
- **Pay rates live in the `TherapistRates` sheet** (name / flatRate /
  intakeRate / followupRate), auto-seeded, cached 120s (edits apply ≤2 min).
  Names must EXACTLY match the therapists app's full names (e.g.
  'ד"ר מיכאל שפרינץ', 'הילה תבור'). Unknown names fail closed. ~14 newer
  therapists still have blank rates — fill before their sessions can record.
- Credit/quota engine: `creditsOwed` persisted per client, single-cell writes.
- Perf: `loadAll` is PARALLEL (Promise.all, guard-tested); session save writes
  one cell, not the whole Clients sheet.
- Deferred: "+ הוסף סשן חסר"/"תיקון סשן" correction modal; historical backfill
  of sessions recorded before the pipeline existed.

## Managers bonus overhaul shipped July 4, 2026 (PRs #5, #7)

- ALL bonus math now lives ONLY in the frontend (`lib/bonus-eligibility.js`);
  the Apps Script backend's bonus fields (qualifies, lockedIn, projectedBonus,
  quarterly*) are ignored everywhere — backend supplies raw data only
  (avgDaily, treatmentDays, treatmentDaysSoFar, manager names). This ended the
  recurring two-systems-out-of-sync bug. Pending: strip the dead bonus code
  from the live "ezone dashboard" Apps Script.
- Model: tier by average daily occupancy — Ramot 17/19/20, Ra'anana 10/12/14,
  Efroni, Rehab & Pardes 10/12/13 → 2,000/2,500/3,000₪. Treatment-days gate is FIXED
  per house: threshold × 30 (Ramot 510, others 300), independent of month
  length and tier.
- Settled previous-month bonus ("בונוס לתשלום") is the headline: trophy
  winners banner (house + manager + amount), per-card rows, KPI total —
  computed on the 1st for the finished month.
- Quarterly 5,000₪ computed locally: windows anchored May 2026 (May–Jul,
  Aug–Oct…), each finished month's settled bonus must be ≥2,000₪; first
  possible payout end of July 2026. Frontend fetches each finished window
  month via `managersOverview&month=YYYY-MM`.
- Day counts run from the 1st (never front-dated); readability pass
  (text-mute 0.72, small fonts 12–13px). Tests: 36 via `node --test`.
- Efroni house-id checked: data-entry app and backend both use 'arfoni'
  consistently — no mismatch.

## Managers: bonus month labelling (September 8, 2026)

- **Settled vs running month are now two labelled blocks everywhere**
  (`בונוס אוגוסט 2026 — סופי (לתשלום)` / `ספטמבר 2026 — חודש נוכחי (בתהליך)`).
  A settled month shows a final state only (`זכאי · מדרגה X · Y ₪` or
  `לא זכאי · המכסה לא הושלמה (441/510)`) — never `בדרך`/`בתהליך`/`חסרים`.
  Hero banners lead with the settled month; running-month progress is a
  secondary line with the month name and `בתהליך`.
- **Running month = ACTUAL days-so-far from the 1st + a separately labelled
  `צפי לסוף החודש` projection.** A tier is shown as achieved only when
  settled-and-met or locked in; otherwise `מדרגה הבאה: N (P מטופלים/יום) ·
  ממוצע נוכחי X`.
- **Single days-so-far figure**: `public/bonus-view.js` → `daysSoFar` (daily
  chart summed to today; else the feed's `treatmentDaysSoFar` capped at
  elapsed × capacity) feeds the KPI, hero, progress bar and house card. The
  feed's raw `treatmentDaysSoFar` is front-dated (366 vs 102 on 8 Sep) and is
  no longer shown as-is.
- **Stray "2500" under the manager name**: the card rendered the feed's
  `type` field verbatim. House type now comes from `HOUSE_LABELS` only; feed
  manager/name strings pass through `BonusView.safeLabel`. Tests assert no
  backend bonus field reaches the DOM (`test/app-render.test.js`).
- New module `public/bonus-view.js` (labelling only; math stays in
  `lib/bonus-eligibility.js`). Tests: 113 via `node --test`. SW cache v7.
  Details: `docs/bonus-month-labelling.md`. Still pending: strip the dead
  bonus code from the live dashboard Apps Script (unchanged by this work).

## Managers: occupancy history picker (September 10, 2026)

- Every house tab opens with a **"היסטוריית תפוסה"** card: a month picker
  (current month back to the May 2026 quarterly anchor, up to 12 months)
  that shows a past month's daily occupancy chart, `ימי טיפול` vs the fixed
  gate, daily average and settled status — always `(סופי)`, never `בתהליך`.
- Data: `managersOverview&month=YYYY-MM` (shared `fetchMonthOverview_`
  helper); the daily chart from that payload or one
  `managersHouse&house=…&month=…` attempt accepted only when its `month`
  matches. Fetch errors show an explicit error state. **The picker never
  touches the bonus KPIs / hero / cards** (snapshot-tested). SW cache v9,
  tests 125. Details: `docs/occupancy-history-view.md`. Backend unchanged:
  whether the month overview carries a per-house `dailyChart` is decided in
  the dashboard Apps Script.

## Managers: bonus history month picker (September 10, 2026)

- **"חודש בונוס" picker on the overview and on every house tab**: the
  running month (default) plus every finished month back to the May 2026
  quarterly anchor, no cap. One page-wide selection; `חזרה לחודש נוכחי`
  restores the live view. A finished month renders the WHOLE page settled
  through `BonusView.settledMonthView` — `יולי 2026 — סופי`, tier reached,
  amount, gate result — KPIs, winners banner, network chart, house cards,
  house hero, month split, days bar, tier track, quarterly block
  (anchored to the selected month's window, with `מאי ✓ · יוני ✗ · יולי ✓`
  marks) and breakdown. Never `בתהליך` / `בדרך` / `חסרים` / `צפי`; the
  next-tier card is hidden; days-so-far of a finished month = full-month
  total.
- Data: the existing `managersOverview&month=YYYY-MM` fetch only (selected
  month + finished months of its window, ≤ 3 requests), cached per month in
  memory for the life of the page; explicit error state, retried on
  re-select. **No new endpoints, no Apps Script changes.** The running month
  is byte-for-byte unchanged (snapshot-tested). SW cache v10, tests 136.
  Details: `docs/bonus-month-labelling.md` → "Bonus history month picker".

## Managers: house roster (5 houses, current as of September 5, 2026)

The Managers app (`ezone-managers`) covers FIVE houses. Hardcoded fallbacks
live in `HOUSE_LABELS` (`public/app.js`) and `HOUSE_BONUS`
(`lib/bonus-eligibility.js`); the live feed's `manager` field, when present,
still takes precedence over the hardcoded name. `test/house-coverage.test.js`
and `test/ecosystem-status-doc.test.js` fail CI if any enumeration (or this
table) drifts.

| Key | House | Manager | Type | Eligibility threshold | Capacity |
|---|---|---|---|---|---|
| raanana | רעננה אשר | שחר | בית מאזן | 10 | 14 |
| ramot | רמות השבים | אורן | בית מאזן | 17 | 20 |
| efroni | קיסריה עפרוני | חנן | תחלואה כפולה | 10 | 13 |
| rehab | קיסריה ריהאב | רנטה | גמילה | 10 | 13 |
| pardes | רעננה הפרדס | חן | תחלואה כפולה | 10 | 13 |

- רעננה הפרדס (`pardes`) was added August 24, 2026 with Efroni's bonus
  parameters; the shared dashboard Apps Script must return `pardes` in
  `managersOverview` / `managersHouse` for its live data to appear.
- Manager history: raanana עידו → שחר (Aug 24, 2026); ramot שחר → אורן
  (Aug 25, 2026). Ra'anana's שחר and Ramot's former שחר are different people.
- Efroni's backend house-id is `arfoni` (data-entry app and backend agree);
  the frontend key is `efroni`.

## Apps Script topology (July 4)

- Outpatient Apps Script: **ONE active deployment** (URL ending FOwWYIw/exec);
  two accidental extra deployments created July 4 were archived. All three
  consumers point at it: outpatient `SHEETS_URL`, therapists
  `OUTPATIENT_SHEETS_URL`, dashboard `OUTPATIENT_LEAD_URL`.
- Dashboard backend: ONE Apps Script serves Dashboard (SHEETS_URL), Managers
  (APPS_SCRIPT_URL), Therapists (DASHBOARD_SHEETS_URL) — rotate together.
- Secrets (Script Properties, never in code): SESSION_OUTCOME_SECRET (new,
  both outpatient+therapists), CREATE_LEAD_SECRET (outpatient — set it to
  enable Dashboard→Outpatient lead handoff), DEBT_STATUS_SECRET,
  TREATMENT_PLANS_SECRET, OCCUPANCY_SECRET, OUTPATIENT_LEAD_SECRET,
  WINBACK_SOURCE_SECRET, APP_PIN (Railway; Logistics uses SHARED_ACCESS_CODE —
  its shared login code, which replaced APP_PIN there). Coordinators' staffing
  pair (STAFFING_SHEETS_URL / STAFFING_GUIDES_SECRET) and staffing's
  COORDINATORS_READ_SECRET: see the Sep 10 coordinators section above.

## Therapists: roster source = the ezone-staffing feed

- The Therapists app's therapist list is SYNCED from ezone-staffing (workers
  with role מטפל/ת) on every getData — `getTherapistsForTherapists`. Names are
  edited in the STAFFING app; `active` is overwritten by every sync (exact-name
  upsert, add/deactivate/reactivate only — never a row delete or rename; all
  downstream matching, incl. outpatient TherapistRates, is exact-string, so
  renames go through staffing + `migrateTherapistNames` + a TherapistRates row
  rename together).
- Secret pairing: staffing's `THERAPISTS_READ_SECRET` = therapists'
  `STAFFING_THERAPISTS_SECRET` (plus `STAFFING_SHEETS_URL` on the therapists
  Apps Script). Unset/unreachable ⇒ NO writes; the last-synced list is served
  and the UI shows an amber "לא סונכרנה" toast. (The coordinators app follows
  the same pattern for guides — see the Sep 10 section.)

## Dashboard git history: the deploy branch is an ORPHAN SNAPSHOT (verified Aug 9, 2026)

`claude/build-ezone-dashboard-QOg5s`'s root commit (`62f5f7b`, "Merge pull
request #18", June 17 2026) has **no parents** — the branch began life that day
as a flattened snapshot of everything through PR #18. The original PR #1–#18
history (phase-2a…2e work) is git-disconnected from it; the old `feature/phase-2*`
and early `claude/*` branches still carry that severed line, which is why they
show alarming "50–64 commits not on the deploy branch" counts. **This is an
artifact, not lost work** — an Aug 9 audit verified the snapshot contains the
full pre-#18 content and that every documented feature since is present at HEAD.
Do not launch a lost-work hunt (or merge one of those stale branches) because of
those counts; content-level comparison, not commit ancestry, is the correct
check against pre-June-17 branches.

## Known pitfalls (hard-won, extended July 4)

- **[OBSOLETE for routine deploys — Apps Script is published through the clasp
  workflow (Outpatient: explicit `workflow_dispatch` with `expected_commit`, no
  push trigger); see "Apps Script deployment" above. Never paste Code.gs by hand.
  Kept as history / emergency fallback only.]** Apps Script NEVER auto-syncs from GitHub: paste Code.gs →
  Save → deploy a NEW VERSION of the EXISTING deployment. Wrong choices seen this
  week: new deployment (URL changes, consumers break) and access flipped off
  "Anyone" (consumers get Google's HTML page → "Non-JSON from Apps Script").
- GitHub web editor nests paths when creating files inside a folder — type only
  the filename when already in the folder. Browser re-downloads add " (N)"
  suffixes — drag FOLDERS to the upload page, not loose files.
- Claude Code opens PRs against the repo DEFAULT branch — always verify PR base
  = the deployed branch. PRs #33/#55 were closed for this; #56 was correct.
- Railway variable changes apply only to deployments started after saving.
- PIN inputs have maxlength (Outpatient 6, Dashboard 6) — keep APP_PIN within.

## Next tracks (in priority order)

1. **Outpatient housekeeping**: set GitHub default branch = volta; delete stale
   claude/* branches (incl. dashboard-hKjf9 after a grace period); fill the
   blank TherapistRates rows; review `matchStatus:"no_match"` SessionLog rows.
2. **Outpatient mobile/PWA** ("the phone option"): manifest + service worker +
   letter-E green icons + mobile CSS pass — same recipe as therapists.
3. **Therapists carryovers**: `_cancelFutureBookings` on patient delete (verify
   deployed); live end-to-end quota test (Yarden→Vered); plan-change history.
4. **Logistics**: mobile-responsive, then hardening (חירום auto-approval,
   LockService, deferral wake-up).
5. **Managers + Logistics auth** to the ezone-staffing standard.
6. **Design tokens** across apps; then feature tracks (plan-compliance,
   occupancy forecast, debt aging). Managers bonus distance-to-target: shipped
   July 4.
7. **Dashboard Apps Script cleanup**: strip dead bonus logic (frontend now
   ignores it); keep raw-data endpoints only.
