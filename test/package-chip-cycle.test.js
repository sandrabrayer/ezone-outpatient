'use strict';

/**
 * Coverage for "paid/due everywhere follows the billing cycle" (Handoff 7):
 * packages are cycles (paid date -> next billing date), not calendar months,
 * and since #94 nextBillingDate advances exactly when a payment is recorded,
 * so it is the single source of truth:
 *
 *   paid-up ⇔ nextBillingDate non-blank AND >= today   (until = that date)
 *   unpaid  ⇔ blank or < today
 *
 * Covered here:
 *  - packagePaidState (the pure rule, charges-logic + app.js parity)
 *  - the card chip state/label/tooltips (עידו: paid 31/8, next 30/09, today
 *    1/9 -> שולם עד 30/09 ✓ — no more false לא שולם on straddled cycles)
 *  - chip mark/unmark writes the CYCLE row — the same row id חידוש ותשלום and
 *    the edit-modal propagation write (parity), advancing per the #94 rule
 *  - the גבייה tab: a client is due on X iff nextBillingDate === X
 *  - renewalInfo now keys "settled" on the same rule (its behavior tests live
 *    in test/month-paid-advances-billing.test.js, updated in lockstep)
 *
 * Run with:  npm test     (Node >= 18, built-in runner)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const {
  packagePaidState,
  nextCycleDueDateAfter,
  nextRenewalDueDate,
  dueItemsOn,
  paymentId,
  basePaymentPaidOn,
} = require('../public/charges-logic.js');

// --- extract a whole `function name(...) {...}` out of app.js (balanced) -----
function fnSource(name) {
  const sig = 'function ' + name + '(';
  const start = APP.indexOf(sig);
  assert.notEqual(start, -1, name + ' not found in app.js');
  const open = APP.indexOf('{', start);
  let depth = 0, end = -1;
  for (let j = open; j < APP.length; j++) {
    if (APP[j] === '{') depth++;
    else if (APP[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  assert.notEqual(end, -1, name + ' has unbalanced braces');
  return APP.slice(start, end + 1);
}

// Build the REAL app.js date helpers with an injectable today() — no mirrors.
function appEnv(todayIso) {
  // eslint-disable-next-line no-new-func
  return new Function(
    'var TODAY = ' + JSON.stringify(todayIso) + ';\n' +
    'function today() { return TODAY; }\n' +
    'function toNum(v) { if (v === "" || v === null || v === undefined) return 0; var n = Number(v); return isFinite(n) ? n : 0; }\n' +
    'function fmtDate(v) { if (!v) return ""; var s = String(v); if (s.indexOf("T") !== -1) s = s.split("T")[0]; return s; }\n' +
    fnSource('dayOfMonth') + '\n' +
    fnSource('lastDayOfMonth') + '\n' +
    fnSource('addMonth') + '\n' +
    fnSource('currentMonthBaseDueDate') + '\n' +
    fnSource('clampedCycleIso') + '\n' +
    fnSource('nextCycleDueDate') + '\n' +
    fnSource('nextCycleDueDateAfter') + '\n' +
    fnSource('cyclePaymentDueDate') + '\n' +
    fnSource('prevCycleDueDateBefore') + '\n' +
    fnSource('packagePaidState') + '\n' +
    'return { currentMonthBaseDueDate: currentMonthBaseDueDate, cyclePaymentDueDate: cyclePaymentDueDate,' +
    ' prevCycleDueDateBefore: prevCycleDueDateBefore, packagePaidState: packagePaidState,' +
    ' nextCycleDueDateAfter: nextCycleDueDateAfter, today: today };'
  )();
}

const SEPT1 = '2026-09-01';

// ─────────────────────────────────────────────────────────────────────────────
// packagePaidState — the pure rule
// ─────────────────────────────────────────────────────────────────────────────

test('packagePaidState: future anchor -> paid, until = the anchor', () => {
  assert.deepEqual(packagePaidState({ nextBillingDate: '2026-09-30' }, SEPT1),
    { paid: true, until: '2026-09-30' });
});

test('packagePaidState: anchor today -> still paid (due today, not overdue)', () => {
  assert.deepEqual(packagePaidState({ nextBillingDate: SEPT1 }, SEPT1),
    { paid: true, until: SEPT1 });
});

test('packagePaidState: anchor yesterday -> unpaid', () => {
  assert.deepEqual(packagePaidState({ nextBillingDate: '2026-08-31' }, SEPT1),
    { paid: false, until: '' });
});

test('packagePaidState: blank / missing anchor -> unpaid', () => {
  assert.deepEqual(packagePaidState({ nextBillingDate: '' }, SEPT1), { paid: false, until: '' });
  assert.deepEqual(packagePaidState({}, SEPT1), { paid: false, until: '' });
  assert.deepEqual(packagePaidState(null, SEPT1), { paid: false, until: '' });
});

test('keep-in-sync: app.js packagePaidState behaves exactly like charges-logic', () => {
  const env = appEnv(SEPT1);
  for (const nbd of ['2026-09-30', SEPT1, '2026-08-31', '', undefined]) {
    const c = { nextBillingDate: nbd };
    assert.deepEqual(env.packagePaidState(c, SEPT1), packagePaidState(c, SEPT1), String(nbd));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Chip state + label
// ─────────────────────────────────────────────────────────────────────────────

// Mirror of the chip label build in renderClients — keep in sync (guarded below).
function chipLabel(c, todayIso) {
  const pkg = packagePaidState(c, todayIso);
  const untilDM = pkg.until ? pkg.until.slice(8, 10) + '/' + pkg.until.slice(5, 7) : '';
  return pkg.paid ? 'שולם עד ' + untilDM + ' ✓' : 'לא שולם ✓';
}

test('עידו: paid ₪4000 on 31/8, next 30/09, today 1/9 -> שולם עד 30/09 ✓', () => {
  const ido = { id: 'ido', nextBillingDate: '2026-09-30', paymentDate: '2026-08-31' };
  assert.equal(chipLabel(ido, SEPT1), 'שולם עד 30/09 ✓');
});

test('מנשה: next 08/09 -> paid (שולם עד 08/09 ✓)', () => {
  assert.equal(chipLabel({ nextBillingDate: '2026-09-08' }, SEPT1), 'שולם עד 08/09 ✓');
});

test('a patient whose גבייה הבאה is 29/08 (past) -> לא שולם ✓', () => {
  assert.equal(chipLabel({ nextBillingDate: '2026-08-29' }, SEPT1), 'לא שולם ✓');
});

test('app.js wiring: chip renders from packagePaidState with the cycle labels + tooltips', () => {
  assert.match(APP, /var pkg = packagePaidState\(c, today\(\)\)/);
  assert.match(APP, /data-action="mark-month-unpaid" title="החבילה הנוכחית שולמה; גבייה הבאה ' \+ displayDate\(pkg\.until\) \+ '">שולם עד ' \+ untilDM \+ ' ✓</);
  assert.match(APP, /data-action="mark-month-paid" title="סמן את החבילה כשולמה — יזיז את גבייה הבאה למחזור הבא">לא שולם ✓</);
  // the calendar-month lookup is gone from the chip
  assert.doesNotMatch(APP, /var basePay = paymentForClientOn\(c, currentMonthBaseDueDate\(c\)\)/);
});

test('app.js wiring: שולם ב shows the payment date of the row covering the current cycle', () => {
  assert.match(APP, /paymentForClientOn\(c, prevCycleDueDateBefore\(c, pkg\.until\) \|\| pkg\.until\)/);
  assert.match(APP, /\(cycleRow\.status === 'paid' && cycleRow\.paymentDate\) \|\| c\.paymentDate/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Chip mark/unmark — the cycle row, converging with חידוש ותשלום + edit modal
// ─────────────────────────────────────────────────────────────────────────────

test('cyclePaymentDueDate: due anchor (past/today) -> the anchor; else the month base due', () => {
  const env = appEnv(SEPT1);
  // stale anchor: settle THAT cycle
  assert.equal(env.cyclePaymentDueDate({ nextBillingDate: '2026-08-30', billingDay: 30 }, SEPT1), '2026-08-30');
  // anchor due today
  assert.equal(env.cyclePaymentDueDate({ nextBillingDate: SEPT1, billingDay: 1 }, SEPT1), SEPT1);
  // blank anchor: fall back to the current month's base due date
  assert.equal(env.cyclePaymentDueDate({ nextBillingDate: '', billingDay: 10 }, SEPT1), '2026-09-10');
});

test('parity: the chip mark writes the SAME Payments row id as חידוש ותשלום', () => {
  const env = appEnv(SEPT1);
  const c = { id: 'ido', name: 'עידו', billingDay: 30, nextBillingDate: '2026-08-30' };
  // chip: the cycle row for the due anchor
  const chipRowId = paymentId(c.id, env.cyclePaymentDueDate(c, SEPT1), 'base');
  // renew modal: renewalDate = nextRenewalDueDate(c) || currentMonthBaseDueDate(c)
  const renewalDate = nextRenewalDueDate(c) || env.currentMonthBaseDueDate(c);
  const renewRowId = basePaymentPaidOn(c, renewalDate, 4000, '2026-08-31', '').id;
  assert.equal(chipRowId, renewRowId);
  assert.equal(chipRowId, 'pay::ido::base::2026-08');
});

test('parity: the edit-modal propagation writes the same cycle row as the chip', () => {
  // Both call the ONE helper (no second implementation) — source-locked…
  const editBlock = APP.match(/var propagatePaid =[\s\S]{0,2000}basePaymentPaidOn\(client, cycleDueISO/);
  assert.ok(editBlock, 'edit modal must build the row from cycleDueISO');
  assert.match(editBlock[0], /cycleDueISO = cyclePaymentDueDate\(client, today\(\)\)/);
  assert.match(fnSource('setCurrentMonthPaid'), /cyclePaymentDueDate\(c, todayIso\)/);
  // …and produce the same id for the same patient/date.
  const env = appEnv(SEPT1);
  const c = { id: 'ido', name: 'עידו', billingDay: 30, nextBillingDate: '2026-08-30' };
  const due = env.cyclePaymentDueDate(c, SEPT1);
  assert.equal(basePaymentPaidOn(c, due, 4000, SEPT1, '').id,
    paymentId(c.id, due, 'base'));
});

test('mark advances the anchor per the #94 rule (עידו: settle 30/08 -> next 30/09)', () => {
  const env = appEnv(SEPT1);
  const c = { id: 'ido', billingDay: 30, nextBillingDate: '2026-08-30' };
  const due = env.cyclePaymentDueDate(c, SEPT1);
  assert.equal(env.nextCycleDueDateAfter(c, due), '2026-09-30');
  assert.equal(nextCycleDueDateAfter(c, due), '2026-09-30'); // charges-logic agrees
});

test('unmark: prevCycleDueDateBefore finds the settled cycle when memory is gone', () => {
  const env = appEnv(SEPT1);
  // After עידו's mark the anchor is 30/09; the row that was settled is 30/08.
  assert.equal(env.prevCycleDueDateBefore({ billingDay: 30 }, '2026-09-30'), '2026-08-30');
  // Billing day clamps in short months both ways.
  assert.equal(env.prevCycleDueDateBefore({ billingDay: 31 }, '2026-03-31'), '2026-02-28');
  // No billing-day anchor: keep the anchor's own day in the previous month.
  assert.equal(env.prevCycleDueDateBefore({}, '2026-09-15'), '2026-08-15');
});

test('app.js wiring: mark/unmark key on the cycle row and remember dueDateISO for the revert', () => {
  const fn = fnSource('setCurrentMonthPaid');
  assert.match(fn, /dueDateISO = cyclePaymentDueDate\(c, todayIso\)/);
  assert.match(fn, /\(prevRemembered && prevRemembered\.dueDateISO\) \|\|\s*\n\s*prevCycleDueDateBefore\(c, c\.nextBillingDate\)/);
  assert.match(fn, /dueDateISO: dueDateISO \}/);
  // the advance + revert values are unchanged from #94
  assert.match(fn, /nextCycleDueDateAfter\(c, dueDateISO\)/);
  assert.match(fn, /\{ nextBillingDate: dueDateISO, paymentDate: c\.paymentDate \}/);
});

// ─────────────────────────────────────────────────────────────────────────────
// גבייה tab: due on X ⇔ nextBillingDate === X (base); extras unchanged
// ─────────────────────────────────────────────────────────────────────────────

test('גבייה: עידו appears under 30/09 and NOT under his billing-day date 08/09', () => {
  const ido = {
    id: 'ido', status: 'פעיל', billingDay: 8,
    nextBillingDate: '2026-09-30', pricePerSession: 4000,
  };
  const on30 = dueItemsOn([ido], [], '2026-09-30');
  assert.equal(on30.length, 1);
  assert.equal(on30[0].kind, 'base');
  assert.equal(on30[0].amount, 4000);
  assert.deepEqual(dueItemsOn([ido], [], '2026-09-08'), []);
});

test('גבייה totals follow the cycle rows: sum of clients whose anchor IS the date', () => {
  const clients = [
    { id: 'a', status: 'פעיל', nextBillingDate: '2026-09-30', pricePerSession: 4000 },
    { id: 'b', status: 'פעיל', nextBillingDate: '2026-09-30', pricePerSession: 1800 },
    { id: 'c', status: 'פעיל', nextBillingDate: '2026-09-08', pricePerSession: 2000 },
    { id: 'd', status: 'פעיל', nextBillingDate: '', pricePerSession: 999 },
  ];
  const due = dueItemsOn(clients, [], '2026-09-30');
  assert.equal(due.reduce((s, x) => s + x.amount, 0), 5800);
});

test('גבייה: extras keep their own billing-day/one-time rules (unchanged)', () => {
  const c = { id: 'a', status: 'פעיל', nextBillingDate: '2026-10-02', pricePerSession: 1000 };
  const charges = [
    { id: 'm1', clientId: 'a', active: true, billingType: 'monthly', billingDay: 15, chargeDate: '2026-05-15', amount: 500 },
    { id: 'o1', clientId: 'a', active: true, billingType: 'one_time', chargeDate: '2026-09-15', amount: 300 },
  ];
  const due = dueItemsOn([c], charges, '2026-09-15');
  assert.deepEqual(due.map((x) => x.kind), ['extra', 'extra']); // no base on the 15th
});

test('app.js wiring: clientsDueOn keys base rows on nextBillingDate; note rendered above the list', () => {
  const src = fnSource('clientsDueOn');
  assert.match(src, /fmtDate\(c\.nextBillingDate\) === dateISO/);
  assert.doesNotMatch(src, /effective === d/);
  assert.match(HTML, /<div class="billing-list-note">לפי גבייה הבאה של כל מטופל<\/div>/);
});

// ─────────────────────────────────────────────────────────────────────────────
// renewalInfo + contracts
// ─────────────────────────────────────────────────────────────────────────────

test('app.js wiring: renewalInfo keys "settled" on packagePaidState, grace window kept', () => {
  const fn = fnSource('renewalInfo');
  assert.match(fn, /packagePaidState\(c, today\(\)\)\.paid/);
  assert.doesNotMatch(fn, /paymentForClientOn\(c, curDue\)/);
  assert.match(fn, /today\(\) < curDue && prevMonthBasePaid\(c\)/); // #94 grace window intact
});

test('cross-app contracts untouched (getTreatmentPlans / getDebtStatus read stored values)', () => {
  const GS = fs.readFileSync(path.join(ROOT, 'apps-script', 'Code.gs'), 'utf8');
  assert.match(GS, /renewalDate: _renewalDueDate\(/);
  assert.match(GS, /function _getDebtStatus/);
});
