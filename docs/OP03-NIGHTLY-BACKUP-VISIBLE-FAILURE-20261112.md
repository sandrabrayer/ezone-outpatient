# OP-03-P0 — Nightly backup failures must not be green (12 Nov 2026)

## Verified read-only evidence

- The connected `EZONE-Backups` workbook contains Dashboard backups through **2026-11-12**, but its most recent **Outpatient** snapshot family and manifest are dated **2026-11-04**. The 4 Nov set includes SessionLog, FinancialOps, TherapistRates, Tasks/Activity and operational recovery metadata. This does **not** prove that another destination has no newer snapshots; the selected workbook is the historically expected shared destination, and no second same-named workbook was found in bounded Drive search.
- Google Apps Script's Triggers UI confirms exactly one time-based `nightlyIntegrityJob` trigger; last run displayed on **2026-11-11 19:21:15**, failure-rate **0%**. The detailed execution logs were not accessible read-only, so its real backup outcome remains UNKNOWN.
- Current Apps Script source `nightlyIntegrityJob` catches errors from `_integrityCaptureData` / snapshot/manifest verification into an `errors` array, emails via best-effort `_integritySendAlert`, then returns normally. Thus Apps Script's trigger shows **success** even when snapshot publication failed. A stranded `INTEGRITY_ACTIVE_BACKUP` or recovery hold can also return early without an error.

## Narrow fix in this DRAFT

- Add `backupPublished`, set true **only after** today's manifest is published and `_integrityValidateRestoreSet` verifies the data families and checksums.
- If no coherent manifest was published, after the existing alert/sentinel handling throw `nightly_backup_not_published` so Apps Script executions report a real FAILURE. The existing `finally` still releases its own execution marker; no automatic marker clearing, no silent retries, no data reconstruction and no source modification.
- A valid verified capture continues to succeed; tests for a failed source read, missing Clients, broken snapshot verification, wrong backup target and retention protection now assert failure visibility.
- This patch does **not** restore missing backups or change triggers/properties. Before production release, owner must authorize a **read-only** inspection of `INTEGRITY_ACTIVE_BACKUP`/recovery hold and configured backup destination; an isolated snapshot proof must then be gathered. Do not execute a production backup or restore merely for testing.

## Release gate

This DRAFT changes Apps Script `Code.gs`, so a merge automatically deploys the existing Web App and changes scheduled trigger behavior. Requires exact-head CI plus owner approval, then a safe follow-up to prove actual daily snapshots. No live patient/finance writes or script-property changes were performed by this investigation.
