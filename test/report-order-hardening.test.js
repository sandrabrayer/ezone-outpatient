'use strict';
/* Run this in the complete OUT checkout, not the selected-source harness.
 * Real Code.gs handlers + synthetic Sheets. No network, bank or live patients. */
const test=require('node:test');
const assert=require('node:assert/strict');
const {sandbox}=require('../test-support/apps-script-sandbox.js');
const SECRET='synthetic-session-order-fixture-only';
const PROXY='synthetic-proxy-order-fixture-only-01234567890123456789';
const A='2026-11-10T10:00:00.111Z', B='2026-11-10T10:05:00.222Z', C='2026-11-10T10:06:00.333Z';
const PHONE='0501234567';
function fixture(){
 const sb=sandbox([], [{id:'synthetic-client-a',name:'Synthetic Patient',phone:PHONE,status:'פעיל',serviceType:'פרטני CBT',sessionsPerWeek:'{"פרטני CBT":1}',pricePerSession:2000,billingType:'monthly',billingDay:5,startDate:'2026-10-01',creditsOwed:0}]);
 sb.props.SESSION_OUTCOME_SECRET=SECRET; sb.props.OUTPATIENT_PROXY_SECRET=PROXY;
 sb.seed('TherapistRates',sb.ctx.THERAPIST_RATES_HEADERS,[{name:'Synthetic Therapist',flatRate:300},{name:'Synthetic Other',flatRate:400}]);
 const event={action:'recordSessionOutcome',secret:SECRET,sessionId:'synthetic-session-a',phone:PHONE,therapist:'Synthetic Therapist',clinicalTreatmentType:'פרטני CBT',date:'2026-11-10',outcome:'happened'};
 const post=body=>JSON.parse(sb.ctx.doPost({parameter:{},postData:{contents:JSON.stringify(body)}}).getContent());
 const send=patch=>post(Object.assign({},event,patch||{}));
 const manual=patch=>{const p=Object.assign({},event,{action:'correctSessionOutcome',proxySecret:PROXY,user:'synthetic-reviewer',moneyScope:'full'},patch||{});delete p.secret;return post(p);};
 const log=()=>sb.rows('SessionLog').filter(r=>r.sessionId===event.sessionId);
 const snapshot=()=>JSON.stringify({log:sb.rows('SessionLog'),clients:sb.rows('Clients')});
 const setCell=(field,value)=>sb.ctx._ensureSheet('SessionLog',sb.ctx.SESSION_LOG_HEADERS).getRange(2,sb.ctx.SESSION_LOG_HEADERS.indexOf(field)+1).setValue(value);
 return {sb,post,send,manual,log,snapshot,setCell,event};
}
function refuse(f,patch,reason){const before=f.snapshot();const res=f.send(patch);assert.equal(res.ok,false,JSON.stringify(res));assert.equal(res.reason,reason);assert.equal(f.snapshot(),before,'SessionLog and client credits unchanged');}

test('source: unversioned external report cannot change an already versioned result',()=>{const f=fixture();assert.equal(f.send({reportRevision:B,outcome:'therapist_cancelled'}).ok,true);refuse(f,{},'invalid_report_revision');});
test('source: equal revision + different outcome is a conflict, not an idempotent replay',()=>{const f=fixture();f.send({reportRevision:A});refuse(f,{reportRevision:A,outcome:'therapist_cancelled'},'source_outcome_conflict');});
for(const [name,patch] of [['therapist',{therapist:'Synthetic Other'}],['patient phone',{phone:'0501234568'}],['date',{date:'2026-11-11'}],['clinical type',{clinicalTreatmentType:'קבוצה',treatmentId:'different-group-treatment-123'}]])test('source: equal revision cannot change '+name,()=>{const f=fixture();f.send({reportRevision:A});refuse(f,Object.assign({reportRevision:A},patch),'source_outcome_conflict');});
test('source: identical replay leaves every recorded field unchanged',()=>{const f=fixture();f.send({reportRevision:A});const before=f.snapshot();const res=f.send({reportRevision:A});assert.equal(res.ok,true);assert.equal(res.replayed,true);assert.equal(f.snapshot(),before);assert.equal(f.log().length,1);});
test('source: old same-day event is refused against a Date-backed precise stored revision',()=>{const f=fixture();f.send({reportRevision:B,outcome:'therapist_cancelled'});f.setCell('reportRevision',new Date(B));const sh=f.sb.ctx._ensureSheet('SessionLog',f.sb.ctx.SESSION_LOG_HEADERS);assert.equal(f.sb.ctx._readAll(sh,f.sb.ctx.SESSION_LOG_HEADERS)[0].reportRevision,B);refuse(f,{reportRevision:A},'stale_report_revision');});
test('source: malformed stored revision requires reconciliation, not inferred order',()=>{const f=fixture();f.send({reportRevision:B});f.setCell('reportRevision','2026-11-10');refuse(f,{reportRevision:C},'invalid_report_revision');});
test('source: day-only, local time, rollover day and non-time values are not valid revisions',()=>{const f=fixture();for(const v of ['2026-11-10','2026-11-10T10:00:00','2026-02-30T10:00:00Z','2026-11-10T24:00:00Z',1,{},'   '])refuse(f,{reportRevision:v},'invalid_report_revision');});
test('source: legacy compatibility ends only after a valid revision is recorded',()=>{const f=fixture();assert.equal(f.send({}).ok,true);assert.equal(f.send({outcome:'therapist_cancelled'}).ok,true);assert.equal(f.send({reportRevision:B}).ok,true);refuse(f,{outcome:'patient_no_show'},'invalid_report_revision');});
test('source: actual authenticated internal correction remains available and preserves sender revision',()=>{const f=fixture();f.send({reportRevision:B});assert.equal(f.manual({outcome:'therapist_cancelled',reportRevision:C}).ok,true);assert.equal(f.log()[0].reportRevision,B);refuse(f,{reportRevision:B},'source_outcome_conflict');});
test('source: JSON flags cannot impersonate internal correction; its proxy key remains required',()=>{const f=fixture();f.send({reportRevision:B});refuse(f,{outcome:'therapist_cancelled',source:'outpatient',origin:'outpatient',user:'synthetic-admin'},'invalid_report_revision');const before=f.snapshot();const rejected=f.send({action:'correctSessionOutcome',outcome:'therapist_cancelled'});assert.equal(rejected.ok,false);assert.equal(rejected.error,'unauthorized');assert.equal(f.snapshot(),before);});
test('source: wrong cross-app secret is refused before revision logic',()=>{const f=fixture();const before=f.snapshot();const r=f.send({secret:'wrong',reportRevision:A});assert.equal(r.ok,false);assert.equal(r.error,'unauthorized');assert.equal(f.snapshot(),before);});
test('source: newer correction retains already-forwarded pay',()=>{const f=fixture();f.send({reportRevision:A});const pay=f.log()[0].therapistPay;f.setCell('forwardedToPayroll','2026-11');assert.equal(f.send({reportRevision:B,outcome:'therapist_cancelled'}).ok,true);assert.equal(f.log()[0].therapistPay,pay);assert.equal(f.log()[0].forwardedToPayroll,'2026-11');assert.equal(Number(f.sb.rows('Clients')[0].creditsOwed),1);});
test('source: frequency-bearing day-centre equal replay is explicitly unprovable in the current schema',()=>{const f=fixture();const p={reportRevision:A,clinicalTreatmentType:'ליווי יומי בקהילה',freqPerWeek:3};assert.equal(f.send(p).ok,true);refuse(f,p,'source_outcome_conflict');});
