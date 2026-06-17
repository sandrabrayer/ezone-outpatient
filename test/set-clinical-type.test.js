'use strict';

/**
 * Coverage for task 4.5b — the secured `setClinicalType` write endpoint in
 * apps-script/Code.gs. Run with:  npm test     (Node >= 18, built-in runner)
 *
 * Code.gs cannot be imported in the Node runtime, so the pure logic below
 * mirrors `_clinicalTypeAuthOk`, `_recoverPhone`, and `_setClinicalType` (minus
 * the sheet I/O, which is replaced by an in-memory Clients array). To keep the
 * behaviour tests honest, the clinical→billing map and CLIENTS_HEADERS are
 * PARSED out of Code.gs (not re-typed), exactly like clinical-derive.test.js.
 *
 * Contracts locked:
 *   - auth is FAIL-CLOSED (unset / empty / wrong secret all rejected)
 *   - single phone match -> writes clinicalTreatmentType + derived serviceType,
 *     returns { ok:true, matched:1 } (incl. the two renames and a newly-billable)
 *   - no match   -> { ok:false, reason:'no_match' },    writes nothing
 *   - multi match-> { ok:false, reason:'multi_match' },  writes nothing
 *   - unknown    -> { ok:false, reason:'unknown_type' }, writes nothing
 *   - the map is reused (no duplicated map) — parsed from Code.gs
 *   - positional safety: only the two target fields change; a legacy row stays
 *     aligned and the untouched row is byte-identical
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const TreatmentMap = require('../public/treatment-map');

const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

// --- parse CLINICAL_TO_BILLING out of Code.gs (no re-typed map) --------------
function codeGsClinicalMap() {
  const m = GS.match(/var CLINICAL_TO_BILLING = \{([\s\S]*?)\};/);
  assert.ok(m, 'CLINICAL_TO_BILLING not found in Code.gs');
  const body = m[1].split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const map = {};
  const pairRe = /'([^']*)'\s*:\s*'([^']*)'/g;
  let pair;
  while ((pair = pairRe.exec(body)) !== null) map[pair[1]] = pair[2];
  return map;
}

// --- parse CLIENTS_HEADERS out of Code.gs -----------------------------------
function clientsHeaders() {
  const m = GS.match(/var CLIENTS_HEADERS = \[([\s\S]*?)\];/);
  assert.ok(m, 'CLIENTS_HEADERS not found in Code.gs');
  return m[1]
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
    .match(/'[^']*'/g)
    .map((s) => s.slice(1, -1));
}

const CLINICAL_MAP = codeGsClinicalMap();
const H = clientsHeaders();

// --- pure mirror of Code.gs --------------------------------------------------
function recoverPhone(raw) {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).replace(/[\s\-()]/g, '');
  if (s.indexOf('+') === 0) s = s.slice(1);
  if (s.indexOf('00') === 0) s = s.slice(2);
  s = s.replace(/\D/g, '');
  if (!s) return '';
  if (s.indexOf('972') === 0) s = '0' + s.slice(3);
  else if (s.charAt(0) !== '0') s = '0' + s;
  return s;
}

function clinicalTypeAuthOk(expected, got) {
  if (!expected) return false; // fail-closed
  const g = (got != null) ? String(got) : '';
  return g !== '' && g === expected;
}

function deriveServiceType(client) {
  const clinical = String(client.clinicalTreatmentType == null ? '' : client.clinicalTreatmentType).trim();
  if (!clinical) return client;
  if (!Object.prototype.hasOwnProperty.call(CLINICAL_MAP, clinical)) {
    throw new Error('Unknown clinical treatment type: "' + clinical + '"');
  }
  client.serviceType = CLINICAL_MAP[clinical];
  return client;
}

// Mirror of _setClinicalType minus the sheet I/O: `clients` is the in-memory
// array (mutated in place exactly as _writeAll would persist it).
function setClinicalType(payload, clients) {
  const phone = recoverPhone(payload && payload.phone);
  if (!phone || !/^0\d{8,9}$/.test(phone)) return { ok: false, reason: 'invalid_phone' };

  const clinical = String((payload && payload.clinicalTreatmentType) || '').trim();
  if (!clinical) return { ok: false, reason: 'unknown_type' };
  if (!Object.prototype.hasOwnProperty.call(CLINICAL_MAP, clinical)) {
    return { ok: false, reason: 'unknown_type' };
  }

  const hits = clients.filter((c) =>
    recoverPhone(c.phone) === phone ||
    recoverPhone(c.treatmentContactPhone) === phone ||
    recoverPhone(c.payerPhone) === phone
  );
  if (hits.length === 0) return { ok: false, reason: 'no_match' };
  if (hits.length > 1) return { ok: false, reason: 'multi_match' };

  hits[0].clinicalTreatmentType = clinical;
  deriveServiceType(hits[0]);
  return { ok: true, matched: 1 };
}

// Mirror of _writeAll/_readAll positional mapping (for the positional-safety test).
function writeRow(headers, obj) {
  return headers.map((h) => {
    const v = obj[h];
    return (v === undefined || v === null) ? '' : v;
  });
}
function readRow(headers, row) {
  const obj = {};
  for (let c = 0; c < headers.length; c++) obj[headers[c]] = row[c];
  return obj;
}
// ---------------------------------------------------------------------------

function freshClients() {
  return [
    { id: 'c1', name: 'אורי', serviceType: 'STALE', phone: '0501234567', treatmentContactPhone: '', payerPhone: '', clinicalTreatmentType: '' },
    { id: 'c2', name: 'דנה', serviceType: 'קבוצה', phone: '', treatmentContactPhone: '0527654321', payerPhone: '', clinicalTreatmentType: '' },
    { id: 'c3', name: 'מאיה', serviceType: 'פרטני', phone: '0541111111', treatmentContactPhone: '', payerPhone: '', clinicalTreatmentType: '' }
  ];
}

// --- the map is reused, not duplicated --------------------------------------
test('setClinicalType uses the SAME map as the on-save derive (parsed from Code.gs)', () => {
  assert.deepEqual(CLINICAL_MAP, TreatmentMap.CLINICAL_TO_BILLING);
  assert.equal(Object.keys(CLINICAL_MAP).length, 12);
});

// --- auth is fail-closed -----------------------------------------------------
test('auth is fail-closed: unset / empty / wrong secret are rejected', () => {
  assert.equal(clinicalTypeAuthOk('', 'anything'), false);   // property unset -> reject
  assert.equal(clinicalTypeAuthOk(null, 'anything'), false);
  assert.equal(clinicalTypeAuthOk('s3cret', ''), false);     // empty provided
  assert.equal(clinicalTypeAuthOk('s3cret', null), false);
  assert.equal(clinicalTypeAuthOk('s3cret', 'wrong'), false);
});

test('auth accepts the exact configured secret', () => {
  assert.equal(clinicalTypeAuthOk('s3cret', 's3cret'), true);
});

// --- single match writes + derives ------------------------------------------
test('single match sets clinical + derives serviceType, returns matched:1', () => {
  const clients = freshClients();
  const res = setClinicalType(
    { phone: '0501234567', clinicalTreatmentType: 'פרטני CBT' }, clients
  );
  assert.deepEqual(res, { ok: true, matched: 1 });
  assert.equal(clients[0].clinicalTreatmentType, 'פרטני CBT');
  assert.equal(clients[0].serviceType, 'פרטני CBT'); // derived
  // other rows untouched
  assert.equal(clients[1].serviceType, 'קבוצה');
  assert.equal(clients[2].serviceType, 'פרטני');
});

test('single match via a rename (פרטני כללי -> פרטני) derives correctly', () => {
  const clients = freshClients();
  const res = setClinicalType(
    { phone: '0501234567', clinicalTreatmentType: 'פרטני כללי' }, clients
  );
  assert.deepEqual(res, { ok: true, matched: 1 });
  assert.equal(clients[0].clinicalTreatmentType, 'פרטני כללי');
  assert.equal(clients[0].serviceType, 'פרטני'); // renamed on derive
});

test('single match via the day-center rename (ליווי יומי בקהילה) derives to the new name', () => {
  const clients = freshClients();
  const res = setClinicalType(
    { phone: '0501234567', clinicalTreatmentType: 'ליווי יומי בקהילה' }, clients
  );
  assert.deepEqual(res, { ok: true, matched: 1 });
  assert.equal(clients[0].clinicalTreatmentType, 'ליווי יומי בקהילה');
  assert.equal(clients[0].serviceType, 'ליווי יומי בקהילה'); // bound to NEW name (day-center rule)
});

test('single match via a newly-billable type (פסיכודינמי) derives to its own name', () => {
  const clients = freshClients();
  const res = setClinicalType(
    { phone: '0501234567', clinicalTreatmentType: 'פסיכודינמי' }, clients
  );
  assert.deepEqual(res, { ok: true, matched: 1 });
  assert.equal(clients[0].serviceType, 'פסיכודינמי');
});

test('phone is normalized (972 / dashes) before matching; matches treatment-contact/payer', () => {
  let clients = freshClients();
  assert.deepEqual(setClinicalType({ phone: '+972-50-1234567', clinicalTreatmentType: 'קבוצה' }, clients), { ok: true, matched: 1 });
  assert.equal(clients[0].serviceType, 'קבוצה');
  // c2 only has treatmentContactPhone
  clients = freshClients();
  assert.deepEqual(setClinicalType({ phone: '972527654321', clinicalTreatmentType: 'קבוצה' }, clients), { ok: true, matched: 1 });
  assert.equal(clients[1].serviceType, 'קבוצה');
});

// --- no match writes nothing -------------------------------------------------
test('no match returns no_match and writes nothing', () => {
  const clients = freshClients();
  const before = JSON.stringify(clients);
  const res = setClinicalType({ phone: '0509999999', clinicalTreatmentType: 'פרטני CBT' }, clients);
  assert.deepEqual(res, { ok: false, reason: 'no_match' });
  assert.equal(JSON.stringify(clients), before); // untouched
});

// --- multi match writes nothing ---------------------------------------------
test('multi match returns multi_match and writes nothing (never guesses)', () => {
  const clients = freshClients();
  clients.push({ id: 'c4', name: 'אורי תאום', serviceType: 'STALE2', phone: '0501234567', treatmentContactPhone: '', payerPhone: '', clinicalTreatmentType: '' });
  const before = JSON.stringify(clients);
  const res = setClinicalType({ phone: '0501234567', clinicalTreatmentType: 'פרטני CBT' }, clients);
  assert.deepEqual(res, { ok: false, reason: 'multi_match' });
  assert.equal(JSON.stringify(clients), before); // both colliding rows untouched
});

// --- unknown type writes nothing --------------------------------------------
test('unknown clinical type returns unknown_type and writes nothing', () => {
  const clients = freshClients();
  const before = JSON.stringify(clients);
  assert.deepEqual(setClinicalType({ phone: '0501234567', clinicalTreatmentType: 'לא קיים' }, clients), { ok: false, reason: 'unknown_type' });
  assert.equal(JSON.stringify(clients), before);
});

test('empty / missing clinical type returns unknown_type and writes nothing', () => {
  const clients = freshClients();
  const before = JSON.stringify(clients);
  assert.deepEqual(setClinicalType({ phone: '0501234567', clinicalTreatmentType: '   ' }, clients), { ok: false, reason: 'unknown_type' });
  assert.deepEqual(setClinicalType({ phone: '0501234567' }, clients), { ok: false, reason: 'unknown_type' });
  assert.equal(JSON.stringify(clients), before);
});

test('invalid phone is rejected before any matching', () => {
  const clients = freshClients();
  assert.deepEqual(setClinicalType({ phone: '12345', clinicalTreatmentType: 'קבוצה' }, clients), { ok: false, reason: 'invalid_phone' });
  assert.deepEqual(setClinicalType({ phone: '', clinicalTreatmentType: 'קבוצה' }, clients), { ok: false, reason: 'invalid_phone' });
});

// --- positional safety -------------------------------------------------------
test('only clinicalTreatmentType + serviceType change; every other field is preserved', () => {
  const clients = freshClients();
  // give c3 a full set of fields to confirm none are disturbed
  Object.assign(clients[2], {
    location: 'ירושלים', sessionsPerWeek: 2, pricePerSession: 300, status: 'פעיל',
    payerName: 'הורה', paymentLink: 'https://pay/c3', notes: 'שים לב'
  });
  const snapshot = Object.assign({}, clients[2]);
  setClinicalType({ phone: '0541111111', clinicalTreatmentType: 'טיפול משפחתי' }, clients);
  assert.equal(clients[2].clinicalTreatmentType, 'טיפול משפחתי');
  assert.equal(clients[2].serviceType, 'טיפול משפחתי');
  // everything else identical to the snapshot
  ['id', 'name', 'location', 'sessionsPerWeek', 'pricePerSession', 'status',
   'payerName', 'paymentLink', 'notes', 'phone'].forEach((k) => {
    assert.equal(clients[2][k], snapshot[k], k);
  });
});

test('a legacy row (no clinicalTreatmentType cell) stays aligned after a write back', () => {
  // Build a legacy physical row lacking the trailing clinicalTreatmentType cell,
  // read it positionally, mutate the two target fields, write it back: phone and
  // every other column must stay in their original positions.
  const legacy = H.slice(0, -1).map((h) => {
    if (h === 'phone') return '0541111111';
    if (h === 'treatmentContactPhone') return '0501234567';
    if (h === 'serviceType') return 'פרטני';
    if (h === 'id') return 'legacy1';
    return '';
  });
  legacy.push(''); // absent trailing cell Sheets returns as empty
  const client = readRow(H, legacy);
  assert.equal(client.clinicalTreatmentType, '');

  const res = setClinicalType({ phone: '0541111111', clinicalTreatmentType: 'פרטני EMDR' }, [client]);
  assert.deepEqual(res, { ok: true, matched: 1 });

  const row = writeRow(H, client);
  assert.equal(row[H.indexOf('clinicalTreatmentType')], 'פרטני EMDR'); // last col set
  assert.equal(row[H.indexOf('serviceType')], 'פרטני EMDR');           // derived
  assert.equal(row[H.indexOf('phone')], '0541111111');                 // still aligned
  assert.equal(row[H.indexOf('treatmentContactPhone')], '0501234567');
  assert.equal(row[H.indexOf('id')], 'legacy1');
});
