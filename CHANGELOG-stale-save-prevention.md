# CHANGELOG — Stale-save prevention: merge-don't-drop + dataVersion staleness signal

## Summary
The `_saveAll` row-loss guard (PR #88) recorded stale-tab drops but did not
prevent them. Two features close that gap:

1. **merge-don't-drop** — a client id on the sheet but missing from the
   incoming payload WITHOUT an `explicitRemovedIds` declaration is now
   PRESERVED in the rewrite with its current on-sheet values, not dropped.
   It is still logged to `Clients-removed` (new
   `removedVia='saveAll-diff-preserved'`) so stale saves stay visible —
   visibility without data loss. Explicit deletes behave exactly as before.
2. **staleness signal** — `getData` now returns a `dataVersion` (script-
   property counter); the frontend echoes it back on `saveAll`. An echo older
   than current means another device wrote Clients since this tab loaded:
   the save still proceeds (merge-don't-drop makes it safe), but the response
   carries `staleSave:true` and the tab shows a toast — «הנתונים עודכנו
   ממכשיר אחר — רענני לראות את המצב המלא» — and reloads. FAIL-OPEN: a payload
   with no version field (old clients) behaves exactly as today.

## Problem (live incident, 2026-08-09 — repeat of 2026-08-26)
A tab holding a stale client list saved, and its `_saveAll` clear-and-rewrite
dropped 2 patients. The #88 tombstone guard made the drop recoverable
(`Clients-removed`, `removedVia='saveAll-diff'`) but the rows still left the
Clients sheet and had to be restored by hand.

## Changes
- apps-script/Code.gs  (** auto-deploys via clasp CI on merge to the deployed
  branch — touches `apps-script/**` **)
  - `_saveAll` merge-don't-drop: the missing-id diff now splits into declared
    deletes (`explicitRemovedIds` → tombstoned `'explicit-delete'`, actually
    dropped — unchanged) and undeclared missing rows (→ appended back into
    the write with their current on-sheet `_readAll` values, and logged as
    `'saveAll-diff-preserved'`). Response gains `preserved: <count>`;
    `tombstoned` keeps its meaning (rows appended to Clients-removed).
  - Preserved-log dedupe: no new `'saveAll-diff-preserved'` row is appended
    while the NEWEST tombstone for that id is already an open
    (`restoredAt` blank) preserved entry — one log row per stale episode, not
    one per save from the same stale tab.
  - New `CLIENTS_DATA_VERSION` script property + `_readDataVersion` /
    `_bumpDataVersion` helpers. Bumped (under the existing lock) by
    `_saveAll` after its write and by `_restoreRemovedClient` — the two
    Clients writes a stale tab should be told about. Cell-level writers
    (creditsOwed, paymentAmountOverrides, …) deliberately do NOT bump: those
    columns are already preserved by id on every save.
  - `_getData` returns `dataVersion`; `_saveAll` compares the echoed
    `payload.dataVersion` (fail-open on absent/blank/non-numeric) and returns
    `staleSave` + the new `dataVersion`.
  - `_getRemovedClients` filters `'saveAll-diff-preserved'` rows out of the
    admin restore surface: they are log entries for LIVE rows — listing them
    under מטופלים שנמחקו would show patients who were never removed. (Restore
    of one would have been refused as `already_active` anyway.)
  - `doPost` saveAll branch forwards `dataVersion` (payload rebuilt
    field-by-field, so the new field is threaded explicitly). The GET
    fallback parses the whole payload JSON, so it comes through unchanged.
- public/app.js
  - `state.dataVersion` seeded by `loadAll()` from `getData`, echoed by
    `persist()` on the saveAll payload (omitted when null — fail-open end to
    end), and re-synced from every save response so the saving tab itself is
    never flagged on its next save.
  - On `staleSave:true`: toast «הנתונים עודכנו ממכשיר אחר — רענני לראות את
    המצב המלא» + `loadAll()` to refresh state from server truth.
- server.js — no change needed: the POST proxy `Object.assign`s the whole
  request body, so `dataVersion` passes through like `explicitRemovedIds`.

## Semantics / constraints held
- `CLIENTS_HEADERS` untouched (frozen order); `CLIENTS_REMOVED_HEADERS`
  untouched — the preserved marker is a new `removedVia` VALUE, not a column,
  so the tombstone sheet stays append-only trivially.
- Tombstone ROWS stay append-only: the preserved log is append-only too;
  dedupe only skips appends, never rewrites.
- LockService scope unchanged: all new reads/writes (tombstone dedupe read,
  version read/bump) run inside the locks `_saveAll` / `_restoreRemovedClient`
  already hold.
- Explicit deletes and the admin restore flow behave exactly as before
  (restore additionally bumps the version counter, which only affects the
  staleness flag on OTHER tabs' next saves).
- Staleness is a signal, not a gate: a stale save is never rejected.

## Tests (test/stale-save-prevention.test.js + updated test/saveall-tombstone.test.js)
Same two styles as the #88 guard suite — pure mirrors of the server logic and
source-scan guards over Code.gs/app.js:
- stale payload preserves missing rows with their CURRENT on-sheet values;
  the payload's own rows keep the tab's edits; every preserved row is logged.
- `explicitRemovedIds` still deletes (also mixed with preserves in one save);
  empty payload preserves everything (full wipe prevented).
- version echo: older → `staleSave:true`; equal/newer → false;
  missing/blank/non-numeric → false (fail-open).
- dedupe: an open preserved tombstone suppresses a duplicate log row; a new
  episode (none / explicit-delete / historical `saveAll-diff` / restored) is
  logged.
- wiring: merge happens before `_writeAll`; bump after the write; restore
  bumps; `_getRemovedClients` filters the marker; doPost threads
  `dataVersion`; app.js echoes, re-syncs, toasts the exact Hebrew text and
  reloads.
