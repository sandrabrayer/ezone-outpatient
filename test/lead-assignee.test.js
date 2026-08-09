'use strict';

/**
 * Coverage for "משוייך ל" (assigned-to) — the staff member a lead is assigned to,
 * carried through to the patient on conversion.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * The serializers (leadForSheet / clientForSheet) live in public/app.js, which is
 * a browser IIFE and cannot be required in Node. So — like the other schema
 * tests (clinical-derive, session-credits, stop-flag-match) — this parses the
 * real header arrays out of apps-script/Code.gs and exercises the POSITIONAL
 * round-trip directly against _writeAll / _readAll's mapping.
 *
 * Contracts locked:
 *   - assignedTo is appended LAST on LEADS_HEADERS, REMOVED_LEADS_HEADERS and
 *     CLIENTS_HEADERS (positional, append-only — never inserted mid-array)
 *   - a value round-trips positionally without misaligning earlier columns
 *   - a legacy row lacking the column reads back blank (no shift)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

// Parse a `var NAME = [ ... ];` header array out of Code.gs, comments stripped.
function headers(name) {
  const m = GS.match(new RegExp('var ' + name + ' = \\[([\\s\\S]*?)\\];'));
  assert.ok(m, name + ' not found in Code.gs');
  return m[1]
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
    .match(/'[^']*'/g)
    .map((s) => s.slice(1, -1));
}

// Mirror of Code.gs _writeAll's per-row mapping: headers.map(h => row[h] ?? '').
function writeRow(hdrs, obj) {
  return hdrs.map((h) => {
    const v = obj[h];
    return (v === undefined || v === null) ? '' : v;
  });
}
// Mirror of _readAll's positional mapping: obj[headers[c]] = row[c].
function readRow(hdrs, row) {
  const obj = {};
  for (let c = 0; c < hdrs.length; c++) obj[hdrs[c]] = row[c];
  return obj;
}

const LEADS_H = headers('LEADS_HEADERS');
const REMOVED_H = headers('REMOVED_LEADS_HEADERS');
const CLIENTS_H = headers('CLIENTS_HEADERS');

test('assignedTo is last on the leads arrays; on CLIENTS it trails the payment tail', () => {
  // Leads sheets were untouched by the volta+dashboard unification.
  assert.equal(LEADS_H[LEADS_H.length - 1], 'assignedTo');
  assert.equal(REMOVED_H[REMOVED_H.length - 1], 'assignedTo');
  // assignedTo is a volta-only column (physically unwritten on the live sheet) that
  // appended after the payment tail. The later paymentAmountOverrides column appended
  // after it, so assignedTo now sits second-from-last on CLIENTS.
  assert.equal(CLIENTS_H[CLIENTS_H.length - 1], 'paymentAmountOverrides');
  assert.deepEqual(CLIENTS_H.slice(-4),
    ['clinicalTreatmentType', 'packageChangeDate', 'assignedTo', 'paymentAmountOverrides']);
});

test('lead assignedTo round-trips positionally without misaligning earlier columns', () => {
  const lead = {
    id: 'l1', name: 'דנה', phone: '0501234567', stage: 'new',
    house_of_origin: 'external', not_relevant_note: 'x', assignedTo: 'שירן'
  };
  const row = writeRow(LEADS_H, lead);
  assert.equal(row[LEADS_H.indexOf('assignedTo')], 'שירן');
  // the column before assignedTo (not_relevant_note) is not shifted
  assert.equal(row[LEADS_H.indexOf('not_relevant_note')], 'x');
  assert.equal(row[LEADS_H.indexOf('house_of_origin')], 'external');
  const back = readRow(LEADS_H, row);
  assert.equal(back.assignedTo, 'שירן');
  assert.equal(back.not_relevant_note, 'x');
});

test('client assignedTo round-trips positionally; earlier appended columns keep their place', () => {
  const client = {
    id: 'c1', name: 'אורי', phone: '0509998888',
    clinicalTreatmentType: 'פרטני CBT', creditsOwed: 2,
    packageChangeDate: '2026-03-20', assignedTo: 'יעל'
  };
  const row = writeRow(CLIENTS_H, client);
  assert.equal(row[CLIENTS_H.indexOf('assignedTo')], 'יעל');
  assert.equal(row[CLIENTS_H.indexOf('packageChangeDate')], '2026-03-20'); // not shifted
  assert.equal(row[CLIENTS_H.indexOf('creditsOwed')], 2);
  assert.equal(row[CLIENTS_H.indexOf('clinicalTreatmentType')], 'פרטני CBT');
  const back = readRow(CLIENTS_H, row);
  assert.equal(back.assignedTo, 'יעל');
  assert.equal(back.packageChangeDate, '2026-03-20');
});

test('a legacy client row lacking assignedTo reads back blank without misaligning earlier columns', () => {
  // legacy sheet row has one fewer physical cell (no assignedTo); Sheets returns
  // the trailing cell as empty when _readAll reads headers.length cells.
  const legacy = CLIENTS_H.slice(0, -1).map((h) => {
    if (h === 'phone') return '0509998888';
    if (h === 'packageChangeDate') return '2026-03-20';
    if (h === 'clinicalTreatmentType') return 'פרטני CBT';
    return '';
  });
  legacy.push(''); // the absent trailing cell
  const back = readRow(CLIENTS_H, legacy);
  assert.equal(back.assignedTo, '');                 // new column reads blank
  assert.equal(back.packageChangeDate, '2026-03-20'); // not misaligned by the append
  assert.equal(back.phone, '0509998888');
});
