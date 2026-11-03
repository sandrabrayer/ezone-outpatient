# Isolated native manual-policy drill tooling

Status: **native prepare/capture/restore/verify each passed once on 2026-10-27**.
The final state is `verified`, `running:false`, with no failure flag; the fixture
hold is absent after the real two-pass finish and late native comparison. See the
[frozen pre-verifier evidence](evidence/op03-manual-tabs-2026-10-27.md) and the
separate [result addendum](evidence/op03-manual-tabs-2026-10-27-result.md).
The original five native phases at candidate `3297311c` have separate retained
evidence and were not repeated. Sandra explicitly approved the service-dialog
terms; Google Sheets API v4 was added in the existing project, and the manifest
was read back with the same sole Sheets scope, runtime and timezone. Activation
approval does not authorize production work or a new project.

Google execution durations were 9.226/123.653/106.596/104.427s in phase order.
The existing project now retains nine Completed executions, including the five
original phases. The procedure below documents the completed acceptance path;
do not run any phase again, reset its state or create a replacement project.
This fixture's success does not certify production data, policy or capacity.

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
After the recorded owner approval, the saved service dependency is:

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

Retain three permission checkpoints through the Drive connector: the original
source plus new backup and target after prepare and before capture; those three
plus the native copy after capture and before restore; and all four after restore
and before constructing the verifier. Save the exact observed metadata and
permission-record bytes at each checkpoint, including IDs, owner identities and
creation times. The builder rejects missing checkpoints or inconsistent
chronology. ScriptLock cannot prevent direct editor writes: keep the synthetic
files under a coordinated write pause. These connector observations and that
write pause remain operator responsibilities, not actions performed by the
Sheets-only script.

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
budget is 100,000 per workbook; exceeding it fails closed. The retained original
fixture has 13 sheets and 26,748 allocated cells: `Sheet1` is 1,000 × 26 and
`Copy of Clients` is 2 × 2. See the actual allocated dimensions in
`docs/evidence/op03-google-drill-2026-10-27.json`.

The shared canonicalizer sorts object keys only. It preserves actual values,
types, array/source order and all nonempty cell/dimension metadata. For comparing
distinct workbooks, it removes only workbook ID/URL/title and maps sheet IDs to
their source-order positions. Sparse omitted/empty grid cells and dimension
entries represent native defaults inside the explicit allocated rectangle.
Nonempty metadata is not discarded or coerced. The complete raw observations are
also retained, so the comparison representation remains auditable.

The explicit fixture preconditions reject non-GRID sheets, formulas, nonempty
data validations, merges and protections. The script reads those properties and
checks their absence. Nonempty features in that list require separate fixture
work. Other native fields, including formatting, conditional formats, charts,
named ranges, row/column metadata and hidden dimensions, are retained and compared
as returned; retaining a field does not establish general restoration support.
A copy whose native representation differs can fail comparison even when it
passes the explicit absence checks. Full native equality on this synthetic
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

The external proof has `version:2`,
`schema:"op03-external-permission-proof-v2"`, an identified `operator`,
`directWritesPaused:true`, millisecond UTC `captureStartedAt`/`captureEndedAt`,
`targetCreatedAt`, and exactly three entries under `permissionRecords`:

```json
{
  "beforeCapture": { "text": "EXACT_RETAINED_JSON", "sha256": "SHA256_OF_THOSE_UTF8_BYTES" },
  "beforeRestore": { "text": "EXACT_RETAINED_JSON", "sha256": "SHA256_OF_THOSE_UTF8_BYTES" },
  "beforeVerifier": { "text": "EXACT_RETAINED_JSON", "sha256": "SHA256_OF_THOSE_UTF8_BYTES" }
}
```

Each retained record is JSON with `version:2`,
`schema:"op03-drive-permissions-v2"`, its matching `checkpoint`, a millisecond UTC
`observedAt`, and `files`. `beforeCapture` contains exactly source/backup/target;
the two later records contain those three plus nativeCopy. Each file has its
`role`, `id`, observed `createdTime`, `shared:false`, and observed `permissions`
array. That array must contain exactly one `{type:"user",role:"owner"}` entry,
retaining either its observed `emailAddress` or a SHA256 of the trimmed lowercase
address under `emailAddressSHA256`. All owners must match. A role's ID, owner and
creation time must remain identical across observations.

The v2 prepare/capture/restore packets retain `phaseStartedAt` and their actual
observation timestamps. The builder requires the following chronology:

| Observation | Earliest permitted time | Latest permitted time |
| --- | --- | --- |
| `beforeCapture` | Prepare initial-empty observation | Capture phase start |
| `beforeRestore` | End of capture | Restore phase start |
| `beforeVerifier` | Restore target observation | Local verifier build; also checked against the actual native verifier start |
| Backup/target creation | Prepare phase start | Prepare initial-empty observation |
| Native-copy creation | Start of capture interval | End of capture interval |

Every file must already exist at its observation time. The original source must
predate preparation, and `targetCreatedAt` must equal the observed target creation
time. The capture interval must enclose the metadata capture time. All times are
validated exact ISO UTC strings, not approximate dates. These are retained
connector observations, not booleans inferred from a successful copy. Consistent
recorded timestamps do not independently prove an operator's observations or
write pause; those claims still require review.

The builder verifies packet bytes and provenance, recomputes every full native
comparison, source/manual grid and manifest/metadata binding, checks capture
times, and hashes all three exact permission records. It also requires one unique
machine-readable binding block in the committed Markdown, derived from these
actual inputs. The block binds both states, project/workbook identities, tags,
code definitions, retained packets, inventory/manifest/metadata/manual-tab
digests, external proof, permission records and checkpoint times. An arbitrary
committed narrative without this exact block is insufficient. The builder reads
the evidence path from the supplied local commit with `git show` and requires
byte-for-byte equality.
The dedicated unit suite injects an explicitly local commit-reader double; the
CLI always uses actual Git. Publishing that commit and independently reviewing
its evidence remain separate workflow gates: the runtime does not discover Git
history or prove that an operator observed what they recorded.

Construct the evidence and verifier in this order:

1. After the real phases and three permission checkpoints, assemble the
   configuration from exact retained inputs. Leave `evidenceRecord` out initially.
2. Generate the binding block with the same builder and those actual inputs:

   ```sh
   node test-support/build-google-manual-policy-drill.cjs binding CONFIG_JSON NEW_BINDING_MD
   ```

3. Include the complete generated block exactly once in the dated evidence
   Markdown, alongside the reviewed narrative. Preserve its marker lines,
   formatting and JSON bytes. The binding command runs the same input checks as
   verifier construction; it has no skip-verification option.
4. Commit that exact evidence file. Publish the reviewed evidence commit through
   the separate authorized workflow before using the final verifier. Then add
   `evidenceRecord.path`, its exact `text`, and the exact local commit to the same
   configuration. No other inputs may change without regenerating the block and
   committing the updated evidence.
5. Build the final verifier:

```sh
node test-support/build-google-manual-policy-drill.cjs verify CONFIG_JSON OUTPUT_GS
```

The builder calls the actual candidate `_integrityManualPolicyRows` and
`_integrityFingerprint` to produce the static synthetic pin. The separately
generated `OP03PolicyVerify.gs` contains the fixed policy, evidence and pin.
No cell, property or caller argument can enable a different policy. Production
and original-harness approval constants remain blank. Record the subsequent
pin/verifier commit separately. The evidence binding deliberately excludes the
Markdown's own hash, evidence commit and final policy pin, avoiding circular
dependence. The final verifier separately fixes the exact Markdown hash, evidence
commit and pin after the evidence exists.

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
rollback or clear markers to retry.

Each phase has a fixed **240,000 ms (four-minute) cooperative elapsed-time
budget**, leaving reporting headroom below Google's documented
[six-minute Apps Script execution limit](https://developers.google.com/apps-script/guides/services/quotas).
Checks surround expensive inventory, copy, snapshot and proof work, check before
returning the late native proof, and check immediately in the namespaced hold
deletion path. A deletion event is recorded only after that last check passes.
Elapsed-time failure retains the hold if it has not already been released;
already-created workbook IDs are saved before post-copy checks. Failed/running
states, partial work and diagnostics are retained without reset or blind retry.

The budget is cooperative, not a guaranteed four-minute maximum: a single Google
call, an untouched production helper call or a hard platform timeout cannot be
interrupted by this wrapper. A hard timeout may leave `running:true`. Failure
state, diagnostic-packet writes and lock cleanup are deliberately best-effort and
unguarded so that elapsed-time checks do not prevent reporting during the
remaining headroom. A call after successful hold deletion can still fail, so
diagnostics retain the actual hold value rather than claiming rollback. Compare
actual native execution and lock times against the budget; local-double timings
establish no Google timing or production-scale capacity.

Native runs, activation approval, real fixed evidence, independent review and
production release remain distinct gates. This tooling completes none of them by
itself.
