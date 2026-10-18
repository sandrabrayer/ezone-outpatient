'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture,failWrite,client}=require('../test-support/extra-charge-journal-fixture.cjs');
const renewal=require('../test-support/renewal-journal-fixture.cjs');
for(const monthly of [false,true]) for(const paid of [false,true]) for(const chargeDate of ['2025-12-01','2026-12-01']) {
  test(`extra ${monthly?'monthly':'once'} ${paid?'paid':'unpaid'} start=${chargeDate}: frozen original intent, no client mutation`,()=>{
    const f=fixture({monthly,paid,chargeDate}), before=f.sb.rows('Clients');
    assert.equal(f.reserve().operation.state,'prepared');
    assert.equal(f.sb.rows('ClientCharges').length,0);
    f.sb.ctx._todayISODate=()=> '2026-11-01';
    assert.equal(f.apply().operation.state,'done');
    assert.deepEqual(f.sb.rows('Clients'),before);
    assert.equal(f.sb.rows('ClientCharges').length,1);
    const ch=f.sb.rows('ClientCharges')[0];
    assert.equal(ch.treatmentType,'פרטני CBT');assert.equal(ch.frequencyPerWeek,monthly?2:'');
    assert.equal(ch.chargeDate,chargeDate);assert.equal(ch.created,'2026-10-31');assert.equal(ch.amount,500);
    assert.equal(f.sb.rows('Payments').length,paid?1:0);
    if(paid){const p=f.sb.rows('Payments')[0];assert.equal(p.id,f.request.payment.id);assert.equal(p.billingType,'extra');
      assert.equal(p.dueDate,'2026-10-31');assert.equal(p.paymentDate,'2026-10-31');
      assert.equal(p.bundleSize,0);assert.equal(p.sessionsUsed,0);assert.equal(p.amountPaid,500);
      // Existing initial-charge UI uses billingType extra for both variants,
      // so its actual shared coverage writer stamps a month for both.
      assert.equal(p.coverageStart,'2026-10-31');assert.equal(p.coverageEnd,'2026-11-29');}
    assert.equal(f.discover().operation.id,f.request.opId);
    assert.equal(f.ack().operation.state,'acknowledged');
    assert.equal(f.apply().operation.state,'acknowledged');assert.equal(f.sb.rows('ClientCharges').length,1);
    assert.equal(f.discover().cycleDate,'2026-11-01');assert.equal(f.sb.isLocked(),false);
  });
}
const windows=[['FinancialOps','charge_writing','before','done'],['FinancialOps','charge_writing','after','review'],
  ['ClientCharges',null,'before','review'],['ClientCharges',null,'after','done'],
  ['FinancialOps','charge_done','before','done'],['FinancialOps','charge_done','after','done'],
  ['FinancialOps','payment_writing','before','done'],['FinancialOps','payment_writing','after','review'],
  ['Payments',null,'before','review'],['Payments',null,'after','done'],
  ['FinancialOps','done','before','done'],['FinancialOps','done','after','done']];
for(const [sheet,state,when,outcome] of windows) test(`extra crash ${when} ${sheet}/${state}: exact evidence or review`,()=>{
  const f=fixture();f.reserve();failWrite(f.sb,sheet,state,when);
  assert.equal(f.apply().ok,false);assert.equal(f.discover().operation.id,f.request.opId);
  assert.equal(f.apply().operation.state,outcome);
  assert.ok(f.sb.rows('ClientCharges').length<=1);assert.ok(f.sb.rows('Payments').length<=1);
  assert.equal(f.sb.rows('Clients')[0].nextBillingDate,client.nextBillingDate);assert.equal(f.sb.isLocked(),false);
});
for(const when of ['before','after']) test('extra lost reservation '+when+' keeps identity',()=>{
  const f=fixture();failWrite(f.sb,'FinancialOps','prepared',when);assert.equal(f.reserve().ok,false);
  assert.equal(f.reserve().operation.state,'prepared');assert.equal(f.sb.rows('FinancialOps').length,1);
  f.request.charge.amount=999;assert.equal(f.reserve().error,'operation_payload_mismatch');
});
test('extra same client and wrong-kind operations cannot bypass the shared reservation',()=>{
  const f=fixture();f.reserve();const original=f.sb.rows('FinancialOps');
  for(const action of ['applyRenewal','cancelRenewal','acknowledgeRenewal','resolveRenewalReview']){
    assert.equal(f.call(action,{reason:'checked exact data',acceptCurrent:true}).error,'operation_kind_mismatch');
    assert.deepEqual(f.sb.rows('FinancialOps'),original);
  }
  assert.equal(f.call('getRenewalState',{clientId:client.id}).error,'extra_charge_pending');
  f.request.opId='another-extra-operation';assert.match(f.reserve().error,/financial_operation_pending/);
  const g=renewal.fixture();g.reserve();
  for(const action of ['applyExtraCharge','cancelExtraCharge','acknowledgeExtraCharge','resolveExtraChargeReview']){
    assert.equal(g.sb.post({action,opId:g.request.opId,user:'editor',reason:'checked exact data',acceptCurrent:true}).error,'operation_kind_mismatch');
  }
  assert.equal(g.sb.post({action:'getExtraChargeState',clientId:client.id}).error,'renewal_pending');
  assert.equal(g.apply().operation.state,'done');
});
test('stale client including legacy blank stamps fails before reservation',()=>{
  const f=fixture();f.sb.sheets.Clients.grid[1][f.sb.ctx.CLIENTS_HEADERS.indexOf('notes')]='another editor';
  assert.equal(f.reserve().error,'extra_snapshot_changed');assert.equal(f.sb.rows('FinancialOps').length,0);
});
for(const owner of [client.id,'another-client']) test('global charge collision owned by '+owner+' never upserts',()=>{
  const f=fixture();f.sb.seed('ClientCharges',f.sb.ctx.CHARGES_HEADERS,[{...f.request.charge,clientId:owner,amount:777}]);
  assert.equal(f.reserve().error,'extra_effect_exists');assert.equal(f.sb.rows('ClientCharges')[0].amount,777);
});
test('payment collisions, partial payments and other-month rows are never overwritten',()=>{
  for(const phase of ['reserve','apply']){
    const f=fixture({monthly:true});if(phase==='apply')f.reserve();
    f.sb.seed('Payments',f.sb.ctx.PAYMENTS_HEADERS,[{...f.request.payment,id:f.request.payment.id.replace('2026-10','2026-11'),amountPaid:100,status:'partial'}]);
    assert.equal(phase==='reserve'?f.reserve().error:f.apply().operation.state,phase==='reserve'?'extra_effect_exists':'review');
    assert.equal(f.sb.rows('Payments')[0].amountPaid,100);assert.equal(f.sb.rows('ClientCharges').length,0);
  }
});
for(const sheet of ['Clients','ClientCharges','Payments']) test('deleted '+sheet+' after uncertain write is not resurrected',()=>{
  const f=fixture();f.reserve();failWrite(f.sb,'Payments',null,'after');f.apply();f.sb.sheets[sheet].grid.splice(1,1);
  assert.equal(f.apply().operation.state,'review');assert.equal(f.sb.rows(sheet).length,0);
});
test('unpaid creation never creates payment; completion acknowledgement rechecks charge and client',()=>{
  const f=fixture({paid:false});f.reserve();assert.equal(f.ack().error,'extra_state_not_ready');
  assert.equal(f.discover().operation.state,'prepared');f.apply();
  f.sb.sheets.ClientCharges.grid[1][3]=123;assert.equal(f.ack().operation.state,'review');assert.equal(f.sb.rows('Payments').length,0);
});
test('explicit cancellation has no effects and terminal replay never repeats later-deleted effects',()=>{
  const f=fixture();f.reserve();assert.equal(f.call('cancelExtraCharge').operation.state,'cancelled');
  assert.equal(f.apply().operation.state,'cancelled');assert.equal(f.sb.rows('ClientCharges').length,0);
  const g=fixture();g.reserve();g.apply();g.ack();g.sb.sheets.ClientCharges.grid.splice(1,1);g.sb.sheets.Payments.grid.splice(1,1);
  assert.equal(g.apply().operation.state,'acknowledged');assert.equal(g.sb.rows('ClientCharges').length,0);
});
test('review closes only exact observed data with signed user, reason and acceptance, never repairs money',()=>{
  const f=fixture();f.reserve();failWrite(f.sb,'FinancialOps','payment_writing','after');f.apply();f.apply();
  const view=f.discover().operation.review;
  const req={action:'resolveExtraChargeReview',opId:f.request.opId,reason:'checked the missing payment',acceptCurrent:true,reviewToken:view.token};
  assert.equal(f.sb.post(req).error,'manual_review_required');
  const before=[f.sb.rows('Clients'),f.sb.rows('ClientCharges'),f.sb.rows('Payments')];
  assert.equal(f.sb.post({...req,user:'editor',reviewToken:'stale'}).error,'review_source_changed');
  assert.equal(f.sb.post({...req,user:'editor'}).operation.state,'reviewed');
  assert.deepEqual([f.sb.rows('Clients'),f.sb.rows('ClientCharges'),f.sb.rows('Payments')],before);
  assert.equal(f.apply().operation.state,'reviewed');assert.match(f.sb.rows('FinancialOps')[0].resolution,/missing payment/);
});
test('all cooperating charge/payment/client writers guard current and stored owners; unrelated edits proceed',()=>{
  const f=fixture();f.reserve();f.apply();
  const ch=f.sb.rows('ClientCharges')[0],p=f.sb.rows('Payments')[0],c=f.sb.rows('Clients')[0];
  for(const req of [{action:'saveCharge',charge:{...ch,clientId:'different'}},{action:'removeCharge',id:ch.id},
    {action:'savePayment',payment:{...p,clientId:'different'}},{action:'removePayment',id:p.id},
    {action:'removeChargesForClient',clientId:c.id},{action:'removePaymentsForClient',clientId:c.id},
    {action:'setPaymentAmountOverride',clientId:c.id,paymentId:p.id,amount:1}])assert.equal(f.sb.post(req).ok,false,req.action);
  const saved=f.sb.save([],[{...c,notes:'blocked'}]);assert.equal(saved.conflicts[0].reason,'financial_operation_pending');
  assert.equal(f.sb.rows('Clients')[0].notes,c.notes);
  assert.equal(f.sb.post({action:'saveCharge',charge:{...ch,id:'unrelated-charge',clientId:'different'}}).ok,true);
  assert.equal(f.sb.rows('ClientCharges').length,2);
});
test('appended charge fields survive old-tab edits that omit them; explicit blank clears normally',()=>{
  const f=fixture({monthly:true});f.reserve();f.apply();f.ack();const ch=f.sb.rows('ClientCharges')[0];
  const old={...ch};delete old.treatmentType;delete old.frequencyPerWeek;old.notes='older tab';
  assert.equal(f.sb.post({action:'saveCharge',charge:old}).ok,true);
  assert.equal(f.sb.rows('ClientCharges')[0].treatmentType,ch.treatmentType);
  assert.equal(f.sb.rows('ClientCharges')[0].frequencyPerWeek,2);
  assert.equal(f.sb.post({action:'saveCharge',charge:{...old,treatmentType:'',frequencyPerWeek:''}}).ok,true);
  assert.equal(f.sb.rows('ClientCharges')[0].treatmentType,'');
});
for(const action of ['getExtraChargeState','reserveExtraCharge','applyExtraCharge','acknowledgeExtraCharge','cancelExtraCharge','resolveExtraChargeReview']) test(action+' rejects absent/wrong/cross-app keys before Sheets',()=>{
  const f=fixture();f.sb.ctx.SpreadsheetApp.getActiveSpreadsheet=()=>{throw Error('MUST NOT READ');};
  for(const proxySecret of ['',null,'bad'])assert.equal(f.sb.post({action,proxySecret,secret:'cross-app'}).error,'unauthorized');
  const get=JSON.parse(f.sb.ctx.doGet({parameter:{action,proxySecret:f.sb.props.OUTPATIENT_PROXY_SECRET}}).getContent());
  assert.equal(get.error,'unauthorized');
});
test('invalid fields and manipulated journal fail closed without effects',()=>{
  for(const [key,value] of [['amount','NaN'],['amount',-1],['chargeDate','2026-02-30'],['billingDay',32],['billingType','other'],['frequencyPerWeek',2],['treatmentType','unknown']]){
    const f=fixture();f.request.charge[key]=value;assert.equal(f.reserve().ok,false,key);assert.equal(f.sb.rows('ClientCharges').length,0);
  }
  const f=fixture();f.reserve();const idx=f.sb.ctx.FINANCIAL_OP_HEADERS.indexOf('intent');
  const i=JSON.parse(f.sb.sheets.FinancialOps.grid[1][idx]);i.version=2;f.sb.sheets.FinancialOps.grid[1][idx]=JSON.stringify(i);
  assert.equal(f.apply().ok,false);assert.equal(f.sb.post({action:'saveCharge',charge:f.request.charge}).ok,false);
});
test('charge/payment append-only schema additions preserve pending intent and newer cells',()=>{
  const f=fixture();f.reserve();failWrite(f.sb,'Payments',null,'after');f.apply();
  for(const [name,constant] of [['Clients','CLIENTS_HEADERS'],['ClientCharges','CHARGES_HEADERS'],['Payments','PAYMENTS_HEADERS']]){
    f.sb.ctx[constant].push('futureField');f.sb.sheets[name].grid[0].push('futureField');f.sb.sheets[name].grid[1].push('preserve');
  }
  assert.equal(f.apply().operation.state,'done');assert.equal(f.ack().operation.state,'acknowledged');
  for(const name of ['Clients','ClientCharges','Payments'])assert.equal(f.sb.rows(name)[0].futureField,'preserve');
});
test('legacy renewal journal and terminal history remain readable alongside extra-charge history',()=>{
  const r=renewal.fixture();r.reserve();r.apply();r.ack();const f=fixture();
  f.sb.seed('FinancialOps',r.sb.ctx.FINANCIAL_OP_HEADERS,r.sb.rows('FinancialOps'));
  assert.equal(f.reserve().operation.state,'prepared');f.apply();f.ack();
  f.sb.ctx._extraIntentError=()=> 'future policy changed';
  assert.equal(f.discover().ok,true);assert.equal(f.sb.rows('FinancialOps').length,2);
});

test('foreign-owner payment for globally unique charge id blocks creation',()=>{
  const f=fixture();f.sb.seed('Payments',f.sb.ctx.PAYMENTS_HEADERS,[{...f.request.payment,id:f.request.payment.id.replace('journal-client','different-owner'),clientId:'different-owner'}]);
  assert.equal(f.reserve().error,'extra_effect_exists');assert.equal(f.sb.rows('ClientCharges').length,0);
});
test('duplicate effects and changed observation before manual closure remain unresolved',()=>{
  for(const name of ['ClientCharges','Payments']){
    const f=fixture();f.reserve();f.apply();f.sb.sheets[name].grid.push(f.sb.sheets[name].grid[1].slice());
    assert.equal(f.ack().operation.state,'review');const view=f.discover().operation.review;
    f.sb.sheets[name].grid[1][3]='changed';
    assert.equal(f.call('resolveExtraChargeReview',{reason:'Checked against the source',acceptCurrent:true,reviewToken:view.token}).error,'review_source_changed');
    assert.equal(f.sb.rows('FinancialOps')[0].state,'review');assert.equal(f.sb.rows(name).length,2);
  }
});
test('all extra endpoints respect contention without sheet reads or partial effects',()=>{
  const f=fixture();f.sb.lock.tryLock=()=>false;
  f.sb.ctx.SpreadsheetApp.getActiveSpreadsheet=()=>{throw Error('no read under contention');};
  for(const action of ['getExtraChargeState','reserveExtraCharge','applyExtraCharge','acknowledgeExtraCharge','cancelExtraCharge','resolveExtraChargeReview']){
    assert.equal(f.sb.post({...f.request,action,user:'fixture-editor',reason:'checked original records',acceptCurrent:true}).error,'busy');
  }
});
test('source changes just before cancel/ack are discovered rather than hidden by closure',()=>{
  for(const action of ['cancelExtraCharge','acknowledgeExtraCharge']){
    const f=fixture();f.reserve();if(action==='acknowledgeExtraCharge')f.apply();
    f.sb.sheets.Clients.grid[1][f.sb.ctx.CLIENTS_HEADERS.indexOf('notes')]='manual change';
    assert.equal(f.call(action).operation.state,'review');assert.equal(f.discover().operation.state,'review');
  }
});
