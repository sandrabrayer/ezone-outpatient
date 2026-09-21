/**
 * monthly-revenue.js
 * -----------------------------------------------------------------------------
 * Pure MONTHLY REVENUE allocation for the OUTPATIENT app.
 *
 * THE QUESTION THIS ANSWERS: "how much revenue belongs to month X" — NOT "how
 * much cash arrived during month X". Those are different numbers and the daily
 * גבייה screen answers neither: it is a worklist ("who is due today"), and its
 * סיכום חודשי panel buckets rows by monthKey(dueDate), which is the month the
 * cycle STARTED in, not the month the money was earned in.
 *
 * ALLOCATION RULE — BY COVERAGE WINDOW, DAY BY DAY
 * -------------------------------------------------
 * A payment's coverage window is [dueDate, dueDate + 1 month − 1 day] — the
 * SAME window credits-ledger.js already computes, reused here verbatim via
 * CreditsLedger.paymentCoverage (not reimplemented; see REUSE below). A window
 * that straddles a month boundary contributes to BOTH months, split by the
 * number of its days falling in each:
 *
 *     ₪3,000 covering 20 Jan – 19 Feb  (31 days)
 *       → January: 12/31 × 3,000 = ₪1,161.29
 *       → February: 19/31 × 3,000 = ₪1,838.71
 *
 * NEITHER `paymentDate` NOR `monthKey(dueDate)` takes part in the allocation.
 * paymentDate is carried into the drill-down rows for transparency (so you can
 * see when the cash actually landed) but it never moves a shekel between
 * months. That is the whole point: a client who pays three months late still
 * has their money land in the months it paid for.
 *
 * THE FOUR FIGURES
 * ----------------
 *   RECEIVED  — cash already collected, allocated to this month by the window
 *               above. Money in hand. Certain.
 *   EXPECTED  — contracted money for this month that is NOT yet in hand. An
 *               ASSUMPTION — it holds only as long as the client stays and
 *               actually pays. Three kinds, summed into one figure but kept
 *               separable in `.rows` and in the sub-buckets:
 *                 billed_unpaid — a Payments row exists and is short
 *                 projected     — a future cycle, no row written yet
 *                 unbilled_past — a cycle whose date has PASSED with no row at
 *                                 all. Usually a recording gap, not a
 *                                 forecast, so it gets its own sub-bucket and
 *                                 the UI flags it. It stays inside EXPECTED
 *                                 because the money is genuinely owed for
 *                                 these days; hiding it would understate the
 *                                 month and bury the leak.
 *   CREDITS   — refunds allocated to this month, as a NEGATIVE.
 *   NET       — received + expected − credits.
 *
 * RECEIVED AND EXPECTED ARE NEVER SUMMED INTO ONE FIGURE. They are different
 * certainties — one is money, the other is a forecast — and a single blended
 * "revenue" number silently launders the forecast into the bank balance. NET
 * exists as the one place they meet, and is labelled as the projection it is.
 * This module returns them as separate fields and has no combined accessor.
 *
 * NO DOUBLE COUNTING. A day of the month is either paid for (its share sits in
 * RECEIVED) or it is not (its share sits in EXPECTED) — never both. On a
 * partially-paid row, `amountPaid` goes to RECEIVED and the shortfall goes to
 * EXPECTED, over the same window with the same day weights, so the two always
 * partition the row's full contracted amount exactly.
 *
 * VAT — DELIBERATE, NOT INHERITED
 * --------------------------------
 * Outpatient amounts are stored CLIENT-FACING, i.e. VAT-INCLUSIVE. That is
 * stated in public/treatment-map.js ("the client-facing price table (incl.
 * VAT)") and again in credits-ledger.js ("Payments.amountPaid is already the
 * client-facing (VAT-inclusive) figure"). E-Zone-Dashboard stores the same
 * basis and DISPLAYS ex-VAT (÷1.18).
 *
 * So this view displays EX-VAT too. Not because it inherited a convention —
 * this repo had none — but because a figure from here and a figure from the
 * Dashboard will one day be added together into a network total, and two
 * different bases would make that total silently wrong by 18% of whichever
 * half was inclusive. Every bucket therefore carries BOTH:
 *   `.inclVat`  the stored basis, untouched
 *   `.exVat`    inclVat ÷ VAT_RATE
 * so nothing is lost and a consumer can never be in doubt which one it holds.
 *
 * Ex-VAT is taken PER ROW at 2dp and the bucket total is the SUM OF ITS ROWS'
 * ex-VAT values — not the bucket's inclusive total divided once. Dividing once
 * is arithmetically tidier but then a drill-down's rows do not add up to the
 * total printed above them, which reads as a bug to the person checking it.
 * Rows reconciling with their own total is worth the fraction of an agora.
 *
 * REUSE
 * -----
 * The coverage window and every date primitive come from credits-ledger.js —
 * `paymentCoverage`, `isoDate`, `localDateFromISO`, `isoFromLocalDate`,
 * `diffWholeDays`, `addMonthsClamped`, `addDays`, `roundMoney`. They were
 * already pure and already exported; nothing needed extracting and nothing is
 * reimplemented here. If the coverage rule ever changes, it changes in ONE
 * place and this view follows automatically — which is exactly why the credits
 * ledger is the dependency and not a copy of it.
 *
 * All date arithmetic is on LOCAL date parts, and day spans use Math.round, so
 * neither a UTC-midnight parse nor a DST switch can shift a day. Inherited
 * from credits-ledger.js along with the helpers.
 *
 * PURE. No DOM, no network, no `state`. The override layer (סכום גבייה) is
 * injected as an `amountDueFor` callback rather than reached for, so this file
 * never learns what a client record looks like.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./credits-ledger'));   // Node / tests
  } else {
    root.MonthlyRevenue = factory(root.CreditsLedger);       // browser global
  }
})(typeof self !== 'undefined' ? self : this, function (CL) {
  'use strict';

  if (!CL) throw new Error('monthly-revenue.js requires credits-ledger.js');

  /* Israeli VAT multiplier (18%). Mirrors VAT_RATE in the E-Zone-Dashboard
   * app.js — the two apps MUST agree or a consolidated total is wrong. */
  var VAT_RATE = 1.18;

  /* Client statuses that stop billing. Mirrors clientsDueOn() in app.js: a
   * לא פעיל client (deactivated in the therapists app) stops billing exactly
   * like a discharged one, so neither projects an EXPECTED cycle. */
  var INACTIVE_STATUSES = ['סיים טיפול', 'לא פעיל'];

  /* Bucket for clients carrying no location. Never '' — an unlabelled row in a
   * breakdown reads as a rendering bug. */
  var NO_LOCATION = 'ללא סניף';

  var isoDate           = CL.isoDate;
  var localDateFromISO  = CL.localDateFromISO;
  var isoFromLocalDate  = CL.isoFromLocalDate;
  var diffWholeDays     = CL.diffWholeDays;
  var roundMoney        = CL.roundMoney;
  var paymentCoverage   = CL.paymentCoverage;

  function str(v) { return String(v == null ? '' : v).trim(); }
  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }
  /* Ex-VAT at 2dp. Applied per row; bucket totals sum these. */
  function exVat(inclVat) {
    return roundMoney(num(inclVat) / VAT_RATE);
  }

  /* ---- month arithmetic --------------------------------------------------
   * A month key is 'YYYY-MM'. These are the only place a month is turned into
   * dates; everything downstream works in [startISO, endISO] spans. */

  function isMonthKey(v) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(str(v));
  }
  /* 'YYYY-MM' -> { key, startISO, endISO, start, end, days }, or null. */
  function monthBounds(monthKey) {
    var key = str(monthKey);
    if (!isMonthKey(key)) return null;
    var y = Number(key.slice(0, 4));
    var m1 = Number(key.slice(5, 7));
    var days = new Date(y, m1, 0).getDate();          // day 0 of next month
    var start = new Date(y, m1 - 1, 1);
    var end = new Date(y, m1 - 1, days);
    return {
      key: key, start: start, end: end, days: days,
      startISO: isoFromLocalDate(start), endISO: isoFromLocalDate(end)
    };
  }
  function monthKeyOf(iso) {
    var d = isoDate(iso);
    return d ? d.slice(0, 7) : '';
  }
  function shiftMonthKey(key, n) {
    if (!isMonthKey(key)) return '';
    var y = Number(key.slice(0, 4));
    var m0 = Number(key.slice(5, 7)) - 1 + n;
    var d = new Date(y, m0, 1);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
  }
  /* he-IL month label, e.g. 'ספטמבר 2026'. */
  function monthLabel(key) {
    var b = monthBounds(key);
    if (!b) return str(key);
    return b.start.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  }

  /* ---- the allocation primitive ------------------------------------------
   * Whole days of [winStart, winEnd] that fall inside the month. Both ends
   * inclusive; 0 when the window misses the month entirely. */
  function overlapDays(winStart, winEnd, bounds) {
    if (!winStart || !winEnd || !bounds) return 0;
    var from = winStart > bounds.start ? winStart : bounds.start;
    var to   = winEnd   < bounds.end   ? winEnd   : bounds.end;
    if (from > to) return 0;
    return diffWholeDays(from, to) + 1;
  }

  /**
   * allocate(amount, win, bounds, effectiveEnd) -> {
   *   amount,          // the slice of `amount` belonging to this month (2dp)
   *   daysInMonth,     // window days falling in the month
   *   windowDays,      // total days in the window
   *   share            // daysInMonth / windowDays
   * }
   * The ONE place a sum is divided between months. A window with no days in
   * the month yields a zero slice, never null, so callers can sum blindly.
   *
   * `effectiveEnd` (optional) truncates the window WITHOUT changing the
   * denominator: used when a client leaves mid-cycle, so the days after their
   * exit earn nothing while the remaining days keep their true daily rate.
   * Shortening the denominator instead would silently RAISE the daily rate and
   * pay the clinic the same money for fewer days.
   */
  function allocate(amount, win, bounds, effectiveEnd) {
    var zero = { amount: 0, daysInMonth: 0, windowDays: 0, share: 0 };
    if (!win || !win.start || !win.end || !bounds) return zero;
    var windowDays = diffWholeDays(win.start, win.end) + 1;
    if (windowDays <= 0) return zero;
    var lastDay = (effectiveEnd && effectiveEnd < win.end) ? effectiveEnd : win.end;
    if (lastDay < win.start) {
      return { amount: 0, daysInMonth: 0, windowDays: windowDays, share: 0 };
    }
    var inMonth = overlapDays(win.start, lastDay, bounds);
    if (!inMonth) {
      return { amount: 0, daysInMonth: 0, windowDays: windowDays, share: 0 };
    }
    var share = inMonth / windowDays;
    return {
      amount: roundMoney(num(amount) * share),
      daysInMonth: inMonth, windowDays: windowDays, share: share
    };
  }

  /**
   * coverageWindowFor(payment) -> { start, end, source } local Dates, or null.
   *
   * The monthly-package window comes from CreditsLedger.paymentCoverage
   * unchanged — which now means: the period the row RECORDS
   * (coverageStart/coverageEnd) when it has one, and the cycle inferred from
   * its dueDate when it does not. The WHOLE ROW is handed over, never a
   * { dueDate } stub, or the recorded period would be thrown away and this
   * screen would go on assuming exactly what the two columns exist to stop it
   * assuming. `source` says which ('recorded' | 'inferred'); it is reported,
   * never used in the arithmetic.
   *
   * ONE-TIME extra charges are the exception, unchanged by the coverage
   * columns: a one-off is not a month of treatment, so spreading it over 30
   * days would post most of a one-day charge into the FOLLOWING month. Its
   * window is the single day it falls due, so it lands wholly in that month —
   * and that stays true whatever a coverage pair on such a row might say
   * (nothing writes one; see withDefaultCoverage in credits-ledger.js).
   */
  function coverageWindowFor(payment) {
    if (!payment) return null;
    if (CL.isOneTimePayment(payment)) {
      var d = localDateFromISO(isoDate(payment.dueDate));
      return d ? { start: d, end: d, source: 'one_time_due_date' } : null;
    }
    return paymentCoverage(payment);
  }

  /**
   * splitByMonth(amount, win) -> {
   *   months: [{ month, label, monthName, daysInMonth, windowDays, share,
   *              allocated, amount, deferred }],
   *   windowDays, total, residual
   * }
   *
   * The window's own calendar-month split, month by month, using allocate()
   * — the SAME function the הכנסות חודשיות view allocates with, so the split
   * printed on a גבייה row is the very arithmetic that screen will report and
   * not a second opinion about it. The denominator is the WINDOW's own length,
   * never the calendar month's.
   *
   * `allocated` is exactly what the monthly view puts in that month.
   * `amount` is what is DISPLAYED: the same figure, except that the last
   * agora of rounding drift is absorbed by the longest month so the printed
   * lines add up to the payment exactly. Independently rounding each month's
   * share can leave ₪0.01 unaccounted for (100 over three equal months →
   * 33.33 × 3 = 99.99), and a split that does not sum to the row's own amount
   * reads as a bug to the person checking it. Both figures are returned so
   * neither truth is hidden: `allocated` reconciles with the monthly view,
   * `amount` reconciles with the row.
   *
   * `deferred` marks every month AFTER the one the window starts in — the
   * money is collected now and earned later. Clock-independent on purpose: the
   * split of a row must not change meaning because the calendar turned over.
   */
  function splitByMonth(amount, win) {
    if (!win || !win.start || !win.end) return null;
    var total = roundMoney(num(amount));
    var windowDays = diffWholeDays(win.start, win.end) + 1;
    if (windowDays <= 0) return null;

    var firstKey = monthKeyOf(isoFromLocalDate(win.start));
    var lastKey  = monthKeyOf(isoFromLocalDate(win.end));
    var months = [], key = firstKey, guard = 0;
    while (key && guard++ < 24) {
      var bounds = monthBounds(key);
      var a = allocate(total, win, bounds);
      if (a.daysInMonth > 0) {
        months.push({
          month: key,
          label: monthLabel(key),
          monthName: bounds.start.toLocaleDateString('he-IL', { month: 'long' }),
          daysInMonth: a.daysInMonth,
          windowDays: a.windowDays,
          share: a.share,
          allocated: a.amount,
          amount: a.amount,
          deferred: months.length > 0
        });
      }
      if (key === lastKey) break;
      key = shiftMonthKey(key, 1);
    }
    if (!months.length) return null;

    /* The rounding residual, parked on the month carrying the most days — the
     * one where an agora is least visible, and deterministically chosen (ties
     * go to the earlier month) so the same payment always splits identically. */
    var sum = 0;
    months.forEach(function (m) { sum = roundMoney(sum + m.allocated); });
    var residual = roundMoney(total - sum);
    if (residual) {
      var target = 0;
      for (var i = 1; i < months.length; i++) {
        if (months[i].daysInMonth > months[target].daysInMonth) target = i;
      }
      months[target].amount = roundMoney(months[target].allocated + residual);
    }
    return { months: months, windowDays: windowDays, total: total, residual: residual };
  }

  /**
   * paymentMonthSplit(payment, amount) -> splitByMonth over THAT payment's
   * coverage window (recorded or inferred; a one-off charge's single day).
   * `amount` is passed in rather than read off the row, because the גבייה row
   * shows the EFFECTIVE amount (the manual סכום גבייה override layer lives in
   * app.js and this module never reaches for it). VAT-inclusive, like every
   * amount stored on a payment row and like the amount printed beside it.
   */
  function paymentMonthSplit(payment, amount) {
    var win = coverageWindowFor(payment);
    if (!win) return null;
    return splitByMonth(amount, win);
  }

  /* ---- billing-cycle projection ------------------------------------------
   * A client's cycle recurs on their anchor DAY-OF-MONTH, clamped to short
   * months (anchor day 31 -> Feb 28/29). The day-of-month is re-clamped from
   * the ORIGINAL anchor every month, never from the previous occurrence —
   * walking Jan 31 -> Feb 28 -> Mar 28 would silently migrate the cycle two
   * days earlier for good.
   *
   * Anchor precedence mirrors nextRenewalDueDate() in app.js: the stored
   * nextBillingDate (the value the גבייה הבאה chip shows and every payment path
   * advances), else packageChangeDate (a שינוי חבילה re-anchors the cycle),
   * else the last paymentDate, else startDate. */
  function billingAnchorISO(client) {
    if (!client) return '';
    return isoDate(client.nextBillingDate)
        || isoDate(client.packageChangeDate)
        || isoDate(client.paymentDate)
        || isoDate(client.startDate)
        || '';
  }
  /* The cycle occurrence in (year, monthIdx) for an anchor day-of-month. */
  function occurrenceIn(year, monthIdx, anchorDay) {
    var first = new Date(year, monthIdx, 1);
    var y = first.getFullYear(), m = first.getMonth();
    var last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(anchorDay, last));
  }
  /**
   * projectedCycleDueDates(client, bounds) -> [isoDate, ...]
   *
   * Every cycle due-date whose coverage window INTERSECTS the month. A cycle
   * starting the month before still pays for days inside it, so the walk
   * starts one month early; a cycle starting inside the month always
   * intersects, so it ends at the month's end.
   *
   * Bounded by the client's own lifecycle: never before startDate (a client
   * is not billed for months preceding their first day) and never on/after
   * exitDate (a client who left is not billed again). A cycle STRADDLING the
   * exit is kept but clipped at it by the caller — the days up to the exit
   * were earned; the days after it are the credits ledger's business, not
   * this view's, and forecasting them would bill a client who has gone.
   */
  function projectedCycleDueDates(client, bounds) {
    var anchorISO = billingAnchorISO(client);
    var anchor = localDateFromISO(anchorISO);
    if (!anchor || !bounds) return [];
    var anchorDay = anchor.getDate();
    var startISO = isoDate(client && client.startDate);
    var exitISO  = isoDate(client && client.exitDate);

    var out = [];
    // One month back (a straddling cycle) through the month itself.
    for (var n = -1; n <= 0; n++) {
      var probe = new Date(bounds.start.getFullYear(), bounds.start.getMonth() + n, 1);
      var occ = occurrenceIn(probe.getFullYear(), probe.getMonth(), anchorDay);
      var occISO = isoFromLocalDate(occ);
      if (startISO && occISO < startISO) continue;
      if (exitISO && occISO >= exitISO) continue;
      // Keep it only if its window actually reaches into the month.
      var win = paymentCoverage({ dueDate: occISO });
      if (!win || !overlapDays(win.start, win.end, bounds)) continue;
      if (out.indexOf(occISO) === -1) out.push(occISO);
    }
    return out.sort();
  }

  function isActiveClient(client) {
    if (!client) return false;
    return INACTIVE_STATUSES.indexOf(str(client.status)) === -1;
  }
  function locationOf(client) {
    return (client && str(client.location)) || NO_LOCATION;
  }

  /* ---- credits ------------------------------------------------------------
   * The span a credit actually refunds, which is NOT its allocationMonth (that
   * column is documented reporting metadata and never enters any math).
   *
   *   prepaid_return — the whole coverage window was unearned.
   *   days_unused    — only the credited tail: creditedFrom..coverageEnd. The
   *                    days BEFORE the exit were used and were never refunded.
   *
   * A credit whose basis carries no usable span (a manual `other` credit, or a
   * legacy row saved before basis was written) falls back to its
   * allocationMonth: it lands whole in that month, which is the only honest
   * thing to do with a figure that has no window. `spanSource` records which
   * path was taken so the drill-down can say so rather than implying a
   * precision it does not have.
   */
  function creditSpan(credit) {
    var basis = (credit && credit.basis) || {};
    var endISO = isoDate(basis.coverageEnd);
    var startISO = str(credit.creditType) === 'prepaid_return'
      ? isoDate(basis.coverageStart)
      : (isoDate(basis.creditedFrom) || '');
    if (startISO && endISO && startISO <= endISO) {
      var s = localDateFromISO(startISO), e = localDateFromISO(endISO);
      if (s && e) return { start: s, end: e, source: 'coverage_window' };
    }
    var mb = monthBounds(str(credit && credit.allocationMonth));
    if (mb) return { start: mb.start, end: mb.end, source: 'allocation_month' };
    return null;
  }

  /**
   * buildMonthlyRevenue(opts) -> the whole month.
   *
   * opts:
   *   month        'YYYY-MM' (required)
   *   clients      Clients rows
   *   payments     Payments rows
   *   credits      Credits rows (already normalized, or raw — normalized here)
   *   today        'YYYY-MM-DD' — the line between a cycle that is merely not
   *                billed YET (a forecast) and one whose date has passed with
   *                nothing recorded (a gap). Injected rather than read from the
   *                clock so a test pins it and a report reruns identically.
   *                Omitted -> the real today.
   *   amountDueFor optional (payment, computedAmount) -> effective amount due.
   *                This is where the manual סכום גבייה override layer is
   *                injected. Omitted -> the row's own amountDue.
   *
   * Returns null for an unusable month key rather than guessing one.
   */
  function buildMonthlyRevenue(opts) {
    opts = opts || {};
    var bounds = monthBounds(opts.month);
    if (!bounds) return null;

    var clients  = Array.isArray(opts.clients) ? opts.clients : [];
    var payments = Array.isArray(opts.payments) ? opts.payments : [];
    var credits  = Array.isArray(opts.credits) ? opts.credits : [];
    var amountDueFor = typeof opts.amountDueFor === 'function'
      ? opts.amountDueFor
      : function (payment, computed) { return computed; };
    var todayISO = isoDate(opts.today) || isoFromLocalDate(new Date());

    var clientById = {};
    clients.forEach(function (c) { if (c && c.id) clientById[str(c.id)] = c; });

    var receivedRows = [];
    var expectedRows = [];
    var creditRows   = [];

    /* --- RECEIVED, and the billed half of EXPECTED ------------------------
     * One pass over the payment rows. Each row's window is split once; the
     * paid part and the unpaid remainder ride the SAME weights, so together
     * they account for exactly the row's contracted amount in this month and
     * never overlap. */
    payments.forEach(function (p) {
      if (!p) return;
      var dueISO = isoDate(p.dueDate);
      if (!dueISO) return;
      var win = coverageWindowFor(p);
      if (!win) return;

      var client = clientById[str(p.clientId)] || null;
      var billed  = roundMoney(num(amountDueFor(p, num(p.amountDue))));
      var paid    = roundMoney(num(p.amountPaid));
      var shortfall = roundMoney(Math.max(0, billed - paid));

      var base = {
        paymentId: str(p.id),
        clientId: str(p.clientId),
        clientName: str(p.clientName) || (client && str(client.name)) || '',
        location: locationOf(client),
        billingType: str(p.billingType) || 'monthly',
        status: str(p.status),
        dueDate: dueISO,
        // Carried for transparency ONLY — it never moved a shekel above.
        paymentDate: isoDate(p.paymentDate),
        coverageStart: isoFromLocalDate(win.start),
        coverageEnd: isoFromLocalDate(win.end),
        /* Where [start, end] came from: 'recorded' — the row says what it
         * covered; 'inferred' — the cycle was assumed from the due date;
         * 'one_time_due_date' — a one-off charge, its own day. Reported,
         * never used in the arithmetic. */
        coverageWindowSource: win.source || 'inferred',
        coverageAdjusted: CL.coverageDiffersFromDefault(p) && !CL.isOneTimePayment(p),
        billedAmount: billed,
        amountPaid: paid
      };

      if (paid > 0) {
        var a = allocate(paid, win, bounds);
        if (a.daysInMonth > 0) {
          receivedRows.push(assign({}, base, {
            fullAmount: paid,
            amountInMonth: a.amount,
            amountInMonthExVat: exVat(a.amount),
            daysInMonth: a.daysInMonth, windowDays: a.windowDays, share: a.share
          }));
        }
      }
      if (shortfall > 0) {
        var b = allocate(shortfall, win, bounds);
        if (b.daysInMonth > 0) {
          expectedRows.push(assign({}, base, {
            kind: 'billed_unpaid',
            fullAmount: shortfall,
            amountInMonth: b.amount,
            amountInMonthExVat: exVat(b.amount),
            daysInMonth: b.daysInMonth, windowDays: b.windowDays, share: b.share
          }));
        }
      }
    });

    /* --- the projected half of EXPECTED -----------------------------------
     * Active clients whose cycle covers days of this month with NO payment row
     * behind it. A cycle that already has a row was fully handled above (paid
     * part + shortfall), so it is skipped here — that skip is the only thing
     * standing between this view and double counting.
     *
     * Base monthly package only. Extra charges (חיובים נוספים) are ad-hoc: a
     * one-off is not contracted future revenue, and a recurring one carries no
     * commitment to recur. When they are actually billed they appear above, in
     * whichever half they belong to. */
    var billedCycleKeys = {};
    payments.forEach(function (p) {
      if (!p) return;
      var info = basePaymentInfo(p);
      if (!info.isBase) return;
      var dueISO = isoDate(p.dueDate);
      if (!dueISO) return;
      billedCycleKeys[str(p.clientId) + '|' + dueISO] = true;
      // Also key by month: a stored row whose dueDate drifted a day or two
      // from the projected anchor is still THAT cycle, not a second one.
      billedCycleKeys[str(p.clientId) + '|m|' + dueISO.slice(0, 7)] = true;
    });

    clients.forEach(function (c) {
      if (!isActiveClient(c)) return;
      var monthly = roundMoney(num(c.pricePerSession));   // the סכום חודשי field
      if (monthly <= 0) return;
      // A scheduled future exit truncates the last cycle: the client earns
      // revenue up to and including their exit day, nothing after it.
      var exitDay = localDateFromISO(isoDate(c.exitDate));
      projectedCycleDueDates(c, bounds).forEach(function (dueISO) {
        var cid = str(c.id);
        if (billedCycleKeys[cid + '|' + dueISO]) return;
        if (billedCycleKeys[cid + '|m|' + dueISO.slice(0, 7)]) return;
        var win = paymentCoverage({ dueDate: dueISO });
        var a = allocate(monthly, win, bounds, exitDay);
        if (!a.daysInMonth) return;
        expectedRows.push({
          // A cycle still ahead of us is a forecast; one whose date has gone
          // by with no row is a recording gap wearing a forecast's clothes.
          // Same money, very different confidence — so they are named apart.
          kind: dueISO > todayISO ? 'projected' : 'unbilled_past',
          paymentId: '', clientId: cid,
          clientName: str(c.name), location: locationOf(c),
          billingType: 'monthly', status: '',
          dueDate: dueISO, paymentDate: '',
          coverageStart: isoFromLocalDate(win.start),
          coverageEnd: isoFromLocalDate(win.end),
          // A projected cycle has no payment row, so there is nothing recorded
          // to honour — inferred by construction, and it says so.
          coverageWindowSource: 'inferred', coverageAdjusted: false,
          billedAmount: monthly, amountPaid: 0,
          fullAmount: monthly,
          amountInMonth: a.amount,
          amountInMonthExVat: exVat(a.amount),
          daysInMonth: a.daysInMonth, windowDays: a.windowDays, share: a.share
        });
      });
    });

    /* --- CREDITS ----------------------------------------------------------
     * pending and paid both reduce the month's revenue: the money is owed back
     * either way, and when it was actually handed over is no more relevant
     * than when a payment arrived. `cancelled` is a void decision and counts
     * for nothing. */
    credits.forEach(function (raw) {
      var c = CL.normalizeCredit(raw);
      if (c.status === 'cancelled') return;
      if (!c.amount) return;
      var span = creditSpan(c);
      if (!span) return;
      var a = allocate(c.amount, span, bounds);
      if (!a.daysInMonth) return;
      var client = clientById[c.clientId] || null;
      creditRows.push({
        creditId: c.id, clientId: c.clientId,
        clientName: c.clientName || (client && str(client.name)) || '',
        location: locationOf(client),
        creditType: c.creditType, status: c.status,
        allocationMonth: c.allocationMonth,
        payoutDate: c.payoutDate,
        spanStart: isoFromLocalDate(span.start),
        spanEnd: isoFromLocalDate(span.end),
        spanSource: span.source,
        fullAmount: c.amount,
        amountInMonth: a.amount,
        amountInMonthExVat: exVat(a.amount),
        daysInMonth: a.daysInMonth, windowDays: a.windowDays, share: a.share
      });
    });

    /* --- totals -----------------------------------------------------------
     * Rows first, totals from the rows — so every figure on screen is the sum
     * of things you can click through to. */
    var received = bucket(receivedRows);
    var expected = bucket(expectedRows);
    var creditsB = bucket(creditRows);
    var byKind = function (kind) {
      return bucket(expectedRows.filter(function (r) { return r.kind === kind; }));
    };
    var expectedBilled    = byKind('billed_unpaid');
    var expectedProjected = byKind('projected');
    var expectedUnbilled  = byKind('unbilled_past');

    sortRows(receivedRows); sortRows(expectedRows); sortRows(creditRows);

    return {
      month: bounds.key,
      monthLabel: monthLabel(bounds.key),
      monthStart: bounds.startISO,
      monthEnd: bounds.endISO,
      daysInMonth: bounds.days,
      vatRate: VAT_RATE,

      received: assign(received, { rows: receivedRows }),
      expected: assign(expected, {
        rows: expectedRows,
        // The three confidences inside EXPECTED, kept visible rather than
        // blended: a receivable on a cycle already billed, a forecast that
        // assumes the client stays, and a cycle nobody ever recorded.
        billedUnpaid: expectedBilled,
        projected: expectedProjected,
        unbilledPast: expectedUnbilled
      }),
      credits: assign(creditsB, { rows: creditRows }),

      /* NET is the ONLY place received and expected meet, and it is a
       * projection by construction — never quote it as cash. */
      net: {
        inclVat: roundMoney(received.inclVat + expected.inclVat - creditsB.inclVat),
        exVat: roundMoney(received.exVat + expected.exVat - creditsB.exVat)
      },

      byLocation: breakdownByLocation(receivedRows, expectedRows, creditRows)
    };
  }

  /* Sum a row list into { inclVat, exVat, count }. exVat is the sum of the
   * rows' own ex-VAT figures, so a drill-down reconciles with its header. */
  function bucket(rows) {
    var incl = 0, ex = 0;
    rows.forEach(function (r) {
      incl = roundMoney(incl + r.amountInMonth);
      ex = roundMoney(ex + r.amountInMonthExVat);
    });
    return { inclVat: incl, exVat: ex, count: rows.length };
  }

  /* Newest cycle first, then by client name (he collation) — the order the
   * drill-down reads best in. */
  function sortRows(rows) {
    rows.sort(function (a, b) {
      var d = String(b.dueDate || b.spanStart || '').localeCompare(String(a.dueDate || a.spanStart || ''));
      if (d) return d;
      return String(a.clientName || '').localeCompare(String(b.clientName || ''), 'he');
    });
  }

  /**
   * BREAKDOWN DIMENSION — `location` (סניף).
   *
   * The outpatient app has no houses, but it does have LOCATIONS, and they are
   * the same physical sites the Dashboard calls houses (רעננה הפרדס / רעננה אשר
   * / רמות השבים / קיסריה גמילה / קיסריה עפרוני). It is therefore the direct
   * analogue, and the only dimension along which an outpatient figure and a
   * Dashboard figure can be added up per site.
   *
   * Sorted by NET descending, so the sites carrying the month lead. Rows whose
   * every figure is zero are dropped — an all-zero row is noise.
   */
  function breakdownByLocation(receivedRows, expectedRows, creditRows) {
    var by = {};
    function slot(loc) {
      var k = loc || NO_LOCATION;
      if (!by[k]) {
        by[k] = {
          location: k,
          received: { inclVat: 0, exVat: 0, count: 0 },
          expected: { inclVat: 0, exVat: 0, count: 0 },
          credits:  { inclVat: 0, exVat: 0, count: 0 }
        };
      }
      return by[k];
    }
    function add(target, r) {
      target.inclVat = roundMoney(target.inclVat + r.amountInMonth);
      target.exVat = roundMoney(target.exVat + r.amountInMonthExVat);
      target.count += 1;
    }
    receivedRows.forEach(function (r) { add(slot(r.location).received, r); });
    expectedRows.forEach(function (r) { add(slot(r.location).expected, r); });
    creditRows.forEach(function (r) { add(slot(r.location).credits, r); });

    return Object.keys(by).map(function (k) {
      var b = by[k];
      b.net = {
        inclVat: roundMoney(b.received.inclVat + b.expected.inclVat - b.credits.inclVat),
        exVat: roundMoney(b.received.exVat + b.expected.exVat - b.credits.exVat)
      };
      return b;
    }).filter(function (b) {
      return b.received.count || b.expected.count || b.credits.count;
    }).sort(function (a, b) {
      if (b.net.exVat !== a.net.exVat) return b.net.exVat - a.net.exVat;
      return String(a.location).localeCompare(String(b.location), 'he');
    });
  }

  /* Is this payment row the client's BASE monthly package (as opposed to an
   * extra charge)? Mirrors the id scheme documented in app.js:
   *   base monthly   pay::<clientId>::base::<YYYY-MM>
   *   extra          pay::<clientId>::chg-<chargeId>::<YYYY-MM|once>
   *   legacy base    pay::<clientId>::<YYYY-MM>            (3 segments)
   * An id in none of those shapes is treated as base — a row we cannot
   * classify is far likelier to be an old base row than an extra charge, and
   * treating it as base only ever SUPPRESSES a projected duplicate. */
  function basePaymentInfo(payment) {
    var id = str(payment && payment.id);
    if (/::chg-[^:]+::/.test(id)) return { isBase: false };
    return { isBase: true };
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

  return {
    VAT_RATE: VAT_RATE,
    NO_LOCATION: NO_LOCATION,
    INACTIVE_STATUSES: INACTIVE_STATUSES,
    exVat: exVat,
    isMonthKey: isMonthKey,
    monthBounds: monthBounds,
    monthKeyOf: monthKeyOf,
    shiftMonthKey: shiftMonthKey,
    monthLabel: monthLabel,
    overlapDays: overlapDays,
    allocate: allocate,
    coverageWindowFor: coverageWindowFor,
    splitByMonth: splitByMonth,
    paymentMonthSplit: paymentMonthSplit,
    billingAnchorISO: billingAnchorISO,
    projectedCycleDueDates: projectedCycleDueDates,
    creditSpan: creditSpan,
    buildMonthlyRevenue: buildMonthlyRevenue
  };
});
