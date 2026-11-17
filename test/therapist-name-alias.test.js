'use strict';
/**
 * Therapist name aliases — 2026-11-17 (CHANGELOG-therapist-name-alias.md).
 *
 * The therapists roster spells ד"ר מיכאל שפרינץ without the ר (ד" מיכאל שפרינץ). Pay rates are
 * looked up by the exact TherapistRates name, so every session of his answered
 * `unknown_therapist`: nothing recorded, the patient's monthly counter not moved, no pay.
 * REAL Code.gs in the sandbox; synthetic sheets only.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../test-support/apps-script-sandbox.js');

const SECRET = 'synthetic-alias-fixture-only';
const PHONE = '0501234567';
const CANON = 'ד"ר מיכאל שפרינץ';
const TYPO = 'ד" מיכאל שפרינץ';
const FOLLOWUP = 'מעקב פסיכיאטרי';

function fixture(rates) {
  const sb = sandbox([], [{
    id: 'synthetic-client-a', name: 'Synthetic Patient', phone: PHONE, status: 'פעיל', serviceType: FOLLOWUP,
    sessionsPerWeek: JSON.stringify({ [FOLLOWUP]: 2 }), pricePerSession: 2000, billingType: 'monthly', billingDay: 5,
    startDate: '2026-10-01', creditsOwed: 0
  }]);
  sb.props.SESSION_OUTCOME_SECRET = SECRET;
  sb.seed('TherapistRates', sb.ctx.THERAPIST_RATES_HEADERS, rates || [
    { name: CANON, flatRate: '', intakeRate: 900, followupRate: 700 },
    { name: 'Synthetic Therapist', flatRate: 300 }
  ]);
  const send = (patch) => JSON.parse(sb.ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(Object.assign({
    action: 'recordSessionOutcome', secret: SECRET, sessionId: 'synthetic-session-a', phone: PHONE,
    therapist: TYPO, clinicalTreatmentType: FOLLOWUP, date: '2026-11-16', outcome: 'happened', reportRevision: '2026-11-17T06:00:00.000Z'
  }, patch || {})) } }).getContent());
  const log = () => sb.rows('SessionLog');
  return { sb, send, log };
}

test('the roster misspelling is recorded under the TherapistRates name, at his follow-up rate, and uses a session of the month', () => {
  const f = fixture();
  const r = f.send();
  assert.equal(r.ok, true, JSON.stringify(r));
  const row = f.log()[0];
  assert.equal(row.therapist, CANON, 'stored under the one canonical name (payout groups by it)');
  assert.equal(Number(row.therapistPay), 700);
  assert.equal(row.outcome, 'happened');
  assert.equal(row.matchStatus, 'matched');
  assert.equal(f.sb.ctx._happenedInMonth(f.log(), 'synthetic-client-a', '2026-11'), 1, 'the patient\'s monthly counter moves');
  // intake uses the intake rate
  const g = fixture();
  assert.equal(Number(g.send({ clinicalTreatmentType: 'אינטייק' }).therapistPay), 900);
});

test('quote characters and spacing do not matter; letters do', () => {
  for (const name of ['ד" מיכאל שפרינץ', 'ד״ מיכאל שפרינץ', 'ד” מיכאל שפרינץ', 'ד“ מיכאל שפרינץ', "ד'' מיכאל שפרינץ", '  ד"  מיכאל   שפרינץ ']) {
    const f = fixture();
    const r = f.send({ therapist: name });
    assert.equal(r.ok, true, JSON.stringify([name, r]));
    assert.equal(f.log()[0].therapist, CANON, name);
  }
  for (const name of ['ד" מיכאל שפרינ', 'ד" מיכאל שפרינצ', 'ד" מיכל שפרינץ', 'ד" מיכאל', 'מיכאל שפרינץ', 'דב מיכאל שפרינץ', 'Synthetic Unknown']) {
    const f = fixture();
    const r = f.send({ therapist: name });
    assert.equal(r.ok, false, name);
    assert.equal(r.reason, 'unknown_therapist', name);
    assert.equal(f.log().length, 0, name + ': nothing written');
  }
});

test('an exact TherapistRates name always wins — the alias is never consulted for it', () => {
  // the misspelt name has its OWN rates row: that row prices it, and the row keeps that name
  const f = fixture([
    { name: CANON, flatRate: '', intakeRate: 900, followupRate: 700 },
    { name: TYPO, flatRate: '', intakeRate: 500, followupRate: 400 }
  ]);
  const r = f.send();
  assert.equal(r.ok, true);
  assert.equal(f.log()[0].therapist, TYPO);
  assert.equal(Number(f.log()[0].therapistPay), 400);
  // and the canonical name itself is untouched
  const g = fixture();
  g.send({ therapist: CANON });
  assert.equal(g.log()[0].therapist, CANON);
  assert.equal(Number(g.log()[0].therapistPay), 700);
  // other therapists are unaffected
  const h = fixture();
  h.send({ therapist: 'Synthetic Therapist', clinicalTreatmentType: 'פרטני CBT' });
  assert.equal(h.log()[0].therapist, 'Synthetic Therapist');
  assert.equal(Number(h.log()[0].therapistPay), 300);
});

test('fails closed: no rates row for the target, or two rows that read the same → unknown_therapist, nothing written', () => {
  const none = fixture([{ name: 'Synthetic Therapist', flatRate: 300 }]);
  assert.equal(none.send().reason, 'unknown_therapist');
  assert.equal(none.log().length, 0);
  const twin = fixture([
    { name: 'ד"ר מיכאל שפרינץ', flatRate: '', intakeRate: 900, followupRate: 700 },
    { name: 'ד״ר מיכאל שפרינץ', flatRate: '', intakeRate: 800, followupRate: 600 }
  ]);
  assert.equal(twin.send().reason, 'unknown_therapist', 'ambiguous target: never guess between two rates');
  assert.equal(twin.log().length, 0);
});

test('a no-pay outcome under the misspelt name is stored under the canonical name too (one name per therapist in the payout)', () => {
  const f = fixture();
  assert.equal(f.send({ outcome: 'therapist_cancelled' }).ok, true);
  assert.equal(f.log()[0].therapist, CANON);
  assert.equal(Number(f.log()[0].therapistPay), 0);
});

test('re-sending the same report after the fix is idempotent, and a correction keeps one row', () => {
  const f = fixture();
  f.send();
  const again = f.send();
  assert.equal(again.ok, true);
  assert.equal(again.replayed, true);
  assert.equal(f.log().length, 1);
  assert.equal(f.send({ outcome: 'patient_no_show', reportRevision: '2026-11-17T07:00:00.000Z' }).ok, true);
  assert.equal(f.log().length, 1);
  assert.equal(f.log()[0].therapist, CANON);
});

test('the list is explicit and small: keys/targets are quote-free, every target differs from its key, no prototype keys', () => {
  const { sb } = fixture();
  const map = JSON.parse(JSON.stringify(sb.ctx.THERAPIST_NAME_ALIASES));
  const keys = Object.keys(map);
  assert.deepEqual(keys, ['ד מיכאל שפרינץ']);
  for (const k of keys) {
    assert.equal(sb.ctx._therapistAliasKey(k), k, 'key is already in key form');
    assert.equal(sb.ctx._therapistAliasKey(map[k]), map[k], 'target is in key form');
    assert.notEqual(map[k], k);
  }
  assert.equal(sb.ctx._therapistAliasKey(CANON), 'דר מיכאל שפרינץ');
  assert.equal(sb.ctx._therapistAliasKey(TYPO), 'ד מיכאל שפרינץ');
  for (const bad of ['constructor', '__proto__', 'toString', '', null, undefined]) {
    assert.equal(sb.ctx._canonicalTherapistName(bad), String(bad == null ? '' : bad).trim());
  }
});

test('the secret still gates first', () => {
  const f = fixture();
  const r = f.send({ secret: 'wrong' });
  assert.equal(r.ok, false); assert.equal(r.error, 'unauthorized');
  assert.equal(f.log().length, 0);
});
