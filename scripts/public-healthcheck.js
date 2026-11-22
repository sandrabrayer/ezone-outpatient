'use strict';

/**
 * Public-only E-ZONE Outpatient weekly availability probe.
 *
 * NEVER log in, use APP_PIN/SESSION_SECRET, follow spreadsheet URLs, or request
 * patient, finance, staff, source-app, or protected application endpoints.
 * This replaces the old scheduled data-bearing healthcheck; patient financial
 * integrity belongs in source-side, scoped operational reconciliation.
 *
 * Only GET /, GET /api/version and GET /healthz on one configured HTTPS host.
 * Logs only the release commit and overall success/failure. The response bodies
 * are never logged. All three requests have bounded response sizes and timeouts.
 */
const DEFAULT_URL = 'https://ezone-outpatient.up.railway.app';
const ALLOWED_PATHS = Object.freeze(['/', '/api/version', '/healthz']);
const VERSION_RE = /^[a-f0-9]{40}$/;
const MAX_BYTES = 32768;

function configuredOrigin(env) {
  const value = String((env && env.APP_URL) || DEFAULT_URL);
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/') {
    throw new Error('APP_URL must be a bare HTTPS origin');
  }
  return url.origin;
}

async function readPublic(fetcher, origin, pathname) {
  if (!ALLOWED_PATHS.includes(pathname)) throw new Error('endpoint_not_allowed');
  const response = await fetcher(origin + pathname, {
    method: 'GET',
    redirect: 'error',
    cache: 'no-store',
    headers: { Accept: pathname === '/' ? 'text/html' : 'application/json' },
    signal: AbortSignal.timeout(12000)
  });
  if (response.status !== 200) throw new Error(pathname + ': HTTP ' + response.status);
  const length = Number(response.headers && response.headers.get && response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BYTES) throw new Error(pathname + ': response_too_large');
  const content = await response.text();
  if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) throw new Error(pathname + ': response_too_large');
  return pathname === '/' ? content : JSON.parse(content);
}

async function checkPublic(opts) {
  opts = opts || {};
  const origin = configuredOrigin(opts.env || process.env);
  const fetcher = opts.fetcher || fetch;
  const version = await readPublic(fetcher, origin, '/api/version');
  const health = await readPublic(fetcher, origin, '/healthz');
  const html = await readPublic(fetcher, origin, '/');
  if (!version || !VERSION_RE.test(String(version.commit || ''))) throw new Error('version: invalid_commit');
  if (!health || health.ok !== true) throw new Error('healthz: not_ready');
  if (typeof html !== 'string' || !html.includes('E-ZONE Outpatient')) throw new Error('shell: marker_missing');
  // Intentionally no counts, user identifiers, responses or private field names.
  return { ok: true, commit: version.commit, checks: 3, publicOnly: true };
}

if (require.main === module) {
  checkPublic().then(
    result => console.log('PUBLIC_HEALTHCHECK_PASS commit=' + result.commit + ' endpoints=' + result.checks),
    error => { console.error('PUBLIC_HEALTHCHECK_FAIL ' + String(error && error.message || 'unknown')); process.exitCode = 1; }
  );
}

module.exports = { configuredOrigin, readPublic, checkPublic, ALLOWED_PATHS };
