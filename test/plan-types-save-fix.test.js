'use strict';

/**
 * Plan-types save fix + therapist roster add (2026-11-09,
 * CHANGELOG-plan-types-save-fix.md). Real Code.gs in the in-memory sandbox.
 *
 *   A. _saveAll keeps the plan the person picked: a client with a
 *      clinicalTreatmentType no longer has a multi-type serviceType collapsed
 *      to the single clinical type. The clinical type only fills a BLANK one.
 *      The explicit cross-app setClinicalType receiver still overwrites.
 *   B. addTherapistToRoster: full scope only, validated, idempotent, names only
 *      (the rate cells stay blank), behind the proxy key.
 *   C. app.js read-side recovery of rows damaged before the fix.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { sandbox } = require('../test-support/apps-script-sandbox');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const base = (over) => Object.assign({
  id: 'c1', name: 'מטופל', phone: '0501234567',
  serviceType: 'פרטני, ליווי יומי בקהילה, מעקב פסיכיאטרי',
  sessionsPerWeek: '{"פרטני":2,"ליווי יומי בקהילה":3,"מעקב פסיכיאטרי":1}',
  clinicalTreatmentType: 'מעקב פסיכיאטרי', status: 'פעיל',
  startDate: '2026-09-01', nextBillingDate: '2026-12-01', paymentStatus: 'paid'
}, over);

/* ============================ A. _saveAll =================================== */

test('A: a multi-type plan survives a save when a clinical type is set', () => {
  const h = sandbox([], [base()]);
  const echo = { ...h.rows('Clients')[0] };
  const res = h.save([], [echo]);
  assert.equal(res.ok, true);
  assert.equal(h.rows('Clients')[0].serviceType, 'פרטני, ליווי יומי בקהילה, מעקב פסיכיאטרי');
});

test('A: an edit that ADDS a type is stored as picked', () => {
  const h = sandbox([], [base({ serviceType: 'מעקב פסיכיאטרי', sessionsPerWeek: '{"מעקב פסיכיאטרי":1}' })]);
  const edit = { ...h.rows('Clients')[0], serviceType: 'מעקב פסיכיאטרי, טיפול משלים',
    sessionsPerWeek: '{"מעקב פסיכיאטרי":1,"טיפול משלים":1}', complementaryType: 'yoga' };
  h.save([], [edit]);
  const row = h.rows('Clients')[0];
  assert.equal(row.serviceType, 'מעקב פסיכיאטרי, טיפול משלים');
  assert.equal(row.complementaryType, 'yoga');
});

test('A: a BLANK serviceType is still filled from the clinical type', () => {
  const h = sandbox();
  h.save([], [base({ serviceType: '', clinicalTreatmentType: 'פרטני כללי' })]);
  assert.equal(h.rows('Clients')[0].serviceType, 'פרטני');
});

test('A: an unknown clinical type never blocks a save (fail-soft kept)', () => {
  const h = sandbox();
  const res = h.save([], [base({ serviceType: '', clinicalTreatmentType: 'לא קיים' })]);
  assert.equal(res.ok, true);
  assert.equal(h.rows('Clients')[0].serviceType, '');
});

test('A: the explicit setClinicalType receiver still derives + overwrites', () => {
  const h = sandbox([], [base({ clinicalTreatmentType: '' })]);
  h.props.CLINICAL_TYPE_SECRET = 'clinical-fixture-secret';
  const res = h.ctx._setClinicalType({ phone: '0501234567', clinicalTreatmentType: 'פרטני כללי' });
  assert.equal(res.ok, true);
  assert.equal(h.rows('Clients')[0].serviceType, 'פרטני');
});

/* ======================= B. addTherapistToRoster ============================ */

function withRates() {
  const h = sandbox();
  h.seed('TherapistRates', h.ctx.THERAPIST_RATES_HEADERS, [
    { name: 'הילה תבור', flatRate: 300 },
    { name: 'ד"ר מיכאל שפרינץ', intakeRate: 900, followupRate: 700 }
  ]);
  return h;
}

test('B: a full-scope add appends ONE names-only row (rates blank), then is idempotent', () => {
  const h = withRates();
  const res = h.post({ action: 'addTherapistToRoster', moneyScope: 'full', user: 'ורד', name: '  אוהד   לביא ' });
  assert.deepEqual(JSON.parse(JSON.stringify(res)), { ok: true, existed: false, name: 'אוהד לביא' });
  const rows = h.rows('TherapistRates');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[2], { name: 'אוהד לביא', flatRate: '', intakeRate: '', followupRate: '' });
  assert.equal(rows[0].flatRate, 300, 'existing rates untouched');
  const again = h.post({ action: 'addTherapistToRoster', moneyScope: 'full', user: 'ורד', name: 'אוהד לביא' });
  assert.equal(again.existed, true);
  assert.equal(h.rows('TherapistRates').length, 3, 'no duplicate row');
  const names = h.get({ action: 'getTherapistNames', proxySecret: h.props.OUTPATIENT_PROXY_SECRET }).names;
  assert.ok(names.includes('אוהד לביא'));
});

test('B: an operational (ops) or scope-less request is refused and writes nothing', () => {
  const h = withRates();
  for (const moneyScope of ['ops', undefined, '']) {
    const res = h.post({ action: 'addTherapistToRoster', moneyScope, user: 'דנה', name: 'אוהד לביא' });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'forbidden_money_action');
  }
  assert.equal(h.rows('TherapistRates').length, 2);
});

test('B: invalid names are refused before any write', () => {
  const h = withRates();
  for (const name of ['', ' ', 'א', '<script>x</script>', 'a'.repeat(81), '12345', '=HYPERLINK("x")', null]) {
    const res = h.post({ action: 'addTherapistToRoster', moneyScope: 'full', user: 'ורד', name });
    assert.equal(res.error, 'invalid_name', String(name));
  }
  assert.equal(h.rows('TherapistRates').length, 2);
  // real-world punctuation is accepted
  assert.equal(h.post({ action: 'addTherapistToRoster', moneyScope: 'full', name: 'ד"ר רות בן-חיים' }).ok, true);
});

test('B: the action is behind the proxy key like every internal write', () => {
  const h = withRates();
  const res = JSON.parse(h.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(
    { action: 'addTherapistToRoster', moneyScope: 'full', name: 'אוהד לביא', proxySecret: 'wrong' }) } }).getContent());
  assert.equal(res.ok, false);
  assert.equal(h.rows('TherapistRates').length, 2);
  assert.equal(h.ctx.SOURCE_POST_AUTH.addTherapistToRoster, 'OUTPATIENT_PROXY_SECRET');
});

/* ================= C. app.js read-side recovery (pure function) ============= */

function loadRecover() {
  const m = APP.match(/function recoverPlanServices\(row\) \{[\s\S]*?\n {2}\}\n/);
  assert.ok(m, 'recoverPlanServices not found');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`
    var DAY_CENTER_ALIASES = ['מרכז יום', 'ליווי יומי בקהילה', 'day_center'];
    var SERVICE_TYPES = ['פרטני','פרטני CBT','פרטני EMDR','קבוצה','טיפול משפחתי','ליווי יומי בקהילה','מעקב פסיכיאטרי','טיפול משלים'];
    function parseServices(v) { if (!v) return []; return String(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
    ${m[0]}
    this.recover = recoverPlanServices;`, ctx);
  return ctx.recover;
}

test('C: the damaged-row signature is recovered from the frequency keys', () => {
  const recover = loadRecover();
  const damaged = { serviceType: 'מעקב פסיכיאטרי', clinicalTreatmentType: 'מעקב פסיכיאטרי',
    sessionsPerWeek: '{"פרטני":2,"ליווי יומי בקהילה":1,"מעקב פסיכיאטרי":2,"_units":{"מעקב פסיכיאטרי":"חודש"}}' };
  assert.deepEqual([...recover(damaged)], ['פרטני', 'ליווי יומי בקהילה', 'מעקב פסיכיאטרי']);
});

test('C: anything outside the exact signature is left as stored', () => {
  const recover = loadRecover();
  const sp = '{"פרטני":2,"מעקב פסיכיאטרי":1}';
  // no clinical type → the stored plan is the truth
  assert.deepEqual([...recover({ serviceType: 'מעקב פסיכיאטרי', clinicalTreatmentType: '', sessionsPerWeek: sp })], ['מעקב פסיכיאטרי']);
  // stored plan already multi-type
  assert.deepEqual([...recover({ serviceType: 'פרטני, מעקב פסיכיאטרי', clinicalTreatmentType: 'x', sessionsPerWeek: sp })], ['פרטני', 'מעקב פסיכיאטרי']);
  // stored type is not among the keys
  assert.deepEqual([...recover({ serviceType: 'קבוצה', clinicalTreatmentType: 'x', sessionsPerWeek: sp })], ['קבוצה']);
  // an unknown key is never promoted to a plan type
  assert.deepEqual([...recover({ serviceType: 'פרטני', clinicalTreatmentType: 'x', sessionsPerWeek: '{"פרטני":1,"זבל":1}' })], ['פרטני']);
  // legacy plain-number / malformed frequency
  assert.deepEqual([...recover({ serviceType: 'פרטני', clinicalTreatmentType: 'x', sessionsPerWeek: '2' })], ['פרטני']);
  assert.deepEqual([...recover({ serviceType: 'פרטני', clinicalTreatmentType: 'x', sessionsPerWeek: '{bad' })], ['פרטני']);
});

test('C: the picker search + add are wired without innerHTML of names', () => {
  assert.match(APP, /dataset\.therapistSearch = '1'/);
  assert.match(APP, /apiPostAction\('addTherapistToRoster', \{ name: typed \}\)/);
  assert.match(APP, /o\.textContent = n; \/\/ textContent only/);
  assert.match(APP, /var canAdd = !isOpsScope\(\)/);
});
