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
