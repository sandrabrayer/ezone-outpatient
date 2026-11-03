'use strict';
// Independent acceptance inventory, not derived from _integritySourceSpecs.
// Conditional CRM schemas allow the same tests to qualify pre/post-CRM builds.
const assert = require('node:assert/strict');
const base = ['Clients','Leads','לידים שהוסרו','Clients-removed','Payments',
  'ClientCharges','Credits','FinancialOps','SessionLog','TherapistRates','Settings',
  'StopFlags','ExtraSessionRequests','מסלול המשך','התראות עצירת טיפול',
  'AuditLog','RepairPlan','PackageCatalog','PackageRequests'];
function expectedSources(ctx, extra = []) {
  const crm = Array.isArray(ctx.TASKS_HEADERS) && Array.isArray(ctx.ACTIVITY_HEADERS);
  return [...base, ...(crm ? ['Tasks','Activity'] : []), ...extra, '__RecoveryMetadata'];
}
function assertInventory(ctx, captures, extra = []) {
  assert.deepEqual(Array.from(captures, item => item.source).sort(), expectedSources(ctx, extra).sort());
}
module.exports = { expectedSources, assertInventory };
