/**
 * session-outcome.js
 * -----------------------------------------------------------------------------
 * ONE vocabulary for a reported session (a SessionLog row) — did it take place,
 * and if not, why — and what that means for the PATIENT's account and for the
 * THERAPIST's pay. Sandra, 2026-11-16: «צריך להבליט בדיווח המטפל אם המפגש התקיים
 * או לא … זה צריך להיות ברור ולעבור ל-OUT כי שם מנהלים את חשבון המטופל והתשלום
 * למטפלים».
 *
 * THE RULE (decided by the report, never inferred from timestamps here):
 *
 *   outcome                    took place   patient                therapist
 *   happened                   yes          charged (session used) paid
 *   patient_cancelled_notice   no           NOT charged, +1 credit not paid
 *     (24 hours' notice or more)
 *   patient_no_show            no           charged, no credit     paid
 *     (no notice / less than 24 hours)
 *   therapist_cancelled        no           NOT charged, +1 credit not paid
 *
 * Display only. The amounts, the credit balance and the pay are computed and
 * stored by apps-script/Code.gs (_recordSessionOutcome); this module reads the
 * row's stored `outcome` / `creditStatus` and words them. It holds NO price or
 * pay constant, so it stays an ordinary public script (unlike therapist-pay.js).
 *
 * Tokens are the stored values; Hebrew is render-time only. The token set is
 * CLOSED and mirrors SESSION_STATUS_BY_OUTCOME in Code.gs
 * (`test/session-notice-outcome.test.js` pins the two together).
 *
 * Browser global `SessionOutcome`; Node `require` for tests.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.SessionOutcome = api;       // browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Display order: took place first, then the three «לא התקיים» reasons.
  var VALUES = ['happened', 'patient_cancelled_notice', 'patient_no_show', 'therapist_cancelled'];

  var LABELS = {
    happened: 'התקיים',
    patient_cancelled_notice: 'המטופל/ת ביטל/ה — הודעה של 24 שעות ומעלה',
    patient_no_show: 'המטופל/ת לא הגיע/ה / ביטל/ה בפחות מ־24 שעות',
    therapist_cancelled: 'המטפל/ת ביטל/ה'
  };

  var HELD_TEXT = { yes: 'התקיים', no: 'לא התקיים', unknown: '—' };

  // Outcomes that pay the therapist (the therapist showed up) / grant the patient a credit.
  var PAID = { happened: true, patient_no_show: true };
  var CREDIT = { patient_cancelled_notice: true, therapist_cancelled: true };

  function str(v) { return String(v == null ? '' : v).trim(); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function isKnown(v) { return own(LABELS, str(v)); }
  function labelFor(v) { var k = str(v); return own(LABELS, k) ? LABELS[k] : ''; }

  /** true = took place, false = did not, null = unknown / unreported token. */
  function held(v) {
    var k = str(v);
    if (!own(LABELS, k)) return null;
    return k === 'happened';
  }
  function heldText(v) {
    var h = held(v);
    return h === null ? HELD_TEXT.unknown : (h ? HELD_TEXT.yes : HELD_TEXT.no);
  }
  function paysTherapist(v) { return own(PAID, str(v)); }
  function grantsCredit(v) { return own(CREDIT, str(v)); }

  function isOneTime(row) { return str(row && row.oneTimeSessionId) !== ''; }

  /**
   * What the row means for the patient's account.
   * → { kind, text }  kind ∈ 'charged' | 'credit' | 'credit_used' | 'none' | 'review' | 'unknown'
   * 'review' = the row could not be applied to a patient (no single client match /
   * the quota could not be determined) — a person must look at it.
   */
  function patientEffect(row) {
    row = row || {};
    var o = str(row.outcome), cs = str(row.creditStatus);
    if (!own(LABELS, o)) return { kind: 'unknown', text: '—' };
    if (isOneTime(row)) {
      // Outside the package: its own charge, never a credit.
      if (o === 'therapist_cancelled') return { kind: 'none', text: 'טיפול חד פעמי — ללא חיוב' };
      return { kind: 'charged', text: 'טיפול חד פעמי — מחויב' };
    }
    if (own(CREDIT, o)) {
      if (cs === 'credit_added') return { kind: 'credit', text: 'לא מחויב — נוצר קרדיט למפגש השלמה' };
      return { kind: 'review', text: 'קרדיט לא נרשם — המטופל/ת לא זוהה, לבדיקה' };
    }
    if (o === 'patient_no_show') return { kind: 'charged', text: 'מחויב — המפגש נוצל, ללא קרדיט' };
    // happened
    if (cs === 'covered') return { kind: 'credit_used', text: 'מפגש השלמה — מומש קרדיט' };
    if (cs === 'within_quota') return { kind: 'charged', text: 'מחויב — במסגרת החבילה' };
    if (cs === 'beyond_no_credit') return { kind: 'charged', text: 'מחויב — מעבר למכסה החודשית, ללא קרדיט' };
    if (cs === 'quota_unknown') return { kind: 'review', text: 'התקיים — מכסת החבילה לא ידועה, לבדיקה' };
    if (cs === 'no_client') return { kind: 'review', text: 'התקיים — המטופל/ת לא זוהה, לבדיקה' };
    return { kind: 'charged', text: 'מחויב' };
  }

  /** What the row means for the therapist's pay (wording only — never an amount). */
  function therapistEffect(row) {
    row = row || {};
    var o = str(row.outcome);
    if (!own(LABELS, o)) return { paid: false, text: '—' };
    if (str(row.payModel) === 'global') return { paid: false, text: 'מטפל/ת בשכר גלובלי — ללא תשלום לפי מפגש' };
    return own(PAID, o) ? { paid: true, text: 'משולם למטפל/ת' } : { paid: false, text: 'ללא תשלום למטפל/ת' };
  }

  /**
   * A client's reported sessions, newest first. Matched by the SERVER-resolved
   * `clientId` only (a single phone match in Code.gs) — never by name, so a row
   * that could not be tied to exactly one client is not guessed onto anyone.
   */
  function forClient(rows, clientId, limit) {
    var id = str(clientId);
    if (!id || !Array.isArray(rows)) return [];
    var out = rows.filter(function (r) { return r && str(r.clientId) === id; });
    out.sort(function (a, b) {
      var da = str(a.date), db = str(b.date);
      if (da !== db) return da < db ? 1 : -1;
      return str(a.recordedAt) < str(b.recordedAt) ? 1 : (str(a.recordedAt) > str(b.recordedAt) ? -1 : 0);
    });
    return typeof limit === 'number' && limit > 0 ? out.slice(0, limit) : out;
  }

  /** Counts for a client's list header. */
  function summarize(rows) {
    var s = { total: 0, held: 0, notHeld: 0, credits: 0, charged: 0, review: 0 };
    (rows || []).forEach(function (r) {
      var h = held(r && r.outcome);
      if (h === null) return;
      s.total++;
      if (h) s.held++; else s.notHeld++;
      var e = patientEffect(r);
      if (e.kind === 'credit') s.credits++;
      else if (e.kind === 'charged') s.charged++;
      else if (e.kind === 'review') s.review++;
    });
    return s;
  }

  return {
    VALUES: VALUES,
    LABELS: LABELS,
    HELD_TEXT: HELD_TEXT,
    isKnown: isKnown,
    labelFor: labelFor,
    held: held,
    heldText: heldText,
    paysTherapist: paysTherapist,
    grantsCredit: grantsCredit,
    isOneTime: isOneTime,
    patientEffect: patientEffect,
    therapistEffect: therapistEffect,
    forClient: forClient,
    summarize: summarize
  };
});
