# CHANGELOG — _saveAll row-loss guard + Clients-removed tombstone

## Summary
Every client row dropped from the Clients sheet — by a save that didn't carry
it, or by the ✕ permanent-delete — is now appended IN FULL to a new
`Clients-removed` tombstone sheet BEFORE the write, with a timestamp and a
removal attribution. No client row can be silently and unrecoverably lost
again.

## Problem (live incident, 2026-08-26)
`_saveAll` is a clear-and-rewrite of the whole Clients sheet from whatever
client list the browser sent (`_writeAll`: clearContent + setValues). A tab
holding a stale list — loaded before a patient was added, or served the Node
proxy's cached/stale `getData` — permanently erased that patient's row on its
next save (confirmed via Sheets version history for client `id_mslqqp14_…`:
row present at 7:49, gone in the next version). The patient's Payments rows
survived as orphans, so the patient appeared in גבייה but in neither patient
tab, and there was no way to recover the row short of Sheets version history.

## Changes
- apps-script/Code.gs  (** auto-deploys via clasp CI on merge to the deployed
  branch — touches `apps-script/**` **)
  - New `CLIENTS_REMOVED_HEADERS`: a full literal — every CLIENTS_HEADERS
    column plus `removedAt` (ISO), `removedVia`
    (`'saveAll-diff' | 'explicit-delete'`), `restoredAt` (blank until
    restored). Deliberately NOT derived from CLIENTS_HEADERS at runtime, so
    the tombstone sheet is decoupled from the frozen Clients positional rule:
    a future CLIENTS_HEADERS append can never shift the meta columns under
    existing tombstone rows. Append-only, like every other header array.
  - New `_appendClientTombstones(rows, explicitSet)`: appends one
    `Clients-removed` row per dropped client (appendRow — the לידים שהוסרו
    pattern), stamping removedAt/removedVia and logging each drop. Runs under
    the caller's script lock.
  - `_saveAll`: before the clear-and-rewrite, diffs the on-sheet client ids
    against the incoming array; every id present on the sheet but missing from
    the payload is tombstoned first. Ids declared in the new optional
    `payload.explicitRemovedIds` are attributed `'explicit-delete'`; all other
    drops are `'saveAll-diff'` — the stale-tab clobber signature. Response now
    carries `tombstoned: <count>`.
  - `doPost` saveAll branch forwards `explicitRemovedIds` (its payload is
    rebuilt field-by-field, so the new field is threaded explicitly).
- public/app.js
  - `persist(opts)`: optional `{ explicitRemovedIds: [...] }` forwarded on the
    saveAll payload.
  - The ✕ permanent-delete flow calls
    `persist({ explicitRemovedIds: [deletedId] })` so deliberate deletes are
    attributed correctly (append-before-delete, inside _saveAll's existing
    LockService scope).
- server.js — no change needed: the POST proxy `Object.assign`s the whole
  request body, so `explicitRemovedIds` passes through.

## Semantics
- Tombstone ROWS are append-only: an audit trail — never rewritten, never
  deleted. A restore (separate feature) only stamps `restoredAt`.
- The guard does not block the write: the save proceeds exactly as before, but
  every dropped row is recoverable from `Clients-removed`.
- Rows are stored as `_readAll` reads them (dates as `yyyy-MM-dd`, phones
  recovered), so a restore writes back the same shape `_writeAll` would.
- `_mergeClients` removals are intentionally NOT tombstoned: merge repoints
  billing rows to the survivor first, so nothing is lost.

## Verification
- test/saveall-tombstone.test.js: pure mirror of the diff/attribution logic
  (missing id → saveAll-diff; declared id → explicit-delete; empty payload
  tombstones everything; blank-id rows skipped) + source-scan guards
  (tombstone appended BEFORE `_writeAll(clientsSh, …)`; headers literal =
  CLIENTS_HEADERS + 3 meta columns; doPost threads explicitRemovedIds; the ✕
  flow declares its id).
- `npm test`: full suite green.
