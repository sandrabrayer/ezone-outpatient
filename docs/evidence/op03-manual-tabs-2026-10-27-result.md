# OP-03 isolated manual-policy acceptance — completed 2026-10-27

## Result and boundary

**All four separate policy phases passed natively, once each, in the existing
Google test project.** The final policy state is `verified`, `running:false`,
with no failure flag. The namespaced recovery hold is absent. The changed-policy
attempt was refused; the valid finish passed both real internal proofs and its
late native comparison before deleting the hold. The original five-phase state
and report remain byte-for-byte/value-for-value unchanged respectively. Google
Executions shows exactly nine Completed entries: those original five and these
four. No phase was rerun, state reset, project replaced, merge performed or
production deployment made.

This completes the **isolated synthetic approved-policy acceptance gate**, not
production recovery certification. The production approval constant and the
original runner's pin remain blank. Real source/archive evidence, an exact
reviewed production policy, current-header backup readiness, release/alert
evidence and separate production authorization remain open.

This addendum preserves the immutable
[pre-verifier evidence record](op03-manual-tabs-2026-10-27.md) at commit
`9ed06ddf3e947f4700f51908194d64fab18e66ed` and the separate
[verifier-construction checkpoint](op03-manual-tabs-2026-10-27-verifier.md) at
`cd5b658382927a3ec6538d1aae2106637d9b4626`. Their statements that verification was
pending describe those checkpoints. Neither document nor its fixed input bytes
was changed after the verifier was built.

## Exact project, files and compiled identities

Existing project: `OP03 SYNTHETIC NOT PRODUCTION 20261026 3297311c`.
Script ID: `1zZkII4vZXE-VJfSeWmYBjiobIf8CfLrrio6S1RGiZFq0qkn2VGwK4S8B`.
The owner explicitly approved the displayed Google API terms. Sheets API v4 was
added in that project; the saved manifest retained the sole Sheets OAuth scope,
V8 and its existing timezone. No new grant, trigger or deployment was needed.

Policy fixture tag: `fb6e7460-4dca-4bc9-be66-d428f91f1ce9`.

| Role | Workbook ID |
| --- | --- |
| Original synthetic source, reused read-only | `1ksrByHl88PMGkKI8RjpGvQoX8zUPZFjcvy0t36c6FLE` |
| Separate policy backup/report | `1erik1amGnhmPNC9u8gTnrzqxwNv1aP4R1iuxwFx_Nxc` |
| Separate initially empty target | `1F6yDJIqpoq8kwopkL20-ew1HYOGozfnfLtGYy4h9nKg` |
| Native copy created during capture | `1w4B2JWZl6fz30gyW2OY_G2I3Oqfr9X1bhGEUFQZQahI` |

The saved `OP03PolicyVerify.gs` was read back in full before its sole execution:
88,752 UTF-8 bytes, SHA256
`8ae5d5f1eb1e291db879071cca8ea0f82e677193a9c07f479877fed405abe268`.
Its definition is
`05bba7412842f176dcfcc512a87c2408c054bfa8359d6a599de3c27cdc5472d9`;
the private synthetic policy pin is
`dc0421c1037802c784b14af9fe345def8bc731d299666c9dd3c58f8574422565`.
The actual committed evidence was read with `git show`, without a substituted
reader or bypass. Local and independent checks reproduced the binding, policy
fingerprint and generated-module identity before upload. The fixed identity
record's `nativeRun:false` remains an accurate construction-time observation.

## Native executions and measured time

All dates below are 2026-10-27. Packet/report timestamps are UTC. The Google
execution UI displays America/Los_Angeles (UTC−7); Israel time is UTC+2 on this
date. The phase's report duration, Logger duration and Google's total execution
duration have different start/end boundaries and are retained separately.

| Phase | Packet start UTC | PASS report UTC | Report ms | Logger ms | Google seconds |
| --- | --- | --- | ---: | ---: | ---: |
| prepare | 15:50:44.533 | 15:50:51.879 | 7,346 | 7,553 | 9.226 |
| capture | 15:53:20.277 | 15:55:21.674 | 121,397 | 121,546 | 123.653 |
| restore | 15:57:05.826 | 15:58:48.872 | 103,046 | 103,264 | 106.596 |
| verify | 16:11:02.379 | 16:12:44.702 | 102,323 | 102,435 | 104.427 |

The final verifier observation is `2026-10-27T16:12:43.443Z`. The executions
table was retained at `2026-10-27T16:14:48.894Z`; it contains one execution of
each policy function and the five original functions, all Completed. The final
report contains four PASS rows. The evidence index contains a header and 194
chunks: prepare 23, capture 127, restore 43 and verify 1. The exact verification
packet is the single `_PolicyEvidence!E195` value, retained without a trailing
newline: 11,514 UTF-8 bytes, SHA256
`f324d38b2dfb8567f1c0135cd06bd9742b87d3f9c343e751b42fe7cc2752cf6f`.

### Real finish, refusal and hold ordering

| Measurement | Actual milliseconds |
| --- | ---: |
| Changed-policy core proof, refused | 6,472 |
| Changed-policy lock wait / held | 106 / 6,506 |
| Valid first core proof | 10,296 |
| Valid second core proof | 6,064 |
| Late full native comparison inside the second proof wrapper | 29,128 |
| Complete second proof wrapper | 35,192 |
| Valid finish lock wait / held | 98 / 46,104 |
| Complete valid finish call | 46,347 |

The changed policy failed with `Error: Manual recovery policy digest mismatch`.
Its recorded event sequence is lock acquisition, proof start, proof refusal and
lock release, with no intervening cache, journal or property mutation. The valid
finish then recorded, in order:

1. Acquire the real script lock and pass the first proof.
2. Validate two journal operations.
3. Remove the therapist-rates cache and restore the financial marker and required
   source list.
4. Start and pass the second proof, including the late full native comparison.
5. Delete the namespaced recovery hold, then release the lock.

The second `proof-pass` and hold deletion share timestamp `1793117562958`; their
order is established by the retained event-array order and the verifier's
before-delete guard, not a claimed positive millisecond gap. The full native
comparison is inside the second proof wrapper, before that wrapper returns to
the unchanged real finish function. The packet records `targetUnchanged:true`,
`originalSourceUnchanged:true`, `holdReleasedLast:true` and
`productionCertified:false`.

The observed phase completed within the fixed 240,000 ms cooperative budget.
These times describe this fixture only. A single in-flight Google call or hard
execution termination remains outside that cooperative guard; these results
do not establish production-scale timing or hard cancellation.

## Final saved state and preservation

The exact raw `OP03_POLICY_DRILL_STATE` string hashes to
`538bdf6bed9e20059525a4d4d3384ab0b33ca1e730bc34dd59ddd92ce875f36a`.
It records `phase:"verified"`, `running:false`, all four exact packet hashes,
the compiled verifier definition and the fixed synthetic pin. There is no
`failed` field and no `OP03_POLICY_FIXTURE_OUTPATIENT_RECOVERY_HOLD` property.
The final `activePhase:"verify"` and start timestamp are retained diagnostics,
not an active execution.

`OP03_POLICY_FIXTURE_FINANCIAL_OPS_CREATED` equals `"1"`. Its required-source
property contains all 13 restored names in order:
`Leads`, `Sheet1`, `Copy of Clients`, `Clients`, `FinancialOps`, `Payments`,
`ClientCharges`, `Settings`, `TherapistRates`, `SessionLog`, `PackageCatalog`,
`PackageRequests`, `AuditLog`.

The original exact state still hashes to
`47ac4ce4c4372b9bfa85fb6d254f6c008c73a46e9a67db6eff422f28ba25e55f`;
its phase remains `manual_block_verified`, idle and without failure. The original
five-row report read after completion matches the earlier values, fingerprint
`77ebb16670304a6c93b4ea2b25dc79d3d595849df60c5984ded5826b6e24ead0`.
Original fixture properties and code were preserved. The historical October26
project and evidence were not changed.

The frozen native evidence covers 13 source/target sheets, 26,748 allocated
cells and 22 manifest entries, including eight explicit absences and the two
manual tabs. `Sheet1` remains structural-empty with its 1,000×26 allocation;
`Copy of Clients` remains a separate 2×2 retained archive. Full allocated-range
native observations include cell and dimension metadata. The source inventory
before/after hash is
`683537b0db8633a19cdaa0ad5c39db23dca5182043ec6ad9bfdbd6adcdcdecab`;
the source/copy/restored comparable hash is
`322b522b35245d0e791c7e61a1f8af4169f4cff07f3e6748b6eabe7057c4a972`.
Only object keys are canonicalized; array order, types and nonempty cell/dimension
metadata are retained. The fixture has no formulas, validations, merges,
protections or non-GRID sheets; it cannot certify those absent feature classes.
The final packet records the late comparison's successful outcome; its full
raw response is not a new fourth inventory packet.

## Permissions, reviews and carried validation

The three fixed chronological permission observations remain unchanged. Fresh
supplementary reads at `16:10:02.236Z`, before the verifier, and `16:14:20.971Z`,
after it, again show all four exact IDs private, with one unchanged owner and
unchanged creation times. These supplementary observations do not replace the
bytes compiled into the verifier. No plaintext owner email is retained. The
write pause is a sole-operator attestation; snapshots are not continuous
permission monitoring and ScriptLock does not prevent direct spreadsheet edits.

Claude's [pre-run sequencing review](https://github.com/sandrabrayer/ezone-outpatient/pull/125#issuecomment-6446555065)
and [frozen-evidence review](https://github.com/sandrabrayer/ezone-outpatient/pull/125#issuecomment-6446953785)
reported no blocker in their inspected scopes. The latter checked narrative
bytes, selected file digests, state, permission identities and chronology;
Claude's environment did not approve its Node recomputation commands. Root and
an independent agent performed the full binding/native-evidence recomputation
and generated-verifier checks separately. A final bounded review of these new
results is tracked in PR125; this document does not claim an unreceived verdict.
An independent final local evidence audit reproduced all four packet digests,
the final raw state, original report fingerprint, chunk chronology and measured
event ordering, and found no blocking discrepancy. It performed no Google
action, test rerun or edit.

No implementation changed after `dc09d5d3`. Its local UTC suite result remains
1,779 pass / 0 fail / 38 skip (1,817 total), including 25 focused harness cases;
the dependency audit was zero on the unchanged lockfile. It was not rerun for
these evidence-only changes. The previous 1,754 plus 32 browser result belongs
to `3297311c`, not to a new head. No exact-head test CI existed at `9ed06ddf`;
the final published-head observation is recorded separately in the PR and plan.

## Retained final evidence

All paths below are within [the companion directory](op03-manual-tabs-2026-10-27/).
File SHA256 values refer to complete bytes; the final state fingerprint above
refers specifically to the raw state string inside its property observation.

| File | Bytes | SHA256 |
| --- | ---: | --- |
| `verify.packet.json` | 11,514 | `f324d38b2dfb8567f1c0135cd06bd9742b87d3f9c343e751b42fe7cc2752cf6f` |
| `properties-verified.json` | 2,854 | `5ff4eb2ce41de2af30fddfc92e4a73586c5b8b0ac6733befa0abe78ba4162dd2` |
| `executions-final.json` | 1,146 | `5e8286ae6178dd6211f8839c5a643dfaa3930c86d90830e9dfc65a11c238aade` |
| `policy-report-final.json` | 2,124 | `b73c086ce44da3c8500e74fd12081c18b720a75bf7895691e0c3830363a5d14c` |
| `packet-index-final.json` | 24,926 | `a9c08896eeac586ed0f74cfa177b92ca05a0c34d5fe4348fc5b77a47a107396e` |
| `original-report-after-policy.json` | 2,210 | `4429125e17fc9d40e94f2d2c7e364ddd5e985744ff593098c9ac066fe78788b1` |
| `permissions-immediately-before-native-verifier.json` | 1,350 | `ae09f333e46913b0ca70d29b48ba34892944f0ffb215a0fc5a2096506587536b` |
| `permissions-after-native-verifier.json` | 1,342 | `2b68373f3e424fcb72e1fa92ba293657ec6eb278751025d22d7e9a015e77943d` |
| `native-verifier-start.json` | 737 | `76bd103acc65fc179fbbbc4b29aa54f2374eb5e7cc1fe45bdc1b374c64517a56` |

## Exact return point

Preserve the completed test project, all nine executions, original and policy
states, reports and workbooks. Do not run any of these phases again or rebuild
them against a new baseline. Do not change the frozen evidence, fixed policy or
verifier to manufacture another result.

The next OP-03 work is the remaining release-readiness evidence and current-head
CI gap, followed by an explicit production decision. Production source/header
readiness and exact manual-tab policy require their own evidence; neither the
old incomplete nightly backup nor this small synthetic fixture substitutes for
it. Keep PR125 draft and open. Continue the ten-system program from the shared
plan, preserving the separate CRM display owner and all OP-02b2, OP-04/05/06,
CRM and finance return points. No merge or production deployment is authorized.
