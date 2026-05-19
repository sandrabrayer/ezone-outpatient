/**
 * continuation-bonus.js
 * -----------------------------------------------------------------------------
 * STEP 1 of the "outpatient-continuation bonus" project.
 *
 * WHAT THIS COMPUTES
 * ------------------
 * For each *source house* ("מאיזה בית" / `house_of_origin`), the monthly bonus
 * owed because former patients of that house continue as outpatients here.
 *
 * The business rule (from the project brief):
 *   "A manager earns 5% of the monthly treatment package for each former
 *    patient of their house who continues as an outpatient."
 *
 * SCOPE / DESIGN DECISIONS (deliberate, see project brief)
 * -------------------------------------------------------
 * 1. OUTPUT IS PER-HOUSE, NOT PER-MANAGER.
 *    OUTPATIENTS stores only `house_of_origin`; it has no manager identity.
 *    The house->manager mapping lives downstream (DASHBOARD / MANAGERS), where
 *    it already exists. Emitting per-house keeps this app from owning data it
 *    does not have. The downstream join is trivial and unambiguous.
 *
 * 2. TWO BUSINESS QUESTIONS ARE CONFIGURABLE (not hardcoded), because they
 *    were not finalised when this was written:
 *      a. `basis`  — which figure the 5% applies to:
 *           'package'    -> the contracted monthly package amount
 *                           (Clients.pricePerSession; UI label "חבילה חודשית";
 *                           mirrors the app's own monthlyRevenue()).
 *           'treatments' -> treatments actually received that month
 *                           (best available proxy from sheet data; see
 *                           treatmentsReceivedAmount()).
 *      b. `ratePct` — the percentage itself (defaults to 5).
 *    Cadence is fixed per the confirmed answer ("every month they continue"),
 *    realised by iterating each month in the requested window in which the
 *    patient is continuing.
 *
 * 3. `external` IS EXCLUDED. It is not a real house; no manager owns it.
 *    Empty / unknown `house_of_origin` is likewise excluded (cannot attribute).
 *
 * 4. ONLY CONTINUING PATIENTS ACCRUE.
 *    status 'סיים טיפול' (finished) never accrues. 'פעיל' always accrues.
 *    'הפסקה זמנית' (temporary pause) is configurable via
 *    `countPausedStatus` (default false — a paused patient is not receiving
 *    treatment that month, so no package is delivered).
 *
 * 5. MONTH BOUNDS. A patient accrues for month M only if M is within
 *    [startDate month, exitDate month]. Missing startDate -> treated as
 *    "already ongoing" (accrues for any requested month up to exit).
 *    Missing exitDate -> open-ended (accrues through the window end).
 *
 * This module is PURE and has NO dependencies. It mirrors the UMD pattern of
 * billing-status.js so it runs in Node tests and (optionally) the browser
 * without a build step. It performs NO I/O and MUTATES NOTHING — it only
 * reads the `clients` array the app already loads from Sheets.
 *
 * IMPORTANT: This module does not write to any sheet, does not call any
 * network, and does not touch occupancy logic anywhere. It is the
 * "compute + preview" half of step 1 only. Hand-off to DASHBOARD is step 2.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / tests
  } else {
    root.ContinuationBonus = api;    // browser global (optional use)
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Canonical real houses. Must match HOUSE_OF_ORIGIN_LABELS in app.js.
   * 'external' is intentionally absent: it is not a payable house. */
  var REAL_HOUSES = ['raanana', 'ramot', 'efroni', 'rehab'];

  var STATUS_FINISHED_HE = 'סיים טיפול';
  var STATUS_PAUSED_HE   = 'הפסקה זמנית';
  var STATUS_ACTIVE_HE   = 'פעיל';

  var DEFAULTS = {
    ratePct: 5,                 // 5%
    basis: 'package',           // 'package' | 'treatments'
    countPausedStatus: false,   // count 'הפסקה זמנית' months?
    weeksPerMonth: 4.33         // only used by the 'treatments' basis
  };

  function _num(v) {
    if (v === '' || v === null || v === undefined) return 0;
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function _str(v) {
    return String(v == null ? '' : v).trim();
  }

  /**
   * Parse a value into a {year, month} (month 1-12), or null if unparseable.
   * Accepts 'YYYY-MM-DD', 'YYYY-MM-DDTHH:MM:SSZ', Date, or 'YYYY-MM'.
   */
  function _ym(v) {
    if (v instanceof Date && !isNaN(v)) {
      return { y: v.getFullYear(), m: v.getMonth() + 1 };
    }
    var s = _str(v);
    if (!s) return null;
    if (s.indexOf('T') !== -1) s = s.split('T')[0];
    var parts = s.split('-');
    if (parts.length < 2) return null;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (!isFinite(y) || !isFinite(m) || m < 1 || m > 12) return null;
    return { y: y, m: m };
  }

  /* Comparable integer for a {y,m}: year*12 + (m-1). */
  function _ymIndex(ym) { return ym ? (ym.y * 12 + (ym.m - 1)) : null; }

  /**
   * Sum the indices of every calendar month in [from, to] inclusive.
   * `from` / `to` are 'YYYY-MM' strings or {y,m}. Returns an array of
   * { y, m, key:'YYYY-MM', index } in chronological order.
   */
  function monthsInWindow(from, to) {
    var a = (typeof from === 'string') ? _ym(from + '-01') : from;
    var b = (typeof to === 'string') ? _ym(to + '-01') : to;
    var ai = _ymIndex(a), bi = _ymIndex(b);
    if (ai === null || bi === null || bi < ai) return [];
    var out = [];
    for (var i = ai; i <= bi; i++) {
      var y = Math.floor(i / 12);
      var m = (i % 12) + 1;
      out.push({
        y: y, m: m,
        key: y + '-' + String(m).padStart(2, '0'),
        index: i
      });
    }
    return out;
  }

  /**
   * The contracted monthly package amount for a client.
   * Mirrors app.js monthlyRevenue(): for clients, `pricePerSession` holds
   * the monthly package (UI label "חבילה חודשית"), regardless of billingType.
   * Bundle clients: prefer an explicit monthly package if present, else
   * amortise the bundle price across its size as a monthly-ish figure ONLY
   * when no monthly figure exists (defensive; most rows carry pricePerSession).
   */
  function packageAmount(client) {
    var monthly = _num(client.pricePerSession);
    if (monthly > 0) return monthly;
    // Defensive fallback for pure-bundle rows with no monthly figure.
    var bundlePrice = _num(client.bundlePrice);
    if (bundlePrice > 0) return bundlePrice;
    return 0;
  }

  /**
   * Best-available proxy for "treatments actually received that month".
   * The sheet does not store per-month delivered-treatment revenue, so this
   * is intentionally a documented approximation, used ONLY when
   * basis === 'treatments'. It is deliberately conservative and clearly
   * labelled so the preview surfaces it before any money moves.
   *
   * monthly billing  -> same as packageAmount (package == month of treatment)
   * bundle billing    -> pricePerSession treated as per-session price *
   *                       sessions/week * weeksPerMonth (sessions actually
   *                       scheduled per month)
   */
  function treatmentsReceivedAmount(client, cfg) {
    var billing = _str(client.billingType).toLowerCase() || 'monthly';
    if (billing !== 'bundle') {
      return packageAmount(client);
    }
    var perSession = _num(client.pricePerSession);
    var perWeek = _num(client.sessionsPerWeek);
    if (perSession > 0 && perWeek > 0) {
      return perSession * perWeek * cfg.weeksPerMonth;
    }
    return packageAmount(client);
  }

  function _isContinuing(client, cfg) {
    var status = _str(client.status);
    if (status === STATUS_FINISHED_HE) return false;
    if (status === STATUS_PAUSED_HE) return !!cfg.countPausedStatus;
    // 'פעיל', '' (legacy/active), or anything else not explicitly finished.
    return true;
  }

  function _accruesInMonth(client, monthIndex) {
    var start = _ym(client.startDate);
    var exit = _ym(client.exitDate);
    var si = _ymIndex(start);
    var ei = _ymIndex(exit);
    if (si !== null && monthIndex < si) return false; // not started yet
    if (ei !== null && monthIndex > ei) return false; // already exited
    return true;
  }

  function _mergeConfig(opts) {
    var cfg = {};
    for (var k in DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) cfg[k] = DEFAULTS[k];
    }
    if (opts && typeof opts === 'object') {
      for (var j in opts) {
        if (Object.prototype.hasOwnProperty.call(opts, j) && opts[j] !== undefined) {
          cfg[j] = opts[j];
        }
      }
    }
    if (cfg.basis !== 'package' && cfg.basis !== 'treatments') {
      throw new Error("continuation-bonus: cfg.basis must be 'package' or 'treatments', got: " + cfg.basis);
    }
    if (!(cfg.ratePct >= 0)) {
      throw new Error('continuation-bonus: cfg.ratePct must be a non-negative number, got: ' + cfg.ratePct);
    }
    return cfg;
  }

  function _basisAmount(client, cfg) {
    return cfg.basis === 'treatments'
      ? treatmentsReceivedAmount(client, cfg)
      : packageAmount(client);
  }

  /**
   * Compute the per-house bonus for a single month.
   *
   * @param {Array} clients  the Clients array (as loaded from Sheets)
   * @param {string} monthKey 'YYYY-MM'
   * @param {object} [opts]   config overrides (see DEFAULTS)
   * @returns {{
   *   ok: boolean, month: string, ratePct: number, basis: string,
   *   byHouse: Object<string, number>,    // house id -> bonus (rounded ₪)
   *   total: number,
   *   lines: Array  // per-patient preview rows (for dry-run / audit)
   * }}
   */
  function computeMonth(clients, monthKey, opts) {
    var cfg = _mergeConfig(opts);
    var month = _ym(monthKey + '-01');
    var mi = _ymIndex(month);
    var result = {
      ok: true,
      month: monthKey,
      ratePct: cfg.ratePct,
      basis: cfg.basis,
      byHouse: {},
      total: 0,
      lines: []
    };
    if (mi === null) {
      result.ok = false;
      result.error = 'invalid month: ' + monthKey;
      return result;
    }
    REAL_HOUSES.forEach(function (h) { result.byHouse[h] = 0; });

    var list = Array.isArray(clients) ? clients : [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i] || {};
      var house = _str(c.house_of_origin);
      var line = {
        clientId: c.id || '',
        name: c.name || '',
        house: house,
        included: false,
        reason: '',
        basisAmount: 0,
        bonus: 0
      };

      if (REAL_HOUSES.indexOf(house) === -1) {
        line.reason = house === 'external'
          ? 'excluded: external is not a payable house'
          : 'excluded: missing/unknown house_of_origin';
        result.lines.push(line);
        continue;
      }
      if (!_isContinuing(c, cfg)) {
        line.reason = 'excluded: not continuing (status=' + (_str(c.status) || 'n/a') + ')';
        result.lines.push(line);
        continue;
      }
      if (!_accruesInMonth(c, mi)) {
        line.reason = 'excluded: month outside [start, exit] window';
        result.lines.push(line);
        continue;
      }

      var amount = _basisAmount(c, cfg);
      var bonus = amount * (cfg.ratePct / 100);
      line.included = true;
      line.basisAmount = Math.round(amount);
      line.bonus = Math.round(bonus);
      line.reason = 'included';
      result.byHouse[house] += bonus;
      result.total += bonus;
      result.lines.push(line);
    }

    // Round house + total figures once, at the end, for ₪ display parity.
    REAL_HOUSES.forEach(function (h) {
      result.byHouse[h] = Math.round(result.byHouse[h]);
    });
    result.total = Math.round(result.total);
    return result;
  }

  /**
   * Compute across an inclusive window of months ('YYYY-MM' .. 'YYYY-MM').
   * Returns per-month results plus a per-house roll-up across the window.
   */
  function computeWindow(clients, fromMonth, toMonth, opts) {
    var months = monthsInWindow(fromMonth, toMonth);
    var perMonth = [];
    var rollup = {};
    REAL_HOUSES.forEach(function (h) { rollup[h] = 0; });
    var grandTotal = 0;

    for (var i = 0; i < months.length; i++) {
      var r = computeMonth(clients, months[i].key, opts);
      perMonth.push(r);
      if (r.ok) {
        REAL_HOUSES.forEach(function (h) { rollup[h] += r.byHouse[h] || 0; });
        grandTotal += r.total;
      }
    }
    return {
      ok: true,
      from: fromMonth,
      to: toMonth,
      months: months.map(function (m) { return m.key; }),
      perMonth: perMonth,
      byHouse: rollup,
      total: grandTotal
    };
  }

  /**
   * Human-readable preview ("preview the money impact before deploying").
   * Returns a plain string; callers decide how to surface it. No I/O.
   */
  function previewText(windowResult) {
    if (!windowResult || !windowResult.ok) return 'no preview available';
    var lines = [];
    lines.push('Outpatient-continuation bonus — money preview (NOT yet sent anywhere)');
    lines.push('Window: ' + windowResult.from + ' .. ' + windowResult.to);
    lines.push('');
    windowResult.perMonth.forEach(function (r) {
      if (!r.ok) { lines.push(r.month + ': ERROR ' + r.error); return; }
      var included = r.lines.filter(function (l) { return l.included; });
      lines.push(r.month + '  (rate ' + r.ratePct + '%, basis ' + r.basis + ', ' +
                 included.length + ' continuing patient(s))');
      REAL_HOUSES.forEach(function (h) {
        if (r.byHouse[h]) lines.push('    ' + h + ': ₪' + r.byHouse[h]);
      });
      lines.push('    month total: ₪' + r.total);
    });
    lines.push('');
    lines.push('ROLL-UP across window (per house):');
    REAL_HOUSES.forEach(function (h) {
      lines.push('  ' + h + ': ₪' + windowResult.byHouse[h]);
    });
    lines.push('  GRAND TOTAL: ₪' + windowResult.total);
    return lines.join('\n');
  }

  return {
    REAL_HOUSES: REAL_HOUSES,
    DEFAULTS: DEFAULTS,
    packageAmount: packageAmount,
    treatmentsReceivedAmount: treatmentsReceivedAmount,
    monthsInWindow: monthsInWindow,
    computeMonth: computeMonth,
    computeWindow: computeWindow,
    previewText: previewText
  };
});
