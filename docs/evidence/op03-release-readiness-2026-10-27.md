# OP-03 release-readiness observation — 2026-10-27

## Result

The isolated native acceptance is complete. Fresh, read-only observations of
the existing outpatient workbook and its October27 nightly snapshots identify
a separate real recovery-readiness gap: **the removed-leads archive still has
18 of the 21 current headers**. Both the source and that day's snapshot lack
the final `updatedAt`, `updatedBy` and `preferredHouse` headers. The other three
PR132-affected header prefixes match the candidate, in both source and snapshot.

The nightly manifest remains the legacy ten-dataset format. Its date does not
make it a complete version-2 operational recovery set. No source data, headers,
backup, configuration, trigger, code or deployment was changed during these
observations. The proposed three-cell correction below is **not applied or
authorized by this record**. No test-project phase was repeated.

## Bounded observations

The [machine-readable record](op03-release-readiness-2026-10-27.json) retains
metadata, exact header responses, empty-tail responses, canonical header arrays
and comparisons. Reads were complete by **17:24:47 UTC / 19:24:47 Israel** on
October27; they are separate point observations, not a coordinated capture.

- Inspected source: existing `EZONE OUTPATIENT`,
  `17dVBbOuf09c7dug1Tpq9Fr8_3fxfg0M87F9ChkGMCyc`, 21 observed tabs.
- Existing backup: `EZONE-Backups`,
  `1GTiMksHak6p6a8VxaAuJAjtTxlZ6ikF4cBLPDErFdOM`, 205 observed tabs including
  the Dashboard families. Both spreadsheet metadata responses report
  `Asia/Jerusalem`.
- Canonical schemas: `apps-script/Code.gs` at candidate
  `41678db096f9c72622fd7da80919cb94861af0c5`. Only four affected schemas were
  compared; this does not verify the other 15 registry schemas or live row data.
- This focused read did not refresh the deployed Apps Script version or its
  container binding, nor recompute any live snapshot manifest digest.

| Dataset | Required headers | Source | October27 snapshot |
| --- | ---: | --- | --- |
| Clients | 38 | Exact current prefix, including `preferredHouse` at38 | Same |
| Leads | 19 | Exact current prefix, including `preferredHouse` at19 | Same |
| Clients-removed | 41 | Exact current prefix, including `preferredHouse` at41 | Same |
| לידים שהוסרו | 21 | Exact first18; final3 absent | Same18-column prefix; final3 absent |

The removed-leads tab's allocated grid has26 columns and999 rows. The bounded
`S2:U999` unformatted-values read returned no rows. A second bounded
`S1:U999` read with `FORMULA` rendering also returned no rows, so the apparently
empty tail was not inferred from formula results alone. These are observations
at the read time, not permission to assume the tail will remain empty later.
No existing patient row payload was retained in this record.

### Why the new backup is still incomplete

`outpatient-manifest-2026-10-27` has the legacy columns
`id/source/snapshot/absent/sha256` and ten rows. `FinancialOps` is present in this
day's manifest, unlike the historical absent observation on October26; no claim
about its row payload or hash validity follows from this metadata read.

These nine registered operational sources exist in the inspected source
inventory but have no corresponding entries in that manifest:

`SessionLog`, `TherapistRates`, `Settings`, `StopFlags`, `ExtraSessionRequests`,
`מסלול המשך`, `התראות עצירת טיפול`, `AuditLog`, `RepairPlan`.

There is no October27 v2 recovery-metadata sheet among the observed backup tabs.
The two unclassified source tabs, `Sheet1` and `Copy of Clients`, also retain
their separate recovery-policy requirement. Neither they nor any manifest
entry may be deleted or merged merely to pass recovery validation. A complete
new v2 set must be captured and verified through the separately approved
production-readiness process; do not manually trigger the mail-sending nightly
job or repurpose the completed synthetic fixture to manufacture that evidence.

## Reviewable correction proposal — not executed

The current canonical removed-leads definition appends these three fields to
the exact existing18-column prefix:

| Exact source cell | Proposed header |
| --- | --- |
| `S1` | `updatedAt` |
| `T1` | `updatedBy` |
| `U1` | `preferredHouse` |

Before any separately approved correction, refresh the exact source workbook
and tab identity, the complete first18 headers, and the emptiness of S1:U1 and
S2:U999 using value and formula-aware reads. Refresh dimensions too: if the grid
or used bounds changed, the current fixed range is no longer sufficient. Check
recovery state and coordinate a pause of application and direct-editor writers.
Refuse an active or unreadable `OUTPATIENT_RECOVERY_HOLD` or active backup state.
The execution mechanism must establish the actual deployed script binding and
the applicable writer lock, and recheck these conditions after acquiring it.
A Sheets API write does not acquire an Apps Script lock, and a script lock alone
cannot exclude direct edits. Refuse if identity, prefix, tail contents, schema
or the agreed write conditions have drifted. This observation does not establish
that those execution prerequisites are already available or satisfied.

The entire proposed mutation is one values-only write to **S1:U1** containing
`updatedAt`, `updatedBy`, `preferredHouse`, followed by a full21-header readback.
Keep A1:R1, row order, existing values, formatting and all historical records
unchanged. Historical rows remain blank in the three appended fields; do not
invent who/when/house data. Do not modify old snapshots to make them appear ready.

The existing business removal handler calls `_ensureSheet` before appending a
tombstone and deleting a lead. **Do not manufacture a business action to force
schema initialization.** Nor is a blind `_ensureSheet` call the proposed
three-cell change: that helper rewrites A1:U1, freezes row1, and applies phone
and stamp-column formatting; the helper supplies no lock or recovery-hold check
itself. Preserve the narrow explicit configuration scope.

If post-write validation fails, retain evidence and coordinate investigation.
Do not automatically clear the headers or roll back columns after writers may
have resumed and used them. Successful header correction closes only this
schema-prefix gap, not the complete-backup, policy, runtime, alert or release
gates. No production authorization is inferred from the synthetic success.

## Current-head CI investigation and base reconciliation

### Initial observation

At the unchanged `41678db0` checkpoint, PR125 was open/draft/unmerged. Test has
an unfiltered `pull_request` trigger and a push trigger limited to the deployed
branch. Validate Workflows filters workflow-file changes, which remain in the
full PR diff. Neither CI workflow has manual dispatch or a draft exclusion.
The deploy workflow has explicit dispatch only; the live healthcheck has
schedule/dispatch. Those triggers do not match reopening a PR.

No exact-head runs/checks/statuses were observed. PR metadata exposed base
`336c8ef9`, and the corresponding local and GitHub comparisons showed that base
as ancestor, ahead 18/behind 0. A fresh `git merge-tree --write-tree` using those
explicit base/head SHAs succeeded without conflicts and returned exactly the
head tree `ffaaa99c6db3aafc18cce6f12ccb4fe3d3e1322a`. The authenticated PR UI
nevertheless reported **Checks awaiting conflict resolution**, naming
`CHANGELOG.md` and `EZONE-ECOSYSTEM-STATUS.md`; the required `test` check was
waiting for a status. No approval or disabled-workflow banner was observed in
that PR view. The apparent inconsistency was preserved rather than treated as
permission to reset the branch or fabricate an empty commit.

Claude's bounded static review in
[comment6448750267](https://github.com/sandrabrayer/ezone-outpatient/pull/125#issuecomment-6448750267)
supported the narrow header scope and cautioned that reopening cannot guarantee
a run while GitHub considers the PR conflicting. It did not inspect the live
workbook, execute tests or independently refresh GitHub's mergeability.

### Newly exposed actual base

The substantive readiness documentation was published first at `79b5f001`;
CI still did not start. One state-only close-and-immediate-reopen of the same
PR then completed. The PR returned to **open/draft/unmerged**, with head, branch,
title and body unchanged. The after-read newly exposed base
`b14db7991776f49fdcaee0a018dc0d67d371f8d2`, whereas the fresh before-read had
reported `336c8ef9`. No base-branch retargeting parameter was sent. A separate
read of the deployed branch's Git ref also returned `b14db799`.

This is the existing [PR133](https://github.com/sandrabrayer/ezone-outpatient/pull/133)
merge: GitHub records `merged_at` as **2026-10-26T17:33:05Z**, one day before the
readiness inspection. Its parents are `336c8ef9` and roster feature `ce3ed339`.
Thus the older PR-base response omitted a previously merged change. The exact
branch-ref update history was not audited; do not claim the close/reopen created
that merge or that a production deployment occurred during this inspection.

A new read-only merge computation against the actual `b14db799` base reports
exactly the two documentation conflicts named by the UI. The earlier clean
computation was correct only for the older explicit pair. The conflict and
missing-CI diagnosis is therefore reconciled without a speculative code change
or any second close/reopen attempt.

### Draft integration and validation

Integrate the already merged PR133 base into the existing OP-03 draft. Preserve
its Node authentication/roster logic, historical-assignee behavior, SW20 assets
and updated tests exactly. Retain both changelog sections; move the new roster
security note into current status rather than resurrecting superseded package
sections labelled unreleased. This is a draft integration, not a production
merge, a new CRM layout change or a repeat of PR133's release.

The actual runtime files `lib/users.js`, `server.js`, `public/app.js`,
`public/index.html` and `public/sw.js` match `b14db799` byte-for-byte. The complete
`apps-script`, `test-support` and workflow paths, plus package/dependency files,
remain identical to `dc09d5d3`. Code.gs remains 411,766 bytes with SHA256
`bd597c3991c0daf7dbd83ccebf634dc01c905bed62639a0d7af704fb559e6014`.
The frozen native-policy narrative, verifier identity and final-result record
are unchanged. No Google phase, verifier rebuild or live-data write follows
from this Node-only integration.

One full local UTC integration run on **Node 24.22.1** passes **1,787**, fails **0**,
and skips **38** of **1,825** tests. A fresh npm advisory read reports **zero
vulnerabilities** against the unchanged lockfile. This is local evidence; the
current-head remote test/browser result and bounded integration-review receipt
belong to the actual published head in PR125 and the canonical plan. Historical
`3297311c` results of 1,754 main tests plus 32 browser tests do not become the new
head's CI results. No runtime PIN values, Railway settings or logs were accessed.

## Return point

Keep all nine completed Google executions and both frozen evidence checkpoints.
The next steps are current-head CI, review of the exact header correction and
real capture/target-policy plan, then the required production decision. The
latest result and bounded review receipts are tracked in PR125 and the canonical
ten-system plan. The separate CRM display owner is unchanged. No production
merge or deployment, new Google project, state reset or completed-phase rerun
is authorized.
