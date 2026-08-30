# CHANGELOG — Nightly data-integrity job (detection + backup)

## Summary
A time-driven nightly job (`nightlyIntegrityJob`, 2:00 AM Asia/Jerusalem)
that DETECTS silent patient-row loss and keeps a daily off-spreadsheet
backup of Clients — the second layer of defense after the `_saveAll`
row-loss guard (CHANGELOG-saveall-tombstone.md), independent of any save
path. One Hebrew alert email per run, ONLY when something is wrong.

## Problem
The 2026-08-26 stale-tab clobber showed that a patient row can vanish from
the Clients sheet with no one noticing until the orphaned Payments rows
surface in גבייה. The `_saveAll` tombstone guard prevents *that* path from
losing a row silently — but nothing watches the sheet itself, and nothing
backs it up outside Sheets version history.

## Changes
- apps-script/Code.gs  (** auto-deploys via clasp CI on merge to the deployed
  branch — touches `apps-script/**` **)
  - New `/* ===== Nightly integrity job ===== */` section, appended at the
    end. `CLIENTS_HEADERS` and all existing code untouched; no new
    doGet/doPost actions — the job is trigger-driven only.
  - `nightlyIntegrityJob()` — READ-ONLY vs the live Clients/Payments sheets
    (all live reads via `getSheetByName`, never `_ensureSheet`, so not even
    a header relabel; locked by a source-scan test). Three checks in a FIXED
    order, each in its own try/catch so one failure never silences the rest:
    1. **Row-count sentinel** — live Clients row count/ids vs the previous
       run's, stored in Script Properties (`INTEGRITY_LAST_COUNT`,
       `INTEGRITY_LAST_IDS` — ids only, to stay inside the per-property size
       limit — and `INTEGRITY_LAST_RUN`). On a decrease, every disappeared
       id WITHOUT a `Clients-removed` tombstone goes into the alert; names
       are resolved from the NEWEST EXISTING snapshot, which is WHY check 1
       must run before check 3's same-day overwrite (ordering locked by
       test). State is persisted at end of run, and only off a successful
       Clients read (a failed read must not seed count 0 and fire a false
       full-loss alert the next night).
    2. **Orphan-payment sweep** — every unique clientId across Payments
       (parsed from `pay::<clientId>::…` ids incl. the legacy 3-segment
       shape, falling back to the `clientId` column) must match a Clients
       row or a tombstone; unmatched → alert with the payment row's
       clientName.
    3. **Daily snapshot** — values-only copy of the Clients grid into a
       separate `EZONE-Backups` spreadsheet, created on first run
       (`SpreadsheetApp.create`) with its id persisted as
       `INTEGRITY_BACKUP_SSID` (recreated + re-stored if the stored id no
       longer opens). One sheet per day named `outpatient-YYYY-MM-DD` —
       PREFIXED so the Dashboard app's job can later share the same backup
       spreadsheet without collisions. Same-day re-run clears + rewrites
       today's sheet (idempotent). Retention: sheets STRICTLY matching the
       prefixed name and older than 30 days are deleted; anything else
       (another app's snapshots, manual tabs, unpadded names) is
       untouchable, and the last remaining sheet is never deleted.
  - Alerting: `_integritySendAlert` — one `MailApp.sendEmail` per run, only
    when a check found a problem (or errored internally). Recipient from the
    `ALERT_EMAIL` Script Property; FAIL-OPEN: property missing or send
    failure → `Logger.log` the full report, never throw. Subject:
    `⚠️ E-ZONE: אי-התאמה בנתוני מטופלים`; Hebrew body lists missing ids +
    names per check.
  - `setupIntegrityTrigger()` — one-time installer (run once from the Apps
    Script editor). Idempotent: deletes every existing trigger bound to
    `nightlyIntegrityJob` before creating the single daily 02:00 trigger.
  - Pure logic (id diffing, payment-id parsing, orphan detection, snapshot
    naming, retention date math, alert body) lives in standalone
    `_integrity*` functions with no GAS service calls, so `node --test`
    exercises the REAL code.
- test/nightly-integrity.test.js
  - Extracts the pure helpers straight out of Code.gs (balanced-brace scan +
    eval — the session-outcome pattern) and unit-tests them: id diffing,
    all four payment-id shapes + garbage, orphan detection incl. the
    clientId-column fallback and dedupe, prefixed snapshot naming,
    30-day retention math across month/year boundaries, strict-matcher
    negatives, prefix↔matcher round-trip, Hebrew alert body.
  - Source-scan guards: read-only contract of the job body (no write
    primitive, no `_ensureSheet`), snapshot/retention helpers never
    reference the live sheets, check ordering 1→2→3 with the name lookup
    before the snapshot write, sentinel state persisted last and gated on a
    successful read, fail-open alerting, idempotent delete-then-create
    trigger installer @ 02:00, pinned Script Property keys,
    `CLIENTS_HEADERS` untouched (still 34 columns ending at
    `paymentAmountOverrides`).
  - Timezone: `apps-script/appsscript.json` pins `Asia/Jerusalem`
    (verified in-repo; locked by test) — `atHour(2)` and the snapshot date
    roll both follow it.
- server.js / public/** — no changes.

## Post-merge steps (one-time, in the Apps Script editor)
1. Set the `ALERT_EMAIL` Script Property (until then the job logs instead of
   emailing — fail-open, nothing breaks).
2. Run `setupIntegrityTrigger()` once to install the 2:00 AM trigger
   (re-running it is safe — it replaces, never duplicates).
3. Nothing else: the backup spreadsheet and all `INTEGRITY_*` properties are
   created/seeded automatically on the first run.

## Tests
`npm test` — 649 pass / 0 fail (27 new in test/nightly-integrity.test.js).
