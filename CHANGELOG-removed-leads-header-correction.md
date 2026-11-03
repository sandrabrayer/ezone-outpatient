# OP-03 removed-leads header correction — draft preparation

## 2026-10-28 publication recovery

This checkpoint publishes the standalone operator helper, its dedicated tests
and its runbook after the earlier GitHub approval request expired. It is a
review candidate, not an installed or executed production correction.

- `ops/removed-leads-header-correction.gs` is outside the deployment root and
  defaults to `OP03_HEADER_CORRECTION_APPROVAL = null`.
- `test/removed-leads-header-correction.test.js` exercises the helper with
  synthetic service doubles. New-head execution results must be read from CI;
  historical test results from 1c1cdf4a are not results for this new file.
- `docs/removed-leads-header-correction.md` records the fixed identity, exact
  three-cell scope, coordinated-pause prerequisites and uncertain-outcome rules.

The proposed mutation remains S1=updatedAt, T1=updatedBy, U1=preferredHouse in
sheet 1894136505 of the existing outpatient workbook. Sandra's approval covers
these cells conditionally, not installation of production code or deployment.
The helper has a read-only preview, timestamp-bound approval, ScriptLock,
strict property/identity/schema checks, formula-aware blank-tail checks, one
values-only write, flush and locked verification. Application polling, direct
editors, integrations and scheduled/manual jobs must be paused separately;
absence of draft OP-03 properties does not establish legacy-backup idleness.
No automatic retry, rollback, broad header initialization or business action
is permitted after an uncertain result.

This publication deliberately adds four new files only. It does not rewrite
existing README, changelog history, ecosystem status, deployment documentation,
production runtime, dependencies, workflows or frozen native-drill evidence.
Root changelog and cross-document integration remain a follow-up before release.
The unpublished wider documentation reconstruction is not included in this
checkpoint, and its old proposed tree is not claimed to match this subset.

Independent review and new-head CI are still required. No Google function was
run; no helper was installed, source cell changed, backup job invoked, project
created, state reset, phase repeated, production branch merged or deployment
started. Preserve all nine completed native executions and their evidence.

Return point: review this exact candidate, resolve any findings, complete its
validation and documentation integration, then obtain the separate mechanism
installation approval and establish a real maintenance window. Full v2 backup,
real target/manual-tab policy, release/alert evidence and production approval
remain separate OP-03 gates. CRM display stays with its separate chat; the
full ten-system integrity, security, performance, control and finance program
remains in scope.

## 2026-10-28 hardening and documentation integration

Tests and documentation only; `ops/removed-leads-header-correction.gs` and all
runtime and frozen-evidence files are unchanged. This follow-up supersedes the
"four new files only" and "integration remains a follow-up" statements above for
documentation: small additive notes now exist in the root changelog, README,
DEPLOY and ecosystem status. The helper stays uninstalled and default-disabled.
Sandra's three-cell consent remains conditional; no new production approval
exists. The nine native Google executions remain completed and are not rerun.

- Two regressions: `releaseLock` throwing after a read-only preview and after a
  verified write. Both require a sanitized error, `lockReleased:false`, exactly
  one release attempt and no retry or rollback; the simulated lock stays
  `held=true` (unresolved). Their author could not execute them (command
  denied); read results from CI.
- Runbook clarifications: the pinned hash covers existing `Code.gs` only and
  needs a full file inventory before and after installation; preview takes the
  lock and scans cells so it belongs inside the pause; the legacy backup must be
  independently drained and the 02:00-03:00 hour alone is not proof; formats and
  native metadata are not fingerprinted; clock skew causes safe refusal.
