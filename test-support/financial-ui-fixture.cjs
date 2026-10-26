'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
function named(name) {
  let start = source.indexOf('  function ' + name + '(');
  if (start < 0) start = source.indexOf('  async function ' + name + '(');
  if (start < 0) throw new Error('Missing helper: ' + name);
  const lineEnd = source.indexOf('\n', start);
  if (source.slice(start, lineEnd).trimEnd().endsWith('}')) return source.slice(start, lineEnd);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}
function handler(formName) {
  const selector = formName === 'activateForm'
    ? "$('#activateForm').addEventListener('submit', "
    : `if (${formName}) ${formName}.addEventListener('submit', `;
  const start = source.indexOf(selector);
  const end = source.indexOf('\n    });', start);
  if (start < 0 || end < 0) throw new Error('Missing handler: ' + formName);
  return '(' + source.slice(start + selector.length, end + 6) + ')';
}
const copy = (v) => JSON.parse(JSON.stringify(v));
function fixture(fields = {}) {
  const button = { disabled: false }, warning = { hidden: true }, warningText = {};
  const client = { id: 'fixture-client', name: 'מטופל בדיקה', phone: '0500000001', billingDay: 1,
    startDate: '2026-09-01', nextBillingDate: '2026-10-01', pricePerSession: 500,
    paymentDate: '2026-09-01', paymentStatus: 'paid', updatedAt: '2026-10-01T00:00:00.000Z' };
  const lead = { id: 'fixture-lead', name: 'ליד בדיקה', phone: '0500000002', serviceType: 'פרטני' };
  const out = { notices: [], writes: [], closed: [], renders: 0, reloads: 0 };
  let serial = 0;
  const ctx = {
    state: { clients: [client], leads: [lead], payments: [], charges: [] },
    renewClientId: client.id, addChargeClientId: client.id, editClientId: client.id, activateLeadId: lead.id,
    $: (selector) => selector === '#financialSaveWarning' ? warning : selector === '#financialSaveWarningText' ? warningText : selector.startsWith('[data-') ? null : button,
    FormData: class { get(key) { return fields[key] ?? null; } has(key) { return key in fields; } },
    today: () => '2026-10-18', uid: () => 'fixture-new-' + (++serial),
    readServiceGroup: () => ['פרטני'], readSessionsHost: () => ({ 'פרטני': 1 }), readSessionsUnits: () => ({}),
    formatServices: (a) => a.join(','), wholeSessions: (v) => Number(v) || 0,
    acceptPhone: (p) => p, recoverPhone: (p) => p, duplicateClientBlock: () => false,
    readPackageSessionsFromForm: () => null, packageSessionsChanged: () => false,
    clientAmountDue: (c) => c.pricePerSession, cyclePaymentDueDate: () => '2026-10-01',
    render() { out.renders++; }, setView() { out.renders++; },
    closeRenewModal() { out.closed.push('renew'); }, closeAddChargeModal() { out.closed.push('charge'); },
    closeDirectClientModal() { out.closed.push('direct'); }, closeActivateModal() { out.closed.push('activate'); },
    closeEditClientModal() { out.closed.push('edit'); },
    toast(message, error) { out.notices.push({ message, error: !!error }); },
    leadForSheet: (r) => r, clientForSheet: (r) => r,
    showConflictBanner() { out.conflict = true; }, hideConflictBanner() {},
    loadAll: async () => { out.reloads++; }, console,
    apiSave: async (payload) => { out.writes.push({ kind: 'client', payload: copy(payload) }); return { ok: true }; },
    persistCharge: async (row) => { out.writes.push({ kind: 'charge', row: copy(row) }); },
    persistPayment: async (row) => { out.writes.push({ kind: 'payment', row: copy(row) }); }
  };
  vm.createContext(ctx);
  // בית מועדף helper the submit handlers call (real list + function).
  vm.runInContext(source.match(/var PREFERRED_HOUSES = \[[^\]]*\];/)[0], ctx);
  for (const name of ['preferredHouseOrBlank', 'toNum', 'fmtDate', 'dayOfMonth', 'lastDayOfMonth', 'addMonth', 'monthKey',
    'paymentId', 'basePaymentPaidOn', 'nextRenewalDueDate', 'clampedCycleIso', 'nextCycleDueDate',
    'nextCycleDueDateAfter', 'currentMonthBaseDueDate', 'conflictsMessage', 'persist',
    'persistClientChange', 'rememberConfirmedPayment', 'showFinancialSaveWarning']) vm.runInContext(named(name), ctx);
  return { ctx, client, lead, out, button, warning, warningText,
    submit: (name) => vm.runInContext(handler(name), ctx)({ preventDefault() {}, target: {} }) };
}
const settled = () => new Promise(setImmediate);
module.exports = { fixture, settled, named, source, copy };
