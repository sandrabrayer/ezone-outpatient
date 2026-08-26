# CHANGELOG — Admin restore of tombstoned (deleted) clients

## Summary
Patients whose Clients row was dropped — clobbered by a stale save or deleted
with ✕ — can now be seen and restored from the app. The מטופלים לא פעילים tab
gains a third section, **מטופלים שנמחקו**, listing every un-restored
`Clients-removed` tombstone with a שחזר מטופל button (editor-only) that copies
the row back to Clients exactly as it was removed.

## Problem
The tombstone guard (CHANGELOG-saveall-tombstone.md) makes a dropped client
row recoverable, but recovery required opening the Google Sheet by hand. The
incident patient (`id_mslqqp14_…`) had no card anywhere in the app and no
in-app way back.

## Changes
- apps-script/Code.gs  (** auto-deploys via clasp CI — touches
  `apps-script/**` **)
  - `_getRemovedClients()`: returns every un-restored tombstone
    (`restoredAt` blank) from `Clients-removed`. Internal dashboard read,
    same trust level as `getData`. Routed on doGet AND doPost as
    `getRemovedClients`.
  - `_restoreRemovedClient({id})`: under the script lock — rejects an id that
    is still live in Clients (`already_active`, never a duplicate row); scans
    the tombstones bottom-up so the LATEST un-restored one wins; appends its
    client columns back to Clients (`CLIENTS_HEADERS` order — the meta
    columns never leak); stamps that tombstone's `restoredAt`. Tombstones are
    append-only: restore never deletes or rewrites one beyond the stamp, so
    the audit trail survives. Errors: `missing_id` / `busy` / `already_active`
    / `not_found` (no un-restored tombstone). Routed on doPost as
    `restoreRemovedClient` (internal, same trust level as `mergeClients`).
- public/app.js
  - `state.removedClients` (null = not fetched) + `apiGetRemovedClients()` +
    `ensureRemovedClients()` — tombstones are fetched lazily the first time
    the inactive tab renders, so the main load pays nothing.
  - `renderInactive`: new מטופלים שנמחקו section (same card look) showing
    name, phone, service, branch, status at removal, removal time, and how
    the row was removed (`נמחק ידנית (✕)` vs `נשמט בשמירה — שחזור זמין`).
    The per-tab name search covers it. The empty-state message accounts for
    the new section.
  - `performRestoreRemovedClient(id, name)`: confirm → `restoreRemovedClient`
    → invalidate the tombstone cache → `loadAll()` so the restored card
    appears everywhere. Editor-only, like the existing שחזר לטיפול.

## Semantics
- The row is restored EXACTLY as removed — status included. A patient who was
  active comes back straight into מטופלים; a discharged one comes back into
  its inactive section.
- Restore does NOT recreate Payments/ClientCharges rows deleted by the ✕
  flow; it restores the client row only. (Payments clobbered rows were never
  deleted — that was the incident's saving grace.)
- The status-based שחזר לטיפול (discharged / cross-app-deactivated patients,
  who still HAVE a Clients row) is unchanged; the new flow only serves
  patients with no row.

## Verification
- test/restore-removed-client.test.js: pure mirror of the restore contract
  (latest-tombstone-wins, meta columns never leak, already_active/not_found/
  missing_id, double-restore blocked, remove-again-restore-again reachable) +
  source-scan guards over Code.gs routes/lock/no-deleteRow and the app.js
  section + flow.
- `npm test`: full suite green (restore-client + inactive-patients-tab suites
  untouched and passing).
