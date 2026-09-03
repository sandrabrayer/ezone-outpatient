# CHANGELOG — Corrupted-rows cleanup (U+FFFD repair pipeline)

## Summary

Ports the Dashboard app's shipped corruption-repair pipeline (E-Zone-Dashboard
PRs #105/#107/#108) to the outpatient backend, reimplemented for this
codebase's architecture (positional `_readAll`/`_writeAll` schemas, LockService,
single-cell repair writes). Five new **editor-only** functions (Run dropdown;
deliberately NOT reachable through the HTTP dispatcher — guard-tested):

| Function | What it does | Writes |
|---|---|---|
| `harvestRevisionSnapshotsNow` | Rebuilds a spread of this spreadsheet's own Drive revisions as `EZONE-OUT-SNAPSHOT-AUTO-<yyyy-MM-dd>` Sheets files | Creates snapshot files only |
| `scanCorruptedRowsNow` | Dry run: finds every U+FFFD cell, classifies a repair proposal per tier | **Zero** |
| `writeRepairPlanNow` | Fills the hidden `RepairPlan` sheet, everything `approved=FALSE` | RepairPlan only |
| `applyCorruptedRowRepairsNow` | Executes `approved=TRUE` rows only, single-cell writes under the script lock | Approved cells + AuditLog |
| `deleteAutoSnapshotsNow` | Trashes `EZONE-OUT-SNAPSHOT-AUTO-*` files only | Drive trash only |

## Background

The Dashboard app's `server.js` had a UTF-8 chunk-split bug (live 2026-07-27 →
fixed 2026-08-31) that replaced split Hebrew characters with U+FFFD (`�`).
Outpatient's own read path (`fetch().text()`) was never at risk, but corrupted
rows arrived here through the **Dashboard→Outpatient `createLead` handoff**
(corrupted lead `name`/`note` at arrival) and then spread on lead→client
conversion and subsequent edits into every sheet that copies a name.

## Phase 1 findings (read-only investigation)

### Sheet inventory — free-text / Hebrew-enum scan targets

All 13 sheets holding Hebrew text are enumerated in `_corruptionScanTargets()`
(a guard test asserts every configured column exists in its header array):

| Sheet | Row key (tier 1) | Scanned columns | Enum classes |
|---|---|---|---|
| `Clients` | `id`, phone fallback | name, serviceType, location, status, notes, source, payerName, sessionsPerWeek, paymentStatus, clinicalTreatmentType, assignedTo | serviceType, location, status, paymentStatus, clinicalTreatmentType, assignedTo |
| `Clients-removed` | `id`, phone fallback | same as Clients | same |
| `Leads` | `id` | name, serviceType, location, note, stage, not_relevant_reason, not_relevant_note, assignedTo | serviceType, location, stage, assignedTo |
| `לידים שהוסרו` | `id` | same as Leads | same |
| `Payments` | `id` (deterministic `pay::<clientId>::…`) | clientName, status, method, notes | status |
| `ClientCharges` | `id` | description, notes | — |
| `SessionLog` | `sessionId` | patientName, **therapist**, clinicalTreatmentType | clinicalTreatmentType, therapist |
| `TherapistRates` | — (name IS the key) | **name** | therapist name pool |
| `StopFlags` | `id` | name, note, reportedBy, resolvedBy | — |
| `התראות עצירת טיפול` | `id` | clientName, createdBy, note | — |
| `ExtraSessionRequests` | `id` | patientName, treatmentType, **therapist**, requestedBy, note | therapist |
| `מסלול המשך` | `key` | name, house, note | — |
| `Settings` | `key` | value | — |

Notes from the investigation:

- **Row identity**: unlike the Dashboard's Patients sheet, every outpatient
  sheet except `TherapistRates` has a stable unique key (`id` / `sessionId` /
  `key`), so tier-1 snapshot matching is key-first with the ecosystem phone
  rule (`/^0\d{9}$/`, `_recoverPhone` heals the Sheets-dropped leading zero)
  as the Clients-family fallback. `TherapistRates` is keyed by the very column
  that can be corrupted → it repairs from the therapist-name pool only.
- **Cross-references unique to this repo**: `Clients.fromLead` points at the
  originating lead, giving a tier-0 "repair from lead" source; deterministic
  Payments ids make Payments snapshot-matchable (the Dashboard's were
  session-local and weren't).
- **Frequency unit (שבוע/חודש)**: lives INSIDE the `sessionsPerWeek` JSON blob
  (`_units` reserved key), not in its own column — so it is snapshot-repairable
  (the whole cell is scanned and the compatibility guard handles JSON), but
  not enum-repairable per unit. No schema change made for it.
- **Enum seeds** mirrored from code + frontend: `BILLING_PRICES` +
  `DAY_CENTER_BILLING`, `CLINICAL_TO_BILLING`, client statuses
  (`פעיל`/`סיים טיפול`/`לא פעיל`), payment statuses
  (`DEBT_PAYMENT_STATUS_ALIASES`), lead stages (Hebrew labels as stored:
  `פרטים אישיים`/`שיחת היכרות`/`תוכנית טיפול`/`הסכם נחתם`/`לא רלוונטי`),
  locations (`CORRUPTION_LOCATIONS` mirrors `public/app.js` `LOCATIONS`,
  guard-tested), therapist rate maps. Each class is extended with clean values
  observed live (that's where `assignedTo` gets ורד/שירן/יעל).

### Repair tiers (priority order — a machine never guesses)

0. **Cross-reference**: originating lead (`fromLead`, clean name), then a clean
   row elsewhere sharing a normalized phone — name columns only.
1. **Snapshot**: relocate the row by stable key (own sheet first, then its
   family sheet — rows migrate Clients ↔ Clients-removed, Leads ↔ removed
   leads), phone fallback; **2+ hits → ambiguous, no proposal**. The snapshot
   value must pass the **compatibility guard**: surviving non-U+FFFD segments
   appear in order, each U+FFFD run stands for 1+ characters, anchored at both
   ends. Snapshot columns are mapped by the snapshot's **own** header row
   (schemas are append-only, so old snapshots just lack trailing columns).
   A clean-but-incompatible snapshot value → `snapshot mismatch — manual`,
   and the weaker tiers are **blocked** (the value changed after the snapshot).
2. **Closed value sets** (enum columns only, never free text): exactly ONE
   compatible legal value.
3. **Clean-name roster** (name columns only) from all live sheets + all
   snapshots: exactly ONE compatible name. Bonus: **twin-merge** — two
   same-key rows corrupted in different positions whose union reconstructs
   the full string.

## ⚠️ THERAPIST NAMES — verify cross-app before approving (critical)

Any proposal for `TherapistRates.name`, `SessionLog.therapist`, or
`ExtraSessionRequests.therapist` carries a loud
**`THERAPIST-NAME — verify cross-app`** suffix in the plan's `source` column.
**These names must stay byte-exact with the therapists app's roster** — payout
matching (`_therapistPay`) is fail-closed on the name, so a "repair" to a
spelling that differs from the therapists app breaks payout recording for that
therapist. Verify each such row against the therapists app before flipping
`approved` to TRUE.

The same caution applies to client name fields used in cross-app phone/name
matching (debt status, stop-flow): `Clients.name` / `SessionLog.patientName`
proposals carry a `CLIENT-NAME — used in cross-app phone/name matching, verify`
suffix.

## New sheets

- **`RepairPlan`** (hidden): `sheet | row | column | newValue | action |
  approved | oldValue | source` (order pinned by guard test; header array
  append-only like every schema here). `writeRepairPlanNow` fully rewrites it
  each run — re-running **resets approvals**.
- **`AuditLog`** (hidden, append-only): `timestamp | action | fn | rowKey |
  name | details`. This repo had no audit-log pattern, so a minimal one is
  introduced with a **fail-soft** `logAudit_` — a logging failure can never
  break the operation being logged (guard-tested).

## Safety properties (all guard-tested, `node --test`, 37 new tests)

- Scan + plan are read-only toward data sheets (source-scan proves no write
  call in the scan engine; the vm test records zero writes).
- Apply: **single-cell `getRange(...).setValue` writes only — NEVER
  `_writeAll`**, never bulk `setValues` — so a concurrent `_saveAll` can never
  be clobbered; runs under `LockService`; executes `approved=TRUE` rows only;
  re-verifies `oldValue` (and that the cell is still corrupted) before every
  write and **skips + logs on drift**.
- `CLIENTS_HEADERS` and every schema untouched: still 34 append-only columns,
  no column added to Clients.
- The five entry points are not routed in `doGet`/`doPost` (dispatcher guard).
- Snapshot prefix is `EZONE-OUT-SNAPSHOT` (never the Dashboard's
  `EZONE-SNAPSHOT` — the two apps' snapshots can't cross); deletion touches
  `EZONE-OUT-SNAPSHOT-AUTO-*` only, via trash (30-day recoverable).
- Harvest is idempotent (existing names skipped) with per-revision failure
  isolation; revision selection is pure and unit-tested (baseline before
  2026-07-27, ~one per 6 days across 2026-07-27 → 2026-09-01, newest pre-fix,
  cap ~10, sparse-tolerant).

## ⚠️ One-time re-authorization prompt (appsscript.json change)

`appsscript.json` now enables the **Drive advanced service (v3)** and declares
an explicit `oauthScopes` list (declaring any scope disables auto-detection,
so the full minimal set everything in this script uses is spelled out):

- `spreadsheets` (all sheet reads/writes, incl. the nightly backup)
- `drive` (revision listing/export, snapshot files, DriveApp search/trash)
- `script.external_request` (`UrlFetchApp` REST fallback + revision export)
- `script.scriptapp` (existing `setupIntegrityTrigger` + OAuth token for the
  Drive REST calls)
- `script.send_mail` (existing nightly-integrity alert email)

**On the first Run-dropdown execution after this deploys, Google will show a
one-time re-authorization prompt** for the new Drive scopes. Accept it once;
the web app deployment itself is unchanged (same `/exec` URL, clasp CI
redeploys the existing deployment on merge).

## Sandra's run order

1. Merge this PR (merge commit, base `claude/youthful-volta-laarnk`). clasp CI
   deploys automatically — no manual Apps Script steps.
2. Open the outpatient Apps Script editor → Run dropdown:
   1. `harvestRevisionSnapshotsNow` — accept the one-time authorization
      prompt, then check the execution log: how many revisions were found /
      harvested. Re-run once if some failed (idempotent — it only fills gaps).
   2. `scanCorruptedRowsNow` — dry run; read the log: every corrupted cell
      with its proposed repair + tier breakdown. Writes nothing.
   3. `writeRepairPlanNow` — then unhide the `RepairPlan` sheet and review:
      fill any blank `newValue` (rows marked `— manual`), verify every
      `THERAPIST-NAME` row byte-exact against the therapists app, and flip
      `approved` to `TRUE` per row to execute. (Re-running this step resets
      approvals — review once, then apply.)
   4. `applyCorruptedRowRepairsNow` — applies approved rows only; the log
      shows applied/skipped counts; the hidden `AuditLog` sheet holds the
      trail. Safe to re-run: already-repaired rows skip on the drift guard.
   5. Repeat 2–4 if new proposals appear (e.g. after harvesting more
      snapshots); when done, `deleteAutoSnapshotsNow` to clean up the
      harvested snapshot files (Drive trash, 30-day recoverable).

## Files changed

- `apps-script/Code.gs` — the pipeline (new section at the end; no existing
  function touched).
- `apps-script/appsscript.json` — Drive advanced service + explicit scopes.
- `test/corrupted-rows-cleanup.test.js` — 37 tests (pure extraction, vm
  sandbox with write-recording sheets, source-scan guards).
- `CHANGELOG-corrupted-rows-cleanup.md` — this file.

Full suite: **787 passing, 0 failing** (`npm test`, Node ≥ 18).
