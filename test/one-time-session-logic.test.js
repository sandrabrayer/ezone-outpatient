'use strict';

/* One-time session — pure browser helpers (public/one-time-sessions.js), the «היום שלי»
 * rows, the browser/source parity of the charge draft, and the wiring guards
 * (script tag cache-busted, SW bump, money lists, no amount input). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const OTS = require('../public/one-time-sessions.js');
const MyDay = require('../public/my-day.js');
const { sandbox } = require('../test-support/apps-script-sandbox.js');
const moneyScope = require('../lib/money-scope');

const PUB = path.join(__dirname, '..', 'public');
const S = (o) => Object.assign({ id: 'a', clientId: 'c1', patientName: 'פלונית', catalogKey: 'cbt_single', clinicalTreatmentType: 'פרטני CBT', amount: 500, therapist: 'הילה תבור', date: '2026-11-11', time: '10:00', location: '', status: 'scheduled', chargeId: 'ots-a', revision: 1 }, o);

test('labels: Hebrew at render time, stable keys, unknown falls back', () => {
  assert.equal(OTS.statusLabel('scheduled'), 'מתוכנן');
  assert.equal(OTS.statusLabel('therapist_cancelled'), 'בוטל ע״י המטפל/ת');
  assert.equal(OTS.serviceLabel('k', 'פרטני EMDR'), 'EMDR — טיפול בודד');
  assert.equal(OTS.serviceLabel('k', 'אינטייק'), 'אבחון פסיכיאטרי');
  assert.equal(OTS.serviceLabel('k', 'טיפול משפחתי'), 'טיפול משפחתי', 'unknown type shows as itself');
  assert.equal(OTS.errorText('therapist_busy'), 'המטפל/ת כבר משובץ/ת לטיפול חד פעמי באותו מועד');
  assert.equal(OTS.errorText('weird'), 'weird');
  assert.match(OTS.newId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('forClient: scheduled soonest first, then closed newest first, capped', () => {
  const list = [S({ id: '1', date: '2026-11-20' }), S({ id: '2', date: '2026-11-12' }), S({ id: '3', status: 'completed', date: '2026-11-01' }), S({ id: '4', status: 'cancelled', date: '2026-11-05' }), S({ id: '5', clientId: 'other' })];
  assert.deepEqual(OTS.forClient(list, 'c1').map((x) => x.id), ['2', '1', '4', '3']);
  assert.deepEqual(OTS.forClient(list, 'c1', 1).map((x) => x.id), ['2', '1', '4']);
});

test('chargeState: unknown when charges did not load, missing, paid / unpaid from the host rule', () => {
  const ch = [{ id: 'ots-a', active: true }];
  assert.equal(OTS.chargeState(S(), ch, false, () => 'paid'), 'unknown');
  assert.equal(OTS.chargeState(S(), [], true, () => 'paid'), 'missing');
  assert.equal(OTS.chargeState(S(), [{ id: 'ots-a', active: false }], true, () => 'paid'), 'missing', 'an inactive charge is not the charge');
  assert.equal(OTS.chargeState(S(), ch, true, () => 'paid'), 'paid');
  assert.equal(OTS.chargeState(S(), ch, true, () => 'nonsense'), 'unpaid');
});

test('actionsFor: by status, date and charge state', () => {
  assert.deepEqual(OTS.actionsFor(S({ date: '2026-11-12' }), '2026-11-11', 'unpaid'), ['edit', 'therapist_cancelled', 'cancel'], 'future: no outcome yet');
  assert.deepEqual(OTS.actionsFor(S(), '2026-11-11', 'paid'), ['edit', 'happened', 'patient_no_show', 'therapist_cancelled', 'cancel']);
  assert.deepEqual(OTS.actionsFor(S(), '2026-11-11', 'missing'), ['edit', 'happened', 'patient_no_show', 'therapist_cancelled', 'cancel', 'complete_charge']);
  assert.deepEqual(OTS.actionsFor(S({ status: 'therapist_cancelled' }), '2026-11-11', 'paid'), ['cancel']);
  assert.deepEqual(OTS.actionsFor(S({ status: 'cancelled' }), '2026-11-11', 'unpaid'), ['remove_charge']);
  assert.deepEqual(OTS.actionsFor(S({ status: 'cancelled' }), '2026-11-11', 'paid'), [], 'a paid charge is never removed from here');
  assert.deepEqual(OTS.actionsFor(S({ status: 'completed' }), '2026-11-11', 'unknown'), []);
});

test('chargeDraft (browser retry) equals the source draft field for field', () => {
  const sb = sandbox();
  for (const clinical of ['פרטני EMDR', 'פרטני CBT', 'מעקב פסיכיאטרי', 'אינטייק']) {
    const row = { id: 'a', clientId: 'c1', clinicalTreatmentType: clinical, therapist: 'הילה תבור', date: '2026-11-11', time: '10:00', priceAgorot: 85000, chargeId: 'ots-a' };
    const server = JSON.parse(JSON.stringify(sb.ctx._otsChargeDraft(row)));
    const browser = OTS.chargeDraft(S({ clinicalTreatmentType: clinical, amount: 850 }));
    assert.deepEqual(browser, server, clinical);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(sb.ctx.ONE_TIME_CHARGE_TREATMENT_TYPES)), OTS.CHARGE_TREATMENT_TYPES);
});

test('«היום שלי»: today / unmarked / therapist-cancelled / unpaid soon / charge missing; money rows hidden for דנה', () => {
  const today = '2026-11-11';
  const sessions = [
    S({ id: 't', chargeState: 'paid' }),
    S({ id: 'late', date: '2026-11-09', chargeState: 'paid' }),
    S({ id: 'tc', status: 'therapist_cancelled', chargeState: 'paid' }),
    S({ id: 'soon', date: '2026-11-13', chargeState: 'unpaid' }),
    S({ id: 'far', date: '2026-11-20', chargeState: 'unpaid' }),
    S({ id: 'nc', date: '2026-11-25', chargeState: 'missing' }),
    S({ id: 'x', status: 'cancelled', chargeState: 'missing' })
  ];
  const rows = OTS.myDayRows(sessions, today);
  assert.deepEqual(rows.map((r) => r.session.id + ':' + r.kind), ['t:one_time_today', 'late:one_time_unmarked', 'tc:one_time_therapist_cancelled', 'soon:one_time_unpaid', 'nc:one_time_charge_missing']);
  const base = { leads: [], clients: [{ id: 'c1', name: 'פלונית', status: 'פעיל' }], stopFlags: [], extraRequests: [], continuation: [], tasks: [], activity: [], today };
  const m = MyDay.build(Object.assign({}, base, { user: 'ורד', oneTimeRows: rows }));
  const ids = [].concat(...Object.values(m.rowsBy)).map((r) => r.id).sort();
  assert.deepEqual(ids, ['ots:nocharge:nc', 'ots:tcancel:tc', 'ots:today:t', 'ots:unmarked:late', 'ots:unpaid:soon']);
  const dated = m.sections.find((x) => x.id === 'dated').rows.map((r) => r.id);
  assert.ok(dated.includes('ots:today:t') && dated.includes('ots:unmarked:late'));
  const todayRow = m.rowsBy.tasks.find((r) => r.id === 'ots:today:t');
  assert.equal(todayRow.priority, 'binding'); assert.equal(todayRow.open, 'client'); assert.equal(todayRow.name, 'פלונית');
  const dana = MyDay.build(Object.assign({}, base, { user: 'דנה', oneTimeRows: rows }));
  const danaIds = [].concat(...Object.values(dana.rowsBy)).map((r) => r.id).sort();
  assert.deepEqual(danaIds, ['ots:tcancel:tc', 'ots:today:t', 'ots:unmarked:late'], 'no money rows for an ops user');
  // two sessions of one patient on one day are two rows (never collapsed)
  const two = MyDay.build(Object.assign({}, base, { user: 'ורד', oneTimeRows: OTS.myDayRows([S({ id: 'p1' }), S({ id: 'p2', time: '12:00' })], today) }));
  assert.equal(two.rowsBy.tasks.length, 2);
  // a source that did not load contributes nothing (and is reported as a load gap by the host)
  assert.equal(MyDay.build(Object.assign({}, base, { user: 'ורד', oneTimeRows: null })).total, 0);
});

test('wiring: script tag cache-busted before app.js, SW bumped, modal has no amount, money lists, feed refused by the proxy', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.ok(html.includes('<script src="one-time-sessions.js?v=__BUILD__" defer></script>'));
  assert.ok(html.indexOf('one-time-sessions.js') < html.indexOf('<script src="app.js'), 'loads before app.js');
  const modal = html.slice(html.indexOf('id="otsModal"'), html.indexOf('id="otsCancelModal"'));
  assert.equal(/name="amount"|name="price"/.test(modal), false, 'no price input');
  assert.match(fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8'), /var CACHE = 'ezone-outpatient-v38';/);
  for (const a of ['createOneTimeSession', 'updateOneTimeSession', 'cancelOneTimeSession', 'markOneTimeSession']) assert.ok(moneyScope.isMoneyAction('POST', a), a);
  assert.ok(moneyScope.isMoneyAction('GET', 'getOneTimeServices'));
  assert.equal(moneyScope.isMoneyAction('GET', 'getOneTimeSessions'), false, 'the schedule itself is operational (amount is stripped)');
  assert.ok(moneyScope.MONEY_KEYS.includes('amount'), 'the session view carries its price as `amount`, a stripped key');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /if \(action === 'getOneTimeSessionsFeed'\) return res\.status\(403\)/);
  const app = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
  assert.equal(/innerHTML[^;\n]*\+\s*x\.(therapist|note|statusReason|location)\b/.test(app), false, 'free text is escaped');
});
