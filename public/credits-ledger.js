/**
 * credits-ledger.js
 * -----------------------------------------------------------------------------
 * Pure credits / refunds calculation for the OUTPATIENT app — ported from the
 * E-Zone-Dashboard credits ledger (PR #124), MONEY ONLY.
 *
 * What a credit is: money a client paid that covers days they did not use. A
 * client leaves (Clients.exitDate); every Payments row of that client covers a
 * window of days; the days in those windows that fall after the exit are owed
 * back. A credit of ZERO is still a recorded decision, never silence.
 *
 * SCOPE — what this module does NOT do:
 *   - No session-level logic. Nothing here reads SessionLog, counts sessions,
 *     touches creditsOwed (the per-session credit balance the therapists-app
 *     receiver maintains — a DIFFERENT, unrelated concept), or knows what a
 *     session outcome is. Session credits and cancellations stay in the
 *     therapists app + _recordSessionOutcome.
 *   - No cancellation logic.
 *   - No writes. It computes; apps-script/Code.gs (_upsertCredit) persists.
 *
 * DIFFERENCES FROM THE DASHBOARD VERSION
 *   - clientId is a real persistent key here (Payments.clientId joins straight
 *     to Clients.id), so the Dashboard's dual patientId/patientKey columns
 *     collapse to ONE clientId.
 *   - dueDate and paymentDate already exist on Payments, so the coverage-window
 *     logic ports unchanged.
 *   - POLICY: outpatient is PRO-RATA ONLY. There is NO 14-day tenure cutoff and
 *     NO last-7-days-of-the-month rule — those are residential/detox BED rules
 *     from the Dashboard and do not apply to outpatient treatment. Pro-rata at
 *     any tenure, plus prepaid_return.
 *
 * All date arithmetic uses LOCAL date parts (getFullYear/getMonth/getDate) —
 * never Date.parse on a bare 'YYYY-MM-DD', which reads it as UTC midnight and
 * drifts −1 day in Israel. Day spans use Math.round so the ±1h a DST switch
 * injects between two local midnights never shifts a day.
 *
 * Amounts are stored exactly as their inputs: Payments.amountPaid is already the
 * client-facing (VAT-inclusive) figure, so every credit figure is too. There is
 * no ex-VAT split anywhere on the outpatient billing side and this module adds
 * none.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();          // Node / tests
  } else {
    root.CreditsLedger = factory();      // browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* >>> DIVISOR — the single named constant behind the daily rate. <<<
   * rate = THAT PAYMENT ROW's amountPaid / CREDIT_DAYS_DIVISOR. Fixed 30 —
   * never the calendar day count of the month, so a 28-day February window and
   * a 31-day August window produce the same daily rate for the same money. */
  var CREDIT_DAYS_DIVISOR = 30;
  /* Credits pay out on this day of the month, never at exit. */
  var CREDIT_PAYOUT_DAY = 15;

  var CREDIT_TYPE_LABELS = {
    days_unused:    'ימים שלא נוצלו',
    prepaid_return: 'החזר תשלום מראש',
    other:          'זיכוי אחר'
  };
  var CREDIT_STATUS_LABELS = { pending: 'ממתין', paid: 'שולם', cancelled: 'בוטל' };
  var CREDIT_TYPES    = ['days_unused', 'prepaid_return', 'other'];
  var CREDIT_STATUSES = ['pending', 'paid', 'cancelled'];

  var CREDIT_RULE_LABELS = {
    prorata:        'זיכוי יחסי על ימים שלא נוצלו (בכל אורך טיפול)',
    prepaid_return: 'תשלום מראש — חלון הכיסוי מתחיל אחרי סיום הטיפול, מוחזר במלואו'
  };

  function str(v) { return String(v == null ? '' : v).trim(); }

  /* Any date-ish cell -> bare 'YYYY-MM-DD', or '' when unusable. Handles the
   * three shapes real rows carry: a bare ISO date, a full ISO timestamp (legacy
   * rows — a naive slice(0,10) would be right here but wrong for a Date), and a
   * Date object (Sheets coercion). A Date is read through LOCAL parts. */
  function isoDate(v) {
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return '';
      return isoFromLocalDate(v);
    }
    var s = str(v);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    if (!s) return '';
    var d = new Date(s);
    return isNaN(d.getTime()) ? '' : isoFromLocalDate(d);
  }

  /* 'YYYY-MM-DD' -> local-midnight Date. null for anything else. */
  function localDateFromISO(iso) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  function isoFromLocalDate(d) {
    return d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2);
  }
  function monthKey(v) {
    var iso = isoDate(v);
    return iso ? iso.slice(0, 7) : '';
  }
  /* Calendar days in a month (month1 is 1-based). Used for the calendar-month
   * fallback window only — NEVER for the daily rate (see CREDIT_DAYS_DIVISOR). */
  function daysInCalendarMonth(year, month1) {
    return new Date(year, month1, 0).getDate();
  }
  /* Whole calendar days from a to b (local midnights). Math.round absorbs the
   * ±1h a DST change injects, so a span across the March / October switch still
   * counts exact days. */
  function diffWholeDays(a, b) {
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }
  /* d + n months with the day-of-month CLAMPED to the target month's length
   * (Jan 31 + 1 -> Feb 28/29, never a March overflow). Local parts throughout. */
  function addMonthsClamped(d, n) {
    var y = d.getFullYear(), m = d.getMonth() + n, day = d.getDate();
    var last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(day, last));
  }
  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }
  function roundMoney(n) {
    var v = Number(n);
    return isFinite(v) ? Math.round(v * 100) / 100 : 0;
  }

  /* ===== COVERAGE PERIOD — what a payment ACTUALLY paid for =================
   *
   * Until coverageStart / coverageEnd existed, the period was INFERRED: the
   * row's dueDate plus "one month paid in advance". Nothing on the row
   * recorded whether that was true, so when it was not, the revenue landed in
   * the wrong month, the refund was computed against the wrong window, and no
   * screen could say so.
   *
   * These two columns are APPENDED to the Payments sheet (PAYMENTS_HEADERS in
   * apps-script/Code.gs; append-only, readers map by position). A BLANK PAIR
   * IS LEGAL and is what every row written before this change carries: it
   * reads as the inference that was already in force, DERIVED ON READ. No
   * historical row is ever rewritten.
   *
   * paymentCoverage() below stays THE ONE ANSWER to "what period does this
   * payment pay for", for every consumer (the credits ledger here, the
   * הכנסות חודשיות allocation in monthly-revenue.js, and the גבייה row in
   * app.js). It is extended, not forked: the recorded period wins when there
   * is one, the inference answers when there is not. */

  /* Longest period one payment row may claim. A cycle is a month; a year is
   * already absurd. This exists so a mistyped year ('2027-01-05' for
   * '2026-01-05') is refused at the keyboard instead of silently swallowing a
   * whole year of allocation. Mirrored by COVERAGE_MAX_DAYS in Code.gs. */
  var COVERAGE_MAX_DAYS = 366;

  /* The billingType of a ONE-OFF charge (חיוב נוסף חד פעמי). Named once here so
   * the write side (withDefaultCoverage), the read side
   * (MonthlyRevenue.coverageWindowFor) and the server guard all mean the same
   * thing by it. */
  var ONE_TIME_BILLING_TYPE = 'one_time';
  function isOneTimePayment(payment) {
    return !!payment && str(payment.billingType) === ONE_TIME_BILLING_TYPE;
  }

  /* Do (y, m1, day) name a day that actually EXISTS? Feb 30 and month 13 do
   * not; Date rolls both over silently, so the parts are compared back. */
  function isRealCalendarDate(y, m1, day) {
    if (!(m1 >= 1 && m1 <= 12) || !(day >= 1 && day <= 31)) return false;
    var d = new Date(y, m1 - 1, day);
    return d.getFullYear() === y && d.getMonth() === m1 - 1 && d.getDate() === day;
  }

  /* Normalize ONE coverage-period value to bare 'YYYY-MM-DD'.
   *   ''    — blank / absent (LEGAL: it means "infer")
   *   null  — present but unusable (the caller refuses; nothing is coerced)
   *
   * Deliberately STRICTER than isoDate() above, which is a read-side healer
   * and returns '' for anything it cannot parse. A value being WRITTEN must be
   * refused, not healed — silently turning garbage into '' would store "infer"
   * for a period somebody meant to record. Three shapes only: a bare ISO date
   * naming a real day, a full ISO timestamp, and a Date object (both read
   * through LOCAL parts — never toISOString().slice(), which lands a day early
   * in Israel). Anything else, including a loose '2026-1-5' whose parsing is
   * engine-dependent, is refused. EXACT MIRROR of _coverageDateISO() in
   * apps-script/Code.gs; a parity sweep pins the two together. */
  function coverageDateISO(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v instanceof Date) return isNaN(v.getTime()) ? null : isoFromLocalDate(v);
    if (typeof v !== 'string') return null;   // a number/boolean/object is not a date
    var t = v.trim();
    if (!t) return '';
    var m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      return isRealCalendarDate(Number(m[1]), Number(m[2]), Number(m[3])) ? t : null;
    }
    if (!/^\d{4}-\d{2}-\d{2}T/.test(t)) return null;
    var ts = new Date(t);
    return isNaN(ts.getTime()) ? null : isoFromLocalDate(ts);
  }

  /* Validate a recorded coverage period. '' when acceptable, otherwise the
   * Hebrew reason. The SAME rule the גבייה editor checks before saving and
   * _coveragePeriodError() enforces in Code.gs on write — the server is the
   * authority; this copy only spares a round-trip and names the field.
   *
   * REFUSED: a half-filled pair, a malformed date, a day that does not exist,
   * an end before its start, a span longer than COVERAGE_MAX_DAYS.
   * NOT REFUSED: a blank pair (means "infer" — what every historical row
   * carries), and overlaps or gaps against OTHER rows. Both of those are real:
   * two months paid at once, a skipped month, a re-dated cycle — and
   * suggestCredits() already de-duplicates overlapping days (creditedThrough),
   * so an overlap costs nothing. Refusing one would force the recorder to lie
   * about what the money bought. */
  function coveragePeriodError(startRaw, endRaw) {
    /* PRESENCE first, then validity — the same order as the server. Deciding
     * "half-filled" from the PARSED value would report '' + 'garbage' as a
     * malformed date on one side and a missing date on the other. */
    var rawS = str(startRaw), rawE = str(endRaw);
    if (!rawS && !rawE) return '';
    if (!rawS || !rawE) return 'יש למלא גם תאריך התחלה וגם תאריך סיום לתקופת הכיסוי';
    var s = coverageDateISO(startRaw), e = coverageDateISO(endRaw);
    if (!s || !e) return 'תאריך לא תקין בתקופת הכיסוי';
    var ds = localDateFromISO(s), de = localDateFromISO(e);
    if (!ds || !de) return 'תאריך לא תקין בתקופת הכיסוי';
    if (de < ds) return 'תאריך הסיום מוקדם מתאריך ההתחלה';
    var days = diffWholeDays(ds, de) + 1;
    if (days > COVERAGE_MAX_DAYS) {
      return 'תקופת כיסוי ארוכה מדי (' + days + ' ימים, המקסימום ' + COVERAGE_MAX_DAYS + ')';
    }
    return '';
  }

  /* The period a payment row pays for, INFERRED from its due date: dueDate D
   * through D + 1 month − 1 day (local parts, day clamped) — never "until the
   * next payment row", which is usually absent at exit. This was the whole
   * rule before the two columns existed, and it is still the DEFAULT offered
   * when a payment is recorded and the fallback for every row carrying none.
   * { start, end } as local Dates, or null. */
  function inferredCoverage(payment) {
    var start = localDateFromISO(isoDate(payment && payment.dueDate));
    if (!start) return null;
    return { start: start, end: addDays(addMonthsClamped(start, 1), -1) };
  }

  /* The period a payment row RECORDS, or null when it records none (blank
   * pair) or records something unusable. An unusable stored pair is treated as
   * ABSENT rather than thrown: a row corrupted by a manual sheet edit must
   * still produce a window, and the inferred one is the honest fallback. */
  function recordedCoverage(payment) {
    if (!payment) return null;
    if (coveragePeriodError(payment.coverageStart, payment.coverageEnd)) return null;
    var s = coverageDateISO(payment.coverageStart), e = coverageDateISO(payment.coverageEnd);
    if (!s || !e) return null;                       // blank pair — nothing recorded
    var start = localDateFromISO(s), end = localDateFromISO(e);
    if (!start || !end) return null;
    return { start: start, end: end };
  }

  /* THE ONE SOURCE OF TRUTH for "what period does this payment pay for".
   *
   * THE RECORDED PERIOD WINS. coverageStart/coverageEnd are columns ON the
   * payment row: when both are stored and usable they ARE the answer — the
   * person who took the money said what it bought, and an assumption does not
   * get to overrule them. When they are absent — every row written before
   * this change — the period is inferred exactly as it always was, derived on
   * read, so history reads today exactly as it read yesterday.
   *
   * -> { start, end, source } as local Dates; source is 'recorded' |
   *    'inferred', carried so a screen can say which it is rather than
   *    implying a precision it lacks. null only when there is neither a usable
   *    recorded pair nor a due date.
   *
   * NOTE for חיובים נוספים חד פעמיים: the הכנסות חודשיות view narrows a
   * one-off charge to its single due day (MonthlyRevenue.coverageWindowFor,
   * unchanged). That narrowing is the revenue view's rule and stays there; the
   * credits ledger reads this function directly, exactly as it always has. */
  function paymentCoverage(payment) {
    var rec = recordedCoverage(payment);
    if (rec) return { start: rec.start, end: rec.end, source: 'recorded' };
    var inf = inferredCoverage(payment);
    if (!inf) return null;
    return { start: inf.start, end: inf.end, source: 'inferred' };
  }

  /* Does this row's recorded period DIFFER from the cycle that would have been
   * inferred for it? Drives the מותאמת badge. A row recording exactly the
   * default is NOT marked — the badge means "somebody decided otherwise", and
   * a badge on every row would mean nothing. */
  function coverageDiffersFromDefault(payment) {
    var rec = recordedCoverage(payment);
    if (!rec) return false;
    var inf = inferredCoverage(payment);
    if (!inf) return true;      // recorded a period for a row with no cycle to infer
    return isoFromLocalDate(rec.start) !== isoFromLocalDate(inf.start)
        || isoFromLocalDate(rec.end)   !== isoFromLocalDate(inf.end);
  }

  /* Stamp the inferred cycle onto a payment that records no period, so the
   * value lands in the sheet as a FACT instead of being re-derived from an
   * assumption on every future read. Called on the one write path
   * (paymentForSheet in app.js), so accepting the default costs the recorder
   * zero clicks and changes zero figures — the default IS what was being
   * inferred. A row that already records a period is returned untouched.
   *
   * ONE-OFF EXTRA CHARGES ARE LEFT BLANK, DELIBERATELY. A חיוב נוףס חד פעמי
   * covers the day of the session it charges for, not a month
   * (MonthlyRevenue.coverageWindowFor), so stamping a month-long window on it
   * would be a lie — and stamping its single day would change what the
   * credits ledger reads for that row today. Blank keeps BOTH readers exactly
   * where they are. */
  function withDefaultCoverage(payment) {
    if (!payment) return payment;
    if (isOneTimePayment(payment)) return payment;
    if (recordedCoverage(payment)) return payment;
    var inf = inferredCoverage(payment);
    if (!inf) return payment;
    return assign({}, payment, {
      coverageStart: isoFromLocalDate(inf.start),
      coverageEnd: isoFromLocalDate(inf.end)
    });
  }

  /* The 15th of the next month on or after decidedDate: decided on the 1st–15th
   * -> the 15th of that month; the 16th onward -> the 15th of the following
   * month. Pure string arithmetic on the parts (no Date, so no timezone can
   * shift it). Mirrors _payoutDateFor() in Code.gs, the authoritative copy on
   * write; this one only previews. */
  function payoutDateFor(decidedISO) {
    var m = String(decidedISO || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    var y = Number(m[1]), mo = Number(m[2]);
    if (Number(m[3]) > CREDIT_PAYOUT_DAY) { mo += 1; if (mo > 12) { mo = 1; y += 1; } }
    return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + CREDIT_PAYOUT_DAY).slice(-2);
  }

  /* Never credit more than was actually received. Pure. */
  function applyCreditCap(uncapped, amountPaid) {
    var u = roundMoney(uncapped), p = roundMoney(amountPaid);
    return { calculatedAmount: Math.min(u, p), capped: u > p };
  }

  /**
   * suggestCredits(client, exitDate, payments) -> [{ creditType,
   *   calculatedAmount, allocationMonth, basis }]
   *
   * Pure. ONE entry per Payments row of the client whose coverage window still
   * has days after the exit, plus a single ZERO days_unused entry when no window
   * does (so "no refund owed" is a recorded decision).
   *
   * For every Payments row of the client (joined on clientId), in dueDate order:
   *   window     = [dueDate, dueDate + 1 month − 1 day]
   *   unusedDays = days in that window STRICTLY AFTER exitDate, minus any day an
   *                earlier row's window already credited — overlapping windows
   *                never credit the same day twice (basis.creditedFrom,
   *                basis.alreadyCreditedThrough).
   *   rate       = THAT ROW's amountPaid / CREDIT_DAYS_DIVISOR (30).
   *   raw        = rate × unusedDays, capped at that row's amountPaid.
   *
   * Classification is by the WINDOW, not by the month key:
   *   window starts on or before exitDate -> days_unused, PRO-RATA at any
   *     tenure (outpatient has no tenure cutoff and no last-days rule).
   *   window starts after exitDate -> prepaid_return: the whole window is
   *     unearned, so the row's FULL amountPaid returns — not rate × windowDays
   *     (the ÷30 raw is still recorded in basis, and a 31-day window's raw
   *     exceeds amountPaid and is capped to it, basis.fullReturn = true).
   * A window that ended before the exit is fully used and produces nothing.
   *
   * allocationMonth = monthKey(dueDate) is REPORTING METADATA ONLY — it never
   * enters the math. There is no "amountPaid for the credited month" lookup
   * anywhere; every figure comes from the row itself.
   */
  function suggestCredits(client, exitDate, payments) {
    var exitISO = isoDate(exitDate);
    var exit    = localDateFromISO(exitISO);
    if (!client || !exit) return [];

    var clientId  = str(client.id);
    var startISO  = isoDate(client.startDate);
    var start     = localDateFromISO(startISO);
    var tenureDays = start ? diffWholeDays(start, exit) : null;

    // Patient-level context carried on every row's basis. `rule` is always
    // pro-rata for days_unused: outpatient credits at ANY tenure.
    var common = {
      policy: 'outpatient_prorata',
      clientId: clientId,
      startDate: startISO,
      exitDate: exitISO,
      tenureDays: tenureDays,
      divisor: CREDIT_DAYS_DIVISOR
    };

    var rows = (Array.isArray(payments) ? payments : [])
      .filter(function (r) { return r && str(r.clientId) === clientId && r.dueDate; })
      .map(function (r) {
        var copy = {};
        for (var k in r) { if (Object.prototype.hasOwnProperty.call(r, k)) copy[k] = r[k]; }
        copy.dueDate = isoDate(r.dueDate);
        return copy;
      })
      .filter(function (r) { return /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate); })
      .sort(function (a, b) { return a.dueDate.localeCompare(b.dueDate); });

    var out = [];
    var creditedThrough = null;   // last day already credited by an earlier window
    var latestUsedRow = null;     // latest row whose window started on/before the exit

    rows.forEach(function (r) {
      var cov = paymentCoverage(r);
      if (!cov) return;
      var wStart = cov.start, wEnd = cov.end;
      var windowDays = diffWholeDays(wStart, wEnd) + 1;
      var amountPaid = roundMoney(Number(r.amountPaid) || 0);
      var rate = amountPaid / CREDIT_DAYS_DIVISOR;
      var allocationMonth = monthKey(r.dueDate);   // reporting only
      var rowBasis = {
        paymentId: str(r.id),
        paymentDueDate: r.dueDate,
        paymentDate: isoDate(r.paymentDate),
        coverageStart: isoFromLocalDate(wStart),
        coverageEnd: isoFromLocalDate(wEnd),
        windowDays: windowDays,
        billedAmount: roundMoney(Number(r.amountDue) || 0),
        amountPaid: amountPaid,
        dailyRate: roundMoney(rate)
      };

      if (wStart > exit) {
        // Whole window after the exit -> unearned in full.
        var rawFull = roundMoney(rate * windowDays);
        out.push({
          creditType: 'prepaid_return',
          allocationMonth: allocationMonth,
          calculatedAmount: amountPaid,
          basis: assign({}, common, rowBasis, {
            rule: 'prepaid_return', classification: 'window_after_exit',
            creditedFrom: isoFromLocalDate(wStart), alreadyCreditedThrough: '',
            unusedDays: windowDays, uncappedAmount: rawFull,
            capped: rawFull > amountPaid, fullReturn: true
          })
        });
        return;
      }

      latestUsedRow = {
        allocationMonth: allocationMonth, rowBasis: rowBasis,
        amountPaid: amountPaid, rate: rate
      };
      if (wEnd <= exit) return;   // fully used — nothing to decide

      // Days strictly after the exit, not yet credited by an earlier window.
      var from = addDays(exit, 1);
      if (creditedThrough && creditedThrough >= from) from = addDays(creditedThrough, 1);
      var unusedDays = from > wEnd ? 0 : diffWholeDays(from, wEnd) + 1;
      var alreadyCreditedThrough = creditedThrough ? isoFromLocalDate(creditedThrough) : '';
      if (unusedDays > 0) creditedThrough = wEnd;
      var raw = roundMoney(rate * unusedDays);
      var cap = applyCreditCap(raw, amountPaid);
      out.push({
        creditType: 'days_unused',
        allocationMonth: allocationMonth,
        calculatedAmount: cap.calculatedAmount,
        basis: assign({}, common, rowBasis, {
          rule: 'prorata', classification: 'window_contains_exit',
          creditedFrom: unusedDays > 0 ? isoFromLocalDate(from) : '',
          alreadyCreditedThrough: alreadyCreditedThrough,
          unusedDays: unusedDays, uncappedAmount: raw, capped: cap.capped
        })
      });
    });

    if (!out.some(function (o) { return o.creditType === 'days_unused'; })) {
      // Nothing left to credit for days — still ONE auditable zero row: under
      // the latest window that started on/before the exit, else (no payment
      // rows at all) the exit's own calendar month with nothing received.
      var allocationMonth, rowBasis, rate, unusedDays, coverageSource;
      if (latestUsedRow) {
        allocationMonth = latestUsedRow.allocationMonth;
        rowBasis = latestUsedRow.rowBasis;
        rate = latestUsedRow.rate;
        unusedDays = 0;
        coverageSource = 'payment';
      } else {
        var y = exit.getFullYear(), m1 = exit.getMonth() + 1;
        var monthDays = daysInCalendarMonth(y, m1);
        var cStart = new Date(y, m1 - 1, 1), cEnd = new Date(y, m1 - 1, monthDays);
        allocationMonth = exitISO.slice(0, 7);
        rate = 0;
        coverageSource = 'calendar_month';
        unusedDays = diffWholeDays(exit, cEnd);
        rowBasis = {
          paymentId: '', paymentDueDate: '', paymentDate: '',
          coverageStart: isoFromLocalDate(cStart), coverageEnd: isoFromLocalDate(cEnd),
          windowDays: monthDays, billedAmount: 0, amountPaid: 0, dailyRate: 0
        };
      }
      out.unshift({
        creditType: 'days_unused',
        allocationMonth: allocationMonth,
        calculatedAmount: 0,
        basis: assign({}, common, rowBasis, {
          rule: 'prorata', classification: 'no_unused_window',
          coverageSource: coverageSource, creditedFrom: '', alreadyCreditedThrough: '',
          unusedDays: unusedDays, uncappedAmount: roundMoney(rate * unusedDays), capped: false
        })
      });
    }
    return out;
  }

  /* Object.assign, ES5-safe (Apps Script parity + old browsers). */
  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) {
        if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
      }
    }
    return target;
  }

  /* Human-readable calculation trail persisted in the row's `reason` column at
   * creation (the machine copy is the `basis` JSON column). Hebrew, RTL. */
  function creditBasisText(creditType, basis) {
    if (!basis) return '';
    var windowText = 'חלון כיסוי ' + basis.coverageStart + ' → ' + basis.coverageEnd +
      ' (' + basis.windowDays + ' ימים' +
      (basis.paymentDueDate ? ', תשלום ' + basis.paymentDueDate : ' — חודש קלנדרי, אין שורת תשלום') + ')';
    var parts = [CREDIT_RULE_LABELS[basis.rule] || basis.rule || '', windowText];
    if (creditType === 'prepaid_return') {
      parts.push('הוחזר במלואו: ' + basis.amountPaid + ' ₪ (שולם בפועל)');
      parts.push('לפי ' + basis.dailyRate + ' ₪ ליום × ' + basis.unusedDays +
        ' ימים = ' + basis.uncappedAmount + ' ₪ לפני תקרה');
    } else {
      if (basis.alreadyCreditedThrough) {
        parts.push('ימים עד ' + basis.alreadyCreditedThrough + ' כבר זוכו בשורה קודמת');
      }
      parts.push(basis.unusedDays + ' ימים שלא נוצלו' +
        (basis.creditedFrom ? ' (מ־' + basis.creditedFrom + ')' : '') +
        ' × ' + basis.dailyRate + ' ₪ ליום (' + basis.amountPaid + ' ₪ ÷ ' +
        basis.divisor + ') = ' + basis.uncappedAmount + ' ₪');
    }
    if (basis.capped) parts.push('הוגבל לתקרת הסכום ששולם: ' + basis.amountPaid + ' ₪');
    if (basis.tenureDays !== null && basis.tenureDays !== undefined) {
      parts.push('אורך טיפול: ' + basis.tenureDays + ' ימים (אין חיתוך — זיכוי יחסי בכל אורך)');
    }
    return parts.filter(function (p) { return !!p; }).join(' · ');
  }

  /* Client-side validation of ONE modal line before any write. The server
   * re-validates everything (never trust this); this only spares a round trip
   * and names the field in Hebrew. Returns '' when the line is valid. */
  function validateCreditLine(line) {
    if (!line) return 'שורה ריקה';
    if (CREDIT_TYPES.indexOf(str(line.creditType)) < 0) return 'סוג זיכוי לא תקין';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(str(line.allocationMonth))) return 'חודש שיוך לא תקין';
    var calculated = Number(line.calculatedAmount);
    var amount = Number(line.amount);
    if (!isFinite(calculated) || calculated < 0) return 'סכום מחושב לא תקין';
    if (!isFinite(amount) || amount < 0) return 'סכום לא תקין';
    if (roundMoney(amount) !== roundMoney(calculated) && !str(line.overrideReason)) {
      return 'שינוי הסכום מחייב נימוק';
    }
    if (str(line.creditType) === 'other' && !str(line.reason)) return 'זיכוי ידני מחייב נימוק';
    if (CREDIT_STATUSES.indexOf(str(line.status) || 'pending') < 0) return 'סטטוס לא תקין';
    if (str(line.status) === 'paid' && (!str(line.paidDate) || !str(line.method))) {
      return 'סימון כשולם מחייב תאריך תשלום ואמצעי תשלום';
    }
    if (str(line.decidedDate) && !/^\d{4}-\d{2}-\d{2}$/.test(str(line.decidedDate))) {
      return 'תאריך החלטה לא תקין';
    }
    return '';
  }

  /* A sheet row -> the shape the UI works with. Reads both identity and money
   * fields AS STORED; nothing is re-derived at read time. */
  function normalizeCredit(r) {
    r = r || {};
    var basis = r.basis;
    if (typeof basis === 'string' && basis) {
      try { basis = JSON.parse(basis); } catch (_) { basis = {}; }
    }
    return {
      id: str(r.id),
      clientId: str(r.clientId),
      clientName: str(r.clientName),
      creditType: str(r.creditType),
      allocationMonth: str(r.allocationMonth),
      calculatedAmount: roundMoney(r.calculatedAmount),
      amount: roundMoney(r.amount),
      overrideReason: str(r.overrideReason),
      reason: str(r.reason),
      approvedBy: str(r.approvedBy),
      decidedDate: isoDate(r.decidedDate),
      payoutDate: isoDate(r.payoutDate),
      status: str(r.status) || 'pending',
      paidDate: isoDate(r.paidDate),
      method: str(r.method),
      notes: str(r.notes),
      basis: basis && typeof basis === 'object' ? basis : {},
      createdAt: str(r.createdAt),
      createdBy: str(r.createdBy),
      updatedAt: str(r.updatedAt),
      updatedBy: str(r.updatedBy)
    };
  }

  function creditsForClient(credits, clientId) {
    var id = str(clientId);
    if (!id) return [];
    return (Array.isArray(credits) ? credits : [])
      .map(normalizeCredit)
      .filter(function (c) { return c.clientId === id; });
  }

  /**
   * pendingCreditsByPayout(credits) -> {
   *   groups: [{ payoutDate, credits: [...], total }],   // ascending by date
   *   total                                              // grand total
   * }
   * PENDING rows only (paid and cancelled are settled/void). A row with no
   * payoutDate groups under '' and sorts last, so it is visible, not lost.
   */
  function pendingCreditsByPayout(credits) {
    var byDate = {}, order = [], grand = 0;
    (Array.isArray(credits) ? credits : []).map(normalizeCredit).forEach(function (c) {
      if (c.status !== 'pending') return;
      var key = c.payoutDate || '';
      if (!byDate[key]) { byDate[key] = { payoutDate: key, credits: [], total: 0 }; order.push(key); }
      byDate[key].credits.push(c);
      byDate[key].total = roundMoney(byDate[key].total + c.amount);
      grand = roundMoney(grand + c.amount);
    });
    order.sort(function (a, b) {
      if (!a) return 1;            // undated last
      if (!b) return -1;
      return a.localeCompare(b);
    });
    return {
      groups: order.map(function (k) {
        byDate[k].credits.sort(function (a, b) {
          return (a.clientName || '').localeCompare(b.clientName || '', 'he');
        });
        return byDate[k];
      }),
      total: grand
    };
  }

  /**
   * buildCreditLines(existing, suggestions, today) -> modal lines.
   * Already-saved rows come first (editable, carrying their id + updatedAt for
   * the stale-save echo); a suggestion whose (creditType, allocationMonth) is
   * already on a saved row is DROPPED, so reopening the modal never proposes a
   * duplicate of a decision already made.
   */
  function buildCreditLines(existing, suggestions, today) {
    var saved = (Array.isArray(existing) ? existing : []).map(normalizeCredit);
    var seen = {};
    var lines = saved.map(function (c) {
      seen[c.creditType + '|' + c.allocationMonth] = true;
      return assign({}, c, { isNew: false });
    });
    (Array.isArray(suggestions) ? suggestions : []).forEach(function (s) {
      var key = s.creditType + '|' + s.allocationMonth;
      if (seen[key]) return;
      seen[key] = true;
      var decided = str(today) || '';
      lines.push({
        id: '', isNew: true,
        clientId: '', clientName: '',
        creditType: s.creditType,
        allocationMonth: s.allocationMonth,
        calculatedAmount: roundMoney(s.calculatedAmount),
        amount: roundMoney(s.calculatedAmount),
        overrideReason: '',
        reason: creditBasisText(s.creditType, s.basis),
        approvedBy: '',
        decidedDate: decided,
        payoutDate: payoutDateFor(decided),
        status: 'pending',
        paidDate: '', method: '', notes: '',
        basis: s.basis,
        createdAt: '', createdBy: '', updatedAt: '', updatedBy: ''
      });
    });
    return lines;
  }

  return {
    CREDIT_DAYS_DIVISOR: CREDIT_DAYS_DIVISOR,
    CREDIT_PAYOUT_DAY: CREDIT_PAYOUT_DAY,
    CREDIT_TYPES: CREDIT_TYPES,
    CREDIT_STATUSES: CREDIT_STATUSES,
    CREDIT_TYPE_LABELS: CREDIT_TYPE_LABELS,
    CREDIT_STATUS_LABELS: CREDIT_STATUS_LABELS,
    CREDIT_RULE_LABELS: CREDIT_RULE_LABELS,
    isoDate: isoDate,
    monthKey: monthKey,
    localDateFromISO: localDateFromISO,
    isoFromLocalDate: isoFromLocalDate,
    daysInCalendarMonth: daysInCalendarMonth,
    diffWholeDays: diffWholeDays,
    addMonthsClamped: addMonthsClamped,
    addDays: addDays,
    roundMoney: roundMoney,
    COVERAGE_MAX_DAYS: COVERAGE_MAX_DAYS,
    ONE_TIME_BILLING_TYPE: ONE_TIME_BILLING_TYPE,
    isOneTimePayment: isOneTimePayment,
    isRealCalendarDate: isRealCalendarDate,
    coverageDateISO: coverageDateISO,
    coveragePeriodError: coveragePeriodError,
    inferredCoverage: inferredCoverage,
    recordedCoverage: recordedCoverage,
    paymentCoverage: paymentCoverage,
    coverageDiffersFromDefault: coverageDiffersFromDefault,
    withDefaultCoverage: withDefaultCoverage,
    payoutDateFor: payoutDateFor,
    applyCreditCap: applyCreditCap,
    suggestCredits: suggestCredits,
    creditBasisText: creditBasisText,
    validateCreditLine: validateCreditLine,
    normalizeCredit: normalizeCredit,
    creditsForClient: creditsForClient,
    pendingCreditsByPayout: pendingCreditsByPayout,
    buildCreditLines: buildCreditLines
  };
});
