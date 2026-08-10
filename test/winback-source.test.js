'use strict';

/**
 * Coverage for the shared-secret `getWinbackSource` cross-app endpoint.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * `getWinbackSource` is a read-only endpoint on apps-script/Code.gs, consumed by
 * a sibling E-Zone app (the "caller") to build the win-back call list. It is
 * gated by an optional shared secret (`WINBACK_SECRET` Script Property).
 *
 * Code.gs cannot be imported into the Node runtime (it targets Google Apps
 * Script globals), so — matching the repo convention (see
 * test/treatment-plans.test.js, test/debt-status.test.js) — this file combines:
 *   1. PURE MIRRORS of `_winbackAuthOk` and `_getWinbackSource`, exercised with
 *      the CALLER MOCKED as a plain request-params object (secret present /
 *      absent / wrong). No network, no live Apps Script call.
 *   2. SOURCE-SCAN GUARDS that regex the real Code.gs so the mirrors can't drift
 *      from the deployed logic and so both the GET and POST routes are proven to
 *      run the auth gate BEFORE returning any data.
 *
 * The point of the endpoint is a fail-closed-when-configured auth model plus a
 * minimal projection that never leaks billing/payer fields.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

// The stage/status the backend treats as win-back sources. Mirrors the
// constants in Code.gs; the source-scan guards below assert these stay in sync.
const LOST_LEAD_STAGE_HE = 'לא רלוונטי';
const DISCHARGED_CLIENT_STATUS_HE = 'סיים טיפול';

// --- Pure mirror of _winbackAuthOk ------------------------------------------
// `scriptSecret` stands in for the WINBACK_SECRET Script Property; `params`
// stands in for the caller's request parameters (e.parameter). Empty/undefined
// scriptSecret means the property is not configured → the endpoint is open.
function winbackAuthOk(scriptSecret, params) {
  if (!scriptSecret) return true; // not configured → open
  const got = params && params.secret ? String(params.secret) : '';
  return got === scriptSecret;
}

// --- Pure mirror of _getWinbackSource projection ----------------------------
// Projects lost leads (stage === לא רלוונטי) and discharged clients
// (status === סיים טיפול) into the minimal cross-app shape. Blank fields default
// to '' and NO billing/payer field is ever emitted.
function projectWinbackSource(leads, clients) {
  const lostLeads = (leads || [])
    .filter((l) => l && l.stage === LOST_LEAD_STAGE_HE)
    .map((l) => ({
      sourceApp: 'ezone-outpatient',
      sourceId: l.id,
      name: l.name || '',
      phone: l.phone || '',
      originalService: l.serviceType || '',
      location: l.location || '',
      reasonLeft: l.note || '',
      dateLeft: l.created || '',
      kind: 'lost_lead'
    }));

  const dischargedClients = (clients || [])
    .filter((c) => c && c.status === DISCHARGED_CLIENT_STATUS_HE)
    .map((c) => ({
      sourceApp: 'ezone-outpatient',
      sourceId: c.id,
      name: c.name || '',
      phone: c.phone || '',
      originalService: c.serviceType || '',
      location: c.location || '',
      reasonLeft: c.notes || '',
      dateLeft: c.exitDate || '',
      kind: 'discharged'
    }));

  return { ok: true, lostLeads, dischargedClients };
}

// ============================================================================
// Auth gate — the caller is mocked as a request-params object.
// ============================================================================

test('winback auth: open when the secret is NOT configured (any caller passes)', () => {
  // No WINBACK_SECRET Script Property → URL-only obscurity, same as every other
  // action. A caller with no secret, or any secret, is accepted.
  assert.equal(winbackAuthOk('', { }), true);
  assert.equal(winbackAuthOk('', { secret: 'anything' }), true);
  assert.equal(winbackAuthOk(undefined, undefined), true);
});

test('winback auth: fail-closed when configured and the caller omits the secret', () => {
  assert.equal(winbackAuthOk('s3cret', {}), false);
  assert.equal(winbackAuthOk('s3cret', undefined), false);
  assert.equal(winbackAuthOk('s3cret', { secret: '' }), false);
});

test('winback auth: rejects a caller presenting the WRONG secret', () => {
  assert.equal(winbackAuthOk('s3cret', { secret: 'nope' }), false);
  assert.equal(winbackAuthOk('s3cret', { secret: 's3cret ' }), false); // no trimming
});

test('winback auth: accepts a caller presenting the exact secret', () => {
  assert.equal(winbackAuthOk('s3cret', { secret: 's3cret' }), true);
  // Numeric-looking secret coerced to string on both sides still matches.
  assert.equal(winbackAuthOk('12345', { secret: 12345 }), true);
});

// ============================================================================
// Projection — critical business logic returns the expected values.
// ============================================================================

test('winback projection: lost leads and discharged clients, minimal shape', () => {
  const leads = [
    { id: 'L1', stage: LOST_LEAD_STAGE_HE, name: 'אורי', phone: '0501234567',
      serviceType: 'פרטני', location: 'רעננה', note: 'לא ענה', created: '2026-01-02' },
    { id: 'L2', stage: 'ליד חדש', name: 'still-a-lead' } // not lost → excluded
  ];
  const clients = [
    { id: 'C1', status: DISCHARGED_CLIENT_STATUS_HE, name: 'דנה', phone: '0527654321',
      serviceType: 'קבוצתי', location: 'רמות', notes: 'סיימה', exitDate: '2026-03-15' },
    { id: 'C2', status: 'פעיל', name: 'active-client' } // still active → excluded
  ];

  const out = projectWinbackSource(leads, clients);
  assert.equal(out.ok, true);
  assert.equal(out.lostLeads.length, 1, 'only the lost lead is projected');
  assert.equal(out.dischargedClients.length, 1, 'only the discharged client is projected');

  assert.deepEqual(out.lostLeads[0], {
    sourceApp: 'ezone-outpatient', sourceId: 'L1', name: 'אורי', phone: '0501234567',
    originalService: 'פרטני', location: 'רעננה', reasonLeft: 'לא ענה',
    dateLeft: '2026-01-02', kind: 'lost_lead'
  });
  assert.deepEqual(out.dischargedClients[0], {
    sourceApp: 'ezone-outpatient', sourceId: 'C1', name: 'דנה', phone: '0527654321',
    originalService: 'קבוצתי', location: 'רמות', reasonLeft: 'סיימה',
    dateLeft: '2026-03-15', kind: 'discharged'
  });
});

test('winback projection: never leaks billing/payer fields', () => {
  const out = projectWinbackSource(
    [{ id: 'L1', stage: LOST_LEAD_STAGE_HE, name: 'x', payerPhone: '03-1', pricePerSession: 300 }],
    [{ id: 'C1', status: DISCHARGED_CLIENT_STATUS_HE, name: 'y', payerName: 'הורה', bundlePrice: 1000, paymentLink: 'https://x' }]
  );
  const lead = out.lostLeads[0];
  const client = out.dischargedClients[0];
  ['payerPhone', 'pricePerSession', 'amountDue', 'amountPaid'].forEach((f) => {
    assert.equal(f in lead, false, `lost lead must not expose ${f}`);
  });
  ['payerName', 'bundlePrice', 'paymentLink', 'pricePerSession'].forEach((f) => {
    assert.equal(f in client, false, `discharged client must not expose ${f}`);
  });
});

test('winback projection: blanks default to empty strings, never undefined', () => {
  const out = projectWinbackSource(
    [{ id: 'L1', stage: LOST_LEAD_STAGE_HE }],
    [{ id: 'C1', status: DISCHARGED_CLIENT_STATUS_HE }]
  );
  assert.deepEqual(out.lostLeads[0], {
    sourceApp: 'ezone-outpatient', sourceId: 'L1', name: '', phone: '',
    originalService: '', location: '', reasonLeft: '', dateLeft: '', kind: 'lost_lead'
  });
  assert.deepEqual(out.dischargedClients[0], {
    sourceApp: 'ezone-outpatient', sourceId: 'C1', name: '', phone: '',
    originalService: '', location: '', reasonLeft: '', dateLeft: '', kind: 'discharged'
  });
});

test('winback projection: tolerates null / empty inputs', () => {
  assert.deepEqual(projectWinbackSource(null, null), { ok: true, lostLeads: [], dischargedClients: [] });
  assert.deepEqual(projectWinbackSource([], []), { ok: true, lostLeads: [], dischargedClients: [] });
});

// ============================================================================
// Source-scan guards — lock the deployed Code.gs to the mirrors above.
// ============================================================================

test('Code.gs: win-back source constants match the mirrors', () => {
  assert.match(GS, /var LOST_LEAD_STAGE_HE = 'לא רלוונטי';/);
  assert.match(GS, /var DISCHARGED_CLIENT_STATUS_HE = 'סיים טיפול';/);
});

test('Code.gs: _winbackAuthOk reads WINBACK_SECRET and is open only when unset', () => {
  const m = GS.match(/function _winbackAuthOk\(params\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, '_winbackAuthOk missing');
  const body = m[1];
  assert.match(body, /getProperty\('WINBACK_SECRET'\)/, 'must read the WINBACK_SECRET property');
  assert.match(body, /if \(!expected\) return true;/, 'must be open only when the secret is unset');
  assert.match(body, /return got === expected;/, 'must compare the presented secret for equality');
});

test('Code.gs: doGet gates getWinbackSource — auth BEFORE data', () => {
  const m = GS.match(/if \(action === 'getWinbackSource'\) \{([\s\S]*?)\n    \}/);
  assert.ok(m, 'doGet getWinbackSource branch missing');
  const branch = m[1];
  assert.match(branch, /if \(!_winbackAuthOk\(/, 'GET branch must call _winbackAuthOk');
  // The unauthorized return must appear before the data-returning call.
  const authIdx = branch.indexOf('_winbackAuthOk');
  const dataIdx = branch.indexOf('_getWinbackSource');
  const denyIdx = branch.indexOf("error: 'unauthorized'");
  assert.ok(authIdx >= 0 && denyIdx >= 0 && dataIdx >= 0, 'branch must gate then return data');
  assert.ok(denyIdx < dataIdx, 'unauthorized return must come before _getWinbackSource');
});

test('Code.gs: doPost ALSO gates getWinbackSource, merging a secret from the POST body', () => {
  // Regression: the write path must not be an unauthenticated back door. The
  // POST branch pulls the secret from the JSON body as well as the query params.
  const m = GS.match(/if \(action === 'getWinbackSource'\) \{([\s\S]*?)return _json\(_getWinbackSource\(\)\);/g);
  assert.ok(m && m.length >= 2, 'getWinbackSource must be gated on BOTH doGet and doPost');
  const post = GS.match(/var authParams = \(e && e\.parameter\) \|\| \{\};[\s\S]*?if \(!_winbackAuthOk\(authParams\)\)/);
  assert.ok(post, 'doPost must build authParams and pass them to _winbackAuthOk');
  assert.match(GS, /if \(payload && payload\.secret\) authParams\.secret = payload\.secret;/,
    'doPost must accept the shared secret from the POST body');
});
