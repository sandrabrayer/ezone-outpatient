# OP-BILL-01 — release acceptance, 2 November 2026

**Decision: NO-GO for production; continue with existing #162 / #152.** This is completion of the safe release checks requested in the #331 handoff. It does not authorize a merge, source deployment, credential/permission change, historical reconciliation or data repair.

## Candidate and deployed baseline

- Starting candidate: PR #162 at `7daaf3ebce5260f31a34034367f400b638de0ea4`, based on `98c49c72396b76082498826ab7aa51890b89e9cb`. The baseline is an ancestor; merged #158 and #161 are retained. No new PR or alternative billing engine.
- Public unauthenticated production checks returned commit `98c49c72396b76082498826ab7aa51890b89e9cb`, builtAt `2026-11-02T13:53:37.657Z`, health `ok:true`, SW `ezone-outpatient-v23`. Candidate cache v24 is strictly newer.
- Latest recorded source deployment: [Actions 41451521943](https://github.com/sandrabrayer/ezone-outpatient/actions/runs/41451521943), SUCCESS, source commit `36177f442cc34d0433f557070d508f219bcb5f03`, existing deployment version **101**. Its Code.gs is byte-identical to the current deployed Node baseline's source. This is deployment-log evidence, not a new attestation of Google HEAD or Script Properties.
- Deployed-source Code.gs SHA256: `30a7684c851ad68d02ea85331288e4a15c4ab6d2e3141eddc8cb8cc33ea96649` (386,014 bytes). #162 source SHA256: `e80923944b980f0fa20668de603de807852632c7c38ae6858d5931f0da74ba61` (388,249 bytes). The acceptance patch does not change Apps Script.

## Real blocker corrected in this pass

The final card renderer hid #161's safe missing-receipt confirmation under the newer paid-period review label. Reproduced through Chromium, the real local Express server and real Apps Script handlers with in-memory dummy Sheets. The regression failed before the patch and passed afterward.

The existing guarded confirmation is now retained only for a genuinely missing receipt with a valid historical cycle. Disputed paid rows and irregular anchors still offer no quick confirmation. Confirmation writes exactly one synthetic receipt, preserves the historical service window and next date, survives reload and an independent Oren session, and never offers a repeated confirmation. Ambiguous old coverage remains review-only; the patch does not redate old rows.

## Financial and recovery checks

| Check | Executed evidence / limit |
| --- | --- |
| Paid 25 Oct → inclusive 24 Nov → next 25 Nov; paid 15 Oct → 14 Nov → 15 Nov | Browser/Apps Script policy parity and paid-through suites |
| Short months, leap years, impossible dates, future dates | Actual source helpers and UI module; 31 focused tests also passed under Asia/Jerusalem and America/Los_Angeles |
| Partial/unpaid/zero amounts, explicit multi-month advance, gaps, duplicate coverage | Existing policy, ledger and journal regressions; historical source objects unchanged |
| Persisted source → card → next collection → revenue | Former TODO now executes actual source saves. Feb 25–Mar 24 renewal allocates 600 as 85.71 + 514.29; explicit Nov–Dec advance retains 61 days and allocates 6,100 as 3,000 + 3,100. Both card and stored next date agree; reads do not mutate history |
| Renewal, lost reply, partial commit, another device, duplicate submit | Real browser + server + Code.gs financial suite; no second receipt or cycle |
| #158 save stamps/discharge and #161 missing historical receipt | Existing base retained; browser save suites plus the two new rendered-card regressions |
| Old policy → new source | Six new transition cases use the verbatim old validator: prepared, client-written and payment-written old intents finish with the ORIGINAL dates, one payment |
| New UI → old source during deployment | New paid-date renewal intent refused with `renewal_period_changed`, no client/payment/journal effects |
| Source downgrade | A pending new-policy journal blocks the old validator; acknowledged history remains readable and unchanged. Never blindly downgrade while new operations are pending |
| Backup/restore after interrupted payment | Existing actual-source manifest validation and isolated in-memory restore tests passed, including resuming without duplicate effects |
| Credits, refunds, revenue, package permissions, auth, stale writes | Full candidate test suite and browser suites; these do not prove production records or actual-user UAT |

Final local candidate full run, Node 22 / TZ UTC with Chromium available: **1,750 total, 1,750 pass, 0 fail, 0 skipped, 0 TODO**. This includes all 40 browser cases discovered by the full runner, beyond the dedicated CI browser set of 33 (28 financial, 3 lead save, 2 protected-price). Initial browser launch failures were missing local runtime binaries; after fixing only the runtime path the final complete run above passed. The 15 policy/transition cases also passed separately under Asia/Jerusalem and America/Los_Angeles. Final GitHub CI on the published exact head is linked on PR #162; its Node-only job deliberately skips browser cases which need their separate browser environment.

Dependency audit: **0 high, 0 critical, 1 moderate**. No dependency changes. No live patient/payment rows or credentials were read.

## Backup evidence improved, native restore remains open

Read-only Google Drive discovery found the existing `EZONE-Backups` workbook and today's `outpatient-manifest-2026-11-02`. Read only its **A1:E11 manifest metadata**, not customer/payment rows. It contains the expected ten sources, each `absent=0` and a 64-character SHA256: Clients, Leads, removed leads/clients, Payments, ClientCharges, Credits, FinancialOps, PackageCatalog, PackageRequests. Matching dated snapshot tab names exist.

This proves a dated manifest and named backup set exist. It does **not** independently recompute those hashes, prove source freshness/completeness, or execute a native restore. The 9 October native drill is historical and cannot certify today's code. #140's witness is still a draft, not installed/executed, and its original expected source hash predates #158. Re-pin to the approved actual target before any authorized witness run. Do not bypass the trusted-workflow guard or dispatch the deployment workflow to obtain a read witness.

## Existing CRM / OP-03 compatibility — local experiment only

Pinned inputs: CRM #148 (includes #142–147) `2520d957336c53963e6c55b70489ae755bd6fc5d`; OP-03 #160 (includes #139) `6673e1ef25f8c758abd475bf74c5e138e568cc1b`; witness #140 `5b3d0e496fdf5920907030f1835029539d0a81ac` reviewed separately. No remote branch or PR was merged or changed for this experiment.

A disposable detached local combination retained the #162 base and policy, CRM/OP-03 code and this acceptance fix. Resolved only changelog, test-workflow union and SW v24 conflicts. Tested combined tree: `5b650c72ab1c24eb6fb80f2881d0c149b4a527e3`. This is **not a release candidate** and was not pushed.

- Combined full test result: **2,047 total, 1,964 pass, 40 fail, 42 skipped, 1 TODO**. No failures are represented as green or excluded from the result.
- Failure groups: 28 native-drill/helper cases require the old 19-dataset registry; 8 backup/registry assertions assume pre-CRM family counts or exact old lists; 3 #160 transition cases assume CRM schemas are absent; 1 frozen generated-drill reproducibility check differs from the new source. Preserve historical evidence; prepare a newly pinned current-source drill and explicit old/new schema fixtures. Do not simply replace counts or hashes to green the suite.
- Exact affected test files: `google-manual-policy-drill.test.js` (24), `google-operational-drill.test.js` (5, including reproducibility), `nightly-backup-data.test.js` (3), `op03-crm-typed-coverage.test.js` (3), `operational-recovery.test.js` (5). The compatibility experiment preceded replacement of the standalone policy TODO; its pinned-tree counts above are preserved as executed.
- Combined real-browser financial, money-scope and CRM activity cases passed (32 unique cases). This does not override the red full suite or replace a native restore.
- A direct-API synthetic probe on **#162 alone** confirmed Dana receives financial fields and forwards `getPayments`/`savePayment` (HTTP 200). In the combination with existing #142, money fields are stripped and both actions are HTTP 403 with **zero upstream calls**. This is an existing source access gap; the needed implementation already exists in #142. Do not duplicate it or declare #162 independently permission-complete.
- #157 remains an older integration lane that lacks the current deployed hotfix baseline; do not release it as-is or independently release overlapping billing branches.

## Concrete remaining release gates and order

1. Reconcile the existing #142–148 and #139/#160 work on the central program's one approved release candidate; retain this #162 fix. Complete the current-source backup/drill fixtures without rewriting old evidence. Full combined tests must be green.
2. Under separately authorized isolated Google execution, verify source/project/binding, current typed backup and native restore, financial journal replay, writer pause and real staff-role UAT. Today’s manifest and historical @101 log are supporting evidence only.
3. Record fresh read-only, separately authorized financial reconciliation for ambiguous legacy examples; no automatic repair or history migration. Ordinary new monthly payments and explicit historical periods remain different cases.
4. After Sandra's separate release approval, verify the exact approved Node SHA is live, then use the existing explicit Apps Script phase with that same full `expected_commit`. Do not dispatch it now. Pause financial writers during mixed-version transition, including open old tabs, and require fresh clients before reopening writes.
5. Before any rollback, inspect pending FinancialOps under the approved procedure. A new-policy pending intent cannot be replayed by @101: preserve it, prefer the reviewed compatible source/forward fix, and do not reset rows or journal flags. Acknowledged history is readable by the old validator but reverting still reintroduces the old policy. Keep the intended previous Node/source/SW references and a monotonic cache strategy in the approved release record.

No Claude task was needed for the focused correction. Any broader OP-03 fixture qualification remains with its existing owner; all results belong in #152 and central #331. No production action was performed.
