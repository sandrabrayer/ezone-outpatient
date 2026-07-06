'use strict';

/**
 * Coverage for task 4.5a — the outpatient receiver: a new `clinicalTreatmentType`
 * column on Clients, and the on-save derive that turns it into `serviceType`.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * The derive lives in apps-script/Code.gs (`_deriveClientServiceType` /
 * `_clinicalToBilling`) which cannot be imported in the Node runtime, so the
 * tests work two ways:
 *   1. PARSE the `CLINICAL_TO_BILLING` map and `CLIENTS_HEADERS` directly out of
 *      Code.gs and exercise the real values (not a re-typed copy).
 *   2. Assert the parsed map deep-equals public/treatment-map.js — so the inline
 *      mirror can never drift from the canonical module.
 *
 * Contracts locked:
 *   - every clinical value derives the correct serviceType (incl. the 2 renames
 *     and the 5 newly-billable types), matching treatment-map.js
 *   - empty / absent clinical leaves serviceType untouched (back-compat)
 *   - unknown clinical throws (never silently blanks)
 *   - the column is appended LAST (positional safety); a legacy row lacking it
 *     reads back without misaligning `phone`
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const TreatmentMap = require('../public/treatment-map');

const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

// --- parse CLINICAL_TO_BILLING out of Code.gs -------------------------------
function codeGsClinicalMap() {
  const m = GS.match(/var CLINICAL_TO_BILLING = \{([\s\S]*?)\};/);
  assert.ok(m, 'CLINICAL_TO_BILLING not found in Code.gs');
  const body = m[1]
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');
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

// Mirror of Code.gs `_deriveClientServiceType` + `_clinicalToBilling`, built on
// the map PARSED from Code.gs so the behavior tests exercise the real values.
function clinicalToBilling(clinical) {
  const key = String(clinical == null ? '' : clinical).trim();
  if (!Object.prototype.hasOwnProperty.call(CLINICAL_MAP, key)) {
    throw new Error('Unknown clinical treatment type: "' + key + '"');
  }
  return CLINICAL_MAP[key];
}
// FAIL-SOFT mirror (hardened 2026-07-06): unknown clinical value must NOT throw —
// it warns and leaves serviceType untouched, so one bad/misaligned row can never
// abort the whole _saveAll loop. The strict clinicalToBilling primitive above still
// throws for callers that want validation.
function deriveServiceType(client) {
  if (!client) return client;
  const clinical = String(client.clinicalTreatmentType == null ? '' : client.clinicalTreatmentType).trim();
  if (!clinical) return client;
  if (!Object.prototype.hasOwnProperty.call(CLINICAL_MAP, clinical)) return client;
  client.serviceType = CLINICAL_MAP[clinical];
  return client;
}

// --- mirror is in sync with the canonical module ----------------------------
test('Code.gs CLINICAL_TO_BILLING mirror equals public/treatment-map.js', () => {
  assert.deepEqual(CLINICAL_MAP, TreatmentMap.CLINICAL_TO_BILLING);
  assert.equal(Object.keys(CLINICAL_MAP).length, 12);
});

// --- derive: every clinical value -> correct serviceType --------------------
test('every clinical value derives the serviceType from the map', () => {
  Object.keys(CLINICAL_MAP).forEach((clinical) => {
    const c = { id: 'x', serviceType: 'STALE', clinicalTreatmentType: clinical };
    deriveServiceType(c);
    assert.equal(c.serviceType, TreatmentMap.clinicalToBilling(clinical), clinical);
  });
});

test('the two renames derive correctly', () => {
  const a = { serviceType: 'STALE', clinicalTreatmentType: 'פרטני כללי' };
  deriveServiceType(a);
  assert.equal(a.serviceType, 'פרטני');

  const b = { serviceType: 'STALE', clinicalTreatmentType: 'ליווי יומי בקהילה' };
  deriveServiceType(b);
  assert.equal(b.serviceType, 'ליווי יומי בקהילה'); // day-center bound to NEW name
});

test('the five newly-billable types derive to their own names', () => {
  ['פסיכודינמי', 'פסיכותרפי ממוקד טראומה', 'עיסוי טיפולי',
   'טיפול ממוקד התמכרויות', 'טיפול אינטגרטיבי'].forEach((clinical) => {
    const c = { serviceType: 'STALE', clinicalTreatmentType: clinical };
    deriveServiceType(c);
    assert.equal(c.serviceType, clinical);
  });
});

// --- back-compat: empty / absent clinical leaves serviceType untouched ------
test('empty or absent clinicalTreatmentType leaves serviceType untouched', () => {
  const empty = { serviceType: 'פרטני', clinicalTreatmentType: '' };
  deriveServiceType(empty);
  assert.equal(empty.serviceType, 'פרטני');

  const spaces = { serviceType: 'קבוצה', clinicalTreatmentType: '   ' };
  deriveServiceType(spaces);
  assert.equal(spaces.serviceType, 'קבוצה');

  const absent = { serviceType: 'טיפול משפחתי' }; // no clinical key at all
  deriveServiceType(absent);
  assert.equal(absent.serviceType, 'טיפול משפחתי');

  const nullish = { serviceType: 'פרטני CBT', clinicalTreatmentType: null };
  deriveServiceType(nullish);
  assert.equal(nullish.serviceType, 'פרטני CBT');
});

// --- unknown clinical is FAIL-SOFT: never throws, leaves serviceType untouched
// (hardened 2026-07-06 — a single bad/misaligned row must never block all saves) --
test('unknown clinical value does NOT throw and leaves serviceType untouched', () => {
  const c = { serviceType: 'פרטני', clinicalTreatmentType: 'לא קיים' };
  assert.doesNotThrow(() => deriveServiceType(c));
  assert.equal(c.serviceType, 'פרטני'); // unchanged — derive left it as-is
});

// A stray paymentStatus value ('paid'/'unpaid') — the exact 2026-07-06 column-shift
// symptom — must also fail-soft, never throw, so saveAll is never blocked by it.
test('a misaligned paymentStatus value fails soft (regression: 2026-07-06 shift)', () => {
  ['paid', 'unpaid', 'partial'].forEach((bad) => {
    const c = { serviceType: 'קבוצה', clinicalTreatmentType: bad };
    assert.doesNotThrow(() => deriveServiceType(c));
    assert.equal(c.serviceType, 'קבוצה');
  });
});

// The strict primitive still throws — validation is preserved for callers that want it.
test('strict clinicalToBilling primitive still throws on unknown', () => {
  assert.throws(() => clinicalToBilling('לא קיים'), /Unknown clinical treatment type/);
});

// --- FROZEN physical order (verified against the live sheet 2026-07-06) ------
test('CLIENTS_HEADERS tail mirrors the LIVE physical sheet (frozen 2026-07-06)', () => {
  const H = clientsHeaders();
  // FROZEN 2026-07-06: this tail mirrors the PHYSICAL live Clients sheet (as written
  // by the deployed dashboard-hKjf9 script), NOT merely the previous header array.
  // The payment tail (paymentStatus/paymentDate/nextBillingDate/creditsOwed) sits
  // directly after `phone`; the volta-only columns (physically unwritten) append at
  // the END. Append-only from here, verified against the sheet itself.
  assert.deepEqual(H.slice(-8), [
    'phone',
    'paymentStatus', 'paymentDate', 'nextBillingDate', 'creditsOwed',
    'clinicalTreatmentType', 'packageChangeDate', 'assignedTo'
  ]);
});

// Mirror of Code.gs _writeAll / _readAll positional mapping.
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

test('a legacy row lacking the new column reads back without misaligning phone', () => {
  const H = clientsHeaders();
  // legacy sheet row has one fewer physical cell (no assignedTo — the newest
  // trailing column after the frozen reorder); _readAll reads headers.length
  // cells, the trailing '' back.
  const legacy = H.slice(0, -1).map((h) => {
    if (h === 'phone') return '0509998888';
    if (h === 'treatmentContactPhone') return '0501234567';
    if (h === 'serviceType') return 'פרטני';
    if (h === 'clinicalTreatmentType') return 'פרטני CBT';
    return '';
  });
  legacy.push(''); // the absent trailing cell Sheets returns as empty
  const back = readRow(H, legacy);
  assert.equal(back.phone, '0509998888');
  assert.equal(back.treatmentContactPhone, '0501234567');
  assert.equal(back.serviceType, 'פרטני');
  assert.equal(back.clinicalTreatmentType, 'פרטני CBT'); // not misaligned by the reorder
  assert.equal(back.assignedTo, '');                     // new trailing column reads blank
});

test('writing a client without creditsOwed blanks that cell, leaving earlier columns aligned', () => {
  const H = clientsHeaders();
  const client = {
    id: 'c1', name: 'אורי', serviceType: 'פרטני', phone: '0509998888',
    treatmentContactPhone: '0501234567', payerName: 'דנה', paymentLink: 'https://pay/x',
    clinicalTreatmentType: 'פרטני CBT'
  };
  const row = writeRow(H, client);
  assert.equal(row[H.indexOf('creditsOwed')], '');         // absent -> blank cell
  assert.equal(row[H.indexOf('clinicalTreatmentType')], 'פרטני CBT'); // still aligned
  assert.equal(row[H.indexOf('phone')], '0509998888');     // still aligned
  assert.equal(row[H.indexOf('paymentLink')], 'https://pay/x');
  assert.equal(row[H.indexOf('serviceType')], 'פרטני');
});
