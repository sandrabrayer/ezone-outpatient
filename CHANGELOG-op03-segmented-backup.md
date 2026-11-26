# OP-03 #124: nightly backup in time-budgeted, self-resuming segments

25 Nov 2026 · Issue #124 · base `claude/youthful-volta-laarnk` (`9cf17fc`).

## Why

Google kills an Apps Script execution at 360 s, and a killed run cannot run its
`finally` block. The legacy single-run nightly backup sat right at that limit
in production. Durations: 16 Nov 275.668 s; 17 Nov 360.883 s (Timed Out);
23 Nov 341.678 s; 24 Nov 360.864 s (Timed Out). Each timeout stranded
`INTEGRITY_ACTIVE_BACKUP`, and every following night refused with `backup_busy`.
This happened twice (18–22 Nov and 25 Nov). Clearing the marker by hand only
resets the cycle.

## What changed (`apps-script/Code.gs`)

- **Segments.** In legacy mode (production today) a segment starts no new
  snapshot write after **200 s**. It then records its progress in
  `INTEGRITY_RESUME_BACKUP` and schedules **one** one-shot
  `resumeNightlyIntegrityJob` trigger for one minute later.
- **One consistent set.** Every segment re-captures all sources under the
  existing capture lock. It skips a snapshot only when that snapshot's checksum
  is unchanged and the sheet exists, and rewrites any snapshot that changed. The
  published set therefore always equals the **last** capture instant. The
  manifest, the full independent readback validation (`_integrityValidateRestoreSet`)
  and the alert/sentinel semantics are unchanged. They run once, at the end.
- **Head-room for the final step.** The manifest and full readback start only
  when ≤ 120 s have passed in the segment; otherwise they get a fresh segment.
  Retention stops deleting at 290 s. Retention is idempotent, so any tabs left
  over are removed the next night.
- **Watchdog.** Each segment first arms a 35-minute continuation trigger. If
  Google kills the segment anyway, the watchdog resumes the same night from the
  progress recorded after every write.
- **Dead marker retirement.** A well-formed `INTEGRITY_ACTIVE_BACKUP` whose
  `startedAt` is older than `INTEGRITY_DEAD_EXECUTION_MS` (30 min, 5× the hard
  limit) belongs to an execution that cannot still be alive. The job retires it,
  writes an audit record to `INTEGRITY_LAST_STALE_ACTIVE`, sends an alert e-mail
  and continues. A young, malformed or `startedAt`-less marker, any
  `INTEGRITY_PENDING_BACKUP`, a recovery hold and staged (v3) mode all keep the
  fail-closed `backup_busy` / owner-decided path. Recovery cutover
  (`beginOutpatientRecovery` / `finishOutpatientRecovery`) never retires markers.
- **Bounded.** At most 8 segments per night. A real failure (write error,
  continuation trigger not creatable, cap reached) alerts once, drops the
  progress and schedules nothing: there is no automatic retry loop.
- **Repo hygiene.** `.gitignore` now lists the generated `test-support/google-two-stage-drill-candidate.gs` (rebuilt by `npm test` and CI).
- **Unchanged.** Staged v3 (`INTEGRITY_TWO_STAGE_ENABLED`) stays dormant and
  behaves as before. No new OAuth scope is needed (`script.scriptapp` is already
  in `appsscript.json`). No Sheets headers, no other triggers, no Node/UI change.

## Tests

`test/nightly-segmented-backup.test.js` has 17 tests, run against the real job
with synthetic Google services: multi-segment run publishing one verified set;
a source edit between segments; dead / young / malformed / no-`startedAt`
markers; staged mode and a pending set; the watchdog delay; resume after a hard
kill; a continuation without progress; old-day progress; the segment cap; a
write failure; a continuation-scheduling failure; the finalize head-room rule;
the retention deadline; and the budget margins. Existing source-scan and
recovery tests were updated for the delegating `nightlyIntegrityJob` and for
the narrowed "never auto-clear" rule. The Gate 0 builder allows `ScriptApp`
only in the two continuation-trigger helpers, which staged mode never calls.

## Rollback

Redeploy the previous Apps Script version on the existing deployment. Then
delete any `resumeNightlyIntegrityJob` trigger and the `INTEGRITY_RESUME_BACKUP`
property. The legacy single-run job resumes.

## Security

No secrets or patient data in logs or properties. Property values hold only run
IDs, timestamps, snapshot names and checksums. Every inconsistency fails closed.

## 26 Nov 2026 — production verification

The first night after deploy (`20fb90f`) ran in two segments:
`nightlyIntegrityJob` completed in 143.672 s and `resumeNightlyIntegrityJob` in
35.772 s. The stranded 24 Nov marker was retired automatically, with an alert.
`outpatient-manifest-2026-11-26` has 26 entries, and every referenced tab is
present. No failure alert. #124 is closed.
