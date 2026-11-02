# OP-03 — One-time Google Apps Script HEAD witness

**DRAFT ONLY. Not installed, not executed on Google, not a source release.**
This candidate is stacked on integrated OP-03 PR #139. It adds synthetic-tested source attestation tooling but does not close any production release gate.

## Pinned identity and historical source

The fixed Apps Script project is 1JSI3Ahqnen0pxi1x5q24nBku8Nk8I5iFNqRC-yMcTv1EDKTh6KhmSuSX and the verified parent must be source spreadsheet 17dVBbOuf09c7dug1Tpq9Fr8_3fxfg0M87F9ChkGMCyc. Its expected original file inventory is exactly two files:

| File | Apps Script API type | UTF-8 bytes | SHA-256 |
| --- | --- | ---: | --- |
| Code.gs | SERVER_JS | 385042 | 5a9c368dec1a59d1644068aa7aa87b9ed02ebbd2f5a0b04f008d97e9ca867f8a |
| appsscript.json | JSON | 645 | 44bc79cfed3f8f46a3200eb83ee576c59cbcaacdebb0900124d7cd471a2b5d2e |

These are historical reference hashes, NOT evidence that the live Google HEAD currently matches. Google API file names Code and appsscript are mapped to the corresponding extensions after checking the file types. An unknown, missing or additional file fails without printing its potentially sensitive name.

## Fixed read-only requests

ops/op03-source-witness.cjs uses Node built-ins only. Importing it does not access Google, read credentials or change files. Eventual authorized execution makes only these calls:

1. POST to https://oauth2.googleapis.com/token to refresh the existing GitHub-stored CLASPRC_JSON default OAuth credential. The token is kept only in memory.
2. GET https://script.googleapis.com/v1/projects/<pinned-id> to verify the exact project, parent and update timestamp.
3. GET https://script.googleapis.com/v1/projects/<pinned-id>/content without versionNumber to read HEAD into memory.
4. Repeat the metadata GET and require the same project updateTime, rejecting a source change during the read.

No arbitrary URLs, redirects, other methods, code writes, Apps Script function calls, deployments, Sheets access or new OAuth grant. It accepts clasp 3.x tokens.default and the older local credential structure; unknown formats fail closed. It never prints or stores source bodies, OAuth tokens or raw HTTP errors. Only known file names/types, sizes, hashes, booleans and fixed failure codes may appear in the single-line report. Errors on identity, scope, missing credentials, source mismatch, unexpected response shape or source timestamp cause refusal.

The executable guard requires all of these environmental conditions: explicit OP03_SOURCE_WITNESS_ENABLE=YES_READ_ONLY_ONCE, a trusted GitHub Actions workflow_dispatch event, the deployed/default branch refs/heads/claude/youthful-volta-laarnk and exact repository sandrabrayer/ezone-outpatient. Pull request / push CI may run the synthetic tests, but cannot invoke the credential flow.

Local synthetic tests: node --test test/op03-source-witness.test.js. The full npm test automatically includes this test file. The candidate adds no credentialed CI workflow.

## Separate trusted workflow gate

Sandra explicitly authorized one-time use of the **existing** stored Google authorization for read-only source verification. She did NOT authorize adding a workflow to the deployed/default branch, changing an existing deployment workflow or deploying production code. GitHub manual workflow_dispatch requires the workflow definition on the default branch, so a draft-only branch cannot run the credentialed operation. The NON-EXECUTABLE workflow sketch under ops/op03-source-witness.workflow.template.txt is design documentation only.

If a future separately approved trusted workflow is prepared, it must use an exact reviewed SHA for the witness script, verify the SHA BEFORE exposing secrets, run only manually from the trusted branch, use contents:read, no artifact upload, no third-party actions after secret injection, and be deleted/disabled after the approved run. NEVER copy this sketch to an executable workflow without independent security and deployment-impact review. Do not bypass via pull_request secrets, pull_request_target, automatic push triggers or edits to deploy-apps-script.yml. The environment guard does not independently guarantee a workflow cannot be manually dispatched a second time: the approved operator must enforce the one-run lifecycle.

**OAuth scope risk:** Existing clasp credentials may have broad script.projects write scope because they are used for normal deployments. The witness restricts its OWN network calls to GET project metadata/content plus fixed token refresh, but the underlying credential is not transformed into a least-privilege token. A compromised trusted runner could exploit broader privileges. Approve that risk at the runner security gate or use a newly issued read-only credential instead; do not claim the existing credential is intrinsically read-only.

## Non-goals and remaining OP-03 gates

A matching HEAD source and manifest do not prove live Web App deployment version equivalence, stopped background writers or recoverability of the 19 registered operational data families. Before *disabled* helper installation, compare a complete original project file inventory both before and after addition and ensure each original file is byte-identical; the helper must be the only addition. Before the separately conditionally approved S1:U1 header write, establish a coordinated real all-writer pause (applications including GET polling, editors, integrations, scheduled/manual jobs, legacy backup drained), then guarded preview and exact-three-cell apply. No automatic source repair or retry after ambiguous writes.

The helper ops/removed-leads-header-correction.gs, original Code.gs, backup/restore code, synthetic Google evidence and the deployed branch remain unchanged by this PR. PR125 remains a historical evidence record, and PR139 remains the integrated candidate. No merge, Google read or operation, workflow dispatch, production write or deploy is authorized by this draft.
