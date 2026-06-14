'use strict';

/**
 * Coverage for the duplicate-client merge (apps-script/Code.gs `_mergeClients`,
 * mirrored here) and the survivor default (public/app.js `defaultSurvivorId`).
 * Contract: repoint Payments/ClientCharges clientId dup→survivor BEFORE removal
 * (never orphan billing), fill only BLANK survivor fields and never import
 * id/status/exitDate/fromLead, then remove the dup rows.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const HEADERS = ['id', 'name', 'status', 'exitDate', 'fromLead', 'phone', 'treatmentContactPhone', 'payerName'];

function isBlank(v) { return v === undefined || v === null || String(v).trim() === ''; }

function mergeClients(clients, payments, charges, survivorId, dupIds) {
  survivorId = String(survivorId || '');
  const dupSet = {};
  (dupIds || []).forEach(id => { id = String(id); if (id && id !== survivorId) dupSet[id] = true; });
  dupIds = Object.keys(dupSet);
  if (!survivorId) return { ok: false, error: 'missing_survivor' };
  if (!dupIds.length) return { ok: false, error: 'no_dups' };
  let survivor = null; const dups = [];
  clients.forEach(c => { const id = String(c.id); if (id === survivorId) survivor = c; else if (dupSet[id]) dups.push(c); });
  if (!survivor) return { ok: false, error: 'survivor_not_found' };
  if (dups.length !== dupIds.length) return { ok: false, error: 'dup_not_found' };

  const SKIP = { id: true, status: true, exitDate: true, fromLead: true };
  HEADERS.forEach(key => {
    if (SKIP[key] || !isBlank(survivor[key])) return;
    for (let d = 0; d < dups.length; d++) { if (!isBlank(dups[d][key])) { survivor[key] = dups[d][key]; break; } }
  });

  let repPay = 0, repChg = 0;
  payments.forEach(p => { if (dupSet[String(p.clientId)]) { p.clientId = survivorId; p.clientName = survivor.name || p.clientName || ''; repPay++; } });
  charges.forEach(ch => { if (dupSet[String(ch.clientId)]) { ch.clientId = survivorId; repChg++; } });

  const keptClients = clients.filter(c => !dupSet[String(c.id)]);
  return { ok: true, survivorId, removed: dupIds, repointed: { payments: repPay, charges: repChg }, clients: keptClients, payments, charges };
}

function defaultSurvivorId(rows) {
  const active = rows.find(r => r.status === 'פעיל');
  return active ? active.id : (rows[0] && rows[0].id);
}

test('defaultSurvivorId: the active row wins, else the first row', () => {
  assert.equal(defaultSurvivorId([{ id: 'a', status: 'סיים טיפול' }, { id: 'b', status: 'פעיל' }]), 'b');
  assert.equal(defaultSurvivorId([{ id: 'a', status: 'סיים טיפול' }, { id: 'b', status: 'סיים טיפול' }]), 'a');
});

test('merge גל set: active survivor kept, its payment stays, two empty dups removed', () => {
  const clients = [
    { id: 'gal1', name: 'גל', status: 'פעיל', phone: '0507320000' },
    { id: 'gal2', name: 'גל', status: 'סיים טיפול', phone: '0507320000' },
    { id: 'gal3', name: 'גל', status: 'סיים טיפול', phone: '0507320000' }
  ];
  const payments = [{ id: 'p1', clientId: 'gal1' }];
  const charges = [];
  const res = mergeClients(clients, payments, charges, 'gal1', ['gal2', 'gal3']);
  assert.equal(res.ok, true);
  assert.deepEqual(res.removed.sort(), ['gal2', 'gal3']);
  assert.deepEqual(res.repointed, { payments: 0, charges: 0 });
  assert.deepEqual(res.clients.map(c => c.id), ['gal1']);
  assert.equal(res.payments[0].clientId, 'gal1'); // untouched
});

test('repoint: dup payments & charges move to the survivor before removal', () => {
  const clients = [
    { id: 's', name: 'גל', status: 'פעיל' },
    { id: 'd', name: 'גל', status: 'סיים טיפול' }
  ];
  const payments = [{ id: 'p1', clientId: 'd', clientName: 'גל' }, { id: 'p2', clientId: 's' }];
  const charges = [{ id: 'c1', clientId: 'd' }];
  const res = mergeClients(clients, payments, charges, 's', ['d']);
  assert.deepEqual(res.repointed, { payments: 1, charges: 1 });
  assert.equal(res.payments.find(p => p.id === 'p1').clientId, 's');
  assert.equal(res.payments.find(p => p.id === 'p1').clientName, 'גל');
  assert.equal(res.charges[0].clientId, 's');
  assert.deepEqual(res.clients.map(c => c.id), ['s']);
});

test('fill: blank survivor fields come from dups; status/exitDate are NEVER imported', () => {
  const clients = [
    { id: 's', name: 'גל', status: 'פעיל', exitDate: '', payerName: '', phone: '0507320000' },
    { id: 'd', name: 'גל', status: 'סיים טיפול', exitDate: '2025-01-01', payerName: 'הורה', phone: '0507320000' }
  ];
  const res = mergeClients(clients, [], [], 's', ['d']);
  const surv = res.clients[0];
  assert.equal(surv.payerName, 'הורה');   // blank → filled from dup
  assert.equal(surv.status, 'פעיל');       // never imported
  assert.equal(surv.exitDate, '');         // never imported (stays active)
});

test('validation: missing survivor / no dups / unknown ids are rejected, no mutation', () => {
  const clients = [{ id: 's', name: 'גל', status: 'פעיל' }, { id: 'd', name: 'גל', status: 'סיים טיפול' }];
  assert.deepEqual(mergeClients(clients, [], [], '', ['d']), { ok: false, error: 'missing_survivor' });
  assert.deepEqual(mergeClients(clients, [], [], 's', []), { ok: false, error: 'no_dups' });
  assert.deepEqual(mergeClients(clients, [], [], 's', ['nope']), { ok: false, error: 'dup_not_found' });
  assert.deepEqual(mergeClients(clients, [], [], 'ghost', ['d']), { ok: false, error: 'survivor_not_found' });
  assert.equal(clients.length, 2); // untouched
});
