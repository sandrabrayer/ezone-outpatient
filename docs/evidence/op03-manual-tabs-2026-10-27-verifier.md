# OP-03 fixed synthetic verifier identity — 2026-10-27

This is the separate verifier-construction checkpoint. The native final verifier
has **not run** at this checkpoint. The three preparation/capture/restore results
and their immutable evidence remain in commit
`9ed06ddf3e947f4700f51908194d64fab18e66ed`.

The unchanged builder read the real committed Markdown with `git show`, required
its exact bytes and unique generated binding, and validated the actual packets,
three permission checkpoints and raw restored state before rendering the module.
Its output passed a local JavaScript syntax compilation without executing it.
No production source, original runner or setup module was edited.

| Binding | Exact value |
| --- | --- |
| Generated module | `OP03PolicyVerify.gs` |
| UTF-8 bytes | 88,752 |
| File SHA256 | `8ae5d5f1eb1e291db879071cca8ea0f82e677193a9c07f479877fed405abe268` |
| Verifier definition SHA256 | `05bba7412842f176dcfcc512a87c2408c054bfa8359d6a599de3c27cdc5472d9` |
| Synthetic policy pin | `dc0421c1037802c784b14af9fe345def8bc731d299666c9dd3c58f8574422565` |
| Evidence record SHA256 | `4998ad6bf53a73f4e488ab3d9891bf2a8bbfed1ccbfa73252c3214bf61469fea` |
| Raw restored state SHA256 | `ff4c153f75059181d25bee0aaea4b3597280a21facbe5d242c8927711faece94` |
| External proof SHA256 | `69f8202cfad6ca593d1373067af295d221cfcdf261d7dc6306b9e728b5587e19` |

The exact [identity](op03-manual-tabs-2026-10-27/fixed-verifier-identity.json),
[fixed synthetic policy](op03-manual-tabs-2026-10-27/fixed-synthetic-policy.json)
and [review scope](op03-manual-tabs-2026-10-27/evidence-review-before-verifier.json)
are retained separately from the frozen evidence. This test pin applies only
inside the generated private verifier scope. Production and original-runner
pins remain blank, and all results retain `productionCertified:false`.

Claude's [evidence review](https://github.com/sandrabrayer/ezone-outpatient/pull/125#issuecomment-6446953785)
found no inconsistency in the narrative, file hashes, state and permissions it
inspected. Its environment refused approval for Node commands, so it did not
recompute the binding or full native inventory. A separate read-only local audit
did recompute those inputs, all manifest/metadata/grid hashes and chunk sequences,
and matched the generated binding byte-for-byte. Neither review independently
witnessed the Google operations. The builder's actual committed-evidence read
also succeeded; it was not replaced by a test reader.

Rebuild by assembling the exact inputs described in the frozen evidence, then
adding `evidenceRecord.path`, the exact Markdown text from the evidence commit,
and that full commit SHA. Run the documented `verify` builder mode with a new
output path. Do not replace the fixed external proof with a reformatted object,
alter its embedded permission records, change state, or rerun completed phases.

Before the single native verification, read the whole saved module back and
match the file hash above. Require the original state unchanged and the policy
state still exactly `restored`, idle, without failure, with its hold retained.
The verifier must prove changed-policy refusal, both actual finish proofs, late
native comparison before hold removal, real cache/property order and timings.
Preserve a failure/running state without reset. Publish actual results in a
separate result addendum; this construction checkpoint itself proves no native
verification or production readiness.
