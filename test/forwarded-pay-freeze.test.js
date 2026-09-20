'use strict';

/**
 * Forwarded-row therapist-pay freeze — apps-script/Code.gs `_recordSessionOutcome`.
 *
 * Run with:  npm test     (Node >= 18, built-in runner)
 *
 * THE BUG THIS LOCKS
 * ------------------
 * A SessionLog row carries `forwardedToPayroll` once its month has been sent to
 * חשבת שכר. Before this guard, only the STAMP survived an upsert: `therapistPay`
 * was recomputed unconditionally from the new outcome, so re-marking an
 * already-forwarded session silently rewrote the pay on a row payroll had
 * already paid out. Nobody saw it — the payout view excludes forwarded rows, so
 * the rewritten figure never appears in a total again and the sheet quietly
 * stops agreeing with the money that actually left.
 *
 * The guard carries the STORED amount across the upsert instead, for EVERY
 * outcome. The frozen figure is the record of what payroll received; a genuine
 * correction belongs in the next cycle as a הפרש.
 *
 * Code.gs cannot be require()d in Node, so the upsert below is a mirror with the
 * sheet I/O replaced by an in-memory rows array — the same technique as
 * session-outcome.test.js / session-credits.test.js. Source-scan guards assert
 * the real Code.gs actually contains the guard, so the mirror cannot drift into
 * testing a fiction.
 *
 * Contracts locked:
 *   - forwarded + re-marked -> therapistPay is the STORED value, every outcome
 *   - the biggest loss case: forwarded `happened` -> `therapist_cancelled` no
 *     longer zeroes a row payroll already paid
 *   - a frozen 0 stays 0 (the freeze is not "keep the larger number")
 *   - a TherapistRates change cannot rewrite a forwarded row
 *   - NOT-forwarded rows still recompute exactly as before (no leak)
 *   - the forwardedToPayroll stamp itself is still preserved (pre-existing)
 *   - the returned result reports the frozen pay, not the recomputed one
 *   - credit effects are NOT frozen — creditsOwed is a separate, open ledger
 *   - validation still runs BEFORE the freeze (unknown therapist still rejects)
 *   - a blank / non-numeric stored pay coerces to 0, never NaN into the sheet
 *   - PAID_OUTCOMES stays the plain outcome-based map (no pay-status coupling)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Payout = require('../public/therapist-payout');

const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

// ============================================================================
// Source-scan guards — the guard exists in the REAL Code.gs, not just here.
// ============================================================================

test('Code.gs defines _toNumberOrZero (the frozen-amount coercion)', () => {
  assert.ok(/function _toNumberOrZero\(/.test(GS), '_toNumberOrZero missing from Code.gs');
});

test('_recordSessionOutcome computes wasForwarded once and freezes therapistPay on it', () => {
  const body = GS.slice(GS.indexOf('function _recordSessionOutcome('));
  assert.ok(
    /var wasForwarded = !!\(oldRow && String\(oldRow\.forwardedToPayroll \|\| ''\)\.trim\(\) !== ''\)/.test(body),
    'wasForwarded is not derived from the existing row\'s forwardedToPayroll'
  );
  assert.ok(
    /if \(wasForwarded\) \{\s*rowObj\.therapistPay = _toNumberOrZero\(oldRow\.therapistPay\);/.test(body),
    'the freeze does not carry oldRow.therapistPay'
  );
});

test('the freeze is unconditional on outcome (no outcome check guards it)', () => {
  // The whole point: an already-forwarded `happened` row is frozen too. If the
  // freeze ever grows an outcome condition, this test is the thing that objects.
  const body = GS.slice(GS.indexOf('function _recordSessionOutcome('));
  const m = body.match(/if \(wasForwarded\) \{\s*rowObj\.therapistPay = _toNumberOrZero\(oldRow\.therapistPay\);\s*\}/);
  assert.ok(m, 'the freeze block is not the expected unconditional shape');
});

test('the result reports rowObj.therapistPay, so a caller sees the frozen figure', () => {
  const body = GS.slice(GS.indexOf('function _recordSessionOutcome('));
  assert.ok(/therapistPay: rowObj\.therapistPay,/.test(body),
    'the result still returns the recomputed local instead of the row value');
});

test('the forwardedToPayroll stamp is still preserved across the upsert', () => {
  const body = GS.slice(GS.indexOf('function _recordSessionOutcome('));
  assert.ok(/rowObj\.forwardedToPayroll = String\(oldRow\.forwardedToPayroll\)\.trim\(\);/.test(body),
    'the pre-existing stamp preservation was lost');
});

test('PAID_OUTCOMES is untouched — outcome-based, no pay-status coupling', () => {
  assert.deepEqual(Payout.PAID_OUTCOMES, { happened: true, patient_no_show: true });
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'therapist-payout.js'), 'utf8');
  assert.ok(/var PAID_OUTCOMES = \{ happened: true, patient_no_show: true \};/.test(src));
  assert.ok(!/payStatus/.test(src), 'therapist-payout.js must not know about a pay status');
});

// ============================================================================
// Mirrors of the Code.gs logic under test.
// ============================================================================

function toNumberOrZero(v) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function toCredits(v) {
  const n = parseInt(v, 10);
  return (isNaN(n) || n < 0) ? 0 : n;
}

const SESSION_STATUS_BY_OUTCOME = {
  happened: 'consumed', therapist_cancelled: 'credited', patient_no_show: 'forfeited'
};

// A deliberately tiny rate table so a "rate changed since forwarding" case is
// expressible. The real rates are guarded in session-outcome.test.js.
function makeRates(rate) {
  return { 'מעיין דלומי': rate };
}

/**
 * Mirror of _recordSessionOutcome's pay path + upsert. Sheet I/O is an array.
 * `rates` is injected so a rate change between forwarding and re-mark is testable.
 */
function recordSessionOutcome(payload, rows, opts) {
  rows = rows || [];
  opts = opts || {};
  const rates = opts.rates || makeRates(250);
  const clients = opts.clients || [];

  const sessionId = String((payload && payload.sessionId) || '').trim();
  if (!sessionId) return { res: { ok: false, reason: 'missing_session_id' }, rows };

  const outcome = String((payload && payload.outcome) || '').trim();
  if (!Object.prototype.hasOwnProperty.call(SESSION_STATUS_BY_OUTCOME, outcome)) {
    return { res: { ok: false, reason: 'unknown_outcome' }, rows };
  }

  const therapist = String((payload && payload.therapist) || '').trim();
  const billingType = String((payload && payload.billingType) || 'פרטני').trim();

  // --- compute, and reject an unknown therapist. This runs BEFORE the freeze,
  //     on purpose: a bad payload must fail loudly even for a forwarded row.
  let pay;
  if (outcome === 'therapist_cancelled') pay = 0;
  else if (billingType === 'קבוצה') pay = 0;
  else if (Object.prototype.hasOwnProperty.call(rates, therapist)) pay = rates[therapist];
  else return { res: { ok: false, reason: 'unknown_therapist' }, rows };

  const rowObj = {
    sessionId,
    therapist,
    billingType,
    date: String((payload && payload.date) || '').trim(),
    outcome,
    therapistPay: pay,
    sessionStatus: SESSION_STATUS_BY_OUTCOME[outcome],
    creditStatus: '',
    forwardedToPayroll: ''
  };

  const idx = rows.findIndex((r) => String(r.sessionId) === sessionId);
  const oldRow = idx === -1 ? null : rows[idx];

  const wasForwarded = !!(oldRow && String(oldRow.forwardedToPayroll || '').trim() !== '');
  if (wasForwarded) {
    rowObj.forwardedToPayroll = String(oldRow.forwardedToPayroll).trim();
  }

  // ---- FORWARDED ROWS ARE PAY-FROZEN -------------------------------------
  if (wasForwarded) {
    rowObj.therapistPay = toNumberOrZero(oldRow.therapistPay);
  }

  // ---- credit engine (NOT frozen) -----------------------------------------
  const client = clients.length === 1 ? clients[0] : null;
  if (client) {
    const orig = toCredits(client.creditsOwed);
    let balance = orig;
    if (oldRow) {
      if (oldRow.outcome === 'therapist_cancelled') balance -= 1;
      if (String(oldRow.creditStatus) === 'covered') balance += 1;
    }
    if (balance < 0) balance = 0;
    if (outcome === 'therapist_cancelled') {
      balance += 1;
      rowObj.creditStatus = 'credit_added';
    }
    client.creditsOwed = balance;
    rowObj.creditsOwed = balance;
  }

  let upserted = false;
  if (idx !== -1) { rows[idx] = rowObj; upserted = true; } else rows.push(rowObj);

  const res = {
    ok: true,
    sessionId,
    therapistPay: rowObj.therapistPay,
    sessionStatus: rowObj.sessionStatus,
    creditStatus: rowObj.creditStatus
  };
  if (rowObj.creditsOwed !== undefined) res.creditsOwed = rowObj.creditsOwed;
  if (upserted) res.upserted = true; else res.appended = true;
  return { res, rows };
}

function forwardedRow(over) {
  return Object.assign({
    sessionId: 's1',
    therapist: 'מעיין דלומי',
    billingType: 'פרטני',
    date: '2026-06-10',
    outcome: 'happened',
    therapistPay: 250,
    sessionStatus: 'consumed',
    creditStatus: '',
    forwardedToPayroll: '2026-06'
  }, over || {});
}

function remark(rows, over, opts) {
  return recordSessionOutcome(Object.assign({
    sessionId: 's1', therapist: 'מעיין דלומי', billingType: 'פרטני',
    date: '2026-06-10', outcome: 'happened'
  }, over || {}), rows, opts);
}

// ============================================================================
// The freeze — every outcome.
// ============================================================================

test('forwarded + re-marked to therapist_cancelled keeps the paid amount (was silently zeroed)', () => {
  // The loss case. Before the guard this wrote 250 -> 0 on a row payroll had
  // already paid 250 for, and the payout view never showed it again.
  const { res, rows } = remark([forwardedRow()], { outcome: 'therapist_cancelled' });
  assert.equal(rows[0].therapistPay, 250);
  assert.equal(res.therapistPay, 250);
  assert.equal(rows[0].outcome, 'therapist_cancelled', 'the outcome itself still corrects');
  assert.equal(rows[0].sessionStatus, 'credited', 'the status still corrects');
});

test('forwarded + re-marked to patient_no_show keeps the paid amount', () => {
  const { rows } = remark([forwardedRow()], { outcome: 'patient_no_show' });
  assert.equal(rows[0].therapistPay, 250);
  assert.equal(rows[0].outcome, 'patient_no_show');
});

test('forwarded + re-marked to happened keeps the paid amount (freeze is not no-show-only)', () => {
  const { rows } = remark(
    [forwardedRow({ outcome: 'therapist_cancelled', therapistPay: 0, sessionStatus: 'credited' })],
    { outcome: 'happened' }
  );
  assert.equal(rows[0].therapistPay, 0, 'a frozen 0 stays 0 — the freeze is not "keep the larger number"');
  assert.equal(rows[0].outcome, 'happened');
});

test('forwarded + idempotent re-send of the SAME outcome changes no pay', () => {
  const { rows } = remark([forwardedRow()], { outcome: 'happened' });
  assert.equal(rows[0].therapistPay, 250);
});

test('a TherapistRates change cannot rewrite a forwarded row', () => {
  // Rate went 250 -> 300 after the month was forwarded. The row still records
  // the 250 that was actually paid.
  const { rows } = remark([forwardedRow()], { outcome: 'happened' }, { rates: makeRates(300) });
  assert.equal(rows[0].therapistPay, 250);
});

test('the freeze survives a chain of re-marks', () => {
  let rows = [forwardedRow()];
  rows = remark(rows, { outcome: 'patient_no_show' }).rows;
  rows = remark(rows, { outcome: 'therapist_cancelled' }).rows;
  rows = remark(rows, { outcome: 'happened' }).rows;
  assert.equal(rows[0].therapistPay, 250, 'the originally-paid amount is still the record');
});

// ============================================================================
// No leak — un-forwarded rows behave exactly as before.
// ============================================================================

test('NOT forwarded: happened -> therapist_cancelled still recomputes pay to 0', () => {
  const { res, rows } = remark(
    [forwardedRow({ forwardedToPayroll: '' })],
    { outcome: 'therapist_cancelled' }
  );
  assert.equal(rows[0].therapistPay, 0);
  assert.equal(res.therapistPay, 0);
});

test('NOT forwarded: a rate change IS picked up on a re-mark', () => {
  const { rows } = remark(
    [forwardedRow({ forwardedToPayroll: '' })],
    { outcome: 'happened' },
    { rates: makeRates(300) }
  );
  assert.equal(rows[0].therapistPay, 300);
});

test('a brand-new row is never frozen (no old row to freeze from)', () => {
  const { res, rows } = remark([], { outcome: 'happened' });
  assert.equal(res.appended, true);
  assert.equal(rows[0].therapistPay, 250);
  assert.equal(rows[0].forwardedToPayroll, '');
});

test('a whitespace-only forwardedToPayroll is NOT forwarded', () => {
  // The stamp test is .trim() !== '' — a stray space must not freeze a live row.
  const { rows } = remark(
    [forwardedRow({ forwardedToPayroll: '   ' })],
    { outcome: 'therapist_cancelled' }
  );
  assert.equal(rows[0].therapistPay, 0, 'a blank stamp must not freeze pay');
  assert.equal(rows[0].forwardedToPayroll, '');
});

test('the freeze does not touch another session\'s row', () => {
  const rows = [forwardedRow(), forwardedRow({ sessionId: 's2', forwardedToPayroll: '' })];
  remark(rows, { outcome: 'therapist_cancelled' });
  assert.equal(rows[1].therapistPay, 250, 's2 untouched');
  assert.equal(rows[1].forwardedToPayroll, '');
});

// ============================================================================
// Interactions the freeze must NOT change.
// ============================================================================

test('the forwardedToPayroll stamp survives the upsert (pre-existing behaviour)', () => {
  const { rows } = remark([forwardedRow()], { outcome: 'therapist_cancelled' });
  assert.equal(rows[0].forwardedToPayroll, '2026-06', 'a correction must not un-forward a settled row');
});

test('credit effects are NOT frozen — creditsOwed is a separate, still-open ledger', () => {
  const client = { id: 'c1', creditsOwed: 0 };
  const { res } = remark([forwardedRow()], { outcome: 'therapist_cancelled' }, { clients: [client] });
  assert.equal(res.therapistPay, 250, 'pay frozen');
  assert.equal(client.creditsOwed, 1, 'the cancellation credit is still granted');
  assert.equal(res.creditStatus, 'credit_added');
});

test('an unknown therapist still rejects, even on a forwarded row (validation before freeze)', () => {
  const rows = [forwardedRow()];
  const { res } = remark(rows, { outcome: 'happened', therapist: 'לא קיים' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'unknown_therapist');
  assert.equal(rows[0].therapistPay, 250, 'nothing was written');
});

test('the upsert still replaces in place — no duplicate row', () => {
  const { rows } = remark([forwardedRow()], { outcome: 'patient_no_show' });
  assert.equal(rows.length, 1);
  assert.equal(rows.filter((r) => r.sessionId === 's1').length, 1);
});

// ============================================================================
// _toNumberOrZero — a frozen amount never becomes NaN in the sheet.
// ============================================================================

test('_toNumberOrZero: numbers pass through, junk becomes 0, never NaN', () => {
  assert.equal(toNumberOrZero(250), 250);
  assert.equal(toNumberOrZero('250'), 250);
  assert.equal(toNumberOrZero(0), 0);
  assert.equal(toNumberOrZero(137.5), 137.5);
  assert.equal(toNumberOrZero(''), 0);
  assert.equal(toNumberOrZero(null), 0);
  assert.equal(toNumberOrZero(undefined), 0);
  assert.equal(toNumberOrZero('abc'), 0);
  assert.equal(toNumberOrZero(NaN), 0);
  assert.equal(toNumberOrZero(Infinity), 0);
  for (const v of [250, '250', '', null, undefined, 'abc', NaN, Infinity]) {
    assert.ok(!Number.isNaN(toNumberOrZero(v)), 'NaN would corrupt the cell');
  }
});

test('a forwarded row with a blank stored pay freezes at 0, not NaN', () => {
  const { res, rows } = remark(
    [forwardedRow({ therapistPay: '' })],
    { outcome: 'happened' }
  );
  assert.equal(rows[0].therapistPay, 0);
  assert.ok(!Number.isNaN(res.therapistPay));
});

test('a forwarded row with a stringified pay freezes as a number', () => {
  const { rows } = remark([forwardedRow({ therapistPay: '230' })], { outcome: 'patient_no_show' });
  assert.equal(rows[0].therapistPay, 230);
  assert.equal(typeof rows[0].therapistPay, 'number', 'the sheet must get a number, not a string');
});
