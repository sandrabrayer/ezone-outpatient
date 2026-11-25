# OP-03 #124 — segmented nightly backup: release and verification runbook

## Incident (owner-verified production Executions)

| Night (Israel, 02:21) | Result | Elapsed |
| --- | --- | --- |
| 16 Nov | Completed | 275.668 s |
| 17 Nov | **Timed Out** | 360.883 s |
| 18–22 Nov | Failed (`backup_busy`, stranded marker) | 1–5 s |
| 23 Nov (after manual marker removal) | Completed | 341.678 s |
| 24 Nov | **Timed Out** | 360.864 s |
| 25 Nov | Failed (`backup_busy`) | 2.556 s |

Root cause: a single execution does capture, about 26 snapshot writes, the full
readback and retention, on a ~411-tab backup workbook. That work sits at
Google's 360 s hard limit. A killed execution cannot clear its own marker.

## Fix

The fix is described in `CHANGELOG-op03-segmented-backup.md`. In short:

- a segment stops starting writes after 200 s;
- the final verification starts only before 120 s;
- retention stops at 290 s;
- a one-shot `resumeNightlyIntegrityJob` trigger continues the run;
- a 35-min watchdog covers a killed segment;
- a marker older than 30 min is retired automatically, with an audit record and an alert;
- at most 8 segments per night.

## Release (each step after Sandra's approval)

1. Merge the PR into `claude/youthful-volta-laarnk`. Wait until
   `/api/version` shows the merge SHA (Node content is unchanged).
2. Dispatch **Deploy Apps Script** on `claude/youthful-volta-laarnk` with
   `expected_commit` = merge SHA. This redeploys the existing deployment.
3. No Script Property edit, no trigger edit, no manual run. At the next 02:21
   the job finds the 24 Nov marker (> 30 min old), retires it with an alert
   e-mail ("Stale backup marker retired automatically") and runs.

## Verification the next morning (owner, Apps Script editor, read-only)

- **Executions:** one `nightlyIntegrityJob` plus zero or more
  `resumeNightlyIntegrityJob` runs, each **Completed** and each under 360 s.
- **Triggers:** only `nightlyIntegrityJob`. No `resumeNightlyIntegrityJob` left.
- **Script Properties:** `INTEGRITY_ACTIVE_BACKUP` and `INTEGRITY_RESUME_BACKUP`
  absent; `INTEGRITY_LAST_RUN` = that night; `INTEGRITY_LAST_STALE_ACTIVE`
  present (one-time record of the 24 Nov marker).
- **EZONE-Backups:** `outpatient-manifest-<day>` exists. It is written only
  after the job's full checksum readback passes.

Agent-side check without the editor: the new dated manifest is in the Drive
inventory, and no `backup_busy` / failure alert arrives.

## If something goes wrong

- Alert "8 segments" or "continuation" failure: the run stopped with no retry.
  Keep the last good manifest and investigate Executions. The next night starts fresh.
- A young or malformed marker still refuses with `backup_busy`, by design.
  Investigate; never delete it by hand without checking Executions first.
- Rollback: redeploy the previous Apps Script version. Then delete any
  `resumeNightlyIntegrityJob` trigger and `INTEGRITY_RESUME_BACKUP`.
