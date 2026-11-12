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

## Confirmed fail-closed stale marker (12 Nov 2026, read-only)

Google Apps Script Project Settings shows:
- `INTEGRITY_ACTIVE_BACKUP` is non-empty with `startedAt=2026-11-04T00:21:22.759Z` (02:21 Israel time), **over eight days old**. No script is legitimately running continuously for eight days. Source code explicitly refuses every later scheduled backup while this marker exists; this is a confirmed direct blockage, not merely a theoretical concern.
- `OUTPATIENT_RECOVERY_HOLD` property is **absent**.
- `INTEGRITY_BACKUP_SSID` is nonempty; matching its destination to the expected workbook is not yet proven. Never expose, share or rewrite the property value.
- The Triggers view shows last `nightlyIntegrityJob` invocation 11 Nov at 19:21 with reported 0% errors. **This is misleading by implementation**: existing early `backup_busy` return is considered a successful Apps Script execution.

The code fix now also throws on both admission-script-lock failure and `INTEGRITY_ACTIVE_BACKUP` busy-marked admission, without deleting/resetting any marker. Updated tests assert the lock, data and recovery hold remain untouched.

### Controlled recovery procedure — requires the owner's explicit approval

1. Verify the exact OUT Apps Script project and that **no** current `nightlyIntegrityJob`, backup capture, Apps Script recovery or other legitimate job is active. Confirm the marker's 4 Nov timestamp is unchanged and that the recovery hold is absent. Do not clear unknown fresh markers.
2. Preserve the marker's metadata privately as an incident record, without exposing property values to chats/issues. Resolve the intended backup destination by workbook identity in the authorized admin account (not by guessing a Sheet ID).
3. With signed-off maintenance authorization, remove **only** the stale `INTEGRITY_ACTIVE_BACKUP` property. Do not edit backup destination, `INTEGRITY_REQUIRED_SOURCES`, source Sheets, recovery holds, financial journal, credentials or any history.
4. After separate permission, run a controlled snapshot through the existing official `nightlyIntegrityJob` or allow the next scheduled run; verify a *new* OUT `manifest` plus every registry source family, checksum consistency and the destination workbook timestamp. An execution displaying 0% errors or a successful web healthcheck is **not** sufficient.
5. If publication still fails, stop; preserve source data and recovery copies. Investigate runtime budget, source headers, missing previously required datasets and last failure logs. No auto-clear loops or blind restore.
