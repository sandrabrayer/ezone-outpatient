'use strict';

/**
 * Unit coverage for the therapist pay table in public/therapist-pay.js.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Contracts being locked:
 *   - every therapist returns their correct PRE-VAT rate
 *   - flat rates are PER PERSON, not per grade (two grade-A therapists at
 *     ₪250 vs ₪230 prove it)
 *   - psychiatrists pay BY TYPE: אינטייק -> 900, מעקב פסיכיאטרי -> 700, and a
 *     psychiatrist lookup throws on a missing/invalid treatment type
 *   - unknown therapist throws
 *   - a completeness guard fails loudly if a therapist is added without a rate
 *   - withVat is a separate helper and is NOT baked into therapistPay
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const TP = require('../public/therapist-pay');

// Expected flat rates — literal mirror of the table (16 therapists).
const FLAT_EXPECTED = {
  'מעיין דלומי': 250,
  'תמר גנץ':     250,
  'אורן כביר':   250,
  'אביב מלכה':   250,
  'רמי':         250,
  'כנרת':        250,
  'הילה':        250,
  'עידו בוזגלו': 250,
  'אלה':         250,
  'שירן':        250,
  'דנה':         250,
  'יפעת':        250,
  'איתן דשה':    250,
  'דליה מלמד':   230,
  'נועה זיפמן':  210,
  'אסתר':        180
};

// --- flat therapists --------------------------------------------------------
test('every flat therapist returns their correct pre-VAT rate', () => {
  Object.keys(FLAT_EXPECTED).forEach((name) => {
    assert.equal(TP.therapistPay(name), FLAT_EXPECTED[name], name);
  });
});

test('roster is exactly 16 flat therapists + 3 psychiatrists', () => {
  assert.equal(Object.keys(TP.FLAT_RATES).length, 16);
  assert.equal(Object.keys(TP.PSYCHIATRIST_RATES).length, 3);
});

test('flat rate is PER PERSON, not per grade (₪250 vs ₪230, same grade A)', () => {
  // Two grade-A therapists with different rates — the rate follows the person.
  assert.equal(TP.therapistPay('מעיין דלומי'), 250);
  assert.equal(TP.therapistPay('דליה מלמד'), 230);
  assert.notEqual(TP.therapistPay('מעיין דלומי'), TP.therapistPay('דליה מלמד'));
});

test('flat therapist ignores any treatmentType argument', () => {
  assert.equal(TP.therapistPay('תמר גנץ', 'אינטייק'), 250);
  assert.equal(TP.therapistPay('תמר גנץ', 'whatever'), 250);
  assert.equal(TP.therapistPay('תמר גנץ'), 250);
});

// --- psychiatrists ----------------------------------------------------------
test('psychiatrists pay by type: אינטייק -> 900, מעקב פסיכיאטרי -> 700', () => {
  Object.keys(TP.PSYCHIATRIST_RATES).forEach((name) => {
    assert.equal(TP.therapistPay(name, 'אינטייק'), 900, name + ' intake');
    assert.equal(TP.therapistPay(name, 'מעקב פסיכיאטרי'), 700, name + ' follow-up');
  });
});

test('psychiatrist throws when treatmentType is missing', () => {
  const name = Object.keys(TP.PSYCHIATRIST_RATES)[0];
  assert.throws(() => TP.therapistPay(name), /requires a treatmentType/);
  assert.throws(() => TP.therapistPay(name, ''), /requires a treatmentType/);
  assert.throws(() => TP.therapistPay(name, '   '), /requires a treatmentType/);
});

test('psychiatrist throws on an invalid treatmentType', () => {
  const name = Object.keys(TP.PSYCHIATRIST_RATES)[0];
  assert.throws(() => TP.therapistPay(name, 'פרטני'), /Unsupported treatment type/);
  assert.throws(() => TP.therapistPay(name, 'קבוצה'), /Unsupported treatment type/);
});

// --- unknown therapist ------------------------------------------------------
test('unknown therapist throws', () => {
  assert.throws(() => TP.therapistPay('מישהו אחר'), /Unknown therapist/);
  assert.throws(() => TP.therapistPay(''), /Unknown therapist/);
});

// --- VAT stays out of therapistPay -----------------------------------------
test('therapistPay returns raw pre-VAT numbers; withVat is separate', () => {
  assert.equal(TP.therapistPay('מעיין דלומי'), 250); // not 295
  assert.equal(TP.DEFAULT_VAT_RATE, 0.18);
  assert.equal(TP.withVat(250), 295);                // 250 * 1.18
  assert.equal(TP.withVat(700), 826);                // psychiatrist follow-up
  assert.equal(TP.withVat(100, 0), 100);             // explicit zero rate
  assert.equal(TP.withVat(100, 0.17), 117);          // override rate
});

// --- completeness guard -----------------------------------------------------
test('assertTableComplete passes for the current table', () => {
  assert.equal(TP.assertTableComplete(), true);
});

test('guard fails loudly if a flat therapist is added without a rate', () => {
  // The exported tables ARE the live references the guard closes over, so
  // mutating them affects assertTableComplete. Mutate-and-restore.
  TP.FLAT_RATES['מטפל חדש'] = undefined;
  try {
    assert.throws(() => TP.assertTableComplete(), /has no valid rate/);
  } finally {
    delete TP.FLAT_RATES['מטפל חדש'];
  }
  assert.equal(TP.assertTableComplete(), true); // restored

  // a non-positive rate is also rejected
  TP.FLAT_RATES['מטפל אפס'] = 0;
  try {
    assert.throws(() => TP.assertTableComplete(), /has no valid rate/);
  } finally {
    delete TP.FLAT_RATES['מטפל אפס'];
  }
  assert.equal(TP.assertTableComplete(), true);
});

test('guard fails loudly if a psychiatrist is missing a type rate', () => {
  TP.PSYCHIATRIST_RATES['ד״ר חדש'] = { 'אינטייק': 900 }; // missing follow-up
  try {
    assert.throws(() => TP.assertTableComplete(), /missing a valid rate/);
  } finally {
    delete TP.PSYCHIATRIST_RATES['ד״ר חדש'];
  }
  assert.equal(TP.assertTableComplete(), true);
});
