'use strict';

/**
 * Unit coverage for the SHARED-SECRET getWinbackSource endpoint in
 * apps-script/Code.gs (`_winbackAuthOk` + `_getWinbackSource`) — the cross-app
 * read consumed by the win-back workflow.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Code.gs is Google Apps Script and cannot be imported in the Node runtime, so
 * the pure logic below MIRRORS Code.gs. Any change to `_winbackAuthOk`,
 * `_getWinbackSource`, LOST_LEAD_STAGE_HE or DISCHARGED_CLIENT_STATUS_HE in
 * Code.gs must be mirrored here. Contract being locked:
 *   - auth reuses the 'WINBACK_SECRET' Script Property. Absent/empty property
 *     => endpoint is OPEN (URL-only obscurity, matching Code.gs). A configured
 *     secret => a request must pass a matching ?secret / payload.secret.
 *   - the caller is MOCKED: we pass the same param objects doGet(e.parameter) /
 *     doPost(payload) hand to the endpoint. No live Apps Script call is made.
 *   - projection: Leads at stage LOST_LEAD_STAGE_HE and Clients at status
 *     DISCHARGED_CLIENT_STATUS_HE map to the win-back row shape; every other row
 *     is excluded; empty inputs never crash.
 *
 * No real secret is used anywhere — 'winback-secret-dummy' is a test fixture.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// --- pure mirror of Code.gs --------------------------------------------------
const LOST_LEAD_STAGE_HE = 'לא רלוונטי';
const DISCHARGED_CLIENT_STATUS_HE = 'סיים טיפול';

// Mirror of _winbackAuthOk. `configuredSecret` stands in for the
// 'WINBACK_SECRET' Script Property (null/'' when the property is absent).
function winbackAuthOk(configuredSecret, params) {
  const expected = configuredSecret;
  if (!expected) return true; // not configured -> open
  const got = (params && params.secret) ? String(params.secret) : '';
  return got === expected;
}

// Mirror of _getWinbackSource operating on in-memory Leads/Clients arrays
// instead of the live sheets (_readAll).
function getWinbackSource(leads, clients) {
  const lostLeads = [];
  (leads || []).forEach((l) => {
    if (l.stage !== LOST_LEAD_STAGE_HE) return;
    lostLeads.push({
      sourceApp: 'ezone-outpatient',
      sourceId: l.id,
      name: l.name || '',
      phone: l.phone || '',
      originalService: l.serviceType || '',
      location: l.location || '',
      reasonLeft: l.note || '',
      dateLeft: l.created || '',
      kind: 'lost_lead'
    });
  });

  const dischargedClients = [];
  (clients || []).forEach((c) => {
    if (c.status !== DISCHARGED_CLIENT_STATUS_HE) return;
    dischargedClients.push({
      sourceApp: 'ezone-outpatient',
      sourceId: c.id,
      name: c.name || '',
      phone: c.phone || '',
      originalService: c.serviceType || '',
      location: c.location || '',
      reasonLeft: c.notes || '',
      dateLeft: c.exitDate || '',
      kind: 'discharged'
    });
  });

  return { ok: true, lostLeads, dischargedClients };
}

// Mirror of the doGet/doPost dispatch for action=getWinbackSource: auth-gate,
// then project. `params` is the mocked caller's param object.
function handleGetWinbackSource(configuredSecret, params, leads, clients) {
  if (!winbackAuthOk(configuredSecret, params)) {
    return { ok: false, error: 'unauthorized' };
  }
  return getWinbackSource(leads, clients);
}
// ---------------------------------------------------------------------------

const SECRET = 'winback-secret-dummy';

// --- auth: unconfigured (open) ---------------------------------------------

test('auth is OPEN when the WINBACK_SECRET property is absent', () => {
  assert.equal(winbackAuthOk(null, {}), true);
  assert.equal(winbackAuthOk('', { secret: 'anything' }), true);
  assert.equal(winbackAuthOk(undefined, undefined), true);
});

// --- auth: configured (fail-closed on mismatch) ----------------------------

test('a configured secret blocks a request with no secret', () => {
  assert.equal(winbackAuthOk(SECRET, {}), false);
  assert.equal(winbackAuthOk(SECRET, { secret: '' }), false);
  assert.equal(winbackAuthOk(SECRET, undefined), false);
});

test('a configured secret blocks a request with the WRONG secret', () => {
  assert.equal(winbackAuthOk(SECRET, { secret: 'nope' }), false);
  assert.equal(winbackAuthOk(SECRET, { secret: SECRET + 'x' }), false);
});

test('a configured secret accepts the matching secret (GET param or POST payload)', () => {
  assert.equal(winbackAuthOk(SECRET, { secret: SECRET }), true);
  // POST path folds payload.secret into the same params object -> same check.
  assert.equal(winbackAuthOk(SECRET, { secret: String(SECRET) }), true);
});

test('endpoint returns unauthorized (not data) when auth fails, even with data present', () => {
  const res = handleGetWinbackSource(SECRET, { secret: 'wrong' },
    [{ id: 'l1', name: 'x', stage: LOST_LEAD_STAGE_HE }], []);
  assert.deepEqual(res, { ok: false, error: 'unauthorized' });
});

// --- projection ------------------------------------------------------------

test('projects lost leads and discharged clients into the win-back shape', () => {
  const leads = [
    { id: 'l1', name: 'אורי', phone: '0501234567', serviceType: 'פרטני',
      location: 'רמות', note: 'לא ענה', created: '2026-01-05', stage: LOST_LEAD_STAGE_HE },
    { id: 'l2', name: 'פעיל', stage: 'שיחה ראשונה' } // not lost -> excluded
  ];
  const clients = [
    { id: 'c1', name: 'דנה', phone: '0527654321', serviceType: 'קבוצתי',
      location: 'רעננה', notes: 'סיימה', exitDate: '2026-03-01', status: DISCHARGED_CLIENT_STATUS_HE },
    { id: 'c2', name: 'ממשיך', status: 'בטיפול' } // active -> excluded
  ];

  const res = handleGetWinbackSource(null, {}, leads, clients);
  assert.equal(res.ok, true);
  assert.equal(res.lostLeads.length, 1);
  assert.equal(res.dischargedClients.length, 1);

  assert.deepEqual(res.lostLeads[0], {
    sourceApp: 'ezone-outpatient', sourceId: 'l1', name: 'אורי', phone: '0501234567',
    originalService: 'פרטני', location: 'רמות', reasonLeft: 'לא ענה',
    dateLeft: '2026-01-05', kind: 'lost_lead'
  });
  assert.deepEqual(res.dischargedClients[0], {
    sourceApp: 'ezone-outpatient', sourceId: 'c1', name: 'דנה', phone: '0527654321',
    originalService: 'קבוצתי', location: 'רעננה', reasonLeft: 'סיימה',
    dateLeft: '2026-03-01', kind: 'discharged'
  });
});

test('missing optional fields project to empty strings, never undefined', () => {
  const res = handleGetWinbackSource(null, {},
    [{ id: 'l1', stage: LOST_LEAD_STAGE_HE }],
    [{ id: 'c1', status: DISCHARGED_CLIENT_STATUS_HE }]);
  const lead = res.lostLeads[0];
  const client = res.dischargedClients[0];
  ['name', 'phone', 'originalService', 'location', 'reasonLeft', 'dateLeft'].forEach((k) => {
    assert.equal(lead[k], '', `lead.${k} should be ''`);
    assert.equal(client[k], '', `client.${k} should be ''`);
  });
  assert.equal(lead.kind, 'lost_lead');
  assert.equal(client.kind, 'discharged');
});

test('empty / null inputs yield empty lists, not a crash', () => {
  assert.deepEqual(handleGetWinbackSource(null, {}, [], []),
    { ok: true, lostLeads: [], dischargedClients: [] });
  assert.deepEqual(handleGetWinbackSource(null, {}, null, null),
    { ok: true, lostLeads: [], dischargedClients: [] });
});

test('a discharged client survives the win-back list (discharge is the trigger, not an exclusion)', () => {
  const res = handleGetWinbackSource(null, {}, [],
    [{ id: 'c1', name: 'x', status: DISCHARGED_CLIENT_STATUS_HE }]);
  assert.equal(res.dischargedClients.length, 1);
});
