'use strict';

/**
 * Coverage for the cross-tab patient locator (איתור מטופל): the pure
 * classification module public/patient-search.js (required directly — it is
 * UMD like name-search.js) and source-scan guards over the dashboard wiring
 * in public/app.js + public/index.html.
 *
 * Incident this locks (2026-08-26): a patient existed ONLY as orphan
 * Payments rows — findable in גבייה, invisible in both patient tabs. The
 * locator must surface a patient from Clients (any status), from the
 * Clients-removed tombstones, and from orphan billing rows, saying which tab
 * (or recovery action) owns them.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { searchPatients } = require('../public/patient-search.js');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

const DATA = {
  clients: [
    { id: 'c1', name: 'דנה כהן', status: 'פעיל' },
    { id: 'c2', name: 'יוסי לוי', status: 'הפסקה זמנית' },
    { id: 'c3', name: 'רות אדרי', status: 'סיים טיפול' },
    { id: 'c4', name: 'גל ברק', status: 'לא פעיל' }
  ],
  removedClients: [
    { id: 'r1', name: 'מנשה וקנין', status: 'פעיל', removedAt: '2026-08-26T07:50:00.000Z', removedVia: 'saveAll-diff', restoredAt: '' },
    { id: 'r1', name: 'מנשה וקנין', status: 'פעיל', removedAt: '2026-08-26T08:10:00.000Z', removedVia: 'explicit-delete', restoredAt: '' },
    { id: 'c1', name: 'דנה כהן', status: 'פעיל', removedAt: '2026-07-01T00:00:00.000Z', removedVia: 'saveAll-diff', restoredAt: '' }
  ],
  payments: [
    { id: 'pay::c1::base::2026-08', clientId: 'c1', clientName: 'דנה כהן', amountPaid: 400 },
    { id: 'pay::orph::base::2026-07', clientId: 'orph', clientName: 'אורי יתום', amountPaid: 1000 },
    { id: 'pay::orph::base::2026-08', clientId: 'orph', clientName: 'אורי יתום', amountPaid: 500 },
    { id: 'pay::r1::base::2026-08', clientId: 'r1', clientName: 'מנשה וקנין', amountPaid: 124050 }
  ]
};

// ─────────────────────────────────────────────────────────────────────────────
// Pure module
// ─────────────────────────────────────────────────────────────────────────────

test('blank query matches NOTHING (a global locator shows no list at rest)', () => {
  assert.deepEqual(searchPatients('', DATA), []);
  assert.deepEqual(searchPatients('   ', DATA), []);
});

test('clients of every status are found and routed to the tab that shows them', () => {
  const tabs = {};
  ['דנה', 'יוסי', 'רות', 'גל'].forEach((q) => {
    const rows = searchPatients(q, DATA).filter((r) => r.kind === 'client');
    assert.equal(rows.length, 1, q + ' must be found');
    tabs[rows[0].id] = rows[0].tab;
  });
  assert.deepEqual(tabs, { c1: 'clients', c2: 'clients', c3: 'inactive', c4: 'inactive' });
});

test('a deleted patient surfaces from the tombstones — one row, the LATEST tombstone wins', () => {
  const rows = searchPatients('מנשה', DATA);
  const removed = rows.filter((r) => r.kind === 'removed');
  assert.equal(removed.length, 1, 'duplicate tombstones for one id must collapse');
  assert.equal(removed[0].removedVia, 'explicit-delete', 'the latest tombstone wins');
  assert.equal(removed[0].tab, 'inactive');
  // their payments are NOT double-reported as billing-only orphans
  assert.equal(rows.filter((r) => r.kind === 'billing-only').length, 0);
});

test('a live id with a stale tombstone shows ONLY as a client (restore already happened)', () => {
  const rows = searchPatients('דנה', DATA);
  assert.deepEqual(rows.map((r) => r.kind), ['client']);
});

test('billing-only orphans (the incident signature) aggregate their payment rows', () => {
  const rows = searchPatients('אורי', DATA);
  assert.equal(rows.length, 1);
  const o = rows[0];
  assert.equal(o.kind, 'billing-only');
  assert.equal(o.id, 'orph');
  assert.equal(o.tab, 'billing');
  assert.equal(o.paymentsCount, 2);
  assert.equal(o.collected, 1500);
});

test('matching is the shared NameSearch rule: trimmed, case-insensitive substring', () => {
  const rows = searchPatients('  וקנין ', DATA);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'removed');
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-scan guards over the dashboard wiring
// ─────────────────────────────────────────────────────────────────────────────

test('index.html: the locator panel + input live on the dashboard, and the module is loaded before app.js', () => {
  assert.match(HTML, /id="dashPatientSearch"/);
  assert.match(HTML, /id="dashPatientResults"/);
  const moduleAt = HTML.indexOf('patient-search.js');
  const appAt = HTML.indexOf('src="app.js');
  assert.ok(moduleAt !== -1 && appAt !== -1 && moduleAt < appAt,
    'patient-search.js must load before app.js');
  const nameSearchAt = HTML.indexOf('name-search.js');
  assert.ok(nameSearchAt !== -1 && nameSearchAt < moduleAt,
    'name-search.js must load before patient-search.js (its dependency)');
});

test('app.js: the locator is wired — per-dashboard search state, input listener, render call', () => {
  assert.match(APP, /dashSearch: ''/);
  // Wired through the shared wireSearchBox helper since the working-indicator
  // PR, so the field can spin while the tombstone fetch is out.
  assert.match(APP, /wireSearchBox\('#dashPatientSearch', function \(e\) \{ state\.dashSearch = e\.target\.value; return renderDashPatientSearch\(\); \}\);/);
  const dash = APP.match(/function renderDashboard\(\) \{[\s\S]*?\n  \}/);
  assert.ok(dash, 'renderDashboard not found');
  assert.match(dash[0], /renderDashPatientSearch\(\);/, 'the dashboard render must include the locator');
});

test('app.js: results classify via PatientSearch over clients + tombstones + payments, tombstones fetched lazily', () => {
  const m = APP.match(/function renderDashPatientSearch\(\) \{[\s\S]*?\n  \}/);
  assert.ok(m, 'renderDashPatientSearch not found');
  const body = m[0];
  assert.match(body, /PatientSearch\.searchPatients/);
  assert.match(body, /clients: state\.clients/);
  assert.match(body, /payments: state\.payments/);
  assert.match(body, /ensureRemovedClients/, 'tombstones must be pulled lazily for the locator too');
});

test('app.js: a removed result offers the editor-only restore; other results navigate with the tab search prefilled', () => {
  const m = APP.match(/function dashSearchRow\([\s\S]*?\n  \}/);
  assert.ok(m, 'dashSearchRow not found');
  assert.match(m[0], /performRestoreRemovedClient/);
  assert.match(m[0], /state\.role === 'editor'/, 'restore from the locator must be editor-only');
  const nav = APP.match(/function dashOpenInTab\([\s\S]*?\n  \}/);
  assert.ok(nav, 'dashOpenInTab not found');
  assert.match(nav[0], /state\.clientSearch = name/);
  assert.match(nav[0], /state\.inactiveSearch = name/);
  assert.match(nav[0], /state\.billingSearch = name/);
  assert.match(nav[0], /setView\('clients'\)/);
  assert.match(nav[0], /setView\('inactive'\)/);
  assert.match(nav[0], /setView\('billing'\)/);
});
