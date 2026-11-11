'use strict';

/**
 * טיפול משלים + שני מטפלים לפרטני (2026-11-09).
 *
 *   A. schema: TWO append-only columns at the very END of CLIENTS_HEADERS —
 *      complementaryType (position 40) and privateTherapists (position 41) —
 *      mirrored at the end of the Clients-removed literal; nothing before them
 *      moves. Stable English subtype keys; Hebrew labels render-time only.
 *   B. validators: _complementaryTypeOrBlank (closed set or blank) and
 *      _privateTherapistsOrBlank (1-2 distinct trimmed names → normalized JSON).
 *   C. _saveAll: a sent value is validated; a payload WITHOUT the key keeps the
 *      sheet value (pre-column tab); a brand-new client seeds from its payload.
 *   D. getTreatmentPlans projects both (names/keys only — still no amounts) and
 *      getTherapistNames serves names ONLY, behind the proxy key, as a PURE
 *      read (never creates/seeds TherapistRates — the read-only-boot contract).
 *   E. frontend source contracts: the menu entry, the subtype picker, the two
 *      therapist selects gated on פרטני 2+/שבוע, and the round-trip fields.
 * A–D run the REAL apps-script/Code.gs in the sandbox.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sandbox } = require('../test-support/apps-script-sandbox');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));
const base = (over) => Object.assign({
  id: 'c1', name: 'אורי', phone: '0501234567', serviceType: 'פרטני, טיפול משלים',
  sessionsPerWeek: '{"פרטני":2,"טיפול משלים":1}', status: 'פעיל',
  startDate: '2026-09-01', nextBillingDate: '2026-12-01', paymentStatus: 'paid'
}, over);

/* ================================ A. schema ================================ */

test('A: the two columns are appended LAST on Clients (40-41) and mirrored on the tombstone', () => {
  const { ctx } = sandbox();
  const H = plain(ctx.CLIENTS_HEADERS), R = plain(ctx.CLIENTS_REMOVED_HEADERS);
  assert.equal(H.length, 41);
  assert.deepEqual(H.slice(-2), ['complementaryType', 'privateTherapists']);
  assert.equal(H.indexOf('billingMode'), 38, 'nothing before them moves');
  assert.equal(H.indexOf('phone'), 25, 'phone join key untouched');
  assert.deepEqual(R.slice(-2), ['complementaryType', 'privateTherapists']);
  assert.deepEqual(plain(ctx.COMPLEMENTARY_TYPES), ['yoga', 'acupuncture', 'reflexology', 'art', 'somatic']);
  // Leads carry neither column.
  const L = plain(ctx.LEADS_HEADERS);
  assert.ok(!L.includes('complementaryType') && !L.includes('privateTherapists'));
});

/* ============================== B. validators ============================== */

test('B: _complementaryTypeOrBlank — closed set, anything else blank', () => {
  const { ctx } = sandbox();
  for (const k of ['yoga', 'acupuncture', 'reflexology', 'art', 'somatic']) {
    assert.equal(ctx._complementaryTypeOrBlank(' ' + k + ' '), k);
  }
  for (const bad of ['', null, undefined, 'יוגה', 'pilates', 'YOGA', 0, {}]) {
    assert.equal(ctx._complementaryTypeOrBlank(bad), '');
  }
});

test('B: _privateTherapistsOrBlank — 1-2 distinct trimmed names → normalized JSON, else blank', () => {
  const { ctx } = sandbox();
  assert.equal(ctx._privateTherapistsOrBlank('["הילה תבור"," דנה לוי "]'), '["הילה תבור","דנה לוי"]');
  assert.equal(ctx._privateTherapistsOrBlank(['הילה תבור']), '["הילה תבור"]');
  assert.equal(ctx._privateTherapistsOrBlank('["הילה תבור","","  "]'), '["הילה תבור"]');
  for (const bad of ['', null, 'not-json', '{}', '[]', '[""]',
    '["a","b","c"]', '["same","same"]', JSON.stringify(['x'.repeat(81)])]) {
    assert.equal(ctx._privateTherapistsOrBlank(bad), '', JSON.stringify(bad));
  }
});

/* ================================ C. _saveAll ============================== */

test('C: a new client seeds validated values; invalid values store blank', () => {
  const h = sandbox();
  h.save([], [base({ complementaryType: 'yoga', privateTherapists: '["הילה תבור","דנה לוי"]' })]);
  let row = h.rows('Clients')[0];
  assert.equal(row.complementaryType, 'yoga');
  assert.equal(row.privateTherapists, '["הילה תבור","דנה לוי"]');
  const h2 = sandbox();
  h2.save([], [base({ id: 'c2', complementaryType: 'pilates', privateTherapists: '["same","same"]' })]);
  row = h2.rows('Clients')[0];
  assert.equal(row.complementaryType, '');
  assert.equal(row.privateTherapists, '');
});

test('C: a payload WITHOUT the keys (pre-column tab) keeps the sheet values', () => {
  const h = sandbox();
  h.save([], [base({ complementaryType: 'art', privateTherapists: '["הילה תבור"]' })]);
  const echo = { ...h.rows('Clients')[0] };
  delete echo.complementaryType;
  delete echo.privateTherapists;
  h.save([], [echo]);
  const row = h.rows('Clients')[0];
  assert.equal(row.complementaryType, 'art', 'old tab cannot blank it');
  assert.equal(row.privateTherapists, '["הילה תבור"]');
});

test('C: a sent cleared value IS an edit — the fields can be emptied deliberately', () => {
  const h = sandbox();
  h.save([], [base({ complementaryType: 'art', privateTherapists: '["הילה תבור"]' })]);
  const echo = { ...h.rows('Clients')[0], complementaryType: '', privateTherapists: '' };
  h.save([], [echo]);
  const row = h.rows('Clients')[0];
  assert.equal(row.complementaryType, '');
  assert.equal(row.privateTherapists, '');
});

/* ===================== D. projections & the names feed ===================== */

test('D: getTreatmentPlans projects the subtype key and the therapist names (no amounts)', () => {
  const { ctx } = sandbox([], [base({ complementaryType: 'yoga', privateTherapists: '["הילה תבור","דנה לוי"]' })]);
  const p = plain(ctx._getTreatmentPlans()).clients[0];
  assert.equal(p.complementaryType, 'yoga');
  assert.deepEqual(p.privateTherapists, ['הילה תבור', 'דנה לוי']);
  // blank / missing → '' / []
  const empty = plain(sandbox([], [base({ id: 'c3' })]).ctx._getTreatmentPlans()).clients[0];
  assert.equal(empty.complementaryType, '');
  assert.deepEqual(empty.privateTherapists, []);
});

test('D: getTherapistNames serves sorted names ONLY, behind the proxy key', () => {
  const h = sandbox();
  h.seed('TherapistRates', h.ctx.THERAPIST_RATES_HEADERS, [
    { name: 'הילה תבור', flatRate: 300 },
    { name: 'ד"ר מיכאל שפרינץ', flatRate: '', intakeRate: 500, followupRate: 400 },
    { name: 'הילה תבור', flatRate: 300 }, // duplicate name → once
    { name: '', flatRate: 999 }
  ]);
  const res = h.get({ action: 'getTherapistNames', proxySecret: h.props.OUTPATIENT_PROXY_SECRET });
  assert.equal(res.ok, true);
  assert.deepEqual([...res.names].sort(), ['ד"ר מיכאל שפרינץ', 'הילה תבור'].sort());
  assert.doesNotMatch(JSON.stringify(res), /300|400|500|999|flatRate|intakeRate|followupRate/,
    'no rate ever crosses');
  // fail-closed auth like every internal read
  assert.deepEqual(h.get({ action: 'getTherapistNames', proxySecret: 'wrong' }),
    { ok: false, error: 'unauthorized' });
});

test('D: getTherapistNames is a PURE read — it never creates or seeds TherapistRates', () => {
  const h = sandbox(); // no TherapistRates sheet at all
  const res = h.get({ action: 'getTherapistNames', proxySecret: h.props.OUTPATIENT_PROXY_SECRET });
  assert.deepEqual(plain(res), { ok: true, names: [] });
  assert.equal(h.sheets.TherapistRates, undefined, 'read-only-boot: the sheet was not created');
});

/* ======================== E. frontend source contracts ===================== */

test('E: the menu, pickers, gating and round-trip fields exist in app.js', () => {
  // menu entry + stable keys + Hebrew labels
  assert.match(APP, /COMPLEMENTARY_LABEL = 'טיפול משלים'/);
  assert.match(APP, /COMPLEMENTARY_TYPES = \['yoga', 'acupuncture', 'reflexology', 'art'\]/);
  assert.match(APP, /yoga: 'יוגה', acupuncture: 'דיקור', reflexology: 'רפלקסולוגיה', art: 'אמנות'/);
  assert.match(APP, /'מעקב פסיכיאטרי',\s*\n\s*COMPLEMENTARY_LABEL\s*\n\s*\];/, 'added to SERVICE_TYPES');
  // subtype picker + therapist selects, gated on פרטני 2+/שבוע
  assert.match(APP, /dataset\.complementaryType = '1'/);
  assert.match(APP, /dataset\.privateTherapist = String\(idx \+ 1\)/);
  assert.match(APP, /wrap\.hidden = !\(weekly && n >= 2\)/);
  // validation messages
  assert.match(APP, /יש לבחור סוג טיפול משלים/);
  assert.match(APP, /יש לבחור שני מטפלים שונים לטיפול פרטני/);
  // round-trip: read from sheet + always sent on save
  assert.match(APP, /complementaryType: complementaryTypeOrBlank\(row\.complementaryType\)/);
  assert.match(APP, /privateTherapists: privateTherapistsArray\(row\.privateTherapists\)/);
  assert.match(APP, /complementaryType: complementaryTypeOrBlank\(c\.complementaryType\)/);
  // names roster fetched fail-soft at load
  assert.match(APP, /action=getTherapistNames/);
  assert.match(APP, /apiGetTherapistNames\(\)\.catch\(function \(\) \{ return \{ names: \[\] \}; \}\)/);
});
