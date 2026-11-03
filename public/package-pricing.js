/**
 * package-pricing.js — the "תמחור חבילות" tab (Vered only).
 * -----------------------------------------------------------------------------
 * CONFIDENTIALITY: this file ships to every browser, so it carries LABELS ONLY
 * (Hebrew names for stable English keys) — never a price, rate or catalog row.
 * Every amount shown here was returned by /api/catalog-admin/rpc after the
 * server verified the catalog-admin PIN (a short-lived HttpOnly cookie). A picked
 * display name, a stored browser flag, or this file's own state grants nothing; if the
 * cookie is missing/expired the server answers 401 and the gate comes back.
 *
 * Money is integer agorot end to end. The only conversion is parseShekels()
 * (string -> integer agorot, no floating point) for what Vered types.
 *
 * Mutations (adjust / select / approve / attach) carry a client-generated op id
 * that is REUSED when the same action is retried, plus the revision the screen
 * was showing; the server replays a seen op id and refuses a stale revision.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PackagePricing = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- Hebrew labels for stable keys (render-time only) ---------------------
  var FAMILY = { day_track: 'מסלול יום', emdr: 'EMDR', cbt: 'CBT', emdr_cbt: 'EMDR + CBT', continuation: 'טיפולי המשך', psychiatric: 'פסיכיאטריה', solo_housing: 'Solo — דיור' };
  var TIER = { basic: 'בסיסי', extended: 'מורחב', core: 'Core', standard: 'Standard', complex: 'Complex', single: 'טיפול בודד', combined: 'משולב', monthly: 'חודשי', consult: 'ייעוץ', diagnosis: 'אבחון', range: 'טווח מחיר' };
  var UNIT = { per_session_pack: 'חבילת טיפולים', flat: 'מחיר כולל קבוע', per_month: 'מחיר חודשי', per_month_range: 'טווח חודשי (בחירה)' };
  var STATUS = { pending: 'ממתין לתמחור', priced: 'תומחר (לא שולם)' };
  var REQUESTER = { oren: 'אורן', shahar: 'שחר' };
  var ERRORS = {
    vered_only: 'האזור הזה מיועד לורד בלבד', named_session_required: 'יש להיכנס עם שם משתמש (לא כניסה אנונימית) כדי לגשת לתמחור', too_many_attempts: 'יותר מדי ניסיונות — נסי שוב מאוחר יותר',
    catalog_admin_not_configured: 'התמחור עדיין לא הוגדר בשרת', admin_required: 'נדרשת כניסה מחדש',
    revision_conflict: 'הבקשה עודכנה — נטענה מחדש', version_conflict: 'השורה עודכנה — נטענה מחדש',
    already_priced: 'הבקשה כבר תומחרה', selection_required: 'יש לבחור מחיר חודשי לפני אישור',
    selection_out_of_range: 'המחיר מחוץ לטווח', selection_not_required: 'אין צורך בבחירת מחיר',
    reason_required: 'חובה לרשום סיבה לשינוי', invalid_adjustment: 'סכום לא תקין',
    not_priced: 'אפשר לשייך רק בקשה שתומחרה', already_attached: 'הבקשה כבר משויכת למטופל אחר',
    target_not_found: 'המטופל/הליד לא נמצא', invalid_target: 'יעד שיוך לא תקין', invalid_fields: 'שדות לא תקינים',
    upstream_unavailable: 'השרת לא זמין, נסי שוב', busy: 'המערכת עסוקה, נסי שוב', unauthorized: 'אין הרשאה'
  };
  var MAX_SHEKELS_DIGITS = 7;

  function label(map, key) { return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : String(key); }
  function errorText(code) { return label(ERRORS, code) === code ? 'שגיאה (' + code + ')' : label(ERRORS, code); }

  // ---- money (integer agorot) ------------------------------------------------
  function formatAgorot(a) {
    if (a === null || a === undefined || !isFinite(a)) return '—';
    var neg = a < 0; a = Math.abs(a);
    var whole = Math.floor(a / 100), frac = a % 100;
    var s = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s + (frac ? '.' + (frac < 10 ? '0' : '') + frac : '') + ' ₪';
  }
  // "3400" / "3,400.5" -> agorot integer; anything else -> null. No floats.
  function parseShekels(text) {
    var t = String(text == null ? '' : text).replace(/[,\s₪]/g, '');
    var m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(t);
    if (!m) return null;
    var frac = m[2] ? (m[2] + '0').slice(0, 2) : '00';
    return parseInt(m[1], 10) * 100 + parseInt(frac, 10);
  }

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // One op id per (action, request, revision, payload): a retry after a timeout
  // reuses it (server replays), a different intent gets a new one.
  var ops = {};
  function opIdFor(sig) { return ops[sig] || (ops[sig] = uuid()); }
  function forgetOp(sig) { delete ops[sig]; }

  // ---- DOM helper (textContent only — never HTML strings) -----------------
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]);
    });
    [].concat(kids || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }

  // ---- state -----------------------------------------------------------------
  var S = { onUnauthorized: function () {}, root: null, phase: 'loading', tab: 'requests', configured: true, catalog: null, requests: null, error: '',
    targets: function () { return []; }, notify: function () {}, onPending: function () {} };

  function say(msg, isErr) { try { S.notify(msg, !!isErr); } catch (_) {} }

  // One fetch; a 401 that is NOT the catalog privilege means the base session is gone.
  async function rawCall(path, method, body) {
    var r = await fetch(path, { method: method || 'GET', cache: 'no-store', credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    var j = null; try { j = await r.json(); } catch (_) {}
    if (r.status === 401 && !(j && j.error === 'admin_required')) { S.onUnauthorized(); throw new Error('unauthorized'); }
    if (!j) throw new Error('upstream_unavailable');
    return j;
  }
  /* The catalog privilege is a 15-minute server-side session. SINGLE-FLIGHT: however many callers ask at once
   * (two mounts during the first load, a click after the privilege expired), ONE status/login round-trip runs.
   * Two parallel logins would revoke each other (the server keeps one admin session per base session), every
   * following call would answer 401 and the screen would be redrawn under the user's hands (the 2026-11 "buttons
   * do nothing" report). Resolves true when the privilege is live. */
  var adminFlight = null;
  function ensureAdmin() {
    if (adminFlight) return adminFlight;
    adminFlight = (async function () {
      var st = await rawCall('/api/catalog-admin/status');
      S.configured = !!st.configured; S.eligible = !!st.eligible;
      if (st.admin) return true;
      // Vered's signed-in name is the authorization: no second code. The server decides; this only asks.
      if (!st.configured || !st.eligible) return false;
      var r = await rawCall('/api/catalog-admin/login', 'POST', {});
      return !!(r && r.ok);
    })().catch(function (e) { if (e.message === 'unauthorized') throw e; return false; })
      .finally(function () { adminFlight = null; });
    return adminFlight;
  }
  /* A privileged call. When the privilege has lapsed (admin_required) it is renewed ONCE and the same call is
   * retried, so the click that found an expired privilege still does its work instead of vanishing. */
  async function call(path, method, body, retried) {
    var j = await rawCall(path, method, body);
    if (j && j.error === 'admin_required' && !j.ok) {
      if (!retried && (await ensureAdmin())) return call(path, method, body, true);
      S.phase = 'gate'; S.catalog = null; S.requests = null; draw();
      throw new Error('admin_required');
    }
    return j;
  }
  function rpc(op, fields) { return call('/api/catalog-admin/rpc', 'POST', Object.assign({ op: op }, fields || {})); }

  // Single-flight too: a second mount while the first load is running joins it instead of starting another.
  var bootFlight = null;
  function boot() {
    if (bootFlight) return bootFlight;
    bootFlight = (async function () {
      var ok = false;
      try { ok = await ensureAdmin(); } catch (_) { ok = false; }
      S.phase = ok ? 'admin' : 'gate';
      if (ok) await loadAll();
      draw();
    })().finally(function () { bootFlight = null; });
    return bootFlight;
  }
  /* Loads catalog + requests. A failure is REPORTED (S.loadError, drawn with a retry button) — never shown as an
   * empty catalog / "no requests", which looked like dead buttons. */
  async function loadAll() {
    S.loadError = '';
    try {
      var res = await Promise.all([rpc('catalog'), rpc('list')]);
      S.catalog = res[0] && res[0].ok ? res[0] : null;
      S.requests = res[1] && res[1].ok ? res[1] : null;
      if (!S.catalog || !S.requests) S.loadError = errorText(((S.catalog ? res[1] : res[0]) || {}).error || 'upstream_unavailable');
      S.onPending(S.requests ? S.requests.counts.pending : 0);
    } catch (e) {
      if (e.message === 'unauthorized' || e.message === 'admin_required') return;
      S.catalog = null; S.requests = null; S.loadError = errorText(e.message);
    }
  }

  // ---- views -----------------------------------------------------------------
  function draw() {
    if (!S.root) return;
    while (S.root.firstChild) S.root.removeChild(S.root.firstChild);
    if (S.phase === 'loading') { S.root.appendChild(h('p', { class: 'muted', text: 'טוען…' })); return; }
    if (S.phase === 'gate') { S.root.appendChild(gateView()); return; }
    S.root.appendChild(adminView());
  }

  function gateView() {
    var text = !S.configured ? 'התמחור עדיין לא הוגדר בשרת. פני לסנדרה.'
      : (S.eligible ? 'לא ניתן לפתוח את התמחור כרגע. נסי לרענן או להיכנס מחדש.' : 'האזור הזה מיועד לורד בלבד.');
    return h('div', { class: 'pkg-gate card' }, [
      h('h2', { text: 'תמחור חבילות' }),
      h('p', { class: 'muted', text: text })
    ]);
  }

  function adminView() {
    var counts = S.requests ? S.requests.counts : { pending: 0, priced: 0 };
    var tabs = [['requests', 'בקשות' + (counts.pending ? ' (' + counts.pending + ')' : '')], ['calc', 'מחשבון'], ['catalog', 'קטלוג']];
    var bar = h('div', { class: 'pkg-tabs' }, tabs.map(function (t) {
      return h('button', { type: 'button', class: 'btn' + (S.tab === t[0] ? ' btn-primary' : ''), text: t[1], onclick: function () { S.tab = t[0]; draw(); } });
    }).concat([
      h('button', { type: 'button', class: 'btn', text: 'רענון', onclick: async function () { S.loading = true; draw(); await loadAll(); S.loading = false; draw(); } }),
      h('button', { type: 'button', class: 'btn', text: 'יציאה מתמחור', onclick: lock })
    ]));
    var body = S.loading ? h('p', { class: 'muted', text: 'טוען…' }) : S.tab === 'requests' ? requestsView() : S.tab === 'calc' ? calcView() : catalogView();
    var loadErr = S.loadError ? h('div', { class: 'pkg-msg pkg-load-error', role: 'alert' }, [
      'הנתונים לא נטענו: ' + S.loadError + ' ',
      h('button', { type: 'button', class: 'btn', text: 'נסי שוב', onclick: async function () { S.loading = true; draw(); await loadAll(); S.loading = false; draw(); } })
    ]) : null;
    return h('div', { class: 'pkg-admin' }, [bar, loadErr, S.error ? h('p', { class: 'pkg-msg', role: 'alert', text: S.error }) : null, body]);
  }

  async function lock() {
    try { await call('/api/catalog-admin/logout', 'POST', {}); } catch (_) {}
    S.catalog = null; S.requests = null; S.calc = null; S.phase = 'gate'; S.error = ''; S.loadError = ''; ops = {}; draw();
  }

  function pkgName(key) {
    var it = S.catalog && S.catalog.items.filter(function (i) { return i.key === key; })[0];
    return it ? label(FAMILY, it.family) + ' — ' + label(TIER, it.tier) : key;
  }

  // -- requests --
  function requestsView() {
    if (!S.requests) return h('p', { class: 'muted', text: 'רשימת הבקשות לא נטענה.' });
    var items = S.requests.items;
    if (!items.length) return h('p', { class: 'muted', text: 'אין בקשות תמחור.' });
    return h('div', { class: 'pkg-list' }, items.map(requestCard));
  }

  function requestCard(r) {
    var q = r.quote || {};
    var monthly = q.monthlyAgorot, total = r.effectiveTotalAgorot;
    var priceLines = [];
    if (r.needsSelection && r.selectedMonthlyAgorot === null) priceLines.push(h('div', { class: 'chip warn', text: 'נדרשת בחירת מחיר חודשי' }));
    else {
      if (monthly !== null && monthly !== undefined) priceLines.push(h('div', { text: 'מחיר חודשי: ' + formatAgorot(monthly) }));
      priceLines.push(h('div', { text: (q.commitmentMonths ? 'סה״כ ל-' + q.commitmentMonths + ' חודשים' : 'סה״כ') + ': ' + formatAgorot(total) + (r.adjustedTotalAgorot !== null ? ' (מתואם)' : '') }));
      if (q.netAgorot !== null && q.netAgorot !== undefined && r.adjustedTotalAgorot === null)
        priceLines.push(h('div', { class: 'muted', text: 'לפני מע״מ ' + formatAgorot(q.netAgorot) + ' · מע״מ ' + formatAgorot(q.vatAgorot) + ' (מחיר כולל מע״מ)' }));
    }
    if (r.status === 'priced') priceLines.push(h('div', { class: 'pkg-approved', text: 'אושר: ' + formatAgorot(r.approvedTotalAgorot) + ' — טרם שולם' }));
    var kids = [
      h('div', { class: 'pkg-head' }, [
        h('strong', { text: r.patientName }), h('span', { class: 'chip', text: label(STATUS, r.status) }),
        h('span', { class: 'muted', text: 'מבקש/ת: ' + label(REQUESTER, r.requesterKey) + (r.patientPhone ? ' · ' + r.patientPhone : '') })
      ]),
      h('div', { text: pkgName(r.packageKey) + (r.months ? ' · ' + r.months + ' חודשים' : '') }),
      h('div', { class: 'pkg-price' }, priceLines)
    ];
    if (r.adjustLog && r.adjustLog.length) kids.push(h('ul', { class: 'pkg-log muted' }, r.adjustLog.map(function (e) {
      return h('li', { text: (e.kind === 'select' ? 'נבחר מחיר חודשי ' + formatAgorot(e.to) : 'תואם מ-' + formatAgorot(e.from) + ' ל-' + formatAgorot(e.to)) + (e.reason ? ' — ' + e.reason : '') + ' (' + e.by + ')' });
    })));
    if (r.status === 'pending') kids.push(pendingControls(r));
    if (r.status === 'priced') kids.push(attachControls(r));
    return h('div', { class: 'pkg-card card' }, kids);
  }

  async function mutate(op, r, fields, okMsg) {
    var sig = op + '|' + r.id + '|' + r.revision + '|' + JSON.stringify(fields);
    S.error = '';
    try {
      var res = await rpc(op, Object.assign({ requestId: r.id, opId: opIdFor(sig), expectedRevision: r.revision }, fields));
      if (res.ok) { forgetOp(sig); say(okMsg || 'נשמר'); await loadAll(); draw(); return; }
      if (res.error === 'revision_conflict') { forgetOp(sig); await loadAll(); }
      S.error = errorText(res.error); say(S.error, true); draw();
    } catch (e) { if (e.message !== 'unauthorized') { S.error = errorText(e.message); say(S.error, true); draw(); } }
  }

  // Range items (Solo): Vered picks one of three fixed tiers — minimum, midpoint, maximum (whole agorot, midpoint rounded down).
  function rangeTiers(item) {
    var lo = item && item.priceMinAgorot, hi = item && item.priceMaxAgorot;
    if (!(lo > 0) || !(hi >= lo)) return [];
    var mid = Math.floor((lo + hi) / 2);
    var out = [{ id: 'min', text: 'מינימום', agorot: lo }, { id: 'mid', text: 'אמצע', agorot: mid }, { id: 'max', text: 'מקסימום', agorot: hi }];
    return out.filter(function (t, i) { return i === 0 || t.agorot !== out[i - 1].agorot; });
  }
  function tierSelect(item, aria) {
    return h('select', { 'aria-label': aria }, [h('option', { value: '', text: 'בחירת מדרגת מחיר…' })].concat(rangeTiers(item).map(function (t) {
      return h('option', { value: String(t.agorot), text: t.text + ' · ' + formatAgorot(t.agorot) });
    })));
  }

  function pendingControls(r) {
    var box = [];
    if (r.needsSelection) {
      var item = S.catalog && S.catalog.items.filter(function (i) { return i.key === r.packageKey && i.active; })[0];
      var sel = tierSelect(item, 'מדרגת מחיר חודשי');
      box.push(h('div', { class: 'pkg-row' }, [sel, h('button', { type: 'button', class: 'btn', text: 'בחירת מחיר חודשי', onclick: function () {
        var a = parseInt(sel.value, 10); if (!(a > 0)) { say('יש לבחור מדרגת מחיר', true); return; }
        mutate('adjust', r, { selectedMonthlyAgorot: a }, 'המחיר נבחר');
      } })]));
    } else {
      var amt = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'סכום מתואם ב-₪', 'aria-label': 'סכום מתואם' });
      var why = h('input', { type: 'text', maxlength: '200', placeholder: 'סיבה (חובה)', 'aria-label': 'סיבת התאמה' });
      box.push(h('div', { class: 'pkg-row' }, [amt, why, h('button', { type: 'button', class: 'btn', text: 'התאמת סכום', onclick: function () {
        var a = parseShekels(amt.value); if (a === null) { say('סכום לא תקין', true); return; }
        if (why.value.trim().length < 2) { say('חובה לרשום סיבה', true); return; }
        mutate('adjust', r, { adjustedTotalAgorot: a, reason: why.value.trim() }, 'הסכום הותאם');
      } })]));
    }
    var canApprove = !(r.needsSelection && r.selectedMonthlyAgorot === null);
    box.push(h('button', { type: 'button', class: 'btn btn-primary', disabled: canApprove ? false : 'disabled', text: 'אישור תמחור',
      onclick: function () { mutate('approve', r, {}, 'התמחור אושר'); } }));
    return h('div', { class: 'pkg-controls' }, box);
  }

  function attachControls(r) {
    if (r.attachedType) return h('div', { class: 'muted', text: 'משויך ל' + (r.attachedType === 'client' ? 'מטופל' : 'ליד') + ' (מזהה ' + r.attachedId + ')' });
    var targets = S.targets() || [];
    var sel = h('select', { 'aria-label': 'שיוך למטופל' }, [h('option', { value: '', text: 'שיוך למטופל/ליד…' })].concat(targets.map(function (t) {
      return h('option', { value: t.type + ':' + t.id, text: (t.type === 'client' ? 'מטופל · ' : 'ליד · ') + t.name });
    })));
    return h('div', { class: 'pkg-row' }, [sel, h('button', { type: 'button', class: 'btn', text: 'שיוך (ללא חיוב)', onclick: function () {
      var v = sel.value.split(':'); if (v.length < 2) { say('בחרי מטופל או ליד', true); return; }
      mutate('attach', r, { targetType: v[0], targetId: v.slice(1).join(':') }, 'שויך — לא נוצר חיוב או תשלום');
    } })]);
  }

  // -- calculator (compute-only; creates nothing) --
  // Every option is visible at once as a button (no hidden dropdowns): all packages grouped by family, then the months and,
  // for range items (Solo), the minimum / midpoint / maximum tiers. The quote is computed on every choice.
  function chips(options, selected, onPick, aria) {
    return h('div', { class: 'pkg-chips', role: 'group', 'aria-label': aria }, options.map(function (o) {
      var on = String(o.value) === String(selected);
      return h('button', { type: 'button', class: 'btn ' + (on ? 'btn-primary' : 'btn-ghost') + ' pkg-chip', 'aria-pressed': on ? 'true' : 'false', text: o.text, onclick: function () { onPick(o.value); } });
    }));
  }
  function calcView() {
    if (!S.catalog) return h('p', { class: 'muted', text: 'הקטלוג לא נטען.' });
    var items = S.catalog.items.filter(function (i) { return i.active; });
    if (!items.length) return h('p', { class: 'muted', text: 'הקטלוג ריק. עברי ללשונית קטלוג.' });
    var C = S.calc = S.calc || { key: '', months: '', tier: '', out: null };
    var box = h('div', { class: 'pkg-calc card' });
    function cur() { return items.filter(function (i) { return i.key === C.key; })[0] || null; }
    function pickItem(key) {
      var it = items.filter(function (i) { return i.key === key; })[0];
      C.key = key; C.tier = ''; C.out = null;
      C.months = it && it.allowedMonths.length ? String(it.allowedMonths[0]) : '';
      run();
    }
    async function run() {
      var it = cur();
      if (!it) { paint(); return; }
      var f = { packageKey: it.key };
      if (it.allowedMonths.length) f.months = parseInt(C.months, 10);
      if (it.unit === 'per_month_range' && C.tier) f.selectedMonthlyAgorot = parseInt(C.tier, 10);
      var res = await rpc('quote', f).catch(function (e) { return { ok: false, error: e.message }; });
      C.out = res; paint();
    }
    function resultView() {
      var res = C.out, it = cur();
      if (!it) return h('p', { class: 'muted', text: 'בחרי חבילה כדי לראות מחיר.' });
      if (!res) return h('p', { class: 'muted', text: '…' });
      if (!res.ok) return h('p', { class: 'pkg-msg', role: 'alert', text: errorText(res.error) });
      var q = res.quote, kids = [];
      if (q.needsSelection) return h('p', { class: 'muted', text: 'זהו טווח מחירים — יש לבחור מדרגת מחיר: מינימום / אמצע / מקסימום (אין מחיר ברירת מחדל).' });
      if (q.monthlyAgorot !== null) kids.push(h('div', { text: 'מחיר חודשי: ' + formatAgorot(q.monthlyAgorot) }));
      kids.push(h('div', { class: 'pkg-total', text: (q.commitmentMonths ? 'סה״כ התחייבות ל-' + q.commitmentMonths + ' חודשים' : 'סה״כ') + ': ' + formatAgorot(q.grossAgorot) }));
      kids.push(h('div', { class: 'muted', text: 'לפני מע״מ ' + formatAgorot(q.netAgorot) + ' · מע״מ ' + formatAgorot(q.vatAgorot) + ' (מחיר כולל מע״מ ' + (q.vatRateBp / 100) + '%)' }));
      return h('div', { class: 'pkg-calc-out', 'aria-live': 'polite' }, kids);
    }
    function paint() {
      while (box.firstChild) box.removeChild(box.firstChild);
      var order = [], byFam = {};
      items.forEach(function (i) { if (!byFam[i.family]) { byFam[i.family] = []; order.push(i.family); } byFam[i.family].push(i); });
      order.forEach(function (fam) {
        box.appendChild(h('div', { class: 'pkg-fam' }, [
          h('div', { class: 'pkg-fam-title', text: label(FAMILY, fam) }),
          chips(byFam[fam].map(function (i) { return { value: i.key, text: label(TIER, i.tier) }; }), C.key, pickItem, label(FAMILY, fam))
        ]));
      });
      var it = cur();
      if (it && it.allowedMonths.length > 1) {
        box.appendChild(h('div', { class: 'pkg-fam' }, [h('div', { class: 'pkg-fam-title', text: 'משך (חודשים)' }),
          chips(it.allowedMonths.map(function (m) { return { value: String(m), text: m + ' חודשים' }; }), C.months, function (v) { C.months = v; run(); }, 'משך')]));
      } else if (it && it.allowedMonths.length === 1) {
        box.appendChild(h('div', { class: 'muted', text: 'משך: ' + it.allowedMonths[0] + ' חודשים' }));
      }
      if (it && it.unit === 'per_month_range') {
        box.appendChild(h('div', { class: 'pkg-fam' }, [h('div', { class: 'pkg-fam-title', text: 'מדרגת מחיר חודשי' }),
          chips(rangeTiers(it).map(function (t) { return { value: String(t.agorot), text: t.text + ' · ' + formatAgorot(t.agorot) }; }), C.tier, function (v) { C.tier = v; run(); }, 'מדרגת מחיר חודשי')]));
      }
      box.appendChild(resultView());
      box.appendChild(h('p', { class: 'muted', text: 'המחשבון לא יוצר בקשה, חיוב או תשלום.' }));
    }
    paint();
    return box;
  }

  // -- catalog --
  function catalogView() {
    var cat = S.catalog;
    if (!cat) return h('p', { class: 'muted', text: 'לא ניתן לטעון את הקטלוג.' });
    if (!cat.items.length) return h('div', { class: 'card' }, [h('p', { text: 'הקטלוג ריק.' }), h('button', { type: 'button', class: 'btn btn-primary', text: 'ייבוא ראשוני מקטלוג השירותים (PDF)', onclick: async function () {
      var res = await rpc('seed').catch(function (e) { return { ok: false, error: e.message }; });
      if (res.ok) { say('הקטלוג יובא'); await loadAll(); } else { S.error = errorText(res.error); }
      draw();
    } })]);
    var active = cat.items.filter(function (i) { return i.active; });
    return h('div', { class: 'pkg-list' }, active.map(catalogRow));
  }

  function priceText(i) {
    if (i.unit === 'per_session_pack') return i.sessions + ' טיפולים × ' + formatAgorot(i.pricePerSessionAgorot) + ' = ' + formatAgorot(i.sessions * i.pricePerSessionAgorot);
    if (i.unit === 'flat') return 'מחיר כולל: ' + formatAgorot(i.priceTotalAgorot);
    if (i.unit === 'per_month') return 'לחודש: ' + formatAgorot(i.monthlyPriceAgorot);
    return 'לחודש: ' + formatAgorot(i.priceMinAgorot) + ' – ' + formatAgorot(i.priceMaxAgorot) + ' (בחירה בעת התמחור)';
  }
  var PRICE_FIELD = { per_session_pack: 'pricePerSessionAgorot', flat: 'priceTotalAgorot', per_month: 'monthlyPriceAgorot' };

  function catalogRow(i) {
    var edit = h('div', { class: 'pkg-row', hidden: true });
    var inputs = {};
    function field(name, ph) { inputs[name] = h('input', { type: 'text', inputmode: 'decimal', placeholder: ph, 'aria-label': ph }); return inputs[name]; }
    if (i.unit === 'per_month_range') edit.append(field('priceMinAgorot', 'מינימום ₪'), field('priceMaxAgorot', 'מקסימום ₪'));
    else edit.append(field(PRICE_FIELD[i.unit], i.unit === 'per_session_pack' ? 'מחיר לטיפול ₪' : 'מחיר ₪'));
    edit.appendChild(h('button', { type: 'button', class: 'btn btn-primary', text: 'שמירה כגרסה חדשה', onclick: async function () {
      var fields = { family: i.family, tier: i.tier, unit: i.unit, sessions: i.sessions, sessionMinutes: i.sessionMinutes,
        allowedMonths: i.allowedMonths, vatRateBp: i.vatRateBp, sourceRef: i.sourceRef, sortOrder: i.sortOrder,
        pricePerSessionAgorot: i.pricePerSessionAgorot, priceTotalAgorot: i.priceTotalAgorot, monthlyPriceAgorot: i.monthlyPriceAgorot,
        priceMinAgorot: i.priceMinAgorot, priceMaxAgorot: i.priceMaxAgorot, active: true };
      for (var k in inputs) { var a = parseShekels(inputs[k].value); if (a === null) { say('סכום לא תקין', true); return; } fields[k] = a; }
      var res = await rpc('saveRow', { key: i.key, expectedVersion: i.version, fields: fields }).catch(function (e) { return { ok: false, error: e.message }; });
      if (res.ok) { say('נשמרה גרסה ' + res.version + ' — בקשות קיימות לא משתנות'); await loadAll(); S.error = ''; }
      else { S.error = errorText(res.error); if (res.error === 'version_conflict') await loadAll(); }
      draw();
    } }));
    return h('div', { class: 'pkg-card card' }, [
      h('div', { class: 'pkg-head' }, [h('strong', { text: label(FAMILY, i.family) + ' — ' + label(TIER, i.tier) }), h('span', { class: 'chip', text: label(UNIT, i.unit) }), h('span', { class: 'muted', text: 'גרסה ' + i.version })]),
      h('div', { text: priceText(i) }),
      i.allowedMonths.length ? h('div', { class: 'muted', text: 'התחייבות אפשרית: ' + i.allowedMonths.join(', ') + ' חודשים' }) : null,
      h('div', { class: 'muted', text: i.sourceRef }),
      h('button', { type: 'button', class: 'btn', text: 'עריכת מחיר', onclick: function () { edit.hidden = !edit.hidden; } }), edit
    ]);
  }

  // ---- public API --------------------------------------------------------------
  function mount(rootEl, opts) {
    var sameRoot = S.root === rootEl; S.root = rootEl; opts = opts || {};
    S.targets = opts.targets || S.targets; S.notify = opts.notify || S.notify; S.onPending = opts.onPending || S.onPending; S.onUnauthorized = opts.onUnauthorized || S.onUnauthorized;
    if (S.phase === 'loading' || S.phase === 'gate') { boot(); return; }
    // Already showing the admin screen in this very root: keep what the user has open (an edit row, a calculator
    // choice) instead of wiping it on every unrelated re-render of the host app. «רענון» redraws on demand.
    if (sameRoot && rootEl.firstChild && rootEl.querySelector('.pkg-admin')) return;
    draw();
  }
  function reset() { S.phase = 'loading'; S.catalog = null; S.requests = null; S.calc = null; S.error = ''; S.loadError = ''; S.loading = false; ops = {}; if (S.root) draw(); }

  return { mount: mount, reset: reset, formatAgorot: formatAgorot, parseShekels: parseShekels, label: label, rangeTiers: rangeTiers,
    FAMILY: FAMILY, TIER: TIER, UNIT: UNIT, STATUS: STATUS, REQUESTER: REQUESTER, ERRORS: ERRORS };
});
