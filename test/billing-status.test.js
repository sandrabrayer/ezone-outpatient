/**
 * Tests for the payment-status / stop-treatment-alert rule.
 *
 * Run with:  npm test     (uses Node's built-in test runner, Node >= 18)
 *
 * The central regression these tests guard against:
 *   A patient with an EMPTY payment status (a legacy record created before
 *   the field existed) must NOT be flagged as a billing problem, because
 *   in this clinic every patient who started treatment has paid.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hasBillingProblem, resolvePaymentStatus } = require('../public/billing-status');

test('legacy patient with empty status is NOT a billing problem (the bug)', () => {
  assert.equal(hasBillingProblem({ paymentStatus: '' }), false);
  assert.equal(hasBillingProblem({ paymentStatus: null }), false);
  assert.equal(hasBillingProblem({ paymentStatus: undefined }), false);
  assert.equal(hasBillingProblem({}), false);
  assert.equal(hasBillingProblem({ paymentStatus: '   ' }), false);
});

test('explicitly paid patient is NOT a billing problem', () => {
  assert.equal(hasBillingProblem({ paymentStatus: 'paid' }), false);
  assert.equal(hasBillingProblem({ paymentStatus: 'שולם' }), false);
  assert.equal(hasBillingProblem({ paymentStatus: 'PAID' }), false);
});

test('explicitly partial patient IS a billing problem', () => {
  assert.equal(hasBillingProblem({ paymentStatus: 'partial' }), true);
  assert.equal(hasBillingProblem({ paymentStatus: 'שולם חלקית' }), true);
});

test('explicitly unpaid patient IS a billing problem', () => {
  assert.equal(hasBillingProblem({ paymentStatus: 'unpaid' }), true);
  assert.equal(hasBillingProblem({ paymentStatus: 'לא שולם' }), true);
  assert.equal(hasBillingProblem({ paymentStatus: 'UNPAID' }), true);
});

test('null / undefined client is safely not a problem', () => {
  assert.equal(hasBillingProblem(null), false);
  assert.equal(hasBillingProblem(undefined), false);
});

test('unrecognized garbage status is treated as unknown (not a problem)', () => {
  assert.equal(hasBillingProblem({ paymentStatus: 'banana' }), false);
  assert.equal(resolvePaymentStatus('banana'), '');
});

test('resolvePaymentStatus maps Hebrew and English to canonical ids', () => {
  assert.equal(resolvePaymentStatus('שולם'), 'paid');
  assert.equal(resolvePaymentStatus('paid'), 'paid');
  assert.equal(resolvePaymentStatus('שולם חלקית'), 'partial');
  assert.equal(resolvePaymentStatus('partial'), 'partial');
  assert.equal(resolvePaymentStatus('לא שולם'), 'unpaid');
  assert.equal(resolvePaymentStatus('unpaid'), 'unpaid');
  assert.equal(resolvePaymentStatus(''), '');
  assert.equal(resolvePaymentStatus(null), '');
});
