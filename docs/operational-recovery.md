# OP-03 — operational backup coverage (draft)

Issue: [#124](https://github.com/sandrabrayer/ezone-outpatient/issues/124).
Integrated base: `claude/youthful-volta-laarnk` at
`336c8ef9b19b40192f77d18ddd4a7bc18d2f8f11` (includes #132 preferred house and
#122/#126/#127/#128/#129; base assets SW19). Node reported this SHA in the
October26 read-only inspection; source99 was observed before132, and the source
deployment after132 was not verified by that inspection. The current branch head is not
itself proof of the live Node version; refresh live evidence before release.
This document describes a candidate, not a production release or completed
production DR exercise. All five integrated native phases passed on October27
at3297311c, followed by all four separate fixed-policy phases in the same test
project. See the [integrated evidence](evidence/op03-google-drill-2026-10-27.md)
and [policy result](evidence/op03-manual-tabs-2026-10-27-result.md). Preserve all
nine completed executions; do not repeat their bootstrap or phases. The
[read-only release-readiness observation](evidence/op03-release-readiness-2026-10-27.md)
records the remaining removed-leads header gap and the incomplete legacy
nightly set. Earlier dated checkpoints below remain historical evidence.

## Why the eight-table set was insufficient

The real source, with synthetic Google services/data, reproduced three failures
after restoring the previous nightly-selected tables: a cancellation retry
credited the patient twice, payroll forwarding state disappeared, and a custom
777 therapist rate became the hardcoded 250. The balances in production were
not changed or alleged to be wrong. The missing recovery dependencies were
SessionLog and TherapistRates. Settings and open operational workflows were
also outside the nightly set.

## What is captured

One registry drives capture and restore. All reads occur under ScriptLock, the
same lock used by cooperating writers; saveSettings now participates too.
Direct human Sheets edits and editor jobs must be paused for an operator-led
recovery drill. ScriptLock cannot stop manual spreadsheet edits.

| Group | Source tabs | Identity |
| --- | --- | --- |
| Existing core | Clients, Leads, לידים שהוסרו, Clients-removed, Payments, ClientCharges, Credits, FinancialOps | id |
| Session accounting | SessionLog | sessionId |
| Rates and configuration | TherapistRates, Settings | name; key |
| Operational queues | StopFlags, ExtraSessionRequests, מסלול המשך, התראות עצירת טיפול | id; continuation uses key |
| Maintenance evidence | AuditLog, RepairPlan | ordered rows, no invented id |
| Package integration | PackageCatalog, PackageRequests, when their module is present | id |
| Inventory | __RecoveryMetadata (backup only) | key/value |
| Unclassified tabs | Every other source tab, including Sheet1 and Copy of Clients | opaque values, original name in manifest |

The integrated build captures 19 known datasets plus recovery metadata, and
any unclassified tabs. The pre-package build had 17 known datasets. Optional
absence is explicit and never materialized by capture. Clients/Leads are required;
FinancialOps is required whenever FINANCIAL_OPS_CREATED is set.

Existing columns and appended columns, scalar types, literal strings, leading
zeroes and Date instants are retained. Capture does not repair/relabel live data.
Different per-sheet keys replace the old assumption that every sheet has id.
Recovery separately requires full current header prefixes and unique nonblank
keys, where a table is actually keyed. RepairPlan is preserved, never executed.

This remains a **values-only backup**, not a native workbook copy: formulas,
formatting, validations, permissions, triggers, external links and secrets are
not a full-workbook recovery contract. Unknown tabs are preserved as values in
hashed-name snapshots and listed explicitly, but block automatic operational
certification pending a separately reviewed recovery plan. Do not omit them or
edit their manifest away to pass the gate. The private full native safety copy
made 20 October (20 tabs, after packages) remains separate containment; it is
not an automatic backup fix. The older 19 October copy is historical.

## Manifest, retention and compatibility

The five existing manifest columns remain unchanged. Recovery metadata records
schema version 2, source workbook ID, capture instant, the non-secret financial
activation marker, and complete known/unclassified inventory. No Script Property
secret, token or PIN is exported. Every grid, including metadata, is fingerprinted
using typed SHA-256. Manifest is published last; missing/mixed/tampered grids or
inventory reject before retention. Optional absence cannot contain data rows. After a verified set,
INTEGRITY_REQUIRED_SOURCES records the tables actually present. Their later
disappearance aborts capture/retention rather than aging out the last good
history. A deliberate table retirement needs its own reviewed plan.

Legacy eight-dataset and ten-dataset package manifests remain inspectable. They
are never certified as full operational recovery sets. This is deliberately a
separate promise from verifying their financial subset.

Optional absence is a capture/inspection contract, not permission to invent
missing operational state at recovery. Any backup predating SessionLog or
Settings, or with absent/empty TherapistRates, is inspection-only under the
current recovery gate. The registry comparison is exact: before adding another
registered source, design and review a versioned compatibility/migration path
for existing version-2 artifacts; never erase inventory entries to make them fit.

Strict retention names cover the added families and 64-hex hashed other-tab
families. Manual backup tabs, other apps and pending/previous recovery remnants
remain outside retention. Retention stays 30 days, runs only after verification,
and reports failures. Published sheets shrink to actual data dimensions to avoid
allocating a default 1000-by-26 grid per small daily table. Actual live workbook
growth/quota and run duration remain deployment observations, not measurements
established by synthetic tests.

### Append-only headers and recovery readiness

PR132 appends `preferredHouse` to Clients, Leads and both removal archives.
Capture preserves existing values and headers without migrating live data.
The recovery verifier still requires the entire current header prefix. An
old-width v2 snapshot is inspectable but cannot pass operational preflight or
clear the recovery hold. The verifier does not invent blank trailing cells.
This applies independently to all four schemas, including header-only archives.

Before certifying a restore, verify source-header readiness through the approved
application/configuration process and capture a fresh complete v2 set matching
that schema. Do not mutate source headers through the backup job or weaken the
gate to reuse a pre-change set. A first-night backup may still contain old-width
optional tables, so its date alone is not acceptance. If a fresh complete set
cannot be demonstrated, retain the recovery-readiness gap explicitly. Legacy
nightly sets and native safety copies remain inspection/containment evidence.

On October27, direct header reads of the existing source and that day's
snapshots found Clients38/38, Leads19/19 and Clients-removed41/41 matching the
candidate. The removed-leads archive matched only the first18 of21 columns;
updatedAt, updatedBy and preferredHouse were absent in both source and snapshot.
The source's S1:U999 tail was empty in a formula-aware read. The exact narrow
three-header correction is proposed in the readiness record, not performed;
fresh identity, blank-tail and coordinated-write checks must precede any
separately approved production configuration change. This observation does not
certify the other schemas, row contents or a complete version-2 recovery set.

The queued `setPreferredHouse` writer now checks the recovery hold immediately
after acquiring ScriptLock, before `_ensureSheet` or any cell/stamp write.
Its financial-operation guard and normal released behavior remain unchanged.

## Recovery hold and release gate (editor only)

No HTTP action enables or clears recovery. Production recovery itself requires
separate operator authorization and an approved target/cutover plan.

1. Pause editor jobs and direct spreadsheet edits. Run beginOutpatientRecovery
   **before** restoring or repointing any live workbook. It sets
   OUTPATIENT_RECOVERY_HOLD under ScriptLock. HTTP GET/POST and nightly backup
   refuse new admissions while held. If begin returns backup_draining, the hold
   is already active but cutover is NOT authorized: wait for the previously
   admitted backup to finish, then retry begin until ok:true. Do not restore,
   repoint or read a changing backup set during this drain. Existing writers recheck after acquiring their
   lock, so an already-admitted queued request cannot write past the hold. Drain
   remaining in-flight read/editor work before manipulating the target.
2. Validate the chosen day with _integrityValidateRestoreSet. Restore into a
   separate isolated workbook, retaining every grid and optional absence. Do
   not create __RecoveryMetadata as an application tab. Preserve the marker and
   both renewal/extra-charge journal families, including terminal history.
3. Verify secret alignment, source/Node versions, timezone, triggers and external
   consumers through their authorized configuration surfaces. These are not
   backed up here. configVerified=true is an explicit operator attestation, not
   a claim the code can inspect another runtime's configuration.
4. _integrityVerifyRecoveredWorkbook compares the isolated target to the entire
   verified set. It refuses missing SessionLog/rates/settings, empty rates,
   unexpected tables, altered cells, incompatible headers, duplicate keys,
   unclassified tabs, the original source workbook, and the backup workbook.
   A changed repair plan is not silently accepted or applied.
5. Only after the approved cutover points the script at that verified isolated
   target, finishOutpatientRecovery(backupId, day, true) first refuses any active
   backup marker, then repeats the checks under
   ScriptLock, runs the existing real FinancialOps validator, invalidates the
   rates cache, restores FINANCIAL_OPS_CREATED where needed, then clears the hold
   **last**. Failure leaves the hold set. Never clear it manually to bypass a
   failed check. Source replacement in place is not supported by this procedure.

Read-only preflight is not a restore writer. No production data restoration,
configuration change, mail, trigger installation or release is performed by tests.

### Backup admission and recovery drain

A ScriptLock-protected INTEGRITY_ACTIVE_BACKUP marker identifies one whole job
(UUID + start time). The lock is released before reads, Google snapshot writes,
retention and alerts, so interactive saves do not wait for the entire backup.
The marker remains until ALL sentinel/property updates finish. Cleanup removes
only that run's marker, under ScriptLock. This works across Google users, unlike
the existing per-sheet UserLock. A second job is refused and reports the existing
backup alert; no additional job or email is manually triggered by this change.

beginOutpatientRecovery sets the hold and reports backup_draining while a job is
active. New jobs are refused. finishOutpatientRecovery cannot clear the hold
until the admitted job has exited, so an old job cannot overwrite recovery
markers after cutover. Snapshot publication already in progress may finish
while the hold is active; operators must wait for begin to return ok:true before
handling the target. Checks cover overlap after capture and after manifest
publication; removing the finish guard makes both fail.

An uncatchable Apps Script termination can leave the active marker behind. It
never expires automatically. A stale-marker alert is an investigation, not a
permission to clear it: first pause scheduled/manual invocations, verify in
Apps Script execution history that no job is running, preserve/review published
sets and pending/previous remnants, and record the operator's recovery decision.
Admission lock timeout now reports a missed backup through the existing alert
path. Completion lock timeout logs an explicit stranded-marker diagnosis while
remaining fail-closed; it does not release an unowned lock.
Only then may an authorized operator remove that specific abandoned active-run
marker while keeping the recovery hold and financial marker/history intact,
and retry begin. Do not automate this cleanup or use age alone as proof.

Other low-severity operations items remain: an abandoned hold currently pauses
nightly work without an age-based alert; deliberate retirement/rename of a
previously captured source needs a reviewed migration; pending/previous remnants
need size/count monitoring and manual review, never blind retention cleanup.


## Evidence and remaining gates

The evening base integration preserves the released sign-in/calculator/favicon
changes and source recovery logic. A separate [phased Google drill](google-operational-drill.md)
is now prepared, with nonempty synthetic sessions, both journal kinds, catalog
and approved request. Thirteen tests execute its exact generated helpers with
service doubles, including identity/order/hash refusals and cache-failure hold.
All five phases ran successfully in native Google on October 26 using
candidate 09a00ab5. See [exact evidence and timing](evidence/op03-google-drill-2026-10-26.md).
That earlier manual phase proves preservation/refusal with a blank pin, not the
successful manual-policy path or that path's repeated-proof duration. The
October27 integrated five-phase run and the separate four-phase policy run now
supply their own native evidence. The policy result records two successful
finish proofs, late native comparison, actual timing and hold-last removal,
with a private synthetic pin only. Production policy approval remains absent.

The new real-source tests perform snapshot -> manifest validation -> isolated
restore -> event retry/correction, covering credit idempotency, payroll stamps,
custom rates, schemas/keys, missing state, legacy sets, retention, writer lock
contention, source admission during a hold, and nonempty package datasets.
Existing mixed-kind FinancialOps crash/restore tests remain in the suite.
Only Google APIs are mocked; business handlers are not mirrored.

The October 20 integration uses the actual released #122/#126 tree, not the
previous synthetic source combination. The full UTC suite passes 1,640 / 0 fail /
37 skipped (1,677 total), including sixteen regressions added after review. The package regression seeds the real catalog, approves
a real request, snapshots/restores it and retries the exact submission: one row,
unchanged approved quote/status, no charge/payment. Two queued package-writer
tests fail if the post-acquisition hold check is removed. CI for the resulting
commit must be checked separately; do not attribute earlier CI to this tree.

Claude's limited static review of 917bae83 (PR comment 6283463196) found no
high/medium defects in registry, manifest and recovery gate. It ran no tests and
did not review _finJournal internals, writer locks or the complete PR. Its test
gaps led to regressions for cache failure, a real corrupt journal, activation
marker mismatch, write ordering before hold deletion, absent-sheet recreation,
and four self-consistently rehashed inventory corruptions. No runtime logic
changed for these additions. A persistent who/when attestation audit is a
follow-up design/control item; configVerified is still a bare operator boolean,
not automated evidence of secure configuration. Full independent coverage and
the real manual-tab/production configuration evidence remain open.

The native synthetic drill proves the exercised coercion/retry paths at fixture
scale, with nonempty SessionLog and both FinancialOps kinds. It does not prove
production-scale runtime quotas, scheduled execution, alert delivery or secure
configuration recovery. Before release require real manual-tab evidence and a
reviewed target policy, native acceptance of any enabled policy, independent
review and Sandra's explicit approval. Do not manually run the mail-triggering job to
obtain evidence. Read-only October26 [operational observations](https://github.com/sandrabrayer/ezone-outpatient/pull/125#issuecomment-6416538625)
confirm the existing ten-dataset job ran, not PR125. Seven executions were
Completed; the latest log also verified all ten entries, retention and final ok.
The destination was private and Jerusalem timezones/alert address configured;
mail delivery and the new job's scheduling/admission behavior remain unverified.

Full suite uses CI's UTC timezone. An initial run inherited this host's
America/Los_Angeles timezone and reproduced 17 existing date-helper failures
(one-day drift); UTC passes. No browser/date/billing calculation was changed.
Track timezone coverage under remaining OP-02 date/business-logic review.

## Package branch integration and rollback

#122 and #126 are already merged. This branch integrates their exact deployed
tree, keeping the registry/metadata validator and both PACKAGE_* schemas.
_pkgLock now rechecks the recovery hold immediately after acquisition, releasing
and returning busy before any write. Public assets exactly match the released
SW19 base tree from132; this backup-only change needs no SW bump. Therapists #105 is
merged at d38d85b1; its branch advanced to a8a1afbc with #107. Claude retains
ownership of package release/flow verification. No changes were pushed to his branches.

### Manual tabs: observed state and proposed recovery treatment

Read-only Google inspection on 2026-10-20 covered the full observed grid bounds:
Sheet1 A1:Z1000 is empty; Copy of Clients A1:AG993 contains 21 records, 33 headers
and no formula cells. All 21 ids also occur in Clients, which has 54 records.
Shared ids do not prove equal row values or that the archive is expendable.

Retain Sheet1 as an empty structural tab and Copy of Clients as a retained
historical archive; never merge the archive into live Clients, use it as billing
input, or delete it because ids overlap. Preserve native properties through the
separate full-workbook copy. The October 20 private copy has 20 tabs including
packages; the prior October 19 copy is historical. Neither is a proved restore.

A [default-disabled policy verifier](manual-tab-recovery-policy.md) is now
implemented. Its approval pin is empty, so unknown tabs still block operational
certification. Each eventual exception needs a contemporaneous evidence packet,
the exact source/backup/day/target, recomputed grid/manifest/metadata hashes and
a separate reviewed code pin. No approved production policy or complete
contemporaneous real recovery-capture packet exists yet.
Do not bypass checks by deleting tabs/manifest rows or clearing the hold manually.
Recheck schema/content/formulas/native properties and the exact reviewed target
for the real recovery capture. Do not repeat the completed synthetic drill.
Old observations cannot certify new snapshots.

After approval: merge to the deployed branch, wait for matching healthy Node,
then dispatch Deploy Apps Script with expected_commit = approved full merge SHA.
Keep the existing /exec deployment. Never roll source back to 97 or discard
FinancialOps/marker/history. Code rollback does not restore data. A rollback to
an older backup implementation cannot certify version-2 recovery sets: preserve
all artifacts and keep recovery held; review a forward fix before resuming.

Return points: package release gates, remaining OP-02b2 flows; OP-03 real manual
policy/configuration and scheduled evidence; OP-04 speed; OP-05 controls; OP-06 delivery; CRM #114/#220
and the ten-app program. This candidate does not close the application audit.
