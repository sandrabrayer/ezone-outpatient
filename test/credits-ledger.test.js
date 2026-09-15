'use strict';

/**
 * Coverage for the credits / refunds ledger — the MONEY-ONLY port of the
 * E-Zone-Dashboard credits ledger (PR #124). Three layers:
 *
 *   1. The CALCULATION (public/credits-ledger.js, imported directly): coverage
 *      windows, the ÷30 daily rate, the amountPaid cap, prepaid_return,
 *      overlapping windows, zero rows, and the OUTPATIENT POLICY — pro-rata at
 *      ANY tenure, with no 14-day cutoff and no last-7-days rule.
 *
 *   2. The WRITE (_upsertCredit in apps-script/Code.gs). Code.gs cannot be
 *      require()d in Node, so the validator is mirrored below as a pure
 *      function over an in-memory rows array, with SOURCE-SCAN GUARDS that
 *      parse the real CREDIT_COLUMNS / CREDIT_TYPES / CREDIT_STATUSES /
 *      CREDIT_PAYOUT_DAY out of Code.gs and assert they match — the mirror
 *      cannot silently drift (the discipline used by session-outcome.test.js
 *      and payout-forwarding.test.js).
 *
 *   3. SCOPE + SECURITY guards: the ledger touches no session logic, adds no
 *      server.js route, and never trusts a client-supplied user.
 *
 * Dates are exercised at month boundaries, across both DST switches and on
 * 28/30/31-day months. Run with:  npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CL = require('../public/credits-ledger');

const ROOT = path.join(__dirname, '..');
const GS = fs.readFileSync(path.join(ROOT, 'apps-script', 'Code.gs'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

// --- helpers ---------------------------------------------------------------

/** Parse a `var NAME = [ ... ];` array-of-strings literal out of Code.gs. */
function parseArrayLiteral(name) {
  const m = GS.match(new RegExp('var\\s+' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\];'));
  assert.ok(m, name + ' literal not found in Code.gs');
  return m[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^['"]|['"]$/g, ''));
}

/** A top-level function's source, from its `function NAME(` to its closing
 *  brace at column 0. Used to scope source-scan guards to one function. */
function extractFunction(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' not found');
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, name + ' has no closing brace at column 0');
  return src.slice(start, end + 3);
}

function client(over) {
  return Object.assign({ id: 'c1', name: 'דנה', startDate: '2026-01-10' }, over || {});
}
function payment(over) {
  return Object.assign(
    { id: 'p1', clientId: 'c1', dueDate: '2026-03-01', amountDue: 3000, amountPaid: 3000 },
    over || {}
  );
}
function byType(list, type) {
  return list.filter((c) => c.creditType === type);
}

// ============================================================================
// 1. Source-scan guards — the Code.gs half cannot silently disappear or drift
// ============================================================================

test('Code.gs defines the credits ledger write path', () => {
  assert.ok(/var CREDITS_SHEET = 'Credits';/.test(GS), 'CREDITS_SHEET missing');
  assert.ok(/function _getCredits\(/.test(GS), '_getCredits missing');
  assert.ok(/function _upsertCredit\(/.test(GS), '_upsertCredit missing');
  assert.ok(/function _creditId\(/.test(GS), '_creditId missing');
  assert.ok(/function _payoutDateFor\(/.test(GS), '_payoutDateFor missing');
  assert.ok(/function _ensureCreditsSheet\(/.test(GS), '_ensureCreditsSheet missing');
});

test('CREDIT_COLUMNS is the pinned 21-column contract, clientId single-keyed', () => {
  const cols = parseArrayLiteral('CREDIT_COLUMNS');
  assert.deepEqual(cols, [
    'id', 'clientId', 'clientName', 'creditType', 'allocationMonth',
    'calculatedAmount', 'amount', 'overrideReason', 'reason', 'approvedBy',
    'decidedDate', 'payoutDate', 'status', 'paidDate', 'method', 'notes',
    'basis', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'
  ]);
  assert.equal(cols.length, 21);
  // The Dashboard's dual identity columns collapsed to ONE real key here.
  assert.ok(!cols.includes('patientId'), 'patientId must not survive the port');
  assert.ok(!cols.includes('patientKey'), 'patientKey must not survive the port');
  // Residential/detox bed concepts have no place in outpatient.
  assert.ok(!cols.includes('houseId'), 'houseId must not survive the port');
  assert.ok(!cols.includes('facilityType'), 'facilityType must not survive the port');
});

test('CREDIT_TYPES / CREDIT_STATUSES / payout day match the client module', () => {
  assert.deepEqual(parseArrayLiteral('CREDIT_TYPES'), CL.CREDIT_TYPES);
  assert.deepEqual(parseArrayLiteral('CREDIT_STATUSES'), CL.CREDIT_STATUSES);
  const day = GS.match(/var CREDIT_PAYOUT_DAY = (\d+);/);
  assert.ok(day, 'CREDIT_PAYOUT_DAY missing from Code.gs');
  assert.equal(Number(day[1]), CL.CREDIT_PAYOUT_DAY);
  assert.equal(CL.CREDIT_PAYOUT_DAY, 15);
});

test('editable columns are the only mutable ones; the computed figure is not', () => {
  const editable = parseArrayLiteral('CREDIT_EDITABLE_COLUMNS');
  assert.deepEqual(editable, [
    'amount', 'overrideReason', 'approvedBy', 'decidedDate', 'status',
    'paidDate', 'method', 'notes'
  ]);
  ['calculatedAmount', 'reason', 'basis', 'clientId', 'creditType',
    'allocationMonth', 'createdAt', 'createdBy', 'payoutDate'].forEach((col) => {
    assert.ok(!editable.includes(col), col + ' must stay immutable on edit');
  });
});

test('text-forced columns cover every date/month cell Sheets would coerce', () => {
  const text = parseArrayLiteral('CREDIT_TEXT_COLUMNS');
  ['allocationMonth', 'decidedDate', 'payoutDate', 'paidDate', 'createdAt', 'updatedAt']
    .forEach((col) => assert.ok(text.includes(col), col + ' must be text-forced'));
});

// ============================================================================
// 2. The divisor, the cap and the payout date
// ============================================================================

test('the daily rate is amountPaid ÷ 30 regardless of month length', () => {
  assert.equal(CL.CREDIT_DAYS_DIVISOR, 30);
  // February (28 days) and August (31 days), same money, same exit offset.
  const feb = CL.suggestCredits(client(), '2026-02-10',
    [payment({ dueDate: '2026-02-01', amountPaid: 3000 })]);
  const aug = CL.suggestCredits(client(), '2026-08-10',
    [payment({ dueDate: '2026-08-01', amountPaid: 3000 })]);
  assert.equal(byType(feb, 'days_unused')[0].basis.dailyRate, 100);
  assert.equal(byType(aug, 'days_unused')[0].basis.dailyRate, 100);
});

test('applyCreditCap never credits more than was received, and records it', () => {
  assert.deepEqual(CL.applyCreditCap(3100, 3000), { calculatedAmount: 3000, capped: true });
  assert.deepEqual(CL.applyCreditCap(500, 3000), { calculatedAmount: 500, capped: false });
  assert.deepEqual(CL.applyCreditCap(10, 0), { calculatedAmount: 0, capped: true });
});

test('payoutDateFor is the 15th of the next month on or after the decision', () => {
  assert.equal(CL.payoutDateFor('2026-03-14'), '2026-03-15');  // before -> this month
  assert.equal(CL.payoutDateFor('2026-03-15'), '2026-03-15');  // on -> same day
  assert.equal(CL.payoutDateFor('2026-03-16'), '2026-04-15');  // after -> next month
  assert.equal(CL.payoutDateFor('2026-12-20'), '2027-01-15');  // across the year end
  assert.equal(CL.payoutDateFor('2026-12-15'), '2026-12-15');
  assert.equal(CL.payoutDateFor(''), '');
  assert.equal(CL.payoutDateFor('not-a-date'), '');
});

// ============================================================================
// 3. days_unused — the coverage window
// ============================================================================

test('mid-window exit credits only the days strictly after it', () => {
  // Window 2026-03-01 → 2026-03-31, exit on the 10th: the 11th–31st = 21 days.
  const out = CL.suggestCredits(client(), '2026-03-10',
    [payment({ dueDate: '2026-03-01', amountPaid: 3000 })]);
  const row = byType(out, 'days_unused')[0];
  assert.equal(row.basis.coverageStart, '2026-03-01');
  assert.equal(row.basis.coverageEnd, '2026-03-31');
  assert.equal(row.basis.unusedDays, 21);
  assert.equal(row.basis.creditedFrom, '2026-03-11');
  assert.equal(row.calculatedAmount, 2100);      // 100/day × 21
  assert.equal(row.allocationMonth, '2026-03');
  assert.equal(row.basis.rule, 'prorata');
});

test('a billing day of 20 spills the unused days into the next month', () => {
  // Window 2026-08-20 → 2026-09-19; exit on 2026-09-05 -> the 6th–19th = 14 days.
  const out = CL.suggestCredits(client(), '2026-09-05',
    [payment({ dueDate: '2026-08-20', amountPaid: 3000 })]);
  const row = byType(out, 'days_unused')[0];
  assert.equal(row.basis.coverageEnd, '2026-09-19');
  assert.equal(row.basis.unusedDays, 14);
  assert.equal(row.calculatedAmount, 1400);
  assert.equal(row.allocationMonth, '2026-08');   // reporting metadata, not the math
});

test('a window that ended before the exit is fully used and credits nothing', () => {
  const out = CL.suggestCredits(client(), '2026-06-10',
    [payment({ dueDate: '2026-03-01', amountPaid: 3000 })]);
  const rows = byType(out, 'days_unused');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].calculatedAmount, 0);
  assert.equal(rows[0].basis.classification, 'no_unused_window');
  assert.equal(rows[0].basis.coverageSource, 'payment');
});

test('the dueDate day itself is clamped into short months', () => {
  // 2026-01-31 + 1 month clamps to Feb 28 (2026 is not a leap year).
  const cov = CL.paymentCoverage({ dueDate: '2026-01-31' });
  assert.equal(CL.isoFromLocalDate(cov.end), '2026-02-27');
});

test('a 0-amount payment row credits 0 but is still a row', () => {
  const out = CL.suggestCredits(client(), '2026-03-10',
    [payment({ dueDate: '2026-03-01', amountPaid: 0 })]);
  const row = byType(out, 'days_unused')[0];
  assert.equal(row.calculatedAmount, 0);
  assert.equal(row.basis.unusedDays, 21);         // the days are real; the money is not
  assert.equal(row.basis.dailyRate, 0);
});

test('a partial payment rates from amountPaid, not the billed amount', () => {
  const out = CL.suggestCredits(client(), '2026-03-10',
    [payment({ dueDate: '2026-03-01', amountDue: 3000, amountPaid: 1500 })]);
  const row = byType(out, 'days_unused')[0];
  assert.equal(row.basis.dailyRate, 50);
  assert.equal(row.calculatedAmount, 1050);       // 50 × 21
  assert.equal(row.basis.billedAmount, 3000);     // recorded, never used in the math
});

// ============================================================================
// 4. prepaid_return — the whole window is after the exit
// ============================================================================

test('a window starting after the exit returns the FULL amountPaid', () => {
  const out = CL.suggestCredits(client(), '2026-03-10',
    [payment({ id: 'p2', dueDate: '2026-04-01', amountPaid: 3000 })]);
  const row = byType(out, 'prepaid_return')[0];
  assert.equal(row.calculatedAmount, 3000);
  assert.equal(row.basis.fullReturn, true);
  assert.equal(row.basis.classification, 'window_after_exit');
  assert.equal(row.allocationMonth, '2026-04');
});

test('prepaid_return is the full amountPaid, NOT rate × windowDays', () => {
  // A 31-day window: ÷30 × 31 would be 3100, more than was ever received.
  const out = CL.suggestCredits(client(), '2026-07-10',
    [payment({ dueDate: '2026-08-01', amountPaid: 3000 })]);
  const row = byType(out, 'prepaid_return')[0];
  assert.equal(row.basis.windowDays, 31);
  assert.equal(row.basis.uncappedAmount, 3100);   // the ÷30 raw is kept on record
  assert.equal(row.basis.capped, true);
  assert.equal(row.calculatedAmount, 3000);       // but only what was received returns
});

test('a row due in the exit month whose window starts after the exit is prepaid_return', () => {
  const out = CL.suggestCredits(client(), '2026-03-05',
    [payment({ dueDate: '2026-03-20', amountPaid: 3000 })]);
  assert.equal(byType(out, 'prepaid_return').length, 1);
  assert.equal(byType(out, 'prepaid_return')[0].calculatedAmount, 3000);
});

test('a days_unused row and a prepaid_return row can coexist for one exit', () => {
  const out = CL.suggestCredits(client(), '2026-03-10', [
    payment({ id: 'p1', dueDate: '2026-03-01', amountPaid: 3000 }),
    payment({ id: 'p2', dueDate: '2026-04-01', amountPaid: 3000 })
  ]);
  assert.equal(byType(out, 'days_unused').length, 1);
  assert.equal(byType(out, 'prepaid_return').length, 1);
  assert.equal(byType(out, 'days_unused')[0].calculatedAmount, 2100);
  assert.equal(byType(out, 'prepaid_return')[0].calculatedAmount, 3000);
});

// ============================================================================
// 5. Overlapping windows never credit the same day twice
// ============================================================================

test('overlapping windows credit only days an earlier window did not', () => {
  // Two overlapping windows that BOTH start on or before the exit (so both are
  // days_unused): 03-01→03-31 and 03-08→04-07, exit 03-10.
  // The first credits 03-11→03-31 (21 days); the second may only credit what is
  // left, 04-01→04-07 (7 days) — never the days the first already took.
  const out = CL.suggestCredits(client(), '2026-03-10', [
    payment({ id: 'p1', dueDate: '2026-03-01', amountPaid: 3000 }),
    payment({ id: 'p2', dueDate: '2026-03-08', amountPaid: 3000 })
  ]);
  const rows = byType(out, 'days_unused');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].basis.unusedDays, 21);
  assert.equal(rows[0].basis.alreadyCreditedThrough, '');
  assert.equal(rows[1].basis.coverageEnd, '2026-04-07');
  assert.equal(rows[1].basis.alreadyCreditedThrough, '2026-03-31');
  assert.equal(rows[1].basis.creditedFrom, '2026-04-01');
  assert.equal(rows[1].basis.unusedDays, 7);
  assert.equal(rows[1].calculatedAmount, 700);
  // No day is counted twice: 21 + 7 = the 03-11 → 04-07 span exactly.
  assert.equal(rows[0].basis.unusedDays + rows[1].basis.unusedDays, 28);
});

test('a window starting between the exit and the first window end is prepaid_return', () => {
  // 03-15 is AFTER the 03-10 exit, so classification is by the window: the whole
  // of it is unearned, whatever the earlier row's window already covered.
  const out = CL.suggestCredits(client(), '2026-03-10', [
    payment({ id: 'p1', dueDate: '2026-03-01', amountPaid: 3000 }),
    payment({ id: 'p2', dueDate: '2026-03-15', amountPaid: 3000 })
  ]);
  assert.equal(byType(out, 'days_unused').length, 1);
  assert.equal(byType(out, 'days_unused')[0].calculatedAmount, 2100);
  assert.equal(byType(out, 'prepaid_return').length, 1);
  assert.equal(byType(out, 'prepaid_return')[0].calculatedAmount, 3000);
});

test('a fully-swallowed later window credits 0 days, not a duplicate', () => {
  const out = CL.suggestCredits(client(), '2026-03-10', [
    payment({ id: 'p1', dueDate: '2026-03-01', amountPaid: 3000 }),
    payment({ id: 'p2', dueDate: '2026-03-05', amountPaid: 3000 })
  ]);
  const rows = byType(out, 'days_unused');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].basis.unusedDays, 21);   // 03-11 → 03-31
  assert.equal(rows[1].basis.unusedDays, 4);    // 04-01 → 04-04 only
  assert.equal(rows[1].basis.alreadyCreditedThrough, '2026-03-31');
});

// ============================================================================
// 6. Zero rows — "no refund owed" is a decision, not silence
// ============================================================================

test('no payment rows at all still yields ONE zero days_unused row', () => {
  const out = CL.suggestCredits(client(), '2026-03-10', []);
  assert.equal(out.length, 1);
  assert.equal(out[0].creditType, 'days_unused');
  assert.equal(out[0].calculatedAmount, 0);
  assert.equal(out[0].allocationMonth, '2026-03');
  assert.equal(out[0].basis.coverageSource, 'calendar_month');
  assert.equal(out[0].basis.classification, 'no_unused_window');
  assert.equal(out[0].basis.unusedDays, 21);   // the calendar days, with nothing received
});

test('a prepaid_return-only exit still carries a zero days_unused row', () => {
  const out = CL.suggestCredits(client(), '2026-03-10',
    [payment({ dueDate: '2026-04-01', amountPaid: 3000 })]);
  assert.equal(byType(out, 'days_unused').length, 1);
  assert.equal(byType(out, 'days_unused')[0].calculatedAmount, 0);
  assert.equal(byType(out, 'prepaid_return').length, 1);
});

test('payments belonging to another client are ignored entirely', () => {
  const out = CL.suggestCredits(client(), '2026-03-10', [
    payment({ id: 'other', clientId: 'c2', dueDate: '2026-03-01', amountPaid: 9999 })
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].calculatedAmount, 0);
  assert.equal(out[0].basis.coverageSource, 'calendar_month');
});

// ============================================================================
// 7. POLICY — outpatient is pro-rata only (the ported rules are ABSENT)
// ============================================================================

test('NO detox tenure cutoff: a long tenure still credits pro-rata', () => {
  // The Dashboard would zero this at ≥14 days for a detox house. Outpatient
  // has no beds and no such rule.
  const long = CL.suggestCredits(client({ startDate: '2025-01-01' }), '2026-03-10',
    [payment({ dueDate: '2026-03-01', amountPaid: 3000 })]);
  const short = CL.suggestCredits(client({ startDate: '2026-03-02' }), '2026-03-10',
    [payment({ dueDate: '2026-03-01', amountPaid: 3000 })]);
  assert.equal(byType(long, 'days_unused')[0].calculatedAmount, 2100);
  assert.equal(byType(short, 'days_unused')[0].calculatedAmount, 2100);
  assert.equal(byType(long, 'days_unused')[0].basis.rule, 'prorata');
});

test('tenure at 13 / 14 / 15 days makes no difference to the credit', () => {
  const amounts = ['2026-03-23', '2026-03-24', '2026-03-25'].map((startDate) =>
    byType(CL.suggestCredits(client({ startDate }), '2026-04-06',
      [payment({ dueDate: '2026-04-01', amountPaid: 3000 })]), 'days_unused')[0].calculatedAmount);
  assert.deepEqual(amounts, [2400, 2400, 2400]);   // 100/day × 24 days, every time
});

test('NO last-7-days rule: an exit late in the month still credits', () => {
  // 28-, 30- and 31-day months, each with an exit inside the Dashboard's
  // last-7-days window. All credit normally here.
  const feb = byType(CL.suggestCredits(client(), '2026-02-25',
    [payment({ dueDate: '2026-02-01', amountPaid: 3000 })]), 'days_unused')[0];
  const apr = byType(CL.suggestCredits(client(), '2026-04-27',
    [payment({ dueDate: '2026-04-01', amountPaid: 3000 })]), 'days_unused')[0];
  const may = byType(CL.suggestCredits(client(), '2026-05-28',
    [payment({ dueDate: '2026-05-01', amountPaid: 3000 })]), 'days_unused')[0];
  assert.equal(feb.calculatedAmount, 300);   // 02-26 → 02-28 = 3 days
  assert.equal(apr.calculatedAmount, 300);   // 04-28 → 04-30 = 3 days
  assert.equal(may.calculatedAmount, 300);   // 05-29 → 05-31 = 3 days
  [feb, apr, may].forEach((r) => assert.equal(r.basis.rule, 'prorata'));
});

test('the ported bed-rule constants are absent from both halves of the port', () => {
  const ledger = fs.readFileSync(path.join(ROOT, 'public', 'credits-ledger.js'), 'utf8');
  [ledger, GS].forEach((src) => {
    assert.ok(!/CREDIT_DETOX_TENURE_CUTOFF_DAYS/.test(src), 'detox cutoff must not be ported');
    assert.ok(!/CREDIT_RESIDENTIAL_LAST_DAYS/.test(src), 'last-7-days rule must not be ported');
    assert.ok(!/FACILITY_TYPE_BY_HOUSE/.test(src), 'facility map must not be ported');
  });
  assert.equal(CL.CREDIT_DETOX_TENURE_CUTOFF_DAYS, undefined);
  assert.equal(CL.CREDIT_RESIDENTIAL_LAST_DAYS, undefined);
});

// ============================================================================
// 8. Dates — timezone, month boundaries, DST
// ============================================================================

test('a full ISO timestamp exit is read as its local date, not shifted back', () => {
  // A naive Date.parse of the bare date would land on Aug 31 21:00 UTC = Sep 1
  // in Israel. isoDate takes the date parts as written.
  assert.equal(CL.isoDate('2026-09-01T00:00:00.000Z'), '2026-09-01');
  assert.equal(CL.isoDate('2026-03-10'), '2026-03-10');
  assert.equal(CL.isoDate(''), '');
  const out = CL.suggestCredits(client(), '2026-09-01T06:00:00.000Z',
    [payment({ dueDate: '2026-08-01', amountPaid: 3000 })]);
  // August window 08-01 → 08-31 ended before a Sep 1 exit: nothing to credit.
  assert.equal(byType(out, 'days_unused')[0].calculatedAmount, 0);
});

test('day spans are exact across both DST switches', () => {
  // Israel springs forward in late March and falls back in late October.
  const march = byType(CL.suggestCredits(client(), '2026-03-20',
    [payment({ dueDate: '2026-03-01', amountPaid: 3000 })]), 'days_unused')[0];
  assert.equal(march.basis.unusedDays, 11);   // 03-21 → 03-31
  const october = byType(CL.suggestCredits(client(), '2026-10-20',
    [payment({ dueDate: '2026-10-01', amountPaid: 3000 })]), 'days_unused')[0];
  assert.equal(october.basis.unusedDays, 11); // 10-21 → 10-31
});

test('an exit on the last day of the window credits nothing for that window', () => {
  const out = CL.suggestCredits(client(), '2026-03-31',
    [payment({ dueDate: '2026-03-01', amountPaid: 3000 })]);
  assert.equal(byType(out, 'days_unused')[0].calculatedAmount, 0);
  assert.equal(byType(out, 'days_unused')[0].basis.classification, 'no_unused_window');
});

test('an exit on the first day of the window credits all but that day', () => {
  const out = CL.suggestCredits(client(), '2026-03-01',
    [payment({ dueDate: '2026-03-01', amountPaid: 3000 })]);
  const row = byType(out, 'days_unused')[0];
  assert.equal(row.basis.unusedDays, 30);   // 03-02 → 03-31
  assert.equal(row.calculatedAmount, 3000); // 100 × 30, exactly at the cap
});

test('no exit date, or an unusable one, suggests nothing at all', () => {
  assert.deepEqual(CL.suggestCredits(client(), '', []), []);
  assert.deepEqual(CL.suggestCredits(client(), 'nope', []), []);
  assert.deepEqual(CL.suggestCredits(null, '2026-03-10', []), []);
});

// ============================================================================
// 9. The write path — mirror of _upsertCredit, guarded against drift
// ============================================================================

const CREDIT_COLUMNS = parseArrayLiteral('CREDIT_COLUMNS');
const CREDIT_EDITABLE_COLUMNS = parseArrayLiteral('CREDIT_EDITABLE_COLUMNS');

function creditStr(v, max) {
  return String(v == null ? '' : v).replace(/[<> -]/g, '').trim().slice(0, max);
}
function creditAmount(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}
function creditDate(v) {
  if (v === undefined || v === null || v === '') return '';
  const iso = CL.isoDate(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

/** Pure mirror of _upsertCredit over an in-memory rows array. */
function upsertCredit(credit, user, rows, nowIso, todayISO) {
  if (!credit || typeof credit !== 'object') return { res: { ok: false, error: 'missing_credit' }, rows };
  const stampUser = String(user == null ? '' : user);
  const wantId = creditStr(credit.id, 200);
  let record, targetIdx = -1;

  if (wantId) {
    const idx = rows.findIndex((r) => String(r.id) === wantId);
    if (idx < 0) return { res: { ok: false, error: 'unknown_credit', id: wantId }, rows };
    const sheetObj = rows[idx];
    const seenStamp = creditStr(credit.updatedAt, 60);
    const sheetStamp = creditStr(sheetObj.updatedAt, 60);
    if (sheetStamp !== '' && seenStamp !== '' && seenStamp !== sheetStamp) {
      return {
        res: {
          ok: false, error: 'conflict',
          conflicts: [{
            id: wantId, name: String(sheetObj.clientName || ''),
            clientId: String(sheetObj.clientId || ''),
            sheetUpdatedAt: sheetStamp, sheetUpdatedBy: String(sheetObj.updatedBy || '')
          }]
        },
        rows
      };
    }
    record = Object.assign({}, sheetObj);
    CREDIT_EDITABLE_COLUMNS.forEach((col) => {
      if (credit[col] !== undefined) record[col] = credit[col];
    });
    targetIdx = idx;
  } else {
    record = Object.assign({}, credit);
    record.createdAt = nowIso;
    record.createdBy = stampUser;
    record.basis = typeof credit.basis === 'string' ? credit.basis : JSON.stringify(credit.basis || {});
  }

  const clientId = creditStr(record.clientId, 200);
  const month = creditStr(record.allocationMonth, 7);
  const creditType = creditStr(record.creditType, 40);
  const status = creditStr(record.status, 20) || 'pending';
  if (!clientId) return { res: { ok: false, error: 'missing_clientId' }, rows };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { res: { ok: false, error: 'bad_month' }, rows };
  if (CL.CREDIT_TYPES.indexOf(creditType) < 0) return { res: { ok: false, error: 'bad_creditType' }, rows };
  if (CL.CREDIT_STATUSES.indexOf(status) < 0) return { res: { ok: false, error: 'bad_status' }, rows };

  const calculated = creditAmount(record.calculatedAmount);
  const amount = creditAmount(
    (record.amount === undefined || record.amount === '') ? record.calculatedAmount : record.amount);
  if (calculated === null || amount === null) return { res: { ok: false, error: 'bad_amount' }, rows };

  const overrideReason = creditStr(record.overrideReason, 300);
  const reason = creditStr(record.reason, 1000);
  if (amount !== calculated && !overrideReason) {
    return { res: { ok: false, error: 'override_reason_required' }, rows };
  }
  if (creditType === 'other' && !reason) return { res: { ok: false, error: 'reason_required' }, rows };

  const decidedRaw = creditDate(record.decidedDate);
  if (decidedRaw === null) return { res: { ok: false, error: 'bad_decidedDate' }, rows };
  const decidedDate = decidedRaw || todayISO;
  const paidDate = creditDate(record.paidDate);
  if (paidDate === null) return { res: { ok: false, error: 'bad_paidDate' }, rows };
  const method = creditStr(record.method, 40);
  if (status === 'paid' && (!paidDate || !method)) {
    return { res: { ok: false, error: 'paid_requires_paidDate_method' }, rows };
  }

  const out = {
    id: wantId,
    clientId, clientName: creditStr(record.clientName, 120),
    creditType, allocationMonth: month,
    calculatedAmount: calculated, amount,
    overrideReason: amount !== calculated ? overrideReason : '',
    reason, approvedBy: creditStr(record.approvedBy, 40),
    decidedDate, payoutDate: CL.payoutDateFor(decidedDate),
    status, paidDate: status === 'paid' ? paidDate : '',
    method, notes: creditStr(record.notes, 500),
    basis: String(record.basis == null ? '' : record.basis).slice(0, 4000),
    createdAt: String(record.createdAt || nowIso),
    createdBy: String(record.createdBy == null ? '' : record.createdBy),
    updatedAt: nowIso, updatedBy: stampUser
  };

  const next = rows.slice();
  if (targetIdx < 0) {
    let seq = 1;
    rows.forEach((r) => {
      if (String(r.clientId) === clientId && String(r.allocationMonth) === month) seq++;
    });
    out.id = 'credit::' + clientId + '::' + month + '::' + seq;
    next.push(out);
  } else {
    next[targetIdx] = out;
  }
  return { res: { ok: true, credit: out, [targetIdx < 0 ? 'created' : 'updated']: true }, rows: next };
}

const NOW = '2026-03-12T09:00:00.000Z';
const TODAY = '2026-03-12';
function newCredit(over) {
  return Object.assign({
    clientId: 'c1', clientName: 'דנה', creditType: 'days_unused',
    allocationMonth: '2026-03', calculatedAmount: 2100, amount: 2100,
    reason: 'trail', decidedDate: '2026-03-12', status: 'pending',
    basis: { rule: 'prorata', unusedDays: 21 }
  }, over || {});
}

test('create mints a server-side id with a per-client-month sequence', () => {
  let rows = [];
  let r = upsertCredit(newCredit(), 'ורד', rows, NOW, TODAY);
  assert.equal(r.res.ok, true);
  assert.equal(r.res.credit.id, 'credit::c1::2026-03::1');
  rows = r.rows;
  r = upsertCredit(newCredit({ creditType: 'other', reason: 'ידני' }), 'ורד', rows, NOW, TODAY);
  assert.equal(r.res.credit.id, 'credit::c1::2026-03::2');
  // A different month restarts the sequence.
  r = upsertCredit(newCredit({ allocationMonth: '2026-04' }), 'ורד', r.rows, NOW, TODAY);
  assert.equal(r.res.credit.id, 'credit::c1::2026-04::1');
});

test('an id the client mints itself is refused — it never existed', () => {
  const r = upsertCredit(newCredit({ id: 'credit::c1::2026-03::99' }), 'ורד', [], NOW, TODAY);
  assert.deepEqual(r.res, { ok: false, error: 'unknown_credit', id: 'credit::c1::2026-03::99' });
});

test('payoutDate is derived server-side; a forged payload value is ignored', () => {
  const r = upsertCredit(newCredit({ payoutDate: '2026-01-01', decidedDate: '2026-03-16' }),
    'ורד', [], NOW, TODAY);
  assert.equal(r.res.credit.payoutDate, '2026-04-15');
});

test('a blank decidedDate defaults to today; an unparseable one is refused', () => {
  assert.equal(upsertCredit(newCredit({ decidedDate: '' }), 'ורד', [], NOW, TODAY).res.credit.decidedDate, TODAY);
  assert.equal(upsertCredit(newCredit({ decidedDate: 'לא תאריך' }), 'ורד', [], NOW, TODAY).res.error, 'bad_decidedDate');
});

test('stamps come from the caller-supplied user, never from the payload', () => {
  const r = upsertCredit(newCredit({ createdBy: 'מזייף', updatedBy: 'מזייף' }), 'ורד', [], NOW, TODAY);
  assert.equal(r.res.credit.createdBy, 'ורד');
  assert.equal(r.res.credit.updatedBy, 'ורד');
  assert.equal(r.res.credit.createdAt, NOW);
});

test('an override needs a reason; with one, calculatedAmount is untouched', () => {
  assert.equal(
    upsertCredit(newCredit({ amount: 1000 }), 'ורד', [], NOW, TODAY).res.error,
    'override_reason_required');
  const ok = upsertCredit(newCredit({ amount: 1000, overrideReason: 'הוסכם עם המטופל' }),
    'ורד', [], NOW, TODAY);
  assert.equal(ok.res.credit.amount, 1000);
  assert.equal(ok.res.credit.calculatedAmount, 2100);   // the computed figure survives
  assert.equal(ok.res.credit.overrideReason, 'הוסכם עם המטופל');
});

test('an equal amount clears any override reason that came along', () => {
  const r = upsertCredit(newCredit({ amount: 2100, overrideReason: 'מיותר' }), 'ורד', [], NOW, TODAY);
  assert.equal(r.res.credit.overrideReason, '');
});

test('a zero credit is a valid, stored decision', () => {
  const r = upsertCredit(newCredit({ calculatedAmount: 0, amount: 0 }), 'ורד', [], NOW, TODAY);
  assert.equal(r.res.ok, true);
  assert.equal(r.res.credit.amount, 0);
});

test('bad creditType / status / month / amount / clientId are all refused', () => {
  const cases = [
    [{ creditType: 'refund' }, 'bad_creditType'],
    [{ status: 'approved' }, 'bad_status'],
    [{ allocationMonth: '2026-13' }, 'bad_month'],
    [{ allocationMonth: '2026/03' }, 'bad_month'],
    [{ allocationMonth: '26-3' }, 'bad_month'],
    [{ allocationMonth: '' }, 'bad_month'],
    [{ calculatedAmount: -5, amount: -5 }, 'bad_amount'],
    [{ calculatedAmount: 'abc', amount: 'abc' }, 'bad_amount'],
    [{ clientId: '' }, 'missing_clientId']
  ];
  cases.forEach(([over, error]) => {
    assert.equal(upsertCredit(newCredit(over), 'ורד', [], NOW, TODAY).res.error, error,
      'expected ' + error + ' for ' + JSON.stringify(over));
  });
});

test('a full ISO date in allocationMonth is taken as its month, not refused', () => {
  // The 7-char cap makes 'YYYY-MM-DD' resolve to its own 'YYYY-MM' — the only
  // reading a caller passing a date could mean. Documented, not accidental.
  const r = upsertCredit(newCredit({ allocationMonth: '2026-03-01' }), 'ורד', [], NOW, TODAY);
  assert.equal(r.res.ok, true);
  assert.equal(r.res.credit.allocationMonth, '2026-03');
  assert.equal(r.res.credit.id, 'credit::c1::2026-03::1');
});

test("'other' requires a reason", () => {
  assert.equal(upsertCredit(newCredit({ creditType: 'other', reason: '' }), 'ורד', [], NOW, TODAY).res.error,
    'reason_required');
  assert.equal(upsertCredit(newCredit({ creditType: 'other', reason: 'החלטת הנהלה' }), 'ורד', [], NOW, TODAY).res.ok,
    true);
});

test("marking paid is explicit: paidDate AND method are both required", () => {
  assert.equal(upsertCredit(newCredit({ status: 'paid' }), 'ורד', [], NOW, TODAY).res.error,
    'paid_requires_paidDate_method');
  assert.equal(upsertCredit(newCredit({ status: 'paid', paidDate: '2026-03-15' }), 'ורד', [], NOW, TODAY).res.error,
    'paid_requires_paidDate_method');
  const ok = upsertCredit(newCredit({ status: 'paid', paidDate: '2026-03-15', method: 'העברה' }),
    'ורד', [], NOW, TODAY);
  assert.equal(ok.res.credit.paidDate, '2026-03-15');
  assert.equal(ok.res.credit.method, 'העברה');
});

test('a non-paid status carries no paidDate, so un-paying clears it', () => {
  let r = upsertCredit(newCredit({ status: 'paid', paidDate: '2026-03-15', method: 'העברה' }),
    'ורד', [], NOW, TODAY);
  r = upsertCredit({ id: r.res.credit.id, status: 'pending', updatedAt: r.res.credit.updatedAt },
    'ורד', r.rows, NOW, TODAY);
  assert.equal(r.res.credit.status, 'pending');
  assert.equal(r.res.credit.paidDate, '');
});

test('an edit may change only the editable columns; the rest come from the sheet', () => {
  let r = upsertCredit(newCredit(), 'ורד', [], NOW, TODAY);
  const id = r.res.credit.id;
  const stamp = r.res.credit.updatedAt;
  r = upsertCredit({
    id, updatedAt: stamp,
    // Editable — these must land.
    amount: 1500, overrideReason: 'סוכם', approvedBy: 'סנדרה', notes: 'הערה',
    // Immutable — every one of these must be IGNORED.
    clientId: 'hacked', creditType: 'other', allocationMonth: '2020-01',
    calculatedAmount: 999999, reason: 'נדרס', basis: '{"rule":"נדרס"}',
    createdBy: 'מזייף', createdAt: '2000-01-01T00:00:00.000Z'
  }, 'סנדרה', r.rows, NOW, TODAY);
  const c = r.res.credit;
  assert.equal(c.amount, 1500);
  assert.equal(c.approvedBy, 'סנדרה');
  assert.equal(c.notes, 'הערה');
  assert.equal(c.clientId, 'c1');
  assert.equal(c.creditType, 'days_unused');
  assert.equal(c.allocationMonth, '2026-03');
  assert.equal(c.calculatedAmount, 2100);
  assert.equal(c.reason, 'trail');
  assert.equal(c.createdBy, 'ורד');
  assert.equal(c.createdAt, NOW);
  assert.equal(c.updatedBy, 'סנדרה');
});

test('a stale edit is refused and names who saved first', () => {
  let r = upsertCredit(newCredit(), 'ורד', [], NOW, TODAY);
  const id = r.res.credit.id;
  // Someone else saves in between.
  r = upsertCredit({ id, updatedAt: r.res.credit.updatedAt, notes: 'ראשון' },
    'סנדרה', r.rows, '2026-03-12T10:00:00.000Z', TODAY);
  const rowsBefore = JSON.stringify(r.rows);
  // Our tab still echoes the ORIGINAL stamp.
  const stale = upsertCredit({ id, updatedAt: NOW, notes: 'שני' }, 'ורד', r.rows, NOW, TODAY);
  assert.equal(stale.res.ok, false);
  assert.equal(stale.res.error, 'conflict');
  assert.equal(stale.res.conflicts[0].sheetUpdatedBy, 'סנדרה');
  assert.equal(JSON.stringify(stale.rows), rowsBefore, 'a refused write must change nothing');
});

test('strings are sanitized and length-capped before they reach a cell', () => {
  const r = upsertCredit(newCredit({
    clientName: '  <script>דנה</script>  ',
    approvedBy: 'א'.repeat(120),
    notes: 'נ'.repeat(900),
    amount: 1000, overrideReason: 'ר'.repeat(500)
  }), 'ורד', [], NOW, TODAY);
  // Angle brackets are stripped (so no tag survives) and the value is trimmed;
  // the inner text is kept as-is — this sanitizes, it does not parse HTML.
  assert.equal(r.res.credit.clientName, 'scriptדנה/script');
  assert.ok(!/[<>]/.test(r.res.credit.clientName));
  assert.equal(r.res.credit.approvedBy.length, 40);
  assert.equal(r.res.credit.notes.length, 500);
  assert.equal(r.res.credit.overrideReason.length, 300);
});

test('basis is stored as JSON and survives a round trip through normalizeCredit', () => {
  const r = upsertCredit(newCredit(), 'ורד', [], NOW, TODAY);
  const n = CL.normalizeCredit(r.res.credit);
  assert.equal(n.basis.rule, 'prorata');
  assert.equal(n.basis.unusedDays, 21);
  assert.equal(n.clientId, 'c1');
});

// ============================================================================
// 10. The read-side view helpers
// ============================================================================

test('pendingCreditsByPayout groups pending rows by date with totals', () => {
  const rows = [
    { id: 'a', clientId: 'c1', clientName: 'ב', amount: 100, status: 'pending', payoutDate: '2026-04-15' },
    { id: 'b', clientId: 'c2', clientName: 'א', amount: 250, status: 'pending', payoutDate: '2026-04-15' },
    { id: 'c', clientId: 'c3', clientName: 'ג', amount: 700, status: 'pending', payoutDate: '2026-03-15' },
    { id: 'd', clientId: 'c4', clientName: 'ד', amount: 999, status: 'paid', payoutDate: '2026-03-15' },
    { id: 'e', clientId: 'c5', clientName: 'ה', amount: 500, status: 'cancelled', payoutDate: '2026-03-15' }
  ];
  const g = CL.pendingCreditsByPayout(rows);
  assert.equal(g.groups.length, 2);
  assert.equal(g.groups[0].payoutDate, '2026-03-15');   // ascending
  assert.equal(g.groups[0].total, 700);
  assert.equal(g.groups[1].total, 350);
  assert.equal(g.total, 1050);                           // paid + cancelled excluded
  assert.deepEqual(g.groups[1].credits.map((c) => c.clientName), ['א', 'ב']);
});

test('a pending credit with no payout date is grouped last, never dropped', () => {
  const g = CL.pendingCreditsByPayout([
    { id: 'a', clientId: 'c1', amount: 100, status: 'pending', payoutDate: '2026-04-15' },
    { id: 'b', clientId: 'c2', amount: 50, status: 'pending', payoutDate: '' }
  ]);
  assert.equal(g.groups.length, 2);
  assert.equal(g.groups[1].payoutDate, '');
  assert.equal(g.total, 150);
});

test('creditsForClient joins on the single clientId key', () => {
  const rows = [
    { id: 'a', clientId: 'c1', amount: 10, status: 'pending' },
    { id: 'b', clientId: 'c2', amount: 20, status: 'pending' }
  ];
  assert.equal(CL.creditsForClient(rows, 'c1').length, 1);
  assert.equal(CL.creditsForClient(rows, 'c1')[0].id, 'a');
  assert.equal(CL.creditsForClient(rows, '').length, 0);
});

test('buildCreditLines never re-proposes a decision already on the sheet', () => {
  const existing = [{
    id: 'credit::c1::2026-03::1', clientId: 'c1', creditType: 'days_unused',
    allocationMonth: '2026-03', calculatedAmount: 2100, amount: 2100,
    status: 'pending', updatedAt: NOW
  }];
  const suggestions = CL.suggestCredits(client(), '2026-03-10', [
    payment({ id: 'p1', dueDate: '2026-03-01', amountPaid: 3000 }),
    payment({ id: 'p2', dueDate: '2026-04-01', amountPaid: 3000 })
  ]);
  const lines = CL.buildCreditLines(existing, suggestions, TODAY);
  assert.equal(lines.length, 2);                     // the saved one + prepaid_return
  assert.equal(lines[0].isNew, false);
  assert.equal(lines[0].updatedAt, NOW);             // the stale-save echo is carried
  assert.equal(lines[1].creditType, 'prepaid_return');
  assert.equal(lines[1].isNew, true);
  assert.equal(lines[1].payoutDate, CL.payoutDateFor(TODAY));
  assert.equal(lines[1].amount, lines[1].calculatedAmount);   // defaults to the computed figure
  assert.ok(lines[1].reason.length > 0, 'a new line carries its calculation trail');
});

test('validateCreditLine enforces the override and paid rules client-side too', () => {
  const base = {
    creditType: 'days_unused', allocationMonth: '2026-03',
    calculatedAmount: 2100, amount: 2100, status: 'pending', decidedDate: '2026-03-12'
  };
  assert.equal(CL.validateCreditLine(base), '');
  assert.match(CL.validateCreditLine(Object.assign({}, base, { amount: 100 })), /נימוק/);
  assert.equal(CL.validateCreditLine(
    Object.assign({}, base, { amount: 100, overrideReason: 'סוכם' })), '');
  assert.match(CL.validateCreditLine(Object.assign({}, base, { status: 'paid' })), /אמצעי תשלום/);
  assert.equal(CL.validateCreditLine(
    Object.assign({}, base, { status: 'paid', paidDate: '2026-03-15', method: 'העברה' })), '');
  assert.match(CL.validateCreditLine(Object.assign({}, base, { allocationMonth: '2026-13' })), /חודש/);
  assert.match(CL.validateCreditLine(Object.assign({}, base, { creditType: 'refund' })), /סוג/);
  assert.match(CL.validateCreditLine(
    Object.assign({}, base, { creditType: 'other', reason: '' })), /נימוק/);
});

test('the calculation trail names the rule, the window and the uncapped figure', () => {
  const s = CL.suggestCredits(client(), '2026-03-10',
    [payment({ dueDate: '2026-03-01', amountPaid: 3000 })]);
  const text = CL.creditBasisText('days_unused', byType(s, 'days_unused')[0].basis);
  assert.match(text, /2026-03-01/);
  assert.match(text, /2026-03-31/);
  assert.match(text, /21/);
  assert.match(text, /זיכוי יחסי/);
});

// ============================================================================
// 11. Scope + security guards
// ============================================================================

test('server.js gains no credit route — the ledger rides the gated proxy', () => {
  assert.ok(!/credit/i.test(SERVER), 'server.js must stay unchanged by the ledger');
  // The proxy it rides is still session-gated and still overwrites `user`.
  assert.ok(/app\.post\('\/api\/sheets', requireSession/.test(SERVER));
  assert.ok(/body\.user = sessionUserFromRequest\(req\)/.test(SERVER));
});

test('the write is dispatched internally and stamps the proxy-injected user', () => {
  assert.ok(/if \(action === 'saveCredit'\)/.test(GS), 'saveCredit not dispatched');
  assert.ok(/_upsertCredit\(payload\.credit, _requestUser\(payload\)\)/.test(GS),
    'saveCredit must stamp from _requestUser, never a payload-supplied name');
  assert.ok(/if \(action === 'getCredits'\) return _json\(_getCredits\(\)\);/.test(GS),
    'getCredits not dispatched');
});

test('the ledger carries no session or cancellation logic', () => {
  // Scan CODE only — the file's header comment names these concepts precisely
  // to say it does not touch them.
  const ledger = fs.readFileSync(path.join(ROOT, 'public', 'credits-ledger.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '');
  [/SessionLog/, /sessionId/, /creditsOwed/, /patient_no_show/, /therapist_cancelled/, /outcome/]
    .forEach((re) => assert.ok(!re.test(ledger),
      'credits-ledger.js must stay money-only; found ' + re));
  // And the write path never touches the per-session balance column. Bound the
  // scan to the function body itself (to its closing brace at column 0), so a
  // later, unrelated function can't make this guard pass or fail by accident.
  const upsert = extractFunction(GS, '_upsertCredit');
  assert.ok(!/creditsOwed/.test(upsert), '_upsertCredit must never touch creditsOwed');
  assert.ok(!/SessionLog/.test(upsert), '_upsertCredit must never read SessionLog');
});

test('the credit modal + payout view are wired into the page', () => {
  assert.ok(/credits-ledger\.js\?v=__BUILD__/.test(HTML), 'module not loaded by index.html');
  assert.ok(/id="creditsModal"/.test(HTML));
  assert.ok(/id="markCreditPaidModal"/.test(HTML));
  assert.ok(/id="creditsPayoutList"/.test(HTML));
  assert.ok(/id="creditsPayoutTotal"/.test(HTML));
  assert.ok(/renderCreditsPayouts\(\);/.test(APP), 'payout view not rendered from renderBilling');
  assert.ok(/openCreditsForClient\(client, client\.exitDate\)/.test(APP),
    'credits must be offered after the discharge writes succeed');
});

test('a credit save failure never rolls the discharge back', () => {
  // The credits hook runs INSIDE the success branch, after the toast + render,
  // so nothing in it can undo the discharge that already persisted.
  const idx = APP.indexOf("toast('סיום נשמר')");
  assert.ok(idx > 0, 'discharge success branch not found');
  const branch = APP.slice(idx, idx + 800);
  assert.ok(/openCreditsForClient/.test(branch));
  assert.ok(!/client\.status = /.test(branch), 'the discharge must not be reverted here');
});
