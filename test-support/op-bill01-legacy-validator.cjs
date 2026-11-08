'use strict';
// Verbatim _finIntentError from deployed base 98c49c72396b76082498826ab7aa51890b89e9cb.
// Frozen transition fixture, not a second policy implementation.
// Function SHA256: a369ab267deae76deb8597ee77bf8f65632035b01b2bbda2b4d28618dc1a1b27
module.exports = String.raw`function _finIntentError(intent, c, stored) {
  var p = intent.payment, patch = intent.patch;
  if (!intent.cycleDate || _coverageDateISO(intent.cycleDate) !== intent.cycleDate ||
      (!stored && intent.cycleDate !== _finDue(c)) || patch.nextBillingDate !== _finNext(c, intent.cycleDate)) return 'renewal_period_changed';
  if (!patch.paymentDate || _coverageDateISO(patch.paymentDate) !== patch.paymentDate ||
      p.paymentDate !== patch.paymentDate || !isFinite(Number(patch.pricePerSession)) ||
      Number(patch.pricePerSession) <= 0 || String(Number(patch.pricePerSession)) !== patch.pricePerSession ||
      p.id !== 'pay::' + intent.clientId + '::base::' + intent.cycleDate.slice(0, 7) ||
      p.clientId !== intent.clientId || p.dueDate !== intent.cycleDate || p.status !== 'paid' ||
      p.billingType !== 'monthly' || p.amountDue !== patch.pricePerSession || p.amountPaid !== patch.pricePerSession ||
      (p.bundleSize !== '' && p.bundleSize !== '0') || (p.sessionsUsed !== '' && p.sessionsUsed !== '0') ||
      _coveragePeriodError(p.coverageStart, p.coverageEnd)) return 'invalid_renewal_payment';
  if (_hasOwn(patch, 'sessionsPerWeek') !== _hasOwn(patch, 'packageChangeDate')) return 'invalid_renewal_package';
  if (_hasOwn(patch, 'sessionsPerWeek')) {
    var sessions, services = String(c.serviceType || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    try { sessions = JSON.parse(patch.sessionsPerWeek); } catch (_) { return 'invalid_renewal_package'; }
    if (!sessions || Array.isArray(sessions) || typeof sessions !== 'object' || patch.packageChangeDate !== patch.paymentDate ||
        Object.keys(sessions).some(function (k) {
          if (k === '_units') return !sessions[k] || typeof sessions[k] !== 'object' || Array.isArray(sessions[k]) ||
            Object.keys(sessions[k]).some(function (s) { return services.indexOf(s) < 0 || ['שבוע', 'חודש'].indexOf(sessions[k][s]) < 0; });
          return services.indexOf(k) < 0 || typeof sessions[k] !== 'number' || !isFinite(sessions[k]) || sessions[k] < 0 || Math.floor(sessions[k]) !== sessions[k];
        })) return 'invalid_renewal_package';
  }
  return '';
}`;
