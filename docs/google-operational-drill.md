# Isolated Google operational recovery drill

Historical status: **all five phases passed natively on 2026-10-26**, using candidate
`09a00ab5e9d057c3d3c1913f93415fb949233860` and private synthetic workbooks.
See [retained evidence and limits](evidence/op03-google-drill-2026-10-26.md).
The PR132 integration has regenerated the harness with new source/helper hashes,
a nonempty preferred-house fixture and refusal of that writer while held.
It has local service-double coverage, but **has not run natively yet**. Preserve
the completed project's files/state; use a separate fresh project and new
workbooks for combined-code acceptance. Do not relabel the older report.
This is acceptance tooling for PR125, not a deployment, a live restore, or a
replacement for the scheduled backup/configuration evidence.

## Isolation and access prerequisite

Use a separately authorized, new **standalone Apps Script test project**, owned
by the configuration owner. No application-bound project, existing deployment,
production Code.gs, production credentials, real patient data or production
workbook is used. The builder refuses the repository's production script ID;
the runner refuses a different script ID or any spreadsheet-bound project.
Preparation also refuses any existing Script Property names without reading
their values. The hardcoded ID denial covers this repo only, not every E-ZONE
application: the operator must verify this is a newly created test project.

Use an authenticated isolated Apps Script execution channel. Do not look for
credentials or reuse the
production clasp project to work around that boundary. Obtain test-project
access through its normal Google authorization surface. Its script ID is not a
secret; never send OAuth tokens or other credentials in chat.

The test creates three new spreadsheets, named with a random drill tag and
`SYNTHETIC NOT PRODUCTION`: source, backup, target. It records their exact IDs,
requires distinct IDs and matching names on every later phase, and only opens
those workbooks through its helper facade. After preparation, verify sharing is
Restricted/owner-only before continuing. It never accepts an existing workbook
as an input. Preserve failed-run artifacts; there is no implicit reset/delete.

## Prepare the exact reviewed candidate

1. Check out the approved PR125 candidate. Run `TZ=UTC npm test`.
2. Obtain the isolated project's ID from Project Settings. Build only the drill:
   `TZ=UTC node test-support/build-google-operational-drill.cjs --script-id ISOLATED_ID`.
3. Load the generated `test-support/google-operational-drill.gs` as a test file
   in that standalone project. This is a dedicated helper harness, **not** a
   copy of production Code.gs. Do not use this repository's `.clasp.json`, push
   `apps-script/`, create a deployment, install triggers or change Railway.
4. Keep the emitted source/helper/drill-definition SHA-256 values with the result.
   The definition hash binds the wrapper, fixtures, helpers and test project ID.
   Before phase 1 compare the entire loaded test file with a fresh local build
   of the reviewed candidate. Embedded hashes detect inter-phase build drift;
   they do not detect a hand-edited body with unchanged embedded constants.
   The generated
   file checked into the PR has a placeholder and deliberately refuses to run.
   Do not commit an execution-specific project binding over that safe default.
5. In this isolated project's manifest, explicitly set `oauthScopes` to only
   `https://www.googleapis.com/auth/spreadsheets`. Review the actual consent
   screen before the owner grants access. Google grants account-wide Sheets
   access; the harness's ID checks provide the narrower test-only boundary.
   Auto-detected scopes included unnecessary third-party UI access in the
   October 26 attempt; that request was cancelled and narrowed before consent.

Each helper body is copied verbatim from the candidate. Its required constants
are derived from that source. The generator rejects mail, fetch, Drive, HTTP
handlers and the scheduled job in the selected helper closure. No extra package
or runtime dependency is installed. Tests pin reproducibility and refusal paths.

## Execute one phase at a time in the Apps Script editor

| Order | Function | Evidence |
| --- | --- | --- |
| 1 | `prepareOperationalDrill` | Fresh source/backup/target; two session rows, both financial journal kinds, custom rate 777, real seeded catalog and approved synthetic quote, preferred house set through the real writer, literal strings/booleans/number/Date |
| 2 | `captureOperationalDrill` | Actual capture/writer/manifest validator; 19 registered datasets plus metadata, including explicit optional absence |
| 3 | `restoreOperationalDrill` | Fixture-only hold; native sheet copies into the distinct target, exact typed readback |
| 4 | `verifyOperationalDrill` | Actual finish gate/journal validator, refusal of missing SessionLog/unverified config/original target, financial/session retries with no duplicate effect, retained payroll stamp/rate/preferred house, held preferred-house writer refusal and unchanged source |
| 5 | `verifyManualTabDrill` | Synthetic empty Sheet1 and archive preserved in a separate snapshot set; existing unknown-tab recovery gate correctly refuses certification |

Separate phases bound per-execution work. A phase must complete before the next;
duplicates, concurrent runs, source hash changes and failed-run retries reject.
An uncatchable termination leaves its running marker fail-closed. Do not clear
that marker or re-run a phase blindly; retain the artifacts and investigate.

The runner uses native Sheets, locks, Script Properties and cache inside the
isolated project. Application property names, including the recovery hold and
financial marker, are namespaced with `OP03_DRILL_FIXTURE_`. The only source
secret is a clearly labelled synthetic session value. `configVerified=true`
attests this fixture setup only; it says nothing about production alignment,
permissions, triggers or secrets. The scheduled `nightlyIntegrityJob` is never
invoked, so this does not test scheduled admission/drain, retention or mail.

Every completed/failed phase writes `_DrillReport` in the new backup workbook,
including source/helper/definition hashes and elapsed milliseconds. A secondary
report failure is logged without masking the original phase error. The phase
must remain safely below the runtime execution limit; split it if actual timing
approaches that limit, preserving all evidence.
The October 26 execution-list durations were 24.263, 42.091, 34.744, 48.542 and
61.297 seconds in phase order; this small fixture does not establish
production-scale timing or the approved manual-policy branch's timing.
Execution logs contain phase status and the
three synthetic workbook IDs. All successful results explicitly retain
`productionCertified:false`. Retain execution timestamps, durations, workbook
links, report rows and the exact candidate SHA; do not label local doubles as
Google evidence. Capture the actual Google scopes requested before consenting;
no mail, external fetch, deployment or trigger scope is needed by this harness.

The financial fixtures are terminal history and the sessions already recorded.
Their retries must remain valid after their original dates. A local regression
moves verification to June2031. The native October26 run verified retries after
the original fixture dates, about a week later; the far-future clock remains
local-double coverage only. Only the audit fixture includes an explicit Date scalar; date columns
represented by the app as ISO strings are kept as strings.

## Manual production tabs remain a separate gate

The observed production Sheet1 was empty; Copy of Clients had 21 archive rows.
Preserve both and never merge/delete the archive because IDs overlap. The drill
uses an unrelated synthetic archive. It proves preservation/refusal mechanics,
not the correctness of those actual historical rows or an approved exemption.
The production gate remains closed until a concrete reviewed archive recovery
plan and its target evidence are accepted. Do not erase manifest entries to pass.

After this drill, still require scheduled backup/timezone/alert/configuration
evidence, review of any findings, and Sandra's separate production approval.
See [operational recovery](operational-recovery.md) for release/rollback limits.
