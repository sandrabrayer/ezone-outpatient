'use strict';

/**
 * תקופת כיסוי — the RECORDED coverage period on a payment row, and the month
 * split shown under it on the גבייה row.
 *
 * Ported from E-Zone-Dashboard PR #135, with the outpatient special cases.
 *
 * WHAT IS UNDER TEST
 *   1. The shared primitive (public/credits-ledger.js): the recorded period
 *      wins, the inferred cycle answers when there is none, and NOTHING is
 *      backfilled — a blank pair reads exactly as it read before the columns
 *      existed.
 *   2. Validation, client and server, as ONE rule (441-pair parity sweep).
 *   3. The month split (public/monthly-revenue.js): the same allocate() the
 *      הכנסות חודשיות screen uses, the window's own length as the
 *      denominator, and printed figures that sum to the payment exactly.
 *   4. Both consumers — the credits ledger and the monthly view — reading the
 *      stored period.
 *   5. חיובים נוספים חד פעמיים: a one-off charge covers ITS OWN DAY and is
 *      never spread across months, never stamped with a window, never
 *      editable.
 *   6. The server contract (apps-script/Code.gs): append-only columns, text
 *      forcing, validation BEFORE the lock and before a cell is written, the
 *      reason returned verbatim.
 *   7. The גבייה row wiring in public/app.js (source scans, the style the rest
 *      of this suite uses for DOM code).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CL = require('../public/credits-ledger');
const MR = require('../public/monthly-revenue');

const ROOT = path.join(__dirname, '..');
const GS = fs.readFileSync(path.join(ROOT, 'apps-script', 'Code.gs'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'style.css'), 'utf8');

const iso = CL.isoFromLocalDate;

function payment(over) {
  return Object.assign({
    id: 'pay::c1::base::2026-09', clientId: 'c1', clientName: 'דנה כהן',
    billingType: 'monthly', dueDate: '2026-09-06',
    amountDue: 3000, amountPaid: 3000, status: 'paid', paymentDate: '2026-09-06',
  }, over);
}

/* ===================== A. the primitive: recorded vs inferred ============== */

test('A: a blank pair reads as the INFERRED cycle — the rule that was already in force', () => {
  const cov = CL.paymentCoverage(payment({ coverageStart: '', coverageEnd: '' }));
  assert.equal(iso(cov.start), '2026-09-06');
  assert.equal(iso(cov.end), '2026-10-05', 'dueDate + 1 month − 1 day, exactly as before');
  assert.equal(cov.source, 'inferred');
  // A row that never heard of the columns reads identically.
  const legacy = CL.paymentCoverage({ dueDate: '2026-09-06' });
  assert.equal(iso(legacy.start), iso(cov.start));
  assert.equal(iso(legacy.end), iso(cov.end));
  assert.equal(legacy.source, 'inferred');
});

test('A: the RECORDED period wins over the inferred one', () => {
  const cov = CL.paymentCoverage(payment({ coverageStart: '2026-09-01', coverageEnd: '2026-11-30' }));
  assert.equal(iso(cov.start), '2026-09-01');
  assert.equal(iso(cov.end), '2026-11-30');
  assert.equal(cov.source, 'recorded', 'the person who took the money said what it bought');
});

test('A: a recorded period is honoured even when the row has no due date at all', () => {
  const cov = CL.paymentCoverage({ coverageStart: '2026-09-01', coverageEnd: '2026-09-30' });
  assert.equal(cov.source, 'recorded');
  assert.equal(iso(cov.end), '2026-09-30');
  // …and with neither, there is nothing to answer.
  assert.equal(CL.paymentCoverage({}), null);
  assert.equal(CL.paymentCoverage(null), null);
});

test('A: an UNUSABLE stored pair falls back to the inference instead of throwing', () => {
  // A hand-edited sheet cell. A corrupted row must still produce a window.
  for (const bad of [
    { coverageStart: '2026-13-01', coverageEnd: '2026-13-31' },
    { coverageStart: '2026-02-30', coverageEnd: '2026-03-01' },
    { coverageStart: '2026-09-06', coverageEnd: '' },
    { coverageStart: '2026-10-06', coverageEnd: '2026-09-06' },   // backwards
    { coverageStart: 'banana', coverageEnd: 'apple' },
  ]) {
    const cov = CL.paymentCoverage(payment(bad));
    assert.equal(cov.source, 'inferred', JSON.stringify(bad) + ' must read as absent');
    assert.equal(iso(cov.end), '2026-10-05');
  }
});

test('A: NOTHING IS BACKFILLED — reading never rewrites the row', () => {
  const row = payment({ coverageStart: '', coverageEnd: '' });
  const before = JSON.stringify(row);
  CL.paymentCoverage(row);
  CL.coverageDiffersFromDefault(row);
  MR.coverageWindowFor(row);
  assert.equal(JSON.stringify(row), before, 'a read must not touch the row');
});

test('A: coverageDiffersFromDefault marks only a period somebody DECIDED otherwise', () => {
  assert.equal(CL.coverageDiffersFromDefault(payment({ coverageStart: '', coverageEnd: '' })), false);
  // Recording exactly the default is not an adjustment — a badge on every row
  // would mean nothing.
  assert.equal(CL.coverageDiffersFromDefault(
    payment({ coverageStart: '2026-09-06', coverageEnd: '2026-10-05' })), false);
  assert.equal(CL.coverageDiffersFromDefault(
    payment({ coverageStart: '2026-09-06', coverageEnd: '2026-10-10' })), true);
});

test('A: withDefaultCoverage stamps the inferred cycle, and leaves a recorded one alone', () => {
  const stamped = CL.withDefaultCoverage(payment({}));
  assert.equal(stamped.coverageStart, '2026-09-06');
  assert.equal(stamped.coverageEnd, '2026-10-05');
  // The default IS what was being inferred, so stamping moves no figure.
  assert.equal(iso(CL.paymentCoverage(stamped).start), iso(CL.paymentCoverage(payment({})).start));
  assert.equal(iso(CL.paymentCoverage(stamped).end), iso(CL.paymentCoverage(payment({})).end));

  const recorded = payment({ coverageStart: '2026-09-01', coverageEnd: '2026-09-20' });
  assert.equal(CL.withDefaultCoverage(recorded), recorded, 'a recorded period is returned untouched');
  // A row with no due date has no cycle to stamp.
  const noDue = { id: 'x', billingType: 'monthly' };
  assert.equal(CL.withDefaultCoverage(noDue), noDue);
});

test('A: the day-of-month clamp survives — Jan 31 + 1 month is Feb 28, minus a day', () => {
  assert.equal(iso(CL.inferredCoverage({ dueDate: '2026-01-31' }).end), '2026-02-27');
  assert.equal(iso(CL.inferredCoverage({ dueDate: '2028-01-31' }).end), '2028-02-28', 'leap year');
});

/* ===================== B. validation, as ONE rule ========================== */

test('B: what the coverage period refuses, and what it deliberately does not', () => {
  const E = CL.coveragePeriodError;
  assert.equal(E('', ''), '', 'a blank pair is LEGAL — it means "infer"');
  assert.equal(E(null, undefined), '');
  assert.equal(E('2026-09-06', '2026-10-05'), '');
  assert.equal(E('2026-09-06', '2026-09-06'), '', 'a single day is a period');

  assert.match(E('2026-09-06', ''), /יש למלא גם תאריך התחלה/);
  assert.match(E('', '2026-10-05'), /יש למלא גם תאריך התחלה/);
  assert.match(E('2026-02-30', '2026-03-05'), /תאריך לא תקין/, 'a day that does not exist');
  assert.match(E('2026-13-01', '2026-13-05'), /תאריך לא תקין/);
  assert.match(E('2026-1-5', '2026-02-05'), /תאריך לא תקין/, 'loose forms are refused, not guessed');
  assert.match(E('06/09/2026', '05/10/2026'), /תאריך לא תקין/);
  assert.match(E('2026-10-05', '2026-09-06'), /תאריך הסיום מוקדם/);
  assert.match(E('2026-01-01', '2027-01-02'), /ארוכה מדי/, '367 days');
  assert.equal(E('2026-01-01', '2027-01-01'), '', '366 days is the documented maximum');

  // NOT refused: overlaps and gaps BETWEEN rows. Two months paid at once, a
  // skipped month and a re-dated cycle are all real, and suggestCredits
  // de-duplicates overlapping days anyway.
  assert.equal(E('2026-09-01', '2026-10-31'), '');
  assert.equal(E('2026-12-01', '2026-12-31'), '');
});

test('B: coverageDateISO normalizes the three real shapes and refuses everything else', () => {
  assert.equal(CL.coverageDateISO('2026-09-06'), '2026-09-06');
  assert.equal(CL.coverageDateISO(''), '');
  assert.equal(CL.coverageDateISO(null), '');
  assert.equal(CL.coverageDateISO('   '), '');
  // A zone-less timestamp is read by its LOCAL parts, so this holds in any TZ
  // the suite runs under (CI is UTC, the clinic is Asia/Jerusalem).
  assert.equal(CL.coverageDateISO('2026-09-06T12:00:00'), '2026-09-06');
  assert.equal(CL.coverageDateISO(new Date(2026, 8, 6)), '2026-09-06', 'LOCAL parts, never toISOString');
  for (const bad of ['2026-1-5', 'banana', 0, 1, true, {}, [], new Date('nope')]) {
    assert.equal(CL.coverageDateISO(bad), null, JSON.stringify(bad) + ' must be refused, not coerced');
  }
});

/* ===================== C. the month split ================================== */

function splitOf(over, amount) {
  return MR.paymentMonthSplit(payment(over), amount);
}

test('C: the ₪3,000 cycle of 6.9 → 5.10 splits 25 / 5 days across September and October', () => {
  const s = splitOf({}, 3000);
  assert.equal(s.months.length, 2);
  assert.deepEqual(s.months.map((m) => [m.monthName, m.daysInMonth, m.amount]), [
    ['ספטמבר', 25, 2500],
    ['אוקטובר', 5, 500],
  ]);
  assert.equal(s.windowDays, 30, 'the denominator is the WINDOW, not the calendar month');
  assert.equal(s.months[0].deferred, false);
  assert.equal(s.months[1].deferred, true, 'the later month is deferred revenue');
});

test('C: a period inside ONE month shows that month only', () => {
  const s = splitOf({ coverageStart: '2026-09-03', coverageEnd: '2026-09-27' }, 1800);
  assert.equal(s.months.length, 1);
  assert.equal(s.months[0].month, '2026-09');
  assert.equal(s.months[0].daysInMonth, 25);
  assert.equal(s.months[0].amount, 1800, 'the whole amount lands in the one month it covers');
  assert.equal(s.months[0].deferred, false);
});

test('C: a three-month period splits across all three, each by its own day count', () => {
  const s = splitOf({ coverageStart: '2026-09-15', coverageEnd: '2026-11-14' }, 6100);
  assert.deepEqual(s.months.map((m) => [m.month, m.daysInMonth]), [
    ['2026-09', 16], ['2026-10', 31], ['2026-11', 14],
  ]);
  assert.equal(s.windowDays, 61);
  assert.deepEqual(s.months.map((m) => m.deferred), [false, true, true]);
  assert.equal(s.months.reduce((t, m) => Math.round((t + m.amount) * 100) / 100, 0), 6100);
});

test('C: the printed split sums to the payment EXACTLY, agora for agora', () => {
  // Independently rounded shares can leave ±0.01 unaccounted for; the residual
  // is parked on the longest month so the lines add up to the row.
  const cases = [
    [100, '2026-09-01', '2026-11-29'],      // 3 near-equal months → 33.33 × 3
    [3000, '2026-09-06', '2026-10-05'],
    [1, '2026-09-30', '2026-10-01'],
    [777.77, '2026-01-15', '2026-04-14'],
    [2999.99, '2026-02-10', '2026-03-09'],
    [10000, '2026-12-20', '2027-01-19'],    // across a year boundary
  ];
  for (const [amount, start, end] of cases) {
    const s = splitOf({ coverageStart: start, coverageEnd: end }, amount);
    const sum = s.months.reduce((t, m) => Math.round((t + m.amount) * 100) / 100, 0);
    assert.equal(sum, Math.round(amount * 100) / 100,
      `${amount} over ${start}→${end} must print lines that sum to the payment`);
    assert.ok(Math.abs(s.residual) <= 0.02, 'the residual is rounding dust, never a real sum');
  }
});

test('C: the split IS the monthly view\'s allocation for the same payment', () => {
  // The whole point of sharing allocate(): the row and the הכנסות חודשיות
  // screen must never be able to disagree about a month.
  const rows = [
    [3000, {}],
    [6100, { coverageStart: '2026-09-15', coverageEnd: '2026-11-14' }],
    [100, { coverageStart: '2026-09-01', coverageEnd: '2026-11-29' }],
    [2450, { dueDate: '2026-01-31' }],
  ];
  for (const [amount, over] of rows) {
    const p = payment(over);
    const s = MR.paymentMonthSplit(p, amount);
    const win = MR.coverageWindowFor(p);
    for (const m of s.months) {
      const view = MR.allocate(amount, win, MR.monthBounds(m.month));
      assert.equal(m.allocated, view.amount, `${m.month}: the row must allocate like the view`);
      assert.equal(m.daysInMonth, view.daysInMonth);
      assert.equal(m.windowDays, view.windowDays);
    }
  }
});

test('C: the split follows the RECORDED period, not the due date', () => {
  const recorded = splitOf({ coverageStart: '2026-09-06', coverageEnd: '2026-09-30' }, 3000);
  assert.equal(recorded.months.length, 1, 'a shortened period stops spilling into October');
  assert.equal(recorded.months[0].amount, 3000);
});

/* ===================== D. both consumers read the stored period ============ */

function client(over) {
  return Object.assign({
    id: 'c1', name: 'דנה כהן', status: 'פעיל', location: 'רעננה אשר',
    pricePerSession: 3000, startDate: '2026-01-06', nextBillingDate: '2026-09-06',
  }, over);
}

test('D: THE MONTHLY VIEW allocates by the recorded period', () => {
  const recorded = payment({ coverageStart: '2026-09-06', coverageEnd: '2026-09-30' });
  const sep = MR.buildMonthlyRevenue({
    month: '2026-09', clients: [client()], payments: [recorded], credits: [], today: '2026-09-21',
  });
  const row = sep.received.rows.find((r) => r.paymentId === recorded.id);
  assert.equal(row.coverageStart, '2026-09-06');
  assert.equal(row.coverageEnd, '2026-09-30');
  assert.equal(row.coverageWindowSource, 'recorded');
  assert.equal(row.coverageAdjusted, true);
  assert.equal(row.amountInMonth, 3000, 'the whole payment belongs to September now');

  const oct = MR.buildMonthlyRevenue({
    month: '2026-10', clients: [client()], payments: [recorded], credits: [], today: '2026-09-21',
  });
  assert.equal(oct.received.rows.filter((r) => r.paymentId === recorded.id).length, 0,
    'nothing spills into October once the row says it did not');
});

test('D: a BLANK pair leaves every monthly figure exactly where it was', () => {
  const opts = (p) => ({ month: '2026-09', clients: [client()], payments: [p], credits: [], today: '2026-09-21' });
  const legacy = MR.buildMonthlyRevenue(opts({
    id: 'pay::c1::base::2026-09', clientId: 'c1', clientName: 'דנה כהן',
    billingType: 'monthly', dueDate: '2026-09-06', amountDue: 3000, amountPaid: 3000, status: 'paid',
  }));
  const blank = MR.buildMonthlyRevenue(opts(payment({ coverageStart: '', coverageEnd: '' })));
  assert.equal(blank.received.inclVat, legacy.received.inclVat);
  assert.equal(blank.received.inclVat, 2500, '25 of 30 days in September — unchanged');
  assert.equal(blank.received.rows[0].coverageWindowSource, 'inferred');
  assert.equal(blank.received.rows[0].coverageAdjusted, false);
  // And the default the write path would stamp allocates identically.
  const stamped = MR.buildMonthlyRevenue(opts(CL.withDefaultCoverage(payment({}))));
  assert.equal(stamped.received.inclVat, legacy.received.inclVat, 'stamping the default moves no figure');
});

test('D: THE CREDITS LEDGER credits against the recorded period', () => {
  const exit = '2026-09-20';
  const blank = CL.suggestCredits(client(), exit, [payment({ amountPaid: 3000 })])[0];
  assert.equal(blank.basis.coverageEnd, '2026-10-05', 'inferred: the cycle runs into October');
  assert.equal(blank.basis.unusedDays, 15);

  const recorded = CL.suggestCredits(client(), exit,
    [payment({ amountPaid: 3000, coverageStart: '2026-09-06', coverageEnd: '2026-09-30' })])[0];
  assert.equal(recorded.basis.coverageEnd, '2026-09-30');
  assert.equal(recorded.basis.unusedDays, 10, 'only the 10 days it actually paid for are unused');
  // The ARITHMETIC is untouched — only where [start, end] came from changed.
  assert.equal(recorded.basis.dailyRate, 100);
  assert.equal(recorded.calculatedAmount, 1000);
  assert.equal(recorded.basis.divisor, CL.CREDIT_DAYS_DIVISOR);
});

test('D: the credits ledger keeps every column of the row, so the period survives the copy', () => {
  // suggestCredits copies each row before normalizing its dueDate; a { dueDate }
  // stub would throw the recorded period away.
  const src = fs.readFileSync(path.join(ROOT, 'public', 'credits-ledger.js'), 'utf8');
  const fn = src.slice(src.indexOf('function suggestCredits'));
  assert.match(fn, /for \(var k in r\)/, 'the whole row is copied, not a stub');
  assert.match(fn, /var cov = paymentCoverage\(r\);/, 'and the WHOLE ROW is handed to paymentCoverage');
});

/* ===================== E. חיובים נוספים — never spread ===================== */

const extra = () => ({
  id: 'pay::c1::chg-ch1::once', clientId: 'c1', clientName: 'דנה כהן',
  billingType: 'one_time', dueDate: '2026-09-28',
  amountDue: 400, amountPaid: 400, status: 'paid', notes: 'אבחון',
});

test('E: a one-off extra charge covers ITS OWN DAY and is not spread across months', () => {
  const win = MR.coverageWindowFor(extra());
  assert.equal(iso(win.start), '2026-09-28');
  assert.equal(iso(win.end), '2026-09-28', 'one day, not a month');
  assert.equal(win.source, 'one_time_due_date');

  const s = MR.paymentMonthSplit(extra(), 400);
  assert.equal(s.months.length, 1, 'ONE line — a session charge belongs to its session');
  assert.deepEqual([s.months[0].month, s.months[0].daysInMonth, s.months[0].amount], ['2026-09', 1, 400]);

  // …and the monthly view posts it whole to that month, with nothing in October.
  const sep = MR.buildMonthlyRevenue({ month: '2026-09', clients: [client()], payments: [extra()], credits: [], today: '2026-09-30' });
  const oct = MR.buildMonthlyRevenue({ month: '2026-10', clients: [client()], payments: [extra()], credits: [], today: '2026-09-30' });
  assert.equal(sep.received.rows.find((r) => r.paymentId === extra().id).amountInMonth, 400);
  assert.equal(oct.received.rows.filter((r) => r.paymentId === extra().id).length, 0);
});

test('E: nothing ever stamps a month-long window onto a one-off charge', () => {
  const out = CL.withDefaultCoverage(extra());
  assert.equal(out.coverageStart, undefined, 'left blank on purpose');
  assert.equal(out.coverageEnd, undefined);
  assert.equal(CL.isOneTimePayment(extra()), true);
  assert.equal(CL.isOneTimePayment(payment({})), false);
});

test('E: even a hand-written period on a one-off row cannot widen it', () => {
  const hand = Object.assign(extra(), { coverageStart: '2026-09-28', coverageEnd: '2026-10-27' });
  const win = MR.coverageWindowFor(hand);
  assert.equal(iso(win.end), '2026-09-28');
  const s = MR.paymentMonthSplit(hand, 400);
  assert.equal(s.months.length, 1);
  assert.equal(s.months[0].amount, 400);
});

test('E: a RECURRING extra charge is a monthly row and keeps the monthly window', () => {
  // Only חד פעמי is special-cased; a monthly extra bills like a package cycle.
  const rec = Object.assign(extra(), { id: 'pay::c1::chg-ch2::2026-09', billingType: 'monthly' });
  assert.equal(iso(MR.coverageWindowFor(rec).end), '2026-10-27');
});

/* ===================== F. the server contract (Code.gs) ==================== */

function gsHeaders(name) {
  const m = GS.match(new RegExp('var ' + name + ' = \\[([\\s\\S]*?)\\];'));
  assert.ok(m, name + ' not found in Code.gs');
  return m[1].split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
    .match(/'[^']*'/g).map((s) => s.slice(1, -1));
}
const PAYMENTS_HEADERS = gsHeaders('PAYMENTS_HEADERS');

test('F: the two columns are APPENDED — every historical position is untouched', () => {
  assert.deepEqual(PAYMENTS_HEADERS, [
    'id', 'clientId', 'clientName', 'billingType', 'dueDate',
    'amountDue', 'amountPaid', 'status', 'paymentDate', 'method',
    'notes', 'bundleSize', 'sessionsUsed', 'coverageStart', 'coverageEnd',
  ], '_readAll maps by POSITION: inserting or reordering re-reads every row wrong');
  assert.deepEqual(gsHeaders('PAYMENT_TEXT_COLUMNS'), ['coverageStart', 'coverageEnd']);
});

test('F: the coverage columns are forced to TEXT, so a date cell cannot drift a day', () => {
  // A date-TYPED cell reads back as a Date, serializes as a UTC timestamp and
  // drifts −1 day in Israel — here that moves money between months.
  assert.match(GS, /function _ensurePaymentsSheet\(\)/);
  assert.match(GS, /function _forcePaymentTextCells\(sh, rowNum\)/);
  const ensure = GS.slice(GS.indexOf('function _ensurePaymentsSheet'));
  assert.match(ensure.slice(0, 600), /setNumberFormat\('@'\)/);
  assert.match(GS, /function _getPayments\(\)\s*\{\s*var sh = _ensurePaymentsSheet\(\);/);
});

test('F: validation runs BEFORE the lock and before any cell is written', () => {
  const fn = GS.slice(GS.indexOf('function _upsertPayment('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  const validateIdx = body.indexOf('_coveragePeriodError(');
  const lockIdx = body.indexOf('LockService.getScriptLock');
  const writeIdx = body.indexOf('setValues');
  assert.ok(validateIdx > -1 && lockIdx > -1 && writeIdx > -1);
  assert.ok(validateIdx < lockIdx, 'a bad period must be refused before the lock is taken');
  assert.ok(validateIdx < writeIdx, '…and before a single cell is touched');
  assert.match(body, /return \{ ok: false, error: coverageError \}/, 'the reason is returned VERBATIM');
});

test('F: no new endpoint — savePayment is still the one payment write action', () => {
  assert.equal((GS.match(/action === 'savePayment'/g) || []).length, 1);
  assert.doesNotMatch(GS, /action === 'saveCoverage|action === 'savePaymentCoverage/);
  assert.doesNotMatch(APP, /apiPostAction\('saveCoverage/);
  // server.js is the session-cookie-gated proxy and is untouched by this change.
  assert.doesNotMatch(SERVER, /coverage/i, 'no new route, no new unauthenticated surface');
});

/* --- the server, actually executed in a sandbox ---------------------------- */

function mockSheet(name, headers, rows, writes) {
  const data = [headers.slice()].concat(rows.map((r) => r.slice()));
  function range(row, col, numRows, numCols) {
    numRows = numRows || 1; numCols = numCols || 1;
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const src = data[row - 1 + r] || [];
          const line = [];
          for (let c = 0; c < numCols; c++) line.push(src[col - 1 + c] ?? '');
          out.push(line);
        }
        return out;
      },
      getValue() { return this.getValues()[0][0]; },
      setValue(v) {
        writes.push({ sheet: name, row, col, value: v, kind: 'setValue' });
        (data[row - 1] = data[row - 1] || [])[col - 1] = v;
      },
      setValues(vals) {
        writes.push({ sheet: name, row, col, kind: 'setValues' });
        for (let r = 0; r < vals.length; r++) {
          for (let c = 0; c < vals[r].length; c++) {
            (data[row - 1 + r] = data[row - 1 + r] || [])[col - 1 + c] = vals[r][c];
          }
        }
      },
      clearContent() { writes.push({ sheet: name, row, col, kind: 'clearContent' }); },
      setNumberFormat(f) { writes.push({ sheet: name, row, col, format: f, kind: 'setNumberFormat' }); return this; },
    };
  }
  return {
    _data: data,
    getName: () => name,
    getLastRow: () => data.length,
    getMaxRows: () => data.length,
    getLastColumn: () => headers.length,
    getRange: range,
    setFrozenRows() {},
    appendRow(r) { writes.push({ sheet: name, kind: 'appendRow', value: r.slice() }); data.push(r.slice()); },
  };
}

function paymentRow(over) {
  const obj = Object.assign({}, over);
  return PAYMENTS_HEADERS.map((h) => (obj[h] === undefined ? '' : obj[h]));
}

function sandbox(rows) {
  const writes = [];
  const sheets = { Payments: mockSheet('Payments', PAYMENTS_HEADERS, rows || [], writes) };
  const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet(n) { throw new Error('unexpected insertSheet(' + n + ')'); } };
  const pad = (n) => ('0' + n).slice(-2);
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Logger: { log() {} },
    Session: { getScriptTimeZone: () => 'Asia/Jerusalem' },
    // LOCAL parts, like the real Apps Script formatDate for the project zone.
    Utilities: { formatDate: (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    ContentService: {
      createTextOutput: () => ({ setMimeType() { return this; }, setContent() { return this; } }),
      MimeType: { JSON: 'JSON' },
    },
    MailApp: { sendEmail() {} },
    ScriptApp: {},
  };
  vm.createContext(ctx);
  vm.runInContext(GS, ctx);
  return { ctx, writes, sheets };
}

function storedRow(sheets, id) {
  const rows = sheets.Payments._data.slice(1);
  const idIdx = PAYMENTS_HEADERS.indexOf('id');
  const row = rows.find((r) => String(r[idIdx]) === id);
  if (!row) return null;
  const out = {};
  PAYMENTS_HEADERS.forEach((h, i) => { out[h] = row[i]; });
  return out;
}

test('F: the server REFUSES a bad period and writes nothing at all', () => {
  for (const bad of [
    { coverageStart: '2026-09-06', coverageEnd: '' },
    { coverageStart: '2026-02-30', coverageEnd: '2026-03-05' },
    { coverageStart: '2026-1-5', coverageEnd: '2026-02-05' },
    { coverageStart: '2026-10-05', coverageEnd: '2026-09-06' },
    { coverageStart: '2026-01-01', coverageEnd: '2027-01-02' },
  ]) {
    const { ctx, writes, sheets } = sandbox([]);
    const res = ctx._upsertPayment(Object.assign(payment({}), bad));
    assert.equal(res.ok, false, JSON.stringify(bad) + ' must be refused');
    assert.ok(res.error && res.error.length > 3, 'the Hebrew reason is surfaced, not a code');
    assert.deepEqual(writes.filter((w) => w.kind !== 'setNumberFormat'), [], 'nothing is written');
    assert.equal(storedRow(sheets, payment({}).id), null);
  }
});

test('F: the server stores a NORMALIZED pair — a Date cell or a timestamp lands as bare ISO', () => {
  const { ctx, sheets } = sandbox([]);
  // The Date is built INSIDE the sandbox: `instanceof Date` is per-realm, and
  // a Sheets date cell is always a Date of the script's own realm.
  const sheetDate = vm.runInContext('new Date(2026, 8, 6)', ctx);
  const res = ctx._upsertPayment(payment({
    coverageStart: sheetDate, coverageEnd: '2026-10-05T12:00:00',
  }));
  assert.equal(res.ok, true);
  const row = storedRow(sheets, payment({}).id);
  assert.equal(row.coverageStart, '2026-09-06');
  assert.equal(row.coverageEnd, '2026-10-05');
});

test('F: a blank pair STAYS blank on the server — it means "infer", never a guess', () => {
  const { ctx, sheets } = sandbox([]);
  assert.equal(ctx._upsertPayment(payment({ coverageStart: '', coverageEnd: '' })).ok, true);
  const row = storedRow(sheets, payment({}).id);
  assert.equal(row.coverageStart, '');
  assert.equal(row.coverageEnd, '');
});

test('F: the server drops a period posted on a one-off charge', () => {
  const { ctx, sheets } = sandbox([]);
  const res = ctx._upsertPayment(Object.assign(extra(), { coverageStart: '2026-09-28', coverageEnd: '2026-10-27' }));
  assert.equal(res.ok, true, 'the ROW is fine — only the period is meaningless');
  const row = storedRow(sheets, extra().id);
  assert.equal(row.coverageStart, '');
  assert.equal(row.coverageEnd, '');
});

test('F: an existing row keeps its position; the coverage cells are text-forced on write', () => {
  const existing = paymentRow(Object.assign(payment({}), { coverageStart: '', coverageEnd: '' }));
  const { ctx, writes, sheets } = sandbox([existing]);
  const res = ctx._upsertPayment(payment({ coverageStart: '2026-09-06', coverageEnd: '2026-09-30' }));
  assert.equal(res.updated, true);
  assert.equal(sheets.Payments._data.length, 2, 'updated in place, never duplicated');
  assert.equal(storedRow(sheets, payment({}).id).coverageEnd, '2026-09-30');
  const forced = writes.filter((w) => w.kind === 'setNumberFormat' && w.row === 2);
  // Both guards fire on this row: the whole-column format at ensure time and
  // the per-row one before the values land. Only WHICH columns matters here.
  const cols = Array.from(new Set(forced.map((w) => PAYMENTS_HEADERS[w.col - 1]))).sort();
  assert.deepEqual(cols, ['coverageEnd', 'coverageStart']);
  assert.ok(forced.every((w) => w.format === '@'));
});

test('F: client and server refuse the SAME periods — a 441-pair parity sweep', () => {
  const { ctx } = sandbox([]);
  const values = [
    '', '   ', null, undefined,
    '2026-09-06', '2026-09-30', '2026-10-05', '2026-01-01', '2027-01-01', '2027-01-02',
    '2026-02-28', '2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-09-31',
    '2026-1-5', '06/09/2026', 'banana', '2026-09-06T00:00:00+03:00', '2026-09-06T25:00:00+03:00',
  ];
  let pairs = 0;
  for (const a of values) {
    for (const b of values) {
      const mine = CL.coveragePeriodError(a, b);
      const theirs = ctx._coveragePeriodError(a, b);
      assert.equal(mine, theirs,
        `parity broken for (${JSON.stringify(a)}, ${JSON.stringify(b)}): client "${mine}" vs server "${theirs}"`);
      pairs++;
    }
  }
  assert.equal(pairs, 441);
});

/* ===================== G. the גבייה row (public/app.js) =================== */

function fnSource(src, name) {
  const sig = 'function ' + name + '(';
  const start = src.indexOf(sig);
  assert.notEqual(start, -1, name + ' not found');
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error(name + ' has unbalanced braces');
}

test('G: the row reads and writes both columns through the ONE resolution rule', () => {
  assert.match(fnSource(APP, 'normalizePaymentFromSheet'), /coverageStart: fmtDate\(row\.coverageStart\)/);
  assert.match(fnSource(APP, 'normalizePaymentFromSheet'), /coverageEnd: fmtDate\(row\.coverageEnd\)/);
  const forSheet = fnSource(APP, 'paymentForSheet');
  assert.match(forSheet, /var cov = paymentWithCoverage\(p\)/);
  assert.match(forSheet, /coverageStart: cov\.coverageStart/);
  assert.match(forSheet, /coverageEnd: cov\.coverageEnd/);
  const rule = fnSource(APP, 'paymentWithCoverage');
  assert.match(rule, /CL\.recordedCoverage\(merged\)/, '1. an explicit pair on the object wins');
  assert.match(rule, /findPaymentById/, '2. else the pair already stored on the live row');
  assert.match(rule, /CL\.withDefaultCoverage\(merged\)/, '3. else the inferred cycle');
});

test('G: a status click cannot silently revert a recorded period', () => {
  // recompute() REPLACES the row in state and on the sheet.
  const row = fnSource(APP, 'buildBillingRow');
  const recompute = row.slice(row.indexOf('function recompute('));
  assert.match(recompute, /coverageStart: payment\.coverageStart \|\| ''/);
  assert.match(recompute, /coverageEnd: payment\.coverageEnd \|\| ''/);
});

test('G: the period is shown in the app\'s people-facing date format, never ISO', () => {
  const fn = fnSource(APP, 'coveragePeriodText');
  assert.match(fn, /displayDate\(a\)/);
  assert.match(fn, /displayDate\(b\)/);
  assert.doesNotMatch(fn, /isoFromLocalDate\(win\.start\) \+ ' → '/);
  // A single-day period prints one date, not the same one twice.
  assert.match(fn, /a === b \? displayDate\(a\)/);
  // …while STORAGE stays ISO: the inputs carry the ISO values.
  assert.match(APP, /<input class="billing-cov-start" type="date" value="' \+ escapeHtml\(covStartISO\)/);
});

test('G: the split is rendered under the period, by the monthly view\'s own function', () => {
  const fn = fnSource(APP, 'coverageSplitHtml');
  assert.match(fn, /MR\.paymentMonthSplit\(probe, amount\)/, 'the SAME allocation as the monthly view');
  assert.match(fn, /m\.daysInMonth \+ ' ימים/);
  assert.match(fn, /money\(m\.amount\)/, 'VAT-inclusive, like the amount on the row');
  assert.doesNotMatch(fn, /exVat/);
  assert.match(fn, /m\.deferred \? ' deferred' : ''/, 'the non-current month reads as deferred');
  assert.match(fn, /נדחה/);
  // …and an invalid period being typed says so instead of rendering nonsense.
  assert.match(fn, /CL\.coveragePeriodError\(startISO, endISO\)/);
  assert.match(fn, /billing-cov-split-err/);
  assert.match(APP, /'<div class="billing-cov-split">'/);
});

test('G: the split follows the date inputs LIVE while the period is edited', () => {
  const row = fnSource(APP, 'buildBillingRow');
  assert.match(row, /var previewSplit = function \(\)/);
  assert.match(row, /covPartsEl\.innerHTML = coverageSplitHtml\(payment, amount, covStartIn\.value, covEndIn\.value\)/);
  for (const ev of ['input', 'change']) {
    assert.ok(row.indexOf(`covStartIn.addEventListener('${ev}', previewSplit)`) > -1, 'start input on ' + ev);
    assert.ok(row.indexOf(`covEndIn.addEventListener('${ev}', previewSplit)`) > -1, 'end input on ' + ev);
  }
});

test('G: who may edit a period — editors, on a row that exists, that is not a one-off', () => {
  const row = fnSource(APP, 'buildBillingRow');
  assert.match(row, /var covPersisted = state\.payments\.some/);
  assert.match(row, /var covEditable = state\.role === 'editor' && covPersisted && !covIsOneTime;/);
  // A paid row IS editable: it is exactly the row whose period must be correct.
  assert.doesNotMatch(row, /covEditable = [^\n]*status !== 'paid'/);
  assert.match(row, /covOneTimeHtml/, 'a one-off says why it has no period to edit');
});

test('G: saving a period goes through the ONE payment write path, and validates first', () => {
  const fn = fnSource(APP, 'saveCoveragePeriod');
  assert.match(fn, /state\.role !== 'editor'/);
  assert.match(fn, /CL\.coveragePeriodError\(start, end\)/);
  assert.match(fn, /saveBillingRow\(updated\)/, 'optimistic upsert + rollback + toast, like every payment edit');
  assert.doesNotMatch(fn, /apiPostAction/, 'no second write path');
  // Only the period changes — amount, status and paid figures ride through.
  assert.match(fn, /Object\.assign\(\{\}, payment, \{ coverageStart: start, coverageEnd: end \}\)/);
  // The reset writes a blank pair; paymentForSheet re-stamps the default.
  assert.match(fnSource(APP, 'buildBillingRow'), /saveCoveragePeriod\(payment, '', ''\)/);
});

test('G: the failure of a save is surfaced, never swallowed', () => {
  assert.match(fnSource(APP, 'persistPayment'), /throw new Error\(covErr\)/);
  assert.match(fnSource(APP, 'saveBillingRow'), /toast\('שמירה נכשלה: ' \+ e\.message, true\)/);
});

test('G: the row has room for the new cell, and the split spans the full width', () => {
  assert.match(CSS, /\.billing-cov-split \{\s*\n\s*grid-column: 1 \/ -1;/);
  const grid = CSS.match(/\.billing-row \{[\s\S]*?grid-template-columns: ([^;]+);/);
  assert.equal(grid[1].trim().split(/\s+/).length, 8, 'מטופל · סכום · תקופת כיסוי · סטטוס · שולם · יתרה · תאריך · גבייה הבאה');
  assert.match(CSS, /\.billing-row \.billing-cov-part\.deferred \{/);
});

/* ===================== H. the rendered row, for real ======================
 * The REAL-CODE extraction pattern used elsewhere in this suite for Code.gs:
 * the two HTML builders are pulled out of public/app.js and executed against
 * the real shared modules, so these assertions are about what the row ACTUALLY
 * renders, not about how it is spelled. */

const RENDER = new Function('MR', 'CL', `
  ${fnSource(APP, 'displayDate').replace('function displayDate', 'function displayDate')}
  function fmtDate(v) {
    if (!v) return '';
    var s = String(v);
    if (s.indexOf('T') !== -1) s = s.split('T')[0];
    return s;
  }
  function money(n) {
    if (!isFinite(n)) return '₪0';
    return '₪' + Math.round(n).toLocaleString('he-IL');
  }
  ${fnSource(APP, 'escapeHtml')}
  ${fnSource(APP, 'rowCoverageWindow')}
  ${fnSource(APP, 'isOneTimePayment')}
  ${fnSource(APP, 'coveragePeriodText')}
  ${fnSource(APP, 'coverageSplitHtml')}
  return { coveragePeriodText: coveragePeriodText, coverageSplitHtml: coverageSplitHtml,
           rowCoverageWindow: rowCoverageWindow };
`)(MR, CL);

test('H: the period renders as 06/09/2026 – 05/10/2026, never as ISO', () => {
  const text = RENDER.coveragePeriodText(RENDER.rowCoverageWindow(payment({})));
  assert.equal(text, '06/09/2026 – 05/10/2026');
  assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}/, 'ISO is storage, not something a person reads');
  // A one-off charge covers a single day and says so once.
  assert.equal(RENDER.coveragePeriodText(RENDER.rowCoverageWindow(extra())), '28/09/2026');
});

test('H: the split renders the two months, the day counts and the money', () => {
  const html = RENDER.coverageSplitHtml(payment({}), 3000);
  assert.match(html, /ספטמבר/);
  assert.match(html, /25 ימים/);
  assert.match(html, /₪2,500/);
  assert.match(html, /אוקטובר/);
  assert.match(html, /5 ימים/);
  assert.match(html, /₪500/);
  // Only the later month is marked deferred, and it says so in words too.
  assert.equal((html.match(/billing-cov-part deferred/g) || []).length, 1);
  assert.equal((html.match(/נדחה</g) || []).length, 1);
  assert.ok(html.indexOf('ספטמבר') < html.indexOf('אוקטובר'), 'chronological');
});

test('H: a period inside one month renders one line, with no deferred marker', () => {
  const html = RENDER.coverageSplitHtml(payment({ coverageStart: '2026-09-03', coverageEnd: '2026-09-27' }), 1800);
  assert.equal((html.match(/billing-cov-part/g) || []).length, 1);
  assert.doesNotMatch(html, /deferred/);
  assert.match(html, /₪1,800/);
});

test('H: a window crossing a year prints the year, so two lines cannot look alike', () => {
  const html = RENDER.coverageSplitHtml(payment({ coverageStart: '2026-12-20', coverageEnd: '2027-01-19' }), 3100);
  assert.match(html, /דצמבר 2026/);
  assert.match(html, /ינואר 2027/);
});

test('H: while a period is being typed, the preview follows it — and says when it is invalid', () => {
  const live = RENDER.coverageSplitHtml(payment({}), 3000, '2026-09-06', '2026-09-30');
  assert.match(live, /25 ימים/);
  assert.match(live, /₪3,000/, 'the whole payment lands in September once the period says so');
  assert.doesNotMatch(live, /אוקטובר/);
  // Half-typed / impossible periods report the shared Hebrew reason instead of
  // rendering a window nobody asked for.
  assert.match(RENDER.coverageSplitHtml(payment({}), 3000, '2026-09-06', ''), /billing-cov-split-err/);
  assert.match(RENDER.coverageSplitHtml(payment({}), 3000, '2026-09-06', ''), /יש למלא גם תאריך התחלה/);
  assert.match(RENDER.coverageSplitHtml(payment({}), 3000, '2026-10-05', '2026-09-06'), /תאריך הסיום מוקדם/);
});

test('H: an extra charge renders ONE month line — never a split', () => {
  const html = RENDER.coverageSplitHtml(extra(), 400);
  assert.equal((html.match(/billing-cov-part/g) || []).length, 1);
  assert.match(html, /ספטמבר/);
  assert.match(html, /1 ימים/);
  assert.match(html, /₪400/);
  assert.doesNotMatch(html, /אוקטובר/);
});

test('H: every rendered figure is escaped and the amounts add up to the row', () => {
  const html = RENDER.coverageSplitHtml(payment({ clientName: '<script>' }), 3000);
  assert.doesNotMatch(html, /<script>/);
  const amounts = (html.match(/₪[\d,]+/g) || []).map((a) => Number(a.slice(1).replace(/,/g, '')));
  assert.equal(amounts.reduce((a, b) => a + b, 0), 3000);
});
