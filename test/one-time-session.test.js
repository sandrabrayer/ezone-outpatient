'use strict';

/* One-time session (טיפול חד פעמי, CHANGELOG-one-time-session.md) — the real
 * Code.gs in the sandbox: catalog-priced creation (server price only),
 * idempotency, conflicts, reschedule / cancel with revision + op-id guards,
 * outcome writer (SessionLog 'ots::<id>', outside the package quota, no credit
 * effect), the therapists receiver + price-free feed (fail-closed secret), and
 * the auth / append-only schema. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../test-support/apps-script-sandbox.js');
const catalogAdmin = require('../lib/catalog-admin');

const plain = (x) => JSON.parse(JSON.stringify(x));
const ASSERT = 'catalog-admin-assertion-secret-0123456789-C';
const FEED_SECRET = 'one-time-sessions-secret-0123456789abcdef';
const OUTCOME_SECRET = 'session-outcome-secret-fixture';
const CLIENT = { id: 'c-ots-1', name: 'מטופלת חד פעמי', phone: '0501234567', status: 'פעיל', serviceType: 'פרטני', location: 'רעננה הפרדס', sessionsPerWeek: '{"פרטני":1}', pricePerSession: 2000, billingType: 'monthly', billingDay: 5, startDate: '2026-10-01', creditsOwed: 2 };
const OTHER = { id: 'c-ots-2', name: 'מטופל שני', phone: '0507654321', status: 'פעיל', serviceType: 'פרטני', billingMode: 'per_session' };
const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

function fixture() {
  const sb = sandbox([], [CLIENT, OTHER]);
  Object.assign(sb.props, { CATALOG_ADMIN_ASSERTION_SECRET: ASSERT, ONE_TIME_SESSIONS_SECRET: FEED_SECRET, SESSION_OUTCOME_SECRET: OUTCOME_SECRET });
  const raw = (p) => JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(p) } }).getContent());
  const admin = (action, body) => raw(Object.assign({ action }, body, { proxySecret: sb.props.OUTPATIENT_PROXY_SECRET, adminAssertion: catalogAdmin.signAssertion(action, body, ASSERT) }));
  assert.equal(admin('adminSeedPackageCatalog', { user: 'ורד' }).ok, true);
  sb.seed('TherapistRates', sb.ctx.THERAPIST_RATES_HEADERS, [
    { name: 'הילה תבור', flatRate: 300 },
    { name: 'דנה כהן', flatRate: 280 },
    { name: 'ד"ר מיכאל שפרינץ', intakeRate: 900, followupRate: 600 }
  ]);
  sb.ctx._todayISODate = () => '2026-11-11';
  const post = (body, user = 'ורד', scope = 'full') => sb.post(Object.assign({ user, moneyScope: scope }, body));
  const get = (params) => sb.get(Object.assign({ proxySecret: sb.props.OUTPATIENT_PROXY_SECRET }, params));
  const create = (n, over = {}) => post({ action: 'createOneTimeSession', session: Object.assign({ id: U(n), clientId: CLIENT.id, catalogKey: 'emdr_single', therapist: 'הילה תבור', date: '2026-11-11', time: '10:00', location: 'רעננה הפרדס', note: 'פגישה ראשונה' }, over) });
  return { sb, raw, post, get, create };
}

test('schema + auth: append-only headers, proxy-only internal actions, the feed has its own secret', () => {
  const { sb } = fixture();
  assert.deepEqual(plain(sb.ctx.ONE_TIME_SESSION_HEADERS), ['id', 'clientId', 'patientName', 'phone', 'catalogKey', 'catalogRowId', 'catalogEpoch', 'clinicalTreatmentType', 'priceAgorot', 'therapist', 'date', 'time', 'location', 'note', 'status', 'statusReason', 'chargeId', 'sessionLogId', 'payloadHash', 'revision', 'opLog', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy']);
  const L = plain(sb.ctx.SESSION_LOG_HEADERS);
  assert.equal(L[L.length - 1], 'oneTimeSessionId', 'appended at the very end');
  assert.equal(L[L.length - 2], 'payModel', 'every earlier column keeps its position');
  const P = plain(sb.ctx.SOURCE_POST_AUTH), G = plain(sb.ctx.SOURCE_GET_AUTH);
  for (const a of ['createOneTimeSession', 'updateOneTimeSession', 'cancelOneTimeSession', 'markOneTimeSession']) { assert.equal(P[a], 'OUTPATIENT_PROXY_SECRET', a); assert.equal(G[a], undefined, a + ' is never a GET'); }
  for (const a of ['getOneTimeSessions', 'getOneTimeServices']) assert.equal(G[a], 'OUTPATIENT_PROXY_SECRET', a);
  assert.equal(G.getOneTimeSessionsFeed, 'ONE_TIME_SESSIONS_SECRET');
  assert.equal(P.getOneTimeSessionsFeed, undefined);
  // no proxy key → unauthorized, nothing written
  const r = JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify({ action: 'createOneTimeSession', session: { id: U(1) } }) } }).getContent());
  assert.equal(r.error, 'unauthorized');
  assert.equal(sb.sheets.OneTimeSessions, undefined);
});

test('services: only active single-session catalog rows, server-priced, mapped to a clinical type', () => {
  const { get } = fixture();
  const s = get({ action: 'getOneTimeServices' });
  assert.equal(s.ok, true);
  assert.deepEqual(s.services.map((x) => [x.key, x.clinicalTreatmentType, x.amount]).sort(), [
    ['cbt_single', 'פרטני CBT', 500], ['emdr_single', 'פרטני EMDR', 850],
    ['psychiatric_consult', 'מעקב פסיכיאטרי', 900], ['psychiatric_diagnosis', 'אינטייק', 2500]
  ]);
});

test('create: server price snapshot, charge draft for the durable protocol, idempotent by id, validation fails closed', () => {
  const { sb, post, create } = fixture();
  const a = create(1, { amount: 1, price: 1, priceAgorot: 1 }); // a browser amount is ignored
  assert.equal(a.ok, true); assert.equal(a.created, true);
  assert.equal(a.session.amount, 850); assert.equal(a.session.status, 'scheduled'); assert.equal(a.session.createdBy, 'ורד');
  assert.equal(a.session.clinicalTreatmentType, 'פרטני EMDR'); assert.equal(a.session.patientName, CLIENT.name);
  assert.deepEqual(plain(a.charge), { id: 'ots-' + U(1), clientId: CLIENT.id, description: 'טיפול חד פעמי — פרטני EMDR · הילה תבור · 2026-11-11 10:00', amount: 850, billingType: 'one_time', chargeDate: '2026-11-11', billingDay: '', notes: 'oneTimeSession:' + U(1), treatmentType: 'פרטני EMDR', frequencyPerWeek: '' });
  const row = sb.rows('OneTimeSessions')[0];
  assert.equal(row.priceAgorot, 85000); assert.equal(row.chargeId, 'ots-' + U(1)); assert.equal(row.phone, '0501234567');
  // replay: same id + same payload → the stored row, nothing appended
  const b = create(1);
  assert.equal(b.duplicate, true); assert.equal(b.session.id, U(1)); assert.equal(sb.rows('OneTimeSessions').length, 1);
  // same id + a different payload → refused
  assert.equal(create(1, { time: '11:00' }).error, 'id_conflict');
  // validation
  assert.equal(create(2, { catalogKey: 'emdr_core' }).error, 'invalid_service', 'a 4-session pack is not a one-time session');
  assert.equal(create(2, { catalogKey: 'solo_housing' }).error, 'invalid_service');
  assert.equal(create(2, { catalogKey: 'Bad Key' }).error, 'invalid_service');
  assert.equal(create(2, { therapist: 'מטפל לא קיים' }).error, 'unknown_therapist');
  assert.equal(create(2, { date: '2026-02-30' }).error, 'bad_date');
  assert.equal(create(2, { date: '11/11/2026' }).error, 'bad_date');
  assert.equal(create(2, { time: '25:00' }).error, 'bad_time');
  assert.equal(create(2, { time: '' }).error, 'bad_time');
  assert.equal(create(2, { note: 'x'.repeat(301) }).error, 'note_too_long');
  assert.equal(create(2, { clientId: 'nope' }).error, 'client_not_found');
  assert.equal(post({ action: 'createOneTimeSession', session: { id: 'not-a-uuid' } }).error, 'bad_id');
  // conflicts on a scheduled session
  assert.equal(create(3).error, 'duplicate_session', 'same patient, same date + time');
  assert.equal(create(4, { clientId: OTHER.id }).error, 'therapist_busy', 'same therapist, same date + time');
  assert.equal(create(5, { clientId: OTHER.id, therapist: 'דנה כהן' }).ok, true);
  // formula injection is neutralized in free text
  assert.equal(create(6, { time: '12:00', note: '=HYPERLINK("x")' }).session.note.startsWith('='), false);
  // an operational session never creates (the proxy refuses too)
  assert.equal(post({ action: 'createOneTimeSession', session: { id: U(7), clientId: CLIENT.id, catalogKey: 'cbt_single', therapist: 'הילה תבור', date: '2026-11-12', time: '09:00' } }, 'דנה', 'ops').error, 'forbidden_money_action');
});

test('update + cancel: revision and op-id guards, conflicts, only a scheduled session', () => {
  const { post, create, sb } = fixture();
  create(1); create(2, { clientId: OTHER.id, therapist: 'דנה כהן', time: '12:00' });
  const up = (changes, rev, op) => post({ action: 'updateOneTimeSession', id: U(1), expectedRevision: rev, opId: U(op), changes });
  assert.equal(up({ time: '12:00', therapist: 'דנה כהן' }, 1, 100).error, 'therapist_busy');
  assert.equal(up({ time: '13:00' }, 9, 101).error, 'revision_conflict');
  const ok = up({ date: '2026-11-12', time: '13:00' }, 1, 102);
  assert.equal(ok.ok, true); assert.equal(ok.session.date, '2026-11-12'); assert.equal(ok.session.revision, 2);
  assert.equal(up({ date: '2026-11-12', time: '13:00' }, 1, 102).replayed, true, 'same op id → no second effect');
  assert.equal(up({}, 2, 103).error, 'no_changes');
  assert.equal(up({ time: '9:5' }, 2, 104).error, 'bad_time');
  const cancel = (reason, rev, op) => post({ action: 'cancelOneTimeSession', id: U(1), expectedRevision: rev, opId: U(op), reason });
  assert.equal(cancel('x', 2, 110).error, 'bad_reason');
  const c = cancel('המטופלת ביטלה', 2, 111);
  assert.equal(c.ok, true); assert.equal(c.session.status, 'cancelled'); assert.equal(c.session.statusReason, 'המטופלת ביטלה');
  assert.equal(up({ time: '14:00' }, 3, 112).error, 'not_scheduled');
  assert.equal(cancel('שוב', 3, 113).error, 'not_cancellable');
  // a cancelled slot is free again
  assert.equal(create(3, { date: '2026-11-12', time: '13:00' }).ok, true);
  assert.equal(JSON.parse(sb.rows('OneTimeSessions')[0].opLog).length, 3, 'create + update + cancel');
});

test('outcome by ורד: SessionLog ots:: row, therapist pay, price as value, outside the quota, no credit change', () => {
  const { sb, post, create, get } = fixture();
  // a regular package session that happened this month (the monthly quota is 4)
  sb.post({ action: 'correctSessionOutcome', sessionId: 'reg-1', phone: CLIENT.phone, therapist: 'הילה תבור', clinicalTreatmentType: 'פרטני כללי', date: '2026-11-03', outcome: 'happened' });
  const credits0 = sb.rows('Clients').find((c) => c.id === CLIENT.id).creditsOwed;
  create(1); create(2, { date: '2026-11-20' });
  const mark = (id, outcome, rev, op) => post({ action: 'markOneTimeSession', id, outcome, expectedRevision: rev, opId: U(op) });
  assert.equal(mark(U(2), 'happened', 1, 200).error, 'session_in_future');
  assert.equal(mark(U(1), 'whatever', 1, 201).error, 'unknown_outcome');
  assert.equal(mark(U(1), 'happened', 5, 202).error, 'revision_conflict');
  assert.equal(mark(U(1), 'happened', 1, 203).ok, true);
  const log = sb.rows('SessionLog').find((r) => r.sessionId === 'ots::' + U(1));
  assert.equal(log.oneTimeSessionId, U(1)); assert.equal(log.therapistPay, 300); assert.equal(log.clientSessionValue, 850);
  assert.equal(log.creditStatus, 'one_time'); assert.equal(log.clientId, CLIENT.id); assert.equal(log.billingType, 'פרטני EMDR');
  assert.equal(sb.rows('Clients').find((c) => c.id === CLIENT.id).creditsOwed, credits0, 'creditsOwed untouched');
  assert.equal(sb.ctx._happenedInMonth(sb.rows('SessionLog'), CLIENT.id, '2026-11', ''), 1, 'only the package session counts toward the quota');
  const s = get({ action: 'getOneTimeSessions' }).sessions.find((x) => x.id === U(1));
  assert.equal(s.status, 'completed'); assert.equal(s.sessionLogId, 'ots::' + U(1));
  // correction: no-show (pay stays — the therapist showed up), then therapist cancelled (pay 0, value 0)
  assert.equal(mark(U(1), 'patient_no_show', 2, 204).ok, true);
  assert.equal(mark(U(1), 'therapist_cancelled', 3, 205).ok, true);
  const rows = sb.rows('SessionLog').filter((r) => r.sessionId === 'ots::' + U(1));
  assert.equal(rows.length, 1, 'upserted, never duplicated');
  assert.equal(rows[0].therapistPay, 0); assert.equal(rows[0].clientSessionValue, 0); assert.equal(rows[0].outcome, 'therapist_cancelled');
  // the package path can never write an ots:: row
  assert.equal(sb.post({ action: 'correctSessionOutcome', sessionId: 'ots::' + U(1), phone: CLIENT.phone, therapist: 'הילה תבור', clinicalTreatmentType: 'פרטני כללי', date: '2026-11-03', outcome: 'happened' }).reason, 'reserved_session_id');
  // a cancelled session takes no outcome
  post({ action: 'cancelOneTimeSession', id: U(2), expectedRevision: 1, opId: U(206), reason: 'בוטל' });
  assert.equal(mark(U(2), 'therapist_cancelled', 2, 207).error, 'session_cancelled');
});

test('forwarded pay is frozen on a correction (same rule as the package path)', () => {
  const { sb, post, create } = fixture();
  create(1);
  post({ action: 'markOneTimeSession', id: U(1), outcome: 'happened', expectedRevision: 1, opId: U(300) });
  const sh = sb.sheets.SessionLog, H = sh.grid[0];
  sh.grid[1][H.indexOf('forwardedToPayroll')] = '2026-11';
  post({ action: 'markOneTimeSession', id: U(1), outcome: 'therapist_cancelled', expectedRevision: 2, opId: U(301) });
  const r = sb.rows('SessionLog')[0];
  assert.equal(r.therapistPay, 300, 'stored pay kept'); assert.equal(r.forwardedToPayroll, '2026-11');
});

test('therapists receiver: recordSessionOutcome + oneTimeSessionId, secret fail-closed, therapist must match', () => {
  const { sb, raw, create } = fixture();
  create(1);
  const send = (body) => raw(Object.assign({ action: 'recordSessionOutcome', oneTimeSessionId: U(1), therapist: 'הילה תבור', outcome: 'happened' }, body));
  assert.equal(send({ secret: 'wrong' }).error, 'unauthorized');
  assert.equal(send({ secret: OUTCOME_SECRET, therapist: 'דנה כהן' }).reason, 'therapist_mismatch');
  const ok = send({ secret: OUTCOME_SECRET, user: 'מישהו', amount: 1 });
  assert.equal(ok.ok, true); assert.equal(ok.status, 'completed'); assert.equal(ok.session, undefined, 'no price-bearing view crosses');
  assert.equal(JSON.stringify(ok).includes('850'), false);
  assert.equal(sb.rows('OneTimeSessions')[0].updatedBy, '', 'a cross-app caller never stamps a user');
  assert.equal(send({ secret: OUTCOME_SECRET }).ok, true, 'replay is idempotent');
  assert.equal(sb.rows('SessionLog').length, 1);
  delete sb.props.SESSION_OUTCOME_SECRET;
  assert.equal(send({ secret: OUTCOME_SECRET }).error, 'unauthorized', 'unset secret → fail closed');
});

test('feed: price-free allowlist, current client name/phone, fail-closed secret (unset or short)', () => {
  const { sb, create } = fixture();
  create(1, { catalogKey: 'psychiatric_diagnosis', therapist: 'ד"ר מיכאל שפרינץ' });
  const feed = (secret) => sb.get({ action: 'getOneTimeSessionsFeed', secret });
  assert.equal(feed('nope').error, 'unauthorized');
  const f = feed(FEED_SECRET);
  assert.equal(f.ok, true); assert.equal(f.sessions.length, 1);
  assert.deepEqual(Object.keys(f.sessions[0]).sort(), plain(sb.ctx.ONE_TIME_FEED_KEYS).sort());
  assert.equal(f.sessions[0].clinicalTreatmentType, 'אינטייק'); assert.equal(f.sessions[0].phone, '0501234567');
  const text = JSON.stringify(f);
  for (const k of ['amount', 'price', 'priceAgorot', 'chargeId', 'payloadHash', 'opLog', 'note', 'vat']) assert.equal(text.includes('"' + k + '"'), false, k + ' never crosses');
  assert.equal(text.includes('2500'), false);
  sb.props.ONE_TIME_SESSIONS_SECRET = 'short';
  assert.equal(feed('short').error, 'unauthorized', 'a short secret is refused');
  delete sb.props.ONE_TIME_SESSIONS_SECRET;
  assert.equal(feed(FEED_SECRET).error, 'unauthorized', 'unset → fail closed');
});

test('intake (אינטייק) pays the psychiatrist intake rate; a therapist without a rate fails closed and writes nothing', () => {
  const { sb, post, create } = fixture();
  create(1, { catalogKey: 'psychiatric_diagnosis', therapist: 'ד"ר מיכאל שפרינץ' });
  assert.equal(post({ action: 'markOneTimeSession', id: U(1), outcome: 'happened', expectedRevision: 1, opId: U(400) }).ok, true);
  assert.equal(sb.rows('SessionLog')[0].therapistPay, 900);
  // a roster name with a blank rate
  sb.sheets.TherapistRates.grid.push(['מטפל ללא תעריף', '', '', '']);
  create(2, { therapist: 'מטפל ללא תעריף', time: '15:00' });
  assert.equal(post({ action: 'markOneTimeSession', id: U(2), outcome: 'happened', expectedRevision: 1, opId: U(401) }).error, 'unknown_therapist');
  assert.equal(sb.rows('SessionLog').length, 1);
  assert.equal(sb.rows('OneTimeSessions')[1].status, 'scheduled');
});
