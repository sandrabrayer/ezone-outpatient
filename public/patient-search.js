/**
 * patient-search.js
 * -----------------------------------------------------------------------------
 * Pure classification for the dashboard-wide patient search (איתור מטופל).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The 2026-08-26 incident: a patient existed only as orphan Payments rows —
 * findable in גבייה, invisible in מטופלים AND מטופלים לא פעילים, because each
 * tab searches only its own slice. This module answers "where does this
 * patient live?" across EVERY store at once:
 *
 *   - the Clients rows (any status → the מטופלים or לא פעילים tab),
 *   - the un-restored Clients-removed tombstones (deleted patients), and
 *   - Payments rows whose clientId matches neither of the above
 *     (billing-only orphans — the incident signature).
 *
 * PURITY
 * ------
 * No state, no DOM: the result depends only on the arguments, exactly like
 * name-search.js, so the classification is unit-testable in isolation. The
 * dashboard render layer owns all presentation and navigation.
 */
(function (root, factory) {
  var nameSearch = (typeof module === 'object' && module.exports)
    ? require('./name-search.js')
    : root.NameSearch;
  var api = factory(nameSearch);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.PatientSearch = api;        // browser global
  }
})(typeof self !== 'undefined' ? self : this, function (NameSearch) {
  'use strict';

  var DISCHARGED = 'סיים טיפול';
  var DEACTIVATED = 'לא פעיל';

  /**
   * Search every patient store at once.
   * @param {*} query raw user query; blank matches NOTHING (a global search
   *                  box, unlike the per-tab filters, shows no list at rest)
   * @param {{clients?:Array, removedClients?:Array, payments?:Array}} data
   *   clients        — normalized client rows (all statuses)
   *   removedClients — un-restored Clients-removed tombstones
   *   payments       — normalized payment rows (clientId/clientName/amountPaid)
   * @returns {Array} result rows, clients first, then removed, then
   *   billing-only orphans:
   *   { kind:'client',       id, name, status, tab:'clients'|'inactive' }
   *   { kind:'removed',      id, name, status, removedAt, removedVia, tab:'inactive' }
   *   { kind:'billing-only', id, name, tab:'billing', paymentsCount, collected }
   */
  function searchPatients(query, data) {
    var q = NameSearch.normalizeQuery(query);
    if (!q) return [];
    var clients = (data && data.clients) || [];
    var removed = (data && data.removedClients) || [];
    var payments = (data && data.payments) || [];
    var results = [];

    var liveIds = {};
    clients.forEach(function (c) {
      if (c && c.id != null && String(c.id) !== '') liveIds[String(c.id)] = true;
    });
    clients.forEach(function (c) {
      if (!c || !NameSearch.matchesName(c.name, q)) return;
      var inactive = c.status === DISCHARGED || c.status === DEACTIVATED;
      results.push({
        kind: 'client',
        id: c.id,
        name: c.name || '',
        status: c.status || '',
        tab: inactive ? 'inactive' : 'clients'
      });
    });

    // Tombstones: a live id needs no tombstone entry (it is already back);
    // several tombstones for one id collapse to the LATEST (sheet order —
    // last wins, matching restoreRemovedClient's bottom-up pick).
    var removedById = {};
    var removedOrder = [];
    removed.forEach(function (t) {
      if (!t || t.id == null || String(t.id) === '') return;
      var tid = String(t.id);
      if (liveIds[tid]) return;
      if (!removedById[tid]) removedOrder.push(tid);
      removedById[tid] = t;
    });
    removedOrder.forEach(function (tid) {
      var t = removedById[tid];
      if (!NameSearch.matchesName(t.name, q)) return;
      results.push({
        kind: 'removed',
        id: t.id,
        name: t.name || '',
        status: t.status || '',
        removedAt: t.removedAt || '',
        removedVia: t.removedVia || '',
        tab: 'inactive'
      });
    });

    // Billing-only orphans: payment rows pointing at a clientId with no
    // Clients row and no tombstone — the patient exists ONLY in גבייה.
    // Matched on the payment's denormalized clientName (a rename edits the
    // card, never old payment rows, so this is the name the user knows).
    var orphans = {};
    var orphanOrder = [];
    payments.forEach(function (p) {
      if (!p) return;
      var cid = p.clientId != null ? String(p.clientId) : '';
      if (!cid || liveIds[cid] || removedById[cid]) return;
      if (!NameSearch.matchesName(p.clientName, q)) return;
      if (!orphans[cid]) {
        orphans[cid] = {
          kind: 'billing-only',
          id: cid,
          name: p.clientName || '',
          tab: 'billing',
          paymentsCount: 0,
          collected: 0
        };
        orphanOrder.push(cid);
      }
      orphans[cid].paymentsCount++;
      orphans[cid].collected += Number(p.amountPaid) || 0;
    });
    orphanOrder.forEach(function (cid) { results.push(orphans[cid]); });

    return results;
  }

  return {
    searchPatients: searchPatients
  };
});
