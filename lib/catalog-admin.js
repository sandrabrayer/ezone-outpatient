'use strict';

/* Vered-only authorization for the package catalog / pricing requests.
 *
 * WHY A SEPARATE PRIVILEGE: the app has ONE shared APP_PIN, a display name
 * picked from a list, and a sessionStorage editor/viewer flag — none of which
 * can prove "this is Vered". Prices must be visible and editable by her only,
 * so the server verifies a second, independent secret (CATALOG_ADMIN_PIN) and
 * mints a SHORT-LIVED, scoped, signed HttpOnly cookie that points at a
 * SERVER-SIDE admin session bound to ONE base session and ONE named user
 * (revoked on logout, on re-login, on restart and when the user is retired). A display name or any
 * browser value grants nothing.
 *
 * Apps Script must not trust Node blindly either: every admin call carries a
 * short-lived HMAC assertion (CATALOG_ADMIN_ASSERTION_SECRET, shared with a
 * Script Property of the same name) bound to the action, an expiry, a nonce
 * and a hash of the exact request body — see _pkgAdminAssertionOk in Code.gs.
 *
 * Nothing in this file holds a price or a secret value. */

const crypto = require('crypto');
const { createSessionToken, verifySessionToken, readSessionUser } = require('./session');
const { checkPin } = require('./pin');

const ADMIN_COOKIE = 'ezone_catalog_admin';
const ADMIN_SCOPE = 'catalog-admin';          // token family: never verifies as a normal session
const ADMIN_TTL_SECONDS = 15 * 60;            // short-lived: re-enter the PIN after 15 minutes
const ADMIN_COOKIE_PATH = '/api/catalog-admin'; // the browser only sends it to these routes

/* Body fields a browser may NEVER supply: the server owns actor/role/authority. */
const FORBIDDEN_CLIENT_FIELDS = [
  'user', 'proxySecret', 'secret', 'adminAssertion', 'action', 'actor', 'actorKey',
  'actorRole', 'role', 'requesterKey', 'catalogAdmin', 'isAdmin'
];

/* Allowlisted request fields per admin op. The upstream body is rebuilt from
 * these only — the raw browser body is never forwarded. */
const ADMIN_OPS = {
  catalog: { action: 'adminGetPackageCatalog', fields: [] },
  seed: { action: 'adminSeedPackageCatalog', fields: [] },
  saveRow: { action: 'adminSavePackageCatalogRow', fields: ['key', 'expectedVersion', 'fields'] },
  quote: { action: 'adminQuotePackage', fields: ['packageKey', 'months', 'selectedMonthlyAgorot'] },
  list: { action: 'adminListPackageRequests', fields: [] },
  adjust: {
    action: 'adminAdjustPackageRequest',
    fields: ['requestId', 'opId', 'expectedRevision', 'adjustedTotalAgorot', 'selectedMonthlyAgorot', 'reason']
  },
  approve: { action: 'adminApprovePackageRequest', fields: ['requestId', 'opId', 'expectedRevision'] },
  attach: {
    action: 'adminAttachPackageRequest',
    fields: ['requestId', 'opId', 'expectedRevision', 'targetType', 'targetId']
  }
};

const CATALOG_ROW_FIELDS = [
  'family', 'tier', 'unit', 'sessions', 'sessionMinutes', 'allowedMonths',
  'pricePerSessionAgorot', 'priceTotalAgorot', 'monthlyPriceAgorot',
  'priceMinAgorot', 'priceMaxAgorot', 'vatRateBp', 'sourceRef', 'active', 'sortOrder'
];

/* Key-sorted, whitespace-free JSON — the byte-identical twin of
 * _pkgCanonicalJson in apps-script/Code.gs. */
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}

/* Fail-closed configuration check. Returns { ok:true } or { ok:false, reason }
 * where reason is a fixed code (never a value). */
function adminConfigStatus(env) {
  const assertion = env.CATALOG_ADMIN_ASSERTION_SECRET || '';
  if (!env.SESSION_SECRET) return { ok: false, reason: 'session_not_configured' };
  if (assertion.trim().length < 32) return { ok: false, reason: 'assertion_secret_not_configured' };
  if (assertion === (env.OUTPATIENT_PROXY_SECRET || '') || assertion === env.SESSION_SECRET) {
    return { ok: false, reason: 'assertion_secret_must_be_distinct' };
  }
  return { ok: true };
}

/* The admin cookie carries ONLY a random server-side session id (sid) inside the
 * signed, scoped token. The sid is meaningless without the in-memory record the
 * server created at login (see createAdminSessions): that record is what binds
 * the privilege to ONE base session + user and what logout revokes. */
function createAdminToken(sessionSecret, sid) {
  return createSessionToken(sessionSecret, ADMIN_TTL_SECONDS, ADMIN_SCOPE, sid);
}

/* The sid inside a VERIFIED admin token, '' otherwise (bad signature, expired,
 * wrong scope, or a token minted without a sid). */
function readAdminSid(token, sessionSecret) {
  if (typeof token !== 'string' || token.length === 0) return '';
  return readSessionUser(token, sessionSecret, ADMIN_SCOPE);
}

function verifyAdminToken(token, sessionSecret) {
  return typeof token === 'string' && token.length > 0 && verifySessionToken(token, sessionSecret, ADMIN_SCOPE);
}

/* Identity of the BASE session cookie value, without storing or exposing it:
 * the admin record is bound to this, so the privilege dies with that session
 * (a fresh login mints a different cookie value) and cannot be replayed from
 * another session or browser. */
function sessionBinding(baseToken) {
  if (typeof baseToken !== 'string' || baseToken.length === 0) return '';
  return crypto.createHash('sha256').update('catalog-admin-binding|' + baseToken, 'utf8').digest('hex').slice(0, 40);
}

/* Server-side admin sessions (in memory). Memory-only is deliberate and
 * fail-closed: a restart forgets every record, so every admin cookie becomes
 * useless and Vered simply enters the PIN again. */
function createAdminSessions(opts) {
  const o = Object.assign({ ttlMs: ADMIN_TTL_SECONDS * 1000, max: 50, now: Date.now }, opts || {});
  const records = new Map(); // sid -> { binding, user, exp }
  function sweep() { const t = o.now(); for (const [k, v] of records) if (v.exp <= t) records.delete(k); }
  return {
    create(binding, user) {
      sweep();
      if (!binding || !user) return '';
      for (const [k, v] of records) if (v.binding === binding) records.delete(k); // one admin session per base session
      if (records.size >= o.max) { // oldest out; never grows without bound
        const oldest = [...records.entries()].sort((a, b) => a[1].exp - b[1].exp)[0];
        if (oldest) records.delete(oldest[0]);
      }
      const sid = crypto.randomBytes(24).toString('base64url');
      records.set(sid, { binding, user, exp: o.now() + o.ttlMs });
      return sid;
    },
    valid(sid, binding, user) {
      const r = typeof sid === 'string' && sid ? records.get(sid) : null;
      if (!r || !binding || !user) return false;
      if (r.exp <= o.now()) { records.delete(sid); return false; }
      return r.binding === binding && r.user === user;
    },
    revoke(sid) { return typeof sid === 'string' && records.delete(sid); },
    revokeByBinding(binding) { let n = 0; if (!binding) return n; for (const [k, v] of records) if (v.binding === binding) { records.delete(k); n += 1; } return n; },
    size() { sweep(); return records.size; }
  };
}

function buildAdminCookie(token, isHttps) {
  const parts = [`${ADMIN_COOKIE}=${token}`, 'HttpOnly', 'SameSite=Strict', `Path=${ADMIN_COOKIE_PATH}`, `Max-Age=${ADMIN_TTL_SECONDS}`];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

function buildClearedAdminCookie(isHttps) {
  const parts = [`${ADMIN_COOKIE}=`, 'HttpOnly', 'SameSite=Strict', `Path=${ADMIN_COOKIE_PATH}`, 'Max-Age=0'];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

/* FAILURE-ONLY limiter with three scopes, built so an attacker cannot lock Vered out:
 *   - a correct PIN is never counted, and a success resets that session's counter;
 *   - the PRIMARY cap is per base session (5 wrong PINs): one person's typos or a
 *     colleague's guessing in another session cannot block her session;
 *   - the per-IP cap is deliberately high (30) because the office shares one address;
 *   - a global cap (60 failures / window) is the only thing that can block everyone;
 *     it needs 60 noisy failures, lasts at most one window and is surfaced in the log.
 * Every block carries retryAfterSec so the UI can say when to try again. Memory-only. */
function createFailureLimiter(opts) {
  const o = Object.assign({ sessionMax: 5, ipMax: 30, globalMax: 60, windowMs: 15 * 60 * 1000, now: Date.now }, opts || {});
  const buckets = new Map();
  let global = { count: 0, start: 0 };
  const fresh = (e, t) => e && t - e.start < o.windowMs;
  function bucket(key, t) { let e = buckets.get(key); if (!fresh(e, t)) { e = { count: 0, start: t }; buckets.set(key, e); } return e; }
  return {
    /* { allowed:true } or { allowed:false, scope, retryAfterSec } — does NOT count. */
    check(sessionKey, ipKey) {
      const t = o.now();
      if (!fresh(global, t)) global = { count: 0, start: t };
      const blocks = [
        ['session', bucket('s:' + sessionKey, t), o.sessionMax],
        ['ip', bucket('i:' + ipKey, t), o.ipMax],
        ['global', global, o.globalMax]
      ];
      for (const [scope, e, max] of blocks) {
        if (e.count >= max) return { allowed: false, scope, retryAfterSec: Math.max(1, Math.ceil((e.start + o.windowMs - t) / 1000)) };
      }
      return { allowed: true };
    },
    fail(sessionKey, ipKey) {
      const t = o.now();
      if (!fresh(global, t)) global = { count: 0, start: t };
      bucket('s:' + sessionKey, t).count += 1; bucket('i:' + ipKey, t).count += 1; global.count += 1;
    },
    success(sessionKey) { buckets.delete('s:' + sessionKey); }
  };
}

function verifyAdminPin(submitted, configured) {
  return checkPin(submitted, configured);
}

function pickFields(source, names) {
  const out = {};
  for (const n of names) if (source && Object.prototype.hasOwnProperty.call(source, n) && source[n] !== undefined) out[n] = source[n];
  return out;
}

/* Rebuild the upstream body for an admin op from the allowlist. Returns
 * { error } for a forbidden client field / unknown op, else { action, body }
 * where body holds ONLY allowlisted fields + the server-derived `user`. */
function buildAdminUpstream(op, clientBody, user) {
  if (typeof op !== 'string' || !Object.prototype.hasOwnProperty.call(ADMIN_OPS, op)) return { error: 'unknown_op' };
  const src = clientBody && typeof clientBody === 'object' && !Array.isArray(clientBody) ? clientBody : {};
  for (const k of Object.keys(src)) {
    if (k === 'op') continue;
    if (FORBIDDEN_CLIENT_FIELDS.indexOf(k) >= 0) return { error: 'forbidden_field' };
  }
  const spec = ADMIN_OPS[op];
  const body = pickFields(src, spec.fields);
  if (op === 'saveRow') {
    body.fields = body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields)
      ? pickFields(body.fields, CATALOG_ROW_FIELDS) : {};
  }
  body.user = typeof user === 'string' ? user : '';
  return { action: spec.action, body };
}

/* Mint the v1 assertion. `body` is exactly what will be sent upstream (before
 * proxySecret / adminAssertion / action are attached). */
function signAssertion(action, body, secret, opts) {
  const o = Object.assign({ nowSec: Math.floor(Date.now() / 1000), ttlSec: 60, nonce: crypto.randomBytes(12).toString('base64url') }, opts || {});
  const exp = String(o.nowSec + o.ttlSec);
  const message = 'pkgadmin.v1|' + action + '|' + exp + '|' + o.nonce + '|' +
    crypto.createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex');
  const sig = crypto.createHmac('sha256', secret).update(message, 'utf8').digest('hex');
  return 'v1.' + exp + '.' + o.nonce + '.' + sig;
}

/* Does this action name belong to the package feature (private or manager)?
 * The generic /api/sheets proxy refuses these — they have dedicated routes. */
function isPackageAction(action) {
  const a = String(action == null ? '' : action);
  return /package/i.test(a) || /^admin/i.test(a);
}

module.exports = {
  ADMIN_COOKIE, ADMIN_SCOPE, ADMIN_TTL_SECONDS, ADMIN_COOKIE_PATH, ADMIN_OPS, CATALOG_ROW_FIELDS,
  FORBIDDEN_CLIENT_FIELDS, canonicalJson, adminConfigStatus, createAdminToken, readAdminSid, verifyAdminToken,
  sessionBinding, createAdminSessions, buildAdminCookie, buildClearedAdminCookie, createFailureLimiter, verifyAdminPin, buildAdminUpstream,
  signAssertion, isPackageAction
};
