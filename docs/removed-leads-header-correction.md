# OP-03 removed-leads header correction

## Status and exact scope

`ops/removed-leads-header-correction.gs` is an **uninstalled operator artifact;
writing is disabled by default**. It is outside `apps-script/`, `.clasp.json`'s deployment
root and the completed native drill's `test-support/` files. Its presence in
PR125 does not authorize installing it, running either entry point in Google,
merging or deploying anything. No existing native phase needs to run again.

Sandra has [approved the three header cells conditionally](https://github.com/sandrabrayer/ezone-outpatient/pull/125#issuecomment-6450655196).
The [live preparation record](https://github.com/sandrabrayer/ezone-outpatient/pull/125#issuecomment-6450790187)
documents why the existing paths are insufficient. Before native use,
finish the artifact's tests and independent review, then obtain separate owner
authorization for the exact reviewed mechanism in the **existing bound
project**. That authorization must preserve the project's release instructions:
do not paste or replace `Code.gs`, deploy a new web-app version, create a
project, add a route/trigger, or change permissions. Do not treat this runbook
as an instruction to install an unreviewed artifact.

| Binding | Required value |
| --- | --- |
| Script ID | `1JSI3Ahqnen0pxi1x5q24nBku8Nk8I5iFNqRC-yMcTv1EDKTh6KhmSuSX` |
| Source workbook | `17dVBbOuf09c7dug1Tpq9Fr8_3fxfg0M87F9ChkGMCyc` |
| Tab | `לידים שהוסרו`, sheet ID `1894136505` |
| Allocated grid | Exactly 999 rows × 26 columns |
| Only permitted cell write | `S1:U1` = `updatedAt`, `updatedBy`, `preferredHouse` |
| Expected existing `Code.gs` SHA-256 | `5a9c368dec1a59d1644068aa7aa87b9ed02ebbd2f5a0b04f008d97e9ca867f8a` |

The expected source hash is the saved editor source observed on October 27,
385,042 UTF-8 bytes, matching the existing `336c8ef9` and `b14db799` source.
The active deployment was Version 100, described as `336c8ef9`. Refresh these
observations before execution; the helper does **not** read or hash its own
project source or certify the deployed version. The pinned hash describes the
**existing `Code.gs` file only**, not the aggregate project source: installing the
helper necessarily adds a file, so no whole-project hash can match it. The
operator must read and hash every original project file (complete file
inventory and exact bytes) **before** installation, and after adding only the
separately approved helper must re-read the inventory and confirm that every
original file is byte-unchanged and that the helper is the sole addition. The canonical
`REMOVED_LEADS_HEADERS` array is checked at runtime. Existing `Code.gs`, the
synthetic project, frozen evidence, existing rows/formats and old backups stay
unchanged by this correction.

## What the lock proves, and what the operator must establish

The helper acquires the same ScriptLock as cooperating application writers.
It does not stop direct editors, other projects, requests that do not take that
lock, or the whole legacy backup job. In the
[legacy source at b14db799](https://github.com/sandrabrayer/ezone-outpatient/blob/b14db7991776f49fdcaee0a018dc0d67d371f8d2/apps-script/Code.gs):

| Source location | Consequence for this operation |
| --- | --- |
| `_integrityCaptureData`, lines 6124–6158 | ScriptLock covers capture, then is released before backup writes. |
| `_integrityWriteSnapshot`, lines 6219–6264 | UserLock covers each individual snapshot, with gaps between snapshots. |
| `nightlyIntegrityJob`, lines 6332–6472 | There is no whole-job active marker; reads, alerts and final properties extend outside the capture lock. |
| `_getData`, lines 767–769; `doGet`, lines 5618–5627 | A GET/poll can call `_ensureSheet`, which writes headers or formats. |
| `_saveSettings`, lines 2610–2618 | This legacy writer does not acquire ScriptLock. |
| `setupIntegrityTrigger`, lines 6475–6486 | This installer deletes/recreates triggers. Do not call it for maintenance. |

Establish a coordinated pause covering **application requests including polling,
direct editors, integrations, and scheduled/manual jobs**, and confirm that the
legacy backup has drained. Keep that pause through result inspection.

**Preview is inside the pause too.** `previewRemovedLeadsHeaderCorrection()`
takes the ScriptLock and scans the allocated cells (values and formulas). It
writes nothing, but read-only is not impact-free: it can delay cooperating
writers and its observation is only meaningful while writers are paused. Run it
only after the pause is established, never as a casual early check.

**Backup window.** The legacy nightly job was observed running between 02:00 and
03:00 Asia/Jerusalem. Scheduling the window outside that hour is necessary but
not sufficient: `atHour` is not an exact firing time, a run can overrun, and
manual executions or triggers owned by other accounts are not visible in one
account's listing. The backup must be independently shown to be drained (no
execution in progress, none starting) and any other-account or manual job must
be accounted for. Do not delete/recreate triggers to obtain a window.

**Clock skew.** Approval windows and the preview age are checked against Apps
Script's clock. Skew between the operator's clock and Apps Script causes a safe
refusal. Re-establish evidence with a fresh preview; do not widen or bypass the
window.

**Formats and native metadata.** The preservation hash does not fingerprint
number formats, notes, colors or other native metadata. Do not auto-format the
new headers, do not claim full native preservation, and do not broaden the
helper to write or compare formatting. A pre-existing number format on S1:U1
could affect how the strings are stored; record it in the pause evidence if
observed. A recent
execution list, a successful lock acquisition, and absent properties are each
bounded observations, not proof that future requests cannot start.

Google documents that [ScriptLock is script scoped and UserLock is user scoped](https://developers.google.com/apps-script/reference/lock/lock-service).
[Trigger listings are current-user scoped](https://developers.google.com/apps-script/reference/script/script-app#getProjectTriggers()),
and [other accounts' triggers are not visible](https://developers.google.com/apps-script/guides/triggers/installable#restrictions).
An [`atHour(2)` schedule uses the corresponding hour](https://developers.google.com/apps-script/reference/script/clock-trigger-builder#atHour(Integer)),
not an exact 02:00 firing time. Do not infer a safe window from the installer
comment or a single account's empty trigger listing. Do not delete/recreate
triggers or send a test alert to establish this window.

The approval's pause and source-readback fields are **operator attestations**.
The receipt deliberately reports `pauseMachineVerified:false` and
`legacyBackupIdleMachineVerified:false`. The helper checks both
`OUTPATIENT_RECOVERY_HOLD` and `INTEGRITY_ACTIVE_BACKUP` under lock and requires
strict absence (`null`); even an empty stored value refuses. An unreadable
property service also refuses. Their absence cannot prove legacy idleness,
because the observed existing code does not implement these draft OP-03
controls. Never set a hold property expecting that older code to honor it.

## Future authorized operator sequence

1. Record the reviewed artifact's exact commit and SHA-256, the separate owner
   authorization for this mechanism, and the existing three-cell consent.
   Refresh the existing project/container binding, saved `Code.gs` hash and
   deployment observation. If any differ, stop and review the change.
2. Once installation is separately authorized, add only the reviewed helper
   file to that existing bound project, with
   `OP03_HEADER_CORRECTION_APPROVAL = null`. Preserve all other project files
   and deployment/configuration. Read the entire saved helper back and compare
   its exact bytes with the reviewed artifact **before any function runs**.
   An unexpected permission prompt, source mismatch or broader installation
   requirement is a new gate, not permission to improvise.
3. Establish and record the coordinated pause described above. Choose a UTC
   window no longer than five minutes, allowing time for preview, configuring
   the approval, readback, apply and inspection. If it expires, keep the write
   stopped and re-establish evidence; do not extend it silently.
4. Run `previewRemovedLeadsHeaderCorrection()` once. It acquires ScriptLock,
   validates the target and properties, reads the bounded grid and returns a
   metadata/hash receipt without writing cells. Save the returned `observedAt`
   and `previewFingerprint`. A successful preview is not approval to apply.
   If `snapshot.headerState` is already `already_current`, record that observed
   state and stop; there is no correction to perform.
5. Prepare the exact approval literal below from the current evidence. Replace
   **only** the null approval value with that JSON-compatible data object; do
   not edit helper logic. Read the entire resulting saved file back against
   the prepared final file, record its new SHA-256, and verify that the only
   difference from the reviewed disabled artifact is the approved literal.
   This readback is required again after configuration and before apply.
6. Run `applyRemovedLeadsHeaderCorrection()` once while the pause and window
   remain current. The preview must be no more than two minutes old and must
   have occurred within that same window. The helper rechecks the approval
   before and after acquiring the lock, and immediately before the write.
   Inspect and retain the complete receipt before coordinating resumption.

This is a deliberately non-live example. Placeholder dates/fingerprint are
invalid, and the attestations are false. Replace a field only with actual
evidence; do not copy an old approval or turn the booleans on speculatively.

```javascript
var OP03_HEADER_CORRECTION_APPROVAL = {
  operation: 'op03-removed-leads-headers-v1',
  runtimeSourceSha256: '5a9c368dec1a59d1644068aa7aa87b9ed02ebbd2f5a0b04f008d97e9ca867f8a',
  operator: '<operator identifier>',
  ownerApprovalReference: '<reviewed-mechanism authorization and cell-consent reference>',
  pauseEvidenceReference: '<current coordinated-pause and backup-drain evidence>',
  windowStart: '<UTC ISO timestamp: YYYY-MM-DDTHH:mm:ss.sssZ>',
  windowEnd: '<UTC ISO timestamp, at most five minutes after windowStart>',
  previewObservedAt: '<exact preview receipt observedAt>',
  previewFingerprint: '<exact 64-character lowercase preview receipt fingerprint>',
  operatorAttestations: {
    runtimeSourceReadBack: false,
    applicationRequestsStopped: false,
    directEditorsStopped: false,
    integrationsStopped: false,
    scheduledAndManualJobsStopped: false,
    legacyBackupDrained: false
  }
};
```

The three reference/identifier fields must be nonempty, single-line strings
of at most 300 characters. Times require the exact UTC format shown. The
runtime hash field records the external source readback; matching that literal
does not turn the attestation into an independently computed runtime hash.

## Enforced checks and receipt interpretation

Both preview and apply refuse wrong identity/schema, changed allocation,
unexpected used bounds, header formulas, a mismatching first 18 headers,
partial/conflicting added headers, and unsafe target constraints. The target
must be editable, unmerged and free of validation rules. Any whole-sheet
protection or range protection overlapping S1:U1 refuses; protections are never
removed or weakened.

While the headers are pending, **all of S:U and V:Z across the 999 allocated
rows must be empty**, checking both values and formula source. Thus a formula
whose result is `""` still refuses. If all 21 headers are already current,
S2:U999 may contain legitimate later data; V:Z must still be empty. The helper
returns `already_current` with `writeAttempted:false`, never attributing a
previous correction to the current invocation. Apply still requires a current
approval/window even for this no-op; it does not require a pending-state
preview fingerprint to match once the full schema is already present.

For a pending correction, the locked snapshot must reproduce the exact
approved preview fingerprint. A second full bounded snapshot must match the
first before the final property/window checks and write. These separate RPCs
do not eliminate the need to keep every noncooperating writer paused.
The helper then performs one values-only
`setValues` on S1:U1, flushes, and verifies under lock. Its preservation hash
covers the sheet identity/allocation, last row, frozen rows/columns, canonical
schema and every cell's typed literal value or exact formula source, masking
only the three permitted header values. Formula result recalculation is
ignored; formula-source changes are not. Formatting, notes and every other
native feature are not comprehensively fingerprinted. The helper has no
formatting, row, audit-sheet or property write calls; do not describe its hash
as a complete native-sheet comparison.

| Receipt status | Meaning and operator response |
| --- | --- |
| `preview` | Checks completed with no cell write. Retain its observation time and fingerprint; `snapshot.headerState` can be `pending` or `already_current`. |
| `already_current` | All 21 headers are present; no cell write was attempted. Record the observed state, not a new repair. |
| `corrected` | The write and preservation/readback checks passed. Require `writeVerified:true` and `lockReleased:true`; retain the receipt and independent header readback. |
| `refused` | No write was attempted. Investigate the stated condition; do not change the guards to make it pass. |
| `needs_operator_check` | A write was attempted and the outcome or completion is uncertain. Keep the coordinated pause and investigate actual cells/state before any further action. |

The write-attempt flag is set **before** the RPC because a thrown request may
have committed remotely. Flush occurs before lock release, following
[Google's lock guidance](https://developers.google.com/apps-script/reference/lock/lock#releaseLock()).
A failed write may receive one flush attempt; it is not a second `setValues`
call. Post-write verification continues if the window expires after the write
starts. Errors do not cause an automatic retry, header clearing, rollback,
property reset or business action. A lock-release failure is also a failure,
even if readback had succeeded: the receipt then has `lockReleased:false`, there
is exactly one release attempt and no retry, and a verified write is reported as
`needs_operator_check` with `writeVerified:true`. Treat the lock as unresolved
(it expires on its own, or inspect it) and keep the pause until reviewed.

Receipts contain identifiers, status, operator references and hashes, not row
payloads, formulas or raw service exceptions. Keep them with the approval and
pause evidence. No audit row, Script Property, email or backup is created by
the helper. Retain failure evidence rather than attempting to make an old
snapshot or receipt look successful.

## Gates this does not close

Successful correction closes the removed-leads source header gap only. A
complete current-header v2 capture, current real manual-tab/source evidence,
an exact-target reviewed policy/pin, release/alert evidence and separate
production merge/deploy approval remain open. Preserve the completed nine
Google executions and their evidence. See [operational recovery](operational-recovery.md)
and the [dated readiness observation](evidence/op03-release-readiness-2026-10-27.md)
for the wider OP-03 return point.
