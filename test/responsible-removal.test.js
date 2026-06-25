'use strict';

/**
 * Coverage for task 4.4 — removal of the אחראי concept (responsiblePerson +
 * serviceScope) from the outpatient app.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * Two things are locked here:
 *
 *  1. SOURCE GUARD — the app code (public/) no longer references the two fields
 *     or their UI (chips, selects, inputs, validation), while the KEPT field
 *     `treatmentContactPhone` is still present. This is what makes the removal
 *     real (mirrored pure logic alone could pass even if app.js never changed).
 *
 *  2. POSITIONAL SAFETY — the two columns were intentionally KEPT as reserved
 *     slots in apps-script/Code.gs CLIENTS_HEADERS (positions preserved) because
 *     `_readAll`/`_writeAll` are positional and `_ensureSheet` does not migrate
 *     data; dropping mid-array headers would shift/corrupt every column after
 *     them (incl. the `phone` cross-app join key). This test mirrors that
 *     positional write/read and proves a client saved WITHOUT the two fields
 *     still lands `treatmentContactPhone`…`phone` in the right columns, with the
 *     reserved slots blanked — and that no required-validation blocks the save.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// --- 1. SOURCE GUARD --------------------------------------------------------
test('app source no longer references responsiblePerson / serviceScope', () => {
  ['public/app.js', 'public/index.html', 'public/style.css'].forEach((f) => {
    const src = read(f);
    assert.ok(!/responsiblePerson/.test(src), 'responsiblePerson still in ' + f);
    assert.ok(!/serviceScope/.test(src), 'serviceScope still in ' + f);
  });
  // dead CSS chips are gone too
  const css = read('public/style.css');
  assert.ok(!/chip-resp|chip-scope/.test(css), 'dead chip classes still in style.css');
  // and the responsible-name validation message is gone
  assert.ok(!/יש להזין שם אחראי טיפול/.test(read('public/app.js')),
    'responsiblePerson required-validation still present');
});

test('the KEPT treatmentContactPhone field is untouched', () => {
  assert.ok(/treatmentContactPhone/.test(read('public/app.js')));
  assert.ok(/treatmentContactPhone/.test(read('public/index.html')));
  // its WhatsApp/billing usages survive
  assert.ok(/buildStopTreatmentMsg/.test(read('public/app.js')));
});

// --- CLIENTS_HEADERS shape (parsed from Code.gs) ----------------------------
// Extract the CLIENTS_HEADERS array literal from Code.gs, strip // comments,
// and pull the quoted column names in order. This is the actual source of
// truth for the positional layout the sheet helpers depend on.
function clientsHeaders() {
  const gs = read('apps-script/Code.gs');
  const m = gs.match(/var CLIENTS_HEADERS = \[([\s\S]*?)\];/);
  assert.ok(m, 'could not find CLIENTS_HEADERS in Code.gs');
  return m[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '')) // drop line comments
    .join('\n')
    .match(/'[^']*'/g)
    .map((s) => s.slice(1, -1));
}

test('reserved slots are KEPT in CLIENTS_HEADERS to preserve column positions', () => {
  const H = clientsHeaders();
  // the dead concept is still reserved...
  assert.ok(H.includes('responsiblePerson'), 'responsiblePerson slot was dropped (positional risk!)');
  assert.ok(H.includes('serviceScope'), 'serviceScope slot was dropped (positional risk!)');
  // ...sitting exactly between house_of_origin and the kept contact phone —
  // i.e. nothing after them shifted. (Append-only tail since: clinicalTreatmentType
  // after `phone` in task 4.5a, then creditsOwed for session accounting, then
  // packageChangeDate for שינוי חבילה.)
  const tail = H.slice(H.indexOf('house_of_origin'));
  assert.deepEqual(tail, [
    'house_of_origin',
    'responsiblePerson', 'serviceScope',
    'treatmentContactPhone', 'payerName', 'payerPhone', 'paymentLink',
    'phone', 'clinicalTreatmentType', 'creditsOwed', 'packageChangeDate'
  ]);
});

// --- 2. POSITIONAL SAFETY (mirror of Code.gs _writeAll / _readAll) ----------
// Mirror of _writeAll's per-row mapping: headers.map(h => row[h] ?? '').
function writeRow(headers, obj) {
  return headers.map((h) => {
    const v = obj[h];
    return (v === undefined || v === null) ? '' : v;
  });
}
// Mirror of _readAll's positional mapping: obj[headers[c]] = row[c].
function readRow(headers, row) {
  const obj = {};
  for (let c = 0; c < headers.length; c++) obj[headers[c]] = row[c];
  return obj;
}

test('a client saved with NO responsible fields aligns columns; reserved slots blank', () => {
  const H = clientsHeaders();
  // a fully-formed client object as produced by clientForSheet AFTER 4.4 —
  // it simply has no responsiblePerson / serviceScope keys.
  const client = {
    id: 'c1', name: 'אורי', serviceType: 'פרטני', location: 'רעננה הפרדס',
    sessionsPerWeek: '{"פרטני":1}', pricePerSession: 500, startDate: '2026-01-01',
    status: 'פעיל', exitDate: '', fromLead: '', source: 'lead', notes: '',
    billingType: 'monthly', billingDay: 1, bundleSize: '', bundlePrice: '',
    sessionsUsed: '', bundlePaid: '', house_of_origin: 'raanana',
    treatmentContactPhone: '0501234567', payerName: 'דנה', payerPhone: '0521112222',
    paymentLink: 'https://pay/x', phone: '0509998888'
  };
  const row = writeRow(H, client);

  // reserved slots blank (the app supplies no value)
  assert.equal(row[H.indexOf('responsiblePerson')], '');
  assert.equal(row[H.indexOf('serviceScope')], '');
  // everything after them lands in the right column — NOT shifted
  assert.equal(row[H.indexOf('treatmentContactPhone')], '0501234567');
  assert.equal(row[H.indexOf('payerName')], 'דנה');
  assert.equal(row[H.indexOf('payerPhone')], '0521112222');
  assert.equal(row[H.indexOf('paymentLink')], 'https://pay/x');
  // the cross-app join key survives in its column
  assert.equal(row[H.indexOf('phone')], '0509998888');

  // round-trip read maps the same columns back
  const back = readRow(H, row);
  assert.equal(back.phone, '0509998888');
  assert.equal(back.treatmentContactPhone, '0501234567');
  assert.equal(back.responsiblePerson, ''); // dead slot reads blank
  assert.equal(back.serviceScope, '');
});

test('reading a LEGACY row that still has אחראי data does not misalign phone', () => {
  // existing sheet rows keep their old responsiblePerson/serviceScope cells
  // until next save; reading them must still place phone in the right column.
  const H = clientsHeaders();
  const legacy = H.map((h) => {
    if (h === 'responsiblePerson') return 'דר. כהן';
    if (h === 'serviceScope') return 'individual';
    if (h === 'phone') return '0509998888';
    if (h === 'treatmentContactPhone') return '0501234567';
    return '';
  });
  const back = readRow(H, legacy);
  assert.equal(back.phone, '0509998888');
  assert.equal(back.treatmentContactPhone, '0501234567');
  // the app ignores these now, but the cells read back where they sit
  assert.equal(back.responsiblePerson, 'דר. כהן');
  assert.equal(back.serviceScope, 'individual');
});
