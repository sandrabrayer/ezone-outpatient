'use strict';

/* One-time PSYCHIATRIC treatments (CHANGELOG-one-time-psychiatric.md, 2026-11-16) — the real
 * Code.gs in the sandbox:
 *   A. the four psychiatric services (ייעוץ 900 / מעקב 1,100 / אבחון 2,500 / אינטייק 2,300) are
 *      offered, priced by the SOURCE only, and mapped to the clinical type that decides the pay;
 *   B. booking each one: price snapshot, charge draft, outcome → ONE SessionLog row with the
 *      psychiatrist's own rate (follow-up vs intake), outside the package quota, no credit effect;
 *   C. the therapists feed stays price-free for them;
 *   D. a LEAD booking: the lead is saved as a per-session patient (no package, no renewal cycle,
 *      no payment row) and can then be booked through the same path;
 *   E. static wiring of the lead button / modal (the browser flow is in
 *      test/one-time-lead-browser.test.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sandbox } = require('../test-support/apps-script-sandbox.js');
const catalogAdmin = require('../lib/catalog-admin');
const OTS = require('../public/one-time-sessions.js');

const plain = (x) => JSON.parse(JSON.stringify(x));
const ASSERT = 'catalog-admin-assertion-secret-0123456789-C';
const FEED_SECRET = 'one-time-sessions-secret-0123456789abcdef';
const OUTCOME_SECRET = 'session-outcome-secret-fixture';
const PSY = 'ד"ר מיכאל שפרינץ';
const CLIENT = { id: 'c-psy-1', name: 'מטופלת חבילה', phone: '0501234567', status: 'פעיל', serviceType: 'פרטני', location: 'רעננה הפרדס', sessionsPerWeek: '{"פרטני":1}', pricePerSession: 2000, billingType: 'monthly', billingDay: 5, startDate: '2026-10-01', creditsOwed: 2 };
const LEAD = { id: 'lead-psy-1', name: 'פנייה לפסיכיאטר', phone: '0521112233', stage: 'פרטים אישיים', serviceType: '', location: 'רמות השבים', assignedTo: 'ורד', created: '2026-11-10' };
const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const SERVICES = [
  // key, Hebrew label, price ₪, clinical type, pay for the psychiatrist, charge treatmentType
  ['psychiatric_consult', 'ייעוץ פסיכיאטרי', 900, 'מעקב פסיכיאטרי', 600, 'מעקב פסיכיאטרי'],
  ['psychiatric_followup', 'מעקב פסיכיאטרי', 1100, 'מעקב פסיכיאטרי', 600, 'מעקב פסיכיאטרי'],
  ['psychiatric_diagnosis', 'אבחון פסיכיאטרי', 2500, 'אינטייק', 900, ''],
  ['psychiatric_intake', 'אינטייק פסיכיאטרי', 2300, 'אינטייק', 900, '']
];

function fixture(leads = [], clients = [CLIENT]) {
  const sb = sandbox(leads, clients);
  Object.assign(sb.props, { CATALOG_ADMIN_ASSERTION_SECRET: ASSERT, ONE_TIME_SESSIONS_SECRET: FEED_SECRET, SESSION_OUTCOME_SECRET: OUTCOME_SECRET });
  const raw = (p) => JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(p) } }).getContent());
  const admin = (action, body) => raw(Object.assign({ action }, body, { proxySecret: sb.props.OUTPATIENT_PROXY_SECRET, adminAssertion: catalogAdmin.signAssertion(action, body, ASSERT) }));
  assert.equal(admin('adminSeedPackageCatalog', { user: 'ורד' }).ok, true);
  sb.seed('TherapistRates', sb.ctx.THERAPIST_RATES_HEADERS, [
    { name: 'הילה תבור', flatRate: 300 },
    { name: PSY, intakeRate: 900, followupRate: 600 }
  ]);
  sb.ctx._todayISODate = () => '2026-11-16';
  const post = (body, user = 'ורד', scope = 'full') => sb.post(Object.assign({ user, moneyScope: scope }, body));
  const get = (params) => sb.get(Object.assign({ proxySecret: sb.props.OUTPATIENT_PROXY_SECRET }, params));
  const create = (n, over = {}) => post({ action: 'createOneTimeSession', session: Object.assign({ id: U(n), clientId: CLIENT.id, catalogKey: 'psychiatric_consult', therapist: PSY, date: '2026-11-16', time: '10:00', location: 'רעננה הפרדס', note: '' }, over) });
  return { sb, raw, post, get, create };
}

test('A: four psychiatric one-time services — distinct keys, source prices, the clinical type that decides the pay', () => {
  const { get, sb } = fixture();
  const s = get({ action: 'getOneTimeServices' });
  assert.equal(s.ok, true);
  const psy = s.services.filter((x) => x.family === 'psychiatric');
  assert.deepEqual(psy.map((x) => [x.key, x.amount, x.clinicalTreatmentType]).sort(), SERVICES.map((x) => [x[0], x[2], x[3]]).sort());
  // each one has its OWN Hebrew label, although two pairs share a clinical type
  const labels = psy.map((x) => OTS.serviceLabel(x.key, x.clinicalTreatmentType));
  assert.equal(new Set(labels).size, 4, 'four different labels: ' + labels.join(' | '));
  for (const [key, label] of SERVICES) assert.equal(OTS.serviceLabel(key, psy.find((x) => x.key === key).clinicalTreatmentType), label);
  // the mapping is by key and fails closed for an unmapped psychiatric row
  assert.deepEqual(plain(sb.ctx.ONE_TIME_CLINICAL_BY_KEY), { psychiatric_consult: 'מעקב פסיכיאטרי', psychiatric_diagnosis: 'אינטייק', psychiatric_followup: 'מעקב פסיכיאטרי', psychiatric_intake: 'אינטייק' });
  assert.equal(sb.ctx._otsClinicalFor({ key: 'psychiatric_other', family: 'psychiatric' }), '', 'no guessed pay type');
  // the existing billing price constants are untouched by the catalog rows
  assert.equal(sb.ctx._billingPrice('מעקב פסיכיאטרי'), 1100);
});

for (const [key, label, price, clinical, pay, chargeType] of SERVICES) {
  test('B: ' + key + ' (' + label + ') — booked, charged from the catalog, paid by the psychiatrist rate, outside the package', () => {
    const { sb, post, create } = fixture();
    const a = create(1, { catalogKey: key, amount: 1, priceAgorot: 1 }); // a browser amount is ignored
    assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(a.created, true);
    assert.equal(a.session.amount, price);
    assert.equal(a.session.catalogKey, key);
    assert.equal(a.session.clinicalTreatmentType, clinical);
    assert.deepEqual(plain(a.charge), { id: 'ots-' + U(1), clientId: CLIENT.id, description: 'טיפול חד פעמי — ' + clinical + ' · ' + PSY + ' · 2026-11-16 10:00', amount: price,
      billingType: 'one_time', chargeDate: '2026-11-16', billingDay: '', notes: 'oneTimeSession:' + U(1), treatmentType: chargeType, frequencyPerWeek: '' });
    assert.deepEqual(OTS.chargeDraft(a.session), plain(a.charge), 'the browser retry draft equals the source draft');
    const row = sb.rows('OneTimeSessions')[0];
    assert.equal(Number(row.priceAgorot), price * 100);
    // ורד marks it happened → ONE SessionLog row with the psychiatrist's rate for THIS kind of meeting
    const m = post({ action: 'markOneTimeSession', id: U(1), expectedRevision: 1, opId: U(900), outcome: 'happened' });
    assert.equal(m.ok, true, JSON.stringify(m)); assert.equal(m.session.status, 'completed');
    const log = sb.rows('SessionLog');
    assert.equal(log.length, 1);
    assert.equal(log[0].sessionId, 'ots::' + U(1));
    assert.equal(log[0].clinicalTreatmentType, clinical);
    assert.equal(Number(log[0].therapistPay), pay);
    assert.equal(Number(log[0].clientSessionValue), price);
    assert.equal(log[0].creditStatus, 'one_time');
    assert.equal(log[0].oneTimeSessionId, U(1));
    // outside the package: no credit effect, not counted in the month's package quota
    assert.equal(Number(sb.rows('Clients')[0].creditsOwed), 2);
    assert.equal(sb.ctx._happenedInMonth(sb.ctx._readAll(sb.sheets.SessionLog, sb.ctx.SESSION_LOG_HEADERS), CLIENT.id, '2026-11', ''), 0);
  });
}

test('B: a psychiatric session with a therapist who has no psychiatric rate fails closed — no SessionLog row, no pay invented', () => {
  const { sb, post, create } = fixture();
  sb.seed('TherapistRates', sb.ctx.THERAPIST_RATES_HEADERS, [{ name: 'רופא בלי תעריף', intakeRate: 900 }, { name: PSY, intakeRate: 900, followupRate: 600 }]);
  assert.equal(create(1, { catalogKey: 'psychiatric_followup', therapist: 'רופא בלי תעריף' }).ok, true);
  const m = post({ action: 'markOneTimeSession', id: U(1), expectedRevision: 1, opId: U(901), outcome: 'happened' });
  assert.equal(m.ok, false); assert.equal(m.error, 'unknown_therapist');
  assert.equal(sb.rows('SessionLog').length, 0);
  assert.equal(sb.rows('OneTimeSessions')[0].status, 'scheduled', 'the session is not closed without a pay record');
});

test('C: the therapists feed carries the psychiatric session with no amount, charge or note', () => {
  const { sb, create } = fixture();
  assert.equal(create(1, { catalogKey: 'psychiatric_intake', note: 'הערה פנימית' }).ok, true);
  const feed = sb.get({ action: 'getOneTimeSessionsFeed', secret: FEED_SECRET });
  assert.equal(feed.ok, true); assert.equal(feed.sessions.length, 1);
  assert.deepEqual(Object.keys(feed.sessions[0]).sort(), plain(sb.ctx.ONE_TIME_FEED_KEYS).sort());
  assert.equal(feed.sessions[0].catalogKey, 'psychiatric_intake');
  assert.equal(feed.sessions[0].clinicalTreatmentType, 'אינטייק');
  assert.equal(/2300|230000|amount|price|charge|הערה פנימית/.test(JSON.stringify(feed)), false, 'price-free');
  assert.equal(sb.get({ action: 'getOneTimeSessionsFeed', secret: 'wrong' }).error, 'unauthorized');
});

test('D: a lead booking — the lead becomes a per-session patient (no package, no cycle, no payment row), then books like any patient', () => {
  const { sb, post, create } = fixture([LEAD], [CLIENT]);
  // exactly the row the browser builds (otsLeadClient in public/app.js)
  const fromLead = { id: 'id_from_lead_1', name: LEAD.name, phone: LEAD.phone, serviceType: '', location: 'רמות השבים', sessionsPerWeek: {}, sessionsUnit: {}, pricePerSession: 0,
    startDate: '2026-11-16', status: 'פעיל', exitDate: '', fromLead: LEAD.id, source: 'lead', notes: 'נפתח/ה מליד לצורך טיפול חד פעמי', billingType: 'monthly',
    billingDay: '', paymentStatus: '', paymentDate: '', nextBillingDate: '', house_of_origin: '', assignedTo: 'ורד', preferredHouse: '', billingMode: 'per_session', complementaryType: '', privateTherapists: [] };
  const saved = post({ action: 'saveAll', leads: [LEAD], clients: [CLIENT, fromLead], requireIds: [fromLead.id] });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(sb.rows('Leads').length, 0, 'the lead left the pipeline (linked by fromLead)');
  const stored = sb.rows('Clients').find((c) => c.id === fromLead.id);
  assert.equal(stored.billingMode, 'per_session');
  assert.equal(stored.fromLead, LEAD.id);
  assert.equal(stored.assignedTo, 'ורד', 'the assignee follows the person');
  for (const k of ['nextBillingDate', 'paymentStatus', 'paymentDate', 'billingDay']) assert.equal(stored[k], '', k + ' stays blank — no renewal cycle is started');
  assert.equal(Number(stored.pricePerSession), 0, 'no package amount');
  assert.equal((sb.rows('Payments') || []).length, 0, 'the conversion writes no payment row');
  assert.equal((sb.rows('ClientCharges') || []).length, 0, 'and no charge');
  // the existing package patient was not touched by the conversion save
  assert.equal(Number(sb.rows('Clients').find((c) => c.id === CLIENT.id).creditsOwed), 2);
  // the booking itself: same path, priced by the source
  const a = create(1, { clientId: fromLead.id, catalogKey: 'psychiatric_consult', location: 'רמות השבים' });
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(a.session.amount, 900);
  assert.equal(a.session.patientName, LEAD.name);
  assert.equal(a.charge.clientId, fromLead.id);
  assert.equal(sb.rows('OneTimeSessions')[0].phone, LEAD.phone);
  // a lead that was NOT converted is not bookable: the source only knows patients
  assert.equal(create(2, { clientId: LEAD.id, time: '12:00' }).error, 'client_not_found');
});
