# OP-03 native synthetic manual-policy evidence — 2026-10-27

## Frozen pre-verifier checkpoint

**Prepare, capture and restore each passed once in the existing isolated Google
project. The final fixed-policy verifier has not been built or run at this
checkpoint.** The target's namespaced recovery hold is deliberately retained.
This record and its exact binding must be published and independently reviewed
before constructing that verifier. Subsequent verification results belong in a
separate addendum so these committed evidence bytes remain fixed.

The production approval pin is blank. This is synthetic acceptance evidence,
not real patient recovery, production certification, merge permission or a
deployment. PR125 remains draft. No original five-phase function was repeated,
no state was reset, and no additional Apps Script project was created.

## Identity and approval

- Candidate/tooling commit: `dc09d5d36faade0b995a85d9d16219ab57b5867f`.
- Production helper source: unchanged from integrated candidate
  `3297311c4706cf650dbcbeb66b23c586dbc40d1c`.
- Existing script project:
  `1zZkII4vZXE-VJfSeWmYBjiobIf8CfLrrio6S1RGiZFq0qkn2VGwK4S8B`,
  named `OP03 SYNTHETIC NOT PRODUCTION 20261026 3297311c`.
- Policy fixture tag: `fb6e7460-4dca-4bc9-be66-d428f91f1ce9`.
- Original retained fixture tag: `e341511c-fa72-40ed-928d-206e4a75b826`.

Sandra explicitly approved adding Google Sheets API v4 and accepting the
displayed Google API/service terms in response to the preceding precise consent
question. The existing Add dialog was completed. The saved manifest was read
back: Sheets v4 is its only advanced service; Sheets is still its sole OAuth
scope, with V8 and `America/Los_Angeles` preserved. This did not authorize
production work or expand the earlier Sheets scope.

Before the new phase, the original five executions were still the only five,
all Completed; there were zero triggers and no policy properties/state. The
whole original `Code.gs` was copied from the UI without editing and matched
121,088 UTF-8 bytes / SHA256
`1ddb8de07a08d5b427f0ca06e914d3da0f5394af5c17363f8c4844aeb173f773`.
The new `OP03PolicySetup.gs` was saved beside it and read back in full:
78,920 UTF-8 bytes / SHA256
`ce3ba0deff8208fb04dd13becdf22eee90cf1008d30ae5b191e8f4d8109437d0`.
The original raw state remained byte-identical before and after each new phase.

The [activation/preflight record](op03-manual-tabs-2026-10-27/activation-preflight.json)
retains the exact manifest and hashes. The original five-phase evidence remains
in [its separate record](op03-google-drill-2026-10-27.md).

## Workbook identities

| Role | Exact workbook ID | Observed Drive creation time, UTC |
| --- | --- | --- |
| Original synthetic source, reused read-only | `1ksrByHl88PMGkKI8RjpGvQoX8zUPZFjcvy0t36c6FLE` | 2026-10-27T13:21:45.970Z |
| New policy backup and reports | `1erik1amGnhmPNC9u8gTnrzqxwNv1aP4R1iuxwFx_Nxc` | 2026-10-27T15:50:46.202Z |
| New initially empty policy target | `1F6yDJIqpoq8kwopkL20-ew1HYOGozfnfLtGYy4h9nKg` | 2026-10-27T15:50:46.787Z |
| New native copy from the capture interval | `1w4B2JWZl6fz30gyW2OY_G2I3Oqfr9X1bhGEUFQZQahI` | 2026-10-27T15:53:41.100Z |

The new artifacts have their exact tag/role names. All are distinct from the
original backup and target. The retained source has 13 sheets and 26,748 allocated
cells. The initially empty target had one `Sheet1`, zero used rows/columns and
1,000 × 26 allocated cells. Prepare retained its complete native inventory
before restore. The original source was not edited by this extension.

## Three completed native phases

All dates below are 2026-10-27 UTC. Google displayed Pacific time; the UI
observation is retained separately. The report, logger and platform durations
measure different boundaries and are not interchangeable.

| Phase | Packet phase start, UTC | Report time, UTC | Report ms | Logger ms | Google duration | Result |
| --- | --- | --- | ---: | ---: | ---: | --- |
| prepare | 15:50:44.533 | 15:50:51.879 | 7,346 | 7,553 | 9.226 s | PASS / Completed |
| capture | 15:53:20.277 | 15:55:21.674 | 121,397 | 121,546 | 123.653 s | PASS / Completed |
| restore | 15:57:05.826 | 15:58:48.872 | 103,046 | 103,264 | 106.596 s | PASS / Completed |

The Google execution list showed starts at 08:50:43, 08:53:19 and 08:57:05
Pacific, respectively, alongside the five unchanged original executions.
The capture interval was `15:53:22.460Z`–`15:55:17.706Z`; recovery metadata
was captured at `15:53:46.952Z`, and native-copy creation was inside that window.
The restore target observation was `15:58:46.763Z`.

Capture produced a fresh version-2 set with 22 manifest entries, including eight
explicit absent entries, the two manual tabs and recovery metadata. It retained
complete source inventories before and after capture plus the native-copy
inventory. Both source inventories have SHA256
`683537b0db8633a19cdaa0ad5c39db23dca5182043ec6ad9bfdbd6adcdcdecab`.
Source, native copy and restored target independently produce native comparable
SHA256 `322b522b35245d0e791c7e61a1f8af4169f4cff07f3e6748b6eabe7057c4a972`.

The actual classifications are `Sheet1` = `structural-empty` and
`Copy of Clients` = `retained-archive`. `Sheet1` is an empty 1 × 1 snapshot grid
but retains its native allocation of 1,000 × 26; the archive retains its 2 × 2
grid and allocation. Restore copied known datasets from the fresh snapshots and
the two manual sheets from the native copy, in original source order. Only the
known initial blank target sheet was removed after the copies existed. No
source, archive or evidence sheet was deleted or merged.

These synthetic observations contain no formulas, nonempty validations, merges,
protections or non-GRID sheets. Complete `includeGridData:true` responses with no
field mask retain cell formatting and dimension metadata within full allocated
ranges. The shared comparator preserves values, types, array order and nonempty
metadata while normalizing workbook identity and sheet IDs by source order.
This fixture's equality is not general proof for every Google-native object.

## Permission checkpoints and operator attestation

All connector metadata reads showed `shared:false` and exactly one user-owner
permission. Observed owner addresses were normalized and hashed before retention;
no private owner email is included. The same owner digest, IDs and creation times
matched across checkpoints.

| Checkpoint | Observation time, UTC | Files |
| --- | --- | --- |
| beforeCapture | 2026-10-27T15:51:11.760Z | source, backup, target |
| beforeRestore | 2026-10-27T15:55:35.500Z | source, backup, target, nativeCopy |
| beforeVerifier | 2026-10-27T15:59:20.405Z | source, backup, target, nativeCopy |

Each timestamp was recorded after its batch of Drive reads completed and before
the next phase. The exact records and byte hashes are retained below. They are
connector observations, not continuous permission monitoring.

Codex was the sole operator of this synthetic workflow. A direct-write pause was
recorded at 15:50:58 UTC, before capture, and maintained through the current
checkpoint; no interactive workbook edits were made and no trigger was present.
The external proof uses the exact narrower native capture interval inside that
pause. This is an operator attestation; ScriptLock cannot block other direct
editors or independently prove that pause. Maintaining the pause until the final
verifier completes remains required.

## Exact retained state and packets

At this checkpoint, policy state is `restored`, `running:false`, without `failed`;
`OP03_POLICY_FIXTURE_OUTPATIENT_RECOVERY_HOLD` is `"1"`.
Its exact raw-state SHA256 is
`ff4c153f75059181d25bee0aaea4b3597280a21facbe5d242c8927711faece94`.
The unchanged original state hashes to
`47ac4ce4c4372b9bfa85fb6d254f6c008c73a46e9a67db6eff422f28ba25e55f`;
the original five-PASS report fingerprint is
`77ebb16670304a6c93b4ea2b25dc79d3d595849df60c5984ded5826b6e24ead0`.

The packet files preserve exact reconstructed JSON bytes, with no reformatting
or appended newline. Chunk counts, sequence and SHA256 were checked against
`_PolicyEvidence` and the saved state. Every published inventory is synthetic.

| File | UTF-8 bytes | Exact SHA256 |
| --- | ---: | --- |
| [prepare.packet.json](op03-manual-tabs-2026-10-27/prepare.packet.json) | 674,296 | `f028572d138edb38ec6d68056a779b56df5e2c6ca755e5db6234a55575c7b4fd` |
| [capture.packet.json](op03-manual-tabs-2026-10-27/capture.packet.json) | 3,813,683 | `262bbe7c31944612f03e262155ca69a61ee18dfc258839f4f3d7da7ce17d52d8` |
| [restore.packet.json](op03-manual-tabs-2026-10-27/restore.packet.json) | 1,268,958 | `62a786ca7ddd302ab43ae55792ee886f543ad7061133db6b894fa1979c18ceef` |
| [permissions-before-capture.json](op03-manual-tabs-2026-10-27/permissions-before-capture.json) | 912 | `0a304477a984fd564eb4d6217bcbabbb52684f5d4f8369c16d4743d85d1187ca` |
| [permissions-before-restore.json](op03-manual-tabs-2026-10-27/permissions-before-restore.json) | 1,177 | `05145e4074658ead57f6d39c788449637b02f6e006a6f709106b81b72e086c39` |
| [permissions-before-verifier.json](op03-manual-tabs-2026-10-27/permissions-before-verifier.json) | 1,178 | `2795bafe585b740f6b08ed6e6874b16647d98bd31995f621ed70d64b74130a36` |

The companion directory retains exact properties after every phase, the report,
packet index, execution-table observation, manifest/code preflight, external
proof and pre-run Claude review scope. Reconstruct builder inputs from the exact
property value strings, packet files and parsed `external-proof.json`, preserving
the external proof's object order and embedded record bytes. The binding builder
ran its complete input checks successfully on these native observations.

## Review and next gate

Claude's [pre-run document review](https://github.com/sandrabrayer/ezone-outpatient/pull/125#issuecomment-6446555065)
found no new blocking sequencing issue. It read one runbook, ran no tests, made no
edits and performed no Google actions. An independent local read-only evidence
audit recomputed the native packet, inventory, manifest and permission hashes.
The separate review of this actual evidence must be recorded after publication.

Only after that review, build `OP03PolicyVerify.gs` from this exact evidence
commit, raw restored state and fixed external proof. Read the whole saved
verifier back before running its single entry point once. It must refuse a
changed policy, perform both real finish proofs and the late native comparison
under lock before hold removal, and record actual timings and side-effect order.
Any failure/running state must be preserved without reset or blind retry.

The 240,000 ms budget is cooperative. Native capture and restore completed within
it, but final proof timing remains unmeasured. A single long Google call or hard
platform termination cannot be interrupted. A reporting failure after a
successful finish may observe an already-cleared hold; never claim rollback.

Existing local code validation remains 1,779 passed / 0 failed / 38 skipped,
including 25 focused tool cases, at dc09d5d3; dependency audit 0 on the unchanged
lockfile. These evidence-only additions require no new implementation test run.
No exact-head test CI/checks were available at this checkpoint. The older
1,754-test plus 32-browser result belongs to 3297311c. No production approval,
real manual-tab policy, production timing or alert-delivery evidence is granted
by this synthetic result. The full ten-system plan and separate CRM work remain
unchanged.

## Machine-readable binding

The following block is generated from the actual retained inputs. Its exact
bytes are required by the final verifier builder; it deliberately excludes this
Markdown file's own hash, its commit ID and the later pin to avoid a hash cycle.


<!-- OP03_POLICY_BINDING_V1_BEGIN -->
```json
{
  "chronology": {
    "captureEndedAt": "2026-10-27T15:55:17.706Z",
    "capturePhaseStartedAt": "2026-10-27T15:53:20.277Z",
    "captureStartedAt": "2026-10-27T15:53:22.460Z",
    "metadataCapturedAt": "2026-10-27T15:53:46.952Z",
    "permissions": {
      "beforeCapture": "2026-10-27T15:51:11.760Z",
      "beforeRestore": "2026-10-27T15:55:35.500Z",
      "beforeVerifier": "2026-10-27T15:59:20.405Z"
    },
    "prepareObservedAt": "2026-10-27T15:50:50.379Z",
    "prepareStartedAt": "2026-10-27T15:50:44.533Z",
    "restoreObservedAt": "2026-10-27T15:58:46.763Z",
    "restoreStartedAt": "2026-10-27T15:57:05.826Z",
    "targetCreatedAt": "2026-10-27T15:50:46.787Z"
  },
  "externalProofSHA256": "69f8202cfad6ca593d1373067af295d221cfcdf261d7dc6306b9e728b5587e19",
  "inventory": {
    "afterSHA256": "683537b0db8633a19cdaa0ad5c39db23dca5182043ec6ad9bfdbd6adcdcdecab",
    "beforeSHA256": "683537b0db8633a19cdaa0ad5c39db23dca5182043ec6ad9bfdbd6adcdcdecab",
    "comparableSHA256": "322b522b35245d0e791c7e61a1f8af4169f4cff07f3e6748b6eabe7057c4a972",
    "manifestSHA256": "ca0c02fa5c2445fa54c7cd2991a310834a540944dbce9537fa497afc9cc0565d",
    "manualTabsSHA256": "6a667e123b8212423fb689ed2b994f9078be67edaa210c99e3fe7c277eba8023",
    "metadataSHA256": "9c15b957c95cc59b23775a7eecddcfb1901348bd4754771034cd36d48f05de22"
  },
  "originalDrill": {
    "definitionSHA256": "4c9f57d33f7ffd15441005cccc81a96dfc0d2ed8b0ee1c5fcc9f20b55d93cc91",
    "helperSHA256": "f73935f89f9dbaf9bf3b6f4908bb837783e15accb3c6597da69603b255ba4c63",
    "ids": {
      "backup": "1UWQkFMe7U3i4A9KVnEvw09qd83xIZyhNy9nRCXsagbQ",
      "source": "1ksrByHl88PMGkKI8RjpGvQoX8zUPZFjcvy0t36c6FLE",
      "target": "1ogZ_2oWxkoSIVwJqWvjLi_3vlr8J_U31RmqBqLaDRkI"
    },
    "sourceSHA256": "bd597c3991c0daf7dbd83ccebf634dc01c905bed62639a0d7af704fb559e6014",
    "stateSHA256": "47ac4ce4c4372b9bfa85fb6d254f6c008c73a46e9a67db6eff422f28ba25e55f",
    "tag": "e341511c-fa72-40ed-928d-206e4a75b826"
  },
  "packetSHA256": {
    "capture": "262bbe7c31944612f03e262155ca69a61ee18dfc258839f4f3d7da7ce17d52d8",
    "prepare": "f028572d138edb38ec6d68056a779b56df5e2c6ca755e5db6234a55575c7b4fd",
    "restore": "62a786ca7ddd302ab43ae55792ee886f543ad7061133db6b894fa1979c18ceef"
  },
  "permissionRecordSHA256": {
    "beforeCapture": "0a304477a984fd564eb4d6217bcbabbb52684f5d4f8369c16d4743d85d1187ca",
    "beforeRestore": "05145e4074658ead57f6d39c788449637b02f6e006a6f709106b81b72e086c39",
    "beforeVerifier": "2795bafe585b740f6b08ed6e6874b16647d98bd31995f621ed70d64b74130a36"
  },
  "policySetup": {
    "day": "2026-10-27",
    "definitionSHA256": "5ecdd49e1146e1e811bde90e07f14e27b4319a38742eff2ee2e151504373cb8f",
    "helperSHA256": "15cb194da60d42f9036faf4ecb61f74970b390abe4ef8430f84393d28b36c565",
    "ids": {
      "backup": "1erik1amGnhmPNC9u8gTnrzqxwNv1aP4R1iuxwFx_Nxc",
      "nativeCopy": "1w4B2JWZl6fz30gyW2OY_G2I3Oqfr9X1bhGEUFQZQahI",
      "source": "1ksrByHl88PMGkKI8RjpGvQoX8zUPZFjcvy0t36c6FLE",
      "target": "1F6yDJIqpoq8kwopkL20-ew1HYOGozfnfLtGYy4h9nKg"
    },
    "sourceSHA256": "bd597c3991c0daf7dbd83ccebf634dc01c905bed62639a0d7af704fb559e6014",
    "stateSHA256": "ff4c153f75059181d25bee0aaea4b3597280a21facbe5d242c8927711faece94",
    "tag": "fb6e7460-4dca-4bc9-be66-d428f91f1ce9"
  },
  "productionCertified": false,
  "schema": "op03-policy-evidence-binding-v1",
  "scriptId": "1zZkII4vZXE-VJfSeWmYBjiobIf8CfLrrio6S1RGiZFq0qkn2VGwK4S8B",
  "version": 1
}
```
<!-- OP03_POLICY_BINDING_V1_END -->
