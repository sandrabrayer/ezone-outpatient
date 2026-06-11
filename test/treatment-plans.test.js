'use strict';

/**
 * Unit coverage for the getTreatmentPlans cross-app projection.
 * Run with:  npm test     (Node >= 18, built-in test runner)
 *
 * `_getTreatmentPlans` in apps-script/Code.gs cannot be imported in the Node
 * runtime, so `projectPlans` below is a pure mirror of that projection. Any
 * change to the projected shape must update both. The point of the test is to
 * lock the minimal contract: phone is treatmentContactPhone, and NO payer /
 * billing fields ever leak.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// Pure projection mirror of _getTreatmentPlans for unit coverage.
function projectPlans(clients) {
  return (clients || []).filter(c => c && c.id != null && String(c.id)).map(cl => ({
    sourceApp: 'ezone-outpatient', clientId: String(cl.id), name: cl.name || '',
    phone: cl.treatmentContactPhone || '', serviceType: cl.serviceType || '',
    sessions: cl.sessionsPerWeek || '', status: cl.status || ''
  }));
}

test('treatment plans expose only the plan projection, never payer/billing', () => {
  const rows = projectPlans([
    { id: 'c1', name: 'אורי', treatmentContactPhone: '050-1234567',
      payerPhone: '03-0000000', paymentLink: 'https://x', pricePerSession: 300,
      payerName: 'הורה', bundlePrice: 1000,
      serviceType: 'פרטני', sessionsPerWeek: '{"פרטני":1}', status: 'פעיל' }
  ]);
  assert.equal(rows[0].phone, '050-1234567');
  assert.equal(rows[0].serviceType, 'פרטני');
  assert.equal(rows[0].sessions, '{"פרטני":1}');
  assert.equal(rows[0].status, 'פעיל');
  assert.equal('payerPhone' in rows[0], false);
  assert.equal('payerName' in rows[0], false);
  assert.equal('paymentLink' in rows[0], false);
  assert.equal('pricePerSession' in rows[0], false);
  assert.equal('bundlePrice' in rows[0], false);
});

test('treatment plans: rows without an id are skipped; blanks default to empty strings', () => {
  const rows = projectPlans([
    { id: 'c1', name: 'דנה' },                 // missing optional fields
    { name: 'no id here' },                    // no id → skipped
    { id: '', name: 'empty id' }               // empty id → skipped
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    sourceApp: 'ezone-outpatient', clientId: 'c1', name: 'דנה',
    phone: '', serviceType: '', sessions: '', status: ''
  });
});

test('treatment plans: tolerates null / empty input', () => {
  assert.deepEqual(projectPlans(null), []);
  assert.deepEqual(projectPlans([]), []);
});
