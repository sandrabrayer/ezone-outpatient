# OP-03 two-stage nightly backup — activation, verification and rollback runbook

22 Nov 2026 · PR #199 (Issue #124). **Draft. Nothing here has been run in production.**

## What changes

| | Legacy (deployed today) | Two-stage (this PR, OFF by default) |
|---|---|---|
| Trigger | `nightlyIntegrityJob` 02:00 | same 02:00 job = **Phase A**, plus one `finalizeNightlyIntegrityJob` 03:00 = **Phase B** |
| Phase A | capture + publish + verify + retention in ONE execution (timed out 17 Nov at 360.883 s) | capture under ScriptLock, publish per-sheet snapshots + `outpatient-pending-manifest-<day>`, set `INTEGRITY_PENDING_BACKUP`, stop |
| Phase B | — | re-read every published snapshot, typed SHA check, publish `outpatient-manifest-<day>` + `outpatient-verified-<day>` certificate, then retention, source inventory and sentinel; clear pending LAST |
| Restore | v2 manifest | v3 requires the certificate; v2 sets still readable |
| Switch | — | Script Property `INTEGRITY_TWO_STAGE_ENABLED=1`, set only by `setupIntegrityTwoStage()` |

Fail-closed: pending/active marker, missing finalizer trigger, tampered snapshot, missing manifest, retention failure → the job stops and keeps the prior certified set. No marker is auto-cleared.

## Gate 0 — isolated native rehearsal (REQUIRED before any production step)

Needs (none available to the automation session): a **new standalone Apps Script project** (never the production script `1JSI3…`), three new synthetic spreadsheets (source / backup / restore target), and the `CLASPRC_JSON` repository secret.

1. Dispatch `.github/workflows/sandbox-drill-push.yml` on the PR branch with `sandbox_script_id=<isolated id>` and `expected_commit=<exact PR head>`. It regenerates `test-support/google-operational-drill-candidate.gs` from the exact source and pushes it (no deploy).
2. In the isolated project: set `INTEGRITY_BACKUP_SSID` to the synthetic backup workbook, `INTEGRITY_TWO_STAGE_ENABLED=1`. Seed representative volume (hundreds of Clients/Leads/Payments/SessionLog rows, FinancialOps renewal + extra charge, a committed `SessionOutcomeOps` group row when #195 is part of the release, two manual tabs).
3. Run `nightlyIntegrityJob` once → record execution time (target < 300 s), confirm pending manifest exists and NO certificate.
4. Run `finalizeNightlyIntegrityJob` once → record time (< 300 s), confirm manifest + certificate, pending cleared, retention done.
5. Restore into the third workbook with `beginOutpatientRecovery`/`finishOutpatientRecovery` (v3) and compare every typed grid, manual tab, credits, FinancialOps, SessionLog, SessionOutcomeOps.
6. Fault pass (isolated only): tamper one snapshot between A and B; interrupt before certificate; duplicate A; delete the finalizer trigger. Each must fail closed and keep the previous set.
7. Record execution IDs, durations and workbook IDs privately; post a summary (no IDs of real data) on #124.

A small fixture does **not** prove the 416-sheet production destination fits in 360 s; compare measured per-sheet cost against the production inventory before go-live.

## Production activation (after Gate 0 + Sandra's explicit approval)

1. Merge the PR; wait for Railway (`/api/version` = merge SHA); dispatch `deploy-apps-script.yml` with `expected_commit` = merge SHA. **Nothing changes yet — legacy mode continues.**
2. Confirm in the production script: exactly one `nightlyIntegrityJob` trigger, no `INTEGRITY_ACTIVE_BACKUP` / `INTEGRITY_PENDING_BACKUP` property, no recovery hold.
3. Run `setupIntegrityTwoStage()` ONCE from the editor. It refuses otherwise, creates one 03:00 finalizer, and sets the flag last.
4. Next morning: `outpatient-pending-manifest-<day>` after 02:00, `outpatient-manifest-<day>` + `outpatient-verified-<day>` after 03:00, both executions well under 360 s, no alert e-mail. Only then is the backup "verified".

## Rollback

- **Before `setupIntegrityTwoStage()`**: nothing to roll back; code is dormant.
- **After activation, no pending set**: delete the `finalizeNightlyIntegrityJob` trigger, delete `INTEGRITY_TWO_STAGE_ENABLED`. Legacy job resumes next night. Certified v3 sets stay readable.
- **After activation, pending set exists** (Phase B failed): do NOT clear `INTEGRITY_PENDING_BACKUP` blindly. First re-run `finalizeNightlyIntegrityJob` once; if it fails again, inspect the failure, keep the last certified set as the recovery point, then clear the marker only with the owner's explicit decision and record it on #124.
- **Code rollback**: redeploy the previous Apps Script version on the existing deployment (never a new deployment). Any v3 set already certified remains valid for v2-style inspection.

## Sheets invariants

Headers append-only; snapshot families only ever added (`pending-manifest`, `verified` are new names matched by `INTEGRITY_DATA_SNAPSHOT_RE`). Manual tabs (`Sheet1`, `Copy of Clients`) are captured as `other-<hash>` and never deleted by retention.
