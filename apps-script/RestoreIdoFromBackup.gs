/* ONE-OFF recovery: restore Ido's Clients row from a version-history backup.
 *
 * For a row lost BEFORE the Clients-removed tombstone net existed (2026-08-26
 * stale-tab clobber incident) — there is no tombstone to restore from, so the
 * row is copied out of a manual backup spreadsheet instead. If an un-restored
 * tombstone DOES exist for this id, this script aborts: use the admin
 * "מטופלים שנמחקו" surface (restoreRemovedClient) instead, which stamps the
 * tombstone and preserves the audit trail.
 *
 * How to run (Apps Script editor, on the live "outpatients" project):
 *   1. In Google Drive, open the live spreadsheet's version history and make a
 *      COPY of a version that still contains Ido ("Make a copy" on the version,
 *      or restore into a copied file — never restore the live sheet in place).
 *   2. Paste that copy's spreadsheet ID (the /d/<ID>/edit part of its URL)
 *      into BACKUP_ID below, in the editor only — do not commit a real ID.
 *   3. Select restoreIdoFromBackup in the function dropdown and Run.
 *   4. Verify the row landed at the bottom of Clients, then have everyone
 *      REFRESH any open dashboard tabs: a tab still holding the stale client
 *      list would diff the row away again on its next save (the tombstone net
 *      now catches that, but avoid the round trip).
 *
 * Copying positionally (pad/trim to the live sheet's width) is correct here:
 * CLIENTS_HEADERS is frozen/append-only and the physical column order of the
 * live sheet has never been migrated, so a version-history copy shares the
 * same physical layout — an older backup is simply a prefix of today's width.
 *
 * Delete this file once the restore is done and verified.
 */
function restoreIdoFromBackup() {
  // ID of the COPY made from version history (from its URL: /d/<THIS_PART>/edit)
  var BACKUP_ID = 'PASTE_BACKUP_SPREADSHEET_ID_HERE';
  var CLIENT_ID = 'id_mslqzztu_9ltqws';

  if (BACKUP_ID === 'PASTE_BACKUP_SPREADSHEET_ID_HERE') {
    throw new Error('Fill in BACKUP_ID (in the Apps Script editor) before running.');
  }

  var backup = SpreadsheetApp.openById(BACKUP_ID).getSheetByName('Clients');
  if (!backup) throw new Error('Backup spreadsheet has no "Clients" sheet — wrong BACKUP_ID?');
  var live = SpreadsheetApp.getActive().getSheetByName('Clients');

  // guard: if an un-restored tombstone exists, restoreRemovedClient is the
  // right path — it restores the same row AND stamps restoredAt for the audit.
  var tombSheet = SpreadsheetApp.getActive().getSheetByName('Clients-removed');
  if (tombSheet && tombSheet.getLastRow() > 1) {
    var tombs = tombSheet.getDataRange().getValues();
    var restoredCol = tombs[0].indexOf('restoredAt');
    for (var t = 1; t < tombs.length; t++) {
      if (String(tombs[t][0]).trim() === CLIENT_ID &&
          (restoredCol === -1 || !String(tombs[t][restoredCol] || '').trim())) {
        throw new Error('Un-restored tombstone found in Clients-removed — use the admin restore (restoreRemovedClient) instead of this script.');
      }
    }
  }

  // find Ido's row in the backup
  var data = backup.getDataRange().getValues();
  var row = null;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === CLIENT_ID) { row = data[i]; break; }
  }
  if (!row) throw new Error('Ido (' + CLIENT_ID + ') not found in backup — pick an earlier version.');

  // guard: don't duplicate if he's already back
  var liveIds = live.getRange(1, 1, live.getLastRow(), 1).getValues().flat().map(String);
  if (liveIds.indexOf(CLIENT_ID) !== -1) throw new Error('Ido already exists in live sheet — aborting');

  // pad/trim to live sheet width, append at bottom (values only)
  var width = live.getLastColumn();
  while (row.length < width) row.push('');
  row = row.slice(0, width);
  live.appendRow(row);
  SpreadsheetApp.flush();

  Logger.log('Restored: %s (%s) at Clients row %s', String(row[1]), CLIENT_ID, live.getLastRow());
}
