/**
 * E-ZONE Outpatient — Apps Script backend
 *
 * Setup:
 *  1. Create a new Google Sheet named "E-ZONE Outpatient".
 *  2. Extensions → Apps Script → paste this file as Code.gs.
 *  3. Deploy → New deployment → Web app
 *       - Execute as: Me
 *       - Who has access: Anyone (with link)
 *  4. Copy the /exec URL and set it as SHEETS_URL in the Node server env.
 */

var LEADS_HEADERS = [
  'id', 'name', 'phone', 'serviceType', 'location', 'note',
  'stage', 'sessionsPerWeek', 'pricePerSession', 'startDate', 'created', 'introDateTime',
  'house_of_origin',
  'not_relevant_reason',
  'not_relevant_note',
  // APPEND-ONLY (משוייך ל / assigned-to): staff member the lead is assigned to
  // (ורד / שירן / יעל). Other staff besides Vered now enter leads. Appended at
  // the very END so every earlier column keeps its position (_readAll/_writeAll
  // map positionally; _ensureSheet does not migrate). Follows the lead onto the
  // client on conversion. Old rows read back blank.
  'assignedTo',
  // APPEND-ONLY who/when stamps (session-who-when PR, port of Dashboard PR
  // #113). SERVER-OWNED: _saveAll stamps a lead whose non-meta columns
  // changed (or a new lead) with the server clock + the proxy-injected
  // session user, and carries the existing sheet stamps for an unchanged
  // echo — payload stamps are never trusted. Text-forced so the ISO stamp is
  // never Date-coerced. Old rows read back blank until first edited.
  'updatedAt', 'updatedBy'
];

/* Meta columns of the Leads sheet — identity + who/when audit, NOT content.
 * _leadDiffCols ignores them so an echoed stale stamp never reads as an edit. */
var LEADS_META_COLUMNS = ['id', 'updatedAt', 'updatedBy'];

/* Extra columns (source, notes, billingType, billingDay, bundleSize,
 * bundlePrice, sessionsUsed, bundlePaid) added after launch. _ensureSheet
 * non-destructively extends existing sheets on next read so no migration
 * is needed — old rows get blank values for the new columns and default
 * to billingType='monthly' on the client.
 *
 * `phone` is the patient's own number, carried from the lead on activation.
 * It is the durable home for the patient phone used by cross-app matching
 * (debt, stop-flow). It is appended LAST per the append-only rule: _readAll/
 * _writeAll map columns positionally to this array, so a new column may only be
 * added at the end — inserting it mid-array would shift every later column on
 * existing rows. Old rows get a blank `phone` until re-saved; the client
 * backfills it in memory from the originating lead. It is a PHONE_COLUMN, so it
 * gets the same Sheets leading-zero text-format/recovery as the other phones. */
var CLIENTS_HEADERS = [
  'id', 'name', 'serviceType', 'location', 'sessionsPerWeek',
  'pricePerSession', 'startDate', 'status', 'exitDate', 'fromLead',
  'source', 'notes', 'billingType', 'billingDay',
  'bundleSize', 'bundlePrice', 'sessionsUsed', 'bundlePaid',
  'house_of_origin',
  // RESERVED / DEAD (task 4.4): the אחראי concept (responsiblePerson + its
  // serviceScope role) was removed from the app. These two slots are kept ONLY
  // to preserve column positions — _readAll/_writeAll are positional and
  // _ensureSheet does not migrate data, so dropping mid-array headers would
  // shift/corrupt every column after this point (incl. the `phone` join key).
  // The app no longer reads or writes them; existing cells blank on next save.
  'responsiblePerson', 'serviceScope',
  'treatmentContactPhone', 'payerName', 'payerPhone', 'paymentLink',
  // `phone` is the durable canonical patient phone (a PHONE_COLUMN). It is the
  // join key used by cross-app matching (debt, stop-flow). Volta's live column
  // order is preserved EXACTLY through here — nothing before this point moves.
  'phone',
  // ── FROZEN PHYSICAL ORDER — verified against the LIVE Clients sheet 2026-07-06 ──
  // The four columns below occupy the physical positions the DEPLOYED
  // dashboard-hKjf9 script actually wrote (paymentStatus 27, paymentDate 28,
  // nextBillingDate 29, creditsOwed 30 — directly after `phone` at 26). PR #56's
  // "append-only" unification was append-only vs the *volta* header ARRAY but a
  // MID-ARRAY INSERT vs the *physically-deployed* sheet: it placed the volta-only
  // columns (clinicalTreatmentType/packageChangeDate/assignedTo) between phone and
  // this payment tail. Because _ensureSheet relabels the header row but never
  // migrates data, the deploy shifted every live paid/unpaid + date value under the
  // wrong header name and made _deriveClientServiceType throw on every save (it read
  // 'paid' as a clinical type). This order restores alignment WITH THE REAL SHEET —
  // no data move needed. APPEND-ONLY FROM HERE, verified against the sheet itself
  // (not merely the prior array). NEVER reorder or remove these; append only.
  //
  //   paymentStatus / paymentDate / nextBillingDate: persist the renewal anchor so
  //     the alert reads a stored nextBillingDate instead of falling back to
  //     startDate after every reload.
  //   creditsOwed: SERVER-MANAGED running monthly-credit balance — mutated only by
  //     recordSessionOutcome (therapist_cancelled -> +1; a happened session beyond
  //     the monthly quota auto-draws -1). _saveAll preserves it by id so a
  //     dashboard save never reverts it. Default 0.
  'paymentStatus', 'paymentDate', 'nextBillingDate', 'creditsOwed',
  // ── volta-only columns: physically UNWRITTEN on the live (dashboard-line) sheet,
  // so they append at the END with no migration. Old rows read them back blank
  // until the next save; no backfill.
  //   clinicalTreatmentType: clinical treatment type as recorded by the E-Zone
  //     Therapists app. When present on save, _deriveClientServiceType() runs it
  //     through the clinical→billing map and overwrites `serviceType` (clinical is
  //     the source of truth). Absent/empty -> serviceType left as-is (back-compat).
  //   packageChangeDate (שינוי חבילה): the date the patient's package was last
  //     changed. When present it becomes the billing RE-ANCHOR for the next renewal
  //     (גבייה הבאה = packageChangeDate + 1 month), taking precedence over
  //     paymentDate/startDate (see nextRenewalDueDate / renewalInfo / cycleEndDate).
  //   assignedTo (משוייך ל): staff member responsible for this patient, copied from
  //     the originating lead on conversion so the assignee follows the person.
  //   paymentAmountOverrides (סכום גבייה ידני): APPEND-ONLY, physically unwritten on
  //     the live sheet so it lands at the very END with no migration. A JSON map
  //     { "<paymentId>": <amount> } of MANUAL collection-amount corrections for this
  //     client's open-balance rows (גבייה). It is an override LAYER — the read side
  //     prefers it over the computed/billed amount, and it NEVER rewrites the package
  //     price or a charge source row. Written one cell at a time by
  //     _writePaymentAmountOverride (mirrors _writeCreditsOwed); preserved by id on
  //     _saveAll so a stale full-sheet save can't clobber a newer override. Old rows
  //     read back blank -> {}.
  'clinicalTreatmentType', 'packageChangeDate', 'assignedTo', 'paymentAmountOverrides',
  //   updatedAt / updatedBy (who/when stamping — session-who-when PR, port of
  //     Dashboard PR #113): APPEND-ONLY, physically unwritten on the live sheet so
  //     they land at the very END (positions 35-36) with no migration. SERVER-OWNED:
  //     updatedAt = ISO server time of the last write that CHANGED a non-meta
  //     column of this row; updatedBy = the session user the Railway proxy injects
  //     from the SIGNED cookie ('' for cross-app callers and legacy cookies).
  //     _saveAll stamps changed/new rows and carries the sheet's stamps for an
  //     unchanged echo (payload stamps are NEVER trusted); every single-cell
  //     Clients writer stamps its row via _stampClientRow. Text-forced (like the
  //     phone columns) so the ISO stamp is never Date-coerced. Old rows read back
  //     blank until first edited. PR 2 uses updatedAt for stale-save refusal.
  'updatedAt', 'updatedBy'
];

/* Meta columns of the Clients sheet — identity, who/when audit, and the two
 * SERVER-MANAGED cell-level columns (creditsOwed / paymentAmountOverrides are
 * preserved by id on every save, so a payload echo of them is never an edit).
 * _clientDiffCols ignores all five: two rows differing only in these are the
 * same client content-wise, and an echoed stale stamp never re-stamps. */
var CLIENTS_META_COLUMNS = ['id', 'updatedAt', 'updatedBy', 'creditsOwed', 'paymentAmountOverrides'];

/* Columns whose cells hold who/when stamps. Forced to plain-text ('@') on
 * ensure/write (same mechanism as PHONE_COLUMNS) so Sheets never coerces the
 * ISO timestamp into a Date and hands back a shifted/reformatted value. */
var STAMP_COLUMNS = { updatedAt: true, updatedBy: true };

/* Tombstone sheet ("Clients-removed") for rows removed from Clients — the
 * recovery net for the stale-tab clobber incident (2026-08-26): _saveAll is a
 * clear-and-rewrite of the whole Clients sheet from whatever client list the
 * browser sent, so a browser holding a stale list silently erased a patient
 * row while their Payments rows survived as orphans. Before ANY row is
 * dropped (diffed away by a save, or deleted on purpose) its full current row
 * is appended here first, so a drop is always recoverable.
 *
 * This sheet has ITS OWN headers — deliberately a full literal, NOT a concat
 * of CLIENTS_HEADERS: the tombstone sheet is decoupled from the frozen
 * Clients positional rule, so a future CLIENTS_HEADERS append can never
 * shift removedAt/removedVia/restoredAt under existing tombstone rows. This
 * array is append-only like every other header array — a new Clients column
 * is mirrored here by appending it at the very END (after restoredAt).
 *   removedAt  — ISO timestamp of the removal.
 *   removedVia — 'saveAll-diff' (row missing from a saveAll payload that did
 *                not declare it as an explicit delete: the stale-tab clobber
 *                signature — historical rows only, from before merge-don't-
 *                drop; _saveAll no longer drops these rows)
 *              | 'saveAll-diff-preserved' (same signature, but the row was
 *                KEPT in the rewrite by merge-don't-drop: this tombstone is
 *                a stale-save visibility log entry, NOT a removal — the
 *                client row is still live on Clients, so the admin restore
 *                surface filters these out)
 *              | 'explicit-delete' (the ✕ permanent-delete flow declared the
 *                id in explicitRemovedIds — still actually dropped).
 *   restoredAt — blank until restoreRemovedClient copies the row back to
 *                Clients; then stamped so a tombstone is never restored twice.
 * Tombstone ROWS are append-only: an audit trail — never rewritten, never
 * deleted; restore only stamps restoredAt. */
var CLIENTS_REMOVED_HEADERS = [
  'id', 'name', 'serviceType', 'location', 'sessionsPerWeek',
  'pricePerSession', 'startDate', 'status', 'exitDate', 'fromLead',
  'source', 'notes', 'billingType', 'billingDay',
  'bundleSize', 'bundlePrice', 'sessionsUsed', 'bundlePaid',
  'house_of_origin',
  'responsiblePerson', 'serviceScope',
  'treatmentContactPhone', 'payerName', 'payerPhone', 'paymentLink',
  'phone',
  'paymentStatus', 'paymentDate', 'nextBillingDate', 'creditsOwed',
  'clinicalTreatmentType', 'packageChangeDate', 'assignedTo', 'paymentAmountOverrides',
  'removedAt', 'removedVia', 'restoredAt',
  // APPEND-ONLY mirror of the Clients who/when stamps — at the very END (after
  // restoredAt) per this sheet's own positional rule. A tombstone carries the
  // row's last-edit stamps; an explicit ✕ delete overwrites them with now +
  // the deleting user so the recovery copy answers "who deleted this, when".
  'updatedAt', 'updatedBy'
];

/* Settings sheet: one row per setting, key/value style.
 * Currently used for bank transfer details. */
var SETTINGS_HEADERS = ['key', 'value'];

var PAYMENTS_HEADERS = [
  'id', 'clientId', 'clientName', 'billingType', 'dueDate',
  'amountDue', 'amountPaid', 'status', 'paymentDate', 'method',
  'notes', 'bundleSize', 'sessionsUsed'
];

/* Extra charges per client (חיובים נוספים). One row per ad-hoc treatment,
 * layered on top of the base monthly subscription. billingType is either
 * 'one_time' (chargeDate is the single due date) or 'monthly' (chargeDate
 * is the start date; billingDay overrides dayOfMonth(chargeDate) for the
 * recurring day). active='false' soft-disables a charge without delete. */
var CHARGES_HEADERS = [
  'id', 'clientId', 'description', 'amount',
  'billingType',
  'chargeDate',
  'billingDay',
  'active',
  'notes', 'created'
];

/* Removed leads sheet: soft-deleted leads moved out of Leads.
 * Same columns as LEADS_HEADERS plus removedAt timestamp and
 * originSheet for restore-by-hand. New headers added at the end
 * per the _ensureSheet append-only rule. */
var REMOVED_LEADS_HEADERS = [
  'id', 'name', 'phone', 'serviceType', 'location', 'note',
  'stage', 'sessionsPerWeek', 'pricePerSession', 'startDate', 'created', 'introDateTime',
  'house_of_origin',
  'not_relevant_reason',
  'not_relevant_note',
  'removedAt',
  'originSheet',
  // APPEND-ONLY (משוייך ל / assigned-to): mirror of the LEADS_HEADERS column so a
  // removed lead preserves its assignee. Appended at the very END (after the
  // removedAt/originSheet bookkeeping columns) per the positional append-only rule.
  'assignedTo',
  // APPEND-ONLY mirror of the Leads who/when stamps (at the very END). A
  // removed lead carries now + the removing user, so the tombstone answers
  // "who removed this, when" alongside removedAt.
  'updatedAt', 'updatedBy'
];

/* Stop-treatment flags (StopFlags tab): the E-Zone Therapists app flags that a
 * patient appears to have stopped treatment. Append-only; surfaced to Vered for
 * manual confirmation. This receiver NEVER modifies Clients — Vered remains the
 * sole authority on actual discharge. */
var STOP_FLAGS_HEADERS = [
  'id', 'phone', 'name', 'clientId',
  'reportedBy', 'reportedAt', 'note',
  'status', 'resolvedBy', 'resolvedAt'
];

/* Over-package extra-session requests. The therapists app POSTs one when Yarden
 * schedules beyond a patient's monthly package; Vered sees pending ones and
 * approves. status: 'pending' | 'approved'. */
var EXTRA_SESSION_HEADERS = [
  'id', 'phone', 'patientName', 'treatmentType', 'therapist',
  'monthKey', 'quota', 'used', 'requestedBy', 'note',
  'requestedAt', 'status', 'approvedBy', 'approvedAt'
];

/* Continuation-track (מסלול המשך) workflow state. Yarden works over the roster of
 * currently-admitted DASHBOARD patients (potential outpatient leads); this sheet
 * persists the per-patient meeting date + outcome. The roster itself is NOT
 * stored here — it is fetched live from the dashboard (server /api/continuation-
 * roster) and joined to these rows by `key` (name|house|entryDate) in the client.
 * `outcome` holds a STABLE English key ('' | 'continuing' | 'to_outpatient' |
 * 'stopping'); Hebrew labels are render-time only. This feature never touches
 * CLIENTS_HEADERS. */
var CONTINUATION_SHEET = 'מסלול המשך';
var CONTINUATION_HEADERS = [
  'key', 'name', 'house', 'entryDate',
  'meetingDate', 'outcome', 'outcomeDate', 'note', 'updatedAt'
];
var CONTINUATION_OUTCOMES = ['', 'continuing', 'to_outpatient', 'stopping'];

/* Stop-treatment alerts (התראות עצירת טיפול). The OUTPATIENT app CREATES an alert
 * when Vered decides an unpaid patient's treatment should stop; the E-Zone
 * THERAPISTS app READS them in its new "עצירת טיפול" tab and marks each one read
 * after Yarden acts. Alerts PERSIST at status 'unread' until explicitly marked
 * 'read' there — this backend never auto-resolves them. Auto-created via
 * _ensureSheet. createStopAlert is INTERNAL (same trust level as saveAll — posted
 * same-origin through the outpatient Node proxy, no cross-app secret). getStopAlerts
 * + markStopAlertRead are the CROSS-APP endpoints the therapists app calls: BOTH
 * are fail-closed behind STOP_ALERTS_SECRET (mirrors SESSION_OUTCOME_SECRET — a
 * missing Script Property rejects every request). */
var STOP_ALERTS_SHEET = 'התראות עצירת טיפול';
/* Columns are APPEND-ONLY (like CLIENTS_HEADERS). 'reason' was appended July 6;
 * 'type' then 'cancelledAt' were appended July 7 for the two-way stop/resume flow.
 * _ensureSheet relabels the header row in place; appending (never inserting
 * mid-array) keeps every earlier column at its original index. A row written
 * before a column existed is shorter than the header: _readAll requests
 * headers.length columns and Sheets pads the missing trailing cells to '', so a
 * legacy row reads reason: '', type: '' (treat '' as 'stop'), cancelledAt: ''. */
var STOP_ALERTS_HEADERS = [
  'id', 'clientId', 'clientName', 'createdAt', 'createdBy', 'status', 'readAt', 'note', 'reason', 'type', 'cancelledAt'
];
/* Allowed stop-alert reasons (stable keys; Hebrew labels are render-time only,
 * in the therapists app + public/app.js). createStopAlert is fail-closed on
 * this set: a missing or unknown reason is rejected, never written. */
var STOP_ALERT_REASONS = { no_payment: true, mismatch: true, other: true };
/* Alert type (stable keys). 'stop' = pause-treatment alert (createStopAlert);
 * 'resume' = resume-treatment alert (resumeTreatmentAlert, only when the stop was
 * already READ). A legacy row with an empty type cell is treated as 'stop'. */
var STOP_ALERT_TYPES = { stop: true, resume: true };

/* Columns that hold phone numbers. Forced to plain-text ('@') format on write
 * so Google Sheets does not coerce a numeric-looking phone to a number and drop
 * the leading zero, and recovered on read for already-corrupted rows. */
var PHONE_COLUMNS = { phone: true, treatmentContactPhone: true, payerPhone: true };

/* Mirror of recoverPhone() in public/app.js — keep both in sync. Normalizes to
 * the leading-zero canonical form and restores a leading zero that Sheets
 * dropped by coercing the phone to a number. Idempotent. */
function _recoverPhone(raw) {
  if (raw === null || raw === undefined) return '';
  var s = String(raw).replace(/[\s\-\(\)]/g, '');
  if (s.indexOf('+') === 0) s = s.slice(1);
  if (s.indexOf('00') === 0) s = s.slice(2);
  s = s.replace(/\D/g, '');
  if (!s) return '';
  if (s.indexOf('972') === 0) s = '0' + s.slice(3);   // intl -> local
  else if (s.charAt(0) !== '0') s = '0' + s;          // Sheets dropped the leading 0
  return s;
}

/* Columns that must be stored as plain text: phones (leading zeros) and the
 * who/when stamps (ISO timestamps that Sheets would otherwise Date-coerce). */
function _isTextForcedColumn(name) {
  return !!(PHONE_COLUMNS[name] || STAMP_COLUMNS[name]);
}

/* Force '@' (plain text) format on any phone / stamp columns in this sheet,
 * below the header row, so future writes preserve leading zeros and ISO
 * timestamps verbatim. */
function _formatPhoneColumns(sh, headers) {
  var maxRows = sh.getMaxRows();
  if (maxRows < 2) return;
  for (var i = 0; i < headers.length; i++) {
    if (_isTextForcedColumn(headers[i])) {
      sh.getRange(2, i + 1, maxRows - 1, 1).setNumberFormat('@');
    }
  }
}

/* ===== Who/when stamping helpers (session-who-when PR) =====================
 *
 * updatedAt / updatedBy are SERVER-OWNED on Clients and Leads. The Railway
 * proxy sets `user` on every /api/sheets POST body FROM THE SIGNED SESSION
 * COOKIE, overwriting anything the browser sent — so the value that reaches
 * doPost is never client-controlled. Cross-app receivers (therapists /
 * dashboard → /exec directly) pass '' explicitly: they stamp WHEN, not who. */

/* The authenticated user name for who/when stamping (updatedBy). Defensive
 * normalization on top of the proxy's: trimmed, capped at 40 chars, angle
 * brackets + control chars stripped. Blank for legacy cookies (allowed). */
function _requestUser(payload) {
  return String(payload && payload.user != null ? payload.user : '')
    .replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 40);
}

/* Stamp a row object in place: updatedAt = ISO server time, updatedBy = user
 * (may be blank). Returns the row for chaining. */
function _stampRow(row, user) {
  if (!row || typeof row !== 'object') return row;
  row.updatedAt = new Date().toISOString();
  row.updatedBy = String(user == null ? '' : user);
  return row;
}

/* Column names (from `headers`) where two row objects differ, ignoring the
 * `meta` columns (identity / audit / server-managed cells). Plain String
 * comparison: _readAll already hands back ISO date strings and recovered
 * phones, and a payload number vs. a sheet number stringify identically, so a
 * pure echo of an unchanged row diffs to []. An empty result means "no
 * content change" — the row keeps its existing stamps. */
function _rowDiffCols(headers, meta, a, b) {
  var diff = [];
  var skip = {};
  for (var m = 0; m < meta.length; m++) skip[meta[m]] = true;
  for (var c = 0; c < headers.length; c++) {
    var h = headers[c];
    if (skip[h]) continue;
    var av = String(a && a[h] != null ? a[h] : '');
    var bv = String(b && b[h] != null ? b[h] : '');
    if (av !== bv) diff.push(h);
  }
  return diff;
}

/* Clients: differing non-meta columns (ignores id, updatedAt, updatedBy,
 * creditsOwed, paymentAmountOverrides). */
function _clientDiffCols(a, b) {
  return _rowDiffCols(CLIENTS_HEADERS, CLIENTS_META_COLUMNS, a, b);
}

/* Leads: differing non-meta columns (ignores id, updatedAt, updatedBy). */
function _leadDiffCols(a, b) {
  return _rowDiffCols(LEADS_HEADERS, LEADS_META_COLUMNS, a, b);
}

/* Reconcile the who/when stamps of an incoming row against the on-sheet row
 * it replaces: a real content change (or a brand-new row, existing == null)
 * is stamped now + user; an unchanged echo carries the SHEET's stamps —
 * payload stamps are never trusted either way. Returns the changed-column
 * list ([] for an unchanged echo; ['*'] for a new row). */
function _reconcileStamps(diffFn, incoming, existing, user) {
  if (!existing) {
    _stampRow(incoming, user);
    return ['*'];
  }
  var changed = diffFn(incoming, existing);
  if (changed.length) {
    _stampRow(incoming, user);
  } else {
    incoming.updatedAt = existing.updatedAt == null ? '' : existing.updatedAt;
    incoming.updatedBy = existing.updatedBy == null ? '' : existing.updatedBy;
  }
  return changed;
}

/* Single-cell stamp for the cell-level Clients writers: locate the client row
 * by scanning the id column (the _writeCreditsOwed pattern) and write
 * updatedAt/updatedBy into that row only — never _writeAll. Fail-soft: no hit
 * changes nothing and returns false. Columns are header-lookup-derived so a
 * future append can never shift the write. */
function _stampClientRow(clientsSh, clientId, user) {
  var idCol = CLIENTS_HEADERS.indexOf('id') + 1;
  var atCol = CLIENTS_HEADERS.indexOf('updatedAt') + 1;
  var byCol = CLIENTS_HEADERS.indexOf('updatedBy') + 1;
  var lastRow = clientsSh.getLastRow();
  if (lastRow < 2 || idCol < 1 || atCol < 1 || byCol < 1 || !clientId) return false;
  var ids = clientsSh.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (var r = 0; r < ids.length; r++) {
    if (String(ids[r][0]) === String(clientId)) {
      _stampClientRowAt(clientsSh, r + 2, user);
      return true;
    }
  }
  return false;
}

/* Stamp a Clients sheet row by its 1-based sheet row number (for writers that
 * already located the row). Two single-cell setValue writes. */
function _stampClientRowAt(clientsSh, rowNum, user) {
  var atCol = CLIENTS_HEADERS.indexOf('updatedAt') + 1;
  var byCol = CLIENTS_HEADERS.indexOf('updatedBy') + 1;
  if (atCol < 1 || byCol < 1 || rowNum < 2) return false;
  clientsSh.getRange(rowNum, atCol).setValue(new Date().toISOString());
  clientsSh.getRange(rowNum, byCol).setValue(String(user == null ? '' : user));
  return true;
}

function _ss() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function _ensureSheet(name, headers) {
  var ss = _ss();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    _formatPhoneColumns(sh, headers);
    return sh;
  }
  var lastCol = Math.max(sh.getLastColumn(), headers.length);
  var existing = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var needsHeader = false;
  for (var i = 0; i < headers.length; i++) {
    if (existing[i] !== headers[i]) { needsHeader = true; break; }
  }
  if (needsHeader) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  _formatPhoneColumns(sh, headers);
  return sh;
}

function _readAll(sh, headers) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    if (row.every(function (c) { return c === '' || c === null; })) continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var v = row[c];
      if (v instanceof Date) {
        v = Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Jerusalem', 'yyyy-MM-dd');
      } else if (PHONE_COLUMNS[headers[c]]) {
        v = _recoverPhone(v);   // restore leading zero dropped by Sheets coercion
      }
      obj[headers[c]] = v;
    }
    out.push(obj);
  }
  return out;
}

function _writeAll(sh, headers, rows) {
  var lastRow = sh.getLastRow();
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, headers.length).clearContent();
  }
  if (!rows || !rows.length) return;
  var values = rows.map(function (row) {
    return headers.map(function (h) {
      var v = row[h];
      if (v === undefined || v === null) return '';
      return v;
    });
  });
  // Force phone + stamp columns to plain text BEFORE writing so leading zeros
  // and ISO timestamps survive (Sheets would otherwise coerce a numeric-looking
  // phone to a number and an ISO string to a Date).
  for (var c = 0; c < headers.length; c++) {
    if (_isTextForcedColumn(headers[c])) {
      sh.getRange(2, c + 1, values.length, 1).setNumberFormat('@');
    }
  }
  sh.getRange(2, 1, values.length, headers.length).setValues(values);
}

function _getData() {
  var leadsSh = _ensureSheet('Leads', LEADS_HEADERS);
  var clientsSh = _ensureSheet('Clients', CLIENTS_HEADERS);
  return {
    ok: true,
    leads: _readAll(leadsSh, LEADS_HEADERS),
    clients: _readAll(clientsSh, CLIENTS_HEADERS),
    // Staleness signal: the tab echoes this back on saveAll; an echo older
    // than the then-current value flags that save's response staleSave:true.
    dataVersion: _readDataVersion()
  };
}

/* ===== Clinical → billing derive (task 4.5a receiver) =====
 *
 * MIRROR of public/treatment-map.js `CLINICAL_TO_BILLING`. The Apps Script
 * runtime cannot import that module, so the map is duplicated here, exactly as
 * the debt/phone rules are. test/clinical-derive.test.js parses this literal and
 * asserts it deep-equals the module — any drift fails the suite. Keep in sync.
 *
 * One-to-one over 12 clinical keys; two renames are pinned (פרטני כללי→פרטני and
 * מרכז יום→ליווי יומי בקהילה, here keyed under the NEW name); the five
 * newly-billable types map to their own names.
 */
var CLINICAL_TO_BILLING = {
  'פרטני כללי':             'פרטני',
  'פרטני CBT':              'פרטני CBT',
  'פרטני EMDR':             'פרטני EMDR',
  'קבוצה':                  'קבוצה',
  'טיפול משפחתי':           'טיפול משפחתי',
  'מעקב פסיכיאטרי':         'מעקב פסיכיאטרי',
  'ליווי יומי בקהילה':      'ליווי יומי בקהילה',
  'פסיכודינמי':             'פסיכודינמי',
  'פסיכותרפי ממוקד טראומה': 'פסיכותרפי ממוקד טראומה',
  'עיסוי טיפולי':           'עיסוי טיפולי',
  'טיפול ממוקד התמכרויות':  'טיפול ממוקד התמכרויות',
  'טיפול אינטגרטיבי':       'טיפול אינטגרטיבי'
};

function _clinicalToBilling(clinicalType) {
  var key = String(clinicalType == null ? '' : clinicalType).trim();
  if (!Object.prototype.hasOwnProperty.call(CLINICAL_TO_BILLING, key)) {
    throw new Error('Unknown clinical treatment type: "' + key + '"');
  }
  return CLINICAL_TO_BILLING[key];
}

/* If a client row carries a clinicalTreatmentType, derive serviceType from it
 * (clinical is authoritative) and overwrite. Absent/empty -> leave serviceType
 * untouched (back-compat for legacy / not-yet-migrated rows). Mutates + returns.
 *
 * FAIL-SOFT (hardened after the 2026-07-06 column-shift incident): an UNKNOWN
 * clinical value must NEVER throw here. _saveAll derives EVERY client in one loop
 * *before* it writes, so a single bad or column-misaligned row (e.g. a stray
 * 'paid' left behind by a header/data mismatch) would abort the entire save and
 * block the whole app. Warn and leave serviceType as-is instead. The strict
 * _clinicalToBilling primitive still throws for callers that want validation
 * (e.g. the explicit setClinicalType admin action, which also pre-validates). */
function _deriveClientServiceType(client) {
  if (!client) return client;
  var clinical = String(client.clinicalTreatmentType == null ? '' : client.clinicalTreatmentType).trim();
  if (!clinical) return client;
  if (!Object.prototype.hasOwnProperty.call(CLINICAL_TO_BILLING, clinical)) {
    try {
      Logger.log('WARN _deriveClientServiceType: unknown clinicalTreatmentType "' + clinical +
        '" (id=' + (client && client.id != null ? client.id : '') + ') — leaving serviceType unchanged');
    } catch (_) {}
    return client; // one bad row must never block all saves
  }
  client.serviceType = CLINICAL_TO_BILLING[clinical];
  return client;
}

/* ===== Clients column-shift pre-condition scan (2026-07-06 incident) ========
 *
 * READ-ONLY forensic gate for the CLIENTS_HEADERS reorder (option a). It reads the
 * live Clients sheet BY PHYSICAL POSITION (never via _readAll, whose header map was
 * relabeled by the bad deploy) and confirms the sheet still matches the deployed
 * dashboard-hKjf9 physical layout — i.e. the reorder can be shipped with NO data
 * move. It writes NOTHING. Run it (secret-gated, COLUMN_REPAIR_SECRET) BEFORE
 * deploying the reordered Code.gs; a non-empty `violations` / safeToReorder:false
 * means some rows carry the post-unification layout (mixed sheet) — STOP and use a
 * physical data repair instead.
 *
 * Physical positions (1-indexed) as written by the deployed dashboard-hKjf9 script:
 *   phone 26 | paymentStatus 27 | paymentDate 28 | nextBillingDate 29 | creditsOwed 30
 * Cols 31-33 must be EMPTY: no dashboard column ever wrote there, and had the buggy
 * post-unification layout ever saved, paymentStatus/date/date would sit in 31/32/33. */
var _REPAIR_PHYS = {
  phone: 26,
  paymentStatus: 27, paymentDate: 28, nextBillingDate: 29, creditsOwed: 30,
  mustBeEmpty: [31, 32, 33] // relabel targets for the volta-only columns
};

function _looksPaymentStatus(v) {
  if (v === '' || v === null) return true;
  var s = String(v).trim().toLowerCase();
  return s === 'paid' || s === 'unpaid' || s === 'partial';
}
function _looksDateCell(v) {
  if (v === '' || v === null) return true;
  if (v instanceof Date) return true;
  return /^\d{4}-\d{2}-\d{2}/.test(String(v).trim());
}
function _looksCredits(v) {
  if (v === '' || v === null) return true;
  return isFinite(Number(v));
}
function _cellEmpty(v) { return v === '' || v === null; }

function _columnRepairAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('COLUMN_REPAIR_SECRET');
  if (!expected) return false; // fail-closed: not configured -> reject
  var got = (params && params.secret != null) ? String(params.secret) : '';
  return got !== '' && got === expected;
}

function _scanClientColumns() {
  var sh = _ss().getSheetByName('Clients');
  if (!sh) return { ok: false, error: 'Clients sheet not found' };
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2) {
    return { ok: true, scannedRows: 0, safeToReorder: true, verdict: 'SAFE: empty sheet', violations: [] };
  }
  var vals = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var P = _REPAIR_PHYS;
  function cell(row, col1) { return col1 <= row.length ? row[col1 - 1] : ''; }
  var summary = {
    paymentStatus:   { physCol: P.paymentStatus,   pass: 0, fail: 0 },
    paymentDate:     { physCol: P.paymentDate,      pass: 0, fail: 0 },
    nextBillingDate: { physCol: P.nextBillingDate,  pass: 0, fail: 0 },
    creditsOwed:     { physCol: P.creditsOwed,      pass: 0, fail: 0 },
    tailEmpty:       { physCols: P.mustBeEmpty,     pass: 0, fail: 0 }
  };
  var violations = [];
  var MAX_V = 100;
  var scanned = 0;
  for (var r = 0; r < vals.length; r++) {
    var row = vals[r];
    if (row.every(function (c) { return c === '' || c === null; })) continue;
    scanned++;
    var rowNum = r + 2;
    var id = cell(row, 1);
    var checks = [
      ['paymentStatus',   P.paymentStatus,   _looksPaymentStatus, 'paid|unpaid|partial|empty'],
      ['paymentDate',     P.paymentDate,      _looksDateCell,      'date|empty'],
      ['nextBillingDate', P.nextBillingDate,  _looksDateCell,      'date|empty'],
      ['creditsOwed',     P.creditsOwed,      _looksCredits,       'number|empty']
    ];
    for (var k = 0; k < checks.length; k++) {
      var name = checks[k][0], col1 = checks[k][1], ok = checks[k][2], kind = checks[k][3];
      var v = cell(row, col1);
      if (ok(v)) { summary[name].pass++; }
      else {
        summary[name].fail++;
        if (violations.length < MAX_V) {
          violations.push({ row: rowNum, id: String(id), field: name, physCol: col1,
            value: (v instanceof Date ? 'DATE:' + Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Jerusalem', 'yyyy-MM-dd') : String(v)),
            expected: kind });
        }
      }
    }
    var tailOk = true;
    for (var m = 0; m < P.mustBeEmpty.length; m++) {
      var tv = cell(row, P.mustBeEmpty[m]);
      if (!_cellEmpty(tv)) {
        tailOk = false;
        if (violations.length < MAX_V) {
          violations.push({ row: rowNum, id: String(id), field: 'postUnificationTail', physCol: P.mustBeEmpty[m],
            value: (tv instanceof Date ? 'DATE:' + Utilities.formatDate(tv, Session.getScriptTimeZone() || 'Asia/Jerusalem', 'yyyy-MM-dd') : String(tv)),
            expected: 'empty' });
        }
      }
    }
    if (tailOk) summary.tailEmpty.pass++; else summary.tailEmpty.fail++;
  }
  var totalFail = summary.paymentStatus.fail + summary.paymentDate.fail +
    summary.nextBillingDate.fail + summary.creditsOwed.fail + summary.tailEmpty.fail;
  return {
    ok: true,
    readOnly: true,
    scannedRows: scanned,
    lastCol: lastCol,
    physicalLayoutAssumed: P,
    summary: summary,
    safeToReorder: totalFail === 0,
    verdict: totalFail === 0
      ? 'SAFE: live sheet matches the dashboard physical layout (cols 27-30 = paymentStatus/paymentDate/nextBillingDate/creditsOwed; cols 31-33 empty). Reorder needs no data move.'
      : 'STOP: mixed-layout rows found — cells were written under the post-unification layout. Option (a) is unsafe; use a physical data repair (option b).',
    violations: violations,
    violationsTruncated: violations.length >= MAX_V
  };
}

/* ===== Pay + price mirrors (task 4.8-step3-out) =============================
 *
 * MIRRORS of public/therapist-pay.js (the PAY side) and the price half of
 * public/treatment-map.js (the client-facing BILLING side). The Apps Script
 * runtime cannot import those modules, so — exactly like CLINICAL_TO_BILLING
 * above — the tables are duplicated here. test/session-outcome.test.js parses
 * each literal out of Code.gs and asserts it deep-equals the canonical module,
 * so the mirror can never silently drift. Keep in sync; ALL RATES ARE PRE-VAT on
 * the pay side and INCL. VAT on the billing side, untouched here.
 */

// --- Pay: flat per-therapist (pre-VAT). Mirror of FLAT_RATES. ----------------
var THERAPIST_FLAT_RATES = {
  'מעיין דלומי': 250,
  'תמר גנץ':     250,
  'אורן כביר':   250,
  'אביב מלכה':   250,
  'רמי':         250,
  'כנרת':        250,
  'הילה':        250,
  'עידו בוזגלו': 250,
  'אלה':         250,
  'שירן':        250,
  'דנה':         250,
  'יפעת':        250,
  'איתן דשה':    250,
  'דליה מלמד':   230,
  'נועה זיפמן':  210,
  'אסתר':        180
};

// --- Pay: psychiatrists by treatment type (pre-VAT). Mirror of PSYCHIATRIST_RATES.
var PSYCHIATRIST_RATES = {
  'ד״ר שפרינץ': { 'אינטייק': 900, 'מעקב פסיכיאטרי': 700 },
  'ד״ר נטליה':  { 'אינטייק': 900, 'מעקב פסיכיאטרי': 700 },
  'ד״ר דנגור':  { 'אינטייק': 900, 'מעקב פסיכיאטרי': 700 }
};

// --- Billing: flat client-facing prices (incl. VAT). Mirror of BILLING_PRICES.
// 0 is a DECIDED price (קבוצה intentionally free), not a "no price" flag.
var BILLING_PRICES = {
  'פרטני':                  500,
  'פרטני CBT':              500,
  'פרטני EMDR':             500,
  'פסיכודינמי':             500,
  'פסיכותרפי ממוקד טראומה': 500,
  'עיסוי טיפולי':           500,
  'טיפול ממוקד התמכרויות':  500,
  'טיפול אינטגרטיבי':       500,
  'מעקב פסיכיאטרי':         1100,
  'אינטייק':                2300,
  'קבוצה':                  0,
  'טיפול משפחתי':           600
};

// Day-center is priced by weekly frequency, not in BILLING_PRICES. Mirror of
// DAY_CENTER_BILLING / DAY_CENTER_MONTHLY_BY_FREQ.
var DAY_CENTER_BILLING = 'ליווי יומי בקהילה';
var DAY_CENTER_MONTHLY_BY_FREQ = { 3: 15000, 5: 18000 };
var GROUP_BILLING = 'קבוצה';

function _hasOwn(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }

/* _therapistPay(name, treatmentType?) -> pre-VAT rate. Mirror of therapistPay():
 * flat therapist ignores type; psychiatrist REQUIRES a valid type; unknown
 * therapist / bad psych type throws. */
var THERAPIST_RATES_SHEET = 'TherapistRates';
var THERAPIST_RATES_HEADERS = ['name', 'flatRate', 'intakeRate', 'followupRate'];

// Sheet-managed rates: add/update a therapist by editing the TherapistRates sheet
// (no code redeploy). Auto-seeded once from the hardcoded maps. Cached 120s via
// CacheService so per-session calls don't re-read the sheet; a sheet edit
// therefore takes effect within ~2 minutes.
function _loadTherapistRates() {
  var cached = null;
  try { cached = CacheService.getScriptCache().get('therapistRates_v1'); } catch (_) {}
  if (cached) { try { return JSON.parse(cached); } catch (_) {} }
  var sh = _ensureSheet(THERAPIST_RATES_SHEET, THERAPIST_RATES_HEADERS);
  var rows = _readAll(sh, THERAPIST_RATES_HEADERS);
  if (!rows.length) {   // first run: seed from the constants so nothing is lost
    var seed = [];
    Object.keys(THERAPIST_FLAT_RATES).forEach(function (n) {
      seed.push({ name: n, flatRate: THERAPIST_FLAT_RATES[n], intakeRate: '', followupRate: '' });
    });
    Object.keys(PSYCHIATRIST_RATES).forEach(function (n) {
      seed.push({ name: n, flatRate: '',
                  intakeRate: PSYCHIATRIST_RATES[n]['אינטייק'],
                  followupRate: PSYCHIATRIST_RATES[n]['מעקב פסיכיאטרי'] });
    });
    _writeAll(sh, THERAPIST_RATES_HEADERS, seed);
    rows = seed;
  }
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var n = String(rows[i].name == null ? '' : rows[i].name).trim();
    if (!n) continue;
    map[n] = {
      flat: parseFloat(rows[i].flatRate),
      intake: parseFloat(rows[i].intakeRate),
      followup: parseFloat(rows[i].followupRate)
    };
  }
  try { CacheService.getScriptCache().put('therapistRates_v1', JSON.stringify(map), 120); } catch (_) {}
  return map;
}

function _therapistPay(therapistName, treatmentType) {
  var name = String(therapistName == null ? '' : therapistName).trim();
  var type = String(treatmentType == null ? '' : treatmentType).trim();
  // 1) Sheet-managed rates (TherapistRates) — the operational source of truth.
  var rates = null;
  try { rates = _loadTherapistRates(); } catch (_) { rates = null; }
  if (rates && _hasOwn(rates, name)) {
    var r = rates[name];
    if (!isNaN(r.flat) && r.flat > 0) return r.flat;
    if (type === 'אינטייק' && !isNaN(r.intake) && r.intake > 0) return r.intake;
    if (type === 'מעקב פסיכיאטרי' && !isNaN(r.followup) && r.followup > 0) return r.followup;
    throw new Error('Therapist "' + name + '" is in TherapistRates but has no usable rate for type "' + type + '"');
  }
  // 2) Fallback: hardcoded seed maps (resilience if the sheet/cache is unavailable).
  if (_hasOwn(THERAPIST_FLAT_RATES, name)) return THERAPIST_FLAT_RATES[name];
  if (_hasOwn(PSYCHIATRIST_RATES, name)) {
    var table = PSYCHIATRIST_RATES[name];
    if (!type || !_hasOwn(table, type)) {
      throw new Error('Psychiatrist "' + name + '" requires a valid treatmentType (אינטייק or מעקב פסיכיאטרי)');
    }
    return table[type];
  }
  // Fail-closed: never invent a pay rate.
  throw new Error('Unknown therapist: "' + name + '" — add a row to the TherapistRates sheet');
}

// Persist one client's creditsOwed without rewriting the whole Clients sheet.
// Locates the row by scanning the id column (like the SessionLog upsert).
// Fail-soft: no-hit (client deleted mid-flight) changes nothing.
// Stamps the row's updatedAt/updatedBy (who/when) alongside the balance —
// `user` is '' for the cross-app recordSessionOutcome receiver.
function _writeCreditsOwed(clientsSh, clientId, balance, user) {
  var idCol = CLIENTS_HEADERS.indexOf('id') + 1;
  var creditCol = CLIENTS_HEADERS.indexOf('creditsOwed') + 1;
  var lastRow = clientsSh.getLastRow();
  if (lastRow < 2 || idCol < 1 || creditCol < 1 || !clientId) return false;
  var ids = clientsSh.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (var r = 0; r < ids.length; r++) {
    if (String(ids[r][0]) === String(clientId)) {
      clientsSh.getRange(r + 2, creditCol).setValue(balance);
      _stampClientRowAt(clientsSh, r + 2, user);
      return true;
    }
  }
  return false;
}

/* Parse a paymentAmountOverrides cell into a plain map. Blank/garbage -> {}. A
 * value that is already an object (defensive) is returned as-is. */
function _parseAmountOverrides(v) {
  if (v == null || v === '') return {};
  if (typeof v === 'object') return v;
  try {
    var o = JSON.parse(String(v));
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {};
  } catch (_) {
    return {};
  }
}

/* Persist ONE manual collection-amount override without rewriting the whole
 * Clients sheet. Locates the client row by scanning the id column (like
 * _writeCreditsOwed / the SessionLog upsert), reads+merges that single JSON cell,
 * and writes it back. amount === null/'' deletes the key (revert to computed).
 * Fail-soft: no-hit (client deleted mid-flight) changes nothing and returns false. */
function _writePaymentAmountOverride(clientsSh, clientId, paymentId, amount, user) {
  var idCol = CLIENTS_HEADERS.indexOf('id') + 1;
  var ovCol = CLIENTS_HEADERS.indexOf('paymentAmountOverrides') + 1;
  var lastRow = clientsSh.getLastRow();
  if (lastRow < 2 || idCol < 1 || ovCol < 1 || !clientId || !paymentId) return false;
  var ids = clientsSh.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (var r = 0; r < ids.length; r++) {
    if (String(ids[r][0]) === String(clientId)) {
      var cell = clientsSh.getRange(r + 2, ovCol);
      var map = _parseAmountOverrides(cell.getValue());
      if (amount === null || amount === undefined || amount === '') {
        delete map[paymentId];
      } else {
        map[paymentId] = Number(amount);
      }
      cell.setValue(Object.keys(map).length ? JSON.stringify(map) : '');
      _stampClientRowAt(clientsSh, r + 2, user); // who/when
      return true;
    }
  }
  return false;
}

function _isDayCenterBilling(billingType) {
  return String(billingType == null ? '' : billingType).trim() === DAY_CENTER_BILLING;
}

/* _billingPrice(billingType, freqPerWeek?) -> price. Mirror of billingPrice():
 * day-center REQUIRES a valid frequency (3/5); flat types return the number;
 * unknown billing type throws. */
function _billingPrice(billingType, freqPerWeek) {
  var key = String(billingType == null ? '' : billingType).trim();
  if (_isDayCenterBilling(key)) {
    if (freqPerWeek === undefined || freqPerWeek === null || freqPerWeek === '') {
      throw new Error('ליווי יומי בקהילה requires frequencyPerWeek (3 or 5)');
    }
    var freq = Number(freqPerWeek);
    if (!_hasOwn(DAY_CENTER_MONTHLY_BY_FREQ, freq)) {
      throw new Error('Unsupported ליווי יומי בקהילה frequency: ' + freqPerWeek + ' (expected 3 or 5)');
    }
    return DAY_CENTER_MONTHLY_BY_FREQ[freq];
  }
  if (!_hasOwn(BILLING_PRICES, key)) {
    throw new Error('Unknown billing type: "' + key + '"');
  }
  return BILLING_PRICES[key];
}

/* ===== Session accounting + credits helpers ================================
 *
 * Monthly model (locked): a patient's paid quota = weekly frequency × 4, renewed
 * in full each month. A `happened` session beyond that month's quota auto-draws a
 * credit when one is available (the session is then free to the patient —
 * clientSessionValue 0 — but the therapist is still paid normally). A
 * therapist_cancelled session grants +1 credit. Credits carry forward across
 * months; the delivered (happened) count is implicitly per-month (we recount the
 * current month each time). creditsOwed lives on the Clients row, server-managed.
 */

/* A non-negative integer credit balance from any cell value (blank -> 0). */
function _toCredits(v) {
  var n = parseInt(v, 10);
  return (isNaN(n) || n < 0) ? 0 : n;
}

/* Weekly session frequency from the client's PLAN. sessionsPerWeek is stored as
 * a JSON breakdown ({"פרטני":2}) — sum the values; a bare number also works.
 * Returns a non-negative integer (0 = undeterminable). */
function _planWeeklyFrequency(client) {
  if (!client) return 0;
  var s = String(client.sessionsPerWeek == null ? '' : client.sessionsPerWeek).trim();
  if (!s) return 0;
  var total = 0;
  if (s.charAt(0) === '{') {
    try {
      var o = JSON.parse(s);
      Object.keys(o).forEach(function (k) { var n = parseInt(o[k], 10); if (!isNaN(n) && n > 0) total += n; });
    } catch (_) { return 0; }
  } else {
    var n = parseInt(s, 10);
    if (!isNaN(n) && n > 0) total = n;
  }
  return total;
}

/* Calendar-month key (YYYY-MM) of a yyyy-MM-dd date string, or '' if absent /
 * unparseable (no month bucket -> quota cannot be applied). */
function _monthKey(dateStr) {
  var s = String(dateStr == null ? '' : dateStr).trim();
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : '';
}

/* Clients data version — the staleness signal (stale-save prevention,
 * 2026-08-30). A script-property integer counter bumped by every Clients
 * rewrite path a stale tab should be told about: _saveAll and
 * _restoreRemovedClient (both under the script lock — callers of these
 * helpers MUST hold it). getData returns the current value; the frontend
 * echoes it back on saveAll; an echo older than current flags the response
 * staleSave:true (the save still proceeds — merge-don't-drop makes it safe).
 * FAIL-OPEN: a payload with no echoed version (old clients) is never flagged.
 * Cell-level writers (creditsOwed, paymentAmountOverrides, …) deliberately do
 * NOT bump: those columns are already preserved by id on every save, so a
 * stale full save can't clobber them. */
var CLIENTS_DATA_VERSION_PROP = 'CLIENTS_DATA_VERSION';

function _readDataVersion() {
  var raw = PropertiesService.getScriptProperties().getProperty(CLIENTS_DATA_VERSION_PROP);
  var n = parseInt(raw, 10);
  return (isNaN(n) || n < 0) ? 0 : n;
}

function _bumpDataVersion() {
  var next = _readDataVersion() + 1;
  PropertiesService.getScriptProperties().setProperty(CLIENTS_DATA_VERSION_PROP, String(next));
  return next;
}

/* Append one tombstone row to "Clients-removed" per client row dropped from
 * (or, for the preserved-log, missing from a stale save of) Clients. `rows`
 * are _readAll(Clients) objects (dates already ISO strings, phones
 * recovered) — the row is preserved exactly as the app reads it, so a
 * restore writes back the same shape _writeAll would.
 * `explicitSet` maps the ids a caller declared as deliberate deletes; every
 * other row is recorded as `viaFallback` — 'saveAll-diff-preserved' for the
 * merge-don't-drop visibility log, defaulting to 'saveAll-diff' (the
 * historical stale-tab clobber signature) when not given.
 * appendRow per row (the לידים שהוסרו pattern); MUST be called under the
 * caller's script lock — this helper takes none of its own. */
function _appendClientTombstones(rows, explicitSet, viaFallback, deletedBy) {
  if (!rows || !rows.length) return 0;
  var fallback = viaFallback || 'saveAll-diff';
  var sh = _ensureSheet('Clients-removed', CLIENTS_REMOVED_HEADERS);
  var now = new Date().toISOString();
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i] || {};
    var id = row.id != null ? String(row.id) : '';
    var via = (explicitSet && explicitSet[id]) ? 'explicit-delete' : fallback;
    // who/when: an explicit ✕ delete overwrites the snapshot's stamps with
    // now + the deleting user (deletedBy, may be blank) so the tombstone
    // answers "who deleted this and when"; preserve-log snapshots keep the
    // row's OWN last-edit stamps untouched.
    var explicit = via === 'explicit-delete';
    sh.appendRow(CLIENTS_REMOVED_HEADERS.map(function (h) {
      if (h === 'removedAt') return now;
      if (h === 'removedVia') return via;
      if (h === 'restoredAt') return '';
      if (explicit && h === 'updatedAt') return now;
      if (explicit && h === 'updatedBy') return String(deletedBy == null ? '' : deletedBy);
      var v = row[h];
      return (v === undefined || v === null) ? '' : v;
    }));
    Logger.log('clientTombstone: id=%s name=%s via=%s', id, String(row.name || ''), via);
  }
  return rows.length;
}

function _saveAll(payload) {
  // Serialize full-sheet rewrites so two overlapping saves can't clobber each
  // other (every other writer already takes this lock). If the lock can't be
  // acquired we return an error rather than writing lock-less — no write path
  // bypasses the lock, and it is always released in finally.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, error: 'Could not acquire lock (another save in progress) — try again' };
  }
  try {
    var leadsSh = _ensureSheet('Leads', LEADS_HEADERS);
    var clientsSh = _ensureSheet('Clients', CLIENTS_HEADERS);
    var leads = (payload && payload.leads) || [];
    var clients = (payload && payload.clients) || [];
    // who/when: the session user the Railway proxy injected from the SIGNED
    // cookie ('' for legacy cookies / the GET fallback). Never client-supplied.
    var user = _requestUser(payload);
    // creditsOwed is SERVER-MANAGED (mutated only by recordSessionOutcome). A
    // dashboard save carries the balance the client tab last loaded, which may be
    // stale — so NEVER trust the payload value: preserve the on-sheet balance by id
    // and only default a brand-new client (no existing row) to its payload/0.
    // paymentAmountOverrides is written one cell at a time by the dedicated
    // savePaymentAmountOverride path. A full-sheet save carries whatever the tab
    // last loaded, which may be stale — so preserve the on-sheet map by id and only
    // let a brand-new client (no existing row) seed from its payload value.
    var existingCredits = {};
    var existingOverrides = {};
    var existingById = {};
    var existing = _readAll(clientsSh, CLIENTS_HEADERS);
    for (var e = 0; e < existing.length; e++) {
      var eid = (existing[e] && existing[e].id != null) ? String(existing[e].id) : '';
      if (eid) {
        existingCredits[eid] = _toCredits(existing[e].creditsOwed);
        existingOverrides[eid] = existing[e].paymentAmountOverrides == null ? '' : existing[e].paymentAmountOverrides;
        existingById[eid] = existing[e];
      }
    }
    var stampedClients = 0;
    for (var i = 0; i < clients.length; i++) {
      _deriveClientServiceType(clients[i]);
      var cid = (clients[i] && clients[i].id != null) ? String(clients[i].id) : '';
      clients[i].creditsOwed = _hasOwn(existingCredits, cid)
        ? existingCredits[cid]
        : _toCredits(clients[i].creditsOwed);
      clients[i].paymentAmountOverrides = _hasOwn(existingOverrides, cid)
        ? existingOverrides[cid]
        : (clients[i].paymentAmountOverrides == null ? '' : clients[i].paymentAmountOverrides);
      // who/when (SERVER-OWNED stamps): compare the row about to be written
      // against its on-sheet row on the non-meta columns. Changed or new ->
      // stamp now + user; an unchanged echo carries the SHEET's stamps.
      // Payload stamps are never trusted in either case.
      var existingRow = cid && _hasOwn(existingById, cid) ? existingById[cid] : null;
      if (_reconcileStamps(_clientDiffCols, clients[i], existingRow, user).length) stampedClients++;
    }
    // Leads: same who/when reconciliation by id (Leads rows already carry ids).
    var existingLeadsById = {};
    var existingLeads = _readAll(leadsSh, LEADS_HEADERS);
    for (var el = 0; el < existingLeads.length; el++) {
      var lid = (existingLeads[el] && existingLeads[el].id != null) ? String(existingLeads[el].id) : '';
      if (lid) existingLeadsById[lid] = existingLeads[el];
    }
    var stampedLeads = 0;
    for (var li = 0; li < leads.length; li++) {
      var lidIn = (leads[li] && leads[li].id != null) ? String(leads[li].id) : '';
      var existingLead = lidIn && _hasOwn(existingLeadsById, lidIn) ? existingLeadsById[lidIn] : null;
      if (_reconcileStamps(_leadDiffCols, leads[li], existingLead, user).length) stampedLeads++;
    }
    // Staleness signal (stale-save prevention): the frontend echoes back the
    // dataVersion it loaded; an echo older than current means another device
    // wrote Clients since this tab loaded. The save still proceeds — merge-
    // don't-drop below makes it safe — but the response carries
    // staleSave:true so the tab can toast + reload. FAIL-OPEN: a payload with
    // no echoed version (old clients) is never flagged.
    var curVersion = _readDataVersion();
    var echoedRaw = payload ? payload.dataVersion : null;
    var echoed = (echoedRaw === undefined || echoedRaw === null || echoedRaw === '') ? NaN : Number(echoedRaw);
    var staleSave = isFinite(echoed) && echoed < curVersion;
    // Row-loss guard + merge-don't-drop (stale-tab clobber): any id currently
    // on the sheet but MISSING from the incoming array would be erased by the
    // clear-and-rewrite below. explicitRemovedIds carries the ids the ✕
    // permanent-delete flow removed on purpose — those are tombstoned
    // 'explicit-delete' and actually dropped, exactly as before. Every OTHER
    // missing id is the stale-tab clobber signature (2026-08-09: a stale
    // tab's save dropped 2 patients): its row is PRESERVED in the rewrite
    // with its current on-sheet values, and logged to Clients-removed as
    // 'saveAll-diff-preserved' for visibility — a log entry, not a removal.
    var incomingIds = {};
    for (var n = 0; n < clients.length; n++) {
      var nid = (clients[n] && clients[n].id != null) ? String(clients[n].id) : '';
      if (nid) incomingIds[nid] = true;
    }
    var explicitSet = {};
    var explicitList = (payload && payload.explicitRemovedIds) || [];
    for (var x = 0; x < explicitList.length; x++) {
      var xid = explicitList[x] == null ? '' : String(explicitList[x]);
      if (xid) explicitSet[xid] = true;
    }
    var explicitDropRows = [];
    var preservedRows = [];
    for (var d = 0; d < existing.length; d++) {
      var did = (existing[d] && existing[d].id != null) ? String(existing[d].id) : '';
      if (did && !incomingIds[did]) {
        if (explicitSet[did]) explicitDropRows.push(existing[d]);
        else preservedRows.push(existing[d]);
      }
    }
    var tombstoned = _appendClientTombstones(explicitDropRows, explicitSet, null, user);
    // Preserved-log dedupe: a tab that stays stale re-sends the same short
    // list on every save. Skip the log row when the NEWEST tombstone for the
    // id is already an open (restoredAt blank) 'saveAll-diff-preserved' —
    // one log entry per stale episode, not one per keystroke.
    var preservedToLog = preservedRows;
    if (preservedRows.length) {
      var tombSh = _ensureSheet('Clients-removed', CLIENTS_REMOVED_HEADERS);
      var tombRows = _readAll(tombSh, CLIENTS_REMOVED_HEADERS);
      var latestTomb = {};
      for (var t = 0; t < tombRows.length; t++) {
        var tIt = (tombRows[t] && tombRows[t].id != null) ? String(tombRows[t].id) : '';
        if (tIt) latestTomb[tIt] = tombRows[t];
      }
      preservedToLog = preservedRows.filter(function (r) {
        var lt = latestTomb[String(r.id)];
        return !(lt && lt.removedVia === 'saveAll-diff-preserved' && !lt.restoredAt);
      });
      tombstoned += _appendClientTombstones(preservedToLog, null, 'saveAll-diff-preserved');
      // Merge: keep the preserved rows in the rewrite, current on-sheet
      // values untouched — the payload never knew them, so the payload
      // cannot rewrite them (their who/when stamps ride along unchanged:
      // a preserved row is never re-stamped).
      for (var p = 0; p < preservedRows.length; p++) clients.push(preservedRows[p]);
    }
    _writeAll(leadsSh, LEADS_HEADERS, leads);
    _writeAll(clientsSh, CLIENTS_HEADERS, clients);
    var newVersion = _bumpDataVersion();
    return {
      ok: true,
      savedLeads: leads.length,
      savedClients: clients.length,
      tombstoned: tombstoned,
      preserved: preservedRows.length,
      staleSave: staleSave,
      dataVersion: newVersion,
      // who/when: rows whose stamps were rewritten by this save (changed or
      // new). Additive — old clients ignore it.
      stamped: { clients: stampedClients, leads: stampedLeads }
    };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ===== Clients-removed tombstones: admin read + restore ====================
 * The recovery surface over the Clients-removed sheet written by
 * _appendClientTombstones. Internal dashboard actions (same trust level as
 * getData / mergeClients — posted same-origin through the Node proxy). */

/* Read every un-restored tombstone (restoredAt blank), in sheet order (oldest
 * first — a row removed twice appears twice; the restore below always picks
 * the LATEST). */
function _getRemovedClients() {
  var sh = _ensureSheet('Clients-removed', CLIENTS_REMOVED_HEADERS);
  var rows = _readAll(sh, CLIENTS_REMOVED_HEADERS);
  var open = [];
  for (var i = 0; i < rows.length; i++) {
    // 'saveAll-diff-preserved' rows are merge-don't-drop LOG entries — the
    // client row is still live on Clients, nothing to restore. Listing them
    // here would show live patients under מטופלים שנמחקו.
    if (!rows[i].restoredAt && rows[i].removedVia !== 'saveAll-diff-preserved') open.push(rows[i]);
  }
  return { ok: true, removed: open };
}

/* Restore ONE tombstoned client by id: copy the client columns of the LATEST
 * un-restored tombstone back to Clients (appendRow) and stamp that
 * tombstone's restoredAt. Guards: a live Clients row with the id →
 * 'already_active' (never a duplicate); no un-restored tombstone →
 * 'not_found'. The row comes back EXACTLY as it was removed — status
 * included. Tombstones stay append-only: restore never deletes or rewrites a
 * tombstone beyond the restoredAt stamp, so the audit trail survives. */
function _restoreRemovedClient(payload) {
  var id = String(payload && payload.id != null ? payload.id : '').trim();
  if (!id) return { ok: false, error: 'missing_id' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, error: 'busy' };
  try {
    var clientsSh = _ensureSheet('Clients', CLIENTS_HEADERS);
    var clients = _readAll(clientsSh, CLIENTS_HEADERS);
    for (var c = 0; c < clients.length; c++) {
      if (String(clients[c].id) === id) return { ok: false, error: 'already_active' };
    }
    var sh = _ensureSheet('Clients-removed', CLIENTS_REMOVED_HEADERS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, error: 'not_found' };
    var vals = sh.getRange(2, 1, lastRow - 1, CLIENTS_REMOVED_HEADERS.length).getValues();
    var idIdx  = CLIENTS_REMOVED_HEADERS.indexOf('id');
    var resIdx = CLIENTS_REMOVED_HEADERS.indexOf('restoredAt');
    // Bottom-up: a row can be removed + restored more than once — the latest
    // un-restored tombstone is the one to bring back.
    var rowIdx = -1;
    for (var r = vals.length - 1; r >= 0; r--) {
      var restored = vals[r][resIdx];
      if (String(vals[r][idIdx]) === id && (restored === '' || restored === null)) { rowIdx = r; break; }
    }
    if (rowIdx === -1) return { ok: false, error: 'not_found' };
    var tomb = {};
    for (var h = 0; h < CLIENTS_REMOVED_HEADERS.length; h++) {
      tomb[CLIENTS_REMOVED_HEADERS[h]] = vals[rowIdx][h];
    }
    // who/when: a restore is a Clients write by the restoring user — stamp the
    // row that comes back (tombstone stamps describe the removal, not this).
    _stampRow(tomb, _requestUser(payload));
    clientsSh.appendRow(CLIENTS_HEADERS.map(function (hh) {
      var v = tomb[hh];
      return (v === undefined || v === null) ? '' : v;
    }));
    sh.getRange(rowIdx + 2, resIdx + 1).setValue(new Date().toISOString());
    // Restore is a Clients write a stale tab should be told about — bump the
    // staleness counter so tabs loaded before the restore get staleSave:true
    // on their next save (still under this function's lock).
    var newVersion = _bumpDataVersion();
    Logger.log('restoreRemovedClient: id=%s name=%s', id, String(tomb.name || ''));
    return { ok: true, restored: true, id: id, name: String(tomb.name || ''), dataVersion: newVersion };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ===== Payments =====
 * id is deterministic (built on the client) so the same monthly /
 * single / bundle bill always upserts into the same row. */
function _getPayments() {
  var sh = _ensureSheet('Payments', PAYMENTS_HEADERS);
  return { ok: true, payments: _readAll(sh, PAYMENTS_HEADERS) };
}

function _upsertPayment(payment) {
  if (!payment || typeof payment !== 'object') {
    return { ok: false, error: 'missing_payment' };
  }
  if (!payment.id) return { ok: false, error: 'missing_id' };
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var sh = _ensureSheet('Payments', PAYMENTS_HEADERS);
    var idIdx = PAYMENTS_HEADERS.indexOf('id');
    var lastRow = sh.getLastRow();
    var row = PAYMENTS_HEADERS.map(function (h) {
      var v = payment[h];
      return (v === undefined || v === null) ? '' : v;
    });
    if (lastRow > 1) {
      var ids = sh.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === String(payment.id)) {
          sh.getRange(i + 2, 1, 1, PAYMENTS_HEADERS.length).setValues([row]);
          return { ok: true, payment: payment, updated: true };
        }
      }
    }
    sh.appendRow(row);
    return { ok: true, payment: payment, created: true };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* Set (or clear) a manual collection-amount override for one open-balance row.
 * Append-only override LAYER on the client row — never touches the package price
 * or a charge source row. Single-cell write under the script lock, consistent
 * with the savePayment / creditsOwed paths. Pass a blank/missing amount to revert
 * a row to its computed amount. */
function _setPaymentAmountOverride(payload) {
  var clientId  = String(payload && payload.clientId  == null ? '' : payload.clientId).trim();
  var paymentId = String(payload && payload.paymentId == null ? '' : payload.paymentId).trim();
  if (!clientId)  return { ok: false, error: 'missing_clientId' };
  if (!paymentId) return { ok: false, error: 'missing_paymentId' };
  var hasAmount = payload && payload.amount !== undefined && payload.amount !== null && payload.amount !== '';
  var amount = hasAmount ? Number(payload.amount) : null;
  if (hasAmount && (!isFinite(amount) || amount < 0)) return { ok: false, error: 'invalid_amount' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'busy' };
  try {
    var sh = _ensureSheet('Clients', CLIENTS_HEADERS);
    var ok = _writePaymentAmountOverride(sh, clientId, paymentId, amount, _requestUser(payload));
    return ok ? { ok: true } : { ok: false, error: 'client_not_found' };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ===== One-off stale nextBillingDate repair (2026-09-01) =====================
 *
 * Many active clients' monthly payments were recorded with the card chip
 * (setCurrentMonthPaid in public/app.js), which writes the month's Payments row
 * but never advances Clients.nextBillingDate — only חידוש ותשלום advances it.
 * On the 1st of the month renewalInfo() sees no current-month row plus a past
 * stored date, and every such card turns red 🛑 עצור טיפול. Nothing in the
 * sheet is corrupted; the dates were simply never advanced.
 *
 * Planning is PURE (_planStaleNextBillingRepair over _readAll snapshots, dates
 * already ISO strings so plain string comparison orders them). Writes are
 * single-cell setValue of nextBillingDate only — the _writeCreditsOwed /
 * _writePaymentAmountOverride pattern, NEVER _writeAll — under LockService.
 * Dry-run by default; apply === '1' writes. Run from the editor via
 * previewStaleNextBillingRepairNow / applyStaleNextBillingRepairNow. */

/* 'yyyy-MM-dd' for (year, month 1-12, day), day clamped to the month's last
 * day — the same clamp currentMonthBaseDueDate applies in public/app.js. */
function _clampDayIso(y, m, day) {
  var last = new Date(y, m, 0).getDate();
  var d = day > last ? last : day;
  return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
}

/* Pure: the client's next cycle due date ON OR AFTER todayIso ('yyyy-MM-dd').
 * Billing day = numeric cl.billingDay, else day-of-month of cl.startDate;
 * neither -> ''. Candidate = that day in todayIso's month, clamped to the
 * month's last day; a candidate before todayIso rolls to the same day next
 * month (clamped again). Mirrors the anchor precedence of currentMonthBaseDueDate
 * / clientsDueOn in public/app.js — keep the billing-day rule in sync. */
function _nextCycleDueDate(cl, todayIso) {
  var bd = null;
  var raw = cl && cl.billingDay;
  if (raw !== '' && raw != null && isFinite(Number(raw)) && Number(raw) >= 1) {
    bd = Math.floor(Number(raw));
  }
  if (!bd) {
    var sd = String((cl && cl.startDate) || '').slice(0, 10).split('-');
    if (sd.length === 3) {
      var d = parseInt(sd[2], 10);
      if (isFinite(d) && d >= 1) bd = d;
    }
  }
  if (!bd) return '';
  var t = String(todayIso || '').slice(0, 10).split('-');
  var y = parseInt(t[0], 10);
  var m = parseInt(t[1], 10);
  if (!isFinite(y) || !isFinite(m)) return '';
  var candidate = _clampDayIso(y, m, bd);
  if (candidate < todayIso) {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    candidate = _clampDayIso(y, m, bd);
  }
  return candidate;
}

/* 'yyyy-MM' of the month before todayIso's month. */
function _prevMonthKey(todayIso) {
  var t = String(todayIso || '').slice(0, 10).split('-');
  var y = parseInt(t[0], 10);
  var m = parseInt(t[1], 10);
  if (!isFinite(y) || !isFinite(m)) return '';
  m -= 1;
  if (m < 1) { m = 12; y -= 1; }
  return y + '-' + ('0' + m).slice(-2);
}

/* An explicitly unpaid/partial payment status (English or Hebrew), i.e. a row
 * that EXISTS and says the money did not fully arrive. */
function _isUnpaidishStatus(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === 'unpaid' || s === 'partial' || s === 'לא שולם' || s === 'שולם חלקית';
}

/* Pure: classify every active client whose stored nextBillingDate is stale
 * (non-blank and < todayIso) into one of three buckets:
 *   fix            — { id, name, from, to: _nextCycleDueDate(...) }
 *   skippedOverdue — has an unpaid/partial BASE row due in the previous month
 *                    (really is overdue — leave the red banner alone)
 *   skippedNoAnchor— no billingDay and no startDate day to anchor a cycle on
 * Clients that are discharged (סיים טיפול), deactivated (לא פעיל), blank, or
 * already future-dated are untouched. Extra-charge rows (::chg-) never count
 * as overdue here — only the base monthly package row does. */
function _planStaleNextBillingRepair(clients, payments, todayIso) {
  var prevMk = _prevMonthKey(todayIso);
  var overdueByClient = {};
  (payments || []).forEach(function (p) {
    if (!p || !_isUnpaidishStatus(p.status)) return;
    if (/::chg-/.test(String(p.id || ''))) return; // extra charge, not the base package
    if (String(p.dueDate || '').slice(0, 7) !== prevMk) return;
    var cid = String(p.clientId == null ? '' : p.clientId);
    if (cid) overdueByClient[cid] = true;
  });
  var fix = [];
  var skippedOverdue = [];
  var skippedNoAnchor = [];
  (clients || []).forEach(function (cl) {
    if (!cl) return;
    if (cl.status === 'סיים טיפול' || cl.status === DEACTIVATED_CLIENT_STATUS_HE) return;
    var from = String(cl.nextBillingDate || '').slice(0, 10);
    if (!from || from >= todayIso) return; // blank or not stale
    var entry = { id: cl.id, name: cl.name || '', from: from };
    if (overdueByClient[String(cl.id)]) { skippedOverdue.push(entry); return; }
    var to = _nextCycleDueDate(cl, todayIso);
    if (!to) { skippedNoAnchor.push(entry); return; }
    if (to === from) return; // nothing to change
    entry.to = to;
    fix.push(entry);
  });
  return { fix: fix, skippedOverdue: skippedOverdue, skippedNoAnchor: skippedNoAnchor };
}

/* Persist one client's nextBillingDate without rewriting the whole Clients
 * sheet. Locates the row by scanning the id column (the _writeCreditsOwed
 * pattern). Fail-soft: no-hit (client deleted mid-flight) changes nothing. */
function _writeNextBillingDate(clientsSh, clientId, isoDate, user) {
  var idCol = CLIENTS_HEADERS.indexOf('id') + 1;
  var nbdCol = CLIENTS_HEADERS.indexOf('nextBillingDate') + 1;
  var lastRow = clientsSh.getLastRow();
  if (lastRow < 2 || idCol < 1 || nbdCol < 1 || !clientId) return false;
  var ids = clientsSh.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (var r = 0; r < ids.length; r++) {
    if (String(ids[r][0]) === String(clientId)) {
      clientsSh.getRange(r + 2, nbdCol).setValue(isoDate);
      _stampClientRowAt(clientsSh, r + 2, user); // who/when
      return true;
    }
  }
  return false;
}

/* One-off repair. INTERNAL (same trust level as savePayment / mergeClients —
 * posted same-origin through the Node proxy; no cross-app secret). Dry-run by
 * default returns the plan and writes NOTHING; apply === '1' single-cell-writes
 * nextBillingDate for each fix row under the script lock. todayIso is
 * overridable for testing; defaults to today in the project timezone. */
function _repairStaleNextBilling(apply, todayIso, user) {
  var doApply = apply === '1' || apply === 1 || apply === true;
  var t = String(todayIso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    t = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Jerusalem', 'yyyy-MM-dd');
  }
  var lock = null;
  if (doApply) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return { ok: false, error: 'busy' };
  }
  try {
    var clientsSh = _ensureSheet('Clients', CLIENTS_HEADERS);
    var paymentsSh = _ensureSheet('Payments', PAYMENTS_HEADERS);
    var plan = _planStaleNextBillingRepair(
      _readAll(clientsSh, CLIENTS_HEADERS),
      _readAll(paymentsSh, PAYMENTS_HEADERS),
      t
    );
    if (!doApply) {
      return { ok: true, dryRun: true, today: t, applied: 0, plan: plan };
    }
    var applied = 0;
    plan.fix.forEach(function (f) {
      if (_writeNextBillingDate(clientsSh, f.id, f.to, user)) {
        applied++;
        Logger.log('repairStaleNextBilling: ' + f.id + ' (' + f.name + ') ' + f.from + ' -> ' + f.to);
      } else {
        Logger.log('repairStaleNextBilling: MISS ' + f.id + ' (' + f.name + ') — row not found, nothing written');
      }
    });
    return { ok: true, dryRun: false, today: t, applied: applied, plan: plan };
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (_) {} }
  }
}

/* Editor helper: log the repair plan. Writes NOTHING. */
function previewStaleNextBillingRepairNow() {
  var res = _repairStaleNextBilling('0');
  Logger.log('repairStaleNextBilling DRY-RUN (today=' + res.today + '): fix=' +
    res.plan.fix.length + ' skippedOverdue=' + res.plan.skippedOverdue.length +
    ' skippedNoAnchor=' + res.plan.skippedNoAnchor.length);
  Logger.log(JSON.stringify(res.plan, null, 2));
  return res;
}

/* Editor helper: APPLY the repair. Logs the plan before, each write (inside
 * _repairStaleNextBilling), and the applied count after. */
function applyStaleNextBillingRepairNow() {
  var before = _repairStaleNextBilling('0');
  Logger.log('BEFORE (plan, today=' + before.today + '): ' + JSON.stringify(before.plan, null, 2));
  var res = _repairStaleNextBilling('1');
  Logger.log('AFTER: applied=' + res.applied + ' of ' + res.plan.fix.length + ' planned');
  return res;
}

/* ===== Client charges ===== */
function _getCharges() {
  var sh = _ensureSheet('ClientCharges', CHARGES_HEADERS);
  return { ok: true, charges: _readAll(sh, CHARGES_HEADERS) };
}

function _upsertCharge(charge) {
  if (!charge || typeof charge !== 'object') {
    return { ok: false, error: 'missing_charge' };
  }
  if (!charge.id) return { ok: false, error: 'missing_id' };
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    var sh = _ensureSheet('ClientCharges', CHARGES_HEADERS);
    var idIdx = CHARGES_HEADERS.indexOf('id');
    var lastRow = sh.getLastRow();
    var row = CHARGES_HEADERS.map(function (h) {
      var v = charge[h];
      return (v === undefined || v === null) ? '' : v;
    });
    if (lastRow > 1) {
      var ids = sh.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === String(charge.id)) {
          sh.getRange(i + 2, 1, 1, CHARGES_HEADERS.length).setValues([row]);
          return { ok: true, charge: charge, updated: true };
        }
      }
    }
    sh.appendRow(row);
    return { ok: true, charge: charge, created: true };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function _removeCharge(chargeId) {
  if (!chargeId) return { ok: false, error: 'missing_id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('ClientCharges', CHARGES_HEADERS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, error: 'not_found' };
    var idIdx = CHARGES_HEADERS.indexOf('id');
    var ids = sh.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(chargeId)) {
        sh.deleteRow(i + 2);
        return { ok: true, removed: true, id: chargeId };
      }
    }
    return { ok: false, error: 'not_found' };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// Bulk-delete every ClientCharges row belonging to a deleted patient. Called
// from the dashboard's patient-delete flow so charge rows never outlive their
// patient as orphans. Safe and idempotent: a clientId with no rows returns
// { ok:true, removed:0 }. Deletes bottom-up so row indices stay valid, and
// logs each removed row for an audit trail in the Apps Script execution log.
function _removeChargesForClient(clientId) {
  var cid = String(clientId == null ? '' : clientId).trim();
  if (!cid) return { ok: false, error: 'missing_clientId' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('ClientCharges', CHARGES_HEADERS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: true, removed: 0, clientId: cid };
    var cidIdx = CHARGES_HEADERS.indexOf('clientId');
    var idIdx  = CHARGES_HEADERS.indexOf('id');
    var rows = sh.getRange(2, 1, lastRow - 1, CHARGES_HEADERS.length).getValues();
    var removed = 0;
    // Iterate bottom-up: deleting a lower row never shifts a higher index.
    for (var i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][cidIdx]).trim() === cid) {
        Logger.log('removeChargesForClient: clientId=%s chargeId=%s', cid, String(rows[i][idIdx]));
        sh.deleteRow(i + 2);
        removed++;
      }
    }
    return { ok: true, removed: removed, clientId: cid };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// Bulk-delete every Payments row belonging to a deleted patient. Mirrors
// _removeChargesForClient exactly: called from the dashboard's patient-delete
// flow so payment rows never outlive their patient as orphans — and, unlike
// the old client-side per-row loop, it works off the SHEET, so it removes
// every row even when the deleting browser never managed to load payments.
// Safe and idempotent: a clientId with no rows returns { ok:true, removed:0 }.
// Deletes bottom-up so row indices stay valid, and logs each removed row for
// an audit trail in the Apps Script execution log.
function _removePaymentsForClient(clientId) {
  var cid = String(clientId == null ? '' : clientId).trim();
  if (!cid) return { ok: false, error: 'missing_clientId' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('Payments', PAYMENTS_HEADERS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: true, removed: 0, clientId: cid };
    var cidIdx = PAYMENTS_HEADERS.indexOf('clientId');
    var idIdx  = PAYMENTS_HEADERS.indexOf('id');
    var rows = sh.getRange(2, 1, lastRow - 1, PAYMENTS_HEADERS.length).getValues();
    var removed = 0;
    // Iterate bottom-up: deleting a lower row never shifts a higher index.
    for (var i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][cidIdx]).trim() === cid) {
        Logger.log('removePaymentsForClient: clientId=%s paymentId=%s', cid, String(rows[i][idIdx]));
        sh.deleteRow(i + 2);
        removed++;
      }
    }
    return { ok: true, removed: removed, clientId: cid };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function _removePayment(paymentId) {
  if (!paymentId) return { ok: false, error: 'missing_id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('Payments', PAYMENTS_HEADERS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, error: 'not_found' };
    var idIdx = PAYMENTS_HEADERS.indexOf('id');
    var ids = sh.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(paymentId)) {
        sh.deleteRow(i + 2);
        return { ok: true, removed: true, id: paymentId };
      }
    }
    return { ok: false, error: 'not_found' };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function _removeLead(lead, user) {
  if (!lead || typeof lead !== 'object') return { ok: false, error: 'missing_lead' };
  if (!lead.id) return { ok: false, error: 'missing_id' };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = _ss();
    var sheet = ss.getSheetByName('Leads');
    if (!sheet) return { ok: false, error: 'not_found' };

    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { ok: false, error: 'not_found' };
    var headers = data[0];
    var idCol = headers.indexOf('id');
    if (idCol === -1) return { ok: false, error: 'not_found' };

    var rowIndex = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === String(lead.id)) {
        rowIndex = i;
        break;
      }
    }
    if (rowIndex === -1) return { ok: false, error: 'not_found' };

    var sourceRow = data[rowIndex];
    var rowObj = {};
    for (var j = 0; j < headers.length; j++) {
      rowObj[headers[j]] = sourceRow[j];
    }
    rowObj.removedAt = new Date().toISOString();
    rowObj.originSheet = 'Leads';
    // who/when: the tombstone records the REMOVER (now + session user), not
    // the row's last-edit stamps — the recovery copy answers "who removed it".
    _stampRow(rowObj, user);

    var removedSheet = _ensureSheet('לידים שהוסרו', REMOVED_LEADS_HEADERS);
    var newRow = REMOVED_LEADS_HEADERS.map(function(h) {
      return rowObj[h] !== undefined ? rowObj[h] : '';
    });
    removedSheet.appendRow(newRow);

    sheet.deleteRow(rowIndex + 1);

    return { ok: true, lead: lead, removed: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    lock.releaseLock();
  }
}

/* ===== Settings ===== */
function _getSettings() {
  var sh = _ensureSheet('Settings', SETTINGS_HEADERS);
  var rows = _readAll(sh, SETTINGS_HEADERS);
  var settings = {};
  rows.forEach(function (r) {
    if (r.key) settings[r.key] = r.value || '';
  });
  return { ok: true, settings: settings };
}

function _saveSettings(settings) {
  var sh = _ensureSheet('Settings', SETTINGS_HEADERS);
  var rows = [];
  if (settings && typeof settings === 'object') {
    Object.keys(settings).forEach(function (k) {
      rows.push({ key: k, value: settings[k] == null ? '' : String(settings[k]) });
    });
  }
  _writeAll(sh, SETTINGS_HEADERS, rows);
  return { ok: true };
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ===== Win-back source (read-only cross-app endpoint) =====
 *
 * Consumed by the E-Zone-Dashboard win-back call list.
 *
 * Returns only the two projections the dashboard is allowed to see:
 *   lostLeads:         rows from Leads where stage === 'לא רלוונטי'
 *   dischargedClients: rows from Clients where status === 'סיים טיפול'
 *
 * Each row is projected to exactly the columns the dashboard renders.
 * Fields like pricePerSession, paymentLink, payerPhone, bundle*, etc.
 * are deliberately NOT included — the dashboard never receives billing
 * or payer data even though it lives in the same sheet.
 *
 * Auth: optional shared secret. If a Script Property named
 * 'WINBACK_SECRET' exists, the request must pass ?secret=<value> that
 * matches. If the property is absent the endpoint is open (URL-only
 * obscurity — same security level as every other action on this script).
 */
var LOST_LEAD_STAGE_HE = 'לא רלוונטי';
var DISCHARGED_CLIENT_STATUS_HE = 'סיים טיפול';

/* Cross-app deactivation status (task: deactivateClient receiver). When the
 * E-Zone Therapists app deletes a patient there, it POSTs deactivateClient and
 * this receiver sets the matching outpatient Client's `status` to this value —
 * a soft, reversible deactivation (the row, billing and session history are
 * kept). It is DISTINCT from `סיים טיפול` (Vered's manual discharge): a
 * discharged client still flows through getDebtStatus (debt survives discharge)
 * and the win-back list, whereas a cross-app-deactivated client is EXCLUDED from
 * both getTreatmentPlans and getDebtStatus so it leaves the therapists roster
 * union (which unions those two as base sources). Currently unused elsewhere. */
var DEACTIVATED_CLIENT_STATUS_HE = 'לא פעיל';

function _winbackAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('WINBACK_SECRET');
  if (!expected) return true; // not configured → open
  var got = (params && params.secret) ? String(params.secret) : '';
  return got === expected;
}

function _getWinbackSource() {
  var leadsSh   = _ensureSheet('Leads',   LEADS_HEADERS);
  var clientsSh = _ensureSheet('Clients', CLIENTS_HEADERS);
  var leads     = _readAll(leadsSh,   LEADS_HEADERS);
  var clients   = _readAll(clientsSh, CLIENTS_HEADERS);

  var lostLeads = [];
  for (var i = 0; i < leads.length; i++) {
    var l = leads[i];
    if (l.stage !== LOST_LEAD_STAGE_HE) continue;
    lostLeads.push({
      sourceApp:       'ezone-outpatient',
      sourceId:        l.id,
      name:            l.name           || '',
      phone:           l.phone          || '',
      originalService: l.serviceType    || '',
      location:        l.location       || '',
      reasonLeft:      l.note           || '',  // best-available proxy
      dateLeft:        l.created        || '',  // best-available proxy
      kind:            'lost_lead'
    });
  }

  var dischargedClients = [];
  for (var j = 0; j < clients.length; j++) {
    var c = clients[j];
    if (c.status !== DISCHARGED_CLIENT_STATUS_HE) continue;
    dischargedClients.push({
      sourceApp:       'ezone-outpatient',
      sourceId:        c.id,
      name:            c.name           || '',
      phone:           c.phone          || '',
      originalService: c.serviceType    || '',
      location:        c.location       || '',
      reasonLeft:      c.notes          || '',  // best-available proxy
      dateLeft:        c.exitDate       || '',
      kind:            'discharged'
    });
  }

  return { ok: true, lostLeads: lostLeads, dischargedClients: dischargedClients };
}

/* ===== Debt status (read-only cross-app endpoint) =====
 *
 * Consumed by the E-Zone Therapists app to gate patient intake on outpatient
 * debt. Returns EVERY client with a tri-state debt status, so the consumer can
 * tell "confirmed no debt" apart from "couldn't determine":
 *   clientId, name, phone (canonical patient phone), debtStatus, amountOwed
 *
 * Never-fail-open: three outcomes, not two.
 *   - has payment rows, open balance > 0 -> 'debt'    (consumer: block+approval)
 *   - has payment rows, nothing owing     -> 'clear'   (consumer: allow)
 *   - ZERO payment rows                   -> 'unknown' (consumer: FLAG — no data
 *                                                       is NOT proof of payment)
 * The consumer adds: phone matches no client -> flag; matches >1 -> flag.
 *
 * Matching contract: the consumer matches on NAME + the canonical patient
 * phone (the `phone` column, falling back to `treatmentContactPhone`, leading-
 * zero recovered). payerPhone, paymentLink, prices, bundle* and every other
 * billing/payer field are deliberately NOT included.
 *
 * Per-row rule (lockstep with public/debt-status.js and billing-status.js):
 * for a row that EXISTS, owed = (status paid or blank) ? 0 :
 * max(0, amountDue - amountPaid). "Don't assume paid" applies at the CLIENT
 * level (zero rows = 'unknown'), not by reinterpreting an existing blank row.
 * Included regardless of client status (debt survives discharge).
 *
 * Auth: optional shared secret, same model as getWinbackSource. If a Script
 * Property named 'DEBT_STATUS_SECRET' exists, the request must pass
 * ?secret=<value> that matches. If the property is absent the endpoint is open
 * (URL-only obscurity — same level as every other action on this script).
 */
function _debtAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('DEBT_STATUS_SECRET');
  if (!expected) return true; // not configured → open
  var got = (params && params.secret) ? String(params.secret) : '';
  return got === expected;
}

var DEBT_PAYMENT_STATUS_ALIASES = {
  'שולם': 'paid', 'paid': 'paid',
  'שולם חלקית': 'partial', 'partial': 'partial',
  'לא שולם': 'unpaid', 'unpaid': 'unpaid'
};

function _resolvePaymentStatus(v) {
  var raw = String(v == null ? '' : v).trim();
  if (!raw) return '';
  return DEBT_PAYMENT_STATUS_ALIASES[raw] ||
         DEBT_PAYMENT_STATUS_ALIASES[raw.toLowerCase()] || '';
}

function _rowOwed(row) {
  if (!row) return 0;
  var status = _resolvePaymentStatus(row.status);
  if (status === 'paid' || status === '') return 0;
  var due = Number(row.amountDue); if (!isFinite(due)) due = 0;
  var paid = Number(row.amountPaid); if (!isFinite(paid)) paid = 0;
  var owed = due - paid;
  return owed > 0 ? owed : 0;
}

function _getDebtStatus() {
  var clientsSh  = _ensureSheet('Clients',  CLIENTS_HEADERS);
  var paymentsSh = _ensureSheet('Payments', PAYMENTS_HEADERS);
  var clients    = _readAll(clientsSh,  CLIENTS_HEADERS);
  var payments   = _readAll(paymentsSh, PAYMENTS_HEADERS);

  var byClient = {};
  for (var i = 0; i < payments.length; i++) {
    var p = payments[i];
    var cid = (p && p.clientId != null) ? String(p.clientId) : '';
    if (!cid) continue;
    (byClient[cid] = byClient[cid] || []).push(p);
  }

  var out = [];
  for (var c = 0; c < clients.length; c++) {
    var cl = clients[c];
    var id = (cl && cl.id != null) ? String(cl.id) : '';
    if (!id) continue;
    // Cross-app-deactivated clients (deleted in the therapists app) are dropped
    // from the roster union — they must not be re-added via this base source.
    // NOTE: discharged (`סיים טיפול`) clients are still INCLUDED here; debt
    // survives discharge. Only the explicit deactivation status is excluded.
    if (cl.status === DEACTIVATED_CLIENT_STATUS_HE) continue;
    var rows = byClient[id] || [];
    var debtStatus, amountOwed;
    if (rows.length === 0) {
      debtStatus = 'unknown'; amountOwed = 0; // no billing record → flag
    } else {
      var sum = 0;
      for (var r = 0; r < rows.length; r++) sum += _rowOwed(rows[r]);
      sum = Math.round(sum * 100) / 100;
      debtStatus = sum > 0 ? 'debt' : 'clear';
      amountOwed = sum > 0 ? sum : 0;
    }
    out.push({
      sourceApp:  'ezone-outpatient',
      clientId:   id,
      name:       cl.name || '',
      phone:      _recoverPhone(cl.phone) || _recoverPhone(cl.treatmentContactPhone),
      debtStatus: debtStatus,
      amountOwed: amountOwed
    });
  }

  return { ok: true, clients: out };
}

/* ===== Treatment plans (read-only cross-app endpoint) =====
 *
 * Consumed by E-Zone Therapists to show each outpatient's treatment plan.
 * Minimal projection: clientId, name, phone (treatmentContactPhone),
 * serviceType, sessions (sessionsPerWeek), status, startDate, exitDate,
 * renewalDate (date only). NO billing/payer data.
 *
 * Auth: optional shared secret 'TREATMENT_PLANS_SECRET', same model as
 * getWinbackSource / getDebtStatus.
 */
function _treatmentPlansAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('TREATMENT_PLANS_SECRET');
  if (!expected) return true; // not configured -> open
  var got = (params && params.secret) ? String(params.secret) : '';
  return got === expected;
}

/* Add 1 calendar month to a 'yyyy-MM-dd' ISO date string, clamping to the last
 * day of the target month (Jan 31 + 1mo -> Feb 28). SAME clamp rule as addMonth
 * in public/charges-logic.js / public/app.js — keep in sync. */
function _addMonthIso(isoDate) {
  if (!isoDate) return '';
  var d = new Date(isoDate);
  if (isNaN(d)) return '';
  var origDay = d.getDate();
  d.setMonth(d.getMonth() + 1);
  if (d.getDate() !== origDay) d.setDate(0);
  return d.getFullYear() +
    '-' + ('0' + (d.getMonth() + 1)).slice(-2) +
    '-' + ('0' + d.getDate()).slice(-2);
}

/* Renewal/package-end due date for a client: the stored nextBillingDate, else
 * anchor (packageChangeDate → paymentDate → startDate) + 1 month, '' when no
 * anchor. Mirrors nextRenewalDueDate in public/app.js / public/charges-logic.js
 * — keep in sync. */
function _renewalDueDate(cl) {
  if (!cl) return '';
  if (cl.nextBillingDate) return cl.nextBillingDate;
  var anchor = cl.packageChangeDate || cl.paymentDate || cl.startDate || '';
  if (!anchor) return '';
  return _addMonthIso(anchor);
}

function _getTreatmentPlans() {
  var clientsSh = _ensureSheet('Clients', CLIENTS_HEADERS);
  var clients   = _readAll(clientsSh, CLIENTS_HEADERS);
  var out = [];
  for (var c = 0; c < clients.length; c++) {
    var cl = clients[c];
    var id = (cl && cl.id != null) ? String(cl.id) : '';
    if (!id) continue;
    // Cross-app-deactivated clients (deleted in the therapists app) leave the
    // roster — exclude them so the therapists roster union does not re-add them.
    if (cl.status === DEACTIVATED_CLIENT_STATUS_HE) continue;
    // Cross-app join key for the therapists app — must be the populated
    // canonical patient phone. The patient number lives in the `phone` column
    // (added in the stop-flow work); the legacy `treatmentContactPhone` column
    // is empty for every live client, so projecting it returned "phone":"" for
    // all. Prefer `phone`, fall back to `treatmentContactPhone`, and recover the
    // leading zero either way so consumers get the canonical 10-digit form.
    var phone = _recoverPhone(cl.phone) || _recoverPhone(cl.treatmentContactPhone);
    out.push({
      sourceApp:   'ezone-outpatient',
      clientId:    id,
      name:        cl.name || '',
      phone:       phone,
      serviceType: cl.serviceType || '',
      sessions:    cl.sessionsPerWeek || '',
      status:      cl.status || '',
      // Treatment period for the therapists app's patient card. Both columns
      // already exist on Clients and are read by _readAll (a Date cell comes back
      // as a 'yyyy-MM-dd' string); exitDate is blank for still-active patients.
      // No payer/billing data — the minimal-projection contract is unchanged.
      startDate:   cl.startDate || '',
      exitDate:    cl.exitDate || '',
      // Renewal/package-end date for the therapists app's "renew next week" alert.
      // SAME value the גבייה הבאה chip shows: stored nextBillingDate, else anchor
      // (packageChangeDate → paymentDate → startDate) + 1 month. Mirrors
      // nextRenewalDueDate in public/app.js / public/charges-logic.js — keep in sync.
      // Date only ('yyyy-MM-dd' or ''); no billing/payment data crosses here.
      renewalDate: _renewalDueDate(cl)
    });
  }
  return { ok: true, clients: out };
}

/* ===== Stop-treatment flags =====
 *
 * Inbound: the E-Zone Therapists app POSTs { action:'flagStop', secret, phone,
 * name, reportedBy?, note? } directly to this /exec. FAIL-CLOSED auth: the
 * shared secret 'STOP_FLAG_SECRET' Script Property MUST exist and match — unlike
 * the read endpoints, an unset secret REJECTS (this is an external write).
 *
 * _flagStop validates input, normalizes the phone to canonical leading-zero
 * (reusing _recoverPhone), tries to match an existing client by normalized phone
 * (vs client.phone OR treatmentContactPhone) + exact trimmed name to fill
 * clientId, and appends ONE row with status='pending'. Clients is never touched.
 *
 * getStopFlags / resolveStopFlag(id) are INTERNAL (Vered's dashboard via the Node
 * proxy) — open, same trust level as getData/saveAll. resolveStopFlag(id) marks a
 * flag resolved when Vered completes the discharge; it does not discharge.
 *
 * resolveStopFlag can ALSO be called by the therapists app as a SECURED receiver
 * — { action:'resolveStopFlag', secret, phone } (fail-closed, reuses
 * STOP_FLAG_SECRET) clears the StopFlags row(s) for a canonical phone by phone
 * ALONE (no Clients join), so it resolves orphaned flags too. doPost routes by
 * the presence of `secret`; see _resolveStopFlagByPhone.
 */
function _stopFlagAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('STOP_FLAG_SECRET');
  if (!expected) return false; // fail-closed: not configured -> reject
  var got = (params && params.secret != null) ? String(params.secret) : '';
  return got !== '' && got === expected;
}

function _matchStopFlagClient(clients, phone, name) {
  if (!phone) return '';
  var nm = String(name == null ? '' : name).trim();
  // A phone match alone is sufficient — match the reported phone against ANY of
  // the client's phone fields (patient phone / treatment-contact / payer). Name
  // is only a soft tiebreaker when more than one client shares the phone, never
  // a hard gate (Hebrew names drift on spacing/RTL/spelling). 0 or still-
  // ambiguous → leave clientId empty and let the dashboard panel resolve/ask.
  var hits = [];
  for (var i = 0; i < clients.length; i++) {
    var c = clients[i];
    if (_recoverPhone(c.phone) === phone ||
        _recoverPhone(c.treatmentContactPhone) === phone ||
        _recoverPhone(c.payerPhone) === phone) {
      hits.push(c);
    }
  }
  if (hits.length === 1) return String(hits[0].id);
  if (hits.length > 1 && nm) {
    var narrowed = hits.filter(function (c) {
      return String(c.name == null ? '' : c.name).trim() === nm;
    });
    if (narrowed.length === 1) return String(narrowed[0].id);
  }
  return '';
}

function _flagStop(payload) {
  var phone = _recoverPhone(payload && payload.phone);
  var name = String((payload && payload.name) || '').trim();
  if (!phone || !/^0\d{8,9}$/.test(phone)) return { ok: false, error: 'invalid_phone' };
  if (!name) return { ok: false, error: 'missing_name' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('StopFlags', STOP_FLAGS_HEADERS);
    var clients = _readAll(_ensureSheet('Clients', CLIENTS_HEADERS), CLIENTS_HEADERS);
    var flag = {
      id: Utilities.getUuid(),
      phone: phone,
      name: name,
      clientId: _matchStopFlagClient(clients, phone, name),
      reportedBy: String((payload && payload.reportedBy) || '').trim(),
      reportedAt: new Date().toISOString(),
      note: String((payload && payload.note) || '').trim().slice(0, 1000),
      status: 'pending',
      resolvedBy: '',
      resolvedAt: ''
    };
    sh.appendRow(STOP_FLAGS_HEADERS.map(function (h) {
      return flag[h] == null ? '' : flag[h];
    }));
    return { ok: true, flag: flag };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function _getStopFlags() {
  var sh = _ensureSheet('StopFlags', STOP_FLAGS_HEADERS);
  return { ok: true, stopFlags: _readAll(sh, STOP_FLAGS_HEADERS) };
}

/* Read-only SessionLog projection for the internal therapist-payout view (read
 * step 1 of 4). Returns every reconciliation row written by recordSessionOutcome.
 * Open, same trust level as getStopFlags / getPayments (an internal dashboard
 * read, NOT a cross-app endpoint). The dashboard computes the monthly per-
 * therapist payout client-side from these rows; this endpoint never writes. */
function _getSessionLog() {
  var sh = _ensureSheet('SessionLog', SESSION_LOG_HEADERS);
  return { ok: true, sessionLog: _readAll(sh, SESSION_LOG_HEADERS) };
}

/* ===== Set clinical treatment type (secured cross-app write) =====
 *
 * Inbound: the E-Zone Therapists app POSTs { action:'setClinicalType', secret,
 * phone, clinicalTreatmentType } directly to this /exec. FAIL-CLOSED auth: the
 * shared secret 'CLINICAL_TYPE_SECRET' Script Property MUST exist and match —
 * same model as flagStop, NOT the fail-open read pattern. An unset/empty/wrong
 * secret REJECTS (this is an external write to Clients).
 *
 * Behaviour (never fail-open, never guess):
 *   single phone match   -> set that client's clinicalTreatmentType, derive +
 *                           overwrite serviceType via the SAME _clinicalToBilling
 *                           / _deriveClientServiceType used on save, write the
 *                           row, return { ok:true, matched:1 }.
 *   no match             -> { ok:false, reason:'no_match' },    write nothing.
 *   multiple matches     -> { ok:false, reason:'multi_match' }, write nothing.
 *   unknown clinical type-> { ok:false, reason:'unknown_type' },write nothing.
 *
 * Only the two fields (clinicalTreatmentType + derived serviceType) change on the
 * matched row; every other cell is written back exactly as read. _writeAll maps
 * positionally so the full Clients array is rewritten — untouched rows are
 * byte-identical, preserving the append-only column layout.
 */
function _clinicalTypeAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('CLINICAL_TYPE_SECRET');
  if (!expected) return false; // fail-closed: not configured -> reject
  var got = (params && params.secret != null) ? String(params.secret) : '';
  return got !== '' && got === expected;
}

function _setClinicalType(payload) {
  var phone = _recoverPhone(payload && payload.phone);
  if (!phone || !/^0\d{8,9}$/.test(phone)) return { ok: false, reason: 'invalid_phone' };

  var clinical = String((payload && payload.clinicalTreatmentType) || '').trim();
  if (!clinical) return { ok: false, reason: 'unknown_type' };
  // Validate against the SAME map used on save — reject (write nothing) before
  // touching the sheet rather than letting the derive throw mid-write.
  if (!Object.prototype.hasOwnProperty.call(CLINICAL_TO_BILLING, clinical)) {
    return { ok: false, reason: 'unknown_type' };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('Clients', CLIENTS_HEADERS);
    var clients = _readAll(sh, CLIENTS_HEADERS);

    // Match by canonical phone across the same phone fields _matchStopFlagClient
    // checks (patient phone / treatment-contact / payer). Never guess: a single
    // hit writes, anything else writes nothing.
    var hits = [];
    for (var i = 0; i < clients.length; i++) {
      var c = clients[i];
      if (_recoverPhone(c.phone) === phone ||
          _recoverPhone(c.treatmentContactPhone) === phone ||
          _recoverPhone(c.payerPhone) === phone) {
        hits.push(c);
      }
    }
    if (hits.length === 0) return { ok: false, reason: 'no_match' };
    if (hits.length > 1) return { ok: false, reason: 'multi_match' };

    var client = hits[0];
    client.clinicalTreatmentType = clinical;
    _deriveClientServiceType(client); // overwrites serviceType via _clinicalToBilling
    _stampRow(client, ''); // who/when — cross-app receiver: WHEN only, no user

    _writeAll(sh, CLIENTS_HEADERS, clients);
    return { ok: true, matched: 1 };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ===== Record session outcome (secured cross-app write — task 4.8-step3-out) =
 *
 * Inbound: the E-Zone Therapists app POSTs a session-outcome event:
 *   { action:'recordSessionOutcome', secret, sessionId, phone, therapist,
 *     clinicalTreatmentType, date, outcome, patientName?, freqPerWeek? }
 * FAIL-CLOSED auth ('SESSION_OUTCOME_SECRET' Script Property must exist + match —
 * same model as flagStop / setClinicalType, NOT the fail-open read pattern).
 *
 * Computes the therapist pay + client session value for the session and logs ONE
 * reconciliation row to the SessionLog tab, UPSERTED by sessionId (a corrected
 * outcome re-sent with the same sessionId overwrites the row and recomputes pay —
 * never a duplicate, never stale pay).
 *
 * Clients is modified ONLY for the credit balance (creditsOwed) when a single
 * client matches: therapist_cancelled grants +1; a happened session beyond the
 * patient's monthly quota (weekly frequency × 4) auto-draws a credit when one is
 * available, zeroing that session's clientSessionValue (therapist pay unchanged).
 * Because creditsOwed is a stateful running total, an upsert first REVERSES the
 * existing row's credit effect, then applies the new outcome's — so a correction
 * undoes the old draw/grant. No plan frequency or no session date -> NO draw, the
 * row is flagged (creditStatus). See the credit engine below + _planWeeklyFrequency.
 *
 *   outcome:        happened | therapist_cancelled | patient_no_show (any other
 *                   value rejects, writes nothing)
 *   sessionStatus:  happened->consumed, therapist_cancelled->credited,
 *                   patient_no_show->forfeited
 *   therapistPay:   happened / patient_no_show -> _therapistPay (therapist showed
 *                   up, so a no-show still pays); therapist_cancelled -> 0 (never
 *                   delivered); group (קבוצה) -> 0
 *   clientSessionValue: _billingPrice(billingType, freq). קבוצה -> 0 (decided
 *                   free). ליווי with NO freq in the event -> null (blank cell —
 *                   flagged, never guessed; distinct from a real 0).
 *
 * Unknown clinical type / unknown outcome / (for paid non-group outcomes) unknown
 * therapist all REJECT and write nothing. The log is keyed by session, so it
 * always writes regardless of client match: matchStatus records matched (single
 * phone hit, fills clientId+patientName) / no_match / multi_match.
 */
var SESSION_LOG_HEADERS = [
  'sessionId', 'phone', 'patientName', 'clientId',
  'therapist', 'clinicalTreatmentType', 'billingType', 'date',
  'outcome', 'therapistPay', 'clientSessionValue', 'sessionStatus',
  'matchStatus', 'recordedAt',
  // APPEND-ONLY (session accounting + credits): how the credit engine treated
  // this row. '' = N/A (no-show / unmatched non-credit); 'credit_added' =
  // therapist_cancelled gave +1; 'within_quota' = happened inside the monthly
  // quota (normal value); 'covered' = happened beyond quota, a credit was drawn
  // (clientSessionValue forced to 0); 'beyond_no_credit' = beyond quota but no
  // credit available (normal value); 'quota_unknown' = quota undeterminable
  // (no plan frequency / no session date) so NO draw — flagged; 'no_client' =
  // no single client match, so the patient balance could not be touched.
  'creditStatus',
  // APPEND-ONLY (payout forwarding): the 'YYYY-MM' payroll cycle this session was
  // forwarded to חשבת שכר in. '' = not yet forwarded (still in the open payout
  // view). Once stamped the row is SETTLED and is filtered out of the payout view;
  // a session logged late for an already-stamped month surfaces as a הפרש.
  // Set ONLY by _markForwarded; preserved (never cleared) across outcome upserts.
  'forwardedToPayroll'
];

var SESSION_STATUS_BY_OUTCOME = {
  happened:            'consumed',
  therapist_cancelled: 'credited',
  patient_no_show:     'forfeited'
};

function _sessionOutcomeAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('SESSION_OUTCOME_SECRET');
  if (!expected) return false; // fail-closed: not configured -> reject
  var got = (params && params.secret != null) ? String(params.secret) : '';
  return got !== '' && got === expected;
}

/* Pay rule by outcome. therapist_cancelled and group never call _therapistPay,
 * so they log fine even for an unknown therapist; only a PAID non-group outcome
 * (happened / patient_no_show) looks up the therapist and may throw. */
function _computeSessionPay(outcome, therapist, clinicalTreatmentType, billingType) {
  if (outcome === 'therapist_cancelled') return 0; // never delivered -> never paid
  if (billingType === GROUP_BILLING) return 0;      // group -> 0 pay
  return _therapistPay(therapist, clinicalTreatmentType); // showed up -> paid
}

/* Value rule. Day-center needs a frequency; if the event carries none, return
 * null (flag) rather than guessing. Everything else (incl. group -> 0) prices
 * straight from the billing table. */
function _computeSessionValue(billingType, freqPerWeek) {
  if (_isDayCenterBilling(billingType) &&
      (freqPerWeek === undefined || freqPerWeek === null || freqPerWeek === '')) {
    return null;
  }
  return _billingPrice(billingType, freqPerWeek);
}

function _recordSessionOutcome(payload) {
  var sessionId = String((payload && payload.sessionId) || '').trim();
  if (!sessionId) return { ok: false, reason: 'missing_session_id' };

  var outcome = String((payload && payload.outcome) || '').trim();
  if (!_hasOwn(SESSION_STATUS_BY_OUTCOME, outcome)) {
    return { ok: false, reason: 'unknown_outcome' };
  }

  var clinical = String((payload && payload.clinicalTreatmentType) || '').trim();
  if (!clinical || !_hasOwn(CLINICAL_TO_BILLING, clinical)) {
    return { ok: false, reason: 'unknown_type' };
  }
  var billingType = _clinicalToBilling(clinical);
  var therapist = String((payload && payload.therapist) || '').trim();

  // Frequency only matters for ליווי; absent everywhere else. Accept either key.
  var freq;
  if (payload && payload.freqPerWeek != null && payload.freqPerWeek !== '') freq = payload.freqPerWeek;
  else if (payload && payload.frequencyPerWeek != null && payload.frequencyPerWeek !== '') freq = payload.frequencyPerWeek;

  var therapistPay, clientSessionValue;
  try {
    therapistPay = _computeSessionPay(outcome, therapist, clinical, billingType);
  } catch (err) {
    return { ok: false, reason: 'unknown_therapist' };
  }
  try {
    clientSessionValue = _computeSessionValue(billingType, freq);
  } catch (err) {
    return { ok: false, reason: 'invalid_frequency' };
  }

  var sessionStatus = SESSION_STATUS_BY_OUTCOME[outcome];
  var phone = _recoverPhone(payload && payload.phone);
  var patientName = String((payload && payload.patientName) || '').trim();

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Optional client match for enrichment — never gates the log (keyed by session).
    // A SINGLE phone hit also unlocks the credit engine (we can read+write that
    // client's creditsOwed); 0 or >1 hits leave the patient balance untouched.
    var clientsSh = _ensureSheet('Clients', CLIENTS_HEADERS);
    var clients = _readAll(clientsSh, CLIENTS_HEADERS);
    var clientId = '', matchStatus = 'no_match', matchedClient = null;
    if (phone && /^0\d{8,9}$/.test(phone)) {
      var hits = [];
      for (var i = 0; i < clients.length; i++) {
        var c = clients[i];
        if (_recoverPhone(c.phone) === phone ||
            _recoverPhone(c.treatmentContactPhone) === phone ||
            _recoverPhone(c.payerPhone) === phone) {
          hits.push(c);
        }
      }
      if (hits.length === 1) {
        matchedClient = hits[0];
        clientId = String(matchedClient.id);
        matchStatus = 'matched';
        if (!patientName) patientName = String(matchedClient.name == null ? '' : matchedClient.name).trim();
      } else if (hits.length > 1) {
        matchStatus = 'multi_match';
      }
    }

    var rowObj = {
      sessionId:          sessionId,
      phone:              phone,
      patientName:        patientName,
      clientId:           clientId,
      therapist:          therapist,
      clinicalTreatmentType: clinical,
      billingType:        billingType,
      date:               String((payload && payload.date) || '').trim(),
      outcome:            outcome,
      therapistPay:       therapistPay,
      clientSessionValue: clientSessionValue,   // null -> blank cell (flag)
      sessionStatus:      sessionStatus,
      matchStatus:        matchStatus,
      recordedAt:         new Date().toISOString(),
      creditStatus:       '',
      // Preserved below from the existing row on an upsert — a re-sent / corrected
      // outcome must NOT lose an already-forwarded stamp (only _markForwarded sets it).
      forwardedToPayroll: ''
    };

    var sh = _ensureSheet('SessionLog', SESSION_LOG_HEADERS);

    // ---- Credit engine -----------------------------------------------------
    // creditsOwed is a stateful running balance, so an UPSERT must first REVERSE
    // the effect the existing row for this sessionId had, then apply the new
    // outcome's effect (idempotent re-send nets zero; a real correction undoes
    // the old and applies the new — e.g. happened-covered -> cancelled gives the
    // drawn credit back AND adds the cancellation credit). We do NOT re-simulate
    // sibling rows: reversing one row's own effect is locally correct; the
    // month's other draws keep whatever they resolved to (documented).
    var logRows = _readAll(sh, SESSION_LOG_HEADERS);
    var oldRow = null;
    for (var lr = 0; lr < logRows.length; lr++) {
      if (String(logRows[lr].sessionId) === sessionId) { oldRow = logRows[lr]; break; }
    }
    // Preserve an already-forwarded stamp across the upsert: a correction re-runs
    // pay/credit but must not silently un-forward a session payroll already received.
    if (oldRow && String(oldRow.forwardedToPayroll || '').trim() !== '') {
      rowObj.forwardedToPayroll = String(oldRow.forwardedToPayroll).trim();
    }

    if (matchedClient) {
      var origCredits = _toCredits(matchedClient.creditsOwed);
      var balance = origCredits;
      // 1) reverse the old row's effect on this client's balance
      if (oldRow) {
        if (oldRow.outcome === 'therapist_cancelled') balance -= 1;       // undo the +1
        if (String(oldRow.creditStatus) === 'covered')  balance += 1;       // undo the draw (give it back)
      }
      if (balance < 0) balance = 0;
      // 2) apply the new outcome's effect
      if (outcome === 'therapist_cancelled') {
        balance += 1;
        rowObj.creditStatus = 'credit_added';
      } else if (outcome === 'happened') {
        var quotaFreq = _planWeeklyFrequency(matchedClient);
        if (!quotaFreq && freq != null && freq !== '') {           // fall back to the event frequency
          var ef = parseInt(freq, 10);
          if (!isNaN(ef) && ef > 0) quotaFreq = ef;
        }
        var month = _monthKey(rowObj.date);
        if (!quotaFreq || !month) {
          rowObj.creditStatus = 'quota_unknown';                   // can't bucket -> never draw
        } else {
          var quota = quotaFreq * 4;
          var priorHappened = 0;                                   // delivered this month, excluding self
          for (var hh = 0; hh < logRows.length; hh++) {
            var lrow = logRows[hh];
            if (String(lrow.sessionId) === sessionId) continue;
            if (String(lrow.clientId) === clientId &&
                lrow.outcome === 'happened' &&
                _monthKey(lrow.date) === month) priorHappened++;
          }
          var beyondQuota = priorHappened >= quota;
          if (!beyondQuota) {
            rowObj.creditStatus = 'within_quota';
          } else if (balance > 0 && typeof clientSessionValue === 'number' && clientSessionValue > 0) {
            clientSessionValue = 0;                                // credit covers this session
            rowObj.clientSessionValue = 0;
            balance -= 1;
            rowObj.creditStatus = 'covered';
          } else {
            rowObj.creditStatus = 'beyond_no_credit';              // beyond quota, no credit to draw
          }
        }
      }
      // 3) persist the balance only if it actually changed (single cell — the old
      //    whole-sheet _writeAll here was the save-path hotspot)
      if (balance !== origCredits) {
        matchedClient.creditsOwed = balance;
        // who/when: '' for the cross-app receiver; the internal
        // correctSessionOutcome path carries the proxy-injected user.
        _writeCreditsOwed(clientsSh, clientId, balance, _requestUser(payload));
      }
      rowObj.creditsOwed = balance;
    } else if (outcome === 'happened' || outcome === 'therapist_cancelled') {
      // No single client to credit/debit — flag, change no balance.
      rowObj.creditStatus = 'no_client';
    }
    // ------------------------------------------------------------------------

    var rowArr = SESSION_LOG_HEADERS.map(function (h) {
      var v = rowObj[h];
      return (v === undefined || v === null) ? '' : v;
    });
    var idIdx = SESSION_LOG_HEADERS.indexOf('sessionId');
    var lastRow = sh.getLastRow();
    var upserted = false;
    if (lastRow > 1) {
      var ids = sh.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
      for (var r = 0; r < ids.length; r++) {
        if (String(ids[r][0]) === sessionId) {
          sh.getRange(r + 2, 1, 1, SESSION_LOG_HEADERS.length).setValues([rowArr]);
          upserted = true;
          break;
        }
      }
    }
    if (!upserted) sh.appendRow(rowArr);

    var result = {
      ok: true,
      sessionId: sessionId,
      therapistPay: therapistPay,
      clientSessionValue: clientSessionValue,
      sessionStatus: sessionStatus,
      creditStatus: rowObj.creditStatus
    };
    if (rowObj.creditsOwed !== undefined) result.creditsOwed = rowObj.creditsOwed;
    if (upserted) result.upserted = true; else result.appended = true;
    return result;
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* Tolerant 'YYYY-MM' extraction for the payout forwarding match — MUST mirror
 * public/therapist-payout.js monthOf so _markForwarded stamps exactly the rows
 * the dashboard view groups into that month. Handles both shapes seen in
 * SessionLog: ISO 'YYYY-MM-DD' (Sheets normalizes Date cells to this) AND a raw
 * JS Date.toString() like 'Thu Jun 18 2026 …' (what recordSessionOutcome stores
 * verbatim from the Therapists payload). Returns '' for empty/unparseable input.
 * (_monthKey is ISO-only and intentionally left as-is for the credit engine.) */
function _payoutMonthOf(dateCell) {
  var s = String(dateCell == null ? '' : dateCell).trim();
  if (!s) return '';
  var m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return m[1] + '-' + m[2];
  var d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}

/* ===== Mark a therapist's month as forwarded to payroll (internal write) =====
 *
 * Inbound (internal dashboard, NO secret — same trust level as the by-id
 * resolveStopFlag / savePayment path; this is מורן acting inside the dashboard,
 * not a cross-app receiver):
 *   { action:'markForwarded', therapist, month:'YYYY-MM' }
 *
 * Stamps `forwardedToPayroll = month` on EVERY still-unstamped SessionLog row for
 * that (therapist, month) — matched on the SESSION date via _payoutMonthOf so it
 * tracks the view exactly. Stamped rows drop out of the payout view permanently;
 * a session logged late for the same month after this runs stays unstamped and
 * surfaces as a הפרש, until מורן forwards that month again (this can be re-run, it
 * only ever touches rows that aren't already stamped).
 *
 * Per-therapist + per-month: a forward for one therapist never touches another's
 * rows, and never touches a different month. Idempotent: a second call with no new
 * rows stamps 0 and reports forwarded:0.
 */
function _markForwarded(payload) {
  var therapist = String((payload && payload.therapist) || '').trim();
  if (!therapist) return { ok: false, reason: 'missing_therapist' };
  var month = _payoutMonthOf((payload && payload.month) || '');
  if (!month) return { ok: false, reason: 'invalid_month' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('SessionLog', SESSION_LOG_HEADERS);
    var rows = _readAll(sh, SESSION_LOG_HEADERS);
    var forwarded = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (String(row.therapist || '').trim() !== therapist) continue;
      if (_payoutMonthOf(row.date) !== month) continue;
      if (String(row.forwardedToPayroll || '').trim() !== '') continue; // already settled
      row.forwardedToPayroll = month;
      forwarded++;
    }
    if (forwarded) _writeAll(sh, SESSION_LOG_HEADERS, rows);
    return { ok: true, therapist: therapist, month: month, forwarded: forwarded };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function _resolveStopFlag(id, resolvedBy) {
  if (!id) return { ok: false, error: 'missing_id' };
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('StopFlags', STOP_FLAGS_HEADERS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, error: 'not_found' };
    var idIdx = STOP_FLAGS_HEADERS.indexOf('id');
    var ids = sh.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(id)) {
        var rowNum = i + 2;
        sh.getRange(rowNum, STOP_FLAGS_HEADERS.indexOf('status') + 1).setValue('resolved');
        sh.getRange(rowNum, STOP_FLAGS_HEADERS.indexOf('resolvedBy') + 1).setValue(String(resolvedBy || '').trim());
        sh.getRange(rowNum, STOP_FLAGS_HEADERS.indexOf('resolvedAt') + 1).setValue(new Date().toISOString());
        return { ok: true, resolved: true, id: id };
      }
    }
    return { ok: false, error: 'not_found' };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* Secured receiver: the E-Zone Therapists app POSTs
 * { action:'resolveStopFlag', secret, phone } to clear a stop flag it previously
 * raised — e.g. the patient resumed treatment. FAIL-CLOSED auth: reuses
 * STOP_FLAG_SECRET, the SAME secret as flagStop (unset/empty/wrong REJECTS).
 *
 * Unlike the internal id-based _resolveStopFlag (Vered's dashboard), this matches
 * by canonical phone ALONE — NO Clients join — so it also clears ORPHANED flags
 * (e.g. 'יעל') whose phone never matched a client row. Mirrors _flagStop: one
 * script lock, _ensureSheet, positional writes by header index. Marks EVERY
 * matching still-pending row status='resolved' (idempotent: already-resolved rows
 * are skipped). Returns { ok:true, resolved:N } — N=0 is a successful no-match,
 * not an error. Clients is never touched. */
function _resolveStopFlagByPhone(payload) {
  if (!_stopFlagAuthOk(payload)) return { ok: false, reason: 'unauthorized' };
  var phone = _recoverPhone(payload && payload.phone);
  if (!phone || !/^0\d{8,9}$/.test(phone)) return { ok: false, reason: 'invalid_phone' };
  var resolvedBy = String((payload && payload.resolvedBy) || 'therapists-app').trim();

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('StopFlags', STOP_FLAGS_HEADERS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: true, resolved: 0 };
    var phoneIdx     = STOP_FLAGS_HEADERS.indexOf('phone');
    var statusIdx    = STOP_FLAGS_HEADERS.indexOf('status');
    var resolvedByIdx = STOP_FLAGS_HEADERS.indexOf('resolvedBy');
    var resolvedAtIdx = STOP_FLAGS_HEADERS.indexOf('resolvedAt');
    var rows = sh.getRange(2, 1, lastRow - 1, STOP_FLAGS_HEADERS.length).getValues();
    var resolvedAt = new Date().toISOString();
    var resolved = 0;
    for (var i = 0; i < rows.length; i++) {
      // Canonical-phone match handles a leading zero Sheets dropped on store.
      if (_recoverPhone(rows[i][phoneIdx]) !== phone) continue;
      if (String(rows[i][statusIdx]) === 'resolved') continue; // already cleared
      var rowNum = i + 2;
      sh.getRange(rowNum, statusIdx + 1).setValue('resolved');
      sh.getRange(rowNum, resolvedByIdx + 1).setValue(resolvedBy);
      sh.getRange(rowNum, resolvedAtIdx + 1).setValue(resolvedAt);
      resolved++;
    }
    return { ok: true, resolved: resolved };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ===== Deactivate client (secured cross-app receiver) =======================
 *
 * Pairs with the E-Zone Therapists delete-propagation sender (ezone-therapists
 * PR #24, `_postDeactivateClient`): when a patient is DELETED in the therapists
 * app, it POSTs { action:'deactivateClient', secret, phone } here so the patient
 * stops appearing in outpatient's roster (the therapists roster unions
 * getTreatmentPlans / getDebtStatus as base sources, so a still-active outpatient
 * Client would otherwise be re-added).
 *
 * FAIL-CLOSED auth on a DEDICATED secret 'DEACTIVATE_CLIENT_SECRET' — its OWN
 * secret, NOT reused from STOP_FLAG_SECRET (least authority; matches the sender,
 * which provisions the same value on both Apps Scripts). Unset/empty/wrong
 * REJECTS, exactly like flagStop / resolveStopFlag-by-phone.
 *
 * DEACTIVATE, not hard-delete (reversible; the row + billing/session history are
 * kept): every Client matching the canonical phone has its `status` set to
 * DEACTIVATED_CLIENT_STATUS_HE ('לא פעיל'), which both projections now exclude.
 * Match is by canonical phone ALONE (handles a leading zero Sheets dropped), the
 * same phone fields the other receivers check (phone / treatmentContactPhone /
 * payerPhone). ORPHAN-SAFE: no match -> { ok:true, deactivated:0 } (a successful
 * no-op, never a crash). Returns { ok:true, deactivated:N }. Idempotent: a row
 * already deactivated is skipped (not re-counted). Mirrors _resolveStopFlagByPhone:
 * one script lock, positional writes by header index. */
function _deactivateAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('DEACTIVATE_CLIENT_SECRET');
  if (!expected) return false; // fail-closed: not configured -> reject
  var got = (params && params.secret != null) ? String(params.secret) : '';
  return got !== '' && got === expected;
}

function _deactivateClient(payload) {
  if (!_deactivateAuthOk(payload)) return { ok: false, reason: 'unauthorized' };
  var phone = _recoverPhone(payload && payload.phone);
  if (!phone || !/^0\d{8,9}$/.test(phone)) return { ok: false, reason: 'invalid_phone' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('Clients', CLIENTS_HEADERS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: true, deactivated: 0 }; // orphan-safe: no rows
    var phoneIdx   = CLIENTS_HEADERS.indexOf('phone');
    var contactIdx = CLIENTS_HEADERS.indexOf('treatmentContactPhone');
    var payerIdx   = CLIENTS_HEADERS.indexOf('payerPhone');
    var statusIdx  = CLIENTS_HEADERS.indexOf('status');
    var rows = sh.getRange(2, 1, lastRow - 1, CLIENTS_HEADERS.length).getValues();
    var deactivated = 0;
    for (var i = 0; i < rows.length; i++) {
      if (_recoverPhone(rows[i][phoneIdx]) !== phone &&
          _recoverPhone(rows[i][contactIdx]) !== phone &&
          _recoverPhone(rows[i][payerIdx]) !== phone) continue;
      if (String(rows[i][statusIdx]) === DEACTIVATED_CLIENT_STATUS_HE) continue; // already
      sh.getRange(i + 2, statusIdx + 1).setValue(DEACTIVATED_CLIENT_STATUS_HE);
      _stampClientRowAt(sh, i + 2, ''); // who/when — cross-app receiver: WHEN only
      deactivated++;
    }
    return { ok: true, deactivated: deactivated };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ===== Over-package extra-session request (RECEIVER) =====
 * The therapists app POSTs { action:'requestExtraSession', secret, phone,
 * patientName, treatmentType, therapist, monthKey, quota, used, requestedBy,
 * note } when Yarden books beyond the monthly package. We append it as a
 * pending request; Vered approves it from the dashboard (approveExtraSession).
 * Fail-closed auth with its own shared secret (EXTRA_SESSION_SECRET). */
function _extraSessionAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('EXTRA_SESSION_SECRET');
  if (!expected) return false; // not configured -> reject
  var got = (params && params.secret != null) ? String(params.secret) : '';
  return got !== '' && got === expected;
}

function _requestExtraSession(payload) {
  if (!_extraSessionAuthOk(payload)) return { ok: false, error: 'unauthorized' };
  var phone = _recoverPhone(payload && payload.phone);
  if (!phone || !/^0\d{8,9}$/.test(phone)) return { ok: false, error: 'invalid_phone' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('ExtraSessionRequests', EXTRA_SESSION_HEADERS);
    var id = 'esr_' + new Date().getTime() + '_' + Math.floor(Math.random() * 1000);
    var row = EXTRA_SESSION_HEADERS.map(function (h) {
      switch (h) {
        case 'id': return id;
        case 'phone': return phone;
        case 'patientName': return String(payload.patientName == null ? '' : payload.patientName);
        case 'treatmentType': return String(payload.treatmentType == null ? '' : payload.treatmentType);
        case 'therapist': return String(payload.therapist == null ? '' : payload.therapist);
        case 'monthKey': return String(payload.monthKey == null ? '' : payload.monthKey);
        case 'quota': return Number(payload.quota) || 0;
        case 'used': return Number(payload.used) || 0;
        case 'requestedBy': return String(payload.requestedBy == null ? '' : payload.requestedBy);
        case 'note': return String(payload.note == null ? '' : payload.note);
        case 'requestedAt': return new Date().toISOString();
        case 'status': return 'pending';
        case 'approvedBy': return '';
        case 'approvedAt': return '';
        default: return '';
      }
    });
    sh.appendRow(row);
    return { ok: true, requestId: id };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* Approve a pending request (called from Vered's dashboard, same-origin via the
 * Node proxy — no cross-app secret needed; it's an internal app action). */
function _approveExtraSession(payload) {
  var id = String(payload && payload.id == null ? '' : payload.id).trim();
  var approvedBy = String(payload && payload.approvedBy == null ? '' : payload.approvedBy).trim();
  if (!id) return { ok: false, error: 'missing_id' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet('ExtraSessionRequests', EXTRA_SESSION_HEADERS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, error: 'not_found' };
    var idIdx = EXTRA_SESSION_HEADERS.indexOf('id');
    var statusIdx = EXTRA_SESSION_HEADERS.indexOf('status');
    var byIdx = EXTRA_SESSION_HEADERS.indexOf('approvedBy');
    var atIdx = EXTRA_SESSION_HEADERS.indexOf('approvedAt');
    var rows = sh.getRange(2, 1, lastRow - 1, EXTRA_SESSION_HEADERS.length).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][idIdx]) === id) {
        sh.getRange(i + 2, statusIdx + 1).setValue('approved');
        sh.getRange(i + 2, byIdx + 1).setValue(approvedBy);
        sh.getRange(i + 2, atIdx + 1).setValue(new Date().toISOString());
        return { ok: true };
      }
    }
    return { ok: false, error: 'not_found' };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* Read all extra-session requests (for Vered's dashboard alert list). */
function _getExtraSessionRequests() {
  var sh = _ensureSheet('ExtraSessionRequests', EXTRA_SESSION_HEADERS);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, requests: [] };
  var values = sh.getRange(2, 1, lastRow - 1, EXTRA_SESSION_HEADERS.length).getValues();
  var requests = values.map(function (r) {
    var o = {};
    EXTRA_SESSION_HEADERS.forEach(function (h, idx) { o[h] = r[idx]; });
    o.phone = _recoverPhone(o.phone);
    return o;
  });
  return { ok: true, requests: requests };
}

/* ===== Stop-treatment alerts =====
 *
 * createStopAlert is the INTERNAL write the outpatient app fires when Vered hits
 * "הודעת עצירת טיפול" on an unpaid patient — same trust level as saveAll (posted
 * same-origin through the Node proxy; NO cross-app secret). One appended row per
 * alert: id 'stop-<uuid>', status 'unread', createdAt ISO. LockService like every
 * other write. Clients is never touched. */
function _createStopAlert(payload) {
  var clientId = String((payload && payload.clientId) || '').trim();
  var clientName = String((payload && payload.clientName) || '').trim();
  if (!clientId) return { ok: false, error: 'missing_client_id' };
  if (!clientName) return { ok: false, error: 'missing_client_name' };
  // Reason is REQUIRED and fail-closed: reject anything outside the allowed set
  // (missing/empty/unknown) before taking the lock or touching the sheet.
  var reason = String((payload && payload.reason) || '').trim();
  if (!STOP_ALERT_REASONS[reason]) return { ok: false, error: 'invalid_reason' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet(STOP_ALERTS_SHEET, STOP_ALERTS_HEADERS);
    var alert = {
      id: 'stop-' + Utilities.getUuid(),
      clientId: clientId,
      clientName: clientName,
      createdAt: new Date().toISOString(),
      createdBy: String((payload && payload.createdBy) || '').trim(),
      status: 'unread',
      readAt: '',
      note: String((payload && payload.note) || '').trim().slice(0, 1000),
      reason: reason,
      type: 'stop',
      cancelledAt: ''
    };
    sh.appendRow(STOP_ALERTS_HEADERS.map(function (h) {
      return alert[h] == null ? '' : alert[h];
    }));
    return { ok: true, alert: alert };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* Fail-closed auth for the two CROSS-APP stop-alert endpoints (getStopAlerts,
 * markStopAlertRead). Mirrors _sessionOutcomeAuthOk exactly: the secret is read
 * ONLY from the 'STOP_ALERTS_SECRET' Script Property; a missing property rejects
 * every request (never open), and an empty/wrong secret is rejected too. */
function _stopAlertsAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('STOP_ALERTS_SECRET');
  if (!expected) return false; // fail-closed: not configured -> reject
  var got = (params && params.secret != null) ? String(params.secret) : '';
  return got !== '' && got === expected;
}

/* Read all stop-treatment alerts (for the therapists app's "עצירת טיפול" tab).
 * Secured — the caller must have passed _stopAlertsAuthOk in the router. */
function _getStopAlerts() {
  var sh = _ensureSheet(STOP_ALERTS_SHEET, STOP_ALERTS_HEADERS);
  return { ok: true, stopAlerts: _readAll(sh, STOP_ALERTS_HEADERS) };
}

/* Mark a single alert read by id: status -> 'read' + readAt = now. Single-row
 * in-place update (never rewrites the sheet), wrapped in a LockService lock like
 * every other write. Secured — the router enforces _stopAlertsAuthOk first. */
function _markStopAlertRead(payload) {
  var id = String((payload && payload.id) || '').trim();
  if (!id) return { ok: false, error: 'missing_id' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet(STOP_ALERTS_SHEET, STOP_ALERTS_HEADERS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, error: 'not_found' };
    var idIdx = STOP_ALERTS_HEADERS.indexOf('id');
    var statusIdx = STOP_ALERTS_HEADERS.indexOf('status');
    var readAtIdx = STOP_ALERTS_HEADERS.indexOf('readAt');
    var rows = sh.getRange(2, 1, lastRow - 1, STOP_ALERTS_HEADERS.length).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][idIdx]) === id) {
        sh.getRange(i + 2, statusIdx + 1).setValue('read');
        sh.getRange(i + 2, readAtIdx + 1).setValue(new Date().toISOString());
        return { ok: true };
      }
    }
    return { ok: false, error: 'not_found' };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* Reopen a single alert by id: status -> 'unread' + readAt cleared. Exact mirror
 * of _markStopAlertRead (single-row in-place update, LockService lock, never
 * rewrites the sheet) — it just flips the row the other way so the therapists app
 * can undo a mistaken "mark read". Secured — the router enforces _stopAlertsAuthOk
 * first. */
function _markStopAlertUnread(payload) {
  var id = String((payload && payload.id) || '').trim();
  if (!id) return { ok: false, error: 'missing_id' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet(STOP_ALERTS_SHEET, STOP_ALERTS_HEADERS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, error: 'not_found' };
    var idIdx = STOP_ALERTS_HEADERS.indexOf('id');
    var statusIdx = STOP_ALERTS_HEADERS.indexOf('status');
    var readAtIdx = STOP_ALERTS_HEADERS.indexOf('readAt');
    var rows = sh.getRange(2, 1, lastRow - 1, STOP_ALERTS_HEADERS.length).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][idIdx]) === id) {
        sh.getRange(i + 2, statusIdx + 1).setValue('unread');
        sh.getRange(i + 2, readAtIdx + 1).setValue('');
        return { ok: true };
      }
    }
    return { ok: false, error: 'not_found' };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* Resume-treatment: the INTERNAL write the outpatient app fires when Vered hits
 * "חידוש טיפול" on a patient who had a stop alert. Same trust level as
 * createStopAlert (posted same-origin through the Node proxy; NO cross-app
 * secret). Atomically, under one LockService lock:
 *   (a) every UNREAD 'stop' alert for the clientId is cancelled (status
 *       'cancelled' + cancelledAt now) — Yarden never saw it, so it just vanishes;
 *   (b) if any 'stop' alert for the clientId was already READ, a NEW row is
 *       appended (type 'resume', status 'unread', reason '') — Yarden gets a
 *       resume alert ONLY because she saw the stop.
 * A legacy row with an empty type cell counts as 'stop'. Clients is never touched.
 * Returns { ok:true, cancelled:<n>, resumeCreated:<bool> }. */
function _resumeTreatmentAlert(payload) {
  var clientId = String((payload && payload.clientId) || '').trim();
  var clientName = String((payload && payload.clientName) || '').trim();
  if (!clientId) return { ok: false, error: 'missing_client_id' };
  if (!clientName) return { ok: false, error: 'missing_client_name' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = _ensureSheet(STOP_ALERTS_SHEET, STOP_ALERTS_HEADERS);
    var clientIdIdx = STOP_ALERTS_HEADERS.indexOf('clientId');
    var statusIdx = STOP_ALERTS_HEADERS.indexOf('status');
    var typeIdx = STOP_ALERTS_HEADERS.indexOf('type');
    var cancelledAtIdx = STOP_ALERTS_HEADERS.indexOf('cancelledAt');
    var cancelled = 0;
    var hadReadStop = false;
    var lastRow = sh.getLastRow();
    if (lastRow >= 2) {
      var rows = sh.getRange(2, 1, lastRow - 1, STOP_ALERTS_HEADERS.length).getValues();
      var nowISO = new Date().toISOString();
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][clientIdIdx]) !== clientId) continue;
        var t = String(rows[i][typeIdx] || '');
        if (t !== '' && t !== 'stop') continue; // only 'stop' (legacy '' == stop)
        var st = String(rows[i][statusIdx] || '');
        if (st === 'unread') {
          sh.getRange(i + 2, statusIdx + 1).setValue('cancelled');
          sh.getRange(i + 2, cancelledAtIdx + 1).setValue(nowISO);
          cancelled++;
        } else if (st === 'read') {
          hadReadStop = true;
        }
      }
    }
    var resumeCreated = false;
    if (hadReadStop) {
      var resume = {
        id: 'stop-' + Utilities.getUuid(),
        clientId: clientId,
        clientName: clientName,
        createdAt: new Date().toISOString(),
        createdBy: String((payload && payload.createdBy) || '').trim(),
        status: 'unread',
        readAt: '',
        note: '',
        reason: '',
        type: 'resume',
        cancelledAt: ''
      };
      sh.appendRow(STOP_ALERTS_HEADERS.map(function (h) {
        return resume[h] == null ? '' : resume[h];
      }));
      resumeCreated = true;
    }
    return { ok: true, cancelled: cancelled, resumeCreated: resumeCreated };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* Minimal INTERNAL read for the outpatient app's own sent-state (survives a page
 * reload). Same trust level as createStopAlert — NO cross-app secret — so it is
 * deliberately lean: id / clientId / status / type ONLY, never notes/reasons/
 * names. A legacy empty type reads as 'stop'. The therapists app must keep using
 * the SECRET-gated getStopAlerts (full rows); this is not a substitute. */
function _getMyStopAlerts() {
  var sh = _ensureSheet(STOP_ALERTS_SHEET, STOP_ALERTS_HEADERS);
  var all = _readAll(sh, STOP_ALERTS_HEADERS);
  return {
    ok: true,
    myStopAlerts: all.map(function (a) {
      return { id: a.id, clientId: a.clientId, status: a.status, type: (a.type || 'stop') };
    })
  };
}

/* ===== Create lead (inbound, fail-closed write) =====
 *
 * Inbound: the E-Zone Dashboard POSTs { action:'createLead', secret, name,
 * phone, house, note } directly to this /exec when a patient is discharged with
 * disposition "released to outpatient care" — pushing that patient in as a new
 * outpatient lead. FAIL-CLOSED auth (mirrors flagStop, an external write): the
 * shared secret 'CREATE_LEAD_SECRET' Script Property MUST exist and match —
 * unlike the read endpoints (open when unset), a missing/empty/wrong secret is
 * rejected. The secret is read ONLY from Script Properties and is never logged.
 *
 * Appends ONE Leads row as a brand-new lead (stage 'new', created = today),
 * mirroring how addLeadFromForm builds a fresh lead in public/app.js: the lead
 * starts in the first kanban stage with empty serviceType/location/sessions/
 * price/startDate. phone MAY be empty (hand-entered patients have no phone);
 * it is normalized through _recoverPhone and stored as-is when blank. note is
 * free text (source + notes combined) and may be empty. Clients is never
 * touched — this only creates a lead for Vered to work.
 */

/* Known Dashboard houseId keys. Most are identical to the Outpatient
 * house_of_origin keys (HOUSE_OF_ORIGIN_LABELS in public/app.js) and map 1:1 /
 * verbatim. The exception is 'pardes' (רעננה הפרדס): its canonical ecosystem
 * id is 'pardes', but this repo's stable house_of_origin key for that house is
 * 'raanana_pardes' (stable code keys are never renamed), so it is translated —
 * the same mapping the continuation tab applies (HOUSE_TO_ORIGIN in
 * public/continuation-logic.js). An UNKNOWN key is still stored as-is and
 * never rejected, so an unexpected house never fails the write (the lead must
 * still be created). */
var CREATE_LEAD_HOUSE_KEYS = {
  raanana: true, ramot: true, efroni: true, rehab: true, external: true,
  pardes: true
};
var CREATE_LEAD_HOUSE_ALIASES = {
  pardes: 'raanana_pardes'
};

function _mapLeadHouse(house) {
  // Aliases translate a canonical ecosystem id to the Outpatient stable key;
  // every other key — known 1:1 keys and unknown keys alike — passes through
  // verbatim (guarded: never throw, never reject — the lead still writes).
  var s = String(house == null ? '' : house).trim();
  return CREATE_LEAD_HOUSE_ALIASES[s] || s;
}

/* Trim, strip control characters, and length-cap a free-text field before it
 * is written to the sheet. */
function _sanitizeLeadText(v, maxLen) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  if (maxLen && s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

/* Mirrors uid() in public/app.js so server-created leads share the in-app id
 * shape (id_<base36 time>_<base36 rand>). */
function _leadUid() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function _createLeadAuthOk(params) {
  var expected = PropertiesService.getScriptProperties().getProperty('CREATE_LEAD_SECRET');
  if (!expected) return false; // fail-closed: not configured -> reject
  var got = (params && params.secret != null) ? String(params.secret) : '';
  return got !== '' && got === expected;
}

function _createLead(payload) {
  var name = _sanitizeLeadText(payload && payload.name, 200);
  if (!name) return { ok: false, error: 'missing_name' };
  var phone = _recoverPhone(payload && payload.phone); // '' stays '' (valid)
  var note  = _sanitizeLeadText(payload && payload.note, 2000);
  var house = _mapLeadHouse(payload && payload.house);

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // _ensureSheet applies the '@' plain-text format to the phone column for
    // the grid rows, so the appended phone keeps its leading zero.
    var sh = _ensureSheet('Leads', LEADS_HEADERS);
    var lead = {
      id: _leadUid(),
      name: name,
      phone: phone,
      serviceType: '',
      location: '',
      note: note,
      stage: 'new',
      sessionsPerWeek: '',
      pricePerSession: '',
      startDate: '',
      created: Utilities.formatDate(
        new Date(), Session.getScriptTimeZone() || 'Asia/Jerusalem', 'yyyy-MM-dd'),
      introDateTime: '',
      house_of_origin: house,
      not_relevant_reason: '',
      not_relevant_note: ''
    };
    _stampRow(lead, ''); // who/when — cross-app (dashboard) receiver: WHEN only
    sh.appendRow(LEADS_HEADERS.map(function (h) {
      return lead[h] == null ? '' : lead[h];
    }));
    return { ok: true, id: lead.id };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ===== Merge duplicate clients =====
 *
 * Internal dashboard action (open, same trust level as saveAll). Merges one or
 * more duplicate client rows into a survivor:
 *   1. Repoint every Payments.clientId / ClientCharges.clientId from a dup to
 *      the survivor (and refresh Payments.clientName) — done BEFORE removal so
 *      no billing row is ever orphaned.
 *   2. Fill BLANK survivor fields from the dups (first non-blank), excluding
 *      id/status/exitDate/fromLead so the active survivor never inherits a
 *      discharge state.
 *   3. Remove the dup client rows.
 * All under one script lock, written back atomically. Returns counts.
 *
 * NOTE: a repointed payment/charge keeps its original deterministic id (it is a
 * historical record); only the clientId foreign key the dashboard groups on is
 * moved. The caller picks the survivor (default: the active row).
 */
function _isBlankCell(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

function _mergeClients(payload) {
  var survivorId = (payload && payload.survivorId != null) ? String(payload.survivorId) : '';
  var dupIds = (payload && Array.isArray(payload.dupIds)) ? payload.dupIds.map(String) : [];
  if (!survivorId) return { ok: false, error: 'missing_survivor' };
  var dupSet = {};
  dupIds.forEach(function (id) { if (id && id !== survivorId) dupSet[id] = true; });
  dupIds = Object.keys(dupSet);
  if (!dupIds.length) return { ok: false, error: 'no_dups' };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var clientsSh  = _ensureSheet('Clients', CLIENTS_HEADERS);
    var paymentsSh = _ensureSheet('Payments', PAYMENTS_HEADERS);
    var chargesSh  = _ensureSheet('ClientCharges', CHARGES_HEADERS);
    var clients  = _readAll(clientsSh, CLIENTS_HEADERS);
    var payments = _readAll(paymentsSh, PAYMENTS_HEADERS);
    var charges  = _readAll(chargesSh, CHARGES_HEADERS);

    var survivor = null, dups = [];
    for (var i = 0; i < clients.length; i++) {
      var id = String(clients[i].id);
      if (id === survivorId) survivor = clients[i];
      else if (dupSet[id]) dups.push(clients[i]);
    }
    if (!survivor) return { ok: false, error: 'survivor_not_found' };
    if (dups.length !== dupIds.length) return { ok: false, error: 'dup_not_found' };

    // 2. Fill blank survivor fields from dups (first non-blank), skipping fields
    //    we must not import onto the active survivor.
    var SKIP = { id: true, status: true, exitDate: true, fromLead: true };
    for (var h = 0; h < CLIENTS_HEADERS.length; h++) {
      var key = CLIENTS_HEADERS[h];
      if (SKIP[key] || !_isBlankCell(survivor[key])) continue;
      for (var d = 0; d < dups.length; d++) {
        if (!_isBlankCell(dups[d][key])) { survivor[key] = dups[d][key]; break; }
      }
    }

    // 1. Repoint billing rows dup -> survivor (before removal).
    var repPay = 0, repChg = 0;
    for (var p = 0; p < payments.length; p++) {
      if (dupSet[String(payments[p].clientId)]) {
        payments[p].clientId = survivorId;
        payments[p].clientName = survivor.name || payments[p].clientName || '';
        repPay++;
      }
    }
    for (var ch = 0; ch < charges.length; ch++) {
      if (dupSet[String(charges[ch].clientId)]) {
        charges[ch].clientId = survivorId;
        repChg++;
      }
    }

    // 3. Remove dup client rows and write everything back. The survivor is the
    //    row this merge edited — stamp it (who/when); untouched rows keep theirs.
    _stampRow(survivor, _requestUser(payload));
    var keptClients = clients.filter(function (c) { return !dupSet[String(c.id)]; });
    _writeAll(clientsSh, CLIENTS_HEADERS, keptClients);
    if (repPay) _writeAll(paymentsSh, PAYMENTS_HEADERS, payments);
    if (repChg) _writeAll(chargesSh, CHARGES_HEADERS, charges);

    return {
      ok: true,
      survivorId: survivorId,
      removed: dupIds,
      repointed: { payments: repPay, charges: repChg }
    };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/* ===== Continuation track (מסלול המשך) — internal workflow read/write ==========
 *
 * Auth: NONE — same posture as getData / saveAll / savePayment. These are the
 * app's own internal actions, reached only through the Railway server; they
 * carry no cross-app secret (unlike getDebtStatus / createLead / flagStop).
 *
 * The sheet is auto-created on first read via _ensureSheet, exactly like every
 * other sheet in this backend. The roster (patient names/phones) is NOT stored
 * here — only the workflow state keyed by `key` (name|house|entryDate). */
function _getContinuation() {
  var sh = _ensureSheet(CONTINUATION_SHEET, CONTINUATION_HEADERS);
  return { ok: true, rows: _readAll(sh, CONTINUATION_HEADERS) };
}

// Accept '' or a strict ISO calendar date 'YYYY-MM-DD'. Anything else fails the
// write closed (mirrors the client-side continuation-logic validation).
function _isContinuationDate(v) {
  var s = String(v == null ? '' : v).trim();
  if (s === '') return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/* Single-row UPSERT by `key`: update the matching row in place, else append.
 * Wrapped in a 30s lock like every other write. Validates fail-closed BEFORE
 * touching the sheet: a missing key, an out-of-whitelist outcome, or a malformed
 * date writes nothing. Strings are trimmed; updatedAt is server-stamped. */
function _saveContinuation(payload) {
  var key = String((payload && payload.key) || '').trim();
  if (!key) return { ok: false, reason: 'missing_key' };

  var outcome = String((payload && payload.outcome) || '').trim();
  if (CONTINUATION_OUTCOMES.indexOf(outcome) === -1) {
    return { ok: false, reason: 'invalid_outcome' };
  }
  var meetingDate = String((payload && payload.meetingDate) || '').trim();
  var outcomeDate = String((payload && payload.outcomeDate) || '').trim();
  if (!_isContinuationDate(meetingDate) || !_isContinuationDate(outcomeDate)) {
    return { ok: false, reason: 'invalid_date' };
  }

  var row = {
    key: key,
    name: String((payload && payload.name) || '').trim(),
    house: String((payload && payload.house) || '').trim(),
    entryDate: String((payload && payload.entryDate) || '').trim(),
    meetingDate: meetingDate,
    outcome: outcome,
    outcomeDate: outcomeDate,
    note: String((payload && payload.note) || '').trim(),
    updatedAt: new Date().toISOString()
  };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, reason: 'busy' };
  try {
    var sh = _ensureSheet(CONTINUATION_SHEET, CONTINUATION_HEADERS);
    var rows = _readAll(sh, CONTINUATION_HEADERS);
    var found = false;
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].key || '').trim() === key) {
        rows[i] = row;
        found = true;
        break;
      }
    }
    if (!found) rows.push(row);
    _writeAll(sh, CONTINUATION_HEADERS, rows);
    return { ok: true, row: row, created: !found };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'getData';
    if (action === 'getData')      return _json(_getData());
    if (action === 'getPayments')  return _json(_getPayments());
    if (action === 'getCharges')   return _json(_getCharges());
    if (action === 'getSettings')  return _json(_getSettings());
    if (action === 'getExtraSessionRequests') return _json(_getExtraSessionRequests());
    if (action === 'getWinbackSource') {
      if (!_winbackAuthOk(e && e.parameter)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_getWinbackSource());
    }
    if (action === 'getDebtStatus') {
      if (!_debtAuthOk(e && e.parameter)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_getDebtStatus());
    }
    if (action === 'getTreatmentPlans') {
      if (!_treatmentPlansAuthOk(e && e.parameter)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_getTreatmentPlans());
    }
    if (action === 'scanClientColumns') {
      // READ-ONLY column-shift pre-condition scan (2026-07-06). Writes nothing.
      if (!_columnRepairAuthOk(e && e.parameter)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_scanClientColumns());
    }
    if (action === 'getStopFlags') return _json(_getStopFlags());
    if (action === 'getStopAlerts') {
      if (!_stopAlertsAuthOk(e && e.parameter)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_getStopAlerts());
    }
    if (action === 'getMyStopAlerts') {
      // INTERNAL minimal read (same trust level as createStopAlert) — the
      // outpatient app's own sent-state; no cross-app secret.
      return _json(_getMyStopAlerts());
    }
    if (action === 'getSessionLog') return _json(_getSessionLog());
    if (action === 'getContinuation') return _json(_getContinuation());
    // INTERNAL dashboard read (same trust level as getData): un-restored
    // Clients-removed tombstones, for the admin restore surface.
    if (action === 'getRemovedClients') return _json(_getRemovedClients());
    if (action === 'saveAll') {
      var payload = { leads: [], clients: [] };
      if (e.parameter.payload) {
        try { payload = JSON.parse(e.parameter.payload); } catch (err) {}
      } else {
        if (e.parameter.leads) try { payload.leads = JSON.parse(e.parameter.leads); } catch (_) {}
        if (e.parameter.clients) try { payload.clients = JSON.parse(e.parameter.clients); } catch (_) {}
      }
      return _json(_saveAll(payload));
    }
    return _json({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || 'saveAll';
    var payload = {};
    if (e.postData && e.postData.contents) {
      try { payload = JSON.parse(e.postData.contents); } catch (err) {}
      if (payload && payload.action) action = payload.action;
    }
    if (action === 'saveAll') {
      return _json(_saveAll({
        leads:   Array.isArray(payload.leads)   ? payload.leads   : [],
        clients: Array.isArray(payload.clients) ? payload.clients : [],
        // ids the ✕ permanent-delete flow removed on purpose this save; any
        // other id missing from `clients` is PRESERVED (merge-don't-drop)
        // and logged as 'saveAll-diff-preserved'.
        explicitRemovedIds: Array.isArray(payload.explicitRemovedIds) ? payload.explicitRemovedIds : [],
        // the dataVersion the tab loaded, echoed back — _saveAll validates
        // (fail-open on absent/non-numeric).
        dataVersion: payload.dataVersion,
        // who/when: the session user the Railway proxy injected from the
        // SIGNED cookie (never client-controlled — the proxy overwrites it).
        user: _requestUser(payload)
      }));
    }
    if (action === 'getData')     return _json(_getData());
    if (action === 'getPayments') return _json(_getPayments());
    if (action === 'getCharges')  return _json(_getCharges());
    if (action === 'getSettings') return _json(_getSettings());
    if (action === 'getWinbackSource') {
      var authParams = (e && e.parameter) || {};
      if (payload && payload.secret) authParams.secret = payload.secret;
      if (!_winbackAuthOk(authParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_getWinbackSource());
    }
    if (action === 'getDebtStatus') {
      var debtParams = (e && e.parameter) || {};
      if (payload && payload.secret) debtParams.secret = payload.secret;
      if (!_debtAuthOk(debtParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_getDebtStatus());
    }
    if (action === 'getTreatmentPlans') {
      var tpParams = (e && e.parameter) || {};
      if (payload && payload.secret) tpParams.secret = payload.secret;
      if (!_treatmentPlansAuthOk(tpParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_getTreatmentPlans());
    }
    if (action === 'flagStop') {
      var sfParams = (e && e.parameter) || {};
      if (payload && payload.secret) sfParams.secret = payload.secret;
      if (!_stopFlagAuthOk(sfParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_flagStop(payload));
    }
    if (action === 'createLead') {
      var clParams = (e && e.parameter) || {};
      if (payload && payload.secret) clParams.secret = payload.secret;
      if (!_createLeadAuthOk(clParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_createLead(payload));
    }
    if (action === 'scanClientColumns') {
      // READ-ONLY column-shift pre-condition scan (2026-07-06). Writes nothing.
      var scParams = (e && e.parameter) || {};
      if (payload && payload.secret) scParams.secret = payload.secret;
      if (!_columnRepairAuthOk(scParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_scanClientColumns());
    }
    if (action === 'setClinicalType') {
      var ctParams = (e && e.parameter) || {};
      if (payload && payload.secret) ctParams.secret = payload.secret;
      if (!_clinicalTypeAuthOk(ctParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_setClinicalType(payload));
    }
    if (action === 'deactivateClient') {
      var dcParams = (e && e.parameter) || {};
      if (payload && payload.secret) dcParams.secret = payload.secret;
      if (!_deactivateAuthOk(dcParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_deactivateClient(payload));
    }
    if (action === 'requestExtraSession') {
      var esParams = (e && e.parameter) || {};
      if (payload && payload.secret) esParams.secret = payload.secret;
      if (!_extraSessionAuthOk(esParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_requestExtraSession(payload));
    }
    if (action === 'approveExtraSession') return _json(_approveExtraSession(payload));
    if (action === 'recordSessionOutcome') {
      var soParams = (e && e.parameter) || {};
      if (payload && payload.secret) soParams.secret = payload.secret;
      if (!_sessionOutcomeAuthOk(soParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      // Cross-app receiver (therapists → /exec directly, no proxy): stamps
      // WHEN only — a caller-supplied `user` is never taken as updatedBy.
      return _json(_recordSessionOutcome(Object.assign({}, payload, { user: '' })));
    }
    if (action === 'correctSessionOutcome') {
      // Internal dashboard correction / add-missing-session path — מורן fixes an
      // outcome (or logs a session that was never recorded) from the payout
      // screen. Open, like the by-id resolveStopFlag / savePayment dashboard
      // writes (NOT the secured cross-app receiver). It runs the SAME
      // _recordSessionOutcome rules engine: pay + credit are RECOMPUTED and the
      // prior effect reversed (upsert by sessionId) — there is no raw amount
      // override. A new sessionId appends a fresh row; an existing one corrects in
      // place. forwardedToPayroll is preserved across the upsert.
      return _json(_recordSessionOutcome(payload));
    }
    if (action === 'markForwarded') {
      return _json(_markForwarded(payload));
    }
    if (action === 'getStopFlags') return _json(_getStopFlags());
    if (action === 'createStopAlert') {
      // INTERNAL write (same trust level as saveAll) — the outpatient app posts it
      // same-origin through the Node proxy; no cross-app secret.
      return _json(_createStopAlert(payload));
    }
    if (action === 'getStopAlerts') {
      var gsaParams = (e && e.parameter) || {};
      if (payload && payload.secret) gsaParams.secret = payload.secret;
      if (!_stopAlertsAuthOk(gsaParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_getStopAlerts());
    }
    if (action === 'markStopAlertRead') {
      var msaParams = (e && e.parameter) || {};
      if (payload && payload.secret) msaParams.secret = payload.secret;
      if (!_stopAlertsAuthOk(msaParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_markStopAlertRead(payload));
    }
    if (action === 'markStopAlertUnread') {
      var msuParams = (e && e.parameter) || {};
      if (payload && payload.secret) msuParams.secret = payload.secret;
      if (!_stopAlertsAuthOk(msuParams)) {
        return _json({ ok: false, error: 'unauthorized' });
      }
      return _json(_markStopAlertUnread(payload));
    }
    if (action === 'resumeTreatmentAlert') {
      // INTERNAL write (same trust level as createStopAlert) — the outpatient app
      // posts it same-origin through the Node proxy; no cross-app secret.
      return _json(_resumeTreatmentAlert(payload));
    }
    if (action === 'getMyStopAlerts') {
      // INTERNAL minimal read (same trust level as createStopAlert); no secret.
      return _json(_getMyStopAlerts());
    }
    if (action === 'getSessionLog') return _json(_getSessionLog());
    if (action === 'getContinuation') return _json(_getContinuation());
    if (action === 'saveContinuation') return _json(_saveContinuation(payload));
    if (action === 'resolveStopFlag') {
      // A request carrying a secret is the secured therapists-app receiver
      // (resolve by canonical phone, fail-closed). Without a secret it is the
      // internal dashboard path (resolve one row by id, open) — unchanged.
      if (payload && payload.secret != null) {
        return _json(_resolveStopFlagByPhone(payload));
      }
      return _json(_resolveStopFlag(payload.id, payload.resolvedBy));
    }
    if (action === 'mergeClients') {
      return _json(_mergeClients(payload));
    }
    // INTERNAL dashboard actions (same trust level as mergeClients): the
    // Clients-removed tombstone recovery surface.
    if (action === 'getRemovedClients') return _json(_getRemovedClients());
    if (action === 'restoreRemovedClient') return _json(_restoreRemovedClient(payload));
    if (action === 'saveSettings') {
      return _json(_saveSettings(payload.settings || {}));
    }
    if (action === 'savePayment' || action === 'updatePayment') {
      return _json(_upsertPayment(payload.payment));
    }
    if (action === 'savePaymentAmountOverride') {
      // INTERNAL write (same trust level as savePayment) — the outpatient app posts
      // it same-origin through the Node proxy; no cross-app secret.
      return _json(_setPaymentAmountOverride(payload));
    }
    if (action === 'repairStaleNextBilling') {
      // One-off stale nextBillingDate repair. INTERNAL (same trust level as
      // savePayment — posted same-origin through the Node proxy; no cross-app
      // secret). Dry-run unless apply === '1'; apply single-cell-writes
      // nextBillingDate only, never _writeAll.
      var rsApply = (payload && payload.apply != null)
        ? payload.apply
        : (e && e.parameter && e.parameter.apply);
      return _json(_repairStaleNextBilling(rsApply, payload && payload.today, _requestUser(payload)));
    }
    if (action === 'saveCharge' || action === 'updateCharge') {
      return _json(_upsertCharge(payload.charge));
    }
    if (action === 'removeCharge') {
      var chgId = payload.id || (payload.charge && payload.charge.id) || '';
      return _json(_removeCharge(chgId));
    }
    if (action === 'removePayment') {
      var pmtId = payload.id || (payload.payment && payload.payment.id) || '';
      return _json(_removePayment(pmtId));
    }
    if (action === 'removeChargesForClient') {
      return _json(_removeChargesForClient(payload.clientId));
    }
    if (action === 'removePaymentsForClient') {
      return _json(_removePaymentsForClient(payload.clientId));
    }
    if (action === 'removeLead') return _json(_removeLead(payload.lead, _requestUser(payload)));
    return _json({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

/* ===== Nightly integrity job (detection + backup) ===========================
 *
 * Second layer of defense after the _saveAll row-loss guard (2026-08-26
 * incident): a time-driven job (2:00 AM, project timezone Asia/Jerusalem —
 * pinned in appsscript.json) that DETECTS silent patient-row loss and keeps a
 * daily off-spreadsheet backup, independent of any save path.
 *
 * READ-ONLY contract: this job NEVER writes to the live Clients or Payments
 * sheets — not even a header relabel, which is why every live read goes
 * through getSheetByName (never _ensureSheet). Its only writes are Script
 * Properties, the separate EZONE-Backups spreadsheet, and the alert email.
 *
 * Three checks, in a FIXED ORDER (locked by test/nightly-integrity.test.js):
 *   1. Row-count sentinel — compare live row count/ids to the previous run's
 *      (Script Properties); a decrease whose ids lack a Clients-removed
 *      tombstone is the silent-loss signature. Runs BEFORE check 3: the
 *      missing rows' names are resolved from the NEWEST EXISTING snapshot
 *      (yesterday's), which the same-day snapshot overwrite would replace
 *      with a copy that no longer contains them.
 *   2. Orphan-payment sweep — every clientId across Payments must match a
 *      Clients row or a tombstone (orphaned payments were how the original
 *      incident surfaced).
 *   3. Daily snapshot — values-only copy of Clients into the EZONE-Backups
 *      spreadsheet, one sheet per day ('outpatient-YYYY-MM-DD' — prefixed so
 *      the Dashboard app's job can later share the same backup spreadsheet),
 *      then delete snapshot sheets older than 30 days.
 *
 * Alerting: ONE email per run, ONLY when something is wrong (no daily noise),
 * to the ALERT_EMAIL Script Property. Fail-open: no property / send failure
 * -> Logger.log the full report, never throw.
 *
 * Install once by running setupIntegrityTrigger() from the editor. */

var INTEGRITY_PROP_LAST_COUNT  = 'INTEGRITY_LAST_COUNT';
var INTEGRITY_PROP_LAST_IDS    = 'INTEGRITY_LAST_IDS';
var INTEGRITY_PROP_LAST_RUN    = 'INTEGRITY_LAST_RUN';
var INTEGRITY_PROP_BACKUP_SSID = 'INTEGRITY_BACKUP_SSID';
var INTEGRITY_PROP_ALERT_EMAIL = 'ALERT_EMAIL';
var INTEGRITY_BACKUP_NAME      = 'EZONE-Backups';
var INTEGRITY_RETENTION_DAYS   = 30;
var INTEGRITY_ALERT_SUBJECT    = '⚠️ E-ZONE: אי-התאמה בנתוני מטופלים';
/* Snapshot sheet names are app-prefixed: the backup spreadsheet will be
 * shared with the Dashboard app's own job later, so each app's snapshots and
 * retention must never collide. Keep the prefix and the STRICT matcher in
 * sync — the round-trip test locks them together. */
var INTEGRITY_SNAPSHOT_PREFIX = 'outpatient-';
var INTEGRITY_SNAPSHOT_RE = /^outpatient-(\d{4})-(\d{2})-(\d{2})$/;

/* ---- pure helpers (no GAS services — exercised directly by node --test) ---- */

/* Ids present in the previous run's list but absent from the current one. */
function _integrityDiffMissingIds(prevIds, currentIds) {
  var cur = {};
  for (var i = 0; i < (currentIds || []).length; i++) {
    var cid = currentIds[i] == null ? '' : String(currentIds[i]);
    if (cid) cur[cid] = true;
  }
  var missing = [];
  for (var j = 0; j < (prevIds || []).length; j++) {
    var pid = prevIds[j] == null ? '' : String(prevIds[j]);
    if (pid && !cur[pid]) missing.push(pid);
  }
  return missing;
}

/* clientId out of a payment id. Shapes (public/charges-logic.js):
 *   base monthly:    pay::<clientId>::base::<YYYY-MM>
 *   extra monthly:   pay::<clientId>::chg-<chargeId>::<YYYY-MM>
 *   one-time extra:  pay::<clientId>::chg-<chargeId>::once
 *   legacy (3-seg):  pay::<clientId>::<YYYY-MM>
 * Anything not shaped like pay::<clientId>::… -> '' (caller falls back to the
 * row's clientId column). */
function _integrityParsePaymentClientId(paymentId) {
  var parts = String(paymentId == null ? '' : paymentId).split('::');
  if (parts.length < 3 || parts[0] !== 'pay') return '';
  return parts[1] || '';
}

/* Unique payment clientIds with NEITHER a live Clients row NOR a tombstone.
 * clientId is parsed from the payment id (authoritative — it was built from
 * the client row), falling back to the row's clientId column. */
function _integrityOrphanClientIds(paymentRows, liveIdSet, tombstoneIdSet) {
  var seen = {};
  var orphans = [];
  for (var i = 0; i < (paymentRows || []).length; i++) {
    var row = paymentRows[i] || {};
    var cid = _integrityParsePaymentClientId(row.id);
    if (!cid) cid = row.clientId == null ? '' : String(row.clientId);
    if (!cid || seen[cid]) continue;
    seen[cid] = true;
    if (!liveIdSet[cid] && !tombstoneIdSet[cid]) orphans.push(cid);
  }
  return orphans;
}

/* 'outpatient-YYYY-MM-DD' from a Date's LOCAL parts — the runtime clock is
 * the project timezone (Asia/Jerusalem), so the day rolls at local midnight. */
function _integritySnapshotName(date) {
  var m = date.getMonth() + 1;
  var d = date.getDate();
  return INTEGRITY_SNAPSHOT_PREFIX + date.getFullYear() +
    '-' + (m < 10 ? '0' + m : String(m)) +
    '-' + (d < 10 ? '0' + d : String(d));
}

/* Retention date math over SHEET NAMES. Strict: only names matching the
 * prefixed snapshot format can ever expire — every other sheet (another
 * app's snapshots, a manual tab) is untouchable. Expired = strictly older
 * than retentionDays days before today. */
function _integrityIsExpiredSnapshot(sheetName, todayName, retentionDays) {
  var m = INTEGRITY_SNAPSHOT_RE.exec(String(sheetName == null ? '' : sheetName));
  if (!m) return false;
  var t = INTEGRITY_SNAPSHOT_RE.exec(String(todayName == null ? '' : todayName));
  if (!t) return false;
  var ageDays = (Date.UTC(+t[1], +t[2] - 1, +t[3]) - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86400000;
  return ageDays > retentionDays;
}

/* ---- GAS-facing helpers ---------------------------------------------------- */

/* Newest existing snapshot sheet in the backup spreadsheet (zero-padded ISO
 * names under a fixed prefix -> lexicographic order is chronological). */
function _integrityLatestSnapshotSheet(backupSs) {
  if (!backupSs) return null;
  var sheets = backupSs.getSheets();
  var best = null, bestName = '';
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (INTEGRITY_SNAPSHOT_RE.test(name) && name > bestName) { best = sheets[i]; bestName = name; }
  }
  return best;
}

/* id -> name map for the given ids, read from one snapshot sheet (columns
 * located via the snapshot's own header row, so a future CLIENTS_HEADERS
 * append can't break old snapshots). Unresolvable -> ''. */
function _integrityLookupNames(snapshotSheet, ids) {
  var names = {};
  for (var i = 0; i < ids.length; i++) names[ids[i]] = '';
  if (!snapshotSheet || !ids.length) return names;
  try {
    var vals = snapshotSheet.getDataRange().getValues();
    if (vals.length < 2) return names;
    var idCol = vals[0].indexOf('id');
    var nameCol = vals[0].indexOf('name');
    if (idCol === -1 || nameCol === -1) return names;
    for (var r = 1; r < vals.length; r++) {
      var id = String(vals[r][idCol]);
      if (Object.prototype.hasOwnProperty.call(names, id) && !names[id]) {
        names[id] = vals[r][nameCol] == null ? '' : String(vals[r][nameCol]);
      }
    }
  } catch (_) {}
  return names;
}

/* Write today's values-only snapshot into the BACKUP spreadsheet (only —
 * never the live one). Idempotent for a same-day re-run: an existing sheet
 * with today's name is cleared and rewritten in place (never deleted first,
 * so this also works when it is the spreadsheet's only sheet). */
function _integrityWriteSnapshot(backupSs, snapName, grid) {
  var sh = backupSs.getSheetByName(snapName);
  if (sh) sh.clear();
  else sh = backupSs.insertSheet(snapName);
  if (grid && grid.length) {
    sh.getRange(1, 1, grid.length, grid[0].length).setValues(grid);
  }
  // A just-created backup spreadsheet's default sheet is dead weight once a
  // snapshot exists; drop it (guarded — never a snapshot, never the last sheet).
  var def = backupSs.getSheetByName('Sheet1') || backupSs.getSheetByName('גיליון1');
  if (def && !INTEGRITY_SNAPSHOT_RE.test(def.getName()) && backupSs.getSheets().length > 1) {
    backupSs.deleteSheet(def);
  }
  return sh;
}

/* Delete OUR expired snapshot sheets from the backup spreadsheet. Strictly
 * name-matched via _integrityIsExpiredSnapshot; never deletes the last
 * remaining sheet (Sheets requires >= 1). */
function _integrityApplyRetention(backupSs, todayName, retentionDays) {
  var sheets = backupSs.getSheets();
  var deleted = [];
  for (var i = 0; i < sheets.length; i++) {
    if (backupSs.getSheets().length <= 1) break;
    var name = sheets[i].getName();
    if (_integrityIsExpiredSnapshot(name, todayName, retentionDays)) {
      backupSs.deleteSheet(sheets[i]);
      deleted.push(name);
    }
  }
  return deleted;
}

/* Hebrew alert body from a plain report object (pure — unit-tested). */
function _integrityAlertBody(report) {
  var lines = [];
  lines.push('בדיקת שלמות הנתונים הלילית (nightlyIntegrityJob) מצאה אי-התאמות:');
  if (report.missing && report.missing.length) {
    lines.push('');
    lines.push('שורות מטופלים שנעלמו מגיליון Clients ללא רישום מחיקה (Clients-removed):');
    for (var i = 0; i < report.missing.length; i++) {
      lines.push('  • ' + report.missing[i].id + (report.missing[i].name ? ' — ' + report.missing[i].name : ''));
    }
    lines.push('ספירת שורות בריצה הקודמת: ' + report.prevCount + ' | ספירה נוכחית: ' + report.currentCount);
  }
  if (report.orphans && report.orphans.length) {
    lines.push('');
    lines.push('תשלומים (Payments) ללא שורת מטופל תואמת וללא רישום מחיקה:');
    for (var j = 0; j < report.orphans.length; j++) {
      lines.push('  • ' + report.orphans[j].id + (report.orphans[j].name ? ' — ' + report.orphans[j].name : ''));
    }
  }
  if (report.errors && report.errors.length) {
    lines.push('');
    lines.push('שגיאות פנימיות במהלך הבדיקה:');
    for (var k = 0; k < report.errors.length; k++) {
      lines.push('  • ' + report.errors[k]);
    }
  }
  return lines.join('\n');
}

/* One email per run, only when called (i.e. something is wrong). Fail-open:
 * no ALERT_EMAIL property, or a send failure -> Logger.log the report and
 * return false; NEVER throw (an alerting failure must not kill the job). */
function _integritySendAlert(body) {
  var email = '';
  try {
    email = PropertiesService.getScriptProperties().getProperty(INTEGRITY_PROP_ALERT_EMAIL) || '';
  } catch (_) {}
  if (!email) {
    Logger.log('INTEGRITY ALERT (no ' + INTEGRITY_PROP_ALERT_EMAIL + ' Script Property — email not sent):\n' + body);
    return false;
  }
  try {
    MailApp.sendEmail(email, INTEGRITY_ALERT_SUBJECT, body);
    return true;
  } catch (err) {
    Logger.log('INTEGRITY ALERT send failed (' + err + '):\n' + body);
    return false;
  }
}

/* The 2:00 AM trigger handler. Each check runs in its own try/catch so one
 * failure never silences the others; internal errors join the alert. */
function nightlyIntegrityJob() {
  var props = PropertiesService.getScriptProperties();
  var errors = [];

  // ---- read-only reads of the live data (getSheetByName, NEVER _ensureSheet:
  //      this job must not write to Clients/Payments, not even a header
  //      relabel) ----
  var clients = [], clientsGrid = null, clientsReadOk = false;
  try {
    var clientsSh = _ss().getSheetByName('Clients');
    if (clientsSh) {
      clients = _readAll(clientsSh, CLIENTS_HEADERS);
      clientsGrid = clientsSh.getDataRange().getValues();
    }
    clientsReadOk = true;
  } catch (err) { errors.push('קריאת Clients נכשלה: ' + err); }

  var payments = [];
  try {
    var paymentsSh = _ss().getSheetByName('Payments');
    if (paymentsSh) payments = _readAll(paymentsSh, PAYMENTS_HEADERS);
  } catch (err) { errors.push('קריאת Payments נכשלה: ' + err); }

  var tombstoneIdSet = {};
  try {
    var tombSh = _ss().getSheetByName('Clients-removed');
    var tombs = tombSh ? _readAll(tombSh, CLIENTS_REMOVED_HEADERS) : [];
    for (var t = 0; t < tombs.length; t++) {
      var tid = tombs[t] && tombs[t].id != null ? String(tombs[t].id) : '';
      if (tid) tombstoneIdSet[tid] = true;
    }
  } catch (err) { errors.push('קריאת Clients-removed נכשלה: ' + err); }

  var currentIds = [], liveIdSet = {};
  for (var c = 0; c < clients.length; c++) {
    var cid = clients[c] && clients[c].id != null ? String(clients[c].id) : '';
    if (cid) { currentIds.push(cid); liveIdSet[cid] = true; }
  }

  // ---- open (never create yet) the backup spreadsheet: check 1 resolves
  //      names from the NEWEST EXISTING snapshot (yesterday's), so this open
  //      and the lookup MUST happen before check 3 overwrites today's sheet ----
  var backupSs = null;
  var backupSsid = props.getProperty(INTEGRITY_PROP_BACKUP_SSID);
  if (backupSsid) {
    try { backupSs = SpreadsheetApp.openById(backupSsid); }
    catch (err) {
      backupSs = null; // trashed/gone -> check 3 recreates it
      errors.push('פתיחת גיליון הגיבוי (' + backupSsid + ') נכשלה: ' + err);
    }
  }

  // ---- CHECK 1: row-count sentinel (ALWAYS before the check-3 snapshot
  //      overwrite — see ordering note above) ----
  var missing = [];
  var prevCountRaw = props.getProperty(INTEGRITY_PROP_LAST_COUNT);
  try {
    if (clientsReadOk && prevCountRaw !== null && clients.length < Number(prevCountRaw)) {
      var prevIds = [];
      try { prevIds = JSON.parse(props.getProperty(INTEGRITY_PROP_LAST_IDS) || '[]'); } catch (_) {}
      if (!Array.isArray(prevIds)) prevIds = [];
      var missingIds = _integrityDiffMissingIds(prevIds, currentIds);
      var names = _integrityLookupNames(_integrityLatestSnapshotSheet(backupSs), missingIds);
      for (var m = 0; m < missingIds.length; m++) {
        // A tombstone (restored or not) means the drop was RECORDED — only an
        // unrecorded disappearance is the silent-loss signature.
        if (!tombstoneIdSet[missingIds[m]]) {
          missing.push({ id: missingIds[m], name: names[missingIds[m]] || '' });
        }
      }
    }
  } catch (err) { errors.push('בדיקת ספירת השורות נכשלה: ' + err); }

  // ---- CHECK 2: orphan-payment sweep ----
  var orphans = [];
  try {
    var orphanIds = _integrityOrphanClientIds(payments, liveIdSet, tombstoneIdSet);
    for (var o = 0; o < orphanIds.length; o++) {
      var oname = '';
      for (var p = 0; p < payments.length; p++) {
        var pcid = _integrityParsePaymentClientId(payments[p].id) ||
          (payments[p].clientId == null ? '' : String(payments[p].clientId));
        if (pcid === orphanIds[o] && payments[p].clientName) { oname = String(payments[p].clientName); break; }
      }
      orphans.push({ id: orphanIds[o], name: oname });
    }
  } catch (err) { errors.push('בדיקת תשלומים יתומים נכשלה: ' + err); }

  // ---- CHECK 3: daily snapshot + retention (AFTER check 1's name lookup) ----
  try {
    if (clientsGrid && clientsGrid.length) {
      if (!backupSs) {
        backupSs = SpreadsheetApp.create(INTEGRITY_BACKUP_NAME);
        props.setProperty(INTEGRITY_PROP_BACKUP_SSID, backupSs.getId());
      }
      var todayName = _integritySnapshotName(new Date());
      _integrityWriteSnapshot(backupSs, todayName, clientsGrid);
      var deleted = _integrityApplyRetention(backupSs, todayName, INTEGRITY_RETENTION_DAYS);
      if (deleted.length) Logger.log('nightlyIntegrityJob: retention deleted %s', deleted.join(', '));
    }
  } catch (err) { errors.push('הגיבוי היומי נכשל: ' + err); }

  // ---- alert: one email per run, ONLY when something is wrong ----
  if (missing.length || orphans.length || errors.length) {
    _integritySendAlert(_integrityAlertBody({
      missing: missing,
      orphans: orphans,
      errors: errors,
      prevCount: prevCountRaw === null ? '?' : String(prevCountRaw),
      currentCount: String(clients.length)
    }));
  } else {
    Logger.log('nightlyIntegrityJob: ok (clients=%s, payments=%s)', String(clients.length), String(payments.length));
  }

  // ---- persist the sentinel state for tomorrow's run — but only off a
  //      SUCCESSFUL Clients read: seeding count 0 after a failed read would
  //      fire a false full-loss alert tomorrow ----
  if (clientsReadOk) {
    props.setProperty(INTEGRITY_PROP_LAST_COUNT, String(clients.length));
    props.setProperty(INTEGRITY_PROP_LAST_IDS, JSON.stringify(currentIds));
    props.setProperty(INTEGRITY_PROP_LAST_RUN, new Date().toISOString());
  }
}

/* One-time installer (run from the Apps Script editor). Idempotent: deletes
 * every existing trigger bound to nightlyIntegrityJob before creating the
 * single 2:00 AM daily trigger (project timezone: Asia/Jerusalem). */
function setupIntegrityTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'nightlyIntegrityJob') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('nightlyIntegrityJob').timeBased().everyDays(1).atHour(2).create();
  return { ok: true, installed: 'nightlyIntegrityJob @ 02:00' };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Corrupted-rows cleanup (U+FFFD repair pipeline) — ported from the Dashboard
 * app's shipped design (E-Zone-Dashboard PRs #105/#107/#108), reimplemented
 * for THIS backend's architecture.
 *
 * Background: the Dashboard app's server.js had a UTF-8 chunk-split bug
 * (2026-07-27 → 2026-08-31) that replaced split Hebrew characters with U+FFFD
 * ('�'). Outpatient's own read path was never at risk, but corrupted rows
 * arrived HERE through the Dashboard→Outpatient createLead handoff (corrupted
 * lead name/note at arrival) and then spread on conversion/edit into Clients
 * and every sheet that copies a name (Payments.clientName,
 * SessionLog.patientName, stop flags/alerts, …).
 *
 * Pipeline (all five entry points are PUBLIC — run them from the Apps Script
 * editor's Run dropdown — and deliberately NOT reachable through doGet/doPost;
 * a guard test locks that):
 *   1. harvestRevisionSnapshotsNow — exports a spread of this spreadsheet's
 *      own Drive revisions across the corruption window and rebuilds each as
 *      a Sheets file named EZONE-OUT-SNAPSHOT-AUTO-<yyyy-MM-dd> (the OUT
 *      prefix keeps outpatient snapshots disjoint from the Dashboard app's
 *      EZONE-SNAPSHOT-* files). Idempotent; per-revision failure isolation.
 *   2. scanCorruptedRowsNow — DRY RUN, zero writes: scans every target
 *      sheet/column for U+FFFD and logs one proposal per corrupted cell,
 *      classified by the tier system below.
 *   3. writeRepairPlanNow — writes the proposals into the hidden RepairPlan
 *      sheet, everything approved=FALSE, for Sandra to review/edit/approve.
 *   4. applyCorruptedRowRepairsNow — executes ONLY approved=TRUE rows, under
 *      the script lock, re-verifying oldValue before every SINGLE-CELL write
 *      (getRange(...).setValue — NEVER _writeAll, so a concurrent save can
 *      never be clobbered). Every applied/skipped row is audit-logged.
 *   5. deleteAutoSnapshotsNow — trashes EZONE-OUT-SNAPSHOT-AUTO-* only.
 *
 * Repair tiers (priority order; a machine must NEVER guess):
 *   tier 0 — cross-reference: a Clients row's originating Leads row
 *            (fromLead) with a clean name; or a clean row elsewhere sharing a
 *            normalized phone (name columns only).
 *   tier 1 — snapshot: relocate the row in a snapshot by its stable key
 *            (id / sessionId / key), phone fallback for the Clients family;
 *            2+ key hits → ambiguous, NO proposal. The snapshot value must
 *            pass the compatibility guard (surviving non-U+FFFD segments
 *            appear in order, each U+FFFD run stands for 1+ characters,
 *            anchored at both ends). Snapshot columns are mapped by the
 *            snapshot's OWN header row (schemas are append-only, so older
 *            snapshots simply lack trailing columns).
 *   tier 2 — closed value sets (enum columns only, never free text):
 *            exactly ONE legal value compatible with the corrupted cell.
 *   tier 3 — clean-name roster from every live target sheet + every
 *            snapshot: exactly ONE compatible name (name columns only).
 *            Bonus: twin-merge — two same-key rows (live sheet + its family
 *            sheet, e.g. Clients / Clients-removed) corrupted in DIFFERENT
 *            positions whose union reconstructs the full clean string.
 *
 * ⚠️ THERAPIST NAMES (TherapistRates.name, SessionLog.therapist,
 * ExtraSessionRequests.therapist) must stay EXACTLY matched to the
 * therapists app's roster — payout matching is fail-closed on the name.
 * Proposals for those columns carry a loud 'THERAPIST-NAME — verify
 * cross-app' suffix in the plan's source column: verify against the
 * therapists app before approving. Client name columns used in cross-app
 * phone/name matching carry a similar 'CLIENT-NAME' suffix. */

var CORRUPTION_MARK = '�'; // '�'

var REPAIR_PLAN_SHEET = 'RepairPlan';
/* APPEND-ONLY like every header array in this file; the exact order is
 * pinned by test/corrupted-rows-cleanup.test.js. */
var REPAIR_PLAN_HEADERS = ['sheet', 'row', 'column', 'newValue', 'action', 'approved', 'oldValue', 'source'];

/* Minimal hidden append-only audit log (this repo had no AuditLog pattern —
 * introduced here, same design as the Dashboard app's). Rows are appended,
 * never rewritten or deleted. */
var AUDIT_LOG_SHEET = 'AuditLog';
var AUDIT_LOG_HEADERS = ['timestamp', 'action', 'fn', 'rowKey', 'name', 'details'];

/* Snapshot prefixes. EZONE-OUT-SNAPSHOT (not the Dashboard's EZONE-SNAPSHOT)
 * so the two apps' snapshots can never cross: this app's discovery only sees
 * OUT-prefixed files, and its cleanup only trashes OUT-AUTO-prefixed ones. */
var SNAPSHOT_NAME_PREFIX = 'EZONE-OUT-SNAPSHOT';
var AUTO_SNAPSHOT_PREFIX = SNAPSHOT_NAME_PREFIX + '-AUTO-'; // EZONE-OUT-SNAPSHOT-AUTO-

var CORRUPTION_BUG_LIVE_DATE = '2026-07-27';   // Dashboard server.js chunk-split went live
var CORRUPTION_WINDOW_END_DATE = '2026-09-01'; // day after the Dashboard fix deployed (2026-08-31)
var XLSX_EXPORT_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* Loud plan-source suffixes for cross-app-sensitive columns. */
var THERAPIST_NAME_SUFFIX = ' — THERAPIST-NAME — verify cross-app';
var CLIENT_NAME_SUFFIX = ' — CLIENT-NAME — used in cross-app phone/name matching, verify';

/* MIRROR of public/app.js LOCATIONS (the סניף source of truth). The Apps
 * Script runtime cannot import that module, so the list is duplicated here —
 * test/corrupted-rows-cleanup.test.js asserts it deep-equals the frontend
 * literal, exactly like the CLINICAL_TO_BILLING mirror. Keep in sync. */
var CORRUPTION_LOCATIONS = ['רעננה הפרדס', 'רעננה אשר', 'רמות השבים', 'קיסריה גמילה', 'קיסריה עפרוני'];

/* Lead stages as STORED on the Leads sheet (public/app.js writes the Hebrew
 * label via idToHe): the three kanban stages + the legacy alias + לא רלוונטי. */
var CORRUPTION_LEAD_STAGES = ['פרטים אישיים', 'שיחת היכרות', 'תוכנית טיפול', 'הסכם נחתם', 'לא רלוונטי'];

/* Client statuses as stored on Clients.status. */
var CORRUPTION_CLIENT_STATUSES = ['פעיל', 'סיים טיפול', 'לא פעיל'];

function _hasCorruption(v) {
  return typeof v === 'string' ? v.indexOf(CORRUPTION_MARK) >= 0 :
    String(v == null ? '' : v).indexOf(CORRUPTION_MARK) >= 0;
}

/* Phone key for cross-reference matching, per the ecosystem rule: normalize
 * through _recoverPhone (strips separators, 972→0, restores a leading zero
 * Sheets dropped) and accept ONLY a full /^0\d{9}$/ mobile-length match —
 * anything else returns '' and never participates in matching. */
function _corruptionPhoneKey(raw) {
  var p = _recoverPhone(raw);
  return /^0\d{9}$/.test(p) ? p : '';
}

/* The shared compatibility/wildcard rule for every tier: split the corrupted
 * value on runs of U+FFFD and require the surviving segments to appear IN
 * ORDER in the candidate, with each U+FFFD run standing for 1+ characters
 * (a run always replaced at least one original character — a Hebrew char is
 * 2 UTF-8 bytes, so a run may stand for FEWER chars than its length, never
 * zero). Anchored: surviving leading/trailing text must lead/trail the
 * candidate too. This is both tier 1's sanity guard and tiers 2–3's matcher. */
function _corruptionWildcardRegex(corrupted) {
  var parts = String(corrupted).split(/�+/);
  var esc = parts.map(function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
  return new RegExp('^' + esc.join('[\\s\\S]+') + '$');
}

/* Exactly-one-match helper for the enum and roster tiers: returns
 * {count, value} where value is set only when EXACTLY ONE candidate matches
 * the corrupted value under the wildcard rule. 0 or 2+ → manual. */
function _corruptionMatchOne(corrupted, candidates) {
  var re = _corruptionWildcardRegex(corrupted);
  var hit = '';
  var count = 0;
  for (var i = 0; i < candidates.length; i++) {
    if (re.test(candidates[i])) {
      count++;
      if (count === 1) hit = candidates[i]; else break;
    }
  }
  return { count: count, value: count === 1 ? hit : '' };
}

/* Tier 3 bonus — merge two same-length strings corrupted in DIFFERENT
 * positions: where one has U+FFFD the other must be clean, and where both
 * are clean they must agree. Returns the reconstructed string, or '' when
 * the union cannot fully reconstruct. */
function _corruptionTwinMerge(a, b) {
  a = String(a);
  b = String(b);
  if (a.length === 0 || a.length !== b.length) return '';
  var out = '';
  for (var i = 0; i < a.length; i++) {
    var ca = a.charAt(i);
    var cb = b.charAt(i);
    if (ca === CORRUPTION_MARK && cb === CORRUPTION_MARK) return '';
    if (ca !== CORRUPTION_MARK && cb !== CORRUPTION_MARK && ca !== cb) return '';
    out += (ca === CORRUPTION_MARK) ? cb : ca;
  }
  return out;
}

/* The sheets + columns where free-text / Hebrew-enum values live — the scan
 * targets (Phase 1 enumeration, one entry per sheet holding Hebrew text).
 * Date/number/English-key columns are deliberately absent: U+FFFD cannot
 * appear in them unless the row is damaged beyond a text repair.
 *   headers   — the sheet's positional header array (append-only)
 *   keyCol    — the stable row key tier 1 relocates by ('' = no reliable
 *               key: TherapistRates is keyed by the very column that may be
 *               corrupted, so it repairs from enum/roster only)
 *   family    — sibling sheets rows migrate between (Clients ↔
 *               Clients-removed, Leads ↔ לידים שהוסרו): tier 1 searches the
 *               row's own sheet first, then the family
 *   leadIdCol — Clients-family column referencing the originating lead
 *   textCols  — columns scanned for U+FFFD
 *   phoneCols — columns whose digits feed the phone cross-reference
 *   nameCol   — the sheet's person-name column (lead/phone/roster repairs
 *               propose values only for THIS column)
 *   enumCols  — {column: valueClass} closed-set columns tier 2 may repair;
 *               free-text columns (note/notes/…) are deliberately absent
 *   crossAppCols — {column: suffix} appended to the plan's source for
 *               cross-app-sensitive columns (therapist / client names) */
function _corruptionScanTargets() {
  var clientText = ['name', 'serviceType', 'location', 'status', 'notes', 'source',
    'payerName', 'sessionsPerWeek', 'paymentStatus', 'clinicalTreatmentType', 'assignedTo'];
  var clientEnums = { serviceType: 'billingService', location: 'location', status: 'clientStatus',
    paymentStatus: 'paymentStatus', clinicalTreatmentType: 'clinicalType', assignedTo: 'assignee' };
  var clientPhones = ['phone', 'treatmentContactPhone', 'payerPhone'];
  var clientCross = { name: CLIENT_NAME_SUFFIX };
  var leadText = ['name', 'serviceType', 'location', 'note', 'stage',
    'not_relevant_reason', 'not_relevant_note', 'assignedTo'];
  var leadEnums = { serviceType: 'billingService', location: 'location',
    stage: 'leadStage', assignedTo: 'assignee' };
  var clientsFamily = ['Clients', 'Clients-removed'];
  var leadsFamily = ['Leads', 'לידים שהוסרו'];
  return [
    { sheet: 'Clients',              headers: CLIENTS_HEADERS,         keyCol: 'id',        family: clientsFamily, leadIdCol: 'fromLead', textCols: clientText, phoneCols: clientPhones, nameCol: 'name',        enumCols: clientEnums, crossAppCols: clientCross },
    { sheet: 'Clients-removed',      headers: CLIENTS_REMOVED_HEADERS, keyCol: 'id',        family: clientsFamily, leadIdCol: 'fromLead', textCols: clientText, phoneCols: clientPhones, nameCol: 'name',        enumCols: clientEnums, crossAppCols: clientCross },
    { sheet: 'Leads',                headers: LEADS_HEADERS,           keyCol: 'id',        family: leadsFamily,   leadIdCol: '',         textCols: leadText,   phoneCols: ['phone'],    nameCol: 'name',        enumCols: leadEnums,   crossAppCols: {} },
    { sheet: 'לידים שהוסרו',         headers: REMOVED_LEADS_HEADERS,   keyCol: 'id',        family: leadsFamily,   leadIdCol: '',         textCols: leadText,   phoneCols: ['phone'],    nameCol: 'name',        enumCols: leadEnums,   crossAppCols: {} },
    { sheet: 'Payments',             headers: PAYMENTS_HEADERS,        keyCol: 'id',        family: [],            leadIdCol: '',         textCols: ['clientName', 'status', 'method', 'notes'], phoneCols: [], nameCol: 'clientName', enumCols: { status: 'paymentStatus' }, crossAppCols: {} },
    { sheet: 'ClientCharges',        headers: CHARGES_HEADERS,         keyCol: 'id',        family: [],            leadIdCol: '',         textCols: ['description', 'notes'], phoneCols: [], nameCol: '',         enumCols: {},          crossAppCols: {} },
    { sheet: 'SessionLog',           headers: SESSION_LOG_HEADERS,     keyCol: 'sessionId', family: [],            leadIdCol: '',         textCols: ['patientName', 'therapist', 'clinicalTreatmentType'], phoneCols: ['phone'], nameCol: 'patientName', enumCols: { clinicalTreatmentType: 'clinicalType', therapist: 'therapistName' }, crossAppCols: { therapist: THERAPIST_NAME_SUFFIX, patientName: CLIENT_NAME_SUFFIX } },
    { sheet: THERAPIST_RATES_SHEET,  headers: THERAPIST_RATES_HEADERS, keyCol: '',          family: [],            leadIdCol: '',         textCols: ['name'],   phoneCols: [],           nameCol: 'name',        enumCols: { name: 'therapistName' }, crossAppCols: { name: THERAPIST_NAME_SUFFIX } },
    { sheet: 'StopFlags',            headers: STOP_FLAGS_HEADERS,      keyCol: 'id',        family: [],            leadIdCol: '',         textCols: ['name', 'note', 'reportedBy', 'resolvedBy'], phoneCols: ['phone'], nameCol: 'name', enumCols: {}, crossAppCols: {} },
    { sheet: STOP_ALERTS_SHEET,      headers: STOP_ALERTS_HEADERS,     keyCol: 'id',        family: [],            leadIdCol: '',         textCols: ['clientName', 'createdBy', 'note'], phoneCols: [], nameCol: 'clientName', enumCols: {}, crossAppCols: {} },
    { sheet: 'ExtraSessionRequests', headers: EXTRA_SESSION_HEADERS,   keyCol: 'id',        family: [],            leadIdCol: '',         textCols: ['patientName', 'treatmentType', 'therapist', 'requestedBy', 'note'], phoneCols: ['phone'], nameCol: 'patientName', enumCols: { therapist: 'therapistName' }, crossAppCols: { therapist: THERAPIST_NAME_SUFFIX } },
    { sheet: CONTINUATION_SHEET,     headers: CONTINUATION_HEADERS,    keyCol: 'key',       family: [],            leadIdCol: '',         textCols: ['name', 'house', 'note'], phoneCols: [], nameCol: 'name',   enumCols: {},          crossAppCols: {} },
    { sheet: 'Settings',             headers: SETTINGS_HEADERS,        keyCol: 'key',       family: [],            leadIdCol: '',         textCols: ['value'],  phoneCols: [],           nameCol: '',            enumCols: {},          crossAppCols: {} }
  ];
}

/* Read a target sheet's data rows WITH their 1-based sheet row numbers.
 * getSheetByName only — the scanner must not even create a sheet. Fully-empty
 * rows are skipped (mirrors _readAll) but row numbers stay true. Values are
 * kept RAW (no date formatting, no phone recovery) so oldValue in the plan is
 * exactly what the cell holds. Returns null when the sheet is absent. */
function _corruptionReadRows(target) {
  var sh = _ss().getSheetByName(target.sheet);
  if (!sh) return null;
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var values = sh.getRange(2, 1, lastRow - 1, target.headers.length).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var hasContent = false;
    for (var j = 0; j < row.length; j++) {
      if (row[j] !== '' && row[j] !== null) { hasContent = true; break; }
    }
    if (!hasContent) continue;
    var obj = {};
    for (var c = 0; c < target.headers.length; c++) obj[target.headers[c]] = row[c];
    rows.push({ rowNumber: i + 2, obj: obj });
  }
  return rows;
}

/* Locate snapshot spreadsheets: every Drive spreadsheet whose name starts
 * with EZONE-OUT-SNAPSHOT, READ-ONLY (opened, never written). Priority order
 * is OLDEST content first — a name ending in an encoded yyyy-MM-dd date (the
 * harvested AUTO files) sorts by THAT date (all harvested files are CREATED
 * at harvest time, so lastUpdated says nothing about content age); a
 * snapshot without an encoded date (a manual copy) keeps lastUpdated as its
 * key. Fail-soft everywhere: no Drive access / no snapshot just shrinks the
 * list (tiers 2–3 run regardless). The live spreadsheet itself is excluded
 * even if renamed to match the prefix. */
function _corruptionSnapshots() {
  var found = [];
  var seen = {};
  var activeId = '';
  try { activeId = _ss().getId(); } catch (_) { /* fake env */ }
  var collect = function (iter) {
    while (iter && iter.hasNext()) {
      var f = iter.next();
      var name = String(f.getName());
      if (name.indexOf(SNAPSHOT_NAME_PREFIX) !== 0) continue;
      var id = String(f.getId());
      if (seen[id] || id === activeId) continue;
      seen[id] = true;
      var updated = 0;
      try { updated = f.getLastUpdated().getTime(); } catch (_) { /* keep 0 → highest priority */ }
      var encoded = name.match(/(\d{4}-\d{2}-\d{2})$/);
      var encodedMs = encoded ? Date.parse(encoded[1]) : NaN;
      found.push({ id: id, name: name, sortKey: isNaN(encodedMs) ? updated : encodedMs });
    }
  };
  try {
    collect(DriveApp.searchFiles('title contains "' + SNAPSHOT_NAME_PREFIX + '"'));
  } catch (e) {
    try { collect(DriveApp.getFilesByName(SNAPSHOT_NAME_PREFIX)); } catch (_) { /* no Drive at all */ }
  }
  found.sort(function (a, b) { return a.sortKey - b.sortKey; });
  var out = [];
  found.forEach(function (f) {
    try {
      out.push({ name: f.name, ss: SpreadsheetApp.openById(f.id) });
    } catch (e) {
      Logger.log('snapshot "' + f.name + '" could not be opened as a spreadsheet — skipped (' + e + ')');
    }
  });
  return out;
}

/* Read one snapshot sheet's data rows keyed by ITS OWN header row — the
 * column-position tolerance: every schema here is append-only, so mapping by
 * the snapshot's headers lines each logical column up with today's name, and
 * a column the snapshot lacks simply reads as undefined. READ-ONLY. Returns
 * null when the sheet is absent. */
function _corruptionSnapshotRows(ss, sheetName) {
  var sh = null;
  try { sh = ss.getSheetByName(sheetName); } catch (_) { sh = null; }
  if (!sh) return null;
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h); });
  var values = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var hasContent = false;
    for (var j = 0; j < row.length; j++) {
      if (row[j] !== '' && row[j] !== null) { hasContent = true; break; }
    }
    if (!hasContent) continue;
    var obj = {};
    for (var h = 0; h < headers.length; h++) {
      if (headers[h] !== '') obj[headers[h]] = row[h];
    }
    rows.push({ rowNumber: i + 2, obj: obj });
  }
  return rows;
}

/* Index one snapshot for matching: per target sheet, rows by stable key and
 * (Clients family) by normalized phone; plus every clean person name for the
 * roster tier. */
function _corruptionSnapshotIndex(snap, targets) {
  var idx = { name: snap.name, bySheet: {}, names: [], namesSeen: {} };
  var addName = function (v) {
    var s = String(v == null ? '' : v).trim();
    if (s === '' || _hasCorruption(s) || idx.namesSeen[s]) return;
    idx.namesSeen[s] = true;
    idx.names.push(s);
  };
  targets.forEach(function (t) {
    var rows = _corruptionSnapshotRows(snap.ss, t.sheet);
    if (!rows) return;
    var byKey = {};
    var byPhone = {};
    rows.forEach(function (r) {
      if (t.nameCol) addName(r.obj[t.nameCol]);
      if (t.keyCol) {
        var key = String(r.obj[t.keyCol] == null ? '' : r.obj[t.keyCol]).trim();
        if (key) {
          if (!byKey[key]) byKey[key] = [];
          byKey[key].push(r);
        }
      }
      (t.phoneCols || []).forEach(function (pc) {
        var pk = _corruptionPhoneKey(r.obj[pc]);
        if (!pk) return;
        if (!byPhone[pk]) byPhone[pk] = [];
        byPhone[pk].push(r);
      });
    });
    idx.bySheet[t.sheet] = { byKey: byKey, byPhone: byPhone };
  });
  return idx;
}

/* Find THE snapshot row for a live row: by the sheet's stable key first (own
 * sheet, then the family sheets — a row may have moved, e.g. Clients →
 * Clients-removed), then by normalized phone as the fallback (Clients family
 * only — the ecosystem phone rule). 2+ candidates in whichever pool answered
 * → ambiguous: {row:null, why} and NO proposal — a machine must not guess. */
function _corruptionSnapshotMatchRow(idx, t, rowObj) {
  if (!t.keyCol) return { row: null, why: '' };
  var order = [t.sheet].concat((t.family || []).filter(function (nm) { return nm !== t.sheet; }));
  var key = String(rowObj[t.keyCol] == null ? '' : rowObj[t.keyCol]).trim();
  var i, pool;
  if (key) {
    for (i = 0; i < order.length; i++) {
      pool = idx.bySheet[order[i]];
      if (!pool || !pool.byKey[key]) continue;
      if (pool.byKey[key].length === 1) return { row: pool.byKey[key][0], sheet: order[i], why: '' };
      return { row: null, sheet: '', why: pool.byKey[key].length + ' rows in ' + order[i] +
        ' share ' + t.keyCol + ' ' + key + ' — ambiguous, no proposal' };
    }
  }
  // Phone fallback: exactly one snapshot row sharing any of the live row's
  // normalized phones (only sheets that carry phone columns index byPhone).
  var phones = [];
  (t.phoneCols || []).forEach(function (pc) {
    var pk = _corruptionPhoneKey(rowObj[pc]);
    if (pk && phones.indexOf(pk) === -1) phones.push(pk);
  });
  if (!phones.length) return { row: null, sheet: '', why: '' };
  for (i = 0; i < order.length; i++) {
    pool = idx.bySheet[order[i]];
    if (!pool) continue;
    var hits = [];
    var seenRow = {};
    phones.forEach(function (pk) {
      (pool.byPhone[pk] || []).forEach(function (r) {
        if (!seenRow[r.rowNumber]) { seenRow[r.rowNumber] = true; hits.push(r); }
      });
    });
    if (hits.length === 1) return { row: hits[0], sheet: order[i], why: '' };
    if (hits.length > 1) {
      return { row: null, sheet: '', why: hits.length + ' rows in ' + order[i] +
        ' share the phone — ambiguous, no proposal' };
    }
  }
  return { row: null, sheet: '', why: '' };
}

/* Tier 1 for one corrupted cell: walk the snapshots in priority order; the
 * first matched row whose value in the SAME LOGICAL COLUMN is clean and
 * passes the compatibility guard wins. A clean-but-incompatible value sets
 * mismatch=true — the caller classifies 'snapshot mismatch — manual' and
 * does NOT fall through to enum/roster (the value visibly changed after the
 * snapshot; guessing from weaker sources would be worse, not better). */
function _corruptionSnapshotProposal(snapIndexes, t, r, col) {
  var res = { newValue: '', source: '', mismatch: false, notes: [] };
  var corrupted = String(r.obj[col]);
  for (var i = 0; i < snapIndexes.length; i++) {
    var idx = snapIndexes[i];
    var m = _corruptionSnapshotMatchRow(idx, t, r.obj);
    if (!m.row) {
      if (m.why) res.notes.push(idx.name + ': ' + m.why);
      continue;
    }
    var v = m.row.obj[col];
    if (v === undefined || v === null || v === '') continue; // snapshot lacks the column/value
    var sv = String(v);
    if (_hasCorruption(sv)) continue; // snapshot row corrupted too (post-bug revision)
    if (_corruptionWildcardRegex(corrupted).test(sv)) {
      res.newValue = sv;
      res.source = idx.name + ' ' + m.sheet + ' row ' + m.row.rowNumber;
      return res;
    }
    res.mismatch = true;
    res.notes.push(idx.name + ': snapshot value "' + sv + '" is incompatible with the corrupted cell');
  }
  return res;
}

/* Tier 2 legal-value pools, keyed by the valueClass names used in
 * _corruptionScanTargets' enumCols. Seeded from the in-code closed sets
 * (billing/clinical maps, statuses, stages, locations, therapist rate maps)
 * and extended with every clean value observed in the live enum columns
 * themselves — that is where free-but-closed sets like assignedTo get their
 * values. */
function _corruptionEnumSets(bySheet, targets) {
  var sets = { billingService: {}, clinicalType: {}, clientStatus: {}, paymentStatus: {},
    leadStage: {}, location: {}, assignee: {}, therapistName: {} };
  Object.keys(BILLING_PRICES).forEach(function (k) { sets.billingService[k] = true; });
  sets.billingService[DAY_CENTER_BILLING] = true;
  Object.keys(CLINICAL_TO_BILLING).forEach(function (k) { sets.clinicalType[k] = true; });
  CORRUPTION_CLIENT_STATUSES.forEach(function (k) { sets.clientStatus[k] = true; });
  Object.keys(DEBT_PAYMENT_STATUS_ALIASES).forEach(function (k) { sets.paymentStatus[k] = true; });
  CORRUPTION_LEAD_STAGES.forEach(function (k) { sets.leadStage[k] = true; });
  CORRUPTION_LOCATIONS.forEach(function (k) { sets.location[k] = true; });
  Object.keys(THERAPIST_FLAT_RATES).forEach(function (k) { sets.therapistName[k] = true; });
  Object.keys(PSYCHIATRIST_RATES).forEach(function (k) { sets.therapistName[k] = true; });
  targets.forEach(function (t) {
    var entry = bySheet[t.sheet];
    if (!entry || !entry.rows) return;
    Object.keys(t.enumCols || {}).forEach(function (col) {
      var cls = t.enumCols[col];
      if (!sets[cls]) sets[cls] = {};
      entry.rows.forEach(function (r) {
        var v = String(r.obj[col] == null ? '' : r.obj[col]).trim();
        if (v !== '' && !_hasCorruption(v)) sets[cls][v] = true;
      });
    });
  });
  var out = {};
  Object.keys(sets).forEach(function (cls) { out[cls] = Object.keys(sets[cls]); });
  return out;
}

/* Tier 3 roster: every clean person name from every live target sheet's
 * nameCol plus every snapshot's names. */
function _corruptionRoster(bySheet, targets, snapIndexes) {
  var seen = {};
  var names = [];
  var add = function (v) {
    var s = String(v == null ? '' : v).trim();
    if (s === '' || _hasCorruption(s) || seen[s]) return;
    seen[s] = true;
    names.push(s);
  };
  targets.forEach(function (t) {
    var entry = bySheet[t.sheet];
    if (!entry || !entry.rows || !t.nameCol) return;
    entry.rows.forEach(function (r) { add(r.obj[t.nameCol]); });
  });
  snapIndexes.forEach(function (idx) { idx.names.forEach(add); });
  return names;
}

/* The shared scan engine behind scanCorruptedRowsNow / writeRepairPlanNow.
 * READ-ONLY (snapshots included — opened and read, never written). Returns:
 *   cells    — [{sheet,row,column,value,proposal,source,newValue,note}] one
 *              per corrupted cell; proposal ∈ 'repair from lead' | 'repair
 *              from phone match' | 'repair from snapshot' | 'repair from
 *              enum' | 'repair from roster' | 'repair from twin-merge' |
 *              'snapshot mismatch — manual' | 'no source — manual'
 *   snapshots— snapshot names in priority order ([] when none — tiers 2–3
 *              still ran)
 *   summary  — counts, incl. per-proposal breakdown */
function _corruptionScan() {
  var targets = _corruptionScanTargets();
  var bySheet = {};
  targets.forEach(function (t) { bySheet[t.sheet] = { target: t, rows: _corruptionReadRows(t) }; });

  // Cross-reference sources (tier 0).
  // (a) Leads-family rows by lead id — clean name + phone; first clean hit wins.
  // (b) normalized phone → clean name, from EVERY live target row.
  var leadById = {};
  var phoneToName = {};
  targets.forEach(function (t) {
    var entry = bySheet[t.sheet];
    if (!entry || !entry.rows) return;
    var isLeadsFamily = (t.sheet === 'Leads' || t.sheet === 'לידים שהוסרו');
    entry.rows.forEach(function (r) {
      var nm = t.nameCol ? String(r.obj[t.nameCol] == null ? '' : r.obj[t.nameCol]) : '';
      var cleanName = nm !== '' && !_hasCorruption(nm);
      if (isLeadsFamily) {
        var id = String(r.obj.id == null ? '' : r.obj.id).trim();
        if (id && !leadById[id]) leadById[id] = { name: nm, cleanName: cleanName, phone: r.obj.phone };
      }
      if (cleanName) {
        (t.phoneCols || []).forEach(function (pc) {
          var key = _corruptionPhoneKey(r.obj[pc]);
          if (key && !phoneToName[key]) phoneToName[key] = nm;
        });
      }
    });
  });

  // (c) same-key rows across a sheet family (Clients ↔ Clients-removed,
  // Leads ↔ removed leads) — the twin pool for the twin-merge bonus.
  var familyByKey = {};
  targets.forEach(function (t) {
    if (!t.keyCol || !t.family || !t.family.length) return;
    var famName = t.family.join('|');
    if (!familyByKey[famName]) familyByKey[famName] = {};
    var entry = bySheet[t.sheet];
    if (!entry || !entry.rows) return;
    entry.rows.forEach(function (r) {
      var key = String(r.obj[t.keyCol] == null ? '' : r.obj[t.keyCol]).trim();
      if (!key) return;
      if (!familyByKey[famName][key]) familyByKey[famName][key] = [];
      familyByKey[famName][key].push({ sheet: t.sheet, row: r });
    });
  });

  // Tier 1–3 sources, computed once for the whole scan. All READ-ONLY.
  var snapshots = _corruptionSnapshots();
  var snapIndexes = snapshots.map(function (s) { return _corruptionSnapshotIndex(s, targets); });
  var enumSets = _corruptionEnumSets(bySheet, targets);
  var roster = _corruptionRoster(bySheet, targets, snapIndexes);
  var addNote = function (finding, note) {
    finding.note = finding.note ? finding.note + '; ' + note : note;
  };

  var cells = [];
  targets.forEach(function (t) {
    var entry = bySheet[t.sheet];
    if (!entry.rows) return; // sheet absent — nothing to scan
    var famName = (t.family && t.family.length) ? t.family.join('|') : '';
    entry.rows.forEach(function (r) {
      t.textCols.forEach(function (col) {
        var v = r.obj[col];
        if (!_hasCorruption(v)) return;
        var finding = { sheet: t.sheet, row: r.rowNumber, column: col,
          value: String(v), proposal: 'no source — manual', source: '', newValue: '', note: '' };
        var manual = function () { return finding.proposal === 'no source — manual'; };

        // Tier 0a — the originating Leads-family row (Clients family only),
        // name column only. (A corrupted lead can never propose itself: its
        // own name fails the clean check.)
        var leadId = t.leadIdCol ? String(r.obj[t.leadIdCol] == null ? '' : r.obj[t.leadIdCol]).trim() : '';
        if (manual() && col === t.nameCol && leadId &&
            leadById[leadId] && leadById[leadId].cleanName) {
          finding.proposal = 'repair from lead';
          finding.source = 'lead ' + leadId;
          finding.newValue = leadById[leadId].name;
        }
        // Tier 0b — a clean row elsewhere sharing this row's phone — name only.
        if (manual() && col === t.nameCol) {
          var phones = [];
          (t.phoneCols || []).forEach(function (pc) {
            var key = _corruptionPhoneKey(r.obj[pc]);
            if (key && phones.indexOf(key) === -1) phones.push(key);
          });
          if (phones.length === 0 && leadId && leadById[leadId]) {
            var lk = _corruptionPhoneKey(leadById[leadId].phone);
            if (lk) phones.push(lk);
          }
          for (var p = 0; p < phones.length; p++) {
            var candidate = phoneToName[phones[p]];
            if (candidate && !_hasCorruption(candidate) && candidate !== String(v)) {
              finding.proposal = 'repair from phone match';
              finding.source = 'phone ' + phones[p];
              finding.newValue = candidate;
              break;
            }
          }
        }
        // Tier 1 — snapshot (all text columns, notes included).
        if (manual() && snapIndexes.length > 0 && t.keyCol) {
          var sp = _corruptionSnapshotProposal(snapIndexes, t, r, col);
          if (sp.notes.length > 0) addNote(finding, sp.notes.join('; '));
          if (sp.newValue) {
            finding.proposal = 'repair from snapshot';
            finding.source = sp.source;
            finding.newValue = sp.newValue;
          } else if (sp.mismatch) {
            // A clean snapshot value exists but fails the compatibility
            // guard: the live value was edited after the snapshot. Manual —
            // and the weaker tiers must not have a go either.
            finding.proposal = 'snapshot mismatch — manual';
          }
        }
        // Tier 2 — closed value sets (enum columns only, never free text).
        if (manual() && t.enumCols && t.enumCols[col] && enumSets[t.enumCols[col]]) {
          var em = _corruptionMatchOne(String(v), enumSets[t.enumCols[col]]);
          if (em.count === 1) {
            finding.proposal = 'repair from enum';
            finding.source = t.enumCols[col] + ' value set';
            finding.newValue = em.value;
          } else if (em.count > 1) {
            addNote(finding, em.count + ' legal ' + t.enumCols[col] + ' values match — manual');
          }
        }
        // Tier 3 — name roster (name columns only, never free text).
        if (manual() && col === t.nameCol) {
          var rm = _corruptionMatchOne(String(v), roster);
          if (rm.count === 1) {
            finding.proposal = 'repair from roster';
            finding.source = 'name roster (' + roster.length + ' names)';
            finding.newValue = rm.value;
          } else if (rm.count > 1) {
            addNote(finding, rm.count + ' roster names match — manual');
          }
        }
        // Tier 3 bonus — twin-merge: another row for the SAME key (own sheet
        // or its family sheet) corrupted in DIFFERENT positions whose union
        // reconstructs the full clean string.
        if (manual() && famName && t.keyCol) {
          var key = String(r.obj[t.keyCol] == null ? '' : r.obj[t.keyCol]).trim();
          var group = key ? (familyByKey[famName][key] || []) : [];
          for (var g = 0; g < group.length; g++) {
            var tw = group[g];
            if (tw.sheet === t.sheet && tw.row.rowNumber === r.rowNumber) continue;
            var tv = tw.row.obj[col];
            if (tv === undefined || tv === null || !_hasCorruption(tv)) continue;
            var merged = _corruptionTwinMerge(String(v), String(tv));
            if (merged !== '') {
              finding.proposal = 'repair from twin-merge';
              finding.source = tw.sheet + ' row ' + tw.row.rowNumber + ' (same ' + t.keyCol + ')';
              finding.newValue = merged;
              break;
            }
          }
        }
        // Cross-app-sensitive columns: make the risk impossible to miss in
        // the plan review, whatever tier proposed the value.
        if (t.crossAppCols && t.crossAppCols[col]) {
          finding.source = (finding.source || finding.proposal) + t.crossAppCols[col];
        }
        cells.push(finding);
      });
    });
  });

  var byProposal = {};
  cells.forEach(function (c) { byProposal[c.proposal] = (byProposal[c.proposal] || 0) + 1; });

  return {
    cells: cells,
    snapshots: snapshots.map(function (s) { return s.name; }),
    summary: { corruptedCells: cells.length, byProposal: byProposal }
  };
}

/* One Logger line describing snapshot availability — shared by both public
 * scan/plan entry points so the log always states whether tier 1 ran. */
function _logSnapshotStatus(res) {
  if (res.snapshots.length === 0) {
    Logger.log('NO SNAPSHOT FOUND — no spreadsheet named "' + SNAPSHOT_NAME_PREFIX +
      '*" is visible in Drive, so tier 1 (snapshot repair) was skipped; the enum and roster tiers still ran. ' +
      'Run harvestRevisionSnapshotsNow first (or File → Version history → pick a pre-' +
      CORRUPTION_BUG_LIVE_DATE + ' version → Make a copy named ' + SNAPSHOT_NAME_PREFIX + '), then re-run.');
  } else {
    Logger.log('Snapshot(s) used for tier 1, in priority order (oldest content first): ' +
      res.snapshots.join(', ') + '. Snapshots are read-only — never written.');
  }
}

/* DRY RUN — run from the Apps Script editor (Run dropdown). READ-ONLY
 * (getSheetByName only; cannot even create a sheet): scans every target
 * sheet/column for U+FFFD and Logger.logs each hit with its PROPOSED action
 * and source. NOTHING is written; use writeRepairPlanNow to turn these
 * proposals into the reviewable RepairPlan sheet. */
function scanCorruptedRowsNow() {
  var res = _corruptionScan();
  _logSnapshotStatus(res);
  res.cells.forEach(function (c) {
    Logger.log('CORRUPTED ' + c.sheet + ' row ' + c.row + ' [' + c.column + '] "' + c.value + '" → ' +
      c.proposal + (c.newValue ? ' ("' + c.newValue + '" from ' + c.source + ')' : '') +
      (c.note ? ' [' + c.note + ']' : ''));
  });
  Logger.log('scanCorruptedRowsNow: ' + res.summary.corruptedCells + ' corrupted cell(s). By tier: ' +
    JSON.stringify(res.summary.byProposal) + '. NO WRITES performed.');
  return res;
}

/* Ensure the hidden RepairPlan sheet exists with text-formatted value
 * columns (so 'FALSE', dates-as-text and leading zeros survive as typed). */
function _repairPlanSheet() {
  var sh = _ensureSheet(REPAIR_PLAN_SHEET, REPAIR_PLAN_HEADERS);
  try { if (!sh.isSheetHidden()) sh.hideSheet(); } catch (_) { /* no-op */ }
  var maxRows = sh.getMaxRows();
  if (maxRows > 1) {
    ['newValue', 'approved', 'oldValue'].forEach(function (colName) {
      var c = REPAIR_PLAN_HEADERS.indexOf(colName) + 1;
      try { sh.getRange(2, c, maxRows - 1, 1).setNumberFormat('@'); } catch (_) { /* no-op */ }
    });
  }
  return sh;
}

/* Populate the hidden RepairPlan sheet from the scan, every row with
 * approved=FALSE — Sandra reviews, edits newValue where the scan found no
 * source, and flips approved to TRUE per row she wants executed. FULL
 * REWRITE on each run (write-then-trim), so re-running RESETS approvals —
 * run it once, review, apply. Writes ONLY to RepairPlan. */
function writeRepairPlanNow() {
  var res = _corruptionScan();
  _logSnapshotStatus(res);
  var sh = _repairPlanSheet();
  var planRows = res.cells.map(function (c) {
    var obj = { sheet: c.sheet, row: c.row, column: c.column, newValue: c.newValue,
      action: 'repair', approved: 'FALSE', oldValue: c.value,
      source: c.proposal + (c.source ? ' — ' + c.source : '') + (c.note ? ' [' + c.note + ']' : '') };
    return REPAIR_PLAN_HEADERS.map(function (h) { return obj[h] == null ? '' : obj[h]; });
  });
  var lastRow = sh.getLastRow();
  if (planRows.length > 0) {
    sh.getRange(2, 1, planRows.length, REPAIR_PLAN_HEADERS.length).setValues(planRows);
  }
  if (lastRow > planRows.length + 1) {
    sh.getRange(planRows.length + 2, 1, lastRow - planRows.length - 1, REPAIR_PLAN_HEADERS.length).clearContent();
  }
  Logger.log('writeRepairPlanNow: wrote ' + planRows.length + ' plan row(s), ALL approved=FALSE. ' +
    'Unhide + review the RepairPlan sheet, fill any blank newValue, flip approved to TRUE per row, ' +
    'then run applyCorruptedRowRepairsNow. Rows whose source carries a THERAPIST-NAME suffix must be ' +
    'verified byte-exact against the therapists app roster before approving.');
  return planRows.length;
}

/* Append one event row to the hidden AuditLog sheet. FAIL-SOFT by hard
 * contract (locked by test): audit logging must NEVER break or fail the main
 * operation — every failure is swallowed. `details` may be an object (JSON-
 * stringified) or a ready string. */
function logAudit_(action, fn, rowKey, name, details) {
  try {
    var sh = _ensureSheet(AUDIT_LOG_SHEET, AUDIT_LOG_HEADERS);
    try { if (!sh.isSheetHidden()) sh.hideSheet(); } catch (_) { /* no-op */ }
    var row = [
      new Date().toISOString(),
      String(action == null ? '' : action),
      String(fn == null ? '' : fn),
      String(rowKey == null ? '' : rowKey),
      String(name == null ? '' : name),
      typeof details === 'string' ? details : JSON.stringify(details || {})
    ];
    sh.getRange(sh.getLastRow() + 1, 1, 1, AUDIT_LOG_HEADERS.length).setValues([row]);
  } catch (err) {
    try { Logger.log('audit log skipped: ' + err); } catch (_) { /* no-op */ }
  }
}

/* Execute ONLY the approved=TRUE rows of RepairPlan, under the script lock.
 * Per row: re-verify the target cell still holds EXACTLY oldValue AND that
 * it is still corrupted; then write newValue to that SINGLE cell
 * (getRange(row, col).setValue — never _writeAll, never a bulk setValues, so
 * concurrent saves are never clobbered). Any mismatch (drift), unknown
 * sheet/column, or blank/corrupted newValue → SKIP + log, touch nothing.
 * Every applied repair is audit-logged (fail-soft). */
function applyCorruptedRowRepairsNow() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log('applyCorruptedRowRepairsNow: could not acquire the script lock — try again.');
    return { ok: false, error: 'busy', applied: 0, skipped: 0 };
  }
  try {
    var ss = _ss();
    var planSh = ss.getSheetByName(REPAIR_PLAN_SHEET);
    if (!planSh) {
      Logger.log('applyCorruptedRowRepairsNow: no RepairPlan sheet — run writeRepairPlanNow first.');
      return { ok: true, applied: 0, skipped: 0 };
    }
    var lastRow = planSh.getLastRow();
    if (lastRow < 2) {
      Logger.log('applyCorruptedRowRepairsNow: RepairPlan is empty.');
      return { ok: true, applied: 0, skipped: 0 };
    }
    var values = planSh.getRange(2, 1, lastRow - 1, REPAIR_PLAN_HEADERS.length).getValues();
    var plan = values.map(function (row) {
      var obj = {};
      for (var j = 0; j < REPAIR_PLAN_HEADERS.length; j++) obj[REPAIR_PLAN_HEADERS[j]] = row[j];
      return obj;
    }).filter(function (p) {
      // approved=FALSE (and anything that isn't literally TRUE) is skipped.
      return String(p.approved).toUpperCase() === 'TRUE';
    });

    var targetsBySheet = {};
    _corruptionScanTargets().forEach(function (t) { targetsBySheet[t.sheet] = t; });

    var applied = 0, skipped = 0;
    var skip = function (p, why) {
      skipped++;
      Logger.log('SKIP ' + p.action + ' ' + p.sheet + ' row ' + p.row + ' [' + p.column + ']: ' + why);
    };

    plan.forEach(function (p) {
      if (String(p.action) !== 'repair') return skip(p, 'unknown action "' + p.action + '"');
      var target = targetsBySheet[String(p.sheet)];
      if (!target) return skip(p, 'unknown sheet');
      var colIdx = target.headers.indexOf(String(p.column));
      if (colIdx < 0) return skip(p, 'unknown column');
      var rowNum = Number(p.row);
      if (!isFinite(rowNum) || rowNum < 2) return skip(p, 'bad row number');
      var newValue = String(p.newValue == null ? '' : p.newValue);
      if (newValue === '' || _hasCorruption(newValue)) {
        return skip(p, 'newValue blank or corrupted — fill it in before approving');
      }
      var sh = ss.getSheetByName(target.sheet);
      if (!sh) return skip(p, 'sheet missing');
      var cell = sh.getRange(rowNum, colIdx + 1, 1, 1);
      var current = String(cell.getValue());
      // Drift guard: the cell must still hold exactly the corrupted value the
      // plan recorded. Any drift (row moved, already repaired, edited since)
      // skips — the plan row number is a hint, never an authority.
      if (current !== String(p.oldValue) || !_hasCorruption(current)) {
        return skip(p, 'cell no longer holds the expected corrupted value (row drift or already repaired)');
      }
      cell.setValue(newValue); // SINGLE-CELL write — never _writeAll
      // who/when: a Clients cell repair is a row write — stamp WHEN (no
      // session user: this runs from the editor, not through the proxy).
      if (target.sheet === 'Clients') _stampClientRowAt(sh, rowNum, '');
      applied++;
      logAudit_('corruption_repair', 'applyCorruptedRowRepairsNow', target.sheet + '!' + rowNum, newValue,
        { sheet: target.sheet, row: rowNum, column: String(p.column), oldValue: current, newValue: newValue });
    });

    Logger.log('applyCorruptedRowRepairsNow: ' + applied + ' repair(s) applied, ' + skipped +
      ' skipped. Approved rows only; see the hidden AuditLog sheet for the trail.');
    return { ok: true, applied: applied, skipped: skipped };
  } finally {
    try { lock.releaseLock(); } catch (_) { /* no-op */ }
  }
}

/* ---- Automated revision harvesting (feeds tier 1 with many snapshots) ----
 *
 * A single pre-bug snapshot covers only rows created before 2026-07-27, but
 * corruption arrived throughout 2026-07-27 → 2026-08-31 — each row's LAST
 * CLEAN value lives in a different revision. harvestRevisionSnapshotsNow
 * lists THIS spreadsheet's Drive revisions, picks a spread across the
 * corruption window, exports each as xlsx, and rebuilds each as a real
 * Google Sheet named EZONE-OUT-SNAPSHOT-AUTO-<yyyy-MM-dd> — exactly what
 * _corruptionSnapshots' prefix discovery consumes (ordered by the encoded
 * date). deleteAutoSnapshotsNow cleans them up afterwards, never touching a
 * manual EZONE-OUT-SNAPSHOT copy. */

/* Normalize Drive revision metadata across API shapes (v3: revisions[] with
 * modifiedTime; v2: items[] with modifiedDate) into {id, modified(ms),
 * exportLinks}, ascending by modified. Undatable entries are dropped. */
function _normalizeRevisions(rawList) {
  var out = [];
  (rawList || []).forEach(function (r) {
    if (!r) return;
    var modified = Date.parse(r.modifiedTime || r.modifiedDate || '');
    var id = String(r.id == null ? '' : r.id);
    if (!id || isNaN(modified)) return;
    out.push({ id: id, modified: modified, exportLinks: r.exportLinks || null });
  });
  out.sort(function (a, b) { return a.modified - b.modified; });
  return out;
}

/* List ALL revisions of a file. Advanced Drive service first (v2/v3 shapes
 * both handled, fields:* so exportLinks come along); UrlFetchApp against the
 * Drive v3 REST API with the script's own OAuth token as the fallback. */
function _listSpreadsheetRevisions(fileId) {
  var raw = [];
  var pageToken = null;
  try {
    if (typeof Drive !== 'undefined' && Drive.Revisions && Drive.Revisions.list) {
      do {
        var args = { fields: '*', pageSize: 200 };
        if (pageToken) args.pageToken = pageToken;
        var resp = Drive.Revisions.list(fileId, args);
        raw = raw.concat(resp.revisions || resp.items || []);
        pageToken = resp.nextPageToken || null;
      } while (pageToken);
      return _normalizeRevisions(raw);
    }
    Logger.log('Drive advanced service not enabled — falling back to the REST API');
  } catch (e) {
    Logger.log('advanced Drive revision listing failed (' + e + ') — falling back to the REST API');
  }
  raw = [];
  pageToken = null;
  do {
    var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) +
      '/revisions?fields=*&pageSize=200';
    if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
    var restResp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (restResp.getResponseCode() !== 200) {
      throw new Error('revision list failed: HTTP ' + restResp.getResponseCode());
    }
    var body = JSON.parse(restResp.getContentText());
    raw = raw.concat(body.revisions || []);
    pageToken = body.nextPageToken || null;
  } while (pageToken);
  return _normalizeRevisions(raw);
}

/* Pick which revisions to harvest. PURE (no services) so it is directly
 * testable. Selection: the newest revision strictly BEFORE the bug went
 * live (the clean baseline), plus the latest revision inside each ~6-day
 * bucket across the corruption window, plus the newest pre-fix revision —
 * deduped by revision id and then by calendar day (latest per day wins,
 * since the harvested file name encodes only the date), capped at `cap` by
 * evenly thinning the middle while always keeping the first and last.
 * Revisions may be sparse (Google consolidates old ones): empty buckets are
 * simply skipped — take what exists. Returns [{id, modified, exportLinks,
 * dateLabel}] ascending; dateLabel is the UTC yyyy-MM-dd used in the name. */
function _selectHarvestRevisions(revisions, opts) {
  opts = opts || {};
  var bugLive = Date.parse((opts.bugLive || CORRUPTION_BUG_LIVE_DATE) + 'T00:00:00Z');
  var windowEnd = Date.parse((opts.windowEnd || CORRUPTION_WINDOW_END_DATE) + 'T00:00:00Z');
  var stepMs = (opts.stepDays || 6) * 24 * 60 * 60 * 1000;
  var cap = opts.cap || 10;

  var sorted = (revisions || []).slice().sort(function (a, b) { return a.modified - b.modified; });
  var pickedIds = {};
  var picked = [];
  var add = function (rev) {
    if (!rev || pickedIds[rev.id]) return;
    pickedIds[rev.id] = true;
    picked.push(rev);
  };

  var baseline = null;
  sorted.forEach(function (r) { if (r.modified < bugLive) baseline = r; });
  add(baseline);
  for (var start = bugLive; start < windowEnd; start += stepMs) {
    var end = Math.min(start + stepMs, windowEnd);
    var inBucket = null;
    sorted.forEach(function (r) { if (r.modified >= start && r.modified < end) inBucket = r; });
    add(inBucket);
  }
  var preFix = null;
  sorted.forEach(function (r) { if (r.modified < windowEnd) preFix = r; });
  add(preFix);

  picked.sort(function (a, b) { return a.modified - b.modified; });
  // One file per calendar day (the name encodes only the date): latest wins.
  var byLabel = {};
  var labels = [];
  picked.forEach(function (r) {
    var label = new Date(r.modified).toISOString().slice(0, 10);
    if (!byLabel[label]) labels.push(label);
    byLabel[label] = { id: r.id, modified: r.modified, exportLinks: r.exportLinks, dateLabel: label };
  });
  var out = labels.map(function (l) { return byLabel[l]; });

  if (out.length > cap) {
    var kept = [out[0]];
    var middle = out.slice(1, out.length - 1);
    var slots = cap - 2;
    for (var i = 0; i < slots; i++) {
      kept.push(middle[Math.round(i * (middle.length - 1) / Math.max(slots - 1, 1))]);
    }
    kept.push(out[out.length - 1]);
    var seenOut = {};
    out = kept.filter(function (r) {
      if (seenOut[r.id]) return false;
      seenOut[r.id] = true;
      return true;
    });
  }
  return out;
}

/* Export one revision as an xlsx blob via its exportLinks, fetched with the
 * script's own OAuth token. When the listed revision came without
 * exportLinks, the single revision is re-fetched with fields:* first. */
function _exportRevisionXlsxBlob(fileId, rev) {
  var url = rev.exportLinks && rev.exportLinks[XLSX_EXPORT_MIME];
  if (!url) {
    var meta = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' +
      encodeURIComponent(fileId) + '/revisions/' + encodeURIComponent(rev.id) + '?fields=*', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (meta.getResponseCode() === 200) {
      var body = JSON.parse(meta.getContentText());
      url = body.exportLinks && body.exportLinks[XLSX_EXPORT_MIME];
    }
  }
  if (!url) throw new Error('no xlsx exportLink for revision ' + rev.id);
  var resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('xlsx export of revision ' + rev.id + ' failed: HTTP ' + resp.getResponseCode());
  }
  return resp.getBlob();
}

/* Rebuild an xlsx blob as a real Google Sheet named `name` via the Drive
 * advanced service — v3 Files.create converts when the target mimeType is
 * the Google Sheets type; v2 Files.insert uses convert:true. */
function _createSpreadsheetFromXlsx(blob, name) {
  if (typeof Drive === 'undefined' || !Drive.Files) {
    throw new Error('Drive advanced service unavailable — enable it in appsscript.json');
  }
  if (Drive.Files.create) {
    return Drive.Files.create({ name: name, mimeType: 'application/vnd.google-apps.spreadsheet' }, blob);
  }
  if (Drive.Files.insert) {
    return Drive.Files.insert({ title: name, mimeType: 'application/vnd.google-apps.spreadsheet' }, blob, { convert: true });
  }
  throw new Error('Drive advanced service exposes neither Files.create (v3) nor Files.insert (v2)');
}

/* Harvest revision snapshots of THIS spreadsheet for the tier-1 repair.
 * PUBLIC (Run dropdown), never dispatchable via doGet/doPost. Idempotent: a
 * date whose EZONE-OUT-SNAPSHOT-AUTO-<date> file already exists is skipped,
 * so re-running only fills gaps. Per-revision try/catch: one failed export
 * neither kills the harvest nor blocks the rest. Read-only toward the live
 * spreadsheet; creates only the AUTO-named snapshot files. */
function harvestRevisionSnapshotsNow() {
  var fileId = _ss().getId();
  var revisions = _listSpreadsheetRevisions(fileId);
  Logger.log('harvestRevisionSnapshotsNow: ' + revisions.length + ' revision(s) found for this spreadsheet.');
  var selected = _selectHarvestRevisions(revisions);
  Logger.log('Selected ' + selected.length + ' revision(s): ' +
    selected.map(function (r) { return r.dateLabel + ' (rev ' + r.id + ')'; }).join(', '));

  var harvested = 0, skipped = 0, failed = 0;
  selected.forEach(function (rev) {
    var name = AUTO_SNAPSHOT_PREFIX + rev.dateLabel;
    try {
      if (DriveApp.getFilesByName(name).hasNext()) {
        skipped++;
        Logger.log('SKIP ' + name + ' — already harvested.');
        return;
      }
      var blob = _exportRevisionXlsxBlob(fileId, rev);
      _createSpreadsheetFromXlsx(blob, name);
      harvested++;
      Logger.log('HARVESTED ' + name + ' from revision ' + rev.id + '.');
    } catch (e) {
      failed++;
      Logger.log('FAILED ' + name + ' (revision ' + rev.id + '): ' + e);
    }
  });
  var summary = { found: revisions.length, selected: selected.length,
    harvested: harvested, skipped: skipped, failed: failed };
  Logger.log('harvestRevisionSnapshotsNow: ' + revisions.length + ' revision(s) found, ' +
    selected.length + ' selected, ' + harvested + ' harvested, ' + skipped +
    ' skipped (already present), ' + failed + ' failed. Next: run scanCorruptedRowsNow / ' +
    'writeRepairPlanNow — the ' + AUTO_SNAPSHOT_PREFIX + '* files feed tier 1 automatically.');
  return summary;
}

/* Trash every harvested EZONE-OUT-SNAPSHOT-AUTO-* file — cleanup for after
 * the repair is done. PUBLIC (Run dropdown), never dispatchable via
 * doGet/doPost. A manually created EZONE-OUT-SNAPSHOT copy (no -AUTO-) is
 * NEVER touched: only names starting with the full AUTO prefix qualify.
 * Trash, not delete — recoverable from the Drive trash for 30 days. */
function deleteAutoSnapshotsNow() {
  var trashed = 0;
  var iter = null;
  try {
    iter = DriveApp.searchFiles('title contains "' + AUTO_SNAPSHOT_PREFIX + '"');
  } catch (e) {
    Logger.log('deleteAutoSnapshotsNow: Drive search failed (' + e + ') — nothing trashed.');
    return { trashed: 0 };
  }
  while (iter.hasNext()) {
    var f = iter.next();
    var name = String(f.getName());
    if (name.indexOf(AUTO_SNAPSHOT_PREFIX) !== 0) continue; // never a manual snapshot
    try {
      f.setTrashed(true);
      trashed++;
      Logger.log('TRASHED ' + name + '.');
    } catch (e2) {
      Logger.log('FAILED to trash ' + name + ': ' + e2);
    }
  }
  Logger.log('deleteAutoSnapshotsNow: ' + trashed + ' auto-snapshot(s) trashed. ' +
    'A manual ' + SNAPSHOT_NAME_PREFIX + ' copy is never touched.');
  return { trashed: trashed };
}
