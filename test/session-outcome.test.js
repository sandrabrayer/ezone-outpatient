'use strict';

/**
 * Coverage for task 4.8-step3-out — the secured `recordSessionOutcome` write
 * endpoint in apps-script/Code.gs: receive a session-outcome event, compute
 * therapist pay + client session value, and log ONE reconciliation row to the
 * SessionLog tab (upsert by sessionId).
 *
 * Run with:  npm test     (Node >= 18, built-in runner)
 *
 * Code.gs cannot be imported in the Node runtime, so the pure logic below mirrors
 * `_sessionOutcomeAuthOk`, the pay/value compute, and the SessionLog upsert (the
 * sheet I/O is replaced by an in-memory rows array). To keep the behaviour tests
 * honest, the pay/billing tables and SESSION_LOG_HEADERS are PARSED out of Code.gs
 * (not re-typed), exactly like clinical-derive.test.js — and a sync-guard asserts
 * each parsed table deep-equals the canonical module so the mirror can't drift.
 *
 * Contracts locked:
 *   - mirror sync-guards: Code.gs THERAPIST_FLAT_RATES / PSYCHIATRIST_RATES ==
 *     therapist-pay.js; BILLING_PRICES / DAY_CENTER_MONTHLY_BY_FREQ == treatment-map.js
 *   - each outcome computes the correct pay + value + status (no-show PAYS,
 *     therapist_cancelled pays 0, group 0/0)
 *   - correction: same sessionId re-sent flips the row (happened -> cancelled
 *     recomputes pay to 0), no duplicate, no stale pay
 *   - psychiatrist pay by type (intake / follow-up)
 *   - unknown outcome / unknown clinical type / wrong+missing secret all reject
 *   - ליווי with no freq stores null (flag), not a guess
 *   - positional safety on the new tab
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const TP = require('../public/therapist-pay');
const TreatmentMap = require('../public/treatment-map');

const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

// --- parse a `var NAME = { ... };` object literal out of Code.gs (balanced
//     braces, so nested objects like PSYCHIATRIST_RATES parse correctly) -------
function gsLiteral(name) {
  const start = GS.indexOf('var ' + name + ' = {');
  assert.ok(start !== -1, name + ' not found in Code.gs');
  const open = GS.indexOf('{', start);
  let depth = 0, end = -1;
  for (let j = open; j < GS.length; j++) {
    if (GS[j] === '{') depth++;
    else if (GS[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  assert.ok(end !== -1, name + ' has unbalanced braces');
  const body = GS.slice(open, end + 1)
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  // eslint-disable-next-line no-eval
  return eval('(' + body + ')');
}

// --- parse an array-of-strings literal (SESSION_LOG_HEADERS) -----------------
function gsHeaders(name) {
  const m = GS.match(new RegExp('var ' + name + ' = \\[([\\s\\S]*?)\\];'));
  assert.ok(m, name + ' not found in Code.gs');
  return m[1]
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
    .match(/'[^']*'/g).map((s) => s.slice(1, -1));
}

const FLAT = gsLiteral('THERAPIST_FLAT_RATES');
const PSYCH = gsLiteral('PSYCHIATRIST_RATES');
const BILLING = gsLiteral('BILLING_PRICES');
const DAY_FREQ = gsLiteral('DAY_CENTER_MONTHLY_BY_FREQ');
const CLINICAL_MAP = gsLiteral('CLINICAL_TO_BILLING');
const H = gsHeaders('SESSION_LOG_HEADERS');

const DAY_CENTER_BILLING = 'ליווי יומי בקהילה';
const GROUP_BILLING = 'קבוצה';

// --- pure mirror of Code.gs compute (built on the PARSED Code.gs tables) -----
function recoverPhone(raw) {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).replace(/[\s\-()]/g, '');
  if (s.indexOf('+') === 0) s = s.slice(1);
  if (s.indexOf('00') === 0) s = s.slice(2);
  s = s.replace(/\D/g, '');
  if (!s) return '';
  if (s.indexOf('972') === 0) s = '0' + s.slice(3);
  else if (s.charAt(0) !== '0') s = '0' + s;
  return s;
}
function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

function sessionOutcomeAuthOk(expected, got) {
  if (!expected) return false; // fail-closed
  const g = (got != null) ? String(got) : '';
  return g !== '' && g === expected;
}

function clinicalToBilling(clinical) {
  const key = String(clinical == null ? '' : clinical).trim();
  if (!has(CLINICAL_MAP, key)) throw new Error('unknown clinical');
  return CLINICAL_MAP[key];
}
function therapistPay(name, type) {
  const n = String(name == null ? '' : name).trim();
  if (has(FLAT, n)) return FLAT[n];
  if (has(PSYCH, n)) {
    const t = String(type == null ? '' : type).trim();
    if (!t || !has(PSYCH[n], t)) throw new Error('psych type');
    return PSYCH[n][t];
  }
  throw new Error('unknown therapist');
}
function isDayCenter(bt) { return String(bt == null ? '' : bt).trim() === DAY_CENTER_BILLING; }
function billingPrice(bt, freq) {
  const key = String(bt == null ? '' : bt).trim();
  if (isDayCenter(key)) {
    if (freq === undefined || freq === null || freq === '') throw new Error('freq');
    const f = Number(freq);
    if (!has(DAY_FREQ, f)) throw new Error('freq');
    return DAY_FREQ[f];
  }
  if (!has(BILLING, key)) throw new Error('unknown billing');
  return BILLING[key];
}

const SESSION_STATUS_BY_OUTCOME = {
  happened: 'consumed', therapist_cancelled: 'credited', patient_no_show: 'forfeited'
};

function computePay(outcome, therapist, clinical, billingType) {
  if (outcome === 'therapist_cancelled') return 0;
  if (billingType === GROUP_BILLING) return 0;
  return therapistPay(therapist, clinical);
}
function computeValue(billingType, freq) {
  if (isDayCenter(billingType) && (freq === undefined || freq === null || freq === '')) return null;
  return billingPrice(billingType, freq);
}

// Mirror of _recordSessionOutcome minus the sheet I/O: `rows` is the in-memory
// SessionLog (an array of row objects) upserted by sessionId.
function recordSessionOutcome(payload, rows, clients) {
  rows = rows || [];
  clients = clients || [];
  const sessionId = String((payload && payload.sessionId) || '').trim();
  if (!sessionId) return { res: { ok: false, reason: 'missing_session_id' }, rows };

  const outcome = String((payload && payload.outcome) || '').trim();
  if (!has(SESSION_STATUS_BY_OUTCOME, outcome)) return { res: { ok: false, reason: 'unknown_outcome' }, rows };

  const clinical = String((payload && payload.clinicalTreatmentType) || '').trim();
  if (!clinical || !has(CLINICAL_MAP, clinical)) return { res: { ok: false, reason: 'unknown_type' }, rows };
  const billingType = clinicalToBilling(clinical);
  const therapist = String((payload && payload.therapist) || '').trim();

  let freq;
  if (payload && payload.freqPerWeek != null && payload.freqPerWeek !== '') freq = payload.freqPerWeek;

  let pay, value;
  try { pay = computePay(outcome, therapist, clinical, billingType); }
  catch (e) { return { res: { ok: false, reason: 'unknown_therapist' }, rows }; }
  try { value = computeValue(billingType, freq); }
  catch (e) { return { res: { ok: false, reason: 'invalid_frequency' }, rows }; }

  const sessionStatus = SESSION_STATUS_BY_OUTCOME[outcome];
  const phone = recoverPhone(payload && payload.phone);
  let patientName = String((payload && payload.patientName) || '').trim();

  let clientId = '', matchStatus = 'no_match';
  if (phone && /^0\d{8,9}$/.test(phone)) {
    const hits = clients.filter((c) =>
      recoverPhone(c.phone) === phone ||
      recoverPhone(c.treatmentContactPhone) === phone ||
      recoverPhone(c.payerPhone) === phone);
    if (hits.length === 1) { clientId = String(hits[0].id); matchStatus = 'matched'; if (!patientName) patientName = String(hits[0].name || '').trim(); }
    else if (hits.length > 1) matchStatus = 'multi_match';
  }

  const rowObj = {
    sessionId, phone, patientName, clientId, therapist,
    clinicalTreatmentType: clinical, billingType,
    date: String((payload && payload.date) || '').trim(), outcome,
    therapistPay: pay, clientSessionValue: value, sessionStatus, matchStatus,
    recordedAt: '2026-06-18T00:00:00.000Z'
  };

  const idx = rows.findIndex((r) => String(r.sessionId) === sessionId);
  let upserted = false;
  if (idx !== -1) { rows[idx] = rowObj; upserted = true; } else rows.push(rowObj);

  const res = { ok: true, sessionId, therapistPay: pay, clientSessionValue: value, sessionStatus };
  if (upserted) res.upserted = true; else res.appended = true;
  return { res, rows };
}

// Mirror of _writeAll/_readAll positional mapping (for positional-safety test).
function writeRow(headers, obj) {
  return headers.map((h) => { const v = obj[h]; return (v === undefined || v === null) ? '' : v; });
}
function readRow(headers, row) { const o = {}; for (let c = 0; c < headers.length; c++) o[headers[c]] = row[c]; return o; }

// ============================================================================
// Mirror sync-guards — the Code.gs tables can never drift from the modules.
// ============================================================================
test('THERAPIST_FLAT_RATES mirror equals public/therapist-pay.js', () => {
  assert.deepEqual(FLAT, TP.FLAT_RATES);
  assert.equal(Object.keys(FLAT).length, 16);
});
test('PSYCHIATRIST_RATES mirror equals public/therapist-pay.js', () => {
  assert.deepEqual(PSYCH, TP.PSYCHIATRIST_RATES);
  assert.equal(Object.keys(PSYCH).length, 3);
});
test('BILLING_PRICES mirror equals public/treatment-map.js', () => {
  assert.deepEqual(BILLING, TreatmentMap.BILLING_PRICES);
});
test('DAY_CENTER_MONTHLY_BY_FREQ mirror equals public/treatment-map.js', () => {
  assert.deepEqual(DAY_FREQ, TreatmentMap.DAY_CENTER_MONTHLY_BY_FREQ);
});
test('the parsed compute matches the canonical modules', () => {
  assert.equal(therapistPay('מעיין דלומי'), TP.therapistPay('מעיין דלומי'));
  assert.equal(billingPrice('פרטני'), TreatmentMap.billingPrice('פרטני'));
  assert.equal(billingPrice(DAY_CENTER_BILLING, 5), TreatmentMap.billingPrice(DAY_CENTER_BILLING, 5));
});

// ============================================================================
// Auth — fail-closed.
// ============================================================================
test('auth is fail-closed: unset / empty / wrong secret rejected; exact match ok', () => {
  assert.equal(sessionOutcomeAuthOk('', 'anything'), false);
  assert.equal(sessionOutcomeAuthOk(null, 'anything'), false);
  assert.equal(sessionOutcomeAuthOk('s3cret', ''), false);
  assert.equal(sessionOutcomeAuthOk('s3cret', null), false);
  assert.equal(sessionOutcomeAuthOk('s3cret', 'wrong'), false);
  assert.equal(sessionOutcomeAuthOk('s3cret', 's3cret'), true);
});

// ============================================================================
// Each outcome computes pay + value + status.
// ============================================================================
test('happened -> consumed, pays the flat rate, bills the session value', () => {
  const { res, rows } = recordSessionOutcome(
    { sessionId: 's1', therapist: 'דליה מלמד', clinicalTreatmentType: 'פרטני כללי', outcome: 'happened' }, []
  );
  assert.equal(res.ok, true);
  assert.equal(res.therapistPay, 230);          // דליה מלמד flat
  assert.equal(res.clientSessionValue, 500);    // פרטני
  assert.equal(res.sessionStatus, 'consumed');
  assert.equal(res.appended, true);
  assert.equal(rows[0].billingType, 'פרטני');
});

test('patient_no_show -> forfeited, therapist STILL paid, value still billed', () => {
  const { res } = recordSessionOutcome(
    { sessionId: 's2', therapist: 'מעיין דלומי', clinicalTreatmentType: 'פרטני CBT', outcome: 'patient_no_show' }, []
  );
  assert.equal(res.therapistPay, 250);          // showed up -> paid
  assert.equal(res.clientSessionValue, 500);
  assert.equal(res.sessionStatus, 'forfeited');
});

test('therapist_cancelled -> credited, pay 0 (never delivered), value still computed', () => {
  const { res } = recordSessionOutcome(
    { sessionId: 's3', therapist: 'מעיין דלומי', clinicalTreatmentType: 'פרטני CBT', outcome: 'therapist_cancelled' }, []
  );
  assert.equal(res.therapistPay, 0);
  assert.equal(res.clientSessionValue, 500);
  assert.equal(res.sessionStatus, 'credited');
});

test('therapist_cancelled logs even for an unknown therapist (no pay lookup)', () => {
  const { res } = recordSessionOutcome(
    { sessionId: 's3b', therapist: 'מטפל לא מוכר', clinicalTreatmentType: 'פרטני CBT', outcome: 'therapist_cancelled' }, []
  );
  assert.equal(res.ok, true);
  assert.equal(res.therapistPay, 0);
});

test('group (קבוצה) -> 0 pay AND 0 value, regardless of (paid) outcome', () => {
  const happened = recordSessionOutcome(
    { sessionId: 'g1', therapist: 'מעיין דלומי', clinicalTreatmentType: 'קבוצה', outcome: 'happened' }, []
  ).res;
  assert.equal(happened.therapistPay, 0);
  assert.equal(happened.clientSessionValue, 0);
  assert.equal(happened.sessionStatus, 'consumed');

  const noShow = recordSessionOutcome(
    { sessionId: 'g2', therapist: 'מעיין דלומי', clinicalTreatmentType: 'קבוצה', outcome: 'patient_no_show' }, []
  ).res;
  assert.equal(noShow.therapistPay, 0);
  assert.equal(noShow.clientSessionValue, 0);
});

// ============================================================================
// Correction: same sessionId re-sent updates the row (no dup, no stale pay).
// ============================================================================
test('correction: happened -> therapist_cancelled flips pay to 0 on the SAME row', () => {
  let rows = [];
  let r = recordSessionOutcome(
    { sessionId: 'fix1', therapist: 'אורן כביר', clinicalTreatmentType: 'פרטני כללי', outcome: 'happened' }, rows
  );
  rows = r.rows;
  assert.equal(r.res.therapistPay, 250);
  assert.equal(r.res.appended, true);
  assert.equal(rows.length, 1);

  // corrected outcome, same sessionId
  r = recordSessionOutcome(
    { sessionId: 'fix1', therapist: 'אורן כביר', clinicalTreatmentType: 'פרטני כללי', outcome: 'therapist_cancelled' }, rows
  );
  rows = r.rows;
  assert.equal(rows.length, 1, 'no duplicate row');
  assert.equal(r.res.upserted, true);
  assert.equal(r.res.therapistPay, 0, 'pay recomputed to 0 — not stale 250');
  assert.equal(rows[0].therapistPay, 0);
  assert.equal(rows[0].sessionStatus, 'credited');
});

test('correction the other way: therapist_cancelled -> happened restores pay', () => {
  let rows = [];
  rows = recordSessionOutcome({ sessionId: 'fix2', therapist: 'תמר גנץ', clinicalTreatmentType: 'פרטני CBT', outcome: 'therapist_cancelled' }, rows).rows;
  const r = recordSessionOutcome({ sessionId: 'fix2', therapist: 'תמר גנץ', clinicalTreatmentType: 'פרטני CBT', outcome: 'happened' }, rows);
  assert.equal(r.rows.length, 1);
  assert.equal(r.res.therapistPay, 250);
  assert.equal(r.res.upserted, true);
});

// ============================================================================
// Psychiatrist pay by type (intake / follow-up).
// ============================================================================
test('psychiatrist pay by type via _therapistPay: intake 900, follow-up 700', () => {
  Object.keys(PSYCH).forEach((name) => {
    assert.equal(therapistPay(name, 'אינטייק'), 900, name + ' intake');
    assert.equal(therapistPay(name, 'מעקב פסיכיאטרי'), 700, name + ' follow-up');
  });
});

test('psychiatrist follow-up flows end-to-end (clinical מעקב פסיכיאטרי)', () => {
  const { res } = recordSessionOutcome(
    { sessionId: 'p1', therapist: 'ד״ר שפרינץ', clinicalTreatmentType: 'מעקב פסיכיאטרי', outcome: 'happened' }, []
  );
  assert.equal(res.therapistPay, 700);          // follow-up pay
  assert.equal(res.clientSessionValue, 1100);   // מעקב פסיכיאטרי billing
});

test('a paid non-group outcome with an unknown therapist is rejected (fail-closed)', () => {
  const { res, rows } = recordSessionOutcome(
    { sessionId: 'u1', therapist: 'מטפל לא מוכר', clinicalTreatmentType: 'פרטני CBT', outcome: 'happened' }, []
  );
  assert.deepEqual(res, { ok: false, reason: 'unknown_therapist' });
  assert.equal(rows.length, 0);
});

// ============================================================================
// ליווי with no freq -> null (flag), not a guess.
// ============================================================================
test('ליווי with NO freq stores clientSessionValue null (flag), still logs', () => {
  const { res, rows } = recordSessionOutcome(
    { sessionId: 'd1', therapist: 'מעיין דלומי', clinicalTreatmentType: 'ליווי יומי בקהילה', outcome: 'happened' }, []
  );
  assert.equal(res.ok, true);
  assert.equal(res.clientSessionValue, null);   // flagged, not guessed
  assert.equal(res.therapistPay, 250);          // therapist still paid
  assert.equal(rows[0].clientSessionValue, null);
});

test('ליווי WITH freq prices by frequency (5 -> 18000)', () => {
  const { res } = recordSessionOutcome(
    { sessionId: 'd2', therapist: 'מעיין דלומי', clinicalTreatmentType: 'ליווי יומי בקהילה', outcome: 'happened', freqPerWeek: 5 }, []
  );
  assert.equal(res.clientSessionValue, 18000);
});

// ============================================================================
// Rejections — write nothing.
// ============================================================================
test('unknown outcome is rejected and writes nothing', () => {
  const { res, rows } = recordSessionOutcome(
    { sessionId: 'x1', therapist: 'מעיין דלומי', clinicalTreatmentType: 'פרטני CBT', outcome: 'maybe' }, []
  );
  assert.deepEqual(res, { ok: false, reason: 'unknown_outcome' });
  assert.equal(rows.length, 0);
});

test('unknown clinical type is rejected and writes nothing', () => {
  const { res, rows } = recordSessionOutcome(
    { sessionId: 'x2', therapist: 'מעיין דלומי', clinicalTreatmentType: 'אינטייק', outcome: 'happened' }, []
  );
  // אינטייק is billing-only — not a clinical session type, so it rejects
  assert.deepEqual(res, { ok: false, reason: 'unknown_type' });
  assert.equal(rows.length, 0);
});

test('missing sessionId is rejected', () => {
  const { res } = recordSessionOutcome(
    { therapist: 'מעיין דלומי', clinicalTreatmentType: 'פרטני CBT', outcome: 'happened' }, []
  );
  assert.deepEqual(res, { ok: false, reason: 'missing_session_id' });
});

// ============================================================================
// Client match enrichment — never gates the log.
// ============================================================================
test('single phone match fills clientId + matchStatus matched', () => {
  const clients = [{ id: 'c1', name: 'אורי', phone: '0501234567', treatmentContactPhone: '', payerPhone: '' }];
  const { rows } = recordSessionOutcome(
    { sessionId: 'm1', phone: '+972-50-1234567', therapist: 'מעיין דלומי', clinicalTreatmentType: 'פרטני CBT', outcome: 'happened' }, [], clients
  );
  assert.equal(rows[0].clientId, 'c1');
  assert.equal(rows[0].matchStatus, 'matched');
  assert.equal(rows[0].patientName, 'אורי');   // backfilled from client
});

test('no phone match still logs, flagged no_match', () => {
  const { res, rows } = recordSessionOutcome(
    { sessionId: 'm2', phone: '0509999999', therapist: 'מעיין דלומי', clinicalTreatmentType: 'פרטני CBT', outcome: 'happened' }, [], []
  );
  assert.equal(res.ok, true);
  assert.equal(rows[0].matchStatus, 'no_match');
  assert.equal(rows[0].clientId, '');
});

test('multiple phone matches log flagged multi_match', () => {
  const clients = [
    { id: 'c1', name: 'א', phone: '0501234567' },
    { id: 'c2', name: 'ב', phone: '0501234567' }
  ];
  const { rows } = recordSessionOutcome(
    { sessionId: 'm3', phone: '0501234567', therapist: 'מעיין דלומי', clinicalTreatmentType: 'פרטני CBT', outcome: 'happened' }, [], clients
  );
  assert.equal(rows[0].matchStatus, 'multi_match');
  assert.equal(rows[0].clientId, '');
});

// ============================================================================
// Positional safety on the new tab.
// ============================================================================
test('SESSION_LOG_HEADERS: sessionId first (upsert key), phone present, recordedAt last', () => {
  assert.equal(H[0], 'sessionId');
  assert.ok(H.indexOf('phone') !== -1);
  assert.equal(H[H.length - 1], 'recordedAt');
  // every field the receiver writes has a column
  ['sessionId', 'phone', 'patientName', 'clientId', 'therapist', 'clinicalTreatmentType',
   'billingType', 'date', 'outcome', 'therapistPay', 'clientSessionValue',
   'sessionStatus', 'matchStatus', 'recordedAt'].forEach((k) => {
    assert.ok(H.indexOf(k) !== -1, 'missing column ' + k);
  });
});

test('a row round-trips positionally through write/read by header order', () => {
  const { rows } = recordSessionOutcome(
    { sessionId: 'pos1', phone: '0501234567', therapist: 'דליה מלמד', clinicalTreatmentType: 'פרטני כללי', date: '2026-06-18', outcome: 'happened' }, []
  );
  const row = writeRow(H, rows[0]);
  assert.equal(row[H.indexOf('sessionId')], 'pos1');
  assert.equal(row[H.indexOf('phone')], '0501234567');
  assert.equal(row[H.indexOf('therapistPay')], 230);
  assert.equal(row[H.indexOf('clientSessionValue')], 500);
  assert.equal(row[H.indexOf('sessionStatus')], 'consumed');
  const back = readRow(H, row);
  assert.equal(back.billingType, 'פרטני');
  assert.equal(back.outcome, 'happened');
  assert.equal(back.date, '2026-06-18');
});

test('null clientSessionValue (ליווי no freq) writes a blank cell, distinct from 0', () => {
  const { rows } = recordSessionOutcome(
    { sessionId: 'pos2', therapist: 'מעיין דלומי', clinicalTreatmentType: 'ליווי יומי בקהילה', outcome: 'happened' }, []
  );
  const row = writeRow(H, rows[0]);
  assert.equal(row[H.indexOf('clientSessionValue')], '');   // null -> blank, not 0
  // group writes a real 0 in the same column
  const g = recordSessionOutcome(
    { sessionId: 'pos3', therapist: 'מעיין דלומי', clinicalTreatmentType: 'קבוצה', outcome: 'happened' }, []
  );
  assert.equal(writeRow(H, g.rows[0])[H.indexOf('clientSessionValue')], 0);
});
