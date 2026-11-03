# OP-BILL-01 / #162 — integrated qualification, 3 November 2026

**One candidate: existing #162. Production HOLD.** The earlier integration failures have been resolved in the draft. Fresh native Google acceptance, source/configuration evidence and staff UAT remain necessary before Sandra's explicit release approval. No PR merge, deployment, live data or permission/credential operation is authorized.

## Existing work reused

| Input | Exact commit | Scope |
| --- | --- | --- |
| #162 | `567d1a9e07b2b5cf4465a9b1712014eaaf25b634` | Paid-date billing, deployed #158/#161, receipt fix and transition tests |
| #148, includes #142–147 | `2520d957336c53963e6c55b70489ae755bd6fc5d` | Money boundary, CRM, handoff feed and UI |
| #160, includes #139/#125 | `6673e1ef25f8c758abd475bf74c5e138e568cc1b` | Operational recovery and typed CRM backup |
| Deployed base | `98c49c72396b76082498826ab7aa51890b89e9cb` | Production #158/#161 baseline |

Dependencies are incorporated for review in #162, not independently merged, closed or deployed. #157 remains historical staging. Preserve SW v24 above observed live v23, the hotfixes and all #162 acceptance tests. Documentation and browser-workflow unions replace the obsolete per-PR release sequence. Compatible lockfile patches from #139 are reused.

## Integration defects and recovery proof

All six CRM mutation actions could pass the entry hold check, wait for their lock, then write after recovery started. The three shared entry points now recheck `OUTPATIENT_RECOVERY_HOLD` inside the lock before touching any sheet. `getTasks` and `getActivity` now read existing tables only, without creating or expanding them. Twenty regression cases initially produced eight failures; all pass after the fix.

The previous 40 failures came from fixed old inventories, pre-CRM fixtures implicitly loading new schemas and the historical generated-file comparison. Tests now check independently enumerated exact source sets: 19 base families or 21 with CRM, plus metadata/manual tabs as appropriate. Old-schema fixtures explicitly omit CRM definitions; current headers must match their expected full schemas. Half-present pairs, invalid IDs, tampered checksums and old opaque snapshots remain blocked. No historical backup is relabelled or migrated.

The candidate drill includes source-created linked contact/follow-up rows, mixed financial journals, payments, charges, sessions, rates, package quotes and typed audit values. Capture and isolated restore retain exact grids/linkage; financial and CRM retries create no second payment/task/event. Writer holds, missing sources and unknown manual tabs are tested. Manual-policy tests retain packet/native-metadata validation, permission chronology, timeout handling, two-pass proof and hold removal last. All local Google services are synthetic doubles.

Historical `google-operational-drill.gs` SHA256 remains `dbeae05cd7c410268224bf1381a207c2c7ba8a2defc9678e5191b2903141329f`; October native evidence is unchanged. The new runner has a separate filename and refuses execution without an isolated project binding.

- Current Code.gs SHA256: `6f997e4151f0985ec035f2dc0beb8b80fe3e835e2fe8200d77af0d8f5290be15`.
- Unbound candidate runner SHA256: `081c42fd927874863b29beaeb768ac6dd5dd2c49c68b559c1052439fb81b400c`.

## Validation

Use Node 22, `npm ci` and `TZ=UTC npm test`, with Chromium available for the complete browser run. Focused recovery/CRM integration: **195/195 pass, no skips**. Full combined local suite: **2,069/2,069 pass, no skips/TODO**. Final installed-dependency run and exact-head GitHub CI evidence are recorded on #162; old-head green runs do not certify newer code.

The suite covers ordinary paid-date months, explicit advances, partial/unpaid and legacy periods, lost replies, independent readers, duplicate prevention and revenue allocation. Existing money-scope tests cover Dana's direct API refusal, fresh/cached/stale field stripping and preservation of stored finance on operational saves. No new permission model was invented.

The committed dependency set was installed with `npm ci`; its audit reports **zero vulnerabilities at every severity**. The 35 policy/transition/CRM hold checks also pass under Asia/Jerusalem. Historical evidence and the original generated drill compare byte-for-byte with #160. A fresh unauthenticated production version/health/cache check is recorded on the PR; no authenticated patient or financial records were requested.

## Native run package — prepared, not executed

Connected Drive/Sheets tools expose metadata/Sheets operations but no Apps Script execution channel. Do not use production clasp credentials, a deployment workflow or a completed October project to bypass that limit. Backup manifest metadata does not prove current source or native restore.

After isolated access/run authorization:

1. Verify one fresh standalone test project, separate from production/bound projects and immutable October projects, through normal Google authorization. Never send credentials in chat.
2. On the exact approved candidate, run `TZ=UTC node test-support/build-google-operational-drill.cjs --script-id ISOLATED_ID`. It writes **`test-support/google-operational-drill-candidate.gs`**, never the historical file. Compare complete loaded bytes with the generated file; retain source/helper/definition hashes. Project binding changes the definition/file hash.
3. Execute prepare → capture → restore → verify → manual-tab refusal once each. Preparation creates only new synthetic source/backup/target workbooks. Verify restricted owner-only sharing and distinct IDs before continuing. Preserve raw results, timings and all failure states. No production deployment, triggers or workbook IDs are inputs.
4. If needed, bind the separately scoped manual-policy extension to this new run's exact state/source. Collect new native packets/permissions evidence. Never reset October state, relabel its proof or activate a real-source policy pin from synthetic success.
5. Separately attest actual live source/project/binding and backup configuration via an approved read-only channel. Complete staff staging UAT with Vered/Oren/Dana: save, reload, second reader, retry and negative money access. No test patient/payment in production.

## Release / rollback

Before approval: final CI, native source/restore, role UAT and real-source manual-tab/header issues must be closed under their respective authorization. Request Sandra's separate approval for the exact candidate and phases.

After approval only: pause financial/CRM writers, including open old clients; require the approved Node full merge SHA live before the explicit Apps Script phase uses that same `expected_commit`. Refresh clients and verify source/readback before reopening writes. Optional handoff secrets remain fail-closed until separately configured.

**Node phase → Apps Script phase window.** Once the new Node is live and until the Apps Script phase succeeds, דנה's (ops-scope) `saveAll` is **blocked by design**: the proxy probes `action=getCapabilities` and answers `503 backend_upgrade_pending` without forwarding, because the old source would overwrite stored client money with the stripped fields. Tell her before the merge. After the Apps Script run reports `Deployed …@<version>`, verify the capability (`?action=getCapabilities&proxySecret=…` → `capabilities.moneyScope:true`, or one ops save from her tab returning 200) **before** reopening her writes. ורד / אורן are not gated. See DEPLOY.md «Node-first window» and «Operational notes» (stranded backup marker, required-sources property, `getHandoffStatus` read-only fix).

No blind downgrade: pending new paid-date FinancialOps cannot replay under the old validator. Preserve rows/journal/hold and use reviewed forward recovery or a compatible source. Old backups lacking typed CRM cannot certify the new source. Reverting the money boundary re-exposes Dana's finance and is not an acceptable default rollback. Retain previous Node/source references and a monotonic SW strategy in the approved record.

Next external dependency is isolated Apps Script execution and real-source evidence, not a billing rewrite. Dashboard #358 is the next workstream; its release approval is separate.
