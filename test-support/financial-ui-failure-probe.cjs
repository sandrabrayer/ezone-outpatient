'use strict';

// Diagnostic, NOT an acceptance test. Run with Node; no browser, network or
// production data. Executes the real app.js submit handlers and date/id helpers.
// Reports unresolved OP-02 follow-up issues; never treats their presence as a pass.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function named(name) {
  let start = source.indexOf('  function ' + name + '(');
  if (start < 0) start = source.indexOf('  async function ' + name + '(');
  if (start < 0) throw new Error('Missing helper: ' + name);
  const lineEnd = source.indexOf('\n', start);
  if (source.slice(start, lineEnd).trimEnd().endsWith('}')) return source.slice(start, lineEnd);
  const end = source.indexOf('\n  }', start);
  if (end < 0) throw new Error('Missing helper boundary: ' + name);
  return source.slice(start, end + 4);
}

function handler(formName) {
  const marker = `if (${formName}) ${formName}.addEventListener('submit', `;
  const start = source.indexOf(marker);
  const end = source.indexOf('\n    });', start);
  if (start < 0 || end < 0) throw new Error('Missing submit handler: ' + formName);
  return '(' + source.slice(start + marker.length, end + 6) + ')';
}

function setup(fields) {
  const button = { disabled: false };
  const client = { id: 'fixture-client', name: 'Synthetic', billingDay: 1,
    startDate: '2026-09-01', nextBillingDate: '2026-10-01', pricePerSession: 500 };
  const output = { notices: [], attemptedPayments: [], savedClients: [], closed: false };
  const ctx = {
    state: { clients: [client], payments: [], charges: [] },
    renewClientId: client.id, addChargeClientId: client.id,
    $: () => button,
    FormData: class { get(key) { return fields[key] ?? null; } },
    today: () => '2026-10-16', uid: () => 'fixture-charge',
    readPackageSessionsFromForm: () => ({}), packageSessionsChanged: () => false,
    render() {}, closeRenewModal() { output.closed = true; },
    closeAddChargeModal() { output.closed = true; },
    toast(message, error) { output.notices.push({ message, error: !!error }); },
    async persist() { output.savedClients.push(JSON.parse(JSON.stringify(client))); },
    async persistCharge(charge) { output.savedCharge = { ...charge }; },
    async persistPayment(payment) {
      output.attemptedPayments.push({ ...payment });
      if (output.attemptedPayments.length === 1) throw new Error('fixture busy');
      return payment;
    }
  };
  vm.createContext(ctx);
  for (const name of ['toNum', 'fmtDate', 'dayOfMonth', 'lastDayOfMonth', 'addMonth',
    'monthKey', 'paymentId', 'basePaymentPaidOn', 'nextRenewalDueDate',
    'persistClientChange', 'rememberConfirmedPayment', 'showFinancialSaveWarning',
    'clampedCycleIso', 'nextCycleDueDate', 'nextCycleDueDateAfter', 'currentMonthBaseDueDate']) {
    vm.runInContext(named(name), ctx);
  }
  return { ctx, button, output };
}

async function submit(f, formName) {
  const run = vm.runInContext(handler(formName), f.ctx);
  run({ preventDefault() {}, target: {} });
  // Drain the handler's finite promise chain; no real timer/network delay.
  await new Promise(setImmediate);
  if (f.button.disabled) throw new Error('Handler did not settle');
}

(async () => {
  const renewal = setup({ renewAmount: '500', renewDate: '2026-10-16' });
  await submit(renewal, 'renewForm');
  const afterFailure = JSON.parse(JSON.stringify(renewal.ctx.state));
  await submit(renewal, 'renewForm');
  const attempted = renewal.output.attemptedPayments;
  const extra = setup({ description: 'Synthetic extra', amount: '500',
    chargeDate: '2026-10-16', billingType: 'one_time', chargePaid: 'on' });
  await submit(extra, 'addChargeForm');
  // Actual persist() resolves after reporting a refused client-row conflict.
  // That fulfillment lets the renewal promise chain continue to payment.
  const conflict = setup({ renewAmount: '500', renewDate: '2026-10-16' });
  Object.assign(conflict.ctx, {
    leadForSheet: (row) => row, clientForSheet: (row) => row,
    apiSave: async () => ({ ok: true, conflicts: [{ id: 'fixture-client' }] }),
    showConflictBanner() { conflict.output.conflictShown = true; },
    hideConflictBanner() {}, loadAll: async () => {}, console
  });
  conflict.ctx.state.leads = [];
  vm.runInContext(named('conflictsMessage'), conflict.ctx);
  vm.runInContext(named('persist'), conflict.ctx);
  await submit(conflict, 'renewForm');
  process.stdout.write(JSON.stringify({
    diagnosticOnly: true,
    sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
    renewal: {
      retryChangesPaymentId: attempted[0].id !== attempted[1].id,
      attemptedPaymentIds: attempted.map((p) => p.id),
      attemptedDueDates: attempted.map((p) => p.dueDate),
      nextBillingDateAfterFailedPayment: afterFailure.clients[0].nextBillingDate,
      paymentRowsAfterFailure: afterFailure.payments.length,
      nextBillingDateAfterRetry: renewal.ctx.state.clients[0].nextBillingDate
    },
    addCharge: {
      sourceChargeSaved: !!extra.output.savedCharge,
      sourcePaymentRejected: true,
      optimisticPaidRowRetained: extra.ctx.state.payments.some((p) => p.status === 'paid'),
      finalNotice: extra.output.notices.at(-1),
      modalClosed: extra.output.closed
    },
    renewalAfterClientConflict: {
      refusalBannerShown: !!conflict.output.conflictShown,
      paymentAttemptsAfterRefusal: conflict.output.attemptedPayments.length
    },
    limits: 'Synthetic handler execution; not a browser or production-data check. OP-02b1 fixes false confirmations and dependent conflict writes; durable renewal recovery remains open.'
  }, null, 2) + '\n');
})().catch((error) => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
