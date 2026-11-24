# OP-03: two-stage nightly backup with independent recovery certificate (DRAFT #199)

22 Nov 2026 · Issue #124 · supersedes the narrow retention PR #198 (its single-inventory retention is included).

**Why.** The production nightly job timed out on 17 Nov (360.883 s) inside one Apps Script execution; no complete verified OUT manifest exists in `EZONE-Backups` after that day.

**What.**
- Phase A (`nightlyIntegrityJob`, existing 02:00 trigger): source sentinel/orphan check, locked capture of every typed and manual source, per-sheet published snapshots, `outpatient-pending-manifest-<day>`, `INTEGRITY_PENDING_BACKUP`. No certification, no retention, no sentinel advance.
- Phase B (`finalizeNightlyIntegrityJob`, one 03:00 trigger installed only by `setupIntegrityTwoStage()`): independent re-read of every snapshot with typed SHA checks → final manifest → `outpatient-verified-<day>` certificate bound to run ID and manifest hash → retention → source inventory and sentinel → clear pending last.
- Recovery schema v3 refuses an uncertified set; v2 legacy sets remain readable. All failure paths fail closed, nothing auto-clears a marker.
- **Behaviour is unchanged until an operator runs `setupIntegrityTwoStage()`** (Script Property `INTEGRITY_TWO_STAGE_ENABLED=1`).

**Tests.** `test/op03-two-stage-backup.test.js` (A→B, interrupted A, tamper, certificate loss + retry, stale/duplicate markers, manual tabs, v2 compatibility, retention failure, installer, flag disabled mid-run, sentinel parity, capture-time witness) and `test/nightly-time-budget.test.js`. Synthetic Google services only.

**Not proven.** Native Apps Script timing and restore in an isolated project — see `docs/OP03-TWO-STAGE-BACKUP-RUNBOOK-20261122.md` (Gate 0). No production backup is certified by this PR.

**Security.** No secrets in code or logs; property names only; fail-closed on every inconsistency.

## 23 Nov 2026 — task 2 completion round (still DRAFT, not released)

- **Monitoring fix:** finalizer refusals previously threw without an alert e-mail (a missing Phase A was silent). Every refusal except an intentional recovery hold now alerts. Markers are still never cleared automatically.
- **Interrupted run:** `abandonPendingIntegrityBackup(runId, reason)` — editor-only, exact run ID, reason 10–500 chars. Refuses when an execution may be alive (ACTIVE of another run, or of this run < 30 min) and when the day is already certified. Clears a hard-killed run's own stale ACTIVE marker (> 30 min). Deletes no sheet, advances no sentinel/inventory, records `INTEGRITY_LAST_ABANDONED_BACKUP`, alerts.
- **Manual tabs:** `draftOutpatientManualPolicy(backupId, day)` — read-only draft from a certified set; v3 policy path tested (certificate required, pending run blocks, archive overwrite/drop refused).
- **#195 integration:** `test/op03-group-journal-integration.test.js` (skips on #199-only trees, runs on the combined tree): pending group intent certified as-is, cutover refused while pending, single resume after restore, missing journal refused, tamper caught. Gate 0 builder seeds one committed group row on combined sources; shared historical fixture unchanged.
- **Tests:** `test/op03-v3-manual-policy.test.js` (10), `test/op03-two-stage-ops.test.js` (9), integration (10). #199: 2,563 tests / 0 fail / 9 skip; combined #195 tree: 2,625 / 0 fail / 1 skip. Native Gate 0 not re-run (`nightlyIntegrityJob` and the finalizer success path unchanged); one native run on the combined candidate is required before release.

## 24 Nov 2026 — combined Gate 0 harness

- Builder (combined sources only): real `_soJournalRows` / `_soResumeOp` in the closure; fixture adds an interrupted group report (pending intent). Template: verify requires the certified set to hold 1 committed + 1 pending group row; restore resumes the pending intent once natively and proves a repeat retry is a no-op. #199-only artifacts unchanged in behaviour.
- `runTwoStageDrillAuto`: one-click sequential run via one-shot triggers in the isolated project (stops on failure, 40-step budget, never bypasses the fresh-project guard). Upload manifest adds `script.scriptapp` (sandbox only).
- Tests: `test/google-two-stage-drill-auto.test.js`. #199 local: 2,569 tests / 0 fail / 10 skip. Combined candidate `eb510e9` (local): 2,631 / 0 fail / 1 skip.
