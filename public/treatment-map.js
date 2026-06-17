/**
 * treatment-map.js
 * -----------------------------------------------------------------------------
 * Hardcoded clinical → billing vocabulary map, plus the client-facing price
 * table (incl. VAT). This is the SINGLE SOURCE OF TRUTH for "the therapists app
 * speaks clinical type X; what do we bill it as, and for how much".
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Two vocabularies drift apart:
 *   - CLINICAL — what the sibling E-Zone Therapists app records per session.
 *   - BILLING  — what Vered's outpatient dashboard charges for.
 * They are NOT the same list. The clinical list is richer (CBT/EMDR/דינמי/…),
 * and one name was renamed (`מרכז יום` → `ליווי יומי בקהילה`). This module pins
 * the translation so neither side has to guess.
 *
 * DESIGN DECISIONS (locked by tests/treatment-map.test.js)
 * --------------------------------------------------------
 *  1. ONE-TO-ONE. Every clinical type maps to exactly one billing type. The
 *     five previously-unmapped clinical types (פסיכודינמי / פסיכותרפי ממוקד
 *     טראומה / עיסוי טיפולי / טיפול ממוקד התמכרויות / טיפול אינטגרטיבי) enter the
 *     billing vocabulary under their OWN exact names — they are NOT folded into
 *     existing types. So the billing list EXPANDS.
 *  2. TWO RENAMES are pinned:
 *       - פרטני כללי  → פרטני           (the generic individual билling bucket)
 *       - ליווי יומי בקהילה → itself     (was מרכז יום; the day-center / location
 *         rule stays bound to the NEW name — see DAY_CENTER_* below).
 *  3. PRICES are client-facing, incl. VAT, keyed by BILLING type:
 *       - פרטני + all individual variants (CBT, EMDR, פסיכודינמי, ממוקד טראומה,
 *         עיסוי טיפולי, ממוקד התמכרויות, אינטגרטיבי) → ₪500 / session.
 *       - מעקב פסיכיאטרי → ₪1,100 / session.
 *       - אינטייק → ₪2,300 / session  (a billing-only type; no clinical source).
 *       - ליווי יומי בקהילה → per MONTH, by frequency: 3×/wk = ₪15,000,
 *         5×/wk = ₪18,000. This is the ONLY type whose price needs
 *         `frequencyPerWeek`; any other frequency throws.
 *       - קבוצה → ₪0 (INTENTIONALLY FREE — bundled inside larger packages, not
 *         billed as a standalone line). This is a real, decided price of zero,
 *         NOT `null`. `0` (free, decided) is distinct from `null` (undecided).
 *       - טיפול משפחתי → ₪600 / session.
 *         (Both previously returned `null` to FLAG "set per client"; now priced
 *         clinic-wide. See PRICE_FLAG_PER_CLIENT, still the sentinel for any
 *         genuinely-undecided type added in future.)
 *  4. GUARDED. A 13th clinical type added without a billing target makes
 *     `assertMapComplete()` (and its test) fail LOUDLY. `clinicalToBilling`
 *     throws on an unknown clinical type; `billingPrice` throws on an unknown
 *     billing type.
 *
 * SCOPE: this module is intentionally NOT wired into the save flow, the form,
 * or `getTreatmentPlans` yet — it is a standalone map + price oracle.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.TreatmentMap = api;         // browser global (optional use)
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --- Day-center: keep the rename + location rule bound to the NEW name -----
  // Mirrors public/app.js (DAY_CENTER_KEY / LABEL / ALIASES / LOCATION). The
  // billing vocabulary uses the NEW display name; legacy `מרכז יום` rows still
  // resolve via the aliases so historical data keeps matching.
  var DAY_CENTER_KEY = 'day_center';                 // stable, never changes
  var DAY_CENTER_BILLING = 'ליווי יומי בקהילה';       // the NEW name (billing)
  var DAY_CENTER_ALIASES = ['מרכז יום', DAY_CENTER_BILLING, DAY_CENTER_KEY];
  var DAY_CENTER_LOCATION = 'רעננה הפרדס';            // mirrors app.js rule
  // Monthly price by weekly frequency. The ONLY frequency-dependent price.
  var DAY_CENTER_MONTHLY_BY_FREQ = { 3: 15000, 5: 18000 };

  // --- Clinical → billing (one-to-one, 12 clinical keys) ---------------------
  var CLINICAL_TO_BILLING = {
    'פרטני כללי':                'פרטני',                  // RENAME (generic individual)
    'פרטני CBT':                 'פרטני CBT',
    'פרטני EMDR':                'פרטני EMDR',
    'קבוצה':                     'קבוצה',
    'טיפול משפחתי':              'טיפול משפחתי',
    'מעקב פסיכיאטרי':            'מעקב פסיכיאטרי',
    'ליווי יומי בקהילה':         DAY_CENTER_BILLING,       // RENAME (was מרכז יום)
    'פסיכודינמי':                'פסיכודינמי',             // newly billable
    'פסיכותרפי ממוקד טראומה':    'פסיכותרפי ממוקד טראומה', // newly billable
    'עיסוי טיפולי':              'עיסוי טיפולי',           // newly billable
    'טיפול ממוקד התמכרויות':     'טיפול ממוקד התמכרויות',  // newly billable
    'טיפול אינטגרטיבי':          'טיפול אינטגרטיבי'        // newly billable
  };

  // Sentinel: this billing type has no clinic-wide price; bill per client
  // (free-entry pricePerSession). Distinct from "unknown type" (which throws).
  var PRICE_FLAG_PER_CLIENT = null;

  var INDIVIDUAL_SESSION_PRICE = 500;   // ₪ / session, incl. VAT

  // --- Billing prices, keyed by BILLING type (incl. VAT) ---------------------
  // Value meanings:
  //   number (incl. 0)        -> a flat per-session price. 0 is a DECIDED price
  //                              (intentionally free), NOT a "no price" flag.
  //   PRICE_FLAG_PER_CLIENT   -> intentionally UNDECIDED (null; per-client entry)
  //   DAY_CENTER_BILLING      -> NOT in this table; priced by frequency below
  var BILLING_PRICES = {
    'פרטני':                  INDIVIDUAL_SESSION_PRICE,
    'פרטני CBT':              INDIVIDUAL_SESSION_PRICE,
    'פרטני EMDR':             INDIVIDUAL_SESSION_PRICE,
    'פסיכודינמי':             INDIVIDUAL_SESSION_PRICE,
    'פסיכותרפי ממוקד טראומה': INDIVIDUAL_SESSION_PRICE,
    'עיסוי טיפולי':           INDIVIDUAL_SESSION_PRICE,
    'טיפול ממוקד התמכרויות':  INDIVIDUAL_SESSION_PRICE,
    'טיפול אינטגרטיבי':       INDIVIDUAL_SESSION_PRICE,
    'מעקב פסיכיאטרי':         1100,
    'אינטייק':                2300,     // billing-only type (no clinical source)
    // 0 == intentionally free (bundled in larger packages), a DECIDED price.
    // Distinct from PRICE_FLAG_PER_CLIENT (null == undecided / set per client).
    'קבוצה':                  0,
    'טיפול משפחתי':           600
    // DAY_CENTER_BILLING ('ליווי יומי בקהילה') priced by frequency, see below.
  };

  // The full billing vocabulary = every flat/flagged price key + the
  // frequency-priced day-center type. (12 distinct clinical targets + אינטייק.)
  var BILLING_TYPES = Object.keys(BILLING_PRICES).concat([DAY_CENTER_BILLING]);

  function norm(v) { return String(v == null ? '' : v).trim(); }

  function isDayCenterBilling(billingType) {
    return DAY_CENTER_ALIASES.indexOf(norm(billingType)) !== -1;
  }

  /**
   * clinicalToBilling(clinicalType) -> billing type string.
   * Throws on an unknown clinical type (fail loud — never silently passes an
   * unmapped clinical name through to billing).
   */
  function clinicalToBilling(clinicalType) {
    var key = norm(clinicalType);
    if (!Object.prototype.hasOwnProperty.call(CLINICAL_TO_BILLING, key)) {
      throw new Error('Unknown clinical type: "' + key + '"');
    }
    return CLINICAL_TO_BILLING[key];
  }

  /**
   * billingPrice(billingType, frequencyPerWeek?) -> price.
   *   - flat per-session types        -> the number (incl. VAT)
   *   - ליווי יומי בקהילה (day center)  -> monthly price for the given frequency
   *                                       (3 -> 15000, 5 -> 18000); REQUIRES a
   *                                       valid frequency, else throws.
   *   - קבוצה                          -> 0 (intentionally free; a decided price,
   *                                       NOT null)
   *   - טיפול משפחתי                   -> 600 (incl. VAT)
   *   - unknown billing type           -> throws.
   */
  function billingPrice(billingType, frequencyPerWeek) {
    var key = norm(billingType);

    if (isDayCenterBilling(key)) {
      if (frequencyPerWeek === undefined || frequencyPerWeek === null || frequencyPerWeek === '') {
        throw new Error('ליווי יומי בקהילה requires frequencyPerWeek (3 or 5)');
      }
      var freq = Number(frequencyPerWeek);
      if (!Object.prototype.hasOwnProperty.call(DAY_CENTER_MONTHLY_BY_FREQ, freq)) {
        throw new Error('Unsupported ליווי יומי בקהילה frequency: ' + frequencyPerWeek + ' (expected 3 or 5)');
      }
      return DAY_CENTER_MONTHLY_BY_FREQ[freq];
    }

    if (!Object.prototype.hasOwnProperty.call(BILLING_PRICES, key)) {
      throw new Error('Unknown billing type: "' + key + '"');
    }
    return BILLING_PRICES[key];   // number, or PRICE_FLAG_PER_CLIENT (null)
  }

  /**
   * assertMapComplete() — guard run by tests. Throws LOUDLY if the clinical map
   * and billing vocabulary fall out of sync, e.g. a 13th clinical type added
   * without a billing target/price. Returns true when consistent.
   */
  function assertMapComplete() {
    Object.keys(CLINICAL_TO_BILLING).forEach(function (clinical) {
      var billing = CLINICAL_TO_BILLING[clinical];
      if (BILLING_TYPES.indexOf(billing) === -1) {
        throw new Error(
          'Clinical type "' + clinical + '" maps to billing "' + billing +
          '" which is not in the billing vocabulary'
        );
      }
      // Every billing target must be priceable (number, flag, or day-center).
      billingPrice(billing, isDayCenterBilling(billing) ? 3 : undefined);
    });
    return true;
  }

  return {
    DAY_CENTER_KEY: DAY_CENTER_KEY,
    DAY_CENTER_BILLING: DAY_CENTER_BILLING,
    DAY_CENTER_ALIASES: DAY_CENTER_ALIASES,
    DAY_CENTER_LOCATION: DAY_CENTER_LOCATION,
    DAY_CENTER_MONTHLY_BY_FREQ: DAY_CENTER_MONTHLY_BY_FREQ,
    PRICE_FLAG_PER_CLIENT: PRICE_FLAG_PER_CLIENT,
    INDIVIDUAL_SESSION_PRICE: INDIVIDUAL_SESSION_PRICE,
    CLINICAL_TO_BILLING: CLINICAL_TO_BILLING,
    BILLING_PRICES: BILLING_PRICES,
    BILLING_TYPES: BILLING_TYPES,
    isDayCenterBilling: isDayCenterBilling,
    clinicalToBilling: clinicalToBilling,
    billingPrice: billingPrice,
    assertMapComplete: assertMapComplete
  };
});
