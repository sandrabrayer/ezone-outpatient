# Source deployment ordering — 2026-10-17

## Problem and evidence

PR #115 merged as `76de4cc5a07057519cf1658a60a9a72f1a76d337`.
Railway's existing Wait for CI setting waited for the source workflow, while
that push-triggered workflow waited for the same Node SHA to go live. The first
source attempt timed out before push/deploy; Railway skipped its deployment.

After Sandra explicitly approved the exact commit deployment despite only that
wait failure, Railway deployment `b6a7fa72-2306-4ef6-9461-2abacad447f8` succeeded.
Independent HTTP checks returned that SHA and healthy Node. The source job was
then rerun: run [39051916594](https://github.com/sandrabrayer/ezone-outpatient/actions/runs/39051916594),
job `117455982926`, confirmed existing deployment @94 at 17:20:06 UTC.
A signed-session settings read succeeded through Node/source; anonymous Node
and direct source dummy probes were rejected. No business records were written.

## Change

- Remove only the source workflow's automatic push trigger. Existing test and
  YAML workflows and Railway's settings/checks remain unchanged.
- The releasing agent/operator waits for approved Node readiness, then triggers
  `workflow_dispatch` on the production branch with required `expected_commit`.
  [GitHub's dispatch documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
  covers the Actions UI/API; the workflow must be on the default branch, which
  was verified as `claude/youthful-volta-laarnk` for this repository.
- Reject wrong event/ref, invalid SHA or branch advancement. Keep exact live
  SHA and health checks; execute all of them before source credentials/writes.
- Keep the existing deployment ID/URL, source auth, clasp version, concurrency
  and unconditional runner-credential cleanup. No dependencies, schema, UI,
  billing calculations or patient data change.

This is an operational tradeoff: source deployment is an explicit second phase,
not automatic on merge. Its omission leaves old source live, so the release
owner must record completion of both runtimes. The full SHA input prevents an
accidental newer-branch dispatch; it is not a replacement for Sandra's approval
or repository access control. Serialize releases; source concurrency cannot
prevent another operator from deploying a different Node version mid-release.

## Validation

- 14 new target/order regression cases, including an actual failing CLI process.
- Focused source authentication + release gate: 146 passed, 0 failed.
- Full suite, Node 24.19.0, `TZ=UTC npm test -- --test-concurrency=1`:
  1,288 total, 1,279 passed, 0 failed, 9 browser skips. Dedicated browser CI is
  a separate required release check; local skips do not prove browser behavior.
- All five workflow YAML files parsed; source trigger is dispatch-only and the
  full SHA input is required. No new dependency; audit: 0 high/critical,
  1 existing moderate finding.
- This candidate has not been dispatched against production. First-release
  acceptance below remains necessary; local tests cannot prove provider timing.

## Release and rollback

1. Verify candidate CI including the dedicated browser job and refresh the
   current production branch. Obtain Sandra's separate approval for this PR.
2. Merge; check ordinary CI finishes and Railway deploys without waiting on a
   source workflow. Verify `/api/version` exactly equals the merge SHA and
   `/healthz` succeeds. A failed check is not permission to override it.
3. Dispatch this workflow on the production branch with that approved full SHA.
   Require a successful existing-deployment publication and record the version.
4. Verify an authenticated read plus anonymous Node/source rejection without
   changing patient/payment data. Record three request timings as observations,
   not a full performance baseline. Preserve OP-02 and CRM draft branches.

If the target/readiness check fails, do not dispatch a different SHA to force
success. Refresh the branch and deployment state and resolve the mismatch.
If the source publication fails, keep the release open and inspect that Actions
job; credentials are cleaned even on failure. Do not change Railway settings
or create another Apps Script deployment. Retrying the same approved target
after its cause is corrected is allowed only while it still matches live Node.

Prefer a forward workflow repair. Reverting this PR restores the circular push
dependency and is not a safe automatic rollback. Source auth remains in place;
do not roll back to the unauthenticated source or credential-free Node. A web
version rollback also does not revert Apps Script Head used by scheduled jobs.
Any production recovery beyond the approved release requires its own concrete
plan and approval; no code rollback restores or rewrites business data.

Next work: refresh the isolated OP-02 lock-fix branch on the released base,
then repair renewal retry and partial charge/payment saves. Do not conflate
this release-mechanics fix with those still-open financial defects.
