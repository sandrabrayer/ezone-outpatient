'use strict';
/**
 * «התקיים / לא התקיים» with the 24-hour rule — 2026-11-16 (CHANGELOG-session-notice-outcome.md).
 *
 *   happened                   took place   patient charged          therapist paid
 *   patient_cancelled_notice   no           NOT charged, +1 credit   not paid     (24h notice or more)
 *   patient_no_show            no           charged, no credit       paid         (no notice / < 24h)
 *   therapist_cancelled        no           NOT charged, +1 credit   not paid
 *
 * REAL Code.gs handlers in the sandbox (synthetic Sheets only — no network, no live patients),
 * plus the pure display modules (public/session-outcome.js, public/therapist-payout.js) and
 * the wiring that ships them (index.html, sw.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sandbox } = require('../test-support/apps-script-sandbox.js');
const SO = require('../public/session-outcome.js');
const Payout = require('../public/therapist-payout.js');

const PUB = path.join(__dirname, '..', 'public');
const SECRET = 'synthetic-notice-outcome-fixture-only';
const PROXY = 'synthetic-proxy-notice-fixture-only-0123456789012345';
const PHONE = '0501234567';
const RATE = 300;
const OUTCOMES = ['happened', 'patient_cancelled_notice', 'patient_no_show', 'therapist_cancelled'];
const NOTICE = 'patient_cancelled_notice';
const rev = (n) => '2026-11-10T10:' + String(n).padStart(2, '0') + ':00.000Z';

function fixture(clients) {
  const sb = sandbox([], clients || [{
    id: 'synthetic-client-a', name: 'Synthetic Patient', phone: PHONE, status: 'פעיל', serviceType: 'פרטני CBT',
    sessionsPerWeek: '{"פרטני CBT":1}', pricePerSession: 2000, billingType: 'monthly', billingDay: 5,
    startDate: '2026-10-01', creditsOwed: 0
  }]);
  sb.props.SESSION_OUTCOME_SECRET = SECRET;
  sb.props.OUTPATIENT_PROXY_SECRET = PROXY;
  sb.seed('TherapistRates', sb.ctx.THERAPIST_RATES_HEADERS, [{ name: 'Synthetic Therapist', flatRate: RATE }]);
  const event = {
    action: 'recordSessionOutcome', secret: SECRET, sessionId: 'synthetic-session-a', phone: PHONE,
    therapist: 'Synthetic Therapist', clinicalTreatmentType: 'פרטני CBT', date: '2026-11-10', outcome: 'happened'
  };
  const post = (body) => JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(body) } }).getContent());
  const send = (patch) => post(Object.assign({}, event, patch || {}));
  const manual = (patch) => {
    const p = Object.assign({}, event, { action: 'correctSessionOutcome', proxySecret: PROXY, user: 'synthetic-reviewer', moneyScope: 'full' }, patch || {});
    delete p.secret;
    return post(p);
  };
  const log = (id) => sb.rows('SessionLog').filter((r) => String(r.sessionId) === (id || event.sessionId));
  const credits = (i) => Number(sb.rows('Clients')[i || 0].creditsOwed || 0);
  const snapshot = () => JSON.stringify({ log: sb.rows('SessionLog'), clients: sb.rows('Clients') });
  return { sb, post, send, manual, log, credits, snapshot, event };
}

// ---------------------------------------------------------------------------------------------
// The receiver + credit engine
// ---------------------------------------------------------------------------------------------
test('the closed outcome set is exactly the four tokens, on both sides', () => {
  const { sb } = fixture();
  const gs = Object.keys(JSON.parse(JSON.stringify(sb.ctx.SESSION_STATUS_BY_OUTCOME))).sort();
  assert.deepEqual(gs, OUTCOMES.slice().sort());
  assert.deepEqual(SO.VALUES.slice().sort(), gs, 'public/session-outcome.js mirrors Code.gs');
  assert.deepEqual(Object.keys(SO.LABELS).sort(), gs);
  // one rule for "grants a credit": the server set and the display set agree
  for (const o of OUTCOMES) assert.equal(sb.ctx._outcomeGrantsCredit(o), SO.grantsCredit(o), o);
  assert.equal(sb.ctx._outcomeGrantsCredit('constructor'), false, 'prototype keys are not outcomes');
  assert.equal(sb.ctx._outcomeGrantsCredit(''), false);
  assert.equal(sb.ctx._outcomeGrantsCredit(null), false);
});

test('rules table: pay, session status and credit for each outcome (real receiver)', () => {
  const want = {
    happened: { pay: RATE, status: 'consumed', credit: 0, creditStatus: 'within_quota' },
    patient_cancelled_notice: { pay: 0, status: 'credited', credit: 1, creditStatus: 'credit_added' },
    patient_no_show: { pay: RATE, status: 'forfeited', credit: 0, creditStatus: '' },
    therapist_cancelled: { pay: 0, status: 'credited', credit: 1, creditStatus: 'credit_added' }
  };
  for (const o of OUTCOMES) {
    const f = fixture();
    const r = f.send({ outcome: o, reportRevision: rev(1) });
    assert.equal(r.ok, true, o + ': ' + JSON.stringify(r));
    const row = f.log()[0];
    assert.equal(Number(row.therapistPay), want[o].pay, o + ' pay');
    assert.equal(row.sessionStatus, want[o].status, o + ' status');
    assert.equal(String(row.creditStatus), want[o].creditStatus, o + ' creditStatus');
    assert.equal(f.credits(), want[o].credit, o + ' credit balance');
    assert.equal(row.outcome, o);
    assert.equal(row.matchStatus, 'matched');
  }
});

test('24h notice: no pay lookup — recorded even for a therapist with no rate row (like a therapist cancellation)', () => {
  const f = fixture();
  const r = f.send({ outcome: NOTICE, therapist: 'Synthetic Unknown Therapist' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(Number(f.log()[0].therapistPay), 0);
  assert.equal(f.credits(), 1);
  // …while a PAID outcome for the same unknown therapist still fails closed
  const g = fixture();
  assert.equal(g.send({ outcome: 'patient_no_show', therapist: 'Synthetic Unknown Therapist' }).reason, 'unknown_therapist');
  assert.equal(g.log().length, 0);
});

test('every correction between the four outcomes lands on the balance a first report would give', () => {
  const first = {};
  for (const o of OUTCOMES) { const f = fixture(); f.send({ outcome: o, reportRevision: rev(1) }); first[o] = { credits: f.credits(), pay: Number(f.log()[0].therapistPay), cs: String(f.log()[0].creditStatus) }; }
  for (const from of OUTCOMES) for (const to of OUTCOMES) {
    if (from === to) continue;
    const f = fixture();
    assert.equal(f.send({ outcome: from, reportRevision: rev(1) }).ok, true);
    assert.equal(f.send({ outcome: to, reportRevision: rev(2) }).ok, true, from + ' → ' + to);
    assert.equal(f.log().length, 1, 'one row per session');
    assert.equal(f.credits(), first[to].credits, from + ' → ' + to + ' credits');
    assert.equal(Number(f.log()[0].therapistPay), first[to].pay, from + ' → ' + to + ' pay');
    assert.equal(String(f.log()[0].creditStatus), first[to].cs, from + ' → ' + to + ' creditStatus');
  }
});

test('a re-sent notice report is idempotent: one row, one credit', () => {
  const f = fixture();
  assert.equal(f.send({ outcome: NOTICE, reportRevision: rev(1) }).ok, true);
  const before = f.snapshot();
  const again = f.send({ outcome: NOTICE, reportRevision: rev(1) });
  assert.equal(again.ok, true);
  assert.equal(again.replayed, true);
  assert.equal(f.snapshot(), before);
  assert.equal(f.credits(), 1);
  // an unversioned sender re-sending twice also nets one credit (reverse, then apply)
  const g = fixture();
  g.send({ outcome: NOTICE }); g.send({ outcome: NOTICE }); g.send({ outcome: NOTICE });
  assert.equal(g.credits(), 1);
  assert.equal(g.log().length, 1);
});

test('the notice credit is drawn by the next session beyond the monthly quota (free to the patient, therapist paid)', () => {
  const f = fixture();           // plan: 1 / week → quota 4 per month
  f.send({ sessionId: 'n1', date: '2026-11-03', outcome: NOTICE });
  assert.equal(f.credits(), 1);
  // the cancelled session does not use up the month's quota
  ['2026-11-04', '2026-11-10', '2026-11-17', '2026-11-24'].forEach((d, i) => {
    const r = f.send({ sessionId: 'h' + i, date: d, outcome: 'happened' });
    assert.equal(r.creditStatus, 'within_quota', d);
  });
  assert.equal(f.credits(), 1, 'still banked');
  const extra = f.send({ sessionId: 'h-extra', date: '2026-11-26', outcome: 'happened' });
  assert.equal(extra.creditStatus, 'covered');
  assert.equal(Number(extra.clientSessionValue), 0);
  assert.equal(Number(extra.therapistPay), RATE);
  assert.equal(f.credits(), 0);
});

test('a no-show never grants a credit — before or after a notice cancellation', () => {
  const f = fixture();
  f.send({ sessionId: 'a', date: '2026-11-03', outcome: 'patient_no_show' });
  assert.equal(f.credits(), 0);
  f.send({ sessionId: 'b', date: '2026-11-10', outcome: NOTICE });
  f.send({ sessionId: 'c', date: '2026-11-17', outcome: 'patient_no_show' });
  assert.equal(f.credits(), 1);
});

test('no single client (unknown phone / two clients on one phone): flagged, no balance touched', () => {
  const f = fixture();
  const r = f.send({ outcome: NOTICE, phone: '0509999999' });
  assert.equal(r.ok, true);
  assert.equal(r.creditStatus, 'no_client');
  assert.equal(f.log()[0].matchStatus, 'no_match');
  assert.equal(f.credits(), 0);

  const twin = (id) => ({ id, name: 'Synthetic ' + id, phone: PHONE, status: 'פעיל', serviceType: 'פרטני CBT', sessionsPerWeek: '{"פרטני CBT":1}', creditsOwed: 0 });
  const g = fixture([twin('synthetic-a'), twin('synthetic-b')]);
  const m = g.send({ outcome: NOTICE });
  assert.equal(m.creditStatus, 'no_client');
  assert.equal(g.log()[0].matchStatus, 'multi_match');
  assert.equal(g.credits(0), 0); assert.equal(g.credits(1), 0);
  assert.equal(SO.patientEffect(g.log()[0]).kind, 'review', 'the UI flags it for a person');
});

test('unknown outcomes still fail closed and write nothing', () => {
  const f = fixture();
  for (const bad of ['patient_cancelled', 'patient_cancelled_late', 'PATIENT_CANCELLED_NOTICE', 'cancelled', '', 'constructor', '__proto__']) {
    const before = f.snapshot();
    const r = f.send({ outcome: bad });
    assert.equal(r.ok, false, bad);
    assert.equal(r.reason, 'unknown_outcome', bad);
    assert.equal(f.snapshot(), before);
  }
});

test('the shared secret still gates first; a notice report without it changes nothing', () => {
  const f = fixture();
  const before = f.snapshot();
  const r = f.send({ outcome: NOTICE, secret: 'wrong' });
  assert.equal(r.ok, false); assert.equal(r.error, 'unauthorized');
  assert.equal(f.snapshot(), before);
  delete f.sb.props.SESSION_OUTCOME_SECRET;
  assert.equal(f.send({ outcome: NOTICE }).error, 'unauthorized', 'unconfigured secret = refused');
});

test('report order holds for the new outcome: a late older report cannot undo the credit', () => {
  const f = fixture();
  assert.equal(f.send({ outcome: NOTICE, reportRevision: rev(5) }).ok, true);
  const before = f.snapshot();
  assert.equal(f.send({ outcome: 'patient_no_show', reportRevision: rev(1) }).reason, 'stale_report_revision');
  assert.equal(f.send({ outcome: 'patient_no_show', reportRevision: rev(5) }).reason, 'source_outcome_conflict');
  assert.equal(f.snapshot(), before);
  assert.equal(f.credits(), 1);
});

test('a row already forwarded to payroll keeps its pay when corrected to a notice cancellation; the credit still applies', () => {
  const f = fixture();
  f.send({ outcome: 'happened', reportRevision: rev(1) });
  const H = f.sb.ctx.SESSION_LOG_HEADERS;
  f.sb.ctx._ensureSheet('SessionLog', H).getRange(2, H.indexOf('forwardedToPayroll') + 1).setValue('2026-11');
  assert.equal(f.send({ outcome: NOTICE, reportRevision: rev(2) }).ok, true);
  assert.equal(Number(f.log()[0].therapistPay), RATE, 'settled pay is frozen');
  assert.equal(f.log()[0].forwardedToPayroll, '2026-11');
  assert.equal(f.credits(), 1);
});

test('the internal correction form can record and undo a notice cancellation (proxy key required)', () => {
  const f = fixture();
  f.send({ outcome: 'patient_no_show', reportRevision: rev(1) });
  assert.equal(f.manual({ outcome: NOTICE }).ok, true);
  assert.equal(f.log()[0].outcome, NOTICE);
  assert.equal(Number(f.log()[0].therapistPay), 0);
  assert.equal(f.credits(), 1);
  assert.equal(f.manual({ outcome: 'patient_no_show' }).ok, true);
  assert.equal(f.credits(), 0);
  assert.equal(Number(f.log()[0].therapistPay), RATE);
  const before = f.snapshot();
  const noKey = f.send({ action: 'correctSessionOutcome', outcome: NOTICE });
  assert.equal(noKey.ok, false); assert.equal(noKey.error, 'unauthorized');
  assert.equal(f.snapshot(), before);
});

test('one-time sessions (outside the package) refuse the notice outcome — nothing is written', () => {
  const f = fixture();
  const before = f.snapshot();
  const r = f.send({ outcome: NOTICE, oneTimeSessionId: '00000000-0000-4000-8000-000000000009' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'one_time_outcome_rejected');
  assert.equal(f.snapshot(), before);
  const m = f.post({ action: 'markOneTimeSession', proxySecret: PROXY, user: 'synthetic-reviewer', moneyScope: 'full', id: '00000000-0000-4000-8000-000000000009', outcome: NOTICE, opId: '00000000-0000-4000-8000-00000000000a', expectedRevision: 1 });
  assert.equal(m.ok, false);
  assert.equal(f.snapshot(), before);
  assert.equal(Object.keys(JSON.parse(JSON.stringify(f.sb.ctx.ONE_TIME_OUTCOME_STATUS))).includes(NOTICE), false);
});

test('SessionLog headers are unchanged (append-only; this change adds no column)', () => {
  const { sb } = fixture();
  const H = JSON.parse(JSON.stringify(sb.ctx.SESSION_LOG_HEADERS));
  assert.equal(H[H.length - 1], 'reportRevision');
  assert.equal(H.indexOf('outcome'), 8);
  assert.equal(H.length, 19);
});

test('the monthly counters the therapists app shows: a notice cancellation is not a used session; the credit is a make-up', () => {
  const f = fixture();
  f.send({ sessionId: 'n1', date: '2026-11-03', outcome: NOTICE });
  const logRows = f.sb.rows('SessionLog');
  assert.equal(f.sb.ctx._happenedInMonth(logRows, 'synthetic-client-a', '2026-11'), 0);
  assert.equal(f.credits(), 1);
});

// ---------------------------------------------------------------------------------------------
// Display vocabulary (public/session-outcome.js)
// ---------------------------------------------------------------------------------------------
test('held / heldText: only «happened» took place; unknown tokens are never guessed', () => {
  assert.equal(SO.held('happened'), true);
  for (const o of [NOTICE, 'patient_no_show', 'therapist_cancelled']) { assert.equal(SO.held(o), false, o); assert.equal(SO.heldText(o), 'לא התקיים'); }
  assert.equal(SO.heldText('happened'), 'התקיים');
  for (const bad of ['', null, undefined, 'cancelled', 'constructor', 'toString']) { assert.equal(SO.held(bad), null); assert.equal(SO.labelFor(bad), ''); assert.equal(SO.heldText(bad), '—'); }
});

test('patientEffect words the stored row: charged / credit / credit used / review', () => {
  const e = (outcome, creditStatus, extra) => SO.patientEffect(Object.assign({ outcome, creditStatus }, extra || {}));
  assert.equal(e('happened', 'within_quota').kind, 'charged');
  assert.equal(e('happened', 'covered').kind, 'credit_used');
  assert.equal(e('happened', 'beyond_no_credit').kind, 'charged');
  assert.equal(e('happened', 'quota_unknown').kind, 'review');
  assert.equal(e('happened', 'no_client').kind, 'review');
  assert.equal(e('patient_no_show', '').kind, 'charged');
  assert.match(e('patient_no_show', '').text, /ללא קרדיט/);
  for (const o of [NOTICE, 'therapist_cancelled']) {
    assert.equal(e(o, 'credit_added').kind, 'credit', o);
    assert.match(e(o, 'credit_added').text, /נוצר קרדיט/);
    assert.equal(e(o, 'no_client').kind, 'review', o + ': an unapplied credit is never shown as granted');
    assert.equal(e(o, '').kind, 'review', o);
  }
  // one-time sessions: their own charge, never a credit
  assert.equal(e('happened', 'one_time', { oneTimeSessionId: 'x' }).kind, 'charged');
  assert.equal(e('patient_no_show', 'one_time', { oneTimeSessionId: 'x' }).kind, 'charged');
  assert.equal(e('therapist_cancelled', 'one_time', { oneTimeSessionId: 'x' }).kind, 'none');
  assert.equal(e('nope', '').kind, 'unknown');
});

test('therapistEffect: paid only for happened / no-show; a salaried therapist is never «paid per session»', () => {
  assert.equal(SO.therapistEffect({ outcome: 'happened' }).paid, true);
  assert.equal(SO.therapistEffect({ outcome: 'patient_no_show' }).paid, true);
  assert.equal(SO.therapistEffect({ outcome: NOTICE }).paid, false);
  assert.equal(SO.therapistEffect({ outcome: 'therapist_cancelled' }).paid, false);
  assert.equal(SO.therapistEffect({ outcome: 'happened', payModel: 'global' }).paid, false);
  for (const o of OUTCOMES) assert.equal(SO.paysTherapist(o), Object.prototype.hasOwnProperty.call(Payout.PAID_OUTCOMES, o), o + ': display and payout agree');
});

test('forClient: by the server-resolved clientId only, newest first; never by name', () => {
  const rows = [
    { sessionId: 'a', clientId: 'c1', patientName: 'דנה', date: '2026-11-03', outcome: 'happened', creditStatus: 'within_quota' },
    { sessionId: 'b', clientId: 'c1', patientName: 'דנה', date: '2026-11-10', outcome: NOTICE, creditStatus: 'credit_added' },
    { sessionId: 'c', clientId: '', patientName: 'דנה', date: '2026-11-12', outcome: NOTICE, creditStatus: 'no_client' },
    { sessionId: 'd', clientId: 'c2', patientName: 'דנה', date: '2026-11-11', outcome: 'patient_no_show', creditStatus: '' },
    null
  ];
  assert.deepEqual(SO.forClient(rows, 'c1').map((r) => r.sessionId), ['b', 'a']);
  assert.deepEqual(SO.forClient(rows, 'c1', 1).map((r) => r.sessionId), ['b']);
  assert.deepEqual(SO.forClient(rows, ''), []);
  assert.deepEqual(SO.forClient(null, 'c1'), []);
  assert.deepEqual(SO.summarize(SO.forClient(rows, 'c1')), { total: 2, held: 1, notHeld: 1, credits: 1, charged: 1, review: 0 });
});

// ---------------------------------------------------------------------------------------------
// Payout view
// ---------------------------------------------------------------------------------------------
test('payout summary: a notice cancellation pays nothing and is counted on its own', () => {
  const rows = [
    { sessionId: 'a', therapist: 'T', date: '2026-11-03', outcome: 'happened', therapistPay: 300, creditStatus: 'within_quota' },
    { sessionId: 'b', therapist: 'T', date: '2026-11-10', outcome: NOTICE, therapistPay: 0, creditStatus: 'credit_added' },
    { sessionId: 'c', therapist: 'T', date: '2026-11-17', outcome: 'patient_no_show', therapistPay: 300, creditStatus: '' },
    { sessionId: 'd', therapist: 'T', date: '2026-11-24', outcome: 'therapist_cancelled', therapistPay: 0, creditStatus: 'credit_added' },
    // even a corrupt non-zero pay on a non-paying row never reaches the total
    { sessionId: 'e', therapist: 'T', date: '2026-11-25', outcome: NOTICE, therapistPay: 999, creditStatus: 'credit_added' }
  ];
  const s = Payout.monthlyPayoutSummary(rows, '2026-11');
  const t = s.therapists[0];
  assert.equal(t.paidCount, 2);
  assert.equal(t.preVatTotal, 600);
  assert.equal(t.patientNoticeCount, 2);
  assert.equal(t.excludedCancelledCount, 1);
  assert.equal(t.sessionCount, 5);
  assert.equal(s.totals.patientNoticeCount, 2);
  assert.equal(s.totals.preVatTotal, 600);
  const b = t.sessions.find((x) => x.sessionId === 'b');
  assert.equal(b.paid, false); assert.equal(b.pay, 0); assert.equal(b.creditStatus, 'credit_added');
  assert.equal(t.sessions.find((x) => x.sessionId === 'e').pay, 0);
  const empty = Payout.monthlyPayoutSummary([], '2026-11');
  assert.equal(empty.totals.patientNoticeCount, 0);
  assert.equal(empty.differences.totals.patientNoticeCount, 0);
});

// ---------------------------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------------------------
test('wiring: the module is loaded before app.js; the correction form offers all four outcomes; SW bumped', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.ok(html.includes('<script src="session-outcome.js?v=__BUILD__" defer></script>'));
  assert.ok(html.indexOf('session-outcome.js') < html.indexOf('<script src="app.js'), 'loads before app.js');
  const form = html.slice(html.indexOf('id="sessionForm"'), html.indexOf('id="sessionForm"') + 2500);
  const opts = (form.match(/<option value="([a-z_]+)"/g) || []).map((s) => s.slice(15, -1));
  assert.deepEqual(opts.filter((o) => OUTCOMES.includes(o)).sort(), OUTCOMES.slice().sort());
  assert.ok(html.includes('id="clientSessionsModal"'));
  const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8');
  const v = Number((sw.match(/var CACHE = 'ezone-outpatient-v(\d+)';/) || [])[1]);
  assert.ok(v >= 40, 'SW cache >= v40 (got ' + v + ')');
  // no price / pay constant in the new public module (it must stay an ordinary static file)
  const src = fs.readFileSync(path.join(PUB, 'session-outcome.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');   // code only (comments carry dates)
  assert.doesNotMatch(src, /\b\d{3,}\b/, 'no amounts');
  assert.doesNotMatch(src, /innerHTML|document\.|window\./, 'pure: no DOM');
});

test('wiring: app.js escapes every session field it renders in the new views', () => {
  const app = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
  const start = app.indexOf('function renderClientSessions()');
  const end = app.indexOf('function closeClientSessionsModal()');
  assert.ok(start > 0 && end > start);
  const block = app.slice(start, end);
  for (const field of ['r.therapist', 'r.clinicalTreatmentType', 'th.text', 'state.sessionLogError']) {
    assert.ok(block.includes('escapeHtml(' + field), field + ' is escaped');
  }
  assert.ok(block.includes('isOpsScope()'), 'an operational (money-free) session cannot open the list');
  assert.ok(/SO\.forClient\(state\.sessionLog, c\.id\)/.test(block), 'filtered by clientId, never by name');
});
