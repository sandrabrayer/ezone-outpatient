'use strict';

/**
 * FROZEN Clients column-order guard + by-index-write guard.
 *
 * Root cause of the 2026-07-06 live incident: PR #56 unified the volta and
 * dashboard-hKjf9 lines and declared CLIENTS_HEADERS "append-only". That was true
 * versus the *volta* header array, but a MID-ARRAY INSERT versus the *physically
 * deployed* Clients sheet (which the dashboard-hKjf9 script had written). Because
 * `_ensureSheet` relabels the header row but NEVER migrates data, deploying the
 * unified array shifted every live paid/unpaid + date value under the wrong header
 * name, and `_deriveClientServiceType` then threw ('Unknown clinical treatment
 * type: "paid"') on every save — blocking the whole app.
 *
 * Fix (option a): reorder CLIENTS_HEADERS so it mirrors the PHYSICAL live sheet —
 * paymentStatus/paymentDate/nextBillingDate/creditsOwed directly after `phone`, and
 * the physically-unwritten volta-only columns appended at the END. No data move.
 *
 * This order is FROZEN as of 2026-07-06 and verified against the sheet itself, not
 * merely the previous array. APPEND-ONLY from here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GS = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

function namedArray(name) {
  const m = GS.match(new RegExp('var ' + name + ' = \\[([\\s\\S]*?)\\];'));
  assert.ok(m, name + ' not found in Code.gs');
  return m[1]
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n')
    .match(/'[^']*'/g).map((s) => s.slice(1, -1));
}

// The single source of truth for the frozen order. If a future change reorders or
// removes any column, this deep-equal fails — forcing a deliberate, sheet-verified
// decision (append-only only).
const FROZEN_CLIENTS_HEADERS = [
  'id', 'name', 'serviceType', 'location', 'sessionsPerWeek',
  'pricePerSession', 'startDate', 'status', 'exitDate', 'fromLead',
  'source', 'notes', 'billingType', 'billingDay',
  'bundleSize', 'bundlePrice', 'sessionsUsed', 'bundlePaid',
  'house_of_origin',
  'responsiblePerson', 'serviceScope',
  'treatmentContactPhone', 'payerName', 'payerPhone', 'paymentLink',
  'phone',
  // payment tail — physical live positions 27-30 (directly after phone at 26)
  'paymentStatus', 'paymentDate', 'nextBillingDate', 'creditsOwed',
  // volta-only, physically unwritten -> appended at the END (positions 31-33)
  'clinicalTreatmentType', 'packageChangeDate', 'assignedTo'
];

test('CLIENTS_HEADERS equals the frozen physical order (2026-07-06)', () => {
  const H = namedArray('CLIENTS_HEADERS');
  assert.deepEqual(H, FROZEN_CLIENTS_HEADERS);
  assert.equal(H.length, 33, 'Clients has 33 columns');
});

test('phone (join key) stays at physical column 26 (index 25)', () => {
  const H = namedArray('CLIENTS_HEADERS');
  assert.equal(H.indexOf('phone'), 25);
});

test('the payment tail sits directly after phone, in physical live order', () => {
  const H = namedArray('CLIENTS_HEADERS');
  const pi = H.indexOf('phone');
  assert.deepEqual(H.slice(pi + 1, pi + 5),
    ['paymentStatus', 'paymentDate', 'nextBillingDate', 'creditsOwed']);
});

test('the volta-only (physically-unwritten) columns are the trailing columns', () => {
  const H = namedArray('CLIENTS_HEADERS');
  assert.deepEqual(H.slice(-3), ['clinicalTreatmentType', 'packageChangeDate', 'assignedTo']);
});

// --- the read-only scan's physical constants must match the frozen order -----
test('_REPAIR_PHYS constants match the frozen physical positions', () => {
  const H = FROZEN_CLIENTS_HEADERS;
  // physical (1-indexed) = frozen array index + 1
  assert.equal(H.indexOf('phone') + 1, 26);
  assert.equal(H.indexOf('paymentStatus') + 1, 27);
  assert.equal(H.indexOf('paymentDate') + 1, 28);
  assert.equal(H.indexOf('nextBillingDate') + 1, 29);
  assert.equal(H.indexOf('creditsOwed') + 1, 30);
  // and the volta-only relabel targets (must-be-empty on the live sheet) are 31-33
  assert.deepEqual(
    [H.indexOf('clinicalTreatmentType') + 1, H.indexOf('packageChangeDate') + 1, H.indexOf('assignedTo') + 1],
    [31, 32, 33]
  );
  // the literal constants in Code.gs agree
  assert.ok(/phone:\s*26/.test(GS), '_REPAIR_PHYS.phone must be 26');
  assert.ok(/paymentStatus:\s*27,\s*paymentDate:\s*28,\s*nextBillingDate:\s*29,\s*creditsOwed:\s*30/.test(GS),
    '_REPAIR_PHYS payment tail must be 27-30');
  assert.ok(/mustBeEmpty:\s*\[31,\s*32,\s*33\]/.test(GS), '_REPAIR_PHYS.mustBeEmpty must be [31,32,33]');
});

// --- by-index writes are locked to header LOOKUPS, never hardcoded indexes ---
// (condition 4 of the fix) — a reorder must automatically carry every single-cell
// write. Guarding the source keeps a future edit from regressing to a literal col.
function fnBody(name) {
  const re = new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = GS.match(re);
  assert.ok(m, name + ' not found');
  const start = GS.indexOf(m[0]);
  // walk braces to find the matching close
  let depth = 0, i = GS.indexOf('{', start);
  for (; i < GS.length; i++) {
    if (GS[i] === '{') depth++;
    else if (GS[i] === '}') { depth--; if (depth === 0) return GS.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces for ' + name);
}

test('_writeCreditsOwed derives id/creditsOwed columns via CLIENTS_HEADERS.indexOf', () => {
  const body = fnBody('_writeCreditsOwed');
  assert.ok(/var idCol\s*=\s*CLIENTS_HEADERS\.indexOf\('id'\)\s*\+\s*1;/.test(body),
    'idCol must be header-lookup-derived');
  assert.ok(/var creditCol\s*=\s*CLIENTS_HEADERS\.indexOf\('creditsOwed'\)\s*\+\s*1;/.test(body),
    'creditCol must be header-lookup-derived');
  // the single-cell write must target the DERIVED column var, not a literal
  assert.ok(/getRange\(r \+ 2, creditCol\)\.setValue/.test(body),
    'credit write must use the derived creditCol');
  // no hardcoded numeric column in any getRange single-cell write here
  assert.ok(!/getRange\(r \+ 2, \d+\)\.setValue/.test(body),
    'credit write must not use a hardcoded column index');
});

test('_deactivateClient derives phone/status columns via CLIENTS_HEADERS.indexOf', () => {
  const body = fnBody('_deactivateClient');
  ['phone', 'treatmentContactPhone', 'payerPhone', 'status'].forEach((field) => {
    assert.ok(new RegExp("CLIENTS_HEADERS\\.indexOf\\('" + field + "'\\)").test(body),
      field + ' column must be header-lookup-derived in _deactivateClient');
  });
  // status write targets the derived index, not a literal column
  assert.ok(/setValue\(DEACTIVATED_CLIENT_STATUS_HE\)/.test(body));
  assert.ok(!/getRange\(i \+ 2, \d+\)\.setValue/.test(body),
    'status write must not use a hardcoded column index');
});
