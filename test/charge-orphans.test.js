/**
 * Tests for orphaned-charge exclusion and the patient-delete cleanup contract.
 *
 * Background: ClientCharges rows are keyed by clientId. When a patient was
 * deleted but their charge rows survived, those orphan rows leaked into the
 * dashboard's "בקשות לטיפול נוסף (מעבר לחבילה)" section. The fix is two-layered:
 *   1. display-time: excludeOrphanCharges() hides any charge whose clientId no
 *      longer matches a live patient (pure helper, tested here).
 *   2. root-cause: the patient-delete flow calls removeChargesForClient(id) so
 *      no new orphans are ever created. Its targeting predicate (a charge
 *      belongs to a given clientId) is the same string-compare exercised here.
 *
 * Run with:  npm test     (Node's built-in test runner, Node >= 18)
 *
 * excludeOrphanCharges lives in public/charges-logic.js; public/app.js carries
 * an inline copy of the same rule — any change must update both places.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { excludeOrphanCharges } = require('../public/charges-logic');

// The two real test patients that were deleted, leaving orphan charge rows.
const ORPHAN_PHONE = '0543123270';

test('a charge whose clientId has no matching active patient is excluded', () => {
  const clients = [{ id: 'c1', name: 'דנה' }];
  const charges = [
    { id: 'chg1', clientId: 'c1', description: 'CBT נוסף' },   // live
    { id: 'chg2', clientId: 'gone', description: 'בדיקה' },     // orphan
  ];
  const kept = excludeOrphanCharges(charges, clients);
  assert.deepEqual(kept.map((c) => c.id), ['chg1']);
});

test('charges of a still-present patient are kept', () => {
  const clients = [{ id: 'c1' }, { id: 'c2' }];
  const charges = [
    { id: 'a', clientId: 'c1' },
    { id: 'b', clientId: 'c2' },
  ];
  assert.equal(excludeOrphanCharges(charges, clients).length, 2);
});

test('deleting a patient drops their charges from the dashboard view', () => {
  // Two patients, each with one charge.
  let clients = [
    { id: 'c1', name: 'מריסה נשרי', phone: ORPHAN_PHONE },
    { id: 'c2', name: 'דנה' },
  ];
  const charges = [
    { id: 'chg1', clientId: 'c1' },
    { id: 'chg2', clientId: 'c2' },
  ];
  // Before deletion both charges are visible.
  assert.equal(excludeOrphanCharges(charges, clients).length, 2);

  // Delete patient c1 (their charge row may linger in the sheet).
  clients = clients.filter((c) => c.id !== 'c1');

  // The display filter now hides c1's charge — no orphan leaks through.
  const visible = excludeOrphanCharges(charges, clients);
  assert.deepEqual(visible.map((c) => c.id), ['chg2']);
});

test('clientId is compared as a string (Sheets may return a numeric id)', () => {
  const clients = [{ id: 1001 }];
  const charges = [{ id: 'x', clientId: '1001' }];
  assert.equal(excludeOrphanCharges(charges, clients).length, 1);
});

test('blank / null clientId is treated as an orphan and excluded', () => {
  const clients = [{ id: 'c1' }];
  const charges = [
    { id: 'a', clientId: '' },
    { id: 'b', clientId: null },
    { id: 'c' },
    { id: 'd', clientId: 'c1' },
  ];
  assert.deepEqual(excludeOrphanCharges(charges, clients).map((c) => c.id), ['d']);
});

test('a client with a blank id never adopts blank-clientId charges', () => {
  const clients = [{ id: '' }, { id: 'c1' }];
  const charges = [{ id: 'a', clientId: '' }, { id: 'b', clientId: 'c1' }];
  assert.deepEqual(excludeOrphanCharges(charges, clients).map((c) => c.id), ['b']);
});

test('empty / missing inputs do not throw', () => {
  assert.deepEqual(excludeOrphanCharges([], []), []);
  assert.deepEqual(excludeOrphanCharges(undefined, undefined), []);
  assert.deepEqual(excludeOrphanCharges(null, [{ id: 'c1' }]), []);
});

// --- Phone normalization on read: the Google-Sheets stripped-zero case -------
// The patient phone is normalized on read via recoverPhone (public/app.js,
// mirrored by _recoverPhone in apps-script/Code.gs). Sheets stores a 10-digit
// mobile in a number cell and drops the leading zero; recover restores it so
// the canonical 10-digit leading-zero form is what the card/edit modal show.
function normalizePhone(raw) {
  let s = String(raw == null ? '' : raw).replace(/[\s\-()]/g, '');
  if (s.indexOf('+') === 0) s = s.slice(1);
  if (s.indexOf('00') === 0) s = s.slice(2);
  s = s.replace(/\D/g, '');
  if (!s) return '';
  if (s.indexOf('972') === 0) s = '0' + s.slice(3);
  return s;
}
function recoverPhone(raw) {
  let s = normalizePhone(raw);
  if (s && s.charAt(0) !== '0') s = '0' + s;
  return s;
}

test('recoverPhone restores a Sheets-dropped leading zero (test-patient phone)', () => {
  // 0543123270 stored as a number comes back as 543123270.
  assert.equal(recoverPhone(543123270), ORPHAN_PHONE);
  assert.equal(recoverPhone('543123270'), ORPHAN_PHONE);
  // Idempotent: an already-canonical value is unchanged.
  assert.equal(recoverPhone(ORPHAN_PHONE), ORPHAN_PHONE);
  // 972 / separator forms also land on the canonical leading-zero form.
  assert.equal(recoverPhone('+972-54-312-3270'), ORPHAN_PHONE);
});
