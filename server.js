const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SHEETS_URL = process.env.SHEETS_URL || '';
const BUILD = String(Date.now());

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

app.get('/api/sheets', async (req, res) => {
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
    const url = SHEETS_URL + (SHEETS_URL.includes('?') ? '&' : '?') + 'action=' + encodeURIComponent(action);
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

app.post('/api/sheets', async (req, res) => {
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

app.listen(PORT, () => {
  console.log(`E-ZONE Outpatient listening on :${PORT}`);
  console.log(`SHEETS_URL configured: ${!!SHEETS_URL}`);
  console.log(`Cache TTL: ${CACHE_TTL_MS}ms, stale fallback: ${STALE_FALLBACK_MS}ms`);
});
