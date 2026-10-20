'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {build} = require('../test-support/build-google-operational-drill.cjs');
const {runtime} = require('../test-support/google-drill-sandbox.cjs');
const id='isolated-synthetic-project-0123456789';
const compiled=build({scriptId:id});
function start(){return runtime(compiled.output,id);}
function restore(r){r.ctx.prepareOperationalDrill();r.ctx.captureOperationalDrill();r.ctx.restoreOperationalDrill();}

test('checked-in drill is reproducible and fails closed before native access until an isolated project is pinned',()=>{
  assert.equal(build().output,fs.readFileSync(path.join(__dirname,'../test-support/google-operational-drill.gs'),'utf8'));
  const r=runtime(build().output,id);
  assert.throws(()=>r.ctx.prepareOperationalDrill(),/Wrong isolated script project/);
  assert.equal(r.events.length,0);assert.equal(Object.keys(r.props).length,0);
});
test('builder refuses the production project and malformed project IDs',()=>{
  const prod=JSON.parse(fs.readFileSync(path.join(__dirname,'../.clasp.json'),'utf8')).scriptId;
  for(const scriptId of [prod,'short','a'.repeat(31)+'\n'])assert.throws(()=>build({scriptId}),/isolated Apps Script/);
});
test('wrong project and bound projects cannot create or read fixture workbooks',()=>{
  const wrong=runtime(compiled.output,'another-project');assert.throws(()=>wrong.ctx.prepareOperationalDrill(),/Wrong isolated/);
  const bound=start();bound.bind();assert.throws(()=>bound.ctx.prepareOperationalDrill(),/Standalone/);
  assert.equal(wrong.events.length+bound.events.length,0);
});
test('real generated helpers restore nonempty sessions and both journals, retry without duplicate effects, and preserve unknown tabs while refusing certification',()=>{
  const r=start();restore(r);
  assert.equal(r.ctx.verifyOperationalDrill().phase,'verified');
  assert.equal(r.ctx.verifyManualTabDrill().phase,'manual_block_verified');
  assert.equal(Object.keys(r.books).length,3);
  assert.equal(r.props.OP03_DRILL_FIXTURE_OUTPATIENT_RECOVERY_HOLD,undefined);
  const report=r.books[r.state().ids.backup].getSheetByName('_DrillReport').getDataRange().getValues();
  assert.equal(report.length,6);assert.ok(report.slice(1).every(row=>row[2]==='PASS'));
  assert.equal(r.logs.length,5);assert.ok(r.logs.every(s=>JSON.parse(s).productionCertified===false));
});
test('phase order, repeated prepare, an active run and source-hash drift reject before workbook access',()=>{
  const r=start();assert.throws(()=>r.ctx.captureOperationalDrill(),/state, order/);
  r.ctx.prepareOperationalDrill();const original=r.props.OP03_DRILL_STATE,count=r.events.length;
  assert.throws(()=>r.ctx.prepareOperationalDrill(),/already exists/);
  assert.throws(()=>r.ctx.restoreOperationalDrill(),/state, order/);
  for(const change of [{running:true},{sourceHash:'wrong'},{drillHash:'changed-fixtures-or-wrapper'},{failed:true}]){
    r.props.OP03_DRILL_STATE=JSON.stringify({...JSON.parse(original),...change});
    assert.throws(()=>r.ctx.captureOperationalDrill(),/state, order/);
  }
  assert.equal(r.events.length,count);
});
test('renaming a fixture workbook stops before any cell access and retains failure evidence',()=>{
  const r=start();r.ctx.prepareOperationalDrill();r.books[r.state().ids.source].rename('EZONE OUTPATIENT');
  const count=r.events.length;assert.throws(()=>r.ctx.captureOperationalDrill(),/name mismatch/);
  assert.equal(r.state().failed,true);assert.ok(r.events.slice(count).every(e=>e[0]==='open'));
});
test('cache failure prevents completion, preserves the hold and refuses automatic phase retry',()=>{
  const r=start();restore(r);r.faults.cache=true;
  assert.throws(()=>r.ctx.verifyOperationalDrill(),/cache invalidation failed/);
  assert.equal(r.props.OP03_DRILL_FIXTURE_OUTPATIENT_RECOVERY_HOLD,'1');
  assert.equal(r.state().phase,'restored');assert.equal(r.state().failed,true);
  assert.throws(()=>r.ctx.verifyOperationalDrill(),/state, order/);
});
