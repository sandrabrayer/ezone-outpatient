'use strict';

/**
 * «מטופלים» split into patient-type tabs (2026-11-18, CHANGELOG-patient-type-tabs.md).
 *
 *   A. public/patient-type.js — the pure classification rules, the override,
 *      the counts, Hebrew labels at render time only.
 *   B. schema: ONE append-only column at the very END of CLIENTS_HEADERS
 *      (patientTypeOverride, position 42), mirrored at the end of the
 *      Clients-removed literal; parity of PATIENT_TYPES with the module.
 *   C. _saveAll (REAL Code.gs in the sandbox): a sent value is validated; a
 *      payload WITHOUT the key keeps the sheet value; a cleared value is an
 *      edit; it is NOT a money key; a tombstone keeps it.
 *   D. no consumer projection: getTreatmentPlans never carries it.
 *   E. frontend source contracts: script tag, edit-form select, tabs, chip.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sandbox } = require('../test-support/apps-script-sandbox');
const PT = require('../public/patient-type.js');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const GS = fs.readFileSync(path.join(ROOT, 'apps-script', 'Code.gs'), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));

/* ============================ A. pure rules ============================== */

const ots = (clientId, clinical) => ({ id: 'ots-' + clientId + '-' + clinical, clientId, clinicalTreatmentType: clinical, status: 'scheduled' });

test('A: day-center plans (new label and legacy «מרכז יום») → קהילה יומית', () => {
  assert.equal(PT.classify({ id: 'a', serviceType: 'ליווי יומי בקהילה' }, []).type, 'day_community');
  assert.equal(PT.classify({ id: 'a', serviceType: 'מרכז יום, פרטני' }, []).type, 'day_community');
});

test('A: a day-community patient who also sees the psychiatrist stays in קהילה יומית only', () => {
  const c = { id: 'a', serviceType: 'ליווי יומי בקהילה, מעקב פסיכיאטרי' };
  assert.equal(PT.classify(c, [ots('a', 'מעקב פסיכיאטרי')]).type, 'day_community');
});

test('A: a plan of psychiatric treatments only → פסיכיאטר; any other plan → טיפולים פרטניים', () => {
  assert.equal(PT.classify({ id: 'a', serviceType: 'מעקב פסיכיאטרי' }, []).type, 'psychiatric');
  assert.equal(PT.classify({ id: 'a', serviceType: 'מעקב פסיכיאטרי, אינטייק' }, []).type, 'psychiatric');
  assert.equal(PT.classify({ id: 'a', serviceType: 'פרטני, מעקב פסיכיאטרי' }, []).type, 'individual');
  for (const s of ['פרטני', 'פרטני CBT', 'פרטני EMDR', 'קבוצה', 'טיפול משפחתי', 'טיפול משלים']) {
    assert.equal(PT.classify({ id: 'a', serviceType: s }, []).type, 'individual', s);
  }
});

test('A: no plan (a lead booked one session) — decided by that patient\'s one-time sessions', () => {
  const lead = { id: 'L', serviceType: '', billingMode: 'per_session' };
  assert.equal(PT.classify(lead, [ots('L', 'מעקב פסיכיאטרי')]).type, 'psychiatric', 'ייעוץ / מעקב');
  assert.equal(PT.classify(lead, [ots('L', 'אינטייק')]).type, 'psychiatric', 'אבחון / אינטייק');
  assert.equal(PT.classify(lead, [ots('L', 'אינטייק'), ots('L', 'פרטני CBT')]).type, 'individual', 'mixed → individual');
  assert.equal(PT.classify(lead, [ots('L', 'פרטני EMDR')]).type, 'individual');
  assert.equal(PT.classify(lead, []).type, 'individual', 'nothing known → individual');
  assert.equal(PT.classify(lead, null).type, 'individual', 'sessions not loaded → individual, never a crash');
  assert.equal(PT.classify(lead, [ots('OTHER', 'מעקב פסיכיאטרי')]).type, 'individual', 'another patient\'s sessions never count');
  assert.equal(PT.classify({ serviceType: '' }, [ots('', 'מעקב פסיכיאטרי')]).type, 'individual', 'no id → never matches');
});

test('A: a valid override decides and is marked manual; an invalid one is ignored', () => {
  const c = { id: 'a', serviceType: 'ליווי יומי בקהילה', patientTypeOverride: 'psychiatric' };
  assert.deepEqual(PT.classify(c, []), { type: 'psychiatric', manual: true });
  assert.deepEqual(PT.classify({ ...c, patientTypeOverride: ' individual ' }, []), { type: 'individual', manual: true });
  assert.deepEqual(PT.classify({ ...c, patientTypeOverride: 'psychiatrist' }, []), { type: 'day_community', manual: false });
  assert.deepEqual(PT.classify({ ...c, patientTypeOverride: '' }, []), { type: 'day_community', manual: false });
  assert.deepEqual(PT.classify({ ...c, patientTypeOverride: '__proto__' }, []), { type: 'day_community', manual: false });
  assert.equal(PT.autoType(c, []), 'day_community', 'autoType ignores the override');
});

test('A: counts per type + all; every patient lands in exactly one type', () => {
  const clients = [
    { id: '1', serviceType: 'ליווי יומי בקהילה' },
    { id: '2', serviceType: 'פרטני' },
    { id: '3', serviceType: 'מעקב פסיכיאטרי' },
    { id: '4', serviceType: '' },
    { id: '5', serviceType: 'פרטני', patientTypeOverride: 'day_community' }
  ];
  const c = PT.counts(clients, [ots('4', 'אינטייק')]);
  assert.deepEqual(c, { all: 5, day_community: 2, individual: 1, psychiatric: 2 });
  assert.equal(c.day_community + c.individual + c.psychiatric, c.all);
  assert.deepEqual(PT.counts([], null), { all: 0, day_community: 0, individual: 0, psychiatric: 0 });
});

test('A: stable English keys, Hebrew labels render-time only', () => {
  assert.deepEqual(PT.TYPES, ['day_community', 'individual', 'psychiatric']);
  assert.equal(PT.label('day_community'), 'קהילה יומית');
  assert.equal(PT.label('individual'), 'טיפולים פרטניים');
  assert.equal(PT.label('psychiatric'), 'פסיכיאטר');
  assert.equal(PT.label('toString'), '', 'own properties only');
  assert.equal(PT.label('nope'), '');
});

/* ================================ B. schema ============================== */

test('B: patientTypeOverride is appended LAST on Clients (42) and mirrored last on the tombstone', () => {
  const { ctx } = sandbox();
  const H = plain(ctx.CLIENTS_HEADERS), R = plain(ctx.CLIENTS_REMOVED_HEADERS);
  assert.equal(H.length, 42);
  assert.equal(H[41], 'patientTypeOverride');
  assert.equal(H.indexOf('privateTherapists'), 40, 'nothing before it moves');
  assert.equal(H.indexOf('phone'), 25, 'phone join key untouched');
  assert.equal(R[R.length - 1], 'patientTypeOverride');
  assert.equal(H.filter((h) => h === 'patientTypeOverride').length, 1);
});

test('B: PATIENT_TYPES in Code.gs mirrors the browser module; validator is a closed set', () => {
  const { ctx } = sandbox();
  assert.deepEqual(plain(ctx.PATIENT_TYPES), PT.TYPES);
  for (const k of PT.TYPES) assert.equal(ctx._patientTypeOrBlank(k), k);
  assert.equal(ctx._patientTypeOrBlank(' psychiatric '), 'psychiatric');
  for (const bad of ['', 'Psychiatric', 'psychiatrist', 'פסיכיאטר', null, undefined, 3, '__proto__', '<script>']) {
    assert.equal(ctx._patientTypeOrBlank(bad), '', String(bad));
  }
});

/* ================================ C. _saveAll ============================ */

const base = (over) => Object.assign({
  id: 'c1', name: 'נועה', phone: '0501234567', serviceType: 'פרטני',
  sessionsPerWeek: '{"פרטני":1}', status: 'פעיל', startDate: '2026-09-01',
  nextBillingDate: '2026-12-01', paymentStatus: 'paid'
}, over);

test('C: a new client stores a valid override; an invalid one stores blank', () => {
  const h = sandbox();
  h.save([], [base({ patientTypeOverride: 'psychiatric' })]);
  assert.equal(h.rows('Clients')[0].patientTypeOverride, 'psychiatric');
  const h2 = sandbox();
  h2.save([], [base({ patientTypeOverride: '=HYPERLINK("x")' })]);
  assert.equal(h2.rows('Clients')[0].patientTypeOverride, '');
});

test('C: a payload WITHOUT the key (pre-column tab) keeps the sheet value; a sent blank clears it', () => {
  const h = sandbox();
  h.save([], [base({ patientTypeOverride: 'day_community' })]);
  const echo = { ...h.rows('Clients')[0] };
  delete echo.patientTypeOverride;
  h.save([], [echo]);
  assert.equal(h.rows('Clients')[0].patientTypeOverride, 'day_community', 'an old tab cannot blank it');
  h.save([], [{ ...h.rows('Clients')[0], patientTypeOverride: '' }]);
  assert.equal(h.rows('Clients')[0].patientTypeOverride, '', 'automatic again');
});

test('C: the override is not a money key — an operational session may set it', () => {
  const { ctx } = sandbox();
  assert.ok(!plain(ctx.OPS_CLIENT_MONEY_KEYS).includes('patientTypeOverride'));
});

test('C: the tombstone keeps the override when a client row is removed', () => {
  const h = sandbox();
  h.save([], [base({ patientTypeOverride: 'individual' }), base({ id: 'c2', name: 'אחר', phone: '0501234568' })]);
  h.save([], [h.rows('Clients').find((r) => r.id === 'c2')]);
  const tomb = h.rows('Clients-removed').find((r) => r.id === 'c1');
  assert.ok(tomb, 'tombstoned');
  assert.equal(tomb.patientTypeOverride, 'individual');
});

/* ======================== D. no consumer projection ====================== */

test('D: getTreatmentPlans never projects the override (outpatient display only)', () => {
  const { ctx } = sandbox([], [base({ patientTypeOverride: 'psychiatric' })]);
  const p = plain(ctx._getTreatmentPlans()).clients[0];
  assert.ok(!('patientTypeOverride' in p));
  assert.ok(!/patientTypeOverride/.test(GS.slice(GS.indexOf('function _getTreatmentPlans'), GS.indexOf('\nfunction ', GS.indexOf('function _getTreatmentPlans') + 10))));
});

/* ======================= E. frontend source contracts ==================== */

test('E: patient-type.js loads before app.js with ?v=__BUILD__', () => {
  const tag = '<script src="patient-type.js?v=__BUILD__" defer></script>';
  assert.ok(HTML.includes(tag));
  assert.ok(HTML.indexOf(tag) < HTML.indexOf('<script src="app.js'), 'before app.js');
});

test('E: the edit form offers אוטומטי + the three types as stable keys', () => {
  const sel = HTML.match(/<select name="patientTypeOverride">([\s\S]*?)<\/select>/);
  assert.ok(sel, 'select exists in the edit form');
  const values = [...sel[1].matchAll(/value="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(values, ['', 'day_community', 'individual', 'psychiatric']);
  assert.ok(HTML.indexOf('name="patientTypeOverride"') > HTML.indexOf('id="editClientForm"'), 'in the edit form');
  assert.ok(HTML.includes('id="clientTypeTabs"'));
});

test('E: app.js round-trips the override and renders the tabs from the module', () => {
  assert.match(APP, /patientTypeOverride: patientTypeOverrideOrBlank\(row\.patientTypeOverride\)/, 'read from the sheet');
  assert.match(APP, /patientTypeOverride: patientTypeOverrideOrBlank\(c\.patientTypeOverride\)/, 'sent on save');
  assert.match(APP, /patientTypeOverride: client\.patientTypeOverride\n/, 'rolled back with the other edit fields');
  assert.match(APP, /api\.counts\(active, state\.oneTimeSessions\)/, 'counts use the same rules');
  assert.match(APP, /clientType: 'all'/, 'state initialised');
  assert.match(APP, /state\.clientType = 'all';/, 'the cross-tab locator resets the type tab');
  // values reach the DOM through escapeHtml only
  const chip = APP.slice(APP.indexOf('function patientTypeChipHtml'), APP.indexOf('function statusClass'));
  assert.match(chip, /escapeHtml\(pt\.type\)/);
  assert.match(chip, /escapeHtml\(text\)/);
});
