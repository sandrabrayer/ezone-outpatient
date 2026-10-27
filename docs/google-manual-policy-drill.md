# Isolated native manual-policy drill tooling

Status: **new local tooling; not run in Google**. The original five native phases
at candidate `3297311c` have their own retained evidence. This extension neither
repeats them nor certifies production. The Advanced Google Sheets service has
**not been activated** by this tooling. Its service-dialog terms require the
owner's separate action-time approval before activation. Do not edit the manifest
as a way around that approval.

Use the existing standalone test project only. Keep its original `Code.gs`,
`OP03_DRILL_STATE`, fixture properties, workbooks and `_DrillReport` unchanged.
The production approval constant and the original generated runner stay blank.
This adds private test modules, three new synthetic workbooks (policy backup,
empty target and native copy), a separate state/report, and no deployment,
trigger, mail, DriveApp, external fetch, credential or production write.

## Prerequisites and exact binding

The original state must be `manual_block_verified`, `running:false`, without a
failure flag. Copy its **exact raw JSON text**, not a reformatted equivalent.
The builder validates its source/helper/bound-definition hashes against the
current candidate and original builder. Every native phase checks that raw text
and its SHA256 again, and verifies all five original report rows.

The only OAuth scope remains `https://www.googleapis.com/auth/spreadsheets`.
After the required owner approval, the service dependency would be:

```json
{
  "dependencies": {
    "enabledAdvancedServices": [
      { "userSymbol": "Sheets", "serviceId": "sheets", "version": "v4" }
    ]
  }
}
```

This is a dependency example, not a replacement manifest or an instruction to
activate it without approval. Preserve the existing runtime, timezone, scope and
other settings. `Spreadsheet.copy(name)` itself uses the existing Sheets scope.
The advanced service is used **only for read-only native evidence**. Before the
new prepare phase writes any state or creates files, it performs a bounded
metadata read of the exact original synthetic source. Missing or inaccessible
service access therefore leaves no new policy artifacts.

Build setup with a local JSON configuration containing `scriptId` and
`baselineStateRaw`:

```sh
node test-support/build-google-manual-policy-drill.cjs setup CONFIG_JSON OUTPUT_GS
```

The output path must be new; the CLI uses exclusive creation. Preserve the
printed source/helper/setup-definition/file hashes. Add that complete module as
`OP03PolicySetup.gs` beside the original file in the same project. Read the entire
saved module back and compare bytes before its first run. Do not replace or
rebind the original runner. The original file's hash must remain unchanged.

## Native phases and checkpoints

| Function | Required prior state | Result |
| --- | --- | --- |
| `prepareManualPolicyDrill` | No policy state or policy fixture properties | Fresh backup and initially empty target; retained initial inventory |
| `captureManualPolicyDrill` | `prepared` | Native copy, fresh 22-entry version-2 snapshot set, matching before/after source inventories |
| `restoreManualPolicyDrill` | `captured` | Separate target restored in source order; native properties compared; fixture hold remains |
| `verifyManualPolicyDrill` | Exact fixed `restored` raw state | Changed-policy refusal, real two-pass finish, full late native proof and hold-last evidence |

Read state and reports between phases. Require idle, successful state and the
expected hashes. A duplicate, failed or running phase refuses. There is no reset
or recovery-marker clearing function. A timeout can retain `running:true`; retain
the artifact and investigate rather than retrying.

After preparation, inspect source/backup/target sharing through the Drive
connector before capture. After capture, verify native-copy sharing before
restore. Require exact names/IDs and owner-only access. ScriptLock cannot prevent
direct editor writes: keep the synthetic files under a coordinated write pause.

The native copy is created during the capture interval. The source inventories
must match, and that interval must enclose the captured metadata timestamp.
Capture occurs before the new fixture's recovery hold; the production capture
helper correctly refuses a hold. Restore then uses the real begin helper under
`OP03_POLICY_FIXTURE_`. Known sheets come from the new snapshot set; the two manual
sheets come from the native copy. That preserves the empty sheet's original
allocated dimensions, which a values-only snapshot intentionally shrinks.

The verified initial blank target sheet is temporarily renamed to a unique
reserved name before copying the source's `Sheet1`. Only that known initial blank
is deleted after the copies exist. Existing source/archive/evidence sheets are
never deleted. The archive stays separate from Clients.

## Complete native packet and its limits

`_PolicyEvidence` in the new backup stores numbered JSON chunks of at most 30,000
UTF-16 code units without splitting surrogate pairs. Each packet has a SHA256 of
its exact reconstructed UTF-8 JSON. The writer reads it back before accepting it.
Packets include initial target, capture, restore, verification and diagnostic
failure observations. `_PolicyDrillReport` records phase results and code hashes.

The inventory contains source-order IDs, allocated and used dimensions, typed
cells, exact formula strings, number formats, validations, merge/protection
observations, sheet visibility and frozen dimensions. The Advanced Sheets
`Spreadsheets.get` call additionally retains the complete native response with
`includeGridData:true`, no field mask, and bounded full allocated ranges for every
sheet, covering CellData formatting and row/column metadata. SpreadsheetApp is
flushed before crossing into that separate read API. The total allocated-cell
budget is 100,000 per workbook; exceeding it fails closed.

The shared canonicalizer sorts object keys only. It preserves actual values,
types, array/source order and all nonempty cell/dimension metadata. For comparing
distinct workbooks, it removes only workbook ID/URL/title and maps sheet IDs to
their source-order positions. Sparse omitted/empty grid cells and dimension
entries represent native defaults inside the explicit allocated rectangle.
Nonempty metadata is not discarded or coerced. The complete raw observations are
also retained, so the comparison representation remains auditable.

This bounded fixture requires formulas, validations, merges and protections to
be absent; it reads and checks that absence. Unsupported nonempty features fail
closed and require separate fixture work. Full native equality on this synthetic
fixture is not certification that all possible production formatting, formulas,
protections or Google-native objects can be restored. No real patient rows belong
in Git.

## Freeze actual evidence before constructing the verifier

The setup file is immutable after starting. The final verifier is a **separate**
generated module, compiled only after actual IDs and observations exist. There is
no preapproved native policy or execution-specific verifier checked in here.

The verifier configuration JSON contains:

```text
scriptId
baselineStateRaw                 exact original raw state
setupStateRaw                    exact restored policy raw state
packets.prepare                  exact reconstructed JSON string
packets.capture                  exact reconstructed JSON string
packets.restore                  exact reconstructed JSON string
externalProof                    fixed operator/Drive observations described below
evidenceRecord.path              docs/evidence/op03-manual-tabs-YYYY-MM-DD[-suffix].md
evidenceRecord.text              exact committed UTF-8 contents
evidenceRecord.commit            exact 40-hex evidence commit
```

The external proof has `version:1`,
`schema:"op03-external-permission-proof-v1"`, an identified `operator`,
`directWritesPaused:true`, millisecond UTC `captureStartedAt`/`captureEndedAt`,
`targetCreatedAt`, `permissionRecordText`, its `permissionRecordSHA256`, and
`permissions` entries for source/backup/target/nativeCopy with exact `id` and
`ownerOnly:true`.

The retained permission record is JSON with `version:1`,
`schema:"op03-drive-permissions-v1"`, a millisecond UTC `observedAt`, and exactly
four `files`. Each has its `role`, `id`, observed `createdTime`, `shared:false`,
and the observed `permissions` array. That array must contain exactly one
`{type:"user",role:"owner"}` entry, retaining either its observed `emailAddress`
or a SHA256 of the trimmed lowercase address under `emailAddressSHA256`. All
four owners must match. These are retained connector observations, not booleans
invented from a successful copy. Target creation must match the actual record
and precede the initial-empty observation. The operator's write-pause attestation
and the authenticity of supplied observations still require review.

The builder verifies packet bytes and provenance, recomputes every full native
comparison, source/manual grid and manifest/metadata binding, checks capture
times, and hashes the exact permission record. It reads the evidence path from
the supplied local commit with `git show` and requires byte-for-byte equality.
The dedicated unit suite injects an explicitly local commit-reader double; the
CLI always uses actual Git. Publishing that commit and independently reviewing
its evidence remain separate workflow gates: the runtime does not discover Git
history or prove that an operator observed what they recorded.

Only then build:

```sh
node test-support/build-google-manual-policy-drill.cjs verify CONFIG_JSON OUTPUT_GS
```

The builder calls the actual candidate `_integrityManualPolicyRows` and
`_integrityFingerprint` to produce the static synthetic pin. The separately
generated `OP03PolicyVerify.gs` contains the fixed policy, evidence and pin.
No cell, property or caller argument can enable a different policy. Production
and original-harness approval constants remain blank. Record the subsequent
pin/verifier commit separately to avoid a circular evidence hash.

## Real proof timing and failure behavior

The exact candidate helper bodies are copied into private scope. A delegating
wrapper measures the two actual calls made by real `finishOutpatientRecovery`.
It records `coreDurationMs` for each untouched production proof separately from
`nativeVerificationMs` for the added full-native comparison. That additional
comparison runs after the second core proof **before it returns**, under the real
script lock and before the real finish can delete the hold. Thus a late
formatting/row-visibility change cannot pass the value-only proof, clear the hold,
and only then be discovered by this harness.

The lock facade delegates to real locks and records wait/held duration. Namespaced
property and cache facades delegate to real services. The report verifies journal
validation, real cache removal, marker/inventory persistence, the second proof,
and hold deletion in that order. It distinguishes the deliberately refused policy
attempt from the valid finish. All final results retain `productionCertified:false`.

Late proof failures preserve the hold and any already persisted markers. Failure
packets retain timings and event order where evidence storage is available. A
later reporting/storage failure after a successful finish may occur after hold
release; read the actual state/properties and preserve both facts. Never infer
rollback or clear markers to retry. Compare actual total execution and lock times
against the native runtime budget; local-double times establish no Google timing
or production-scale capacity.

Native runs, activation approval, real fixed evidence, independent review and
production release remain distinct gates. This tooling completes none of them by
itself.
