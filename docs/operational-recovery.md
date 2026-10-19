# OP-03 — operational backup coverage (draft)

Issue: [#124](https://github.com/sandrabrayer/ezone-outpatient/issues/124).
Base: `claude/youthful-volta-laarnk` at
`094100434461cf84a0fc4e96602963ab815b7b6a` (source 98, SW 13).
This document describes a candidate, not a production release or completed DR drill.

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

The base captures 17 known datasets plus recovery metadata, and any unclassified
tabs. A combined package build captures 19 known datasets plus metadata. Optional
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
made 19 October remains separate containment; it is not an automatic backup fix.

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

Strict retention names cover the added families and 64-hex hashed other-tab
families. Manual backup tabs, other apps and pending/previous recovery remnants
remain outside retention. Retention stays 30 days, runs only after verification,
and reports failures. Published sheets shrink to actual data dimensions to avoid
allocating a default 1000-by-26 grid per small daily table. Actual live workbook
growth/quota and run duration remain deployment observations, not measurements
established by synthetic tests.

## Recovery hold and release gate (editor only)

No HTTP action enables or clears recovery. Production recovery itself requires
separate operator authorization and an approved target/cutover plan.

1. Pause editor jobs and direct spreadsheet edits. Run beginOutpatientRecovery
   **before** restoring or repointing any live workbook. It sets
   OUTPATIENT_RECOVERY_HOLD under ScriptLock. HTTP GET/POST and nightly backup
   refuse while held. Existing cooperating writers recheck after acquiring their
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
   target, finishOutpatientRecovery(backupId, day, true) repeats the checks under
   ScriptLock, runs the existing real FinancialOps validator, invalidates the
   rates cache, restores FINANCIAL_OPS_CREATED where needed, then clears the hold
   **last**. Failure leaves the hold set. Never clear it manually to bypass a
   failed check. Source replacement in place is not supported by this procedure.

Read-only preflight is not a restore writer. No production data restoration,
configuration change, mail, trigger installation or release is performed by tests.

## Evidence and remaining gates

The new real-source tests perform snapshot -> manifest validation -> isolated
restore -> event retry/correction, covering credit idempotency, payroll stamps,
custom rates, schemas/keys, missing state, legacy sets, retention, writer lock
contention, source admission during a hold, and nonempty package datasets.
Existing mixed-kind FinancialOps crash/restore tests remain in the suite.
Only Google APIs are mocked; business handlers are not mirrored.

Local synthetic tests do not prove real Google coercion, runtime quotas,
scheduled execution, alert delivery or secure configuration recovery. Before
release require a private Google round-trip with nonempty SessionLog and both
FinancialOps kinds; a concrete plan for the two manual tabs; independent review;
and Sandra's explicit approval. Do not manually run the mail-triggering job to
obtain evidence. Scheduled trigger/timezone/alert observations remain OP-03.

Full suite uses CI's UTC timezone. An initial run inherited this host's
America/Los_Angeles timezone and reproduced 17 existing date-helper failures
(one-day drift); UTC passes. No browser/date/billing calculation was changed.
Track timezone coverage under remaining OP-02 date/business-logic review.

## Package branch integration and rollback

Claude owns #122/#105. Do not push this implementation to either branch. #122's
backup list/manifest/retention edits overlap: retain this registry and metadata
validator, pick up PACKAGE_CATALOG_HEADERS/PACKAGE_REQUEST_HEADERS from the package
module, and preserve both package datasets. Add the recovery-hold recheck to new
package writer locks as well. Rerun both backup/recovery and package auth/replay
tests after the actual integration; a synthetic combined source is preparatory
evidence, not approval of a future merge SHA. No SW bump is needed here because
no public asset changes.

After approval: merge to the deployed branch, wait for matching healthy Node,
then dispatch Deploy Apps Script with expected_commit = approved full merge SHA.
Keep the existing /exec deployment. Never roll source back to 97 or discard
FinancialOps/marker/history. Code rollback does not restore data. A rollback to
an older backup implementation cannot certify version-2 recovery sets: preserve
all artifacts and keep recovery held; review a forward fix before resuming.

Return points: package release gates, remaining OP-02b2 flows; OP-03 real Google
and scheduled evidence; OP-04 speed; OP-05 controls; OP-06 delivery; CRM #114/#220
and the ten-app program. This candidate does not close the application audit.
