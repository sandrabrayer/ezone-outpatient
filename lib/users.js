'use strict';

/* The fixed set of outpatient users — the SAME four names as the leads
 * `assignedTo` dropdown in public/index.html (משוייך ל). Single source of
 * truth for the server: /api/verify-pin accepts a session `user` ONLY from
 * this list (anything else mints the legacy user-less cookie), so updatedBy
 * can never carry an arbitrary string, however the request was crafted.
 *
 * test/session-who-when.test.js pins this list equal to the index.html
 * <select name="assignedTo"> options, so the two can never drift silently.
 * Add/rename users HERE and THERE together. The login name picker (PR 2)
 * offers exactly this list — served by the session-gated GET /api/users, so
 * the client keeps no copy — and feeds the pick back to /api/verify-pin.
 *
 * Every name in this list carries the SAME permissions: the list is an
 * allow-list of who may stamp updatedBy, not a role table. There is no role
 * anywhere in it — the only roles are editor/viewer, decided by which PIN
 * button was used, never by which name was picked. Appended in join order. (ירדן left in 2026-10; שירן and יעל left in 2026-10 and were replaced by אורן and דנה — see RETIRED_SESSION_USERS.) */
const SESSION_USERS = ['ורד', 'אורן', 'דנה'];

/* Names that were once on SESSION_USERS and have left. They are NOT offered by
 * the picker and /api/verify-pin refuses them, and — because a cookie minted
 * before removal stays valid for up to 7 days — the session gate (server.js
 * sessionAuthStatus) also rejects any token that still carries one. Historical
 * `updatedBy` values in the sheets are plain text and are never rewritten.
 * Removing a name does NOT revoke a person who still knows the shared APP_PIN:
 * rotate APP_PIN + SESSION_SECRET (see docs/package-catalog.md). */
const RETIRED_SESSION_USERS = ['ירדן', 'שירן', 'יעל'];

/* Who may open the pricing tab («תמחור חבילות»). Owner decision 2026-10-19: Vered's signed-in name is enough
 * (no second code). Honest limit: the name is picked at sign-in with the shared APP_PIN, so anyone who knows
 * APP_PIN can pick it. Server-side only — the browser never decides this. */
const CATALOG_ADMIN_USERS = ['ורד'];

/* PERSONAL PINs (2026-10-26). ורד keeps signing in with the shared APP_PIN (unchanged). Every other
 * name has ITS OWN PIN, read from a Railway variable — the NAMES of the variables live here, the values
 * never appear in code, tests, docs or logs. A name's PIN is the ONLY code that signs in as that name:
 * the shared APP_PIN does NOT sign in as אורן or דנה, and one person's PIN does not sign in as another.
 * FAIL-CLOSED: a variable that is unset, not 4–6 digits (the PIN field has maxlength=6), equal to APP_PIN,
 * or equal to another personal PIN leaves that name with NO working PIN (it cannot sign in) and is
 * logged by variable NAME only. */
const SHARED_PIN_USER = 'ורד';
const PERSONAL_PIN_ENV = Object.freeze({ 'אורן': 'USER_PIN_OREN', 'דנה': 'USER_PIN_DANA' });
const PERSONAL_PIN_RE = /^[0-9]{4,6}$/;

/* Resolve the PIN each allow-listed name signs in with. Pure: takes an env object, returns
 * { pins: { name: pin }, problems: [ 'USER_PIN_X: reason' ] } — a name with no valid PIN is absent from `pins`. */
function resolveUserPins(env) {
  const e = env || {};
  const pins = {};
  const problems = [];
  const shared = typeof e.APP_PIN === 'string' ? e.APP_PIN : '';
  if (shared) pins[SHARED_PIN_USER] = shared;
  const seen = {};
  Object.keys(PERSONAL_PIN_ENV).forEach((name) => {
    const key = PERSONAL_PIN_ENV[name];
    const v = typeof e[key] === 'string' ? e[key] : '';
    if (!v) { problems.push(key + ': not set'); return; }
    if (!PERSONAL_PIN_RE.test(v)) { problems.push(key + ': must be 4-6 digits'); return; }
    if (shared && v === shared) { problems.push(key + ': must differ from APP_PIN'); return; }
    if (Object.prototype.hasOwnProperty.call(seen, v)) {
      problems.push(key + ': must differ from ' + seen[v]);
      delete pins[Object.keys(PERSONAL_PIN_ENV).find((n) => PERSONAL_PIN_ENV[n] === seen[v])];
      return;
    }
    seen[v] = key;
    pins[name] = v;
  });
  return { pins, problems };
}

module.exports = {
  SESSION_USERS, RETIRED_SESSION_USERS, CATALOG_ADMIN_USERS,
  SHARED_PIN_USER, PERSONAL_PIN_ENV, resolveUserPins
};
