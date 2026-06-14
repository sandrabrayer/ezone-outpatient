'use strict';

/**
 * Coverage for the durable patient-phone fix:
 *   - `recoverPhone` canonical leading-zero recovery (mirror of public/app.js),
 *   - the Clients `phone` column is appended LAST in CLIENTS_HEADERS (schema /
 *     migration guard — inserting mid-array would shift existing rows),
 *   - the lead phone is canonicalized onto the client on activation and is
 *     carried into the sheet row so it actually persists.
 * The real homes (app.js IIFE, Code.gs) can't be imported, so the logic is
 * mirrored here; any change must update both.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Mirror of recoverPhone in public/app.js.
function recoverPhone(raw) {
  if (raw == null || raw === '') return '';
  let d = String(raw).trim();
  if (d.indexOf('+972') === 0) d = '0' + d.slice(4);
  else if (d.indexOf('00972') === 0) d = '0' + d.slice(5);
  else if (d.indexOf('972') === 0) d = '0' + d.slice(3);
  d = d.replace(/\D/g, '');
  if (d.length === 9 && d.charAt(0) === '5') d = '0' + d;
  return d;
}

test('recoverPhone: canonical leading-zero from every input shape', () => {
  assert.equal(recoverPhone('0543123276'), '0543123276');     // already canonical
  assert.equal(recoverPhone('054-312-3276'), '0543123276');   // separators
  assert.equal(recoverPhone(' 054 312 3276 '), '0543123276'); // spaces
  assert.equal(recoverPhone('+972543123276'), '0543123276');  // +972
  assert.equal(recoverPhone('00972543123276'), '0543123276'); // 00972
  assert.equal(recoverPhone('972543123276'), '0543123276');   // 972
  assert.equal(recoverPhone('543123276'), '0543123276');      // dropped mobile zero (Sheets number)
  assert.equal(recoverPhone(543123276), '0543123276');        // numeric input
  assert.equal(recoverPhone(''), '');
  assert.equal(recoverPhone(null), '');
  assert.equal(recoverPhone(undefined), '');
});

test('recoverPhone leaves a stored landline untouched (only mobiles get a zero restored)', () => {
  assert.equal(recoverPhone('03-1234567'), '031234567'); // 9-digit landline keeps its leading 0
  assert.equal(recoverPhone('31234567'), '31234567');    // 8 digits, not a mobile → not guessed
});

test('schema guard: Clients `phone` column exists and is appended LAST', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  const m = src.match(/var CLIENTS_HEADERS = \[([\s\S]*?)\];/);
  assert.ok(m, 'CLIENTS_HEADERS not found');
  const cols = m[1].match(/'[^']+'/g).map(s => s.slice(1, -1));
  assert.ok(cols.includes('phone'), 'phone column missing from CLIENTS_HEADERS');
  assert.equal(cols[cols.length - 1], 'phone', 'phone must be the LAST column (append-only rule)');
  // The pre-existing columns must keep their positions (no mid-array insert).
  assert.equal(cols[cols.length - 2], 'paymentLink');
});

test('activation: the lead phone is canonicalized onto the client and persists into the sheet row', () => {
  // Mirror of the agreement-flow assignment + clientForSheet's phone mapping.
  const lead = { id: 'L1', name: 'ליעם בריאר', phone: '054-312-3276' };
  const client = { id: 'C1', name: lead.name, phone: recoverPhone(lead.phone), fromLead: lead.id };
  assert.equal(client.phone, '0543123276');

  const sheetRow = { id: client.id, name: client.name, phone: client.phone || '' };
  assert.equal(sheetRow.phone, '0543123276', 'phone must be written to the sheet row, not dropped');
});

test('backfill: an existing client with no stored phone inherits it from the originating lead', () => {
  // Mirror of backfillClientPhones in public/app.js.
  const leads = [{ id: 'L1', phone: '0543123276' }];
  const clients = [{ id: 'C1', fromLead: 'L1', phone: '' }];
  const leadById = Object.fromEntries(leads.map(l => [l.id, l]));
  clients.forEach(c => {
    const own = recoverPhone(c.phone);
    if (own) { c.phone = own; return; }
    const lead = c.fromLead ? leadById[c.fromLead] : null;
    if (lead) c.phone = recoverPhone(lead.phone);
  });
  assert.equal(clients[0].phone, '0543123276');
});
