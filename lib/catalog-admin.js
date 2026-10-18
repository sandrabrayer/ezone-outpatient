'use strict';

/* Vered-only authorization for the package catalog / pricing requests.
 *
 * WHY A SEPARATE PRIVILEGE: the app has ONE shared APP_PIN, a display name
 * picked from a list, and a sessionStorage editor/viewer flag — none of which
 * can prove "this is Vered". Prices must be visible and editable by her only,
 * so the server verifies a second, independent secret (CATALOG_ADMIN_PIN) and
 * mints a SHORT-LIVED, scoped, signed HttpOnly cookie. A display name or any
 * browser value grants nothing.
 *
 * Apps Script must not trust Node blindly either: every admin call carries a
 * short-lived HMAC assertion (CATALOG_ADMIN_ASSERTION_SECRET, shared with a
 * Script Property of the same name) bound to the action, an expiry, a nonce
 * and a hash of the exact request body — see _pkgAdminAssertionOk in Code.gs.
 *
 * Nothing in this file holds a price or a secret value. */

const crypto = require('crypto');
const { createSessionToken, verifySessionToken } = require('./session');
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
  const pin = env.CATALOG_ADMIN_PIN || '';
  const assertion = env.CATALOG_ADMIN_ASSERTION_SECRET || '';
  if (!env.SESSION_SECRET) return { ok: false, reason: 'session_not_configured' };
  if (pin.length < 6 || pin.length > 12) return { ok: false, reason: 'pin_not_configured' };
  if (pin === (env.APP_PIN || '')) return { ok: false, reason: 'pin_must_differ_from_app_pin' };
  if (assertion.trim().length < 32) return { ok: false, reason: 'assertion_secret_not_configured' };
  if (assertion === (env.OUTPATIENT_PROXY_SECRET || '') || assertion === env.SESSION_SECRET) {
    return { ok: false, reason: 'assertion_secret_must_be_distinct' };
  }
  return { ok: true };
}

function createAdminToken(sessionSecret) {
  return createSessionToken(sessionSecret, ADMIN_TTL_SECONDS, ADMIN_SCOPE);
}

function verifyAdminToken(token, sessionSecret) {
  return typeof token === 'string' && token.length > 0 && verifySessionToken(token, sessionSecret, ADMIN_SCOPE);
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

/* Sliding-window attempt limiter: per-key AND a global cap, so a distributed
 * guesser cannot multiply the per-IP budget. */
function createLimiter(opts) {
  const o = Object.assign({ perKeyMax: 5, globalMax: 25, windowMs: 15 * 60 * 1000, now: Date.now }, opts || {});
  const perKey = new Map();
  let global = { count: 0, start: 0 };
  function fresh(entry, t) { return entry && t - entry.start < o.windowMs; }
  return {
    /* true = the attempt may proceed (and is counted). */
    attempt(key) {
      const t = o.now();
      if (!fresh(global, t)) global = { count: 0, start: t };
      let e = perKey.get(key);
      if (!fresh(e, t)) { e = { count: 0, start: t }; perKey.set(key, e); }
      if (e.count >= o.perKeyMax || global.count >= o.globalMax) return false;
      e.count += 1; global.count += 1;
      return true;
    },
    reset(key) { perKey.delete(key); }
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
  FORBIDDEN_CLIENT_FIELDS, canonicalJson, adminConfigStatus, createAdminToken, verifyAdminToken,
  buildAdminCookie, buildClearedAdminCookie, createLimiter, verifyAdminPin, buildAdminUpstream,
  signAssertion, isPackageAction
};
