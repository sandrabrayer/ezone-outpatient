'use strict';

/**
 * Coverage for the "שחזר לטיפול" (restore-to-treatment) flow — the reverse of
 * סיים טיפול, offered on the discharged cards in the retention tab (mirrors the
 * שחזר לליד pattern on not-relevant leads). Run with:  npm test
 *
 * Two styles, matching the passing tests in this suite:
 *   1. Pure MIRRORS of the restore write (like merge-clients.test.js /
 *      package-change.test.js) — the mirror encodes the contract and is
 *      asserted directly, including the billing re-anchor interplay with the
 *      real nextRenewalDueDate from public/charges-logic.js.
 *   2. SOURCE-SCAN guards over public/app.js + public/index.html (like
 *      pwa.test.js / card-edit-renewal-fix.test.js) — they lock the inline
 *      handler to that contract so it can't silently regress.
 *
 * Contract (decisions locked at design time):
 *   - restore applies ONLY to a discharged (סיים טיפול) patient — פעיל,
 *     הפסקה זמנית and the cross-app לא פעיל are all no-ops (לא פעיל restore is
 *     deliberately out of v1 scope: it would undo a therapists-app delete)
 *   - status -> 'פעיל'; exitDate cleared (the exit modal re-sets it on any
 *     future discharge)
 *   - billing re-anchor: packageChangeDate = restore date AND the stale
 *     nextBillingDate CLEARED — nextRenewalDueDate prefers a stored
 *     nextBillingDate over packageChangeDate, so without the clear the old
 *     date would win and flag the patient overdue immediately
 *   - nothing else on the row is touched; extra charges are untouched (the
 *     confirm modal lists the active ones so stale charges can be removed)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const { nextRenewalDueDate } = require('../public/charges-logic');

const DISCHARGED = 'סיים טיפול';
const ACTIVE = 'פעיל';
const PAUSED = 'הפסקה זמנית';
const DEACTIVATED = 'לא פעיל'; // cross-app status — NOT restorable in v1

// ─────────────────────────────────────────────────────────────────────────────
// Pure mirror of submitRestoreClient's write (minus DOM/persist plumbing)
// ─────────────────────────────────────────────────────────────────────────────
function restoreClient(c, todayISO) {
  if (!c || c.status !== DISCHARGED) return false; // guard: discharged only
  c.status = ACTIVE;
  c.exitDate = '';
  c.packageChangeDate = todayISO;
  c.nextBillingDate = '';
  return true;
}

// Mirror of the confirm modal's extra-charges listing filter (active-only, same
// rule the patient card uses: active !== false).
function activeChargesFor(charges, clientId) {
  return charges.filter((ch) => ch.clientId === clientId && ch.active !== false);
}

function dischargedClient(extra) {
  return Object.assign({
    id: 'c1', name: 'מטופל', status: DISCHARGED, exitDate: '2026-03-01',
    pricePerSession: 400, sessionsPerWeek: 'טיפול רגשי:2', location: 'רעננה',
    phone: '0501234567', billingDay: 10, startDate: '2025-06-10',
    paymentDate: '2026-02-10', nextBillingDate: '2026-03-10',
    packageChangeDate: '', creditsOwed: 2, notes: 'הערה'
  }, extra || {});
}

test('restore flips a discharged patient: status פעיל, exitDate cleared, re-anchor set', () => {
  const c = dischargedClient();
  assert.equal(restoreClient(c, '2026-08-18'), true);
  assert.equal(c.status, ACTIVE);
  assert.equal(c.exitDate, '');
  assert.equal(c.packageChangeDate, '2026-08-18');
  assert.equal(c.nextBillingDate, '');
});

test('restore touches ONLY the four contract fields — package/price/frequency/phone/notes survive', () => {
  const c = dischargedClient();
  const before = Object.assign({}, c);
  restoreClient(c, '2026-08-18');
  for (const k of Object.keys(before)) {
    if (['status', 'exitDate', 'packageChangeDate', 'nextBillingDate'].includes(k)) continue;
    assert.equal(c[k], before[k], `field ${k} must not change on restore`);
  }
});

test('restore is a no-op for non-discharged statuses (incl. the cross-app לא פעיל)', () => {
  for (const status of [ACTIVE, PAUSED, DEACTIVATED, '']) {
    const c = dischargedClient({ status });
    const before = Object.assign({}, c);
    assert.equal(restoreClient(c, '2026-08-18'), false, `status "${status}" must not restore`);
    assert.deepEqual(c, before, `row with status "${status}" must be untouched`);
  }
  assert.equal(restoreClient(null, '2026-08-18'), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Billing re-anchor interplay with the REAL nextRenewalDueDate
// ─────────────────────────────────────────────────────────────────────────────
test('after restore, the next charge anchors to restore date + 1 month', () => {
  const c = dischargedClient({ nextBillingDate: '2026-03-10', paymentDate: '2026-02-10' });
  restoreClient(c, '2026-08-18');
  assert.equal(nextRenewalDueDate(c), '2026-09-18');
});

test('clearing the stale nextBillingDate is LOAD-BEARING — without it the old date wins', () => {
  // Documents WHY the contract clears nextBillingDate: the anchor precedence in
  // nextRenewalDueDate prefers a stored nextBillingDate over packageChangeDate.
  const stale = dischargedClient({ nextBillingDate: '2026-03-10' });
  stale.status = ACTIVE;
  stale.packageChangeDate = '2026-08-18'; // re-anchor set but stale date kept
  assert.equal(nextRenewalDueDate(stale), '2026-03-10'); // ← months overdue at once
});

// ─────────────────────────────────────────────────────────────────────────────
// Extra-charges listing (confirm modal): active-only, charges never mutated
// ─────────────────────────────────────────────────────────────────────────────
test('the confirm modal lists only the patient\'s ACTIVE extra charges', () => {
  const charges = [
    { id: 'x1', clientId: 'c1', description: 'טיפול תזונתי', amount: 250, billingType: 'monthly', active: true },
    { id: 'x2', clientId: 'c1', description: 'אבחון', amount: 800, billingType: 'one_time' }, // no flag -> active
    { id: 'x3', clientId: 'c1', description: 'ישן', amount: 100, billingType: 'monthly', active: false },
    { id: 'x4', clientId: 'OTHER', description: 'של אחר', amount: 90, billingType: 'monthly', active: true }
  ];
  const listed = activeChargesFor(charges, 'c1');
  assert.deepEqual(listed.map((ch) => ch.id), ['x1', 'x2']);
});

test('restore never touches charge rows', () => {
  const charges = [{ id: 'x1', clientId: 'c1', amount: 250, billingType: 'monthly', active: true }];
  const before = JSON.stringify(charges);
  restoreClient(dischargedClient(), '2026-08-18');
  assert.equal(JSON.stringify(charges), before);
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-scan guards: lock the real inline handler + markup to the contract
// ─────────────────────────────────────────────────────────────────────────────
test('app.js: submitRestoreClient guards on סיים טיפול and writes the four contract fields', () => {
  const fn = APP.match(/function submitRestoreClient\(\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, 'submitRestoreClient not found in public/app.js');
  const src = fn[0];
  assert.match(src, /c\.status !== 'סיים טיפול'/, 'must restore ONLY discharged patients');
  assert.match(src, /c\.status = 'פעיל'/);
  assert.match(src, /c\.exitDate = ''/);
  assert.match(src, /c\.packageChangeDate = today\(\)/);
  assert.match(src, /c\.nextBillingDate = ''/, 'stale nextBillingDate must be cleared (re-anchor precedence)');
  // Optimistic-rollback snapshot covers every field the write touches.
  for (const f of ['status', 'exitDate', 'packageChangeDate', 'nextBillingDate']) {
    assert.match(src, new RegExp(`prev\\.${f}`), `rollback must restore ${f}`);
  }
});

test('app.js: retention tab offers שחזר לטיפול on discharged cards, editor-only', () => {
  const idx = APP.indexOf("restorePatientBtn.textContent = 'שחזר לטיפול'");
  assert.ok(idx !== -1, 'שחזר לטיפול button not found');
  // The button block sits inside the finished.forEach card builder behind the
  // same editor gate the שחזר לליד button uses.
  const before = APP.slice(Math.max(0, idx - 400), idx);
  assert.match(before, /state\.role === 'editor'/, 'restore button must be editor-only');
  assert.match(before, /card\.innerHTML = header \+ body;/, 'button must attach to the discharged retention card');
});

test('app.js: modal wiring — confirm button and the global data-close chain', () => {
  assert.match(APP, /\$\('#restoreClientConfirm'\)/, 'confirm button must be wired');
  assert.match(APP, /submitRestoreClient\(\);/);
  assert.match(APP, /closeRestoreClientModal\(\);/, 'data-close chain must close the restore modal');
});

test('index.html: restore modal markup exists with name span, charges host and confirm button', () => {
  assert.match(HTML, /id="restoreClientModal"/);
  assert.match(HTML, /id="restoreClientName"/);
  assert.match(HTML, /id="restoreClientCharges"/);
  assert.match(HTML, /id="restoreClientConfirm"/);
});

test('no backend surface: restore rides saveAll — no new Code.gs action, no new column', () => {
  const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  assert.ok(!/restoreClient/.test(GS), 'v1 is frontend-only; no Apps Script action expected');
  const headers = GS.match(/var CLIENTS_HEADERS = \[([\s\S]*?)\];/)[1];
  assert.ok(!/restoredAt/.test(headers), 'v1 adds no CLIENTS_HEADERS column');
});
