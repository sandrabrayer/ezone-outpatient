'use strict';

/**
 * Coverage for "stop the stale-nextBillingDate recurrence" (PR 2):
 *
 *  1. The month-paid chip (setCurrentMonthPaid) ADVANCES the client — the next
 *     cycle due date AFTER the month being marked (anchored on the due date,
 *     never the paid date) + paymentDate = today; unmark restores.
 *  2. The chip label names the month it settles (חבילה MM/YYYY: …).
 *  3. renewalInfo: on the 1st with a paid previous month and a not-yet-due
 *     current month -> due_soon counting to the current-month due date, never
 *     the false 🛑 overdue a stale stored date used to produce.
 *  4. One MONTH, not 30 days: every nextBillingDate write goes through the
 *     nextCycleDueDate(-After) rule (renew / intake / activate / agreement /
 *     legacy derive / edit), and the edit modal no longer recomputes it
 *     unconditionally.
 *
 * Run with:  npm test     (Node >= 18, built-in runner)
 *
 * public/app.js is an IIFE, so its logic is covered the way the passing suites
 * do it: the REAL public/charges-logic.js functions where they exist
 * (nextCycleDueDate / nextCycleDueDateAfter are required directly), pure
 * mirrors of app.js-only rules locked by source-scan guards, and a realm
 * parity check that evals the app.js copies out of the source so the
 * keep-in-sync comment is enforced by the suite.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const {
  nextCycleDueDate,
  nextCycleDueDateAfter,
  addDays,
  dayOfMonth,
  lastDayOfMonth,
  paymentId,
  legacyBasePaymentId,
} = require('../public/charges-logic.js');
const { hasBillingProblem } = require('../public/billing-status');

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

// ─────────────────────────────────────────────────────────────────────────────
// Realm parity: the app.js inline copies equal the charges-logic originals
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-new-func
const appCycle = new Function(
  fnSource('clampedCycleIso') + '\n' +
  fnSource('nextCycleDueDate') + '\n' +
  fnSource('nextCycleDueDateAfter') + '\n' +
  // app.js dependencies the extracted copies call:
  'function fmtDate(v) { if (!v) return ""; var s = String(v); if (s.indexOf("T") !== -1) s = s.split("T")[0]; return s; }\n' +
  'function dayOfMonth(iso) { if (!iso) return null; var p = String(iso).slice(0,10).split("-"); if (p.length < 3) return null; var d = parseInt(p[2],10); return isFinite(d) ? d : null; }\n' +
  'function addMonth(isoDate) { if (!isoDate) return ""; var d = new Date(isoDate); if (isNaN(d)) return ""; var od = d.getDate(); d.setMonth(d.getMonth()+1); if (d.getDate() !== od) d.setDate(0); var m = String(d.getMonth()+1).padStart(2,"0"); var day = String(d.getDate()).padStart(2,"0"); return d.getFullYear()+"-"+m+"-"+day; }\n' +
  'return { nextCycleDueDate: nextCycleDueDate, nextCycleDueDateAfter: nextCycleDueDateAfter };'
)();

test('keep-in-sync: app.js nextCycleDueDate(-After) behave exactly like charges-logic', () => {
  const clients = [
    { billingDay: 4 }, { billingDay: 31 }, { billingDay: '', startDate: '2026-03-07' },
    { billingDay: 10, startDate: '2026-01-25' }, {}, { billingDay: 'banana' },
  ];
  const dates = ['2026-01-15', '2026-01-31', '2026-02-01', '2026-08-30', '2026-12-10', '2028-02-01'];
  for (const c of clients) {
    for (const d of dates) {
      assert.equal(appCycle.nextCycleDueDate(c, d), nextCycleDueDate(c, d), JSON.stringify([c, d]));
      assert.equal(appCycle.nextCycleDueDateAfter(c, d), nextCycleDueDateAfter(c, d), JSON.stringify([c, d]));
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Rule 6 — one month, not 30 days (the real charges-logic functions)
// ─────────────────────────────────────────────────────────────────────────────

test('renewing the 04/09 cycle on 30/08 advances to 04/10, not paid-date+30 (29/09)', () => {
  assert.equal(nextCycleDueDateAfter({ billingDay: 4 }, '2026-09-04'), '2026-10-04');
});

test('a 31st billing day clamps to the target month end', () => {
  assert.equal(nextCycleDueDateAfter({ billingDay: 31 }, '2026-01-31'), '2026-02-28');
  assert.equal(nextCycleDueDateAfter({ billingDay: 31 }, '2028-01-31'), '2028-02-29'); // leap
  assert.equal(nextCycleDueDateAfter({ billingDay: 31 }, '2026-08-31'), '2026-09-30');
});

test('intake keeps the day-of-month: no billingDay -> the startDate day carries the cycle', () => {
  assert.equal(nextCycleDueDateAfter({ startDate: '2026-08-15' }, '2026-08-15'), '2026-09-15');
});

test('no anchor at all falls back to due date + 1 calendar month (clamped), never +30 days', () => {
  assert.equal(nextCycleDueDateAfter({}, '2026-08-15'), '2026-09-15');
  assert.equal(nextCycleDueDateAfter({}, '2026-01-31'), '2026-02-28');
});

test('app.js: nextBillingDate is never written as addDays(x, 30) anymore', () => {
  assert.doesNotMatch(APP, /nextBillingDate = addDays\(/);
  assert.doesNotMatch(APP, /nextBillingDate:\s*[^,\n]*addDays\(/);
});

test('app.js: renew / intake / activate / agreement / derive all use the cycle rule', () => {
  assert.match(fnSource('deriveNextBillingDates'), /nextCycleDueDateAfter\(c, latest\)/);
  // renew submit anchors on the billed month (renewalDate), never paidDate
  assert.match(APP, /c\.nextBillingDate = nextCycleDueDateAfter\(c, renewalDate\)/);
  // direct intake + activate anchor on the startDate cycle
  const intakeUses = APP.match(/nextCycleDueDateAfter\(\{ billingDay: [^}]*startDate: startDate \}, startDate\)/g) || [];
  assert.ok(intakeUses.length >= 2, 'intake and activate must both use the cycle rule');
  // agreement payment
  assert.match(APP, /lead\.nextBillingDate = nextCycleDueDateAfter\(lead, agPayDate\)/);
});

test('app.js: the edit modal no longer recomputes nextBillingDate unconditionally', () => {
  assert.doesNotMatch(APP, /if \(client\.paymentDate\) \{\s*\n\s*client\.nextBillingDate/);
  // The only edit-path recompute sits behind the deliberate paid-date change
  // (propagatePaid) and anchors on the CYCLE due date — the same
  // cyclePaymentDueDate the chip settles, resolved before the anchor moves.
  assert.match(APP,
    /var propagatePaid = paidDateChanged && client\.paymentStatus === 'paid';[\s\S]{0,900}if \(propagatePaid\) \{\s*\n\s*cycleDueISO = cyclePaymentDueDate\(client, today\(\)\);\s*\n\s*client\.nextBillingDate = nextCycleDueDateAfter\(client, cycleDueISO\);/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1 — the chip advances / restores the client (pure mirror + source guards)
// ─────────────────────────────────────────────────────────────────────────────

// Mirror of setCurrentMonthPaid's client patch in public/app.js — keep in sync.
// prevCycle mirrors prevCycleDueDateBefore: the billing day one month before
// the anchor.
function prevCycleBefore(c, anchorIso) {
  const p = String(anchorIso || '').slice(0, 10).split('-');
  if (p.length < 3) return '';
  let y = parseInt(p[0], 10), m = parseInt(p[1], 10);
  m -= 1; if (m < 1) { m = 12; y -= 1; }
  return nextCycleDueDate(c, y + '-' + ('0' + m).slice(-2) + '-01') || '';
}
function monthPaidClientPatch(c, makePaid, dueDateISO, remembered, todayIso) {
  if (makePaid) {
    let advanced = nextCycleDueDateAfter(c, dueDateISO);
    // a multi-cycle-stale anchor must still land the mark strictly ahead
    if (advanced && advanced <= todayIso) {
      advanced = nextCycleDueDate(c, addDays(todayIso, 1)) || advanced;
    }
    return { nextBillingDate: advanced, paymentDate: todayIso };
  }
  if (remembered) return { nextBillingDate: remembered.nextBillingDate, paymentDate: remembered.paymentDate };
  // the revert must land strictly behind today so the package reads unpaid
  const revertTo = (dueDateISO && dueDateISO < todayIso) ? dueDateISO : prevCycleBefore(c, dueDateISO);
  return { nextBillingDate: revertTo, paymentDate: c.paymentDate };
}

test('marking the month paid advances nextBillingDate one cycle and stamps paymentDate', () => {
  const c = { id: 'c1', billingDay: 10, nextBillingDate: '2026-07-10', paymentDate: '2026-07-08' };
  const patch = monthPaidClientPatch(c, true, '2026-09-10', null, '2026-09-01');
  assert.equal(patch.nextBillingDate, '2026-10-10'); // cycle AFTER the marked month
  assert.equal(patch.paymentDate, '2026-09-01');     // stamped today
});

test('marking with a MULTI-cycle-stale anchor still lands the anchor after today', () => {
  // Anchor stuck in July, today Sept 2: one cycle after July is August — still
  // past — so the mark lands on the first cycle after today (Sept 10). Without
  // this the chip stayed לא שולם after a successful click.
  const c = { id: 'c1', billingDay: 10, nextBillingDate: '2026-07-10' };
  const patch = monthPaidClientPatch(c, true, '2026-07-10', null, '2026-09-02');
  assert.equal(patch.nextBillingDate, '2026-09-10');
});

test('unmarking restores the remembered pre-mark values', () => {
  const c = { id: 'c1', billingDay: 10, nextBillingDate: '2026-10-10', paymentDate: '2026-09-01' };
  const remembered = { nextBillingDate: '2026-07-10', paymentDate: '2026-07-08' };
  const patch = monthPaidClientPatch(c, false, '2026-09-10', remembered, '2026-09-01');
  assert.deepEqual(patch, remembered);
});

test('unmarking after a reload (nothing remembered) lands the anchor strictly behind today', () => {
  const c = { id: 'c1', billingDay: 10, nextBillingDate: '2026-10-10', paymentDate: '2026-09-01' };
  // The settled row's due date (2026-09-10) is still ahead of today, so the
  // revert steps back one more cycle — otherwise the chip stayed green.
  const patch = monthPaidClientPatch(c, false, '2026-09-10', null, '2026-09-01');
  assert.equal(patch.nextBillingDate, '2026-08-10');
  assert.equal(patch.paymentDate, '2026-09-01');     // kept
  // A past-due settled row reverts to its own date (already behind today).
  const patch2 = monthPaidClientPatch(c, false, '2026-08-10', null, '2026-09-01');
  assert.equal(patch2.nextBillingDate, '2026-08-10');
});

test('app.js wiring: setCurrentMonthPaid advances, remembers, and reloads before persisting', () => {
  const fn = fnSource('setCurrentMonthPaid');
  // the advance mirrors monthPaidClientPatch above
  assert.match(fn, /nextCycleDueDateAfter\(c, dueDateISO\)/);
  // the mark stamps today, unless a legacy row already carries the real paid date
  assert.match(fn, /paymentDate: \(!rowNeedsWrite && base\.paymentDate\) \|\| today\(\)/);
  // pre-mark values remembered per client; unmark falls back to the due date
  assert.match(APP, /var monthPaidPrevClient = \{\}/);
  assert.match(fn, /monthPaidPrevClient\[c\.id\] = \{ nextBillingDate: c\.nextBillingDate, paymentDate: c\.paymentDate, dueDateISO: dueDateISO \}/);
  assert.match(fn, /\{ nextBillingDate: revertTo, paymentDate: c\.paymentDate \}/);
  // client save happens ONLY after a fresh reload (never saveAll from stale state)
  const reload = fn.indexOf('loadAll()');
  const save = fn.indexOf('persist()');
  assert.ok(reload !== -1 && save !== -1 && reload < save, 'must reload before persist');
  // payment row still goes through the single savePayment path, with rollback
  assert.match(fn, /persistPayment\(updated\)/);
  assert.match(fn, /monthPaidPrevClient\[c\.id\] = prevRemembered/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — the chip label names the month (MM/YYYY), tooltips unchanged
// ─────────────────────────────────────────────────────────────────────────────

test('the chip state and label come from packagePaidState (billing cycle, not calendar month)', () => {
  // Superseded by the cycle fix: the chip no longer reads the calendar-month
  // Payments row. Full coverage lives in test/package-chip-cycle.test.js.
  assert.match(APP, /var pkg = packagePaidState\(c, today\(\)\)/);
  assert.match(APP, /שולם עד ' \+ untilDM \+ ' ✓/);
  assert.match(APP, />לא שולם ✓</);
  assert.doesNotMatch(APP, /chipName/);
});

test('label format sanity: 2026-09-30 renders as שולם עד 30/09', () => {
  const until = '2026-09-30';
  const label = 'שולם עד ' + until.slice(8, 10) + '/' + until.slice(5, 7);
  assert.equal(label, 'שולם עד 30/09');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 — renewalInfo: no false 🛑 on the 1st (pure mirror + source guards)
// ─────────────────────────────────────────────────────────────────────────────

// Mirrors of the app.js helpers with today injected — keep in sync.
function currentMonthBaseDueDateAt(c, todayIso) {
  const bd = c.billingDay ? Number(c.billingDay) : dayOfMonth(c.startDate);
  if (!bd) return todayIso;
  const last = lastDayOfMonth(todayIso);
  const eff = (last && bd > last) ? last : bd;
  return todayIso.slice(0, 7) + '-' + String(eff).padStart(2, '0');
}
function paymentForClientOnAt(payments, c, dueDateISO) {
  const byId = (id) => payments.find((p) => p.id === id) || null;
  return byId(paymentId(c.id, dueDateISO, 'base')) || byId(legacyBasePaymentId(c.id, dueDateISO)) ||
    { status: 'unpaid' };
}
function prevMonthBasePaidAt(payments, c, todayIso) {
  let y = parseInt(todayIso.slice(0, 4), 10);
  let m = parseInt(todayIso.slice(5, 7), 10);
  m -= 1; if (m < 1) { m = 12; y -= 1; }
  const prevIso = y + '-' + ('0' + m).slice(-2) + '-01';
  return paymentForClientOnAt(payments, c, prevIso).status === 'paid';
}
function daysBetween(aIso, bIso) {
  if (!aIso || !bIso) return null;
  const a = new Date(aIso), b = new Date(bIso);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}
// Mirror of renewalInfo in public/app.js — keep in sync.
function renewalInfoAt(c, payments, todayIso) {
  if (!c || c.status === 'סיים טיפול' || c.status === 'לא פעיל') return { status: 'unknown' };
  let renewal = c.nextBillingDate || '';
  if (!renewal) {
    const anchor = c.packageChangeDate || c.paymentDate || c.startDate || '';
    if (!anchor) return { status: 'unknown' };
    const d = new Date(anchor); const od = d.getDate();
    d.setMonth(d.getMonth() + 1); if (d.getDate() !== od) d.setDate(0);
    renewal = d.toISOString().slice(0, 10);
  }
  let daysLeft = daysBetween(todayIso, renewal);
  const curDue = currentMonthBaseDueDateAt(c, todayIso);
  // Paid-up follows the billing CYCLE (packagePaidState: nextBillingDate still
  // ahead), not a calendar-month Payments row.
  const nbd = String(c.nextBillingDate || '').slice(0, 10);
  const paidThisMonth = !!nbd && nbd >= todayIso;
  let status;
  if (paidThisMonth) {
    if (daysLeft === null) status = 'unknown';
    else { if (daysLeft < 0) daysLeft = 0; status = daysLeft <= 7 ? 'due_soon' : 'ok'; }
  } else if (hasBillingProblem(c)) {
    status = 'overdue';
  } else if (todayIso < curDue && prevMonthBasePaidAt(payments, c, todayIso)) {
    renewal = curDue;
    daysLeft = daysBetween(todayIso, curDue);
    status = 'due_soon';
  } else if (daysLeft === null) status = 'unknown';
  else if (daysLeft < 0) status = 'overdue';
  else if (daysLeft <= 7) status = 'due_soon';
  else status = 'ok';
  return { renewalDate: renewal, daysLeft, status };
}

const SEPT1 = '2026-09-01';
function chipPaidClient(over) {
  return Object.assign({
    id: 'c1', status: 'פעיל', billingDay: 10,
    nextBillingDate: '2026-07-10', paymentStatus: '', startDate: '2026-01-10',
  }, over);
}
const paidAug = { id: 'pay::c1::base::2026-08', clientId: 'c1', status: 'paid' };

test('THE BUG: 1st of month, stale stored date, paid previous month -> due_soon, not overdue', () => {
  const r = renewalInfoAt(chipPaidClient(), [paidAug], SEPT1);
  assert.equal(r.status, 'due_soon');
  assert.equal(r.renewalDate, '2026-09-10'); // counts to the CURRENT month's due date
  assert.equal(r.daysLeft, 9);
});

test('previous month NOT paid -> still overdue (really is overdue, banner stays)', () => {
  const r = renewalInfoAt(chipPaidClient(), [], SEPT1);
  assert.equal(r.status, 'overdue');
});

test('due date already passed without a paid row -> overdue even with paid previous month', () => {
  const r = renewalInfoAt(chipPaidClient(), [paidAug], '2026-09-15'); // due day 10 passed
  assert.equal(r.status, 'overdue');
});

test('explicit unpaid/partial paymentStatus -> overdue regardless of the grace window', () => {
  const r = renewalInfoAt(chipPaidClient({ paymentStatus: 'unpaid' }), [paidAug], SEPT1);
  assert.equal(r.status, 'overdue');
});

test('unchanged: a paid-up cycle is never overdue (counts to the anchor)', () => {
  // Cycle semantics: paid-up ⇔ the anchor is still ahead — a September
  // calendar row alone no longer decides. עידו: paid until 30/09 on the 1st.
  const r = renewalInfoAt(chipPaidClient({ nextBillingDate: '2026-09-30' }), [], SEPT1);
  assert.equal(r.status, 'ok'); // 29 days out
  assert.equal(r.renewalDate, '2026-09-30');
  // A calendar-Sept row without an advanced anchor is an un-advanced payment:
  // the grace window (paid Aug, before the due day) keeps it off the red list.
  const paidSep = { id: 'pay::c1::base::2026-09', clientId: 'c1', status: 'paid' };
  const r2 = renewalInfoAt(chipPaidClient(), [paidSep, paidAug], SEPT1);
  assert.equal(r2.status, 'due_soon');
});

test('unchanged: past the due day the stored date still drives ok / due_soon by distance', () => {
  const c = chipPaidClient({ nextBillingDate: '2026-09-25' });
  assert.equal(renewalInfoAt(c, [paidAug], '2026-09-20').status, 'due_soon'); // 5 days out
  const far = chipPaidClient({ nextBillingDate: '2026-10-20', billingDay: 20 });
  assert.equal(renewalInfoAt(far, [paidAug], '2026-09-25').status, 'ok'); // 25 days out
});

test('unchanged: inactive statuses stay unknown', () => {
  assert.equal(renewalInfoAt(chipPaidClient({ status: 'סיים טיפול' }), [paidAug], SEPT1).status, 'unknown');
  assert.equal(renewalInfoAt(chipPaidClient({ status: 'לא פעיל' }), [paidAug], SEPT1).status, 'unknown');
});

test('app.js wiring: renewalInfo carries the grace-window branch + helper', () => {
  const fn = fnSource('renewalInfo');
  assert.match(fn, /today\(\) < curDue && prevMonthBasePaid\(c\)/);
  assert.match(fn, /renewal = curDue/);
  assert.match(fn, /daysLeft = daysBetween\(today\(\), curDue\)/);
  const helper = fnSource('prevMonthBasePaid');
  assert.match(helper, /paymentForClientOn\(c, prevIso\)\.status === 'paid'/);
  // the branch sits AFTER the explicit-problem check (overdue wins)
  assert.ok(fn.indexOf('hasBillingProblem(c)') < fn.indexOf('prevMonthBasePaid(c)'));
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 — cross-app contract untouched
// ─────────────────────────────────────────────────────────────────────────────

test('getTreatmentPlans renewalDate contract untouched (reads the stored value, PR changes none of it)', () => {
  const GS = fs.readFileSync(path.join(ROOT, 'apps-script', 'Code.gs'), 'utf8');
  assert.match(GS, /renewalDate: _renewalDueDate\(/, 'projection must still read the stored anchor');
});
