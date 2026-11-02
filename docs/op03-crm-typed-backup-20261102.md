# OP-03 × Outpatient CRM Tasks/Activity — Typed backup extension (DRAFT, 2026-11-02)

Scope: code and tests in isolated [OP-03 integration #139](https://github.com/sandrabrayer/ezone-outpatient/pull/139) lineage, **not** live. The actual CRM schema owner remains [Outpatient #143](https://github.com/sandrabrayer/ezone-outpatient/pull/143); this branch does not duplicate or deploy a Tasks/Activity engine.

## What was implemented
1. `_integritySourceSpecs` has conditional, exact typed coverage for `Tasks` (`id`, `tasks-`) and `Activity` (`eventId`, `activity-`), **only if both actual CRM header arrays exist**. No new Google Sheet, task, contact, ledger, header or permission is created by the backup code.
2. Snapshot retention recognises both families. The existing manifest and typed fingerprint machinery remains authoritative; unknown sources still remain preserved in their original opaque family.
3. The read-only `_integrityValidateRestoreSet` now checks exact CRM header prefixes and nonblank unique immutable IDs. A hash-correct snapshot with structurally invalid Tasks/Activity **fails closed** before any approved restore.
4. After a source family has ever been successfully captured, existing `INTEGRITY_REQUIRED_SOURCES` safety history prevents that sheet disappearing without an error. Optional absence remains explicitly recorded before a module is first created.
5. Dedicated synthetic `test/op03-crm-typed-coverage.test.js` exercises real backup code via the existing no-network VM harness, not a second restoration engine.

## Explicit compatibility / historical boundary
- Existing V2 recovery sets built before CRM integration do NOT silently become certified CRM backups. When the integrated code expects CRM families, an old set fails the current full operational recovery gate. Its original snapshots are not deleted by this draft. A dedicated, separately reviewed **historical read-only inspection** mechanism and/or versioned compatibility plan must precede use of older artifacts; do not weaken current v2 completeness or rewrite a legacy manifest.
- The synthetic fixtures mirror the exact `TASKS_HEADERS` / `ACTIVITY_HEADERS` found in #143; integration review must verify the arrays byte-for-byte at the **actual combined head**. The schema in this branch is conditional and has no effect until #143 code is truly present.
- Snapshotting preserves values/types and audit/follow-up IDs; it does NOT certify native Google Sheet formatting, permissions, validations, triggers, or all-writer pause. A **real isolated native restore** and current Apps Script HEAD/source witness still remain gating steps.

## Release and acceptance gates
- GitHub full CI/test/browser on exact head, plus negative controls on corrupt header/IDs/manifest.
- Integration with current deployed Outpatient, OP-CRM #142–148, and OP-03 #125/#139/#140 must be reviewed on a **single combined code tree**; no standalone merge over a stale base.
- Source owner/financial and role UAT, source/target snapshot and restore proof; no production activation without separately approved pause and Sandra's explicit merge/deploy/data approval.

**No production data/credentials accessed. No Google workflows triggered. No merge, deploy, live financial writes, migration or permission changes authorized by this PR.**
