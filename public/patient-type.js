/* Patient type (סוג מטופל) — pure helpers for the «מטופלים» tab split.
 * CHANGELOG-patient-type-tabs.md (2026-11-18).
 *
 * The patients list is split into three tabs:
 *   day_community → «קהילה יומית»      (ליווי יומי בקהילה / legacy «מרכז יום»)
 *   individual    → «טיפולים פרטניים»  (every other package / ongoing therapy)
 *   psychiatric   → «פסיכיאטר»         (psychiatrist only: one-time / as needed)
 *
 * Rules (Sandra, 2026-11-18), first match wins:
 *   1. a valid manual override (Clients.patientTypeOverride) decides;
 *   2. a plan with the day-center treatment → day_community (a day-community
 *      patient who also sees the psychiatrist stays HERE only — the psychiatric
 *      session is a one-time charge on his card);
 *   3. a plan whose treatments are ALL psychiatric → psychiatric;
 *      any other non-empty plan → individual;
 *   4. no plan at all (a lead booked one session as «תשלום לפי טיפול»): every
 *      one-time session of this patient is psychiatric → psychiatric;
 *   5. otherwise → individual.
 *
 * PURE: no DOM, no fetch, no clock. Stable English keys; Hebrew labels are
 * render-time only and live here. UMD so node --test exercises it directly.
 * The key list mirrors PATIENT_TYPES in apps-script/Code.gs (parity-tested). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PatientType = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var TYPES = ['day_community', 'individual', 'psychiatric'];
  var TYPE_HE = {
    day_community: 'קהילה יומית',
    individual: 'טיפולים פרטניים',
    psychiatric: 'פסיכיאטר'
  };
  // Mirrors DAY_CENTER_ALIASES in public/app.js / treatment-map.js.
  var DAY_CENTER_ALIASES = ['מרכז יום', 'ליווי יומי בקהילה', 'day_center'];
  // Psychiatrist-only treatment labels — for a plan treatment AND for a one-time
  // session's clinicalTreatmentType. The source maps all four psychiatric
  // one-time services (ייעוץ / מעקב → «מעקב פסיכיאטרי», אבחון / אינטייק →
  // «אינטייק»; ONE_TIME_CLINICAL_BY_KEY in Code.gs), so no catalog key is
  // needed in the browser (catalog keys never ship in a public asset).
  var PSYCHIATRIC_SERVICES = ['מעקב פסיכיאטרי', 'אינטייק'];

  function str(v) { return typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim()); }

  /* A stored override: one of TYPES, else '' (= automatic). Never coerced. */
  function overrideOrBlank(v) {
    var s = str(v);
    return TYPES.indexOf(s) >= 0 ? s : '';
  }
  function label(type) {
    return Object.prototype.hasOwnProperty.call(TYPE_HE, type) ? TYPE_HE[type] : '';
  }
  function parseServices(v) {
    if (!v) return [];
    var arr = Array.isArray(v) ? v : String(v).split(',');
    return arr.map(function (s) { return str(s); }).filter(Boolean);
  }
  function isPsychiatricSession(s) {
    if (!s || typeof s !== 'object') return false;
    return PSYCHIATRIC_SERVICES.indexOf(str(s.clinicalTreatmentType)) >= 0;
  }

  /* The automatic type, ignoring any override. `sessions` = every one-time
   * session row (state.oneTimeSessions); null / not an array = none known. */
  function autoType(client, sessions) {
    var c = client || {};
    var services = parseServices(c.serviceType);
    for (var i = 0; i < services.length; i++) {
      if (DAY_CENTER_ALIASES.indexOf(services[i]) >= 0) return 'day_community';
    }
    if (services.length) {
      var allPsy = services.every(function (s) { return PSYCHIATRIC_SERVICES.indexOf(s) >= 0; });
      return allPsy ? 'psychiatric' : 'individual';
    }
    var id = str(c.id);
    var mine = (Array.isArray(sessions) && id)
      ? sessions.filter(function (s) { return s && str(s.clientId) === id; })
      : [];
    if (mine.length && mine.every(isPsychiatricSession)) return 'psychiatric';
    return 'individual';
  }

  /* { type, manual } — `manual` is true when Vered's override decided. */
  function classify(client, sessions) {
    var o = overrideOrBlank(client && client.patientTypeOverride);
    if (o) return { type: o, manual: true };
    return { type: autoType(client, sessions), manual: false };
  }

  /* Counts per type for the tab badges, plus `all`. */
  function counts(clients, sessions) {
    var out = { all: 0, day_community: 0, individual: 0, psychiatric: 0 };
    (clients || []).forEach(function (c) {
      out.all += 1;
      out[classify(c, sessions).type] += 1;
    });
    return out;
  }

  return {
    TYPES: TYPES.slice(),
    TYPE_HE: Object.assign({}, TYPE_HE),
    PSYCHIATRIC_SERVICES: PSYCHIATRIC_SERVICES.slice(),
    overrideOrBlank: overrideOrBlank,
    label: label,
    autoType: autoType,
    classify: classify,
    counts: counts
  };
}));
