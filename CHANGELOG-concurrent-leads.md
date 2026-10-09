# Preserve concurrently created outpatient leads

Status: isolated development change; not approved for production.
Base: `claude/youthful-volta-laarnk` at
`120d7eb0e1a0a95a68cefd63916d7d8d61cea8c9`.

## Problem and behavior

`saveAll` rewrites the Leads sheet from a browser snapshot. A lead created by
another tab or the cross-app `createLead` handler after that snapshot could be
silently dropped. The client preservation guard did not cover Leads.

The existing script lock now also protects lead reconciliation. Missing live
lead IDs are preserved with their current values and stamps. Conversion is
resolved against the final accepted/preserved clients' `fromLead`, after client
conflict refusal. The existing removal archive blocks an absent, removed lead
from being resurrected by a stale tab; currently live restored rows take
precedence over historical archive entries. Ordinary live edits avoid archive
reads; potential resurrection checks read only its ID column.

The response adds `preservedLeads`; `staleSave` also signals a reconciled lead
snapshot so the existing UI reloads. The existing client preservation, conflict
and stamp rules continue to apply. No columns, UI assets, dependencies or
financial calculations change.

## Verification

`test/lead-save-preservation.test.js` executes the real `Code.gs` handlers with
in-memory Sheets and dummy records. It covers concurrent tabs/retries, the real
cross-app creation and lead removal paths, conversion, stale resurrection,
refused client edits, server stamps, GET/POST compatibility, lock refusal and
archive-read failure. The initial 15 regressions produced 10 failures before
the fix; the completed suite contains 18 cases. The added case uses the
18-column archive observed in Google (headers only), blocks stale resurrection,
then verifies the existing removal handler appends its two stamp columns without
shifting the older archive data. All row values in that test are synthetic.

`test/lead-save-browser.test.js` adds three end-to-end browser scenarios: two
signed-in users creating/editing, removing, and converting leads from different
snapshots. The actual UI, `server.js` session/proxy/cache and `Code.gs` run
together; Google runtime services alone use the shared in-memory fixture in
`test-support/apps-script-sandbox.js`. Browser traffic is restricted to the
local test server. The test-only browser version is Playwright 1.51.1 / Chromium
134; production dependencies are unchanged.

The separate `lead-save-browser` CI job runs these scenarios on Node 22 with
`EZONE_REQUIRE_BROWSER_TESTS=1`: missing tooling fails the job rather than
silently skipping it. The original `npm test` job is retained. Earlier local
verification without a browser passed 1,109 of 1,115 cases and skipped six
existing browser cases. Final browser-enabled verification on Node 24.19.0
completed with **1,119 passed, 0 failed, 0 skipped** (including all nine browser
cases). The local default parallel run exited zero without a completion
summary, so full-suite local verification uses `--test-concurrency=1`.

A moderate
`qs` advisory was found in the existing dependency tree; no dependency update
is bundled with this save-path change. The audit reports 0 high / 0 critical.
Track the moderate finding as a separate maintenance task.

## Google staging validation (2026-10-09)

Native dummy workbook:
https://docs.google.com/spreadsheets/d/1MdBzX6eDJIi9m7JXNuz-Z5OUh8e1dS6FjTGiw71D6n0/edit

The initial fixture contains one synthetic live lead (`fixture-a`), one synthetic
archived lead (`fixture-removed`), an empty Clients sheet and `_Staging` instructions.
`test-support/google-staging-fixture.json` is the repeatable initial state.
No patient records were read or copied. No production sheet, Apps Script
project, deployment, Railway configuration or access permission was changed.

The Drive workbook titled `EZONE OUTPATIENT`
(`17dVBbOuf09c7dug1Tpq9Fr8_3fxfg0M87F9ChkGMCyc`) was inspected through metadata
and header rows only. Leads has 18 matching headers, Clients has 36 matching
headers, and `לידים שהוסרו` has the matching first 18 headers but lacks
`updatedAt`/`updatedBy`. Those trailing columns already exist in the deployed
branch's source; this PR does not add them or modify the live headers. The
binding between that workbook and the production Apps Script project has not
yet been independently verified through Google.

The dummy workbook reproduces those header shapes. After native import, all
fixture values were read back and matched exactly, including leading-zero
phones and ISO timestamp strings. The import's two timestamp cells were
normalized to native `stringValue`, and the workbook timezone was set to
`Asia/Jerusalem`. No formulas or native tables were introduced. The initial
visual QA used an XLSX exported from the native Sheet. Google browser access
was subsequently authorized and used for project setup and execution.

Drive returned 56 version-history entries for the identified outpatient
workbook, most recently `6560` at `2026-10-08T17:24:22.141Z`. The separate
`EZONE-Backups` workbook (`1GTiMksHak6p6a8VxaAuJAjtTxlZ6ikF4cBLPDErFdOM`)
contains 31 `outpatient-YYYY-MM-DD` tabs through `outpatient-2026-10-09`.
Its latest outpatient header matches Clients. The existing
`nightlyIntegrityJob` code snapshots `clientsGrid` only, with 30-day retention;
these outpatient snapshots do not cover Leads or its removal archive. The
same backup workbook also has separately prefixed Dashboard snapshots; do not
assume they back up the outpatient lead records. This is evidence of existing
backup work to preserve, but backup row contents, trigger health, completeness
and an actual restore have not been verified. No backup rows were read.

Older manual copies and seven `EZONE-OUT-SNAPSHOT-AUTO-*` revision-harvesting
files were also found. The latter were created September 4 and refer to dates
through August 31; they are not evidence of a current daily outpatient-lead
backup. No backup or snapshot was modified.

Sandra authorized the browser fallback for the missing Apps Script operations.
The separate bound project is **EZONE Outpatient STAGING ONLY 20261009**, script
ID `1IMz_TagTQBCsoK84TNHL5kBnBslH5W7jaZ20RFKA4dqkqfrbDHN42oE_`:
https://script.google.com/u/0/home/projects/1IMz_TagTQBCsoK84TNHL5kBnBslH5W7jaZ20RFKA4dqkqfrbDHN42oE_/edit

The staging `Code.gs` is an exact editor-copy match to source commit
`ce3ec62a9c83dcc5c0e4a672b4653a11e095a159`, SHA-256
`d1f030c3aec035a2fed69fa2f577a41ab1ba8edee54fcebacdbfda55b7971f56`.
The production file is not modified for staging. A separate test file invokes
the actual `doGet`/`doPost` handlers with real Google Sheets, LockService,
PropertiesService and ContentService. It rejects the wrong spreadsheet or
script ID and refuses fixture resets if non-fixture records are present.

Only `spreadsheets.currentonly` is requested in the staging manifest, with
timezone `Asia/Jerusalem`. Google's consent screen confirmed access to the
spreadsheet where the script is installed. No Drive, email, external-request
or trigger-management scopes were granted. No web-app deployment, scheduled
trigger, cross-app credential or paid service was created.

**Native run at `2026-10-09T12:18:16.602Z`: 4 passed, 0 failed.** The Google
execution log showed `Execution completed`; `_Acceptance!A1:G5` was independently
read back through Drive with the same results:

| Scenario | Result | Complete scenario duration |
| --- | --- | --- |
| Older snapshot edits after another writer adds a lead | PASS | 24,177 ms |
| Removal followed by a stale save; 18-column archive upgrade | PASS | 23,762 ms |
| Conversion with an unseen lead; stale resurrection attempt | PASS | 29,278 ms |
| Existing 18-column archive read without rewriting it | PASS | 19,212 ms |

These timings include fixture resets, safety checks, multiple reads/writes and
assertions. They are **not per-save latency or a load benchmark**. Conversion
checks verify the submitted price/billing date remain intact; the browser suite
separately tests the existing UI calculation.

Reproducible staging-only files (excluded by production `.clasp.json` rootDir):
`test-support/google-staging-acceptance.gs`,
`test-support/google-staging-appsscript.json`, and
`test-support/google-staging-results-20261009.json`.

This verifies the Google runtime and the current-document OAuth scope through
editor execution. It does **not** exercise HTTP dispatch, deployed web-app
permissions, overlapping requests, production quotas, or the browser/proxy
against Google in one combined run. The connected staging application remains
the next acceptance gate; do not label it complete from these results.

## Release and rollback

1. Keep this PR a draft until Sandra approves the release and CI is green.
2. Complete the combined two-browser-session create/edit, removal and conversion
   scenarios through the real UI/proxy and an isolated Google HTTP endpoint.
   Local browser integration and native Google handler execution have passed
   separately; the combined path remains unverified. Use the pinned dummy
   workbook and bound project above. Do not reuse production `.clasp.json`,
   script/deployment IDs, credentials or Railway settings. Keep cross-app
   integrations disabled. Do not install scheduled triggers or run Drive-wide
   snapshot/cleanup helpers. Reset only fixture rows in the dummy workbook.
   Record the tested source hash and results before requesting production approval.
3. Confirm a restorable Sheets backup and record the current Apps Script
   deployment version. Merge only into the deployed branch after approval;
   merging this source change automatically runs the existing deploy workflow.
4. Verify the deployment run and the agreed smoke checks. If rollback is
   needed, redeploy the recorded previous version to the SAME deployment ID
   with approval. Code rollback cannot recover data already lost by the old
   behavior; recovery needs the verified backup or other retained evidence.

## Remaining work / handoff

Full-sheet writes are still not transactional across Leads and Clients, and
this patch does not make saves independent of Google availability. Row-level
durable writes, production monitoring and verified backup/restore remain
separate work. Existing legacy behavior for edits lacking version stamps is
unchanged. Do not infer production load capacity from the local or native
sequential smoke tests.

Current task owner: Codex. Coordinate before Claude picks up this branch.
Next milestone: combined browser/proxy/Google acceptance, confirmed lead backup
coverage and a restore check, then Sandra's production decision.
Sandra has authorized necessary spending without a fixed cap, subject to
professional cost management; see `AGENTS.md`. The actual cost baseline and
billing access remain unverified. No new paid service was provisioned for this
patch.
