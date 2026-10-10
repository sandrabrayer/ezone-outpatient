# Daily backup coverage and verified replacement

Status: staged on draft PR #113; not deployed. Codex owns this branch.

The existing nightly job copied Clients only and cleared a same-day backup
before writing its replacement. Leads and both removal archives lacked daily
coverage, and a failed rewrite could destroy the previous good copy.

## Behavior

The existing `nightlyIntegrityJob` captures Clients, Leads, `לידים שהוסרו` and
Clients-removed using the same script lock as lead saves/removals. It waits
at most five seconds to acquire the lock and releases it after reading the
four datasets, before backup writes. The separate writer uses a user lock;
interactive app saves do not wait for backup verification or publication.

Missing Clients/Leads, failed reads or lock contention abort snapshot capture.
Archives that have never existed are represented by header-only snapshots and
logged as `sourceAbsent=true`; the job never creates/relabels a live sheet.
A missing Clients sheet no longer seeds a false zero-count sentinel.

| Source | Daily sheet in existing EZONE-Backups |
| --- | --- |
| Clients | `outpatient-YYYY-MM-DD` (unchanged) |
| Leads | `outpatient-leads-YYYY-MM-DD` |
| לידים שהוסרו | `outpatient-leads-removed-YYYY-MM-DD` |
| Clients-removed | `outpatient-clients-removed-YYYY-MM-DD` |

Each snapshot is written to a new temporary sheet and read back. Strings are
literal, including leading zeros, ISO timestamps, leading apostrophes and text
beginning with `=`. Numeric/boolean types and Date instants must match; no
formula may appear in the output. Large ranges grow beyond the default grid.
Only after verification does the writer rename the previous daily sheet,
publish the new one and delete the retired copy. A failed publication attempts
to restore the previous name. Failed/interrupted writes can leave uniquely
named `outpatient-pending-*` or `outpatient-previous-*` recovery remnants;
these are deliberately excluded from automatic retention and need review.
An arbitrary tab named Sheet1 is no longer deleted automatically.

Retention still keeps the existing 30-day window, now restricted to these four
exact daily naming families. It runs only after every dataset succeeds.
Dashboard snapshots, manual tabs and recovery remnants remain outside its
scope. The existing client sentinel/name lookup still precedes replacement.
The backup destination is rejected if it is the live workbook.

No web actions, frontend flows, billing calculations, manifest scopes,
credentials, dependencies or trigger installer change. No new paid service.

## Validation

- 15 new cases execute the actual job/helpers with synthetic GAS services;
  42 focused backup/integrity cases pass. Failure cases cover write/readback,
  unexpected formulas, publication, missing sources, lock contention, live
  destination misconfiguration and retention protection.
- Full browser-enabled serial suite: **1,134 passed; 0 failed; 0 skipped**.
  Node 24.19.0, test-only Playwright 1.51.1 / Chromium 134. Audit: 0 high,
  0 critical; the existing moderate qs advisory remains separate work.
- **Six native Google scenarios passed** at `2026-10-09T17:17:20.088Z`:
  four-dataset typed copy, literal/scalar types, verified same-day replacement,
  injected readback failure preserving the old snapshot, in-place restoration
  of all four datasets, and scoped retention. Existing dummy source rows were
  unchanged throughout. Independent connector readback matched source,
  snapshot and restored probe values for all four datasets.
- Native helpers are copied verbatim into a nested test function in the
  existing current-document-only staging project. Production and staging
  `Code.gs` were not edited through the browser. No web endpoint, new scope,
  scheduled trigger or email was created/sent. The earlier endpoint remains
  archived. Future-dated 2099 snapshot names are synthetic test fixtures.

The builder `test-support/build-google-backup-acceptance.cjs` generates
`google-backup-acceptance.gs` from real helper bodies and a guarded template.
The generated file, template and JSON evidence stay outside the production
clasp root. Its target IDs, known synthetic IDs and no-rerun guard are
intentional; do not weaken them to reuse a completed fixture.
Evidence: `test-support/google-backup-results-20261009.json` and native
`_BackupAcceptance!A1:G7`.

## Authorized full production backup — 2026-10-09

Sandra approved a short write pause at 21:11:20 Israel for backup only.
A native whole-workbook copy was created at `2026-10-09T18:12:58.585Z` in
the same owner's My Drive. Backup ID:
`1pzINQ3p73bKo7bISBFkxrVN6z-pt5esz3wIHUZCfyz8`.

Independent readback completed at `2026-10-09T18:15:47.586Z`:

- All 18 sheet properties, including grid dimensions, order, hidden state
  and frozen headers, match the source.
- Every allocated cell's entered value/type matches: 3,649 nonempty cells,
  with no formula cells in this source at capture time.
- Formatting, data validation, notes, text runs and chips match across each
  populated bounding rectangle.
- Both files have only the owner's permission. Source modified time stayed
  `2026-10-09T12:26:46.957Z`; source data and settings were not changed.

Actual cell data were compared in memory, not logged or committed. The
count/digest report is `test-support/production-backup-results-20261009.json`.
Sandra was told normal writes could resume after verification. The snapshot
is a point-in-time copy; recheck freshness before release and make a newer
verified copy if source data changed. No production restore was performed;
restore methods were exercised on synthetic staging records.

## Limits and release

These are values-only data backups, not whole-workbook copies of formulas,
formatting, validations, protections or project settings. All four datasets
are captured under one cooperative script lock, but the backup sheets are
published individually; publication is not a four-sheet transaction. Direct
manual edits and other writers that ignore this lock can still race capture.
Daily snapshots are not a per-change journal. Client loss detection remains
unchanged; this patch does not add a lead-loss sentinel.

Native acceptance exercises the actual helpers in one dummy workbook under
`spreadsheets.currentonly`; cross-workbook orchestration is covered locally.
It does not claim a native end-to-end run of the complete scheduled job or a
verified production backup. Manual restore used native paste-values into
existing synthetic probe sheets; no automatic production restore was added.

Read-only inspection confirmed the production script from `.clasp.json` is
bound to `17dVBbOuf09c7dug1Tpq9Fr8_3fxfg0M87F9ChkGMCyc` (EZONE OUTPATIENT).
The existing web deployment ending `FOwWYIw` is **version 92**, description
commit `8d9a5be56a69bff18a3debceb4fc5c4fe48db5a6`, execute-as owner / Anyone.
Exactly one time-driven `nightlyIntegrityJob` trigger was visible on **Head**,
with a displayed 0% error rate. This does not prove alert delivery or data
coverage. No production source, data, deployment, trigger or setting changed.

The later browser recheck reached Google's signed-out Apps Script landing
page, so version 92 remains the earlier read-only observation, not a fresh
confirmation. Before release: obtain Sandra's explicit production approval,
confirm candidate CI/source baseline, renew browser access and recheck the
active version, and confirm the verified whole-workbook backup is still
current. Another owner may have released or data may have changed since
these records. Recreate/verify the backup under a write pause when needed.
After release, verify four current daily snapshots and the next scheduled run.
Reuse the existing trigger; do not run the installer unnecessarily.

**Rollback has two layers.** Redeploying web-app version 92 on the same
deployment ID rolls back HTTP handlers only. The nightly trigger executes
**Head**, so reverting the approved source change through the repository/CI
is also needed to roll back the scheduled job. Preserve all data snapshots;
code rollback cannot restore lost rows. Do not change the workbook binding.
