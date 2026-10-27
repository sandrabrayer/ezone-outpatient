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

## Current-head CI investigation

At the unchanged41678db0 checkpoint, PR125 is open/draft/unmerged. Test has an
unfiltered `pull_request` trigger and a push trigger limited to the deployed
branch. Validate Workflows filters workflow-file changes, which remain in the
full PR diff. Neither CI workflow has manual dispatch or a draft exclusion.
The separate deploy workflow has explicit dispatch only; the live healthcheck
has schedule/dispatch. Their triggers do not match reopening a PR.

No exact-head runs/checks/statuses were observed. Both local and GitHub
comparisons show the deployed base336c8ef9 as ancestor, ahead18/behind0, while
the PR metadata reports dirty with no merge SHA. A fresh `git merge-tree
--write-tree` using those explicit base/head SHAs succeeds without conflicts and
returns exactly the head tree `ffaaa99c6db3aafc18cce6f12ccb4fe3d3e1322a`.
The authenticated PR UI nevertheless reports **Checks awaiting conflict
resolution**, naming `CHANGELOG.md` and `EZONE-ECOSYSTEM-STATUS.md`; its required
`test` check is waiting for a status. There is no observed approval or disabled
workflow banner in that PR view. This is inconsistent evidence; the cause of
the stale/conflicting mergeability signals is unproven. Do not infer an actual
tree conflict or a particular
credential class, reset a branch, fabricate an empty commit or rerun old-head
jobs to claim current-head acceptance.

Publish these substantive documentation observations to the existing branch
first, then inspect the new head, mergeability and CI. If the contradictory
state persists, a possible bounded recovery is one close-and-immediate-reopen
of the same draft PR, with exact head/base/draft guards and a fresh conflict-free
merge computation. This may request recomputation; it cannot guarantee a run
while GitHub continues to consider the PR conflicting.
GitHub documents `reopened` among the default PR trigger types in
[Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
Preserve the branch, title/body and all evidence; restoring the PR to open is the
immediate priority if the second action fails. This is an event-recovery attempt,
not a guaranteed fix. If no current-head run follows, do not loop; preserve the
observed UI blocker and inspect any new explicit approval or workflow state.
The actual attempt and resulting run IDs belong in
the PR/plan, not as a prediction in this record.

Claude's bounded static review is recorded in
[comment6448750267](https://github.com/sandrabrayer/ezone-outpatient/pull/125#issuecomment-6448750267).
It supports the narrow header scope and cautions against assuming reopening
will work while GitHub reports a conflict. The fresh identity/merge-tree and
browser observations above were independently obtained by the implementation
owner; Claude did not inspect the live workbook, run tests or mutate either
Google or the repository in that review.

## Return point

Keep all nine completed Google executions and both frozen evidence checkpoints.
The next steps are current-head CI, review of the exact header correction and
real capture/target-policy plan, then the required production decision. The
latest result and bounded review receipts are tracked in PR125 and the canonical
ten-system plan. The separate CRM display owner is unchanged. No merge,
deployment, new Google project, state reset or completed-phase rerun is authorized.
