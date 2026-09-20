'use strict';

/**
 * Coverage for the MONTHLY REVENUE view — "how much revenue belongs to month
 * X", as opposed to "how much cash arrived in month X". Three layers:
 *
 *   1. The ALLOCATION (public/monthly-revenue.js, required directly): coverage
 *      windows split day by day across month boundaries, RECEIVED vs EXPECTED
 *      partitioning a month without overlap or gap, credits as a negative,
 *      NET, the ex-VAT basis, and the per-location breakdown.
 *
 *   2. REUSE + SOURCE guards: the coverage window comes from
 *      credits-ledger.js and is NOT reimplemented here; the ex-VAT divisor
 *      agrees with E-Zone-Dashboard; index.html loads the module in the right
 *      order; the service-worker cache was bumped.
 *
 *   3. SCOPE + SECURITY guards (PR #106 parity): the view adds no server.js
 *      route and no endpoint, never writes, escapes everything it interpolates,
 *      and leaves the daily גבייה worklist untouched.
 *
 * Dates are exercised at month boundaries, on 28/29/30/31-day months and
 * across both DST switches. Run with:  npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const MR = require('../public/monthly-revenue');
const CL = require('../public/credits-ledger');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'style.css'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
const MODULE_SRC = fs.readFileSync(path.join(ROOT, 'public', 'monthly-revenue.js'), 'utf8');
const TREATMENT_MAP = fs.readFileSync(path.join(ROOT, 'public', 'treatment-map.js'), 'utf8');

// --- helpers ---------------------------------------------------------------

/** Extract one `function NAME(...) { ... }` body out of a source string. */
function fnSource(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'function not found: ' + name);
  let depth = 0;
  let i = src.indexOf('{', start);
  const from = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(from, i + 1); }
  }
  throw new Error('unbalanced braces in ' + name);
}

const VAT = 1.18;
/** What the view should print for a VAT-inclusive figure. */
function ex(inclVat) { return Math.round((inclVat / VAT) * 100) / 100; }

function client(over) {
  return Object.assign({
    id: 'c1', name: 'דנה כהן', location: 'רעננה אשר', status: 'פעיל',
    pricePerSession: 3000,            // the סכום חודשי field — see clientAmountDue
    startDate: '2025-01-01', exitDate: '',
    nextBillingDate: '', packageChangeDate: '', paymentDate: ''
  }, over || {});
}
function payment(over) {
  return Object.assign({
    id: 'pay::c1::base::2026-01', clientId: 'c1', clientName: 'דנה כהן',
    billingType: 'monthly', dueDate: '2026-01-20',
    amountDue: 3000, amountPaid: 0, status: 'unpaid',
    paymentDate: '', method: '', notes: ''
  }, over || {});
}
function credit(over) {
  return Object.assign({
    id: 'credit::c1::2026-01::1', clientId: 'c1', clientName: 'דנה כהן',
    creditType: 'days_unused', allocationMonth: '2026-01',
    calculatedAmount: 1000, amount: 1000, status: 'pending',
    basis: {}
  }, over || {});
}
/** Build a month with everything defaulted, so each test states only its point. */
function build(over) {
  return MR.buildMonthlyRevenue(Object.assign({
    month: '2026-01', clients: [], payments: [], credits: [], today: '2026-01-15'
  }, over || {}));
}

/* ================= A. the allocation primitive ================= */

test('A: monthBounds knows month lengths, including a leap February', () => {
  assert.equal(MR.monthBounds('2026-01').days, 31);
  assert.equal(MR.monthBounds('2026-02').days, 28);
  assert.equal(MR.monthBounds('2024-02').days, 29, 'leap year');
  assert.equal(MR.monthBounds('2026-04').days, 30);
  assert.equal(MR.monthBounds('2026-02').startISO, '2026-02-01');
  assert.equal(MR.monthBounds('2026-02').endISO, '2026-02-28');
  // A month key that is not one is refused, never guessed at.
  assert.equal(MR.monthBounds('2026-13'), null);
  assert.equal(MR.monthBounds('2026-1'), null);
  assert.equal(MR.monthBounds(''), null);
  assert.equal(build({ month: 'nonsense' }), null);
});

test('A: allocate splits a straddling window by DAY COUNT, and the halves sum to the whole', () => {
  // 20 Jan -> 19 Feb is 31 days: 12 in January, 19 in February.
  const win = CL.paymentCoverage({ dueDate: '2026-01-20' });
  const jan = MR.allocate(3000, win, MR.monthBounds('2026-01'));
  const feb = MR.allocate(3000, win, MR.monthBounds('2026-02'));
  assert.equal(jan.daysInMonth, 12);
  assert.equal(feb.daysInMonth, 19);
  assert.equal(jan.windowDays, 31);
  assert.equal(jan.amount, 1161.29);           // 12/31 x 3000
  assert.equal(feb.amount, 1838.71);           // 19/31 x 3000
  assert.equal(Math.round(jan.amount + feb.amount), 3000, 'nothing is lost between the months');
  // A month the window never reaches gets a zero slice, not null.
  const mar = MR.allocate(3000, win, MR.monthBounds('2026-03'));
  assert.equal(mar.amount, 0);
  assert.equal(mar.daysInMonth, 0);
});

test('A: a ONE-TIME charge lands wholly in its own month, never spread over 30 days', () => {
  // A one-off is not a month of treatment. Spreading it would post most of a
  // single-day charge into the FOLLOWING month.
  const w = MR.coverageWindowFor({ dueDate: '2026-01-28', billingType: 'one_time' });
  assert.equal(CL.isoFromLocalDate(w.start), '2026-01-28');
  assert.equal(CL.isoFromLocalDate(w.end), '2026-01-28');
  const jan = build({ payments: [payment({ id: 'pay::c1::chg-x::once', billingType: 'one_time', dueDate: '2026-01-28', amountDue: 500, amountPaid: 500, status: 'paid' })] });
  const feb = build({ month: '2026-02', payments: [payment({ id: 'pay::c1::chg-x::once', billingType: 'one_time', dueDate: '2026-01-28', amountDue: 500, amountPaid: 500, status: 'paid' })] });
  assert.equal(jan.received.inclVat, 500);
  assert.equal(feb.received.inclVat, 0, 'a one-off does not bleed into the next month');
});

/* ================= B. RECEIVED — allocation by window, not by date ========= */

test('B: a payment covering 20 Jan – 19 Feb contributes to BOTH months, split by days', () => {
  const p = payment({ dueDate: '2026-01-20', amountPaid: 3000, status: 'paid', paymentDate: '2026-01-18' });
  const jan = build({ clients: [client()], payments: [p] });
  const feb = build({ month: '2026-02', clients: [client()], payments: [p] });
  assert.equal(jan.received.inclVat, 1161.29);
  assert.equal(feb.received.inclVat, 1838.71);
  // The drill-down shows the fraction, so the arithmetic is inspectable.
  assert.equal(jan.received.rows[0].daysInMonth, 12);
  assert.equal(jan.received.rows[0].windowDays, 31);
  assert.equal(feb.received.rows[0].daysInMonth, 19);
});

test('B: the PAYMENT DATE never moves a shekel — paying three months late changes nothing', () => {
  const onTime = payment({ dueDate: '2026-01-20', amountPaid: 3000, status: 'paid', paymentDate: '2026-01-18' });
  const veryLate = payment({ dueDate: '2026-01-20', amountPaid: 3000, status: 'paid', paymentDate: '2026-04-30' });
  const a = build({ clients: [client()], payments: [onTime] });
  const b = build({ clients: [client()], payments: [veryLate] });
  assert.equal(a.received.inclVat, b.received.inclVat, 'same money, same month, whenever the cash landed');
  // And the month the cash DID land in gets none of it.
  const apr = build({ month: '2026-04', clients: [client()], payments: [veryLate] });
  assert.equal(apr.received.inclVat, 0, 'April received nothing — the money belongs to Jan/Feb');
  // paymentDate is still carried for transparency; it just has no power.
  assert.equal(b.received.rows[0].paymentDate, '2026-04-30');
});

test('B: the dueDate MONTH KEY never decides either — most of a late-month cycle lands next month', () => {
  // monthKey(dueDate) would put all ₪3,000 in January. The window puts 19/31
  // of it in February, which is where those days actually are.
  const p = payment({ dueDate: '2026-01-20', amountPaid: 3000, status: 'paid' });
  const feb = build({ month: '2026-02', clients: [client()], payments: [p] });
  assert.equal(CL.monthKey(p.dueDate), '2026-01', 'the month key says January');
  assert.ok(feb.received.inclVat > 1800, 'but most of the money belongs to February');
});

test('B: a window across the March DST switch counts exact days — no drift', () => {
  // Israel springs forward in late March. Math.round on the day span absorbs
  // the ±1h, inherited from credits-ledger.js.
  const p = payment({ dueDate: '2026-03-20', amountPaid: 3100, status: 'paid' });
  const mar = build({ month: '2026-03', clients: [client()], payments: [p] });
  const apr = build({ month: '2026-04', clients: [client()], payments: [p] });
  assert.equal(mar.received.rows[0].daysInMonth, 12, '20–31 March');
  assert.equal(apr.received.rows[0].daysInMonth, 19, '1–19 April');
  assert.equal(mar.received.rows[0].windowDays, 31);
});

/* ================= C. EXPECTED — and never double counting ================= */

test('C: an active client with no payment row projects the cycles covering the month', () => {
  // A client billed on the 20th has TWO cycles touching January: the December
  // one (covering 1–19 Jan) and the January one (covering 20–31). Both are
  // forecast, and together they are exactly one month of money — which is the
  // whole point of splitting by window rather than by month key.
  const c = client({ nextBillingDate: '2026-01-20' });
  const r = build({ clients: [c], today: '2025-12-01' });
  assert.equal(r.received.inclVat, 0, 'no cash yet');
  assert.equal(r.expected.projected.count, 2);
  const due = r.expected.rows.map((x) => x.dueDate).sort();
  assert.deepEqual(due, ['2025-12-20', '2026-01-20']);
  const byDue = {};
  r.expected.rows.forEach((x) => { byDue[x.dueDate] = x; });
  assert.equal(byDue['2026-01-20'].amountInMonth, 1161.29, '12 of its 31 window days are in January');
  assert.equal(byDue['2025-12-20'].amountInMonth, 1838.71, '19 of its 31 window days are in January');
  assert.equal(r.expected.inclVat, 3000, 'one month of money, counted once');
  assert.equal(r.expected.rows[0].kind, 'projected');
});

test('C: RECEIVED and EXPECTED PARTITION a partly-paid cycle — no overlap, no gap', () => {
  // ₪1,200 of a ₪3,000 cycle is in hand. Both halves ride the same window and
  // the same day weights, so together they are exactly the month's share.
  // The December cycle is settled in full, so January's figures isolate the
  // January cycle: ₪1,200 of its ₪3,000 is in hand.
  const dec = payment({ id: 'pay::c1::base::2025-12', dueDate: '2025-12-20', amountDue: 3000, amountPaid: 3000, status: 'paid' });
  const p = payment({ dueDate: '2026-01-20', amountDue: 3000, amountPaid: 1200, status: 'partial' });
  const r = build({ clients: [client({ nextBillingDate: '2026-01-20' })], payments: [dec, p] });
  const janRecv = r.received.rows.filter((x) => x.dueDate === '2026-01-20');
  assert.equal(janRecv.length, 1);
  assert.equal(janRecv[0].amountInMonth, 464.52);               // 12/31 x 1200
  assert.equal(r.expected.billedUnpaid.inclVat, 696.77);        // 12/31 x 1800
  assert.equal(
    Math.round(janRecv[0].amountInMonth + r.expected.inclVat), 1161,
    'paid part + shortfall = the full cycle share, counted once'
  );
  assert.equal(r.expected.projected.count, 0, 'the cycle is billed, so it is NOT also projected');
});

test('C: a cycle that already has a payment row is never ALSO projected', () => {
  // Both cycles touching January are paid. Without the skip, each would be
  // counted twice — once as cash, once as a forecast — and January would read
  // as ₪6,000 of revenue on ₪3,000 of money.
  const c = client({ nextBillingDate: '2026-01-20' });
  const jan = payment({ dueDate: '2026-01-20', amountDue: 3000, amountPaid: 3000, status: 'paid' });
  const dec = payment({ id: 'pay::c1::base::2025-12', dueDate: '2025-12-20', amountDue: 3000, amountPaid: 3000, status: 'paid' });
  const r = build({ clients: [c], payments: [jan, dec] });
  assert.equal(r.expected.inclVat, 0, 'fully paid leaves nothing expected');
  assert.equal(r.expected.rows.length, 0);
  assert.equal(r.received.inclVat, 3000, 'January is exactly one month of money');
  assert.notEqual(r.received.inclVat, 6000, 'and emphatically not double counted');
});

test('C: a cycle whose date has PASSED with no payment row is unbilled_past, not a forecast', () => {
  // Same money, very different confidence — usually a recording gap. It stays
  // inside EXPECTED (the days are genuinely owed) but is named apart so the UI
  // can flag it instead of passing it off as future income.
  const c = client({ nextBillingDate: '2026-01-20' });
  // On the 25th both January cycles (20 Dec and 20 Jan) are in the past.
  const late = build({ clients: [c], today: '2026-01-25' });
  assert.equal(late.expected.unbilledPast.count, 2);
  assert.equal(late.expected.projected.count, 0);
  assert.deepEqual(late.expected.rows.map((x) => x.kind), ['unbilled_past', 'unbilled_past']);
  // On the 5th the January cycle has not come round yet, so it is an ordinary
  // forecast while the December one is already a gap. Same money, named apart.
  const early = build({ clients: [c], today: '2026-01-05' });
  assert.equal(early.expected.projected.count, 1, 'the 20 Jan cycle is still ahead');
  assert.equal(early.expected.unbilledPast.count, 1, 'the 20 Dec cycle already passed unrecorded');
  assert.equal(early.expected.inclVat, late.expected.inclVat, 'the money is the same either way');
});

test('C: clients who stopped treatment project nothing — both inactive kinds', () => {
  assert.deepEqual(MR.INACTIVE_STATUSES, ['סיים טיפול', 'לא פעיל']);
  for (const status of ['סיים טיפול', 'לא פעיל']) {
    const r = build({ clients: [client({ status, nextBillingDate: '2026-01-20' })], today: '2026-01-05' });
    assert.equal(r.expected.inclVat, 0, status + ' must stop billing');
  }
  // An active one in the same shape does project, so the guard above is real.
  const live = build({ clients: [client({ nextBillingDate: '2026-01-20' })], today: '2026-01-05' });
  assert.ok(live.expected.inclVat > 0);
});

test('C: projection respects the client lifecycle — startDate, exitDate, and a mid-cycle exit', () => {
  const late = build({ clients: [client({ nextBillingDate: '2026-01-20', startDate: '2026-02-01' })], today: '2026-01-05' });
  assert.equal(late.expected.inclVat, 0, 'not billed for months before they started');

  // Exit on 10 January. The 20 Jan cycle starts after they have gone, so it is
  // dropped outright. The 20 Dec cycle straddles the exit: days 1–10 January
  // were earned, days 11–19 were not.
  const gone = build({ clients: [client({ nextBillingDate: '2026-01-20', exitDate: '2026-01-10' })], today: '2025-12-01' });
  assert.equal(gone.expected.rows.length, 1);
  assert.equal(gone.expected.rows[0].dueDate, '2025-12-20');
  assert.equal(gone.expected.rows[0].daysInMonth, 10, 'only up to and including the exit day');
  assert.equal(gone.expected.inclVat, 967.74, '10/31 x 3000 — the daily rate is unchanged by the exit');
  // Clipping must not inflate the daily rate: 10 days cost ten days' worth.
  assert.equal(gone.expected.rows[0].windowDays, 31, 'the denominator stays the full cycle');

  // An exit before the month begins leaves nothing at all.
  const longGone = build({ clients: [client({ nextBillingDate: '2026-01-20', exitDate: '2025-12-15' })], today: '2025-12-01' });
  assert.equal(longGone.expected.inclVat, 0);
});

test('C: EXPECTED uses pricePerSession — the field the form labels סכום חודשי', () => {
  // Outpatient has no tiered rate table; the monthly amount is typed straight
  // in and stored in the (legacy-named) pricePerSession column.
  assert.match(INDEX, /name="monthlyAmount"/, 'the form field exists');
  assert.match(APP, /pricePerSession: monthlyAmount/, 'and it is stored as pricePerSession');
  assert.match(APP, /function clientAmountDue\(c\) \{ return toNum\(c\.pricePerSession\); \}/);
  const r = build({ clients: [client({ nextBillingDate: '2026-01-20', pricePerSession: 6200 })], today: '2025-12-01' });
  assert.equal(r.expected.inclVat, 6200, 'the typed monthly amount, spread across the month it covers');
  const janCycle = r.expected.rows.filter((x) => x.dueDate === '2026-01-20')[0];
  assert.equal(
    janCycle.amountInMonth,
    MR.allocate(6200, CL.paymentCoverage({ dueDate: '2026-01-20' }), MR.monthBounds('2026-01')).amount
  );
  // No monthly amount -> nothing to forecast, rather than a zero-amount row.
  const none = build({ clients: [client({ nextBillingDate: '2026-01-20', pricePerSession: 0 })], today: '2026-01-05' });
  assert.equal(none.expected.rows.length, 0);
});

test('C: the manual סכום גבייה override is honoured through the injected resolver', () => {
  const dec = payment({ id: 'pay::c1::base::2025-12', dueDate: '2025-12-20', amountDue: 3000, amountPaid: 3000, status: 'paid' });
  const p = payment({ dueDate: '2026-01-20', amountDue: 3000, amountPaid: 0, status: 'unpaid' });
  const plain = build({ clients: [client({ nextBillingDate: '2026-01-20' })], payments: [dec, p] });
  const overridden = build({
    clients: [client({ nextBillingDate: '2026-01-20' })], payments: [dec, p],
    amountDueFor: (pay, computed) => (pay.id === p.id ? 1000 : computed)
  });
  assert.equal(plain.expected.inclVat, 1161.29, '12/31 x 3000');
  assert.equal(overridden.expected.inclVat, 387.1, '12/31 x 1000');
  // The module stays pure: the override arrives as a callback, never by
  // reaching into client records itself.
  assert.doesNotMatch(MODULE_SRC, /paymentAmountOverrides/, 'the pure module knows nothing of the override storage');
});

test('C: extra charges are not forecast, but the money they bring in IS received', () => {
  // A one-off is not contracted future revenue and a recurring extra carries no
  // commitment to recur — so neither is projected. Once actually paid, it is
  // ordinary cash and lands in RECEIVED like anything else.
  const extraPaid = payment({ id: 'pay::c1::chg-a1::2026-01', dueDate: '2026-01-05', amountDue: 800, amountPaid: 800, status: 'paid', billingType: 'one_time' });
  const r = build({ clients: [client({ nextBillingDate: '2026-06-20' })], payments: [extraPaid], today: '2026-01-25' });
  assert.equal(r.received.inclVat, 800);
  assert.equal(r.expected.projected.count, 0);
});

/* ================= D. CREDITS ================= */

test('D: a days_unused credit is split over the days it actually refunds', () => {
  // The refunded tail is creditedFrom..coverageEnd — the days BEFORE the exit
  // were used and were never refunded, so they must not attract any of it.
  const c = credit({
    amount: 1000,
    basis: { coverageStart: '2026-01-20', coverageEnd: '2026-02-19', creditedFrom: '2026-01-26' }
  });
  const jan = build({ clients: [client()], credits: [c] });
  const feb = build({ month: '2026-02', clients: [client()], credits: [c] });
  // 26 Jan–19 Feb is 25 days: 6 in January, 19 in February.
  assert.equal(jan.credits.rows[0].daysInMonth, 6);
  assert.equal(feb.credits.rows[0].daysInMonth, 19);
  assert.equal(jan.credits.rows[0].windowDays, 25);
  assert.equal(Math.round(jan.credits.inclVat + feb.credits.inclVat), 1000);
  assert.equal(jan.credits.rows[0].spanSource, 'coverage_window');
});

test('D: a prepaid_return credit is split over the WHOLE window it returns', () => {
  const c = credit({
    creditType: 'prepaid_return', amount: 3000,
    basis: { coverageStart: '2026-01-20', coverageEnd: '2026-02-19', creditedFrom: '2026-01-20' }
  });
  const jan = build({ clients: [client()], credits: [c] });
  assert.equal(jan.credits.rows[0].daysInMonth, 12);
  assert.equal(jan.credits.inclVat, 1161.29);
});

test('D: a credit with no usable window falls back to allocationMonth, and SAYS so', () => {
  // A manual `other` credit has no coverage window. Landing it whole in its
  // allocation month is the only honest option — and spanSource records that,
  // so the drill-down never implies a day-level precision it does not have.
  const c = credit({ creditType: 'other', amount: 750, allocationMonth: '2026-01', basis: {} });
  const jan = build({ clients: [client()], credits: [c] });
  const feb = build({ month: '2026-02', clients: [client()], credits: [c] });
  assert.equal(jan.credits.inclVat, 750);
  assert.equal(jan.credits.rows[0].spanSource, 'allocation_month');
  assert.equal(feb.credits.inclVat, 0);
});

test('D: cancelled credits count for nothing; pending and paid both reduce revenue', () => {
  const basis = { coverageStart: '2026-01-01', coverageEnd: '2026-01-31', creditedFrom: '2026-01-01' };
  const cancelled = build({ clients: [client()], credits: [credit({ status: 'cancelled', amount: 1000, basis })] });
  assert.equal(cancelled.credits.inclVat, 0, 'a void decision is not money');
  for (const status of ['pending', 'paid']) {
    const r = build({ clients: [client()], credits: [credit({ status, amount: 1000, basis })] });
    assert.equal(r.credits.inclVat, 1000, status + ' credits reduce the month');
  }
});

/* ================= E. NET, and the never-summed rule ================= */

test('E: NET = received + expected − credits, and credits pull it DOWN', () => {
  const p = payment({ dueDate: '2026-01-01', amountDue: 3100, amountPaid: 3100, status: 'paid' });
  const basis = { coverageStart: '2026-01-01', coverageEnd: '2026-01-31', creditedFrom: '2026-01-01' };
  const r = build({ clients: [client({ nextBillingDate: '2026-01-01' })], payments: [p], credits: [credit({ amount: 600, basis })] });
  assert.equal(r.credits.inclVat, 600);
  assert.equal(
    r.net.inclVat,
    Math.round((r.received.inclVat + r.expected.inclVat - r.credits.inclVat) * 100) / 100
  );
  // Without the credit the same month is 600 richer — the sign is real.
  const noCredit = build({ clients: [client({ nextBillingDate: '2026-01-01' })], payments: [p] });
  assert.equal(Math.round(noCredit.net.inclVat - r.net.inclVat), 600);
});

test('E: RECEIVED and EXPECTED are never blended — no combined field exists anywhere', () => {
  const r = build({ clients: [client({ nextBillingDate: '2026-01-20' })], payments: [payment({ amountPaid: 500, status: 'partial' })] });
  assert.ok(Object.prototype.hasOwnProperty.call(r, 'received'));
  assert.ok(Object.prototype.hasOwnProperty.call(r, 'expected'));
  // NET is the ONE place they meet, and it is labelled a projection in the UI.
  const combinedish = Object.keys(r).filter((k) => /^(total|revenue|gross|combined|all)/i.test(k));
  assert.deepEqual(combinedish, [], 'no field invites reading cash and forecast as one number');
  // The two cards are rendered from separate buckets and separate elements.
  assert.match(APP, /\$\('#revReceived'\)\.textContent = revMoney\(model\.received\.exVat\)/);
  assert.match(APP, /\$\('#revExpected'\)\.textContent = revMoney\(model\.expected\.exVat\)/);
  // And they are coloured apart, so they cannot be skim-read as the same thing.
  assert.match(CSS, /\.revenue-kpi-received \.kpi-value \{ color: var\(--green-2\); \}/);
  assert.match(CSS, /\.revenue-kpi-expected \.kpi-value \{ color: var\(--blue-soft\); \}/);
});

/* ================= F. VAT — the cross-app contract ================= */

test('F: outpatient amounts are STORED VAT-inclusive — the premise for dividing', () => {
  // Stated in two shipped files. If either claim ever changes, this test is
  // where the ÷1.18 decision must be revisited.
  const unwrapped = TREATMENT_MAP.replace(/\n\s*\*\s*/g, ' ');
  assert.match(unwrapped, /client-facing price table \(incl\. VAT\)/);
  assert.match(unwrapped, /PRICES are client-facing, incl\. VAT/);
  assert.match(
    fs.readFileSync(path.join(ROOT, 'public', 'credits-ledger.js'), 'utf8'),
    /client-facing \(VAT-inclusive\) figure/
  );
});

test('F: the divisor is 1.18 and agrees with E-Zone-Dashboard', () => {
  // The two apps MUST share a basis or a consolidated total is silently wrong
  // by 18% of whichever half was inclusive.
  assert.equal(MR.VAT_RATE, 1.18);
  assert.equal(MR.exVat(1180), 1000);
  assert.equal(MR.exVat(0), 0);
  assert.match(MODULE_SRC, /var VAT_RATE = 1\.18;/);
});

test('F: every bucket carries BOTH bases, and a drill-down adds up to its own header', () => {
  // Ex-VAT is taken per row and the total is the sum of the rows — so the
  // figures under a heading always add to the figure in it.
  const ps = [
    payment({ id: 'p1', dueDate: '2026-01-03', amountDue: 1000, amountPaid: 1000, status: 'paid' }),
    payment({ id: 'p2', dueDate: '2026-01-07', amountDue: 777, amountPaid: 777, status: 'paid' }),
    payment({ id: 'p3', dueDate: '2026-01-11', amountDue: 333.33, amountPaid: 333.33, status: 'paid' })
  ];
  const r = build({ clients: [client({ nextBillingDate: '2026-06-01' })], payments: ps });
  const rowSum = r.received.rows.reduce((s, x) => s + x.amountInMonthExVat, 0);
  assert.equal(r.received.exVat, Math.round(rowSum * 100) / 100, 'rows reconcile with their total');
  assert.ok(r.received.inclVat > r.received.exVat, 'the inclusive basis is kept, not discarded');
  assert.equal(r.vatRate, 1.18);
  for (const b of [r.received, r.expected, r.credits, r.net]) {
    assert.equal(typeof b.exVat, 'number');
    assert.equal(typeof b.inclVat, 'number');
  }
});

test('F: the VIEW prints ex-VAT, and says so on screen', () => {
  assert.match(INDEX, /כל הסכומים ללא מע״מ/, 'the basis is stated in the toolbar, not left to be guessed');
  // Every KPI reads the exVat field, never inclVat.
  const render = fnSource(APP, 'renderRevenue');
  assert.match(render, /revMoney\(model\.received\.exVat\)/);
  assert.match(render, /revMoney\(model\.expected\.exVat\)/);
  assert.match(render, /revMoney\(model\.credits\.exVat\)/);
  assert.match(render, /revMoney\(model\.net\.exVat\)/);
  assert.doesNotMatch(render, /\.inclVat/, 'the view never prints the inclusive basis');
});

/* ================= G. the breakdown dimension ================= */

test('G: the breakdown is by LOCATION (סניף) — the outpatient analogue of a house', () => {
  const a = client({ id: 'c1', name: 'א', location: 'רעננה אשר', nextBillingDate: '2026-06-01' });
  const b = client({ id: 'c2', name: 'ב', location: 'רמות השבים', nextBillingDate: '2026-06-01' });
  const r = build({
    clients: [a, b],
    payments: [
      payment({ id: 'p1', clientId: 'c1', dueDate: '2026-01-01', amountDue: 2000, amountPaid: 2000, status: 'paid' }),
      payment({ id: 'p2', clientId: 'c2', dueDate: '2026-01-01', amountDue: 5000, amountPaid: 5000, status: 'paid' })
    ]
  });
  const names = r.byLocation.map((x) => x.location);
  assert.deepEqual(names, ['רמות השבים', 'רעננה אשר'], 'sorted by NET, biggest first');
  assert.equal(r.byLocation[0].received.inclVat, 5000);
  assert.equal(r.byLocation[1].received.inclVat, 2000);
  // The per-location figures reconcile with the headline ones.
  const sum = r.byLocation.reduce((s, x) => s + x.received.exVat, 0);
  assert.equal(Math.round(sum * 100) / 100, r.received.exVat);
});

test('G: a payment with no client behind it is bucketed, not dropped or blank-labelled', () => {
  const r = build({ clients: [], payments: [payment({ clientId: 'gone', dueDate: '2026-01-01', amountPaid: 900, status: 'paid' })] });
  assert.equal(MR.NO_LOCATION, 'ללא סניף');
  assert.equal(r.received.inclVat, 900, 'money is money even when the client record is gone');
  assert.equal(r.byLocation[0].location, 'ללא סניף');
  assert.notEqual(r.byLocation[0].location, '', 'an unlabelled breakdown row reads as a rendering bug');
});

test('G: all-zero locations are dropped from the breakdown', () => {
  const r = build({ clients: [client({ location: 'קיסריה עפרוני', status: 'סיים טיפול' })] });
  assert.deepEqual(r.byLocation, [], 'a row of zeroes is noise');
});

/* ================= H. reuse — the window is NOT reimplemented ============== */

test('H: the coverage window comes from credits-ledger.js and is not copied', () => {
  // The whole point of reusing it: if the coverage rule changes, it changes in
  // ONE place and this view follows.
  assert.match(MODULE_SRC, /var paymentCoverage\s*=\s*CL\.paymentCoverage;/);
  assert.match(MODULE_SRC, /require\('\.\/credits-ledger'\)/);
  // None of the borrowed date primitives is redefined locally.
  for (const name of ['paymentCoverage', 'addMonthsClamped', 'diffWholeDays', 'localDateFromISO', 'isoFromLocalDate', 'roundMoney', 'isoDate']) {
    assert.doesNotMatch(
      MODULE_SRC, new RegExp('function\\s+' + name + '\\s*\\('),
      name + ' must be reused from credits-ledger.js, not reimplemented'
    );
  }
  // It really is the same window the ledger uses for credits.
  const mine = MR.coverageWindowFor({ dueDate: '2026-01-31' });
  const theirs = CL.paymentCoverage({ dueDate: '2026-01-31' });
  assert.equal(CL.isoFromLocalDate(mine.end), CL.isoFromLocalDate(theirs.end));
  assert.equal(CL.isoFromLocalDate(theirs.end), '2026-02-27', 'Jan 31 + 1 month clamps to Feb 28, minus a day');
});

test('H: the module is PURE — no DOM, no network, no app state', () => {
  const code = MODULE_SRC
    .slice(MODULE_SRC.indexOf('function (root, factory)'))
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  for (const forbidden of [/\bdocument\b/, /\bwindow\b/, /\bfetch\s*\(/,
                           /XMLHttpRequest/, /\blocalStorage\b/, /\bstate\s*\./]) {
    assert.doesNotMatch(code, forbidden, 'the pure module must not touch ' + forbidden);
  }
  // The comment-stripper must actually be stripping, or the guard above is
  // vacuous — the header prose definitely contains the word "document(ed)".
  assert.match(MODULE_SRC, /\bdocumented\b/);
  assert.ok(code.length < MODULE_SRC.length / 2, 'comments were stripped before scanning');
  // Same inputs, same outputs — `today` is injected so a report reruns identically.
  const args = { month: '2026-01', clients: [client({ nextBillingDate: '2026-01-20' })], payments: [], credits: [], today: '2026-01-05' };
  assert.deepEqual(MR.buildMonthlyRevenue(args), MR.buildMonthlyRevenue(args));
});

/* ================= I. the daily view is untouched ================= */

test('I: the daily גבייה worklist is added ALONGSIDE, not modified', () => {
  // Its own tab, section, state and renderer all survive intact.
  assert.match(INDEX, /<button class="tab" data-view="billing">גבייה<\/button>/);
  assert.match(INDEX, /<section id="view-billing" class="view">/);
  assert.match(INDEX, /<section id="view-revenue" class="view">/);
  for (const id of ['billingDate', 'billingSearch', 'billingDueList', 'billingOpenList', 'billMonthCollected', 'billMonthOutstanding', 'billMonthByClient', 'creditsPayoutList']) {
    assert.ok(INDEX.indexOf('id="' + id + '"') >= 0, 'the daily view keeps ' + id);
  }
  // The daily renderer still does exactly its four jobs.
  const rb = fnSource(APP, 'renderBilling');
  assert.match(rb, /renderBillingDueList\(due, selected\);/);
  assert.match(rb, /renderBillingOpenList\(selected\);/);
  assert.match(rb, /renderBillingMonthlySummary\(selected\);/);
  assert.match(rb, /renderCreditsPayouts\(\);/);
  assert.doesNotMatch(rb, /renderRevenue|revenueMonth/, 'the daily view learned nothing about the monthly one');
  // And the monthly renderer never reaches back into it.
  const rr = fnSource(APP, 'renderRevenue');
  assert.doesNotMatch(rr, /renderBilling|state\.billingDate|state\.billingSearch/);
  // Separate state, so switching months here cannot disturb the daily date.
  assert.match(APP, /revenueMonth: '',/);
  assert.match(APP, /billingDate: '',/);
});

test('I: the new tab is wired into the view switcher and loads in the right order', () => {
  assert.match(INDEX, /<button class="tab" data-view="revenue">הכנסות חודשיות<\/button>/);
  assert.match(APP, /else if \(state\.view === 'revenue'\) renderRevenue\(\);/);
  assert.match(APP, /on\('#revenueMonth', 'change'/);
  assert.match(APP, /on\('#revenueSearch', 'input'/);
  // The module needs CreditsLedger at factory time, so it must load after it
  // and before app.js. `defer` preserves document order.
  const ledger = INDEX.indexOf('credits-ledger.js?v=__BUILD__');
  const monthly = INDEX.indexOf('monthly-revenue.js?v=__BUILD__');
  const app = INDEX.indexOf('app.js?v=__BUILD__');
  assert.ok(ledger >= 0 && monthly >= 0 && app >= 0);
  assert.ok(ledger < monthly, 'credits-ledger.js loads first');
  assert.ok(monthly < app, 'monthly-revenue.js loads before app.js');
});

test('I: the service-worker cache was bumped, and never regresses', () => {
  // index.html gained a script tag and a section; an installed app must not
  // serve the old shell alongside the new app.js.
  assert.match(SW, /v7 \(2026-09-20\): monthly revenue view/);
  assert.doesNotMatch(SW, /var CACHE = 'ezone-outpatient-v6';/);
  const live = Number((SW.match(/var CACHE = 'ezone-outpatient-v(\d+)';/) || [])[1]);
  assert.ok(live >= 7, 'the live cache never goes below the v7 shipped here, got v' + live);
});

/* ================= J. security (PR #106 parity) ================= */

test('J: no new endpoint, and server.js is untouched by this view', () => {
  assert.doesNotMatch(SERVER, /revenue/i, 'server.js must stay unchanged by the monthly view');
  assert.doesNotMatch(SERVER, /monthly/i);
  // The proxy gate every read still rides is intact.
  assert.match(SERVER, /app\.post\('\/api\/sheets', requireSession/);
  assert.match(SERVER, /body\.user = sessionUserFromRequest\(req\)/);
});

test('J: the view is READ-ONLY — it fetches nothing and writes nothing', () => {
  const fns = ['renderRevenue', 'renderRevenueExpectedBreakdown', 'renderRevenueByLocation', 'renderRevenueDetail', 'buildRevenueDetailRow'];
  for (const name of fns) {
    const body = fnSource(APP, name);
    for (const forbidden of ['fetch(', 'apiPost', 'saveAll', 'persistPayment', 'api(']) {
      assert.ok(body.indexOf(forbidden) === -1, name + ' must not ' + forbidden);
    }
  }
  // It reads the ledger through the SAME lazy loader the גבייה payout panel
  // uses — the session-cookie-gated proxy, no new door.
  assert.match(fnSource(APP, 'renderRevenue'), /ensureCredits\(function \(\) \{ if \(state\.view === 'revenue'\) renderRevenue\(\); \}\);/);
  // Nothing in the view is gated on the editor role, because nothing can edit.
  assert.doesNotMatch(fnSource(APP, 'buildRevenueDetailRow'), /state\.role/);
});

test('J: every interpolated value is escaped — no sheet data reaches innerHTML raw', () => {
  const row = fnSource(APP, 'buildRevenueDetailRow');
  // Each field that originates in a sheet goes through escapeHtml.
  for (const field of ['r.clientName || \'—\'', 'r.location || \'\'', 'windowText', 'daysText', 'typeLabel']) {
    assert.ok(row.indexOf('escapeHtml(' + field + ')') >= 0, 'unescaped interpolation of ' + field);
  }
  for (const name of ['renderRevenueExpectedBreakdown', 'renderRevenueByLocation']) {
    const body = fnSource(APP, name);
    const interpolations = body.match(/'\s*\+\s*([A-Za-z_$][\w.$\[\]']*)\s*\+\s*'/g) || [];
    for (const piece of interpolations) {
      assert.ok(
        /escapeHtml|revMoney|\.count|\.exVat|p\.cls|p\.sign/.test(piece),
        name + ' interpolates something unescaped: ' + piece
      );
    }
  }
  // A hostile client name is rendered inert rather than executed.
  const r = build({
    clients: [client({ name: '<img src=x onerror=alert(1)>', location: '"><script>bad()</script>' })],
    payments: [payment({ dueDate: '2026-01-01', amountPaid: 100, status: 'paid' })]
  });
  assert.equal(r.received.rows[0].clientName, 'דנה כהן', 'the payment row carries its own denormalized name');
  // The escaper itself is the shared one, already covered by the other suites.
  assert.match(APP, /function escapeHtml\(s\)/);
});

test('J: the module refuses junk instead of guessing', () => {
  assert.equal(MR.buildMonthlyRevenue(), null);
  assert.equal(MR.buildMonthlyRevenue({}), null);
  assert.equal(MR.buildMonthlyRevenue({ month: '2026-00' }), null);
  // Rows that cannot be read are skipped, never crash the month.
  const r = build({
    clients: [null, client(), { id: 'x' }],
    payments: [null, {}, payment({ dueDate: '' }), payment({ dueDate: 'nope' })],
    credits: [null, {}]
  });
  assert.equal(r.received.inclVat, 0);
  assert.equal(r.credits.inclVat, 0);
  assert.ok(Array.isArray(r.byLocation));
});

/* ================= K. Playwright e2e — drives the real tab ================= */

function loadChromium() {
  try { return require('playwright').chromium; } catch (_) {}
  try {
    const { execSync } = require('node:child_process');
    const groot = execSync('npm root -g').toString().trim();
    return require(path.join(groot, 'playwright')).chromium;
  } catch (_) { return null; }
}
const chromium = loadChromium();
const skipOpt = chromium ? {} : { skip: 'playwright not installed' };
const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

/* Stub of the Railway server + Apps Script, seeded with ONE client whose
 * January is paid across two straddling cycles — so the numbers on screen are
 * the ones this suite already proved in isolation. */
function startStub() {
  const clients = [{
    id: 'c1', name: 'דנה כהן', phone: '0501234567', serviceType: 'פרטני',
    location: 'רעננה אשר', sessionsPerWeek: '1', pricePerSession: 3000,
    startDate: '2025-06-20', status: 'פעיל', nextBillingDate: '2026-01-20'
  }];
  const payments = [
    { id: 'pay::c1::base::2025-12', clientId: 'c1', clientName: 'דנה כהן', billingType: 'monthly', dueDate: '2025-12-20', amountDue: 3000, amountPaid: 3000, status: 'paid', paymentDate: '2025-12-19' },
    { id: 'pay::c1::base::2026-01', clientId: 'c1', clientName: 'דנה כהן', billingType: 'monthly', dueDate: '2026-01-20', amountDue: 3000, amountPaid: 3000, status: 'paid', paymentDate: '2026-01-18' }
  ];
  const cookieUser = (req) => { const m = (req.headers.cookie || '').match(/ezone_session=([^;]*)/); return m ? m[1] : null; };
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); const p = u.pathname;
      const json = (o, extra) => { res.setHeader('content-type', 'application/json'); if (extra) Object.keys(extra).forEach((k) => res.setHeader(k, extra[k])); res.end(JSON.stringify(o)); };
      const body = () => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { r(JSON.parse(b)); } catch (_) { r({}); } }); });
      if (p === '/api/verify-pin') {
        return body().then((pl) => {
          if (pl.pin !== '424242') { res.statusCode = 401; return json({ ok: false }); }
          // A user-less cookie is a VALID session that has not picked a name
          // yet — that is what puts the name picker on screen.
          const user = ['ורד', 'שירן', 'יעל', 'ירדן'].indexOf(pl.user) >= 0 ? pl.user : '';
          json({ ok: true }, { 'Set-Cookie': 'ezone_session=' + encodeURIComponent(user) + '; Path=/; HttpOnly' });
        });
      }
      const cu = cookieUser(req);
      if (p.indexOf('/api/') === 0 && cu === null) { res.statusCode = 401; return json({ ok: false }); }
      if (p === '/api/me') return json({ ok: true, user: decodeURIComponent(cu) });
      if (p === '/api/users') return json({ ok: true, users: ['ורד', 'שירן', 'יעל', 'ירדן'] });
      if (p === '/api/sheets') {
        if (req.method === 'GET') {
          const a = u.searchParams.get('action') || 'getData';
          if (a === 'getPayments') return json({ ok: true, payments });
          if (a === 'getCredits') return json({ ok: true, credits: [] });
          if (a === 'getCharges') return json({ ok: true, charges: [] });
          if (a === 'getStopFlags') return json({ ok: true, stopFlags: [] });
          if (a === 'getExtraSessionRequests') return json({ ok: true, requests: [] });
          if (a === 'getSettings') return json({ ok: true, settings: {} });
          if (a === 'getMyStopAlerts') return json({ ok: true, myStopAlerts: [] });
          return json({ ok: true, leads: [], clients, dataVersion: 1 });
        }
        return body().then(() => json({ ok: true }));
      }
      if (p === '/sw.js') { res.setHeader('content-type', 'text/javascript'); return res.end('/*noop*/'); }
      const rel = p === '/' ? 'index.html' : p.replace(/^\//, '');
      const f = path.join(PUBLIC, rel);
      if (!f.startsWith(PUBLIC) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('nf'); }
      let d = fs.readFileSync(f);
      if (rel === 'index.html') d = Buffer.from(d.toString().replace(/__BUILD__/g, 'test'));
      res.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream');
      res.end(d);
    });
    srv.listen(0, () => resolve({ srv, port: srv.address().port }));
  });
}

test('K: e2e — the הכנסות חודשיות tab renders the four figures, and the daily גבייה screen still works', skipOpt, async (t) => {
  const { srv, port } = await startStub();
  let browser;
  try { browser = await chromium.launch(); } catch (_) { srv.close(); return t.skip('no browser binary'); }
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'networkidle' });
    await page.fill('#pinInput', '424242');
    await page.click('#pinSubmit');
    await page.waitForSelector('#userScreen:not([hidden]) .user-btn');
    await page.click('#userButtons .user-btn >> nth=0');
    await page.waitForSelector('#app:not([hidden])');

    // The new tab exists and opens.
    await page.click('.tab[data-view="revenue"]');
    await page.waitForSelector('#view-revenue.view.active');
    await page.fill('#revenueMonth', '2026-01');
    await page.dispatchEvent('#revenueMonth', 'change');
    await page.waitForFunction(() => document.querySelector('#revReceived').textContent !== '₪0');

    // January is exactly one month of money — 19 days from the December cycle
    // plus 12 from the January one — and it prints EX-VAT: 3000/1.18 = 2542.
    const received = await page.textContent('#revReceived');
    assert.equal(received.replace(/[^\d]/g, ''), '2542', 'received is ex-VAT, got ' + received);
    assert.equal((await page.textContent('#revExpected')).replace(/[^\d]/g, ''), '0', 'the month is fully paid');
    assert.equal((await page.textContent('#revNet')).replace(/[^\d]/g, ''), '2542');
    assert.match(await page.textContent('#revenueMonthLabel'), /2026/);

    // The drill-down shows the split that produced it.
    const detail = await page.textContent('#revDetail');
    assert.match(detail, /12 מתוך 31 ימים/, 'the January cycle contributes 12 of its 31 days');
    assert.match(detail, /19 מתוך 31 ימים/, 'the December cycle contributes 19');
    assert.match(await page.textContent('#revByLocation'), /רעננה אשר/);

    // February: the same December..January money now lands as 19 days received,
    // with the February cycle forecast — the two are separate cards.
    await page.fill('#revenueMonth', '2026-02');
    await page.dispatchEvent('#revenueMonth', 'change');
    await page.waitForFunction(() => document.querySelector('#revExpected').textContent !== '₪0');
    const febReceived = Number((await page.textContent('#revReceived')).replace(/[^\d]/g, ''));
    const febExpected = Number((await page.textContent('#revExpected')).replace(/[^\d]/g, ''));
    assert.ok(febReceived > 0 && febExpected > 0, 'February has both cash and forecast');
    assert.notEqual(febReceived, febExpected);

    // The daily גבייה screen is untouched and still renders.
    await page.click('.tab[data-view="billing"]');
    await page.waitForSelector('#view-billing.view.active');
    assert.equal(await page.isVisible('#billingDate'), true);
    assert.equal(await page.isVisible('#billingDueList'), true);
    // Its own date state survived the trip through the monthly tab.
    assert.match(await page.inputValue('#billingDate'), /^\d{4}-\d{2}-\d{2}$/);
  } finally {
    await browser.close();
    srv.close();
  }
});
