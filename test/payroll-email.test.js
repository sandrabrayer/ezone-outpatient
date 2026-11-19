'use strict';

/**
 * Payroll report to מורן by email (2026-11-19, CHANGELOG-payroll-email.md).
 * REAL apps-script/Code.gs in the sandbox:
 *   A. parity — the emailed CSV is byte-identical to the outpatient «ייצוא לאקסל»
 *      (TherapistPayout.monthlyPayoutSummary + PayoutExport.buildPayoutCsv);
 *   B. auth — dedicated PAYROLL_SEND_SECRET, fail-closed, never the proxy key;
 *   C. send — recipient from the Script Property only, CSV attached with BOM, the
 *      reported rows stamped with their own month, counts-only reply, audit row;
 *   D. no double send, late rows go as הפרשים, a failed send stamps nothing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../test-support/apps-script-sandbox');
const TherapistPayout = require('../public/therapist-payout.js');
const PayoutExport = require('../public/payout-export.js');
const TherapistPay = require('../public/therapist-pay.js');

const SECRET = 'payroll-send-secret-with-at-least-32-characters!!';
const PROXY = 'fixture-proxy-secret-with-at-least-32-characters';
const plain = (x) => JSON.parse(JSON.stringify(x));
const thisMonth = () => new Date().toISOString().slice(0, 7);
const prevMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

function row(over) {
  return Object.assign({
    sessionId: 's' + Math.random().toString(36).slice(2), phone: '0501234567', patientName: 'מטופל בדיקה',
    clientId: 'c1', therapist: 'אלה שפירא', clinicalTreatmentType: 'פרטני', billingType: '', date: '2026-10-05',
    outcome: 'happened', therapistPay: 250, clientSessionValue: 0, sessionStatus: '', matchStatus: 'matched',
    recordedAt: '2026-10-06T08:00:00.000Z', creditStatus: '', forwardedToPayroll: '', payModel: '', oneTimeSessionId: ''
  }, over);
}

function harness(rows, props) {
  const h = sandbox();
  Object.assign(h.props, { OUTPATIENT_PROXY_SECRET: PROXY, PAYROLL_SEND_SECRET: SECRET, PAYROLL_REPORT_EMAIL: 'moran@example.co.il' }, props || {});
  h.seed('SessionLog', h.ctx.SESSION_LOG_HEADERS, rows);
  const mails = [];
  h.mailFails = false;
  h.ctx.MailApp = { sendEmail(msg) { if (h.mailFails) throw new Error('mail quota'); mails.push(msg); } };
  h.ctx.Utilities.newBlob = (data, type, name) => ({ data, type, name, getDataAsString: () => data, getName: () => name });
  h.mails = mails;
  h.send = (payload, params) => JSON.parse(h.ctx.doPost({
    parameter: params || {},
    postData: { contents: JSON.stringify(Object.assign({ action: 'sendPayrollReport', secret: SECRET, month: '2026-10', actorName: 'אורן' }, payload || {})) }
  }).getContent());
  return h;
}
const expectedCsv = (rows, month) => PayoutExport.buildPayoutCsv(TherapistPayout.monthlyPayoutSummary(rows, month));

/* ================================ A. parity ============================== */

test('A: the GS summary/CSV mirror is byte-identical to the outpatient export', () => {
  const fixtures = [
    [],
    [row({})],
    [
      row({ therapist: 'אלה שפירא', therapistPay: 250 }),
      row({ therapist: 'אלה שפירא', outcome: 'patient_no_show', therapistPay: 250 }),
      row({ therapist: 'אלה שפירא', outcome: 'therapist_cancelled', therapistPay: 0 }),
      row({ therapist: 'הילה תבור', outcome: 'patient_cancelled_notice', therapistPay: 0 }),
      row({ therapist: 'הילה תבור', therapistPay: 333.33, date: '2026-10-30' }),
      row({ therapist: 'ד"ר מיכאל שפרינץ', therapistPay: 700, payModel: 'global' }),
      row({ therapist: 'עידו, בוזגלו', therapistPay: 199.99 }),
      // a closed September (forwarded) + a late September row → הפרש
      row({ therapist: 'אלה שפירא', date: '2026-09-10', forwardedToPayroll: '2026-09' }),
      row({ therapist: 'אלה שפירא', date: '2026-09-20', therapistPay: 250 }),
      // an open September row for another therapist → its own cycle, not here
      row({ therapist: 'הילה תבור', date: '2026-09-15' }),
      // a future month → never here
      row({ therapist: 'הילה תבור', date: '2026-11-02' }),
      // garbage
      row({ date: '' }), row({ therapist: '', date: '2026-10-01' })
    ]
  ];
  const { ctx } = harness([]);
  for (const rows of fixtures) {
    for (const m of ['2026-09', '2026-10', '2026-11']) {
      const got = ctx._payrollCsv(ctx._payrollSummary(plain(rows), m));
      assert.equal(got, expectedCsv(rows, m), m + ' / ' + rows.length + ' rows');
    }
  }
});

test('A: VAT rate mirrors TherapistPay.DEFAULT_VAT_RATE', () => {
  const { ctx } = harness([]);
  assert.equal(ctx.PAYROLL_VAT_RATE, TherapistPay.DEFAULT_VAT_RATE);
  assert.deepEqual(plain(ctx.PAYROLL_HEADER), PayoutExport.HEADER);
  assert.deepEqual(plain(ctx.PAYROLL_DIFF_HEADER), PayoutExport.DIFF_HEADER);
});

/* ================================= B. auth =============================== */

test('B: fail-closed — unset, short, wrong or missing secret is refused; nothing is sent', () => {
  for (const [props, payload] of [
    [{ PAYROLL_SEND_SECRET: '' }, {}],
    [{ PAYROLL_SEND_SECRET: 'too-short-secret' }, { secret: 'too-short-secret' }],
    [{}, { secret: SECRET + 'x' }],
    [{}, { secret: '' }],
    [{}, { secret: undefined }]
  ]) {
    const h = harness([row({})], props);
    assert.deepEqual(h.send(payload), { ok: false, error: 'unauthorized' });
    assert.equal(h.mails.length, 0);
    assert.equal(h.rows('SessionLog')[0].forwardedToPayroll, '');
  }
});

test('B: the browser proxy key can never send the email', () => {
  const h = harness([row({})]);
  const r = h.post({ action: 'sendPayrollReport', month: '2026-10', actorName: 'אורן' }); // proxySecret only
  assert.deepEqual(r, { ok: false, error: 'unauthorized' });
  assert.equal(h.mails.length, 0);
  assert.equal(h.ctx.SOURCE_POST_AUTH.sendPayrollReport, 'PAYROLL_SEND_SECRET');
});

test('B: recipient comes only from PAYROLL_REPORT_EMAIL; unset or malformed → not_configured', () => {
  for (const bad of ['', 'not-an-email', 'a@b.c, evil@x.com', 'a@b.c\nBcc: x@y.z']) {
    const h = harness([row({})], { PAYROLL_REPORT_EMAIL: bad });
    assert.deepEqual(h.send({ to: 'attacker@evil.com' }), { ok: false, reason: 'not_configured' });
    assert.equal(h.mails.length, 0);
  }
  const h = harness([row({})]);
  h.send({ to: 'attacker@evil.com', email: 'attacker@evil.com' });
  assert.equal(h.mails[0].to, 'moran@example.co.il', 'a caller-supplied address is ignored');
});

test('B: month and actor are validated', () => {
  const h = harness([row({})]);
  for (const m of ['2026-13', '2026-1', '26-10', '2025-12', '', null, '2026-10-01', '9999-01']) {
    assert.deepEqual(h.send({ month: m }), { ok: false, reason: 'invalid_month' }, String(m));
  }
  assert.deepEqual(h.send({ actorName: '  ' }), { ok: false, reason: 'missing_actor' });
  assert.equal(h.mails.length, 0);
});

/* ================================= C. send =============================== */

test('C: sends the report to מורן with the CSV attached and stamps exactly the reported rows', () => {
  const rows = [
    row({ sessionId: 'a', therapist: 'אלה שפירא', therapistPay: 250 }),
    row({ sessionId: 'b', therapist: 'הילה תבור', therapistPay: 300, outcome: 'therapist_cancelled' }),
    row({ sessionId: 'g', therapist: 'ד"ר מיכאל שפרינץ', payModel: 'global', therapistPay: 0 }),
    row({ sessionId: 'n', therapist: 'הילה תבור', date: '2026-11-02' }),
    row({ sessionId: 's', therapist: 'אלה שפירא', date: '2026-09-02' })
  ];
  const h = harness(rows);
  const r = h.send({});
  assert.deepEqual(r, { ok: true, sent: true, month: '2026-10', therapists: 2, paidSessions: 1, sessions: 2, differenceSessions: 0 });
  // the reply goes to the coordinator: no amount, no patient, no address
  const txt = JSON.stringify(r);
  assert.doesNotMatch(txt, /250|300|Total|preVat|vat|מטופל|@/i);

  assert.equal(h.mails.length, 1);
  const m = h.mails[0];
  assert.equal(m.to, 'moran@example.co.il');
  assert.equal(m.subject, 'תשלומי מטפלים — 2026-10');
  assert.match(m.body, /נשלח על ידי אורן/);
  assert.doesNotMatch(m.body, /מטופל בדיקה|0501234567/, 'no patient data in the mail body');
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].name, 'therapist-payouts-2026-10.csv');
  assert.equal(m.attachments[0].type, 'text/csv');
  assert.equal(m.attachments[0].data, '﻿' + expectedCsv(rows, '2026-10'));
  assert.doesNotMatch(m.attachments[0].data, /מטופל בדיקה|0501234567/, 'the CSV carries no patient data');

  const after = Object.fromEntries(h.rows('SessionLog').map((x) => [x.sessionId, x.forwardedToPayroll]));
  assert.deepEqual(after, { a: '2026-10', b: '2026-10', g: '', n: '', s: '' });

  const audit = h.rows('AuditLog');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'payroll_sent');
  assert.equal(audit[0].name, 'אורן');
  assert.doesNotMatch(audit[0].details, /moran|250/);
});

test('C: newline / tab in the actor name never reaches the mail body as a new line', () => {
  const h = harness([row({})]);
  h.send({ actorName: 'אורן\nBcc: x@y.z' });
  assert.match(h.mails[0].body, /נשלח על ידי אורן Bcc: x@y\.z מאפליקציית/);
});

/* ============================ D. lifecycle =============================== */

test('D: a second press sends nothing; a late row of the sent month goes next time as a הפרש', () => {
  const h = harness([row({ sessionId: 'a' }), row({ sessionId: 'b', therapist: 'הילה תבור' })]);
  assert.equal(h.send({}).sent, true);
  assert.deepEqual(h.send({}), { ok: true, sent: false, reason: 'nothing_to_send', month: '2026-10' });
  assert.equal(h.mails.length, 1, 'never emailed twice');

  // a late October session arrives for אלה after October was sent
  const log = h.rows('SessionLog').concat([row({ sessionId: 'late', date: '2026-10-28', therapistPay: 250 })]);
  h.seed('SessionLog', h.ctx.SESSION_LOG_HEADERS, log);
  const r = h.send({ month: '2026-11' });
  assert.equal(r.sent, true);
  assert.equal(r.sessions, 0);
  assert.equal(r.differenceSessions, 1);
  assert.match(h.mails[1].attachments[0].data, /הפרשים/);
  assert.equal(h.rows('SessionLog').find((x) => x.sessionId === 'late').forwardedToPayroll, '2026-10', 'stamped with its own month');
});

test('D: a failed send stamps nothing and reports an error', () => {
  const h = harness([row({ sessionId: 'a' })]);
  h.mailFails = true;
  const r = h.send({});
  assert.equal(r.ok, false);
  assert.equal(h.rows('SessionLog')[0].forwardedToPayroll, '');
  assert.equal(h.rows('AuditLog').length, 0);
  h.mailFails = false;
  assert.equal(h.send({}).sent, true, 'the retry works');
});

test('D: the current month can be sent; a future month cannot', () => {
  const h = harness([row({ date: thisMonth() + '-01' })]);
  assert.equal(h.send({ month: thisMonth() }).sent, true);
  const next = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 7); })();
  assert.deepEqual(h.send({ month: next }), { ok: false, reason: 'invalid_month' });
  assert.ok(prevMonth() < thisMonth());
});
