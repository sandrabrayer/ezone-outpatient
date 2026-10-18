# Financial write lock refusal — OP-02a

Refreshed 2026-10-18 from released production `941cd8b62f9d7d31aee7fe3dc33c29305473eb83`.
Branch: `codex/op02-locks-auth-20261018`. Supersedes the preserved queued
`codex/op02-financial-locks-20261016` candidate; do not merge both.

## Problem and change

`_upsertPayment` and `_upsertCharge` ignored `tryLock(10000)` returning false.
They could write concurrently and release a lock they did not acquire. Each
now returns `{ ok: false, error: 'busy' }` before any Sheets access when the
lock is refused. The four remove handlers already use throwing `waitLock`
before their write/release block; no delete code change was needed.

Only two production-code lines change. Released OP-01 authentication and
PR #116's explicit source-deployment gate are retained without changes.
There is no schema, calculation, permission, dependency, frontend or cache
change. Same-id retries use the existing upsert, not a new transaction or
stale-edit prevention mechanism. Historical data is not repaired.

## Verification

- 64 cases execute real `doPost` and financial handlers with in-memory Google
  services. Negative control on the released base: **54 pass, 10 fail**.
  Fixed code: **64 pass**.
- Covers authorized create/update aliases, refusal before source access,
  existing-row preservation, simulated competing saves, owned-lock release on
  write errors, release exceptions, same-id retry after ambiguous append and
  four deletion paths. All eight actions also deny missing, wrong, consumer-only
  and unconfigured credentials before lock/Sheets access, preserving OP-01.
- Combined financial/authentication tests: **196 pass, 0 fail**.
- Full local `TZ=UTC npm test -- --test-concurrency=1 --test-reporter=tap`:
  **1,352 total, 1,343 pass, 0 fail, 9 browser skips** (Node 24.19.0).
  Candidate CI (Node 22) and the required `lead-save-browser` job are separate
  release gates, not inferred from local results.
- `npm audit`: **0 high, 0 critical, 1 existing moderate (`qs`)**; dependencies
  unchanged. The audit exits 1 for the moderate finding.
- The diagnostic executes actual frontend handlers with synthetic services.
  It reconfirms renewal cycle drift, retained unconfirmed paid state, and now
  proves that a client-row conflict still allows a payment attempt. These are
  unresolved OP-02b findings, not passing acceptance tests. Details and recovery
  requirements are in `docs/financial-write-integrity.md`.

No live financial rows were read or written. Fixture contention is not a native
Google concurrency/load test. There is no UI change requiring visual acceptance
or a service-worker bump in OP-02a. OP-02b will require both.

## Release and rollback

Prepare one draft PR to `claude/youthful-volta-laarnk`, request bounded Claude
review, verify the exact head and all CI, then obtain Sandra's separate approval.
No OP-02 release approval has been given. Preserve other drafts and both prior
released protections. No Railway settings, variables, logs or secrets needed.

After approval, the releasing operator must complete BOTH phases in `DEPLOY.md`:
merge; verify the exact Node SHA and health; dispatch Deploy Apps Script on the
production branch with that full `expected_commit`; require success and the
existing deployment's new version; verify authenticated and denied read paths
and time three homepage requests. Recheck the approved head if the branch moves.
Do not write dummy charges/payments in production to test contention.

Baseline is Node `941cd8b6` and source @95 (last release evidence). For an urgent
rollback, obtain approval and use the established repository/workflow procedure;
retain OP-01 auth and PR #116's gate. A revert restores the known lock-refusal
bug, so prefer a forward correction. Reverting only the deployed web version
does not revert Apps Script Head, and code rollback does not restore data.

Immediate return point: **OP-02b renewal/partial-save recovery**, before speed
or another app. Source lock refusal does not fix UI retry identity, ambiguous
multi-step outcomes, intake/lead activation or orphan-payment deletion.
