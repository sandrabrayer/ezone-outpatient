'use strict';

/* OP-ID-2 — browser source guard (public/app.js is a browser IIFE, so this
 * scans the shipped source like the other app.js guards):
 *   - to_outpatient no longer builds a lead from roster PII nor pushes it
 *     through persist(); it calls the server orchestration;
 *   - the VM carries the roster's stable ids and joins persisted rows by
 *     dashboardPatientId first, legacy key second (legacy rows still render);
 *   - an ordinary save sends the stable id and never name/house/entryDate/
 *     outcomeDate as authority;
 *   - a roster row without an id fails visibly, no PII fallback;
 *   - the manual add-lead / duplicate modal outside continuation is untouched. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const CL = require('../public/continuation-logic.js');
const CI = require('../lib/continuation-identity.js');

function fn(name) {
  const i = APP.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name + ' missing');
  // up to the next top-level "\n  function " / "\n  var " at the same indent
  const rest = APP.slice(i);
  const m = rest.slice(1).search(/\n  (async )?function |\n  var /);
  return m === -1 ? rest : rest.slice(0, m + 1);
}

test('to_outpatient: the manual lead-creation path is gone from the continuation flow', () => {
  assert.equal(APP.includes('function continuationCreateLead('), false, 'continuationCreateLead must be removed');
  assert.equal(APP.includes("source: 'מסלול המשך'"), false, 'browser no longer mints a continuation lead');
  const confirm = APP.slice(APP.indexOf("on('#continuationToOutpatientConfirm'"), APP.indexOf("on('#addClientBtn'"));
  assert.match(confirm, /continuationToOutpatient\(vm, p\.meetingDate, p\.note\)/);
  assert.equal(/persist\(\)/.test(confirm), false);
  assert.equal(/state\.leads\.push/.test(confirm), false);
  const flow = fn('continuationToOutpatient') + fn('apiContinuationToOutpatient');
  assert.match(flow, /apiFetch\('\/api\/continuation\/to-outpatient'/);
  assert.match(flow, /dashboardPatientId: vm\.dashboardPatientId/);
  assert.equal(/state\.leads\.push|persist\(\)|uid\(\)/.test(flow), false, 'no local lead creation');
  assert.match(flow, /loadAll\(\)/, 'core Leads/Clients are refreshed after success');
  assert.match(flow, /continuationIdentityMissing\(vm\)/);
});

test('VM: carries roster id/personId and joins persisted rows by dashboardPatientId first, legacy key fallback', () => {
  const render = fn('renderContinuation');
  assert.match(render, /var dashboardPatientId = String\(p\.id \|\| ''\)\.trim\(\);/);
  assert.match(render, /dashboardPersonId: String\(p\.personId \|\| ''\)\.trim\(\)/);
  assert.match(render, /var row = \(dashboardPatientId && byId\[dashboardPatientId\]\) \|\| safeLegacy;/);
  assert.match(render, /legacyId === dashboardPatientId/);
  assert.match(render, /CL\.buildKey\(name, house, entryDate\)/, 'legacy key still computed for id-less rows');
  // the two key builders agree byte-for-byte
  assert.equal(CL.buildKey(' דנה כהן ', 'ramot', '2026-10-01 '), CI.buildKey(' דנה כהן ', 'ramot', '2026-10-01 '));
});

test('ordinary save: sends the stable id + workflow fields only; identity/PII and outcomeDate are not sent as authority', () => {
  const save = fn('saveContinuationRow');
  const rowLiteral = save.slice(save.indexOf('var row = {'), save.indexOf('};', save.indexOf('var row = {')));
  assert.match(rowLiteral, /dashboardPatientId: vm\.dashboardPatientId/);
  assert.match(rowLiteral, /meetingDate: patch\.meetingDate/);
  assert.match(rowLiteral, /outcome: outcome/);
  assert.match(rowLiteral, /note: patch\.note/);
  for (const k of ['name:', 'house:', 'entryDate:', 'outcomeDate:', 'phone:', 'outpatientId:', 'assignedTo:']) {
    assert.equal(rowLiteral.includes(k), false, k + ' must not be in the save payload');
  }
  assert.match(save, /continuationIdentityMissing\(vm\)/, 'id-less roster rows fail visibly before any save');
  assert.match(save, /if \(res && res\.row\) upsertContinuationLocal\(res\.row\)/, 'server row (with stamps/ids) replaces the optimistic one');
});

test('identity missing: visible Hebrew failure, no PII fallback', () => {
  const miss = fn('continuationIdentityMissing');
  assert.match(miss, /if \(vm && vm\.dashboardPatientId\) return false;/);
  assert.match(miss, /toast\('חסר מזהה מטופל מהדשבורד/);
  assert.match(APP, /continuation_identity_unavailable: '/, 'server error codes have Hebrew texts');
  assert.match(APP, /continuation_link_save_failed: '/);
  assert.match(APP, /possible_duplicate: '/);
});

test('local upsert matches by dashboardPatientId first, key second (legacy rows keep rendering)', () => {
  const up = fn('upsertContinuationLocal');
  assert.match(up, /String\(r\.dashboardPatientId \|\| ''\)\.trim\(\) === rid/);
  assert.match(up, /String\(r\.key \|\| ''\)\.trim\(\) === key/);
});

test('outside continuation: the manual add-lead path and duplicate modal are untouched', () => {
  assert.match(APP, /function openDuplicateLeadModal\(/);
  assert.match(APP, /function addLeadFromForm\(|function openLeadModal\(/);
  const dupUses = (APP.match(/openDuplicateLeadModal\(/g) || []).length;
  assert.ok(dupUses >= 2, 'duplicate modal still used by the manual lead form');
});
