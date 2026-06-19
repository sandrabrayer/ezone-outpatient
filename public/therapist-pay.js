/**
 * therapist-pay.js
 * -----------------------------------------------------------------------------
 * Hardcoded therapist pay table — what E-ZONE pays each therapist per session.
 * This is the single source of truth for the PAY side (distinct from
 * treatment-map.js, which is the client-facing BILLING side).
 *
 * ALL RATES ARE PRE-VAT. VAT is added at payment time, not here — the table
 * stores raw numbers and `therapistPay()` returns them untouched. A `withVat()`
 * helper is exposed for the payment step, but it is NEVER applied inside
 * `therapistPay()`.
 *
 * TWO PAY STRUCTURES
 * ------------------
 *  1. FLAT per-session, keyed PER THERAPIST. The rate is tied to the individual,
 *     not to any grade — two "grade-A" therapists can sit at different rates
 *     (e.g. מעיין דלומי ₪250 vs דליה מלמד ₪230). Grade is a label only and is
 *     intentionally NOT modeled here; only the per-person number is.
 *  2. PSYCHIATRISTS pay BY TREATMENT TYPE, not flat: אינטייק → ₪900,
 *     מעקב פסיכיאטרי → ₪700. They perform only those two types, so a psychiatrist
 *     lookup REQUIRES a valid treatmentType.
 *
 * GUARDED: `assertTableComplete()` (and its test) fails loudly if a therapist is
 * present without a valid rate. `therapistPay()` throws on an unknown therapist,
 * and on a psychiatrist called with a missing/invalid treatmentType.
 *
 * SCOPE: standalone module. NOT wired into any save flow, form, or endpoint.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.TherapistPay = api;         // browser global (optional use)
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --- Flat per-session rates, keyed per therapist (pre-VAT) -----------------
  // The number is the person's own rate; any "grade" is a label only.
  var FLAT_RATES = {
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

  // --- Psychiatrists: pay BY treatment type (pre-VAT) ------------------------
  var PSYCH_TYPE_INTAKE = 'אינטייק';
  var PSYCH_TYPE_FOLLOWUP = 'מעקב פסיכיאטרי';
  var PSYCH_TYPES = [PSYCH_TYPE_INTAKE, PSYCH_TYPE_FOLLOWUP];

  var PSYCHIATRIST_RATES = {
    'ד״ר שפרינץ': { 'אינטייק': 900, 'מעקב פסיכיאטרי': 700 },
    'ד״ר נטליה':  { 'אינטייק': 900, 'מעקב פסיכיאטרי': 700 },
    'ד״ר דנגור':  { 'אינטייק': 900, 'מעקב פסיכיאטרי': 700 }
  };

  var DEFAULT_VAT_RATE = 0.18;

  function norm(v) { return String(v == null ? '' : v).trim(); }
  function has(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }

  function isFlatTherapist(name) { return has(FLAT_RATES, norm(name)); }
  function isPsychiatrist(name) { return has(PSYCHIATRIST_RATES, norm(name)); }

  /**
   * therapistPay(therapistName, treatmentType?) -> pre-VAT rate (number).
   *   - flat therapist  -> their flat rate (treatmentType is ignored)
   *   - psychiatrist     -> rate for the given treatmentType; REQUIRES a valid
   *                         type (אינטייק / מעקב פסיכיאטרי), else throws
   *   - unknown therapist -> throws
   */
  function therapistPay(therapistName, treatmentType) {
    var name = norm(therapistName);

    if (has(FLAT_RATES, name)) {
      return FLAT_RATES[name];   // flat: treatmentType intentionally ignored
    }

    if (has(PSYCHIATRIST_RATES, name)) {
      var type = norm(treatmentType);
      if (!type) {
        throw new Error('Psychiatrist "' + name + '" requires a treatmentType (אינטייק or מעקב פסיכיאטרי)');
      }
      var table = PSYCHIATRIST_RATES[name];
      if (!has(table, type)) {
        throw new Error('Unsupported treatment type for "' + name + '": "' + type + '" (expected אינטייק or מעקב פסיכיאטרי)');
      }
      return table[type];
    }

    throw new Error('Unknown therapist: "' + name + '"');
  }

  /**
   * withVat(amount, rate=0.18) -> amount incl. VAT. Provided for the payment
   * step; deliberately NOT used inside therapistPay (rates are stored pre-VAT).
   */
  function withVat(amount, rate) {
    if (rate === undefined || rate === null) rate = DEFAULT_VAT_RATE;
    return Number(amount) * (1 + Number(rate));
  }

  /**
   * assertTableComplete() — guard run by tests. Throws LOUDLY if any therapist
   * is present without a valid rate (a flat therapist with a non-positive/missing
   * number, or a psychiatrist missing a rate for either treatment type). Returns
   * true when consistent.
   */
  function assertTableComplete() {
    Object.keys(FLAT_RATES).forEach(function (name) {
      var r = FLAT_RATES[name];
      if (typeof r !== 'number' || !(r > 0)) {
        throw new Error('Flat therapist "' + name + '" has no valid rate');
      }
    });
    Object.keys(PSYCHIATRIST_RATES).forEach(function (name) {
      var table = PSYCHIATRIST_RATES[name];
      PSYCH_TYPES.forEach(function (type) {
        if (!table || typeof table[type] !== 'number' || !(table[type] > 0)) {
          throw new Error('Psychiatrist "' + name + '" missing a valid rate for "' + type + '"');
        }
      });
    });
    return true;
  }

  return {
    FLAT_RATES: FLAT_RATES,
    PSYCHIATRIST_RATES: PSYCHIATRIST_RATES,
    PSYCH_TYPES: PSYCH_TYPES,
    PSYCH_TYPE_INTAKE: PSYCH_TYPE_INTAKE,
    PSYCH_TYPE_FOLLOWUP: PSYCH_TYPE_FOLLOWUP,
    DEFAULT_VAT_RATE: DEFAULT_VAT_RATE,
    isFlatTherapist: isFlatTherapist,
    isPsychiatrist: isPsychiatrist,
    therapistPay: therapistPay,
    withVat: withVat,
    assertTableComplete: assertTableComplete
  };
});
