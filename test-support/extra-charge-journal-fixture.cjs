'use strict';
const assert = require('node:assert/strict');
const { sandbox } = require('./apps-script-sandbox');
const { client, failWrite } = require('./renewal-journal-fixture.cjs');
const CL = require('../public/credits-ledger');
function fixture({ paid = true, monthly = false, chargeDate = '2026-09-01' } = {}) {
  const sb = sandbox([], [{ ...client }]);
  sb.ctx._todayISODate = () => '2026-10-31';
  const state = sb.post({ action:'getExtraChargeState', clientId:client.id });
  assert.equal(state.ok,true);
  const charge = { id:'extra-fixture-charge', clientId:client.id, description:'טיפול לבדיקה', amount:500,
    billingType:monthly?'monthly':'one_time', chargeDate, billingDay:monthly?31:'', active:'true',
    notes:'בדיקה בלבד', created:state.cycleDate, treatmentType:'פרטני CBT', frequencyPerWeek:monthly?2:'' };
  const payment = paid ? CL.withDefaultCoverage({ id:'pay::'+client.id+'::chg-'+charge.id+'::'+(monthly?'2026-10':'once'),
    clientId:client.id,clientName:client.name,billingType:'extra',dueDate:state.cycleDate,
    amountDue:500,amountPaid:500,status:'paid',paymentDate:state.cycleDate,method:'',notes:'',bundleSize:0,sessionsUsed:0 }) : null;
  const request={action:'reserveExtraCharge',opId:'extra-fixture-operation',clientId:client.id,
    snapshot:state.snapshot,cycleDate:state.cycleDate,charge,payment};
  const call=(action,extra={})=>sb.post({action,opId:request.opId,user:'fixture-editor',...extra});
  return {sb,request,call,reserve:()=>sb.post(request),apply:()=>call('applyExtraCharge'),
    ack:()=>call('acknowledgeExtraCharge'),discover:()=>call('getExtraChargeState',{clientId:client.id})};
}
module.exports={fixture,failWrite,client};
