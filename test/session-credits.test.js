'use strict';

/**
 * Coverage for session accounting + credits (auto-draw) in apps-script/Code.gs:
 * the credit engine inside `_recordSessionOutcome`, the `_saveAll` preserve rule,
 * and the two new append-only columns (Clients.creditsOwed, SessionLog.creditStatus).
 *
 * Run with:  npm test     (Node >= 18, built-in runner)
 *
 * Code.gs cannot be imported in Node, so the credit engine is mirrored below as a
 * pure function over in-memory clients + SessionLog rows. A source-scan guard then
 * asserts the real engine pieces exist in Code.gs so the mirror can't silently
 * drift. The CLIENTS_HEADERS / SESSION_LOG_HEADERS are PARSED out of Code.gs.
 *
 * Model (locked): monthly paid quota = weekly frequency × 4, renews each month.
 *   - therapist_cancelled -> +1 credit
 *   - happened beyond the month's quota, credit available -> session free
 *     (clientSessionValue 0), credit -1, therapist still paid
 *   - credits carry forward across months; delivered count resets per month
 *   - no plan frequency / no date -> NO draw, row flagged
 *   - upsert reverses the prior row's credit effect, then applies the new one
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

function gsHeaders(name) {
  const m = GS.match(new RegExp('var ' + name + ' = \\[([\\s\\S]*?)\\];'));
  assert.ok(m, name + ' not found in Code.gs');
  return m[1].split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
    .match(/'[^']*'/g).map((s) => s.slice(1, -1));
}
const CLIENTS_H = gsHeaders('CLIENTS_HEADERS');
const LOG_H = gsHeaders('SESSION_LOG_HEADERS');

// --- pure mirror of the Code.gs credit helpers ------------------------------
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
function toCredits(v) { const n = parseInt(v, 10); return (isNaN(n) || n < 0) ? 0 : n; }
function planWeeklyFrequency(client) {
  if (!client) return 0;
  const s = String(client.sessionsPerWeek == null ? '' : client.sessionsPerWeek).trim();
  if (!s) return 0;
  let total = 0;
  if (s.charAt(0) === '{') {
    try { const o = JSON.parse(s); Object.keys(o).forEach((k) => { const n = parseInt(o[k], 10); if (!isNaN(n) && n > 0) total += n; }); }
    catch (_) { return 0; }
  } else { const n = parseInt(s, 10); if (!isNaN(n) && n > 0) total = n; }
  return total;
}
function monthKey(d) { const s = String(d == null ? '' : d).trim(); return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : ''; }

// minimal billing/pay for the clinical types used in these tests only
const BILLING_BY_CLINICAL = { 'פרטני כללי': 'פרטני', 'פרטני CBT': 'פרטני CBT', 'קבוצה': 'קבוצה', 'ליווי יומי בקהילה': 'ליווי יומי בקהילה' };
const BILLING_PRICE = { 'פרטני': 500, 'פרטני CBT': 500, 'קבוצה': 0 };
const SESSION_STATUS_BY_OUTCOME = { happened: 'consumed', therapist_cancelled: 'credited', patient_no_show: 'forfeited' };
function computeValue(billingType, freq) {
  if (billingType === 'ליווי יומי בקהילה') return (freq === undefined || freq === null || freq === '') ? null : 18000;
  return BILLING_PRICE[billingType];
}
function computePay(outcome, billingType) {
  if (outcome === 'therapist_cancelled') return 0;
  if (billingType === 'קבוצה') return 0;
  return 250; // flat for the test therapist
}

// Faithful mirror of the _recordSessionOutcome credit engine (sheet I/O replaced
// by the in-memory `clients` + `logRows` arrays). Mutates them; returns result.
function record(payload, clients, logRows) {
  clients = clients || [];
  logRows = logRows || [];
  const sessionId = String((payload && payload.sessionId) || '').trim();
  const outcome = String((payload && payload.outcome) || '').trim();
  const clinical = String((payload && payload.clinicalTreatmentType) || '').trim();
  const billingType = BILLING_BY_CLINICAL[clinical];
  const phone = recoverPhone(payload && payload.phone);

  let freq;
  if (payload.frequencyPerWeek != null && payload.frequencyPerWeek !== '') freq = payload.frequencyPerWeek;
  else if (payload.freqPerWeek != null && payload.freqPerWeek !== '') freq = payload.freqPerWeek;

  let value = computeValue(billingType, freq);
  const therapistPay = computePay(outcome, billingType);

  // single-hit match
  let matchedClient = null, clientId = '';
  if (phone && /^0\d{8,9}$/.test(phone)) {
    const hits = clients.filter((c) => recoverPhone(c.phone) === phone || recoverPhone(c.treatmentContactPhone) === phone || recoverPhone(c.payerPhone) === phone);
    if (hits.length === 1) { matchedClient = hits[0]; clientId = String(matchedClient.id); }
  }

  const row = {
    sessionId, phone, clientId, billingType, date: String((payload && payload.date) || '').trim(),
    outcome, therapistPay, clientSessionValue: value,
    sessionStatus: SESSION_STATUS_BY_OUTCOME[outcome], creditStatus: ''
  };

  const oldRow = logRows.find((r) => String(r.sessionId) === sessionId) || null;

  if (matchedClient) {
    const orig = toCredits(matchedClient.creditsOwed);
    let balance = orig;
    if (oldRow) {
      if (oldRow.outcome === 'therapist_cancelled') balance -= 1;
      if (String(oldRow.creditStatus) === 'covered') balance += 1;
    }
    if (balance < 0) balance = 0;
    if (outcome === 'therapist_cancelled') {
      balance += 1; row.creditStatus = 'credit_added';
    } else if (outcome === 'happened') {
      let quotaFreq = planWeeklyFrequency(matchedClient);
      if (!quotaFreq && freq != null && freq !== '') { const ef = parseInt(freq, 10); if (!isNaN(ef) && ef > 0) quotaFreq = ef; }
      const month = monthKey(row.date);
      if (!quotaFreq || !month) {
        row.creditStatus = 'quota_unknown';
      } else {
        const quota = quotaFreq * 4;
        let priorHappened = 0;
        for (const lrow of logRows) {
          if (String(lrow.sessionId) === sessionId) continue;
          if (String(lrow.clientId) === clientId && lrow.outcome === 'happened' && monthKey(lrow.date) === month) priorHappened++;
        }
        const beyond = priorHappened >= quota;
        if (!beyond) row.creditStatus = 'within_quota';
        else if (balance > 0 && typeof value === 'number' && value > 0) { value = 0; row.clientSessionValue = 0; balance -= 1; row.creditStatus = 'covered'; }
        else row.creditStatus = 'beyond_no_credit';
      }
    }
    if (balance !== orig) matchedClient.creditsOwed = balance;
    row.creditsOwed = balance;
  } else if (outcome === 'happened' || outcome === 'therapist_cancelled') {
    row.creditStatus = 'no_client';
  }

  const idx = logRows.findIndex((r) => String(r.sessionId) === sessionId);
  if (idx !== -1) logRows[idx] = row; else logRows.push(row);
  return { row, clientSessionValue: value, therapistPay, creditStatus: row.creditStatus, creditsOwed: row.creditsOwed, clients, logRows };
}

// Mirror of _saveAll's creditsOwed preserve-by-id rule.
function saveAllPreserve(existingClients, payloadClients) {
  const map = {};
  existingClients.forEach((c) => { if (c.id != null && c.id !== '') map[String(c.id)] = toCredits(c.creditsOwed); });
  return payloadClients.map((c) => {
    const id = c.id != null ? String(c.id) : '';
    return Object.assign({}, c, { creditsOwed: Object.prototype.hasOwnProperty.call(map, id) ? map[id] : toCredits(c.creditsOwed) });
  });
}

function writeRow(headers, obj) { return headers.map((h) => { const v = obj[h]; return (v === undefined || v === null) ? '' : v; }); }
function readRow(headers, row) { const o = {}; for (let c = 0; c < headers.length; c++) o[headers[c]] = row[c]; return o; }

// a client on a 2/week plan -> quota 8/month
function client2pw() { return { id: 'c1', name: 'אורי', phone: '0501234567', sessionsPerWeek: JSON.stringify({ 'פרטני': 2 }), creditsOwed: 0 }; }
const HAPPENED = (id, date, extra) => Object.assign({ sessionId: id, phone: '0501234567', therapist: 'מעיין דלומי', clinicalTreatmentType: 'פרטני כללי', outcome: 'happened', date }, extra);

// ============================================================================
test('quota is weekly frequency × 4', () => {
  assert.equal(planWeeklyFrequency(client2pw()) * 4, 8);
  assert.equal(planWeeklyFrequency({ sessionsPerWeek: JSON.stringify({ 'פרטני': 3 }) }) * 4, 12);
  assert.equal(planWeeklyFrequency({ sessionsPerWeek: JSON.stringify({ 'פרטני': 1, 'קבוצה': 1 }) }) * 4, 8); // summed
  assert.equal(planWeeklyFrequency({ sessionsPerWeek: '2' }) * 4, 8); // bare number
});

test('therapist_cancelled grants +1 credit', () => {
  const clients = [client2pw()]; const log = [];
  const r = record({ sessionId: 'x1', phone: '0501234567', clinicalTreatmentType: 'פרטני CBT', outcome: 'therapist_cancelled', date: '2026-06-10' }, clients, log);
  assert.equal(r.creditStatus, 'credit_added');
  assert.equal(clients[0].creditsOwed, 1);
  assert.equal(r.therapistPay, 0);          // never delivered
});

test('happened within quota: no credit change, normal value', () => {
  const clients = [client2pw()]; const log = [];
  // 8 happened sessions = exactly the quota, all within
  for (let i = 1; i <= 8; i++) {
    const r = record(HAPPENED('s' + i, '2026-06-' + String(i).padStart(2, '0')), clients, log);
    assert.equal(r.creditStatus, 'within_quota', 'session ' + i);
    assert.equal(r.clientSessionValue, 500);
  }
  assert.equal(clients[0].creditsOwed, 0);
});

test('happened beyond quota WITH credit: value 0, credit −1, therapist still paid', () => {
  const clients = [client2pw()]; clients[0].creditsOwed = 1; const log = [];
  for (let i = 1; i <= 8; i++) record(HAPPENED('s' + i, '2026-06-' + String(i).padStart(2, '0')), clients, log);
  const r = record(HAPPENED('s9', '2026-06-20'), clients, log);   // 9th = beyond quota
  assert.equal(r.creditStatus, 'covered');
  assert.equal(r.clientSessionValue, 0);     // free to patient
  assert.equal(r.therapistPay, 250);         // therapist paid normally
  assert.equal(clients[0].creditsOwed, 0);   // credit drawn
});

test('happened beyond quota with NO credit: normal value, balance stays 0, flagged', () => {
  const clients = [client2pw()]; const log = []; // 0 credits
  for (let i = 1; i <= 8; i++) record(HAPPENED('s' + i, '2026-06-' + String(i).padStart(2, '0')), clients, log);
  const r = record(HAPPENED('s9', '2026-06-20'), clients, log);
  assert.equal(r.creditStatus, 'beyond_no_credit');
  assert.equal(r.clientSessionValue, 500);   // patient still billed
  assert.equal(clients[0].creditsOwed, 0);
});

test('carry-forward: a credit earned one month is spent the next; delivered count resets monthly', () => {
  const clients = [client2pw()]; const log = [];
  // May: a cancellation banks 1 credit
  record({ sessionId: 'mayc', phone: '0501234567', clinicalTreatmentType: 'פרטני CBT', outcome: 'therapist_cancelled', date: '2026-05-05' }, clients, log);
  assert.equal(clients[0].creditsOwed, 1);
  // June: quota resets — 8 within-quota sessions don't touch the credit
  for (let i = 1; i <= 8; i++) record(HAPPENED('jun' + i, '2026-06-' + String(i).padStart(2, '0')), clients, log);
  assert.equal(clients[0].creditsOwed, 1, 'credit carried into June untouched (count reset)');
  // 9th June session draws the carried credit
  const r = record(HAPPENED('jun9', '2026-06-20'), clients, log);
  assert.equal(r.creditStatus, 'covered');
  assert.equal(clients[0].creditsOwed, 0);
});

test('correction reverses the credit effect: happened-covered -> therapist_cancelled', () => {
  const clients = [client2pw()]; clients[0].creditsOwed = 1; const log = [];
  for (let i = 1; i <= 8; i++) record(HAPPENED('s' + i, '2026-06-' + String(i).padStart(2, '0')), clients, log);
  record(HAPPENED('s9', '2026-06-20'), clients, log);      // draws -> balance 0, covered
  assert.equal(clients[0].creditsOwed, 0);
  // correction: s9 was actually a therapist cancellation
  const r = record({ sessionId: 's9', phone: '0501234567', clinicalTreatmentType: 'פרטני כללי', outcome: 'therapist_cancelled', date: '2026-06-20' }, clients, log);
  // undo the draw (+1 back) AND add the cancellation credit (+1) => 2
  assert.equal(clients[0].creditsOwed, 2);
  assert.equal(r.creditStatus, 'credit_added');
  assert.equal(log.filter((x) => x.sessionId === 's9').length, 1, 'no duplicate row');
});

test('re-sending the SAME event is idempotent (reverse then re-apply nets zero)', () => {
  const clients = [client2pw()]; clients[0].creditsOwed = 1; const log = [];
  for (let i = 1; i <= 8; i++) record(HAPPENED('s' + i, '2026-06-' + String(i).padStart(2, '0')), clients, log);
  record(HAPPENED('s9', '2026-06-20'), clients, log);   // covered -> 0
  record(HAPPENED('s9', '2026-06-20'), clients, log);   // identical re-send
  assert.equal(clients[0].creditsOwed, 0, 'balance unchanged on idempotent re-send');
  assert.equal(log.filter((x) => x.sessionId === 's9').length, 1);
});

test('no plan frequency -> NO draw, flagged quota_unknown; balance untouched', () => {
  const clients = [{ id: 'c1', phone: '0501234567', sessionsPerWeek: '', creditsOwed: 3 }]; const log = [];
  const r = record(HAPPENED('s1', '2026-06-10'), clients, log);
  assert.equal(r.creditStatus, 'quota_unknown');
  assert.equal(r.clientSessionValue, 500);  // billed normally, not free
  assert.equal(clients[0].creditsOwed, 3);  // never drawn
});

test('no session date -> quota cannot be bucketed -> quota_unknown', () => {
  const clients = [client2pw()]; clients[0].creditsOwed = 2; const log = [];
  const r = record(HAPPENED('s1', ''), clients, log);
  assert.equal(r.creditStatus, 'quota_unknown');
  assert.equal(clients[0].creditsOwed, 2);
});

test('unmatched patient -> no balance to touch, flagged no_client', () => {
  const clients = []; const log = [];
  const r = record({ sessionId: 's1', phone: '0509999999', clinicalTreatmentType: 'פרטני CBT', outcome: 'therapist_cancelled', date: '2026-06-10' }, clients, log);
  assert.equal(r.creditStatus, 'no_client');
});

test('group session never wastes a credit (value 0 is not "covered")', () => {
  const clients = [{ id: 'c1', phone: '0501234567', sessionsPerWeek: JSON.stringify({ 'קבוצה': 1 }), creditsOwed: 5 }]; const log = [];
  for (let i = 1; i <= 4; i++) record({ sessionId: 'g' + i, phone: '0501234567', clinicalTreatmentType: 'קבוצה', outcome: 'happened', date: '2026-06-0' + i }, clients, log);
  const r = record({ sessionId: 'g5', phone: '0501234567', clinicalTreatmentType: 'קבוצה', outcome: 'happened', date: '2026-06-20' }, clients, log);
  assert.equal(r.creditStatus, 'beyond_no_credit'); // beyond quota but value 0 -> no draw
  assert.equal(clients[0].creditsOwed, 5);
});

// ============================================================================
// _saveAll preserve rule — a stale dashboard save never reverts the balance.
// ============================================================================
test('saveAll preserves the on-sheet creditsOwed by id, ignoring the payload value', () => {
  const existing = [{ id: 'c1', creditsOwed: 4 }, { id: 'c2', creditsOwed: 0 }];
  const payload = [{ id: 'c1', name: 'x', creditsOwed: 0 }, { id: 'c2', name: 'y', creditsOwed: 99 }, { id: 'c3', name: 'new', creditsOwed: 7 }];
  const out = saveAllPreserve(existing, payload);
  assert.equal(out.find((c) => c.id === 'c1').creditsOwed, 4);  // preserved, not the stale 0
  assert.equal(out.find((c) => c.id === 'c2').creditsOwed, 0);  // preserved
  assert.equal(out.find((c) => c.id === 'c3').creditsOwed, 7);  // brand-new keeps payload/default
});

// ============================================================================
// Positional safety for the new columns.
// ============================================================================
test('Clients.creditsOwed round-trips positionally (frozen physical order: last of the payment tail); legacy blank -> 0', () => {
  // FROZEN 2026-07-06 physical order: creditsOwed is the LAST of the payment tail
  // (paymentStatus/paymentDate/nextBillingDate/creditsOwed) that sits directly after
  // phone, immediately before the physically-unwritten volta-only columns.
  assert.equal(CLIENTS_H[CLIENTS_H.indexOf('nextBillingDate') + 1], 'creditsOwed');
  assert.equal(CLIENTS_H[CLIENTS_H.indexOf('creditsOwed') + 1], 'clinicalTreatmentType');
  assert.deepEqual(CLIENTS_H.slice(-6), ['clinicalTreatmentType', 'packageChangeDate', 'assignedTo', 'paymentAmountOverrides', 'updatedAt', 'updatedBy']);
  const row = writeRow(CLIENTS_H, { id: 'c1', phone: '0501234567', clinicalTreatmentType: 'פרטני CBT', creditsOwed: 3 });
  assert.equal(row[CLIENTS_H.indexOf('creditsOwed')], 3);
  assert.equal(row[CLIENTS_H.indexOf('clinicalTreatmentType')], 'פרטני CBT'); // not shifted
  const back = readRow(CLIENTS_H, row);
  assert.equal(back.creditsOwed, 3);
  // a legacy row with the trailing cell blank -> toCredits coerces to 0
  const legacy = writeRow(CLIENTS_H, { id: 'c2', phone: '0501234567' });
  assert.equal(toCredits(readRow(CLIENTS_H, legacy).creditsOwed), 0);
});

test('SessionLog.creditStatus round-trips positionally (now second-to-last, before forwardedToPayroll)', () => {
  assert.equal(LOG_H[LOG_H.length - 1], 'forwardedToPayroll');
  assert.equal(LOG_H[LOG_H.length - 2], 'creditStatus');
  const clients = [client2pw()]; clients[0].creditsOwed = 1; const log = [];
  for (let i = 1; i <= 8; i++) record(HAPPENED('s' + i, '2026-06-' + String(i).padStart(2, '0')), clients, log);
  record(HAPPENED('s9', '2026-06-20'), clients, log);
  const covered = log.find((r) => r.sessionId === 's9');
  const row = writeRow(LOG_H, covered);
  assert.equal(row[LOG_H.indexOf('creditStatus')], 'covered');
  assert.equal(row[LOG_H.indexOf('clientSessionValue')], 0);
  assert.equal(row[LOG_H.indexOf('recordedAt')], ''); // mirror omits it -> blank, still aligned
});

// ============================================================================
// Source-scan guard — the real engine in Code.gs can't silently drift.
// ============================================================================
test('wiring guard: Code.gs has the credit engine pieces', () => {
  assert.ok(/function _planWeeklyFrequency\(/.test(GS), '_planWeeklyFrequency missing');
  assert.ok(/function _toCredits\(/.test(GS), '_toCredits missing');
  assert.ok(/function _monthKey\(/.test(GS), '_monthKey missing');
  // reversal-on-upsert
  assert.ok(/creditStatus\) === 'covered'\)\s*balance \+= 1/.test(GS), 'covered-reversal missing');
  assert.ok(/=== 'therapist_cancelled'\)\s*balance -= 1/.test(GS), 'cancel-reversal missing');
  // draw
  assert.ok(/rowObj\.creditStatus = 'covered'/.test(GS), 'covered draw missing');
  // _saveAll preserves the balance by id
  assert.ok(/existingCredits/.test(GS), '_saveAll preserve-by-id missing');
});
