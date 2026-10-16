# Financial write lock refusal — OP-02a

Prepared 2026-10-16 from deployed branch `claude/youthful-volta-laarnk` at
`afa9e8c0d4e3e04a9eabd7230db59a27030dee67`.

## Problem and change

`_upsertPayment` and `_upsertCharge` ignored `tryLock(10000)` returning false.
They could write concurrently and release a lock they did not acquire. Each
now returns `{ ok: false, error: 'busy' }` before any Sheets access when the
lock is refused. The four remove handlers already use throwing `waitLock`
before entering their write/release block; no delete code change was needed.

Only two production-code lines change. This is not a multi-sheet transaction,
new idempotency service, stale-edit conflict check or repair of historical data.
There is no schema, billing calculation, permission, dependency, frontend or
service-worker change. Source authentication remains the separate OP-01 #115.

## Verification

- `test/financial-write-locks.test.js`: 30 cases execute actual `doPost` and
  handlers with in-memory Google services. **Negative control on the deployed
  base: 20 passed, 10 failed. Fixed code: 30 passed.**
- Covers create/update aliases, busy/throwing acquisition before source access,
  preservation of existing rows, simulated competing saves, owned-lock release
  on write errors, same-id retry after an ambiguous append, and four deletion
  paths including unrelated-row preservation and repeated bulk deletion.
- Full local `TZ=UTC node --test --test-concurrency=1`: **1,164 total,
  1,155 passed, 0 failed, 9 browser skips**. Local runtime Node 24.19.0;
  repository CI uses Node 22 and remains a required release gate.
- `npm audit`: 0 high, 0 critical, 1 existing moderate. Dependencies unchanged.
- The two-line source patch applies cleanly to the tested OP-01 worktree.
  This is an application check, not a combined runtime/CI acceptance result.
- Synthetic execution of two real UI handlers proves unresolved partial-save
  issues, documented in `docs/financial-write-integrity.md`. The diagnostic is
  not an acceptance test and does not make those failures acceptable.

## Release and return point

Branch `codex/op02-financial-locks-20261016` is held separately while #115 waits
for owner configuration and explicit production approval. No second PR,
merge, deployment, configuration change or production write was performed.
No CI run is claimed for this branch: the current test workflow triggers on
PRs or pushes to the deployed branch, not on this isolated branch alone.

After #115 closes, refresh the deployed base, preserve its auth changes,
reapply/rebase this candidate, rerun relevant integration/full CI, prepare the
next PR and obtain the separate production approval. Verify the existing
Apps Script deploy workflow and live Node commit after any approved merge.
Never manually paste source or create a new Apps Script deployment.

Next implementation is **OP-02b: failed-payment UI state and renewal retry
identity**, before proceeding to performance or another app. OP-02 as a whole
remains open. Reverting the two checks would restore the known concurrency
bug; prefer a forward correction. Any rollback needs separate approval and
must retain OP-01 authentication; code rollback does not restore data.
