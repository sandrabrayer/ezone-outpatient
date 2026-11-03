'use strict';

/* Backend capability gate for the Node-first deploy window (OP-CRM-3A).
 *
 * Railway deploys the Node proxy on merge; the Apps Script source is released
 * in a SECOND, explicit phase (DEPLOY.md). Between the two, this Node strips
 * money from an operational ('ops') session and stamps `moneyScope:'ops'` on
 * its writes — but the OLD Code.gs ignores that field, so a full-row saveAll
 * from such a session would write the stripped fields (0 / blank) over every
 * client row. The proxy therefore refuses an ops full-row write until the
 * backend reports `capabilities.moneyScope === true` (Code.gs
 * `getCapabilities`, gated by OUTPATIENT_PROXY_SECRET).
 *
 * Fail closed: unknown, malformed, unauthorized, or unreachable -> not ready.
 * A positive answer is cached briefly in memory; a negative one is never
 * cached (the next request probes again). No persistent state. */

const POSITIVE_TTL_MS = 5 * 60 * 1000;

/* Write actions from the browser that rewrite whole rows, so a stripped
 * payload would destroy stored money. Partial / keyed writes (setPreferredHouse,
 * createStopAlert, CRM tasks …) never carry money and are not gated. */
const FULL_ROW_WRITE_ACTIONS = Object.freeze(['saveAll']);
function isFullRowWrite(action) { return FULL_ROW_WRITE_ACTIONS.indexOf(String(action == null ? '' : action)) >= 0; }

/* Pure: does an upstream reply prove the capability? */
function hasMoneyScopeCapability(data) {
  return !!(data && typeof data === 'object' && data.ok === true &&
    data.capabilities && typeof data.capabilities === 'object' &&
    data.capabilities.moneyScope === true);
}

function createGate(opts) {
  const o = opts || {};
  const fetchFn = o.fetch || ((...a) => fetch(...a));
  const now = o.now || (() => Date.now());
  const ttl = typeof o.ttlMs === 'number' ? o.ttlMs : POSITIVE_TTL_MS;
  let readyUntil = 0;

  function probeUrl() {
    const base = o.sheetsUrl || '';
    return base + (base.includes('?') ? '&' : '?')
      + 'action=getCapabilities'
      + '&proxySecret=' + encodeURIComponent(o.proxySecret || '');
  }

  /* Resolves true only on a verified positive answer; never throws. */
  async function isReady() {
    if (readyUntil > now()) return true;
    if (!o.sheetsUrl || !o.proxySecret) return false;
    try {
      const r = await fetchFn(probeUrl(), { redirect: 'follow' });
      if (!r || r.status < 200 || r.status >= 300) return false;
      let data;
      try { data = JSON.parse(await r.text()); } catch (_) { return false; }
      if (!hasMoneyScopeCapability(data)) return false;
      readyUntil = now() + ttl;
      return true;
    } catch (_) {
      return false;
    }
  }
  function reset() { readyUntil = 0; }
  return { isReady, reset, probeUrl };
}

module.exports = {
  POSITIVE_TTL_MS, FULL_ROW_WRITE_ACTIONS,
  isFullRowWrite, hasMoneyScopeCapability, createGate
};
