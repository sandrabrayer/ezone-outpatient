'use strict';

/**
 * Salaried («גלובלי») therapists (2026-11-10, CHANGELOG-global-therapists.md).
 * Real Code.gs in the in-memory sandbox + the real payout module.
 *
 *   - «גלובלי» (or 'global') in TherapistRates.flatRate → the session is RECORDED
 *     with therapistPay 0 and payModel 'global' (before: refused as unknown).
 *   - a BLANK rate still fails closed — a forgotten rate never reads as salaried.
 *   - per-session therapists are unchanged (payModel '').
 *   - salaried rows never appear in the payout view and are never stamped by
 *     markForwarded; per-session rows in the same month still are.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../test-support/apps-script-sandbox');
const Payout = require('../public/therapist-payout');

const SECRET = 'outcome-secret-for-tests';
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const MONTH = now.getUTCFullYear() + '-' + pad(now.getUTCMonth() + 1);

function box() {
  const s = sandbox([], [{ id: 'c1', name: 'אורי', phone: '0501234567', serviceType: 'פרטני',
    clinicalTreatmentType: 'פרטני כללי', sessionsPerWeek: '{"פרטני":4}', status: 'פעיל', startDate: '2026-09-01', creditsOwed: 0 }]);
  s.seed('TherapistRates', s.ctx.THERAPIST_RATES_HEADERS, [
    { name: 'אוהד לביא', flatRate: 'גלובלי', intakeRate: '', followupRate: '' },
    { name: 'חנן וייל', flatRate: '  גלובלי ', intakeRate: '', followupRate: '' },
    { name: 'Global Eng', flatRate: 'GLOBAL', intakeRate: '', followupRate: '' },
    { name: 'מעיין דלומי', flatRate: 250, intakeRate: '', followupRate: '' },
    { name: 'חסר תעריף', flatRate: '', intakeRate: '', followupRate: '' },
    { name: 'טעות הקלדה', flatRate: 'גלובאלי', intakeRate: '', followupRate: '' }
  ]);
  s.seed('SessionLog', s.ctx.SESSION_LOG_HEADERS, []);
  s.props.SESSION_OUTCOME_SECRET = SECRET;
  return s;
}
const record = (s, sessionId, therapist, outcome) => s.post({ action: 'recordSessionOutcome', secret: SECRET, sessionId,
  phone: '0501234567', therapist, clinicalTreatmentType: 'פרטני כללי', date: MONTH + '-05', outcome: outcome || 'happened' });
const row = (s, id) => s.rows('SessionLog').find((r) => r.sessionId === id);

test('a salaried («גלובלי») therapist\'s session is recorded with pay 0 and payModel global', () => {
  const s = box();
  for (const [id, name] of [['g1', 'אוהד לביא'], ['g2', 'חנן וייל'], ['g3', 'Global Eng']]) {
    const r = record(s, id, name);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(Number(row(s, id).therapistPay), 0);
    assert.equal(row(s, id).payModel, 'global');
    assert.ok(Number(row(s, id).clientSessionValue) > 0, 'the session value (revenue side) is still recorded');
  }
  // a no-show by a salaried therapist is also recorded at 0
  assert.equal(record(s, 'g4', 'אוהד לביא', 'patient_no_show').ok, true);
  assert.equal(Number(row(s, 'g4').therapistPay), 0);
});

test('per-session therapists are unchanged; a blank or misspelt rate still fails closed', () => {
  const s = box();
  assert.equal(record(s, 'p1', 'מעיין דלומי').ok, true);
  assert.equal(Number(row(s, 'p1').therapistPay), 250);
  assert.equal(row(s, 'p1').payModel, '');
  for (const name of ['חסר תעריף', 'טעות הקלדה', 'לא ברשימה']) {
    const r = record(s, 'x-' + name, name);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unknown_therapist');
    assert.equal(row(s, 'x-' + name), undefined, 'nothing written');
  }
});

test('salaried rows never reach the payout view; per-session rows still do', () => {
  const s = box();
  record(s, 'g1', 'אוהד לביא');
  record(s, 'p1', 'מעיין דלומי');
  const summary = Payout.monthlyPayoutSummary(s.rows('SessionLog'), MONTH);
  assert.deepEqual(summary.therapists.map((t) => t.therapist), ['מעיין דלומי']);
  assert.equal(summary.totals.preVatTotal, 250);
  assert.equal(Payout.isGlobalPay({ payModel: 'global' }), true);
  assert.equal(Payout.isGlobalPay({ payModel: '' }), false);
});

test('markForwarded never stamps a salaried row', () => {
  const s = box();
  record(s, 'g1', 'אוהד לביא');
  record(s, 'p1', 'מעיין דלומי');
  const g = s.post({ action: 'markForwarded', therapist: 'אוהד לביא', month: MONTH });
  assert.equal(g.ok, true);
  assert.equal(g.forwarded, 0);
  assert.equal(row(s, 'g1').forwardedToPayroll, '');
  const p = s.post({ action: 'markForwarded', therapist: 'מעיין דלומי', month: MONTH });
  assert.equal(p.forwarded, 1);
  assert.equal(row(s, 'p1').forwardedToPayroll, MONTH);
});

test('_isGlobalRate accepts only the exact word (trimmed) or "global"', () => {
  const s = box();
  for (const v of ['גלובלי', ' גלובלי ', 'global', 'Global']) assert.equal(s.ctx._isGlobalRate(v), true, v);
  for (const v of ['', null, undefined, 0, 250, 'גלובאלי', 'גלובלי 250', 'globally']) assert.equal(s.ctx._isGlobalRate(v), false, String(v));
});
