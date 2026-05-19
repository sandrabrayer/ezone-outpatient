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
 * The business rule (confirmed with stakeholder):
 *   "A manager earns 5% of the monthly treatment package for each former
 *    patient of their house who continues as an outpatient."
 *
 *   - The package is charged UPFRONT. The manager's 5% is therefore earned
 *     in the month the package is billed/collected — it does NOT wait for
 *     sessions to be delivered.
 *   - Carry-over sessions (patient paid for 4, used 3, 1 rolls to next
 *     month) are a purely OPERATIONAL matter and have ZERO bonus
 *     implication: the money was already collected, so the bonus was
 *     already earned. Session attendance / carry-over / daily room
 *     scheduling live in a SEPARATE operational system and are explicitly
 *     NOT a dependency of this computation.
 *   - Cadence: every month the patient is a continuing outpatient (i.e.
 *     every month a monthly package is billed for them).
 *
 * SCOPE / DESIGN DECISIONS (deliberate, see project brief & docs)
 * --------------------------------------------------------------
 * 1. OUTPUT IS PER-HOUSE, NOT PER-MANAGER.
 *    OUTPATIENTS stores only `house_of_origin`; it has no manager identity.
 *    The house->manager mapping lives downstream (DASHBOARD / MANAGERS),
 *    where it already exists. Emitting per-house keeps this app from owning
 *    data it does not have. The downstream join is trivial and unambiguous.
 *
 * 2. BASIS IS THE CONTRACTED MONTHLY PACKAGE — and ONLY that.
 *    `Clients.pricePerSession` holds the monthly package amount for clients
 *    (UI label "חבילה חודשית"); this mirrors the app's own monthlyRevenue().
 *    An earlier "treatments actually received" idea was removed: because the
 *    package is collected upfront, the bonus is settled at collection time;
 *    a per-session/delivery figure is neither needed nor correct here.
 *
 * 3. CONFIGURABLE: only `ratePct` (default 5) and `countPausedStatus`
 *    (default false). These are genuine policy knobs, not tied to any
 *    unresolved question.
 *
 * 4. `external` IS EXCLUDED. It is not a real house; no manager owns it.
 *    Empty / unknown `house_of_origin` is likewise excluded (cannot
 *    attribute).
 *
 * 5. ONLY CONTINUING PATIENTS ACCRUE.
 *    status 'סיים טיפול' (finished) never accrues. 'פעיל' always accrues.
 *    'הפסקה זמנית' (temporary pause) is configurable via
 *    `countPausedStatus` (default false — a paused patient is not being
 *    billed a package that month, so nothing was collected).
 *
 * 6. MONTH BOUNDS. A patient accrues for month M only if M is within
 *    [startDate month, exitDate month]. Missing startDate -> treated as
 *    "already ongoing". Missing exitDate -> open-ended (through window end).
 *
 * This module is PURE and has NO dependencies. It mirrors the UMD pattern of
 * billing-status.js so it runs in Node tests and (optionally) the browser
 * without a build step. It performs NO I/O and MUTATES NOTHING — it only
 * reads the `clients` array the app already loads from Sheets. It does not
 * touch occupancy logic and does not write to any sheet. This is the
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

  var DEFAULTS = {
    ratePct: 5,                 // 5%
    countPausedStatus: false    // count 'הפסקה זמנית' months?
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
   * Parse a value into {y, m} (month 1-12), or null if unparseable.
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
   * Every calendar month in [from, to] inclusive.
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
   * the monthly package (UI label "חבילה חודשית"), regardless of
   * billingType. Defensive fallback to bundlePrice only when no monthly
   * figure exists (most rows carry pricePerSession).
   */
  function packageAmount(client) {
    var monthly = _num(client.pricePerSession);
    if (monthly > 0) return monthly;
    var bundlePrice = _num(client.bundlePrice);
    if (bundlePrice > 0) return bundlePrice;
    return 0;
  }

  function _isContinuing(client, cfg) {
    var status = _str(client.status);
    if (status === STATUS_FINISHED_HE) return false;
    if (status === STATUS_PAUSED_HE) return !!cfg.countPausedStatus;
    // 'פעיל', '' (legacy/active), or anything else not explicitly finished.
    return true;
  }

  function _accruesInMonth(client, monthIndex) {
    var si = _ymIndex(_ym(client.startDate));
    var ei = _ymIndex(_ym(client.exitDate));
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
    if (!(cfg.ratePct >= 0)) {
      throw new Error('continuation-bonus: cfg.ratePct must be a non-negative number, got: ' + cfg.ratePct);
    }
    return cfg;
  }

  /**
   * Compute the per-house bonus for a single month.
   *
   * @param {Array} clients  the Clients array (as loaded from Sheets)
   * @param {string} monthKey 'YYYY-MM'
   * @param {object} [opts]   config overrides (see DEFAULTS)
   * @returns {{
   *   ok: boolean, month: string, ratePct: number,
   *   byHouse: Object<string, number>,    // house id -> bonus (rounded ₪)
   *   total: number,
   *   lines: Array  // per-patient preview rows (for dry-run / audit)
   * }}
   */
  function computeMonth(clients, monthKey, opts) {
    var cfg = _mergeConfig(opts);
    var mi = _ymIndex(_ym(monthKey + '-01'));
    var result = {
      ok: true,
      month: monthKey,
      ratePct: cfg.ratePct,
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
        packageAmount: 0,
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

      var amount = packageAmount(c);
      var bonus = amount * (cfg.ratePct / 100);
      line.included = true;
      line.packageAmount = Math.round(amount);
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
    lines.push('Basis: contracted monthly package, charged upfront (5% earned at collection).');
    lines.push('Window: ' + windowResult.from + ' .. ' + windowResult.to);
    lines.push('');
    windowResult.perMonth.forEach(function (r) {
      if (!r.ok) { lines.push(r.month + ': ERROR ' + r.error); return; }
      var included = r.lines.filter(function (l) { return l.included; });
      lines.push(r.month + '  (rate ' + r.ratePct + '%, ' +
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
    monthsInWindow: monthsInWindow,
    computeMonth: computeMonth,
    computeWindow: computeWindow,
    previewText: previewText
  };
});
