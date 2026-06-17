'use strict';

/**
 * Unit coverage for the hardcoded clinical → billing map + price oracle in
 * public/treatment-map.js.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Contracts being locked:
 *   - map completeness: all 12 clinical keys present
 *   - one-to-one integrity: every clinical key yields exactly one billing value
 *   - the two renames: פרטני כללי -> פרטני, and ליווי יומי בקהילה still fires the
 *     day-center rule (bound to the NEW name + legacy alias)
 *   - price lookup: each per-session type returns its price; ליווי returns
 *     15000 for freq 3, 18000 for freq 5, and throws for any other frequency;
 *     קבוצה is 0 (intentionally free — decided, not null), טיפול משפחתי is 600
 *   - guard: a 13th clinical type without a billing target fails loudly
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const TM = require('../public/treatment-map');

const CLINICAL_KEYS = [
  'פרטני כללי',
  'פרטני CBT',
  'פרטני EMDR',
  'קבוצה',
  'טיפול משפחתי',
  'מעקב פסיכיאטרי',
  'ליווי יומי בקהילה',
  'פסיכודינמי',
  'פסיכותרפי ממוקד טראומה',
  'עיסוי טיפולי',
  'טיפול ממוקד התמכרויות',
  'טיפול אינטגרטיבי'
];

// --- map completeness -------------------------------------------------------
test('map completeness: exactly the 12 clinical keys are present', () => {
  const keys = Object.keys(TM.CLINICAL_TO_BILLING);
  assert.equal(keys.length, 12);
  CLINICAL_KEYS.forEach((k) => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(TM.CLINICAL_TO_BILLING, k),
      'missing clinical key: ' + k
    );
  });
});

// --- one-to-one integrity ---------------------------------------------------
test('one-to-one integrity: every clinical key yields exactly one billing value', () => {
  CLINICAL_KEYS.forEach((k) => {
    const billing = TM.clinicalToBilling(k);
    assert.equal(typeof billing, 'string');
    assert.ok(billing.length > 0, 'empty billing target for: ' + k);
    // and it must be a known billing type
    assert.ok(
      TM.BILLING_TYPES.indexOf(billing) !== -1,
      'billing target not in vocabulary: ' + billing
    );
  });
});

test('clinicalToBilling throws on an unknown clinical type', () => {
  assert.throws(() => TM.clinicalToBilling('לא קיים'), /Unknown clinical type/);
});

// --- the two renames --------------------------------------------------------
test('rename: פרטני כללי -> פרטני', () => {
  assert.equal(TM.clinicalToBilling('פרטני כללי'), 'פרטני');
});

test('rename: ליווי יומי בקהילה maps to itself and still fires the day-center rule', () => {
  assert.equal(TM.clinicalToBilling('ליווי יומי בקהילה'), TM.DAY_CENTER_BILLING);
  assert.equal(TM.DAY_CENTER_BILLING, 'ליווי יומי בקהילה');
  // rule bound to the NEW name ...
  assert.equal(TM.isDayCenterBilling('ליווי יומי בקהילה'), true);
  // ... and to the legacy label (back-compat) + stable key
  assert.equal(TM.isDayCenterBilling('מרכז יום'), true);
  assert.equal(TM.isDayCenterBilling(TM.DAY_CENTER_KEY), true);
  // a non-day-center type does NOT fire it
  assert.equal(TM.isDayCenterBilling('פרטני'), false);
});

// --- price lookup -----------------------------------------------------------
test('individual + all individual variants are ₪500 / session', () => {
  ['פרטני', 'פרטני CBT', 'פרטני EMDR', 'פסיכודינמי',
   'פסיכותרפי ממוקד טראומה', 'עיסוי טיפולי',
   'טיפול ממוקד התמכרויות', 'טיפול אינטגרטיבי'].forEach((t) => {
    assert.equal(TM.billingPrice(t), 500, t + ' should be 500');
  });
});

test('מעקב פסיכיאטרי is ₪1,100 / session', () => {
  assert.equal(TM.billingPrice('מעקב פסיכיאטרי'), 1100);
});

test('אינטייק is ₪2,300 / session (billing-only type)', () => {
  assert.equal(TM.billingPrice('אינטייק'), 2300);
});

test('ליווי יומי בקהילה: 3x/wk -> 15000, 5x/wk -> 18000', () => {
  assert.equal(TM.billingPrice('ליווי יומי בקהילה', 3), 15000);
  assert.equal(TM.billingPrice('ליווי יומי בקהילה', 5), 18000);
  // string frequency coerces
  assert.equal(TM.billingPrice('ליווי יומי בקהילה', '3'), 15000);
});

test('ליווי יומי בקהילה: any other / missing frequency throws', () => {
  assert.throws(() => TM.billingPrice('ליווי יומי בקהילה'), /requires frequencyPerWeek/);
  assert.throws(() => TM.billingPrice('ליווי יומי בקהילה', 1), /Unsupported/);
  assert.throws(() => TM.billingPrice('ליווי יומי בקהילה', 4), /Unsupported/);
  assert.throws(() => TM.billingPrice('ליווי יומי בקהילה', 0), /Unsupported/);
});

test('קבוצה is ₪0 — intentionally free (a decided price, not null, no throw)', () => {
  const p = TM.billingPrice('קבוצה');
  assert.equal(p, 0);
  assert.notEqual(p, null);              // 0 (decided/free) != null (undecided)
  assert.equal(typeof p, 'number');
});

test('טיפול משפחתי is ₪600 / session', () => {
  assert.equal(TM.billingPrice('טיפול משפחתי'), 600);
});

test('PRICE_FLAG_PER_CLIENT sentinel is still null (kept for any undecided type)', () => {
  assert.equal(TM.PRICE_FLAG_PER_CLIENT, null);
});

test('no billing type is left flagged null after pricing קבוצה / טיפול משפחתי', () => {
  const stillNull = Object.keys(TM.BILLING_PRICES).filter(
    (k) => TM.BILLING_PRICES[k] === null
  );
  assert.deepEqual(stillNull, [], 'unexpected undecided (null) prices: ' + stillNull.join(', '));
});

test('billingPrice throws on an unknown billing type', () => {
  assert.throws(() => TM.billingPrice('סוג שלא קיים'), /Unknown billing type/);
});

// --- guard against an unmapped 13th clinical type ---------------------------
test('assertMapComplete passes for the current map', () => {
  assert.equal(TM.assertMapComplete(), true);
});

test('guard fails loudly if a 13th clinical type has no billing target', () => {
  // The exported maps ARE the live references the guard closes over, so
  // mutating them affects assertMapComplete. Mutate-and-restore.
  withTempClinical('טיפול ניסיוני', 'סוג חיוב שלא הוגדר', () => {
    assert.throws(() => TM.assertMapComplete(), /not in the billing vocabulary/);
  });
  // restored: the guard passes again
  assert.equal(TM.assertMapComplete(), true);
});

test('guard fails loudly if a 13th clinical type maps to an unpriceable target', () => {
  // A billing target that is "known" in the type list but has no price entry is
  // caught too — assertMapComplete prices every target. Add a billing name to
  // the type list only (not the price table) so billingPrice throws inside.
  TM.BILLING_TYPES.push('סוג ללא מחיר');
  try {
    withTempClinical('טיפול ניסיוני', 'סוג ללא מחיר', () => {
      assert.throws(() => TM.assertMapComplete(), /Unknown billing type/);
    });
  } finally {
    TM.BILLING_TYPES.pop();
  }
  assert.equal(TM.assertMapComplete(), true);
});

// Temporarily add a clinical->billing entry to the live map, run fn, then
// remove it — so guard tests never leak into the completeness/integrity tests.
function withTempClinical(clinical, billing, fn) {
  TM.CLINICAL_TO_BILLING[clinical] = billing;
  try { fn(); }
  finally { delete TM.CLINICAL_TO_BILLING[clinical]; }
}
