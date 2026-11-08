# Manual-tab recovery policy — default disabled

PR125 implements a verifier, **not an approved recovery exception**.
`INTEGRITY_APPROVED_MANUAL_POLICY_SHA256` ships as an empty string in both
Code.gs and the generated isolated drill. Blank, missing or malformed pins
always refuse unknown tabs, including when the supplied policy is also empty.
There is no HTTP route, Script Property, sheet cell or caller-supplied digest
that enables it. Version-2 backup metadata and old backups are unchanged.

## Scope and trust

An eventual recovery needs a newly created private empty target and a dated
reviewed evidence record before pinning a policy. We deliberately bind the
**exact target ID**, accepting the cost of a separate reviewed code change for
each target/recovery set. A pin is not a general sheet-name allowlist. Changing
source, backup, day, target, manifest, metadata, inventory, absence, typed data
or policy invalidates it. Reuse on another target is refused. It is not an
expiring or single-use token: repeating proof of the exact same set and target
is possible; remove the pin in a reviewed follow-up after the recovery.

The candidate commit, exact code/artifact hashes, pin commit, reviewer and
approval belong in the evidence record and PR. Code cannot discover its own
Git SHA. A privileged owner who edits both code and evidence outside the release
process can defeat this control. Configuration still uses the existing explicit
operator boolean; this patch does not automate configuration certification.

## Policy shape and canonical fingerprint

The optional fourth editor argument is an object:
`finishOutpatientRecovery(backupId, day, true, manualPolicy)`.
The same object is the fifth argument to the read-only preflight. It must have
exactly the fields below; extra/missing fields are errors.

| Object | Fields in canonical order |
| --- | --- |
| Policy scalar row | `version`, `sourceId`, `backupId`, `day`, `targetId`, `manifestSha256`, `metadataSha256` |
| Evidence row | `recordPath`, `sha256`, `operator`, `captureStartedAt`, `captureEndedAt`, `beforeInventorySha256`, `afterInventorySha256`, `nativeCopyId`, `directWritesPaused`, `formulasAbsent`, `nativePropertiesVerified`, `targetCreatedAt`, `targetInitiallyEmpty`, `targetOwnerOnly` |
| Each tab row | `source`, `sheetId`, `prefix`, `absent`, `role`, `sha256`, `rows`, `columns`, `allocatedRows`, `allocatedColumns` |

The top-level object also contains `evidence` and `tabs`. Version is numeric `1`.
Canonical rows start with `['outpatient-manual-recovery-policy-v1']`, then the
policy scalar row, evidence row and tab rows sorted by source name using ordinary
JavaScript lexical comparison. `_integrityManualPolicyRows` constructs these
fixed rows, independent of object-key or tab-entry insertion order.
`_integrityFingerprint(rows)` is the pin: SHA-256 of its existing typed-cell
serialization. No second hash algorithm, free-form JSON key order or supplied
digest participates in approval. Never trim, sort or coerce **captured cells**.

Manifest fingerprint covers the complete manifest grid in its stored order.
Metadata fingerprint covers the recomputed `__RecoveryMetadata` grid. Each tab
fingerprint covers its recomputed captured grid, after the ordinary validator
has checked it against the manifest. Grid dimensions count the exact captured
rows/columns, not allocated worksheet size. Allocated sizes are separate positive
integer fields and must match the target. Tab IDs are nonnegative unique integers
from the source; their provenance remains evidence, not a live-source read.
Every unknown source must occur once, with its exact prefix and `absent:false`.
Known sources cannot be reclassified. Roles are `structural-empty` (every captured
cell empty) or `retained-archive`; neither permits billing or merging into Clients.
The role is a pinned operator classification; the verifier enforces structural
emptiness, but cannot prove that a nonempty tab is historically an archive.
Supplying a manual policy for a set with no unknown tabs is an error.

## Evidence is an operator attestation

No production recovery evidence packet or pin has been approved. Oct20
observations are historical, not an attestation for a later or earlier snapshot.
Ordinary nightly sets lack the contemporaneous evidence below and remain inspection-only when
they contain unknown tabs. A coordinated capture is a separate operator task;
do not invoke the mail-triggering nightly job merely to obtain evidence.

The configuration owner coordinates a pause of direct/editor writes for capture
and of target writes through final verification/hold release. ScriptLock only
coordinates cooperating script writers. Keep the normal hold/drain procedure.
Capture values, formulas (explicit absence is required for this values-only
route), exact source/tab IDs, used bounds, allocated sizes and native properties
before and after the selected snapshot/native copy. These inventories must agree.
The capture interval must enclose metadata `capturedAt`. Dates in the policy are
UTC ISO strings with milliseconds. `beforeInventorySha256` and
`afterInventorySha256` are matching SHA-256 hashes of the same precisely defined
evidence serialization, whose bytes/schema are retained with the private packet.
Record every tab in source order, its typed cells and exact formula text, without
normalization. Never put those raw patient rows in Git.

Record number formats, formatting, validations, protections, merges, hidden state
and tab order in the private native evidence, and independently compare them to
the target. Permissions are a separate file-level observation. The nightly grid
hash does **not** cover these properties. The code checks the explicit attestations
and a pinned digest of the evidence record; it does not fetch that record or prove
its claims. Formula absence in the restored target and its allocated dimensions
are additionally checked directly. A hash is not proof that the observer was right.

`recordPath` is `docs/evidence/op03-manual-tabs-YYYY-MM-DD[-suffix].md`; `sha256`
is the SHA-256 of that committed file's exact UTF-8 bytes. It records nonsecret
IDs, capture interval, operator, candidate code hashes, private native-copy links,
private packet hashes and review findings. It also records the target creation
time, its initial empty inventory and owner-only permission observation. The
runtime cannot prove that the target was initially empty or newly created.
`targetInitiallyEmpty`, `targetOwnerOnly`, `directWritesPaused`, `formulasAbsent`
and `nativePropertiesVerified` must all be the boolean `true`. `nativeCopyId`
must be distinct from source, backup and target. The evidence SHA pins the record's
bytes; the later pin-commit SHA is recorded in the PR to avoid a circular hash.

Missing contemporaneous evidence after a disaster is not repaired by inspecting
the source later. If the source is unavailable, require the retained packet;
otherwise keep that set inspection-only. Any disagreement or interrupted capture
preserves artifacts and requires a fresh coordinated capture/review. Never alter
the policy to bless unexplained changes, delete an unknown tab or clear the hold
manually. A content change is detected by the next capture's fingerprint; no
continuous edit monitor is installed.

## Runtime and release gates

Unknown tabs use a separate exact-grid/formula/bounds check. Known tables retain
their schema, key, required-state and journal checks; the whole target inventory
must match. Finish still checks the drain marker, real FinancialOps validator,
rate-cache invalidation and marker persistence. With a policy, it repeats the
full read-only proof immediately before clearing the hold last. This narrows,
but does not eliminate, the direct-editor race; the coordinated pause is essential.
If this late proof fails, the journal/source markers may already be persisted.
They are retained for investigation; the hold prevents nightly work and a fully
verified retry rewrites them. This deliberate ordering keeps proof closest to
hold release. It does not promise transactional rollback of properties. Measure
both full preflights and the lock's elapsed time for the actual recovery scale:
the second pass rereads the complete backup/target and may reach Google quotas.
The completed synthetic measurement below establishes only this fixture's timing.
Successful inventory persistence includes the manual tabs, so deleting either
later blocks a nightly capture until a reviewed retirement/migration exists.

Local tests inject synthetic pins in a VM and exercise real source functions
with Google service doubles. They are neither native Google evidence nor approval
of production Sheet1/Copy of Clients. The unbound generated Google runner retains
the blank pin and continues testing refusal. Separate native synthetic evidence
is recorded below. Remaining gates include the real recovery evidence packet and
exact target, independent review of that production policy, a fresh complete v2
set with current headers, configuration / trigger / timezone / alert evidence,
and Sandra's separate production approval.
No new Drive scopes, deployment, trigger, email or production write is introduced.

The [separate synthetic native acceptance procedure](google-manual-policy-drill.md)
completed all four phases once in the existing October27 test project. Sandra
approved Google's displayed API terms; Sheets v4 supplied native formatting and
dimension evidence without changing the existing Sheets scope. Exact prepare,
capture and restore packets, three owner-only permission checkpoints and the
pre-verifier hold remain recorded in the immutable
[frozen evidence](evidence/op03-manual-tabs-2026-10-27.md). The separate fixed
verifier then refused a changed policy and passed both real finish proofs. Their
core durations were 10,296ms and 6,064ms; the second proof included another
29,128ms of native comparison before returning. The valid script lock was held
for 46,104ms and full finish took 46,347ms. The hold was removed last, and the
final state is `verified`, `running:false`, without a failure flag. See the
separate [result addendum](evidence/op03-manual-tabs-2026-10-27-result.md), including
supplementary owner-only observations before and after verification. These
measurements cover 13 synthetic sheets and 26,748 allocated cells; they do not
establish production-scale timing. Synthetic results do not approve a real
recovery policy or change the blank production pin.

For this synthetic extension, the builder also requires a unique generated
binding block in the committed evidence record and three chronological Drive
permission observations. Those checks bind retained observations to the actual
phase packets; they do not establish that permissions stayed unchanged between
observations or that an operator's pause attestation is true. Its four-minute
cooperative phase budget checks immediately before hold deletion, while leaving
an in-flight service call or hard Google termination outside its control.
