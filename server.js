const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SHEETS_URL = process.env.SHEETS_URL || '';
const BUILD = String(Date.now());

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
  try {
    const action = (req.query && req.query.action) || 'getData';
    const url = SHEETS_URL + (SHEETS_URL.includes('?') ? '&' : '?') + 'action=' + encodeURIComponent(action);
    const r = await fetch(url, { redirect: 'follow' });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); }
    catch (_) { throw new Error('Non-JSON from Apps Script: ' + text.slice(0, 200)); }
    // Track load metrics only on the bulk read so they stay meaningful.
    if (action === 'getData') {
      lastLoad.at = new Date().toISOString();
      lastLoad.status = r.status;
      lastLoad.leads = Array.isArray(data.leads) ? data.leads.length : 0;
      lastLoad.clients = Array.isArray(data.clients) ? data.clients.length : 0;
      lastLoad.error = data.ok === false ? (data.error || 'unknown') : null;
    }
    res.status(r.status).json(data);
  } catch (err) {
    lastLoad.at = new Date().toISOString();
    lastLoad.status = 'error';
    lastLoad.error = String(err);
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

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.get('*', (req, res) => sendIndex(res));

app.listen(PORT, () => {
  console.log(`E-ZONE Outpatient listening on :${PORT}`);
  console.log(`SHEETS_URL configured: ${!!SHEETS_URL}`);
});
