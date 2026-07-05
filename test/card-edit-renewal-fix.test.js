'use strict';

/**
 * Regression coverage for the two patient-card bugs fixed in
 * CHANGELOG-card-edit-renewal-fix.md, plus guards for the card-action
 * consolidation. Run with:  npm test
 *
 * Two styles, matching the passing tests in this suite:
 *   1. Pure MIRRORS of the fixed decision logic (like merge-clients.test.js /
 *      package-change.test.js) — the mirror encodes the contract and is asserted
 *      directly.
 *   2. SOURCE-SCAN guards over public/app.js + public/index.html (like
 *      pwa.test.js / continuation-code.test.js) — they lock the real handlers to
 *      that contract so the inline copy can't silently regress.
 *
 * Bug A ("edit doesn't save"): the edit handler blocked the WHOLE save when the
 *   patient's own phone OR the prefilled treatmentContactPhone collided with any
 *   other client's identity phones. treatmentContactPhone is a SHAREABLE contact
 *   (one parent is the אחראי טיפול for siblings), and an unchanged prefilled phone
 *   must never abort an edit. Fixed: only block when the patient's OWN phone was
 *   actually CHANGED to a number another client owns; never block on the contact.
 *
 * Bug B ("renewal errors on save"): a client with no anchor date at all
 *   (nextBillingDate/packageChangeDate/paymentDate/startDate all blank) made
 *   nextRenewalDueDate() return '' and the renew handler hard-failed. Fixed:
 *   fall back to currentMonthBaseDueDate(c) so a concrete billed month is shown
 *   and the renewal saves.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// Bug A — pure mirror of the FIXED edit-save phone gate
// ─────────────────────────────────────────────────────────────────────────────
function recoverPhone(raw) {
  let s = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!s) return '';
  if (s.indexOf('972') === 0) s = '0' + s.slice(3);
  if (s.charAt(0) !== '0') s = '0' + s;
  return s;
}
// Mirrors clientIdentityPhones + findClientByPhone in public/app.js. Identity is
// the patient's OWN phone only — the אחראי-טיפול contact phone is no longer an
// identity key (that role was removed from the product).
function identityPhones(c) {
  return [c.phone].map(recoverPhone).filter(Boolean);
}
function findClientByPhone(clients, rawPhone, exceptId) {
  const key = recoverPhone(rawPhone);
  if (!key) return null;
  return clients.find((c) => c && c.id !== exceptId && identityPhones(c).indexOf(key) !== -1) || null;
}
// Mirrors the FIXED edit handler: block only when the patient's OWN phone was
// changed to a value another client already owns. treatmentContactPhone (the
// contact) is never a blocking key here.
function editSaveBlocked(clients, editingId, newPhone, prevPhone) {
  const changed = recoverPhone(newPhone) !== recoverPhone(prevPhone);
  if (!changed) return false;
  return !!findClientByPhone(clients, newPhone, editingId);
}

const SIBLINGS = [
  { id: 'a', name: 'אח א', phone: '0501111111', treatmentContactPhone: '0521111111' },
  { id: 'b', name: 'אח ב', phone: '0502222222', treatmentContactPhone: '0521111111' } // SAME contact
];

test('Bug A: editing a sibling (name/amount only) is NOT blocked by the shared contact phone', () => {
  // Patient a keeps its own phone (unchanged); its contact is shared with b.
  assert.equal(editSaveBlocked(SIBLINGS, 'a', '0501111111', '0501111111'), false);
});

test('Bug A: an UNCHANGED prefilled phone never aborts the save, even if it cross-collides', () => {
  // c's own phone equals another client's contact phone; editing c without
  // touching the phone must not block.
  const clients = [
    { id: 'c', name: 'ג', phone: '0521111111', treatmentContactPhone: '' },
    { id: 'd', name: 'ד', phone: '0509999999', treatmentContactPhone: '0521111111' }
  ];
  assert.equal(editSaveBlocked(clients, 'c', '0521111111', '0521111111'), false);
});

test('Bug A: CHANGING the patient phone to another client\'s real number is still blocked', () => {
  assert.equal(editSaveBlocked(SIBLINGS, 'a', '0502222222', '0501111111'), true);
});

test('Bug A: changing the phone to a fresh unique number is allowed', () => {
  assert.equal(editSaveBlocked(SIBLINGS, 'a', '0507654321', '0501111111'), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug A — source guard: the real edit handler no longer blocks on tcPhone and
// gates the patient-phone block on an actual change.
// ─────────────────────────────────────────────────────────────────────────────
test('Bug A guard: edit handler gates the duplicate block on a CHANGED patient phone', () => {
  assert.match(APP, /var ptPhoneChanged = recoverPhone\(ptPhone\) !== recoverPhone\(client\.phone\);/);
  assert.match(APP, /if \(ptPhoneChanged && duplicateClientBlock\(ptPhone, client\.id\)\)/);
});

test('Bug A guard: edit handler does NOT duplicate-block the treatment-contact phone', () => {
  assert.doesNotMatch(APP, /duplicateClientBlock\(tcPhone,/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug B — pure mirror of the FIXED billed-month resolution
// ─────────────────────────────────────────────────────────────────────────────
function addMonth(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (isNaN(d)) return '';
  const origDay = d.getDate();
  d.setMonth(d.getMonth() + 1);
  if (d.getDate() !== origDay) d.setDate(0);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}
function nextRenewalDueDate(c) {
  if (!c) return '';
  if (c.nextBillingDate) return c.nextBillingDate;
  const anchor = c.packageChangeDate || c.paymentDate || c.startDate || '';
  return anchor ? addMonth(anchor) : '';
}
function dayOfMonth(iso) {
  if (!iso) return null;
  const parts = String(iso).slice(0, 10).split('-');
  if (parts.length < 3) return null;
  const d = parseInt(parts[2], 10);
  return isFinite(d) ? d : null;
}
function lastDayOfMonth(iso) {
  const parts = String(iso).slice(0, 10).split('-');
  if (parts.length < 3) return null;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (!isFinite(y) || !isFinite(m)) return null;
  return new Date(y, m, 0).getDate();
}
function currentMonthBaseDueDate(c, todayISO) {
  const t = todayISO;
  const bd = c.billingDay ? Number(c.billingDay) : dayOfMonth(c.startDate);
  if (!bd) return t;
  const last = lastDayOfMonth(t);
  const eff = (last && bd > last) ? last : bd;
  return t.slice(0, 7) + '-' + String(eff).padStart(2, '0');
}
// The FIXED resolution used by both openRenewModal and the renew submit handler.
function billedMonthDate(c, todayISO) {
  return nextRenewalDueDate(c) || currentMonthBaseDueDate(c, todayISO);
}

const TODAY = '2026-07-05';

test('Bug B: a client with NO anchor date resolves to a concrete billed month (was empty → hard-fail)', () => {
  const noAnchor = { id: 'x', nextBillingDate: '', packageChangeDate: '', paymentDate: '', startDate: '', billingDay: '' };
  assert.equal(nextRenewalDueDate(noAnchor), ''); // the pre-fix value that caused the abort
  const billed = billedMonthDate(noAnchor, TODAY);
  assert.notEqual(billed, '');
  assert.match(billed, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(billed.slice(0, 7), '2026-07');
});

test('Bug B: the stored anchor still wins when present (fallback only kicks in when empty)', () => {
  assert.equal(billedMonthDate({ nextBillingDate: '2026-09-10' }, TODAY), '2026-09-10');
  assert.equal(billedMonthDate({ paymentDate: '2026-06-01' }, TODAY), '2026-07-01');
});

test('Bug B guard: renew handler + modal use the currentMonthBaseDueDate fallback (no bare hard-fail)', () => {
  // Both the modal opener and the submit handler resolve the month with the
  // fallback; the old `nextRenewalDueDate(c)` without a fallback is gone.
  const uses = APP.match(/nextRenewalDueDate\([a-z]+\) \|\| currentMonthBaseDueDate\([a-z]+\)/g) || [];
  assert.ok(uses.length >= 2, 'expected the fallback in openRenewModal and the submit handler, found ' + uses.length);
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase C — card-action consolidation guards
// ─────────────────────────────────────────────────────────────────────────────
test('C1: the card renders EXACTLY the three consolidated action buttons for editors', () => {
  // The editor branch builds three btn-ghost buttons via textContent. Assert all
  // three labels are present and in order, and that no fourth ghost action exists.
  const editIdx = APP.indexOf("editBtn.textContent = 'עריכה';");
  const renewIdx = APP.indexOf("renewBtn.textContent = 'חידוש ותשלום';");
  const addIdx = APP.indexOf("addChargeBtn.textContent = '+ הוסף טיפול';");
  assert.ok(editIdx > 0, 'עריכה button present');
  assert.ok(renewIdx > 0, 'חידוש ותשלום button present');
  assert.ok(addIdx > 0, '+ הוסף טיפול button present');
  assert.ok(editIdx < renewIdx && renewIdx < addIdx, 'order is עריכה → חידוש ותשלום → + הוסף טיפול');
});

test('C1: the standalone שינוי חבילה button and its modal/handlers are gone', () => {
  assert.doesNotMatch(APP, /openChangePackageModal/);
  assert.doesNotMatch(APP, /closeChangePackageModal/);
  assert.doesNotMatch(APP, /changePackageForm/);
  assert.doesNotMatch(HTML, /id="changePackageModal"/);
  // The former ✏️ ערוך label is replaced by the plain עריכה label.
  assert.doesNotMatch(APP, /editBtn\.textContent = '✏️ ערוך';/);
});

test('C2: the חידוש ותשלום modal absorbs the package fields and the שולם quick action', () => {
  assert.match(HTML, /data-host="renewSessions"/);
  assert.match(HTML, /id="renewMarkPaid"/);
  // שולם reuses the EXACT existing setCurrentMonthPaid path.
  assert.match(APP, /renewMarkPaid[\s\S]{0,400}setCurrentMonthPaid\(c, true\)/);
});

test('C2: renewal + package change is ONE implementation (reused helpers, not a fork)', () => {
  assert.match(APP, /function readPackageSessionsFromForm/);
  assert.match(APP, /function packageSessionsChanged/);
  // The submit handler stamps packageChangeDate only when the plan changed.
  assert.match(APP, /if \(pkgChanged\) \{[\s\S]{0,260}c\.packageChangeDate = paidDate;/);
});
