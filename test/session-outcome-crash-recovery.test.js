'use strict';
// Crash-consistency regression for the real OUT Apps Script. Only synthetic sheets.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../test-support/apps-script-sandbox.js');
function setup() {
  const s = sandbox([], [{id:'patient-credit',name:'Synthetic Participant',phone:'0501234567',
    clinicalTreatmentType:'קבוצה', serviceType:'קבוצה', creditsOwed:0, sessionsPerWeek:'1'}]);
  s.props.SESSION_OUTCOME_SECRET='synthetic-credit-secret';
  const send=(outcome,rev='2026-11-20T10:00:00.000Z')=>s.post({
    action:'recordSessionOutcome', secret:'synthetic-credit-secret',
    sessionId:'shared-session-credit-100',treatmentId:'group-booking-credit-100',
    phone:'0501234567',therapist:'Synthetic Group Therapist',
    clinicalTreatmentType:'קבוצה',date:'2026-11-20',
    outcome,reportRevision:rev
  });
  const credit=()=>Number(s.rows('Clients')[0].creditsOwed);
  const log=()=>s.rows('SessionLog');
  const journal=()=>s.rows('SessionOutcomeOps');
  return {s,send,credit,log,journal};
}
function failOnce(obj,method,predicate=()=>true) {
  const original=obj[method];let armed=true;
  obj[method]=function(...args){if(armed&&predicate(...args)){armed=false;throw Error('synthetic interrupted write');}return original.apply(this,args);};
  return ()=>{obj[method]=original;};
}
test('group credit: lost SessionLog append resumes without a second credit',()=>{
  const t=setup();
  // Create the sheet BEFORE injecting an exception at the exact second side effect.
  t.s.ctx._ensureSheet('SessionLog',t.s.ctx.SESSION_LOG_HEADERS);
  const restore=failOnce(t.s.sheets.SessionLog,'appendRow');
  const first=t.send('patient_cancelled_notice');
  restore();
  assert.equal(first.ok,false);
  assert.equal(t.credit(),1,'first side effect did happen');
  assert.equal(t.log().length,0);
  assert.equal(t.journal().length,1);
  assert.equal(t.journal()[0].state,'pending');
  const retry=t.send('patient_cancelled_notice');
  assert.equal(retry.ok,true,JSON.stringify(retry));
  assert.equal(retry.replayed,true);
  assert.equal(t.credit(),1,'a retry did not apply the credit again');
  assert.equal(t.log().length,1);
  assert.equal(t.journal().length,1);
  assert.equal(t.journal()[0].state,'committed');
  assert.equal(t.send('patient_cancelled_notice').ok,true);
  assert.equal(t.credit(),1);
});
test('group credit: interruption before balance write can finish on retry',()=>{
  const t=setup();
  t.s.ctx._ensureSheet('Clients',t.s.ctx.CLIENTS_HEADERS);
  const sh=t.s.sheets.Clients;
  const col=t.s.ctx.CLIENTS_HEADERS.indexOf('creditsOwed')+1;
  const original=sh.getRange;
  let blocked=false;
  sh.getRange=function(r,c,...rest){
    const range=original.call(this,r,c,...rest);
    if(r===2&&c===col&&!blocked){
      const old=range.setValue;
      range.setValue=function(v){blocked=true;throw Error('synthetic interruption before credit write');};
    }
    return range;
  };
  assert.equal(t.send('patient_cancelled_notice').ok,false);
  sh.getRange=original;
  assert.equal(t.credit(),0);
  assert.equal(t.log().length,0);
  assert.equal(t.journal()[0].state,'pending');
  const retry=t.send('patient_cancelled_notice');
  assert.equal(retry.ok,true,JSON.stringify(retry));
  assert.equal(t.credit(),1);
  assert.equal(t.log().length,1);
});
test('correction from happened to credited is also crash-consistent',()=>{
  const t=setup();
  assert.equal(t.send('happened').ok,true);
  assert.equal(t.credit(),0);
  assert.equal(t.log()[0].outcome,'happened');
  const sheet=t.s.sheets.SessionLog;
  const orig=sheet.getRange;
  let blocked=false;
  sheet.getRange=function(r,c,...rest) {
    const range=orig.call(this,r,c,...rest);
    if(r===2&&c===1&&!blocked){
      const old=range.setValues;
      range.setValues=function(v){blocked=true;throw Error('synthetic interruption during correction');};
    }
    return range;
  };
  const rev='2026-11-20T11:00:00.000Z';
  assert.equal(t.send('patient_cancelled_notice',rev).ok,false);
  sheet.getRange=orig;
  assert.equal(t.credit(),1);
  assert.equal(t.log()[0].outcome,'happened');
  const again=t.send('patient_cancelled_notice',rev);
  assert.equal(again.ok,true,JSON.stringify(again));
  assert.equal(t.credit(),1);
  assert.equal(t.log()[0].outcome,'patient_cancelled_notice');
  assert.equal(t.log().length,1);
  assert.equal(t.journal().length,2);
});
test('unexpected newer client balance blocks pending recovery without overwriting it',()=>{
  const t=setup();
  t.s.ctx._ensureSheet('SessionLog',t.s.ctx.SESSION_LOG_HEADERS);
  const restore=failOnce(t.s.sheets.SessionLog,'appendRow');
  assert.equal(t.send('patient_cancelled_notice').ok,false);
  restore();
  assert.equal(t.credit(),1);
  const creditCol=t.s.ctx.CLIENTS_HEADERS.indexOf('creditsOwed')+1;
  t.s.sheets.Clients.getRange(2,creditCol).setValue(7);
  const retry=t.send('patient_cancelled_notice');
  assert.deepEqual({ok:retry.ok,reason:retry.reason},{ok:false,reason:'session_credit_recovery_pending'});
  assert.equal(t.credit(),7);
  assert.equal(t.log().length,0);
  assert.equal(t.journal()[0].state,'pending');
  const changed=t.send('therapist_cancelled','2026-11-20T11:00:00.000Z');
  assert.equal(changed.reason,'session_credit_recovery_pending');
  assert.equal(t.credit(),7);
  assert.equal(t.journal().length,1);
});
test('lost journal commit after both side effects finalizes by verified readback',()=>{
  const t=setup();
  t.s.ctx._ensureSheet('SessionOutcomeOps',t.s.ctx.SESSION_OUTCOME_OP_HEADERS);
  const sh=t.s.sheets.SessionOutcomeOps, orig=sh.getRange;
  let blocked=false;
  const stateCol=t.s.ctx.SESSION_OUTCOME_OP_HEADERS.indexOf('state')+1;
  sh.getRange=function(r,c,...rest){
    const range=orig.call(this,r,c,...rest);
    if(r>=2&&c===stateCol&&!blocked){
      range.setValue=function(){blocked=true;throw Error('synthetic response lost after writes');};
    }
    return range;
  };
  assert.equal(t.send('patient_cancelled_notice').ok,false);
  sh.getRange=orig;
  assert.equal(t.credit(),1);assert.equal(t.log().length,1);
  assert.equal(t.journal()[0].state,'pending');
  const retry=t.send('patient_cancelled_notice');
  assert.equal(retry.ok,true,JSON.stringify(retry));
  assert.equal(t.credit(),1);assert.equal(t.log().length,1);
  assert.equal(t.journal()[0].state,'committed');
});
