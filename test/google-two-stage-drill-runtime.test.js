'use strict';
// Execute the generated actual native-entrypoint functions with the existing
// in-memory Google service double. This is NOT real Google time acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../test-support/build-google-two-stage-drill.cjs');
const { runtime } = require('../test-support/google-drill-sandbox.cjs');
const scriptId = 'isolated-op03-script-0123456789-aBcDeFgHi';
function start() { return runtime(build({scriptId}).output,scriptId); }
function state(r) { return JSON.parse(r.props.OP03_NATIVE_V3_STATE); }

test('native A/B wrapper actually exercises source, independent v3 certificate and physical isolated restore', () => {
  const r = start();
  const prepared = r.ctx.prepareTwoStageDrill();
  assert.equal(prepared.stage, 'prepared');
  assert.equal(Object.keys(r.books).length,3);
  assert.equal(state(r).scaleTabs,0);
  // Existing mock runtime has no production-sized Google timing model; skip
  // repetitive scaling only in this synthetic unit test, NOT in native Gate 0.
  const s=state(r);s.scaleTabs=350;r.props.OP03_NATIVE_V3_STATE=JSON.stringify(s);
  assert.equal(r.ctx.captureTwoStageDrill().stage,'captured');
  assert.ok(r.props.OP03_NATIVE_V3_INTEGRITY_PENDING_BACKUP);
  assert.equal(r.props.OP03_NATIVE_V3_INTEGRITY_LAST_COUNT,undefined);
  assert.equal(r.ctx.verifyTwoStageDrill().stage,'verified');
  assert.equal(r.props.OP03_NATIVE_V3_INTEGRITY_PENDING_BACKUP,undefined);
  assert.ok(r.props.OP03_NATIVE_V3_INTEGRITY_LAST_RUN);
  const restored = r.ctx.restoreTwoStageDrill();
  assert.equal(restored.stage,'restored_readback');
  assert.equal(state(r).failed,false);
  assert.ok(r.logs.some(x=>JSON.parse(x).productionCertified===false));
});
test('wrong project and spreadsheet-bound project refuse before any book write', () => {
  const wrong=runtime(build({scriptId}).output,'different-id');
  assert.throws(()=>wrong.ctx.prepareTwoStageDrill(),/Wrong isolated/);
  assert.equal(wrong.events.length,0);
  const bound=start();bound.bind();
  assert.throws(()=>bound.ctx.prepareTwoStageDrill(),/standalone/);
  assert.equal(bound.events.length,0);
});
test('re-running prepare in same project is rejected without resetting private evidence',()=>{
  const r=start();r.ctx.prepareTwoStageDrill();
  const before=r.events.length;
  assert.throws(()=>r.ctx.prepareTwoStageDrill(),/fresh empty standalone project/);
  assert.equal(r.events.length,before);
});
