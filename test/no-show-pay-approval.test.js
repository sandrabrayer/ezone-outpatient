'use strict';

/**
 * Coverage for the patient-no-show PAY APPROVAL GATE.
 *
 * A patient_no_show used to pay the therapist AUTOMATICALLY the moment the
 * therapists app reported it (_computeSessionPay). It is now a decision a
 * PERSON makes: the row is written with therapistPay 0 and payStatus
 * 'pending_decision' and stays that way until ורד (or סנדרה as backup)
 * approves or declines. NOTHING auto-resolves — no timeout pays, none declines.
 *
 * This file locks the money-critical contracts. Three layers:
 *
 *   1. The WRITE + the DECISION (`_recordSessionOutcome`, `_decideSessionPay`,
 *      `_markForwarded` in apps-script/Code.gs). Code.gs cannot be require()d in
 *      Node, so they are mirrored below as pure functions over an in-memory
 *      rows array, with SOURCE-SCAN GUARDS that parse the real
 *      SESSION_LOG_HEADERS / PAY_APPROVERS / pay-status constants out of Code.gs
 *      and assert they match — the same discipline as session-outcome.test.js,
 *      so the mirror cannot silently drift.
 *
 *   2. The VIEW (`public/therapist-payout.js`, imported directly): a pending row
 *      is shown with pay 0 and excluded from every total; the rule keys off
 *      payStatus, not the outcome alone.
 *
 *   3. The approver allow-list + the security posture.
 *
 * Run with:  npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Payout = require('../public/therapist-payout');
const TP = require('../public/therapist-pay');
const { PAY_APPROVERS } = require('../lib/approvers');
const { SESSION_USERS } = require('../lib/users');

const ROOT = path.join(__dirname, '..');
const GS = fs.readFileSync(path.join(ROOT, 'apps-script', 'Code.gs'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// --- parse literals out of Code.gs (never re-typed) --------------------------
function gsHeaders(name) {
  const m = GS.match(new RegExp('var ' + name + ' = \\[([\\s\\S]*?)\\];'));
  assert.ok(m, name + ' not found in Code.gs');
  return m[1]
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
    .match(/'[^']*'/g).map((s) => s.slice(1, -1));
}
function gsString(name) {
  const m = GS.match(new RegExp("var " + name + " *= *'([^']*)';"));
  assert.ok(m, name + ' not found in Code.gs');
  return m[1];
}
/** A top-level function's source, to its closing brace at column 0. */
function gsFunction(name) {
  const start = GS.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' not found in Code.gs');
  const end = GS.indexOf('\n}\n', start);
  assert.ok(end > start, name + ' has no closing brace at column 0');
  return GS.slice(start, end + 3);
}

const H = gsHeaders('SESSION_LOG_HEADERS');
const GS_APPROVERS = gsHeaders('PAY_APPROVERS');
const PENDING = gsString('PAY_STATUS_PENDING');
const APPROVED = gsString('PAY_STATUS_APPROVED');
const DECLINED = gsString('PAY_STATUS_DECLINED');

const GROUP_BILLING = 'קבוצה';
const RATE = TP.therapistPay('מעיין דלומי');   // 250, the canonical flat rate

// ============================================================================
// 1. Source-scan guards
// ============================================================================

test('Code.gs defines the gate, the decision write and the queue read', () => {
  assert.ok(/function _payGateApplies\(/.test(GS), '_payGateApplies missing');
  assert.ok(/function _decideSessionPay\(/.test(GS), '_decideSessionPay missing');
  assert.ok(/function _getPendingSessionPay\(/.test(GS), '_getPendingSessionPay missing');
  assert.ok(/function _isPayApprover\(/.test(GS), '_isPayApprover missing');
  assert.ok(/if \(action === 'decideSessionPay'\)/.test(GS), 'decideSessionPay not dispatched');
  assert.ok(/if \(action === 'getPendingSessionPay'\)/.test(GS), 'getPendingSessionPay not dispatched');
});

test('the pay-decision columns are APPENDED — no existing column moved', () => {
  assert.deepEqual(H.slice(0, 16), [
    'sessionId', 'phone', 'patientName', 'clientId',
    'therapist', 'clinicalTreatmentType', 'billingType', 'date',
    'outcome', 'therapistPay', 'clientSessionValue', 'sessionStatus',
    'matchStatus', 'recordedAt', 'creditStatus', 'forwardedToPayroll'
  ], 'an existing SessionLog column moved, was renamed or was removed');
  assert.deepEqual(H.slice(16), [
    'payStatus', 'decision', 'approvedBy', 'declineReason', 'decidedAt'
  ]);
  assert.equal(H.length, 21);
});

test('the pay-status constants are the exact strings the view keys off', () => {
  assert.equal(PENDING, 'pending_decision');
  assert.equal(APPROVED, 'approved');
  assert.equal(DECLINED, 'declined');
  // The module and Code.gs must agree, or a pending row would be summed.
  assert.equal(Payout.PAY_STATUS_PENDING, PENDING);
  assert.equal(Payout.PAY_STATUS_APPROVED, APPROVED);
  assert.equal(Payout.PAY_STATUS_DECLINED, DECLINED);
});

test('the Code.gs PAY_APPROVERS mirror equals lib/approvers.js', () => {
  assert.deepEqual(GS_APPROVERS, PAY_APPROVERS);
  assert.deepEqual(PAY_APPROVERS, ['ורד', 'סנדרה']);
});

test('every approver can actually log in (a name-only approver could never stamp)', () => {
  PAY_APPROVERS.forEach((name) => {
    assert.ok(SESSION_USERS.includes(name),
      name + ' is a pay approver but not a SESSION_USER — the cookie name could never match');
  });
});

test('the approver list is NOT the login list — it is deliberately narrower', () => {
  assert.ok(PAY_APPROVERS.length < SESSION_USERS.length,
    'every login name being an approver would make the allow-list pointless');
  ['שירן', 'יעל', 'ירדן'].forEach((name) => {
    assert.ok(!PAY_APPROVERS.includes(name), name + ' must not be able to decide pay');
  });
});

// ============================================================================
// 2. Mirrors of the Code.gs write paths
// ============================================================================

function payGateApplies(outcome, billingType) {
  return outcome === 'patient_no_show' && billingType !== GROUP_BILLING;
}
function isPayApprover(name) {
  const n = String(name == null ? '' : name).trim();
  if (!n) return false;                       // fail-closed
  return PAY_APPROVERS.indexOf(n) !== -1;
}
function toNumberOrZero(v) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(v);
  return isFinite(n) ? n : 0;
}
/** The rate a session pays when it DOES pay. Mirror of _computeSessionPay. */
function computeSessionPay(outcome, therapist, clinical, billingType) {
  if (outcome === 'therapist_cancelled') return 0;
  if (billingType === GROUP_BILLING) return 0;
  return TP.therapistPay(therapist, clinical);
}

/**
 * Mirror of _recordSessionOutcome's PAY half (the credit engine and client
 * matching are covered by session-credits.test.js and session-outcome.test.js;
 * this file is about pay). Upserts by sessionId over an in-memory array.
 */
function recordOutcome(payload, rows) {
  rows = rows || [];
  const sessionId = String(payload.sessionId);
  const outcome = String(payload.outcome);
  const billingType = String(payload.billingType || 'פרטני');
  const therapist = String(payload.therapist || 'מעיין דלומי');
  const clinical = String(payload.clinicalTreatmentType || 'פרטני CBT');

  const payGated = payGateApplies(outcome, billingType);
  const rateIfPaid = computeSessionPay(outcome, therapist, clinical, billingType);

  const row = {
    sessionId, outcome, therapist, clinicalTreatmentType: clinical, billingType,
    date: String(payload.date || '2026-09-10'),
    patientName: String(payload.patientName || 'דנה'),
    therapistPay: payGated ? 0 : rateIfPaid,
    recordedAt: String(payload.recordedAt || '2026-09-10T08:00:00.000Z'),
    forwardedToPayroll: '',
    payStatus: payGated ? PENDING : '',
    decision: '', approvedBy: '', declineReason: '', decidedAt: ''
  };

  const idx = rows.findIndex((r) => String(r.sessionId) === sessionId);
  const oldRow = idx === -1 ? null : rows[idx];

  const wasForwarded = !!(oldRow && String(oldRow.forwardedToPayroll || '').trim() !== '');
  if (wasForwarded) row.forwardedToPayroll = String(oldRow.forwardedToPayroll).trim();

  if (wasForwarded) {
    // FROZEN: payroll already has this money.
    row.therapistPay  = toNumberOrZero(oldRow.therapistPay);
    row.payStatus     = String(oldRow.payStatus || '');
    row.decision      = String(oldRow.decision || '');
    row.approvedBy    = String(oldRow.approvedBy || '');
    row.declineReason = String(oldRow.declineReason || '');
    row.decidedAt     = String(oldRow.decidedAt || '');
  } else if (payGated && oldRow && String(oldRow.outcome) === 'patient_no_show') {
    const carried = String(oldRow.payStatus || '');
    if (carried === APPROVED || carried === DECLINED) {
      row.payStatus     = carried;
      row.decision      = String(oldRow.decision || '');
      row.approvedBy    = String(oldRow.approvedBy || '');
      row.declineReason = String(oldRow.declineReason || '');
      row.decidedAt     = String(oldRow.decidedAt || '');
      row.therapistPay  = (carried === APPROVED) ? rateIfPaid : 0;
    }
  }

  const next = rows.slice();
  if (idx === -1) next.push(row); else next[idx] = row;
  return { res: { ok: true, sessionId, therapistPay: row.therapistPay, payStatus: row.payStatus }, rows: next };
}

/** Mirror of _decideSessionPay. `user` is the SIGNED-COOKIE name. */
function decideSessionPay(payload, user, rows, nowIso) {
  rows = rows || [];
  const sessionId = String((payload && payload.sessionId) || '').trim();
  if (!sessionId) return { res: { ok: false, reason: 'missing_session_id' }, rows };

  const decision = String((payload && payload.decision) || '').trim();
  if (decision !== 'approve' && decision !== 'decline') {
    return { res: { ok: false, reason: 'invalid_decision' }, rows };
  }
  const approver = String(user == null ? '' : user)
    .replace(/[<> -]/g, '').trim().slice(0, 40);
  if (!isPayApprover(approver)) return { res: { ok: false, reason: 'not_authorized' }, rows };

  const declineReason = String((payload && payload.declineReason) || '')
    .replace(/[<> -]/g, '').trim().slice(0, 300);
  if (decision === 'decline' && !declineReason) {
    return { res: { ok: false, reason: 'decline_reason_required' }, rows };
  }

  const idx = rows.findIndex((r) => String(r.sessionId) === sessionId);
  if (idx === -1) return { res: { ok: false, reason: 'not_found' }, rows };
  const row = Object.assign({}, rows[idx]);

  if (String(row.forwardedToPayroll || '').trim() !== '') {
    return { res: { ok: false, reason: 'already_forwarded' }, rows };
  }
  if (String(row.payStatus || '') !== PENDING) {
    return { res: { ok: false, reason: 'not_pending', payStatus: String(row.payStatus || '') }, rows };
  }

  const pay = decision === 'approve'
    ? computeSessionPay(String(row.outcome), String(row.therapist),
        String(row.clinicalTreatmentType), String(row.billingType))
    : 0;

  row.therapistPay  = pay;
  row.payStatus     = decision === 'approve' ? APPROVED : DECLINED;
  row.decision      = decision;
  row.approvedBy    = approver;
  row.declineReason = decision === 'decline' ? declineReason : '';
  row.decidedAt     = nowIso || '2026-09-11T09:00:00.000Z';

  const next = rows.slice();
  next[idx] = row;
  return { res: { ok: true, sessionId, payStatus: row.payStatus, therapistPay: pay, approvedBy: approver }, rows: next };
}

/** Mirror of _markForwarded, including the pending skip. */
function markForwarded(therapist, month, rows) {
  let forwarded = 0, skippedPending = 0;
  const next = rows.map((r) => Object.assign({}, r));
  next.forEach((row) => {
    if (String(row.therapist || '').trim() !== therapist) return;
    if (String(row.date || '').slice(0, 7) !== month) return;
    if (String(row.forwardedToPayroll || '').trim() !== '') return;
    if (String(row.payStatus || '') === PENDING) { skippedPending++; return; }
    row.forwardedToPayroll = month;
    forwarded++;
  });
  return { res: { ok: true, therapist, month, forwarded, skippedPending }, rows: next };
}

const noShow = (id, over) => Object.assign({ sessionId: id, outcome: 'patient_no_show' }, over || {});

// ============================================================================
// 3. The write: a no-show no longer pays automatically
// ============================================================================

test('patient_no_show writes pending_decision with pay 0, NOT the rate', () => {
  const { res, rows } = recordOutcome(noShow('s1'), []);
  assert.equal(res.therapistPay, 0, 'the therapist must not be paid automatically');
  assert.equal(res.payStatus, PENDING);
  assert.equal(rows[0].therapistPay, 0);
  assert.equal(rows[0].payStatus, PENDING);
  assert.equal(rows[0].decision, '');
  assert.equal(rows[0].approvedBy, '');
  assert.equal(rows[0].decidedAt, '');
  // The rate it WOULD pay is unchanged — the gate withholds it, it does not
  // change what a no-show is worth.
  assert.equal(RATE, 250);
});

test('the rest of the no-show row is untouched by the gate', () => {
  const { rows } = recordOutcome(noShow('s1', { date: '2026-09-04' }), []);
  assert.equal(rows[0].outcome, 'patient_no_show');
  assert.equal(rows[0].date, '2026-09-04');
  assert.equal(rows[0].patientName, 'דנה');
  assert.equal(rows[0].forwardedToPayroll, '');
});

test('a GROUP no-show is NOT gated — its pay is a decided 0 either way', () => {
  const { res, rows } = recordOutcome(
    noShow('g1', { billingType: GROUP_BILLING, clinicalTreatmentType: 'קבוצה' }), []);
  assert.equal(res.therapistPay, 0);
  assert.equal(res.payStatus, '', 'gating a group no-show would queue an approval of ₪0');
  assert.equal(rows[0].payStatus, '');
});

test('happened is untouched end to end — pays immediately, no decision', () => {
  const { res, rows } = recordOutcome({ sessionId: 'h1', outcome: 'happened' }, []);
  assert.equal(res.therapistPay, RATE);
  assert.equal(res.payStatus, '');
  assert.equal(rows[0].decision, '');
  assert.equal(rows[0].approvedBy, '');
  assert.equal(rows[0].declineReason, '');
});

test('therapist_cancelled is untouched end to end — pays 0, no decision', () => {
  const { res, rows } = recordOutcome({ sessionId: 'c1', outcome: 'therapist_cancelled' }, []);
  assert.equal(res.therapistPay, 0);
  assert.equal(res.payStatus, '');
  assert.equal(rows[0].decision, '');
});

// ============================================================================
// 4. The decision
// ============================================================================

test('approve pays EXACTLY the rate the ungated compute would have given', () => {
  let { rows } = recordOutcome(noShow('s1'), []);
  const wouldHavePaid = computeSessionPay('patient_no_show', 'מעיין דלומי', 'פרטני CBT', 'פרטני');
  const out = decideSessionPay({ sessionId: 's1', decision: 'approve' }, 'ורד', rows);
  assert.equal(out.res.ok, true);
  assert.equal(out.res.therapistPay, wouldHavePaid);
  assert.equal(out.res.therapistPay, RATE);
  assert.equal(out.rows[0].payStatus, APPROVED);
  assert.equal(out.rows[0].decision, 'approve');
  assert.equal(out.rows[0].approvedBy, 'ורד');
  assert.equal(out.rows[0].declineReason, '');
  assert.ok(out.rows[0].decidedAt, 'the decision must be timestamped');
});

test('decline keeps pay at 0 and records the reason and who decided', () => {
  let { rows } = recordOutcome(noShow('s1'), []);
  const out = decideSessionPay(
    { sessionId: 's1', decision: 'decline', declineReason: 'המטפל לא המתין' }, 'ורד', rows);
  assert.equal(out.res.ok, true);
  assert.equal(out.rows[0].therapistPay, 0);
  assert.equal(out.rows[0].payStatus, DECLINED);
  assert.equal(out.rows[0].decision, 'decline');
  assert.equal(out.rows[0].declineReason, 'המטפל לא המתין');
  assert.equal(out.rows[0].approvedBy, 'ורד');
});

test('a decline with NO reason is refused and writes nothing', () => {
  let { rows } = recordOutcome(noShow('s1'), []);
  const before = JSON.stringify(rows);
  [undefined, '', '   ', '<>'].forEach((reason) => {
    const out = decideSessionPay({ sessionId: 's1', decision: 'decline', declineReason: reason }, 'ורד', rows);
    assert.equal(out.res.ok, false);
    assert.equal(out.res.reason, 'decline_reason_required');
    assert.equal(JSON.stringify(out.rows), before, 'a refused decline must change nothing');
  });
});

test('סנדרה can decide as the backup approver', () => {
  let { rows } = recordOutcome(noShow('s1'), []);
  const out = decideSessionPay({ sessionId: 's1', decision: 'approve' }, 'סנדרה', rows);
  assert.equal(out.res.ok, true);
  assert.equal(out.rows[0].approvedBy, 'סנדרה');
});

test('a non-approver — or a blank cookie name — cannot decide', () => {
  let { rows } = recordOutcome(noShow('s1'), []);
  const before = JSON.stringify(rows);
  ['שירן', 'יעל', 'ירדן', '', '   ', null, undefined, 'Vered', 'ורד '.replace(' ', 'x')].forEach((who) => {
    const out = decideSessionPay({ sessionId: 's1', decision: 'approve' }, who, rows);
    assert.equal(out.res.ok, false, String(who) + ' must not be able to decide pay');
    assert.equal(out.res.reason, 'not_authorized');
    assert.equal(JSON.stringify(out.rows), before);
  });
});

test('a decision verb that is neither approve nor decline is refused', () => {
  let { rows } = recordOutcome(noShow('s1'), []);
  ['', 'yes', 'APPROVE', 'pay', 'pending'].forEach((d) => {
    const out = decideSessionPay({ sessionId: 's1', decision: d }, 'ורד', rows);
    assert.equal(out.res.ok, false);
    assert.equal(out.res.reason, 'invalid_decision');
  });
});

test('only a PENDING row can be decided — no re-deciding, no deciding a happened row', () => {
  let { rows } = recordOutcome(noShow('s1'), []);
  rows = decideSessionPay({ sessionId: 's1', decision: 'approve' }, 'ורד', rows).rows;
  // A second decision (double-click, or a change of mind) is refused.
  const again = decideSessionPay({ sessionId: 's1', decision: 'decline', declineReason: 'x' }, 'ורד', rows);
  assert.equal(again.res.ok, false);
  assert.equal(again.res.reason, 'not_pending');
  assert.equal(again.rows[0].therapistPay, RATE, 'the approved pay must survive the refused re-decision');

  // A happened row was never gated and cannot be decided either.
  let h = recordOutcome({ sessionId: 'h1', outcome: 'happened' }, []).rows;
  const onHappened = decideSessionPay({ sessionId: 'h1', decision: 'decline', declineReason: 'x' }, 'ורד', h);
  assert.equal(onHappened.res.ok, false);
  assert.equal(onHappened.res.reason, 'not_pending');
  assert.equal(onHappened.rows[0].therapistPay, RATE);
});

test('an unknown sessionId is refused', () => {
  const out = decideSessionPay({ sessionId: 'nope', decision: 'approve' }, 'ורד', []);
  assert.equal(out.res.ok, false);
  assert.equal(out.res.reason, 'not_found');
});

test('NOTHING auto-resolves: a pending row is still pending however much time passes', () => {
  // The only transition out of pending is decideSessionPay. There is no clock
  // input anywhere in the write path, so "age" cannot change a row — asserted
  // on the real source, not just the mirror.
  const src = gsFunction('_recordSessionOutcome') + gsFunction('_getPendingSessionPay');
  assert.ok(!/timeout|expire|auto.?approve|auto.?decline|daysSince|olderThan/i.test(src),
    'no time-based resolution may exist in the pay path');
  // And a re-send of the same unchanged event leaves it pending, not paid.
  let { rows } = recordOutcome(noShow('s1'), []);
  for (let i = 0; i < 5; i++) rows = recordOutcome(noShow('s1'), rows).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payStatus, PENDING);
  assert.equal(rows[0].therapistPay, 0);
});

test('the decline reason is sanitized and length-capped before it reaches a cell', () => {
  let { rows } = recordOutcome(noShow('s1'), []);
  const out = decideSessionPay(
    { sessionId: 's1', decision: 'decline', declineReason: '  <b>ר</b>' + 'א'.repeat(400) + '  ' },
    'ורד', rows);
  assert.ok(!/[<>]/.test(out.rows[0].declineReason));
  assert.equal(out.rows[0].declineReason.length, 300);
});

// ============================================================================
// 5. Re-marking
// ============================================================================

test('re-mark pending -> happened pays normally and VOIDS the decision', () => {
  let { rows } = recordOutcome(noShow('s1'), []);
  assert.equal(rows[0].payStatus, PENDING);
  const out = recordOutcome({ sessionId: 's1', outcome: 'happened' }, rows);
  assert.equal(out.res.therapistPay, RATE);
  assert.equal(out.rows[0].payStatus, '');
  assert.equal(out.rows[0].decision, '');
  assert.equal(out.rows[0].approvedBy, '');
  assert.equal(out.rows[0].declineReason, '');
  assert.equal(out.rows[0].decidedAt, '');
  assert.equal(out.rows.length, 1, 'still one row — the upsert must not duplicate');
});

test('re-mark pending -> therapist_cancelled pays 0 and voids the decision', () => {
  let { rows } = recordOutcome(noShow('s1'), []);
  const out = recordOutcome({ sessionId: 's1', outcome: 'therapist_cancelled' }, rows);
  assert.equal(out.res.therapistPay, 0);
  assert.equal(out.rows[0].payStatus, '');
  assert.equal(out.rows[0].outcome, 'therapist_cancelled');
});

test('re-mark APPROVED -> happened voids the decision (and still pays the rate)', () => {
  let { rows } = recordOutcome(noShow('s1'), []);
  rows = decideSessionPay({ sessionId: 's1', decision: 'approve' }, 'ורד', rows).rows;
  assert.equal(rows[0].approvedBy, 'ורד');
  const out = recordOutcome({ sessionId: 's1', outcome: 'happened' }, rows);
  assert.equal(out.rows[0].therapistPay, RATE);
  assert.equal(out.rows[0].payStatus, '');
  assert.equal(out.rows[0].approvedBy, '', 'a decision about a no-show is void once it was not a no-show');
  assert.equal(out.rows[0].decision, '');
});

test('re-mark DECLINED -> happened voids the decline and pays normally', () => {
  let { rows } = recordOutcome(noShow('s1'), []);
  rows = decideSessionPay({ sessionId: 's1', decision: 'decline', declineReason: 'לא ממתין' }, 'ורד', rows).rows;
  assert.equal(rows[0].therapistPay, 0);
  const out = recordOutcome({ sessionId: 's1', outcome: 'happened' }, rows);
  assert.equal(out.rows[0].therapistPay, RATE, 'a decline about a no-show must not suppress a happened session');
  assert.equal(out.rows[0].payStatus, '');
  assert.equal(out.rows[0].declineReason, '');
});

test('re-mark that stays a no-show CARRIES the decision — it is not re-asked', () => {
  let { rows } = recordOutcome(noShow('s1'), []);
  rows = decideSessionPay({ sessionId: 's1', decision: 'approve' }, 'ורד', rows).rows;
  // The therapists app re-sends the same event (a correction to another field).
  const out = recordOutcome(noShow('s1', { patientName: 'דנה כהן' }), rows);
  assert.equal(out.rows[0].payStatus, APPROVED);
  assert.equal(out.rows[0].approvedBy, 'ורד');
  assert.equal(out.rows[0].therapistPay, RATE, 'an approved no-show keeps paying across a re-send');
  assert.equal(out.rows[0].patientName, 'דנה כהן', 'the rest of the row still updates');
});

test('a declined no-show stays at 0 across a re-send', () => {
  let { rows } = recordOutcome(noShow('s1'), []);
  rows = decideSessionPay({ sessionId: 's1', decision: 'decline', declineReason: 'סיבה' }, 'ורד', rows).rows;
  const out = recordOutcome(noShow('s1'), rows);
  assert.equal(out.rows[0].payStatus, DECLINED);
  assert.equal(out.rows[0].therapistPay, 0);
  assert.equal(out.rows[0].declineReason, 'סיבה');
});

test('re-mark happened -> no-show OPENS a fresh pending decision', () => {
  let { rows } = recordOutcome({ sessionId: 's1', outcome: 'happened' }, []);
  assert.equal(rows[0].therapistPay, RATE);
  const out = recordOutcome(noShow('s1'), rows);
  assert.equal(out.rows[0].therapistPay, 0, 'the automatic pay must be withdrawn pending a decision');
  assert.equal(out.rows[0].payStatus, PENDING);
});

// ============================================================================
// 6. Forwarded rows are frozen
// ============================================================================

test('an already-forwarded row is unaffected by a re-mark — its pay is frozen', () => {
  let { rows } = recordOutcome({ sessionId: 's1', outcome: 'happened', date: '2026-09-10' }, []);
  rows = markForwarded('מעיין דלומי', '2026-09', rows).rows;
  assert.equal(rows[0].forwardedToPayroll, '2026-09');
  assert.equal(rows[0].therapistPay, RATE);

  // A correction arrives after payroll already paid the month.
  const out = recordOutcome(noShow('s1', { date: '2026-09-10' }), rows);
  assert.equal(out.rows[0].therapistPay, RATE, 'payroll already paid this — it must not be rewritten');
  assert.equal(out.rows[0].payStatus, '', 'a forwarded row is not re-queued for a decision');
  assert.equal(out.rows[0].forwardedToPayroll, '2026-09', 'the stamp must survive');
  assert.equal(out.rows[0].outcome, 'patient_no_show', 'the non-money fields still correct');
});

test('an approved-then-forwarded row keeps its pay and its approver', () => {
  let { rows } = recordOutcome(noShow('s1', { date: '2026-09-10' }), []);
  rows = decideSessionPay({ sessionId: 's1', decision: 'approve' }, 'ורד', rows).rows;
  rows = markForwarded('מעיין דלומי', '2026-09', rows).rows;
  const out = recordOutcome({ sessionId: 's1', outcome: 'therapist_cancelled', date: '2026-09-10' }, rows);
  assert.equal(out.rows[0].therapistPay, RATE);
  assert.equal(out.rows[0].payStatus, APPROVED);
  assert.equal(out.rows[0].approvedBy, 'ורד');
});

test('a forwarded row cannot be decided at all', () => {
  let { rows } = recordOutcome(noShow('s1', { date: '2026-09-10' }), []);
  // Force the (impossible-by-design) case: a pending row that somehow carries a
  // stamp. The decision must still refuse rather than rewrite settled money.
  rows[0].forwardedToPayroll = '2026-09';
  const out = decideSessionPay({ sessionId: 's1', decision: 'approve' }, 'ורד', rows);
  assert.equal(out.res.ok, false);
  assert.equal(out.res.reason, 'already_forwarded');
  assert.equal(out.rows[0].therapistPay, 0);
});

// ============================================================================
// 7. A pending row can never reach payroll
// ============================================================================

test('markForwarded SKIPS pending rows and reports how many it held back', () => {
  let rows = [];
  rows = recordOutcome({ sessionId: 'h1', outcome: 'happened', date: '2026-09-01' }, rows).rows;
  rows = recordOutcome(noShow('p1', { date: '2026-09-02' }), rows).rows;
  rows = recordOutcome(noShow('p2', { date: '2026-09-03' }), rows).rows;

  const out = markForwarded('מעיין דלומי', '2026-09', rows);
  assert.equal(out.res.forwarded, 1, 'only the decided row goes to payroll');
  assert.equal(out.res.skippedPending, 2);
  assert.equal(out.rows.find((r) => r.sessionId === 'h1').forwardedToPayroll, '2026-09');
  assert.equal(out.rows.find((r) => r.sessionId === 'p1').forwardedToPayroll, '');
  assert.equal(out.rows.find((r) => r.sessionId === 'p2').forwardedToPayroll, '');
});

test('once decided, a previously-skipped row forwards normally (as a הפרש)', () => {
  let rows = recordOutcome(noShow('p1', { date: '2026-09-02' }), []).rows;
  rows = markForwarded('מעיין דלומי', '2026-09', rows).rows;
  assert.equal(rows[0].forwardedToPayroll, '', 'still held back');
  rows = decideSessionPay({ sessionId: 'p1', decision: 'approve' }, 'ורד', rows).rows;
  const out = markForwarded('מעיין דלומי', '2026-09', rows);
  assert.equal(out.res.forwarded, 1);
  assert.equal(out.rows[0].forwardedToPayroll, '2026-09');
  assert.equal(out.rows[0].therapistPay, RATE);
});

test('a DECLINED row forwards normally — it is decided, just worth 0', () => {
  let rows = recordOutcome(noShow('p1', { date: '2026-09-02' }), []).rows;
  rows = decideSessionPay({ sessionId: 'p1', decision: 'decline', declineReason: 'סיבה' }, 'ורד', rows).rows;
  const out = markForwarded('מעיין דלומי', '2026-09', rows);
  assert.equal(out.res.forwarded, 1);
  assert.equal(out.res.skippedPending, 0);
  assert.equal(out.rows[0].therapistPay, 0);
});

// ============================================================================
// 8. The payout view (the real module)
// ============================================================================

const viewRow = (over) => Object.assign({
  sessionId: 'x', therapist: 'רמי', date: '2026-09-10',
  clinicalTreatmentType: 'פרטני CBT', outcome: 'patient_no_show',
  therapistPay: 0, payStatus: PENDING, forwardedToPayroll: '',
  recordedAt: '2026-09-10T08:00:00.000Z'
}, over || {});

test('a pending row is EXCLUDED from the payout totals', () => {
  const s = Payout.monthlyPayoutSummary([
    viewRow({ sessionId: 'a', outcome: 'happened', therapistPay: 250, payStatus: '' }),
    viewRow({ sessionId: 'b' })                       // pending
  ], '2026-09');
  const t = s.therapists[0];
  assert.equal(t.paidCount, 1, 'the pending row must not count as paid');
  assert.equal(t.preVatTotal, 250, 'the pending row must not add money');
  assert.equal(s.totals.preVatTotal, 250);
  assert.equal(t.pendingCount, 1);
  assert.equal(s.totals.pendingCount, 1);
});

test('a pending row is SHOWN with pay 0 — visible, not hidden', () => {
  const s = Payout.monthlyPayoutSummary([viewRow({ sessionId: 'b' })], '2026-09');
  const t = s.therapists[0];
  assert.equal(t.sessionCount, 1, 'the session must still appear');
  const row = t.sessions[0];
  assert.equal(row.pay, 0);
  assert.equal(row.paid, false);
  assert.equal(row.pending, true);
  assert.equal(row.payStatus, PENDING);
  // And the view says what approving it would cost, as exposure only.
  assert.equal(row.rateIfApproved, TP.therapistPay('רמי'));
  assert.equal(t.pendingRate, TP.therapistPay('רמי'));
  assert.equal(t.preVatTotal, 0, 'exposure must never be folded into the total');
});

test('an APPROVED no-show pays exactly as a no-show used to', () => {
  const s = Payout.monthlyPayoutSummary([
    viewRow({ sessionId: 'c', therapistPay: 250, payStatus: APPROVED })
  ], '2026-09');
  const t = s.therapists[0];
  assert.equal(t.paidCount, 1);
  assert.equal(t.preVatTotal, 250);
  assert.equal(t.sessions[0].paid, true);
  assert.equal(t.sessions[0].pay, 250);
});

test('a DECLINED no-show is shown, flagged, and worth 0', () => {
  const s = Payout.monthlyPayoutSummary([
    viewRow({ sessionId: 'd', payStatus: DECLINED, declineReason: 'סיבה' })
  ], '2026-09');
  const t = s.therapists[0];
  assert.equal(t.paidCount, 0);
  assert.equal(t.preVatTotal, 0);
  assert.equal(t.declinedCount, 1);
  assert.equal(t.pendingCount, 0, 'a declined row is decided, not pending');
  assert.equal(t.sessions[0].declined, true);
  assert.equal(t.sessions[0].declineReason, 'סיבה');
});

test('the pay rule keys off payStatus, not the outcome alone', () => {
  // The same outcome, three statuses, three answers.
  assert.equal(Payout.paysFor({ outcome: 'patient_no_show', payStatus: APPROVED }), true);
  assert.equal(Payout.paysFor({ outcome: 'patient_no_show', payStatus: PENDING }), false);
  assert.equal(Payout.paysFor({ outcome: 'patient_no_show', payStatus: DECLINED }), false);
  // And the gate never touches the other two outcomes.
  assert.equal(Payout.paysFor({ outcome: 'happened', payStatus: PENDING }), true,
    'the gate must not leak onto happened');
  assert.equal(Payout.paysFor({ outcome: 'therapist_cancelled', payStatus: APPROVED }), false);
});

test('HISTORY IS NOT REWRITTEN: a pre-gate no-show row (blank payStatus) still pays', () => {
  // Every no-show logged before this feature carries payStatus '' and its real
  // rate. Requiring an explicit 'approved' would silently drop all of them out
  // of the payout totals — a retroactive, unannounced pay change.
  const s = Payout.monthlyPayoutSummary([
    { sessionId: 'legacy', therapist: 'רמי', date: '2026-09-10',
      outcome: 'patient_no_show', therapistPay: 250 }          // no payStatus key at all
  ], '2026-09');
  const t = s.therapists[0];
  assert.equal(t.paidCount, 1);
  assert.equal(t.preVatTotal, 250);
  assert.equal(t.pendingCount, 0);
  assert.equal(t.sessions[0].paid, true);
});

test('happened and therapist_cancelled sum exactly as before the gate', () => {
  const s = Payout.monthlyPayoutSummary([
    viewRow({ sessionId: 'a', outcome: 'happened', therapistPay: 250, payStatus: '' }),
    viewRow({ sessionId: 'b', outcome: 'happened', therapistPay: 250, payStatus: '' }),
    viewRow({ sessionId: 'c', outcome: 'therapist_cancelled', therapistPay: 0, payStatus: '' })
  ], '2026-09');
  const t = s.therapists[0];
  assert.equal(t.paidCount, 2);
  assert.equal(t.preVatTotal, 500);
  assert.equal(t.excludedCancelledCount, 1);
  assert.equal(t.pendingCount, 0);
});

test('the CSV export excludes pending money and notes the backlog', () => {
  const PE = require('../public/payout-export');
  const summary = Payout.monthlyPayoutSummary([
    viewRow({ sessionId: 'a', outcome: 'happened', therapistPay: 250, payStatus: '' }),
    viewRow({ sessionId: 'b' })
  ], '2026-09');
  const rows = PE.buildPayoutRows(summary);
  const totalRow = rows.find((r) => r[0] === 'סה״כ');
  assert.equal(totalRow[1], 1, 'the pending session must not be counted');
  assert.equal(totalRow[2], 250, 'the pending session must not add money');
  const noteRow = rows.find((r) => String(r[0]).indexOf('ממתינים להחלטת תשלום') === 0);
  assert.ok(noteRow, 'payroll must be told a decision is outstanding');
  assert.equal(noteRow[1], 1);
});

// ============================================================================
// 9. Security posture + UI wiring
// ============================================================================

test('server.js gains no route — the decision rides the session-gated proxy', () => {
  assert.ok(!/decideSessionPay|payStatus|PAY_APPROVERS/.test(SERVER),
    'server.js must stay unchanged by the gate');
  assert.ok(/app\.post\('\/api\/sheets', requireSession/.test(SERVER));
  assert.ok(/body\.user = sessionUserFromRequest\(req\)/.test(SERVER));
});

test('the approver is taken from the signed cookie, never from the payload', () => {
  const fn = gsFunction('_decideSessionPay');
  assert.ok(/_requestUser\(payload\)/.test(fn), 'the approver must come from _requestUser');
  assert.ok(/_isPayApprover\(approver\)/.test(fn), 'the approver must be allow-listed');
  // No path may read a caller-supplied approver name.
  assert.ok(!/payload\.approvedBy|payload\.user\b/.test(fn),
    'a payload-supplied approver name must never be read');
  // And the client must not try to send one.
  assert.ok(!/approvedBy:/.test(APP.slice(APP.indexOf('async function apiDecideSessionPay'),
    APP.indexOf('async function apiDecideSessionPay') + 900)),
    'the browser must not nominate an approver');
});

test('the queue and its persistent count badge are wired into the page', () => {
  assert.ok(/id="payDecisionAlerts"/.test(HTML), 'the dashboard queue panel is missing');
  assert.ok(/id="payTabBadge"/.test(HTML), 'the persistent count badge is missing');
  // The badge lives ON the payouts tab button, so it shows from every view.
  assert.ok(/data-view="payouts">תשלומי מטפלים<span id="payTabBadge"/.test(HTML));
  assert.ok(/id="declinePayModal"/.test(HTML), 'the decline-reason modal is missing');
  assert.ok(/renderPayDecisions\(\);/.test(APP), 'the queue is not rendered on the dashboard');
  // The count is refreshed on EVERY render pass, not only on the dashboard.
  assert.ok(/function render\(\) \{\s*(?:\/\/[^\n]*\n\s*)*renderPayTabBadge\(\);/.test(APP),
    'renderPayTabBadge must run at the top of render(), from every view');
});

test('the decline path requires a reason on the client too', () => {
  assert.ok(/required/.test(HTML.slice(HTML.indexOf('id="declinePayForm"'),
    HTML.indexOf('id="declinePayForm"') + 500)), 'the reason input must be required');
  assert.ok(/דחייה מחייבת סיבה/.test(APP), 'the client must refuse a reason-less decline');
});
