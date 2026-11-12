# CHANGELOG — One-off restore of Ido's Clients row from a version-history backup

## Summary
Adds a one-off, run-by-hand Apps Script function `restoreIdoFromBackup()`
(new file `apps-script/RestoreIdoFromBackup.gs`) that copies Ido's row
(`id_mslqzztu_9ltqws`) out of a manually-made version-history backup copy and
appends it to the live `Clients` sheet. Delete the file after the restore is
verified.

## Problem
Ido's Clients row is gone and there is no `Clients-removed` tombstone to
restore him from — the loss predates (or escaped) the tombstone net added for
the 2026-08-26 stale-tab clobber incident, so the in-app admin restore
(`restoreRemovedClient`, CHANGELOG-restore-removed-client.md) has nothing to
work with. The only remaining source is the spreadsheet's version history.

## Changes
- apps-script/RestoreIdoFromBackup.gs (new — ** auto-deploys via clasp CI,
  touches `apps-script/**` **, so the function appears in the live Apps
  Script editor after merge; it does nothing until run by hand)
  - `restoreIdoFromBackup()`:
    - `BACKUP_ID` is a committed placeholder — the real spreadsheet ID of the
      version-history COPY is pasted in the Apps Script editor only, never
      committed; running with the placeholder throws immediately.
    - Guard: if `Clients-removed` holds an **un-restored** tombstone for the
      id, aborts and points at the admin restore instead — that path stamps
      `restoredAt` and preserves the audit trail.
    - Guard: aborts if the id is already present in the live Clients sheet
      (never a duplicate row).
    - Copies the backup row **positionally**, padded/trimmed to the live
      sheet's current width. This is correct because `CLIENTS_HEADERS` is
      frozen/append-only and the physical column order was never migrated —
      a version-history copy shares the same physical layout, an older one is
      simply a prefix of today's width.
    - `appendRow` + `flush`, logs name/id/landing row. The appended row lands
      inside the whole-grid `'@'` text format `_ensureSheet` applies to phone
      columns, so leading-zero phones survive the copy.

## How to run
1. Drive → live spreadsheet → version history → make a **copy** of a version
   that still has Ido (never restore the live sheet in place).
2. Apps Script editor (live "outpatients" project) → paste the copy's
   spreadsheet ID into `BACKUP_ID` → run `restoreIdoFromBackup`.
3. Verify the row at the bottom of Clients, then have everyone **refresh open
   dashboard tabs** — a tab still holding the stale client list would diff
   the row away again on its next save (the tombstone net now catches that,
   but avoid the round trip).

## Follow-ups to verify by hand
- His Payments / extra-charges rows normally survive a Clients clobber as
  orphans and re-link by client id once the row is back — but if an
  orphan-cleanup pass (CHANGELOG-orphan-charges-cleanup.md /
  CHANGELOG-billing-orphan-removal.md) removed them in the meantime, they
  must be restored from the same backup copy separately.
- Delete `apps-script/RestoreIdoFromBackup.gs` once done — it is a one-off.
