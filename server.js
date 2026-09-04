const express = require('express');
const fs = require('fs');
const path = require('path');
const { checkPin } = require('./lib/pin');
const { createSessionToken, verifySessionToken, readSessionUser } = require('./lib/session');
const { SESSION_USERS } = require('./lib/users');

const app = express();
const PORT = process.env.PORT || 3000;
const SHEETS_URL = process.env.SHEETS_URL || '';
const APP_PIN = process.env.APP_PIN || '';
/* Session-cookie signing secret (who/when stamping — port of the Dashboard's
 * PR #113 design). A correct PIN mints an HttpOnly session cookie; every
 * browser-only data route (/api/sheets, /api/continuation-roster, /api/me,
 * /api/debug/*) requires a valid cookie. FAIL-CLOSED: if SESSION_SECRET is
 * unset the server still boots and serves the static app, but
 * /api/verify-pin answers 500 (no cookie can be minted) and the gated routes
 * answer 401 — never open. Set it on the Railway service BEFORE this deploys
 * (Railway variables apply only to deployments started after saving). */
const SESSION_SECRET = process.env.SESSION_SECRET || '';
if (!SESSION_SECRET) {
  console.error('[config] SESSION_SECRET is not set — /api/verify-pin will return 500 and the data routes (/api/sheets, /api/continuation-roster, /api/me, /api/debug/*) will return 401 until it is configured (fail-closed).');
}
const SESSION_COOKIE = 'ezone_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 604800 seconds (7 days), matches the token TTL
// Continuation-track roster proxy: the currently-admitted patient roster is owned
// by the E-Zone DASHBOARD Apps Script (action=getAdmittedRoster) and served
// behind a fail-closed shared secret. We proxy it server-side so the browser
// never sees the dashboard URL or secret. Empty-string defaults → fail closed.
const DASHBOARD_SHEETS_URL = process.env.DASHBOARD_SHEETS_URL || '';
const OCCUPANCY_SECRET = process.env.OCCUPANCY_SECRET || '';
const BUILD = String(Date.now());

if (!APP_PIN) {
  console.warn('APP_PIN env var is not set — /api/verify-pin will reject every attempt.');
}

// --- PIN verification rate limiting ------------------------------------
// In-memory per-IP window: 10 attempts / 15 minutes. Resets on a match.
const PIN_RATE_LIMIT_MAX = 10;
const PIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const pinAttempts = new Map(); // ip -> { count, windowStart }

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}
// ---------------------------------------------------------------------------

// --- Session auth ------------------------------------------------------------
// A correct PIN (POST /api/verify-pin) mints a signed HttpOnly cookie; every
// browser-only data route requires it. No cookie-parser dependency — the one
// cookie we read is pulled from the raw header. Cross-app consumers
// (therapists / dashboard) never call this server: they POST/GET the Apps
// Script /exec URL directly with their shared secrets, so nothing here needs
// an ungated bypass (verified in Phase 1 — see CHANGELOG-session-who-when.md).

/* Extract a named cookie's value from a Cookie header, or '' if absent. */
function parseCookieValue(cookieHeader, name) {
  if (typeof cookieHeader !== 'string' || !cookieHeader) return '';
  const parts = cookieHeader.split(';');
  const prefix = name + '=';
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (p.indexOf(prefix) === 0) return p.slice(prefix.length);
  }
  return '';
}

/* Extract the session token from a Cookie header, or '' if absent. */
function parseSessionCookie(cookieHeader) {
  return parseCookieValue(cookieHeader, SESSION_COOKIE);
}

/* Pure auth decision, so every branch is unit-testable with an explicit secret:
 *   'not_configured' → SESSION_SECRET unset (fail-closed → 401)
 *   'ok'             → a valid, unexpired, correctly-signed cookie is present
 *   'unauthorized'   → missing / malformed / tampered / expired cookie (→ 401) */
function sessionAuthStatus(cookieHeader, secret) {
  if (typeof secret !== 'string' || secret.length === 0) return 'not_configured';
  const token = parseSessionCookie(cookieHeader);
  if (token && verifySessionToken(token, secret)) return 'ok';
  return 'unauthorized';
}

/* Normalize the optional user name a login may attach to its session
 * (who/when stamping): trim, strip control characters and angle brackets
 * (defense-in-depth against a name ever being interpolated into HTML), cap
 * at 40 characters. Hebrew names with quotes (ד"ר …) survive. '' (no
 * name) is always allowed — the cookie then keeps the legacy user-less
 * format and everything behaves exactly as before. */
function sanitizeSessionUser(raw) {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
}

/* The `user` a login may embed in its session cookie: sanitized, then
 * accepted ONLY if it is one of the fixed SESSION_USERS names (the same
 * three names as the leads assignedTo dropdown). Anything else — unknown
 * name, free text, empty — returns '' and the cookie stays user-less, so
 * updatedBy can never carry an arbitrary string. */
function validateSessionUser(raw) {
  const user = sanitizeSessionUser(raw);
  return SESSION_USERS.indexOf(user) >= 0 ? user : '';
}

/* The user name embedded in the request's VERIFIED session cookie, '' when
 * the cookie is a legacy user-less token (or absent/invalid — callers behind
 * requireSession never see that case). This — never a client-supplied body
 * field — is the only source of the `user` the sheets proxy forwards. */
function sessionUserFromRequest(req) {
  if (!SESSION_SECRET) return '';
  return readSessionUser(parseSessionCookie(req.headers.cookie), SESSION_SECRET);
}

/* Express middleware guarding the browser-only data routes. Fail-closed: an
 * unset SESSION_SECRET and a missing/invalid cookie BOTH yield 401 (the
 * client's one 401 handler sends the user back to the PIN screen either
 * way; the operator sees the boot-time log line). */
function requireSession(req, res, next) {
  const status = sessionAuthStatus(req.headers.cookie, SESSION_SECRET);
  if (status !== 'ok') {
    return res.status(401).json({
      ok: false,
      error: status === 'not_configured' ? 'session_not_configured' : 'unauthorized'
    });
  }
  return next();
}

/* Whether the ORIGINAL client request reached us over HTTPS. Railway terminates
 * TLS and forwards x-forwarded-proto=https; plain-HTTP localhost dev has neither,
 * so the Secure attribute is omitted there (a Secure cookie would never be sent
 * back over http and would break local dev). */
function requestIsHttps(req) {
  return req.headers['x-forwarded-proto'] === 'https' || req.secure === true;
}

/* Build the Set-Cookie value for a freshly-minted session token. SameSite=Lax
 * (per the outpatient brief): the cookie rides same-site fetches and
 * top-level navigations, never cross-site POSTs. */
function buildSessionCookie(token, isHttps) {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE}`
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

/* Set-Cookie value that expires the session cookie immediately (logout). */
function buildClearedSessionCookie(isHttps) {
  const parts = [
    `${SESSION_COOKIE}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0'
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}
// ---------------------------------------------------------------------------

// --- Cache config -----------------------------------------------------------
// Caches the slow `getData` bulk read from Apps Script in memory.
// Writes (POST) automatically invalidate the cache so saves are reflected.
// Pass ?fresh=1 to force a live fetch and refresh the cache.
const CACHE_TTL_MS = 60 * 1000;          // 60 seconds
const STALE_FALLBACK_MS = 10 * 60 * 1000; // serve stale up to 10 min if upstream fails
const getDataCache = {
  data: null,
  status: null,
  timestamp: 0
};
function isCacheFresh() {
  return getDataCache.data && (Date.now() - getDataCache.timestamp) < CACHE_TTL_MS;
}
function isCacheStaleButUsable() {
  return getDataCache.data && (Date.now() - getDataCache.timestamp) < STALE_FALLBACK_MS;
}
function invalidateCache() {
  getDataCache.data = null;
  getDataCache.status = null;
  getDataCache.timestamp = 0;
}
// ---------------------------------------------------------------------------

app.use(express.json({ limit: '2mb' }));

const INDEX_PATH = path.join(__dirname, 'public', 'index.html');
function sendIndex(res) {
  fs.readFile(INDEX_PATH, 'utf8', (err, html) => {
    if (err) return res.status(500).send('index load error');
    res.set('Cache-Control', 'no-store');
    res.type('html').send(html.replace(/__BUILD__/g, BUILD));
  });
}
app.get('/', (req, res) => sendIndex(res));
app.get('/index.html', (req, res) => sendIndex(res));

app.use(express.static(path.join(__dirname, 'public')));

const lastLoad = {
  at: null,
  status: null,
  leads: 0,
  clients: 0,
  error: null
};

function requireSheetsUrl(res) {
  if (!SHEETS_URL) {
    res.status(500).json({
      ok: false,
      error: 'SHEETS_URL env var is not configured on the server.'
    });
    return false;
  }
  return true;
}

// Fail closed: the roster carries patient names + phones (PII) and the dashboard
// endpoint requires the secret, so refuse unless BOTH the URL and the secret are
// configured. Never leak the secret — the message names only which vars.
function requireContinuationConfig(res) {
  if (!DASHBOARD_SHEETS_URL || !OCCUPANCY_SECRET) {
    res.status(500).json({
      ok: false,
      error: 'Continuation roster proxy is not configured: DASHBOARD_SHEETS_URL and OCCUPANCY_SECRET must both be set.'
    });
    return false;
  }
  return true;
}

// --- Continuation-roster cache ---------------------------------------------
// The roster is a slow cross-app round-trip and changes at most a few times a
// day (admissions/releases). A short in-memory cache (<=60s) keeps the tab
// snappy without going stale; ?fresh=1 forces a live fetch.
const ROSTER_CACHE_TTL_MS = 60 * 1000;
const rosterCache = { data: null, status: null, timestamp: 0 };

app.get('/api/sheets', requireSession, async (req, res) => {
  if (!requireSheetsUrl(res)) return;

  const action = (req.query && req.query.action) || 'getData';
  const forceFresh = req.query && (req.query.fresh === '1' || req.query.fresh === 'true');

  // Serve from cache when possible: only for the bulk read, and only when
  // the caller hasn't explicitly asked for a fresh fetch.
  if (action === 'getData' && !forceFresh && isCacheFresh()) {
    res.set('X-Cache', 'HIT');
    return res.status(getDataCache.status || 200).json(getDataCache.data);
  }

  try {
    const url = SHEETS_URL
      + (SHEETS_URL.includes('?') ? '&' : '?')
      + 'action=' + encodeURIComponent(action)
      + (req.query.secret ? '&secret=' + encodeURIComponent(req.query.secret) : '');
    const r = await fetch(url, { redirect: 'follow' });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) { throw new Error('Non-JSON from Apps Script: ' + text.slice(0, 200)); }

    // Track load metrics + populate cache only on the bulk read.
    if (action === 'getData') {
      lastLoad.at = new Date().toISOString();
      lastLoad.status = r.status;
      lastLoad.leads = Array.isArray(data.leads) ? data.leads.length : 0;
      lastLoad.clients = Array.isArray(data.clients) ? data.clients.length : 0;
      lastLoad.error = data.ok === false ? (data.error || 'unknown') : null;

      // Only cache successful responses
      if (r.status >= 200 && r.status < 300 && data.ok !== false) {
        getDataCache.data = data;
        getDataCache.status = r.status;
        getDataCache.timestamp = Date.now();
      }
    }

    res.set('X-Cache', 'MISS');
    res.status(r.status).json(data);
  } catch (err) {
    lastLoad.at = new Date().toISOString();
    lastLoad.status = 'error';
    lastLoad.error = String(err);

    // Graceful degradation: if Apps Script fails on a getData call but we
    // still have a recent-ish cached copy, serve that instead of erroring.
    if (action === 'getData' && isCacheStaleButUsable()) {
      res.set('X-Cache', 'STALE');
      res.set('X-Cache-Error', String(err).slice(0, 200));
      return res.status(getDataCache.status || 200).json(getDataCache.data);
    }

    res.status(502).json({ ok: false, error: String(err) });
  }
});

app.post('/api/sheets', requireSession, async (req, res) => {
  if (!requireSheetsUrl(res)) return;
  try {
    // Pass through whatever action the client asked for. saveAll is the
    // legacy default (back when the client couldn't pick an action) so
    // requests without an explicit action keep working.
    const body = Object.assign({ action: 'saveAll' }, req.body || {});
    if (body.action === 'saveAll') {
      body.leads   = Array.isArray(req.body?.leads)   ? req.body.leads   : [];
      body.clients = Array.isArray(req.body?.clients) ? req.body.clients : [];
    }
    // Who/when stamping: the `user` the Apps Script writes into updatedBy
    // comes ONLY from the signed session cookie. ALWAYS overwritten — a
    // client-supplied body.user is never trusted; '' (legacy user-less
    // cookie) is forwarded as-is and stamps blank, which is allowed by
    // contract.
    body.user = sessionUserFromRequest(req);
    const r = await fetch(SHEETS_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) { throw new Error('Non-JSON from Apps Script: ' + text.slice(0, 200)); }

    // Any successful write invalidates the cache so the next read is fresh.
    if (r.status >= 200 && r.status < 300 && data.ok !== false) {
      invalidateCache();
    }

    res.status(r.status).json(data);
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err) });
  }
});

// GET /api/continuation-roster — proxy the dashboard's getAdmittedRoster behind
// the server-held secret. The continuation WORKFLOW rows themselves go through
// the existing /api/sheets path (getContinuation / saveContinuation), NOT here.
app.get('/api/continuation-roster', requireSession, async (req, res) => {
  if (!requireContinuationConfig(res)) return;

  const forceFresh = req.query && (req.query.fresh === '1' || req.query.fresh === 'true');
  if (!forceFresh && rosterCache.data && (Date.now() - rosterCache.timestamp) < ROSTER_CACHE_TTL_MS) {
    res.set('X-Cache', 'HIT');
    return res.status(rosterCache.status || 200).json(rosterCache.data);
  }

  try {
    const url = DASHBOARD_SHEETS_URL
      + (DASHBOARD_SHEETS_URL.includes('?') ? '&' : '?')
      + 'action=getAdmittedRoster'
      + '&secret=' + encodeURIComponent(OCCUPANCY_SECRET);
    const r = await fetch(url, { redirect: 'follow' });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) { throw new Error('Non-JSON from dashboard roster: ' + text.slice(0, 200)); }

    if (r.status >= 200 && r.status < 300 && data.ok !== false) {
      rosterCache.data = data;
      rosterCache.status = r.status;
      rosterCache.timestamp = Date.now();
    }

    res.set('X-Cache', 'MISS');
    res.status(r.status).json(data);
  } catch (err) {
    res.status(502).json({ ok: false, error: String(err.message || err) });
  }
});

app.post('/api/verify-pin', (req, res) => {
  const ip = getClientIp(req);
  const now = Date.now();

  let entry = pinAttempts.get(ip);
  if (!entry || now - entry.windowStart >= PIN_RATE_LIMIT_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    pinAttempts.set(ip, entry);
  }

  if (entry.count >= PIN_RATE_LIMIT_MAX) {
    return res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
  }

  const submitted = req.body && req.body.pin;
  if (checkPin(submitted, APP_PIN)) {
    pinAttempts.delete(ip);
    /* Mint the session cookie so subsequent data requests are authorized.
     * FAIL-CLOSED: without SESSION_SECRET no cookie can be minted, so the
     * login is refused with a clear 500 (an operator problem, logged
     * server-side) rather than a "success" that leads nowhere. */
    if (!SESSION_SECRET) {
      console.error('[verify-pin] correct PIN but SESSION_SECRET is not set — cannot mint a session cookie (fail-closed). Set SESSION_SECRET on the Railway service and redeploy.');
      return res.status(500).json({ ok: false, error: 'session_not_configured' });
    }
    // Optional `user` (who/when stamping): a display name the login may
    // attach — accepted ONLY from the fixed SESSION_USERS list (the leads
    // assignedTo names); anything else falls back to the legacy user-less
    // token. It rides INSIDE the signed token so it cannot be changed
    // without breaking the HMAC. The name picker re-posts {pin, user} right
    // after a user-less login: the cookie is simply re-issued with the same
    // 7-day TTL (SESSION_MAX_AGE) — never extended, never a second cookie.
    const user = validateSessionUser(req.body && req.body.user);
    const token = createSessionToken(SESSION_SECRET, undefined, undefined, user);
    res.set('Set-Cookie', buildSessionCookie(token, requestIsHttps(req)));
    return res.status(200).json({ ok: true });
  }

  entry.count += 1;
  return res.status(401).json({ ok: false, error: 'Incorrect PIN.' });
});

/* GET /api/me — the display name embedded in this session's signed cookie
 * (who/when stamping). Session-gated like every data route; a legacy
 * user-less cookie answers { user: '' } and everything keeps working. The
 * frontend reads it after the PIN (empty -> name picker) and at load (header
 * "מחובר/ת כ: <name>"). */
app.get('/api/me', requireSession, (req, res) => {
  res.status(200).json({ ok: true, user: sessionUserFromRequest(req) });
});

/* GET /api/users — the fixed list of names the login name picker offers
 * (lib/users.js SESSION_USERS, the same list /api/verify-pin accepts a
 * `user` from), so the client never carries a duplicate that could drift.
 * Session-gated: the picker only appears after a correct PIN minted the
 * cookie, and the names are staff, not public. Read-only, no input. */
app.get('/api/users', requireSession, (req, res) => {
  res.status(200).json({ ok: true, users: SESSION_USERS.slice() });
});

/* POST /api/logout — expire the session cookie immediately. Open route:
 * clearing a credential never needs one. The existing יציאה button calls it
 * (fire-and-forget) before showing the PIN screen, so a shared device does
 * not keep a live 7-day cookie after logout. */
app.post('/api/logout', (req, res) => {
  res.set('Set-Cookie', buildClearedSessionCookie(requestIsHttps(req)));
  res.status(200).json({ ok: true });
});

// Debug endpoints are browser-only operator surfaces (they reveal config
// flags, row counts and the route table) — session-gated like the data routes.
app.use('/api/debug', requireSession);

app.get('/api/debug/env', (req, res) => {
  res.json({
    ok: true,
    node: process.version,
    port: PORT,
    sheetsUrlConfigured: !!SHEETS_URL,
    sheetsUrlHost: SHEETS_URL ? new URL(SHEETS_URL).host : null
  });
});

app.get('/api/debug/routes', (req, res) => {
  const routes = [];
  app._router.stack.forEach((m) => {
    if (m.route) {
      const methods = Object.keys(m.route.methods).map((x) => x.toUpperCase());
      routes.push({ path: m.route.path, methods });
    }
  });
  res.json({ ok: true, routes });
});

app.get('/api/debug/last-load', (req, res) => {
  res.json({ ok: true, lastLoad });
});

app.get('/api/debug/cache', (req, res) => {
  const ageMs = getDataCache.timestamp ? Date.now() - getDataCache.timestamp : null;
  res.json({
    ok: true,
    cached: !!getDataCache.data,
    ageMs,
    ttlMs: CACHE_TTL_MS,
    fresh: isCacheFresh(),
    staleButUsable: !isCacheFresh() && isCacheStaleButUsable(),
    leads: getDataCache.data && Array.isArray(getDataCache.data.leads) ? getDataCache.data.leads.length : 0,
    clients: getDataCache.data && Array.isArray(getDataCache.data.clients) ? getDataCache.data.clients.length : 0
  });
});

// Manually clear the cache (handy for debugging)
app.post('/api/debug/cache/clear', (req, res) => {
  invalidateCache();
  res.json({ ok: true, cleared: true });
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.get('*', (req, res) => sendIndex(res));

// Start only when run directly (`node server.js`). When required by a test the
// app is exported instead, so the test owns the server lifecycle and the test
// runner can exit cleanly instead of hanging on a listening socket.
function start(port) {
  return app.listen(port || PORT, () => {
    console.log(`E-ZONE Outpatient listening on :${port || PORT}`);
    console.log(`SHEETS_URL configured: ${!!SHEETS_URL}`);
    console.log(`SESSION_SECRET configured: ${!!SESSION_SECRET}`);
    console.log(`DASHBOARD_SHEETS_URL configured: ${!!DASHBOARD_SHEETS_URL}`);
    console.log(`OCCUPANCY_SECRET configured: ${!!OCCUPANCY_SECRET}`);
    console.log(`Cache TTL: ${CACHE_TTL_MS}ms, stale fallback: ${STALE_FALLBACK_MS}ms`);
  });
}

if (require.main === module) {
  start();
}

module.exports = app;
module.exports.start = start;
// Session-auth helpers, exported for unit tests (pure functions + middleware).
module.exports.parseSessionCookie = parseSessionCookie;
module.exports.sessionAuthStatus = sessionAuthStatus;
module.exports.sanitizeSessionUser = sanitizeSessionUser;
module.exports.validateSessionUser = validateSessionUser;
module.exports.sessionUserFromRequest = sessionUserFromRequest;
module.exports.requireSession = requireSession;
module.exports.requestIsHttps = requestIsHttps;
module.exports.buildSessionCookie = buildSessionCookie;
module.exports.buildClearedSessionCookie = buildClearedSessionCookie;
module.exports.SESSION_COOKIE = SESSION_COOKIE;
