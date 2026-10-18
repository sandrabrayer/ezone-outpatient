'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sandbox } = require('../test-support/apps-script-sandbox');
const { fixture, failWrite, client } = require('../test-support/renewal-journal-fixture.cjs');
test('renewal stores immutable intent before effects, advances due anchor once, and discovers unacknowledged completion', () => {
  const f = fixture();
  assert.equal(f.reserve().operation.state, 'prepared');
  assert.equal(f.sb.rows('Clients')[0].nextBillingDate, '2026-02-28');
  assert.equal(f.sb.rows('Payments').length, 0);
  assert.equal(f.apply().operation.state, 'done');
  assert.equal(f.sb.rows('Clients')[0].nextBillingDate, '2026-03-31');
  assert.equal(f.sb.rows('Payments').length, 1);
  assert.equal(f.discover().operation.cycleDate, '2026-02-28');
  assert.equal(f.apply().operation.state, 'done');
  assert.equal(f.sb.rows('Payments').length, 1);
  assert.equal(f.ack().operation.state, 'acknowledged');
  assert.equal(f.discover().cycleDate, '2026-03-31');
  assert.equal(f.sb.isLocked(), false);
});
test('same operation id with changed amount or snapshot refuses; second device cannot reserve another period', () => {
  const f = fixture(); f.reserve();
  assert.equal(f.reserve().operation.state, 'prepared');
  f.request.payment.notes = 'different';
  assert.equal(f.reserve().error, 'operation_payload_mismatch');
  f.request.opId = 'second-device-operation';
  assert.match(f.reserve().error, /financial_operation_pending/);
  assert.equal(f.sb.rows('FinancialOps').length, 1);
});
test('empty legacy stamps still require the entire source snapshot; stale client refuses before journal/effects', () => {
  const f = fixture();
  f.sb.sheets.Clients.grid[1][f.sb.ctx.CLIENTS_HEADERS.indexOf('pricePerSession')] = 999;
  assert.equal(f.reserve().error, 'renewal_snapshot_changed');
  assert.equal(f.sb.rows('FinancialOps').length, 0);
  assert.equal(f.sb.rows('Payments').length, 0);
});
for (const id of ['pay::journal-client::base::2026-02', 'pay::journal-client::2026-02']) {
  test('existing legitimate/partial payment is never overwritten: '+id, () => {
    const f = fixture();
    f.sb.seed('Payments', f.sb.ctx.PAYMENTS_HEADERS, [{ ...f.request.payment, id, amountPaid: 150, status: 'partial', method: 'bank' }]);
    const before = f.sb.rows('Payments');
    assert.equal(f.reserve().error, 'renewal_payment_exists');
    assert.deepEqual(f.sb.rows('Payments'), before);
  });
}
const windows = [
  ['FinancialOps', 'client_writing', 'before', 'done'],
  ['FinancialOps', 'client_writing', 'after', 'review'],
  ['Clients', null, 'before', 'review'], ['Clients', null, 'after', 'done'],
  ['FinancialOps', 'client_done', 'before', 'done'], ['FinancialOps', 'client_done', 'after', 'done'],
  ['FinancialOps', 'payment_writing', 'before', 'done'], ['FinancialOps', 'payment_writing', 'after', 'review'],
  ['Payments', null, 'before', 'review'], ['Payments', null, 'after', 'done'],
  ['FinancialOps', 'done', 'before', 'done'], ['FinancialOps', 'done', 'after', 'done']
];
for (const [sheet, stage, when, expected] of windows) {
  test(`crash ${when} ${sheet}/${stage}: reconcile ${expected}, no second cycle/payment`, () => {
    const f = fixture(); f.reserve(); failWrite(f.sb, sheet, stage, when);
    assert.equal(f.apply().ok, false);
    const discovered = f.discover(); assert.equal(discovered.ok, true);
    assert.equal(discovered.operation.cycleDate, '2026-02-28');
    const result = f.apply(); assert.equal(result.ok, true);
    assert.equal(result.operation.state, expected);
    assert.ok(f.sb.rows('Payments').length <= 1);
    assert.ok(['2026-02-28', '2026-03-31'].includes(f.sb.rows('Clients')[0].nextBillingDate));
    assert.equal(f.sb.isLocked(), false);
  });
}
for (const when of ['before','after']) test('reserve response/write lost '+when+' remains recoverable by original identity', () => {
  const f = fixture(); failWrite(f.sb, 'FinancialOps', 'prepared', when);
  assert.equal(f.reserve().ok, false);
  assert.equal(f.reserve().operation.state, 'prepared');
  assert.equal(f.sb.rows('FinancialOps').length, 1);
  assert.equal(f.sb.rows('Payments').length, 0);
});
test('missing client or deleted payment after uncertain write is review, never resurrection', () => {
  const f = fixture(); f.reserve(); failWrite(f.sb, 'Payments', null, 'after'); f.apply();
  f.sb.sheets.Payments.grid.splice(1,1);
  assert.equal(f.apply().operation.state, 'review');
  assert.equal(f.sb.rows('Payments').length, 0);
  const g = fixture(); g.reserve(); g.sb.sheets.Clients.grid.splice(1,1);
  assert.equal(g.discover().operation.state, 'prepared');
  assert.equal(g.apply().operation.state, 'review');
  assert.equal(g.sb.rows('Clients').length, 0);
});
test('completed and acknowledged operation never reapplies after a later legitimate edit/delete', () => {
  const f = fixture(); f.reserve(); f.apply(); f.ack();
  f.sb.sheets.Payments.grid.splice(1,1);
  f.sb.sheets.Clients.grid[1][f.sb.ctx.CLIENTS_HEADERS.indexOf('nextBillingDate')] = '2027-01-01';
  assert.equal(f.apply().operation.state, 'acknowledged');
  assert.equal(f.sb.rows('Payments').length, 0);
  assert.equal(f.sb.rows('Clients')[0].nextBillingDate, '2027-01-01');
});
test('cancellation only before any effects, and retry of cancelled identity cannot apply it', () => {
  const f = fixture(); f.reserve();
  assert.equal(f.sb.post({action:'cancelRenewal',opId:f.request.opId}).operation.state,'cancelled');
  assert.equal(f.apply().operation.state,'cancelled');
  const g=fixture();g.reserve();g.apply();
  assert.equal(g.sb.post({action:'cancelRenewal',opId:g.request.opId}).error,'renewal_requires_review');
});
test('duplicate/corrupt/missing journal fails closed including legacy writes', () => {
  const f=fixture();f.reserve();f.sb.sheets.FinancialOps.grid.push(f.sb.sheets.FinancialOps.grid[1].slice());
  assert.equal(f.discover().ok,false);
  assert.equal(f.sb.post({action:'savePayment',payment:f.request.payment}).ok,false);
  const g=fixture();g.reserve();delete g.sb.sheets.FinancialOps;
  assert.match(g.discover().error,/financial_journal_missing/);
  assert.equal(g.sb.post({action:'savePayment',payment:g.request.payment}).ok,false);
});
for(const action of ['getRenewalState','reserveRenewal','applyRenewal','acknowledgeRenewal','cancelRenewal','resolveRenewalReview']) {
  test(action+' refuses missing/wrong/cross-app credential before reading data',()=>{
    const f=fixture();
    for(const key of ['', 'wrong'])assert.equal(f.sb.post({...f.request,action,proxySecret:key}).error,'unauthorized');
    assert.equal(JSON.parse(f.sb.ctx.doGet({parameter:{action,proxySecret:f.sb.props.OUTPATIENT_PROXY_SECRET}}).getContent()).error,'unauthorized');
  });
}
test('legacy writers, deletion, merge and cell updates respect active reservation inside lock',()=>{
  const f=fixture(); f.reserve();
  const actions=[
    {action:'savePayment',payment:f.request.payment}, {action:'removePayment',id:f.request.payment.id},
    {action:'removePaymentsForClient',clientId:client.id},{action:'removeChargesForClient',clientId:client.id},
    {action:'saveCharge',charge:{id:'charge-x',clientId:client.id,amount:1}},
    {action:'savePaymentAmountOverride',clientId:client.id,paymentId:f.request.payment.id,amount:1},
    {action:'restoreRemovedClient',id:client.id}, {action:'mergeClients',survivorId:client.id,dupIds:['another']},
    {action:'saveAll',leads:[],clients:[],explicitRemovedIds:[client.id]}
  ];
  for(const a of actions){const result=f.sb.post(a);assert.equal(result.ok,false,a.action);assert.match(result.error,/financial_operation_pending/,a.action);assert.equal(f.sb.isLocked(),false);}
  const blocked=f.sb.post({action:'saveAll',leads:[],clients:[{...client,pricePerSession:900}]});
  assert.equal(blocked.ok,true);assert.equal(blocked.conflicts[0].reason,'financial_operation_pending');
  assert.equal(f.sb.rows('Clients')[0].pricePerSession,500);
  assert.equal(f.sb.rows('Payments').length,0);
});

test('manual review requires a fresh observation and an audited reason; never fabricates missing effects', () => {
  const f = fixture(); f.reserve(); failWrite(f.sb, 'Payments', null, 'before'); f.apply(); f.apply();
  let state = f.discover(); assert.equal(state.operation.state, 'review');
  const request = {action:'resolveRenewalReview',opId:f.request.opId,reviewToken:state.operation.review.token,
    acceptCurrent:true,reason:'נבדק: תשלום חסר ויתוקן בגבייה',user:'fixture-reviewer'};
  assert.equal(f.sb.post({...request,user:''}).error,'manual_review_required');
  assert.equal(f.sb.post({...request,reason:'short'}).error,'manual_review_required');
  assert.equal(f.sb.post({...request,acceptCurrent:false}).error,'manual_review_required');
  f.sb.sheets.Clients.grid[1][f.sb.ctx.CLIENTS_HEADERS.indexOf('notes')] = 'manual change after read';
  assert.equal(f.sb.post(request).error,'review_source_changed');
  state=f.discover();request.reviewToken=state.operation.review.token;
  const before=JSON.stringify([f.sb.rows('Clients'),f.sb.rows('Payments')]);
  assert.equal(f.sb.post(request).operation.state,'reviewed');
  assert.equal(JSON.stringify([f.sb.rows('Clients'),f.sb.rows('Payments')]),before);
  const op=f.sb.rows('FinancialOps')[0];
  assert.equal(op.updatedBy,'fixture-reviewer');
  assert.equal(JSON.parse(op.resolution).reason,request.reason);
  assert.equal(JSON.parse(op.resolution).acceptedState.payments.length,0);
  assert.equal(f.apply().operation.state,'reviewed');
  assert.equal(f.sb.post(request).operation.state,'reviewed');
  assert.equal(f.sb.rows('Payments').length,0);
});
test('changed source before acknowledgement or cancellation becomes discoverable review', () => {
  for(const done of [false,true]){
    const f=fixture();f.reserve();if(done)f.apply();
    f.sb.sheets.Clients.grid.splice(1,1);
    const r=f.sb.post({action:done?'acknowledgeRenewal':'cancelRenewal',opId:f.request.opId});
    assert.equal(r.operation.state,'review');
    assert.equal(f.discover().operation.review.clientExists,false);
    assert.equal(f.apply().operation.state,'review');
    assert.equal(f.sb.rows('Clients').length,0);
  }
});
test('journal preimage, postimage and intent corruption fails closed before effects', () => {
  for(const mutate of [
    op=>{const p=JSON.parse(op.after);p.values[2]='another phone';op.after=JSON.stringify(p);},
    op=>{const i=JSON.parse(op.intent);i.payment.amountPaid='1';op.intent=JSON.stringify(i);},
    op=>{const i=JSON.parse(op.intent);i.snapshot='[]';op.intent=JSON.stringify(i);}
  ]){
    const f=fixture();f.reserve();const op=f.sb.rows('FinancialOps')[0];mutate(op);
    f.sb.seed('FinancialOps',f.sb.ctx.FINANCIAL_OP_HEADERS,[op]);
    assert.equal(f.apply().ok,false);assert.equal(f.discover().ok,false);
    assert.equal(f.sb.rows('Clients')[0].nextBillingDate,'2026-02-28');assert.equal(f.sb.rows('Payments').length,0);
  }
});
test('invalid dates, wrong periods, noncanonical money and malformed packages refuse before reservation', () => {
  for(const mutate of [
    r=>{r.patch.paymentDate=r.payment.paymentDate='2026-02-30';},
    r=>{r.patch.paymentDate=r.payment.paymentDate='2026-02-25T00:00:00Z';},
    r=>{r.patch.nextBillingDate='2026-04-30';},
    r=>{r.patch.pricePerSession='0600';},r=>{r.payment.amountPaid=150;},
    r=>{r.patch.sessionsPerWeek='{"פרטני":-1}';r.patch.packageChangeDate='2026-02-25';},
    r=>{r.patch.sessionsPerWeek='{"לא בשירות":2}';r.patch.packageChangeDate='2026-02-25';},
    r=>{r.patch.sessionsPerWeek='{"פרטני":2}';},
    r=>{r.patch.status='לא פעיל';}
  ]){
    const f=fixture();mutate(f.request);assert.equal(f.reserve().ok,false);
    assert.equal(f.sb.rows('FinancialOps').length,0);assert.equal(f.sb.rows('Payments').length,0);
  }
});
test('package change and backdated payment retain the original billing cycle and numeric money', () => {
  const f=fixture();f.request.patch.sessionsPerWeek='{"פרטני":2,"_units":{"פרטני":"חודש"}}';
  f.request.patch.packageChangeDate='2026-02-25';assert.equal(f.reserve().ok,true);assert.equal(f.apply().operation.state,'done');
  const c=f.sb.rows('Clients')[0],p=f.sb.rows('Payments')[0];
  assert.equal(c.sessionsPerWeek,f.request.patch.sessionsPerWeek);assert.equal(c.packageChangeDate,'2026-02-25');
  assert.equal(c.nextBillingDate,'2026-03-31');assert.equal(c.pricePerSession,600);assert.equal(p.amountPaid,600);
});
test('source and executed browser date helpers agree across leap/short months, years, and missing anchors', () => {
  const ui=require('../test-support/financial-ui-fixture.cjs').fixture().ctx;
  const f=fixture();f.sb.ctx._todayISODate=()=> '2026-10-18';
  const cases=[
    {billingDay:31,nextBillingDate:'2026-02-28'}, {billingDay:31,startDate:'2028-01-31'},
    {billingDay:31,nextBillingDate:'2026-12-31'}, {startDate:'2026-01-30'},
    {packageChangeDate:'2026-03-31',paymentDate:'2026-05-01',billingDay:15},
    {paymentDate:'2026-12-31'}, {billingDay:31}, {}
  ];
  for(const c of cases){
    const due=ui.nextRenewalDueDate(c)||ui.currentMonthBaseDueDate(c);
    assert.equal(f.sb.ctx._finDue(c),due,JSON.stringify(c));
    assert.equal(f.sb.ctx._finNext(c,due),ui.nextCycleDueDateAfter(c,due),JSON.stringify(c));
  }
});
test('no-anchor intent remains valid after midnight; the frozen cycle is not recomputed on replay', () => {
  const f=fixture();const c={...client,startDate:'',paymentDate:'',nextBillingDate:'',billingDay:''};
  f.sb.seed('Clients',f.sb.ctx.CLIENTS_HEADERS,[c]);f.sb.ctx._todayISODate=()=> '2026-02-28';
  f.request.snapshot=f.discover().snapshot;f.request.patch.nextBillingDate='2026-03-28';
  assert.equal(f.reserve().ok,true);f.sb.ctx._todayISODate=()=> '2026-03-01';
  assert.equal(f.discover().operation.cycleDate,'2026-02-28');assert.equal(f.apply().operation.state,'done');
});
test('lock contention does not touch journal or client; all guards run within the writer lock', () => {
  const f=fixture();f.sb.lock.tryLock=()=>false;assert.equal(f.reserve().error,'busy');
  assert.equal(f.sb.rows('FinancialOps').length,0);
  const g=fixture();g.reserve();const guard=g.sb.ctx._finGuard;
  g.sb.ctx._finGuard=ids=>{assert.equal(g.sb.isLocked(),true);return guard(ids);};
  assert.match(g.sb.post({action:'savePayment',payment:g.request.payment}).error,/financial_operation_pending/);
});
test('row movement, unrelated writes and legacy owner rebinding cannot overwrite a pending client', () => {
  const f=fixture();f.sb.seed('Clients',f.sb.ctx.CLIENTS_HEADERS,[client,{...client,id:'other',phone:'0500000009'}]);
  f.reserve();
  const rows=f.sb.rows('Clients');rows[1].notes='unrelated allowed';
  assert.equal(f.sb.save([],rows).ok,true);
  f.sb.sheets.Clients.grid.push(f.sb.sheets.Clients.grid.splice(1,1)[0]);
  assert.equal(f.apply().operation.state,'done');assert.equal(f.sb.rows('Payments').length,1);
  f.sb.seed('ClientCharges',f.sb.ctx.CHARGES_HEADERS,[{id:'legacy-charge',clientId:client.id,amount:10}]);
  assert.match(f.sb.post({action:'saveCharge',charge:{id:'legacy-charge',clientId:'other',amount:20}}).error,/financial_operation_pending/);
  assert.match(f.sb.post({action:'removeCharge',id:'legacy-charge'}).error,/financial_operation_pending/);
  assert.equal(f.sb.rows('ClientCharges')[0].amount,10);
});
test('cross-app clinical/deactivation and session credit changes cannot bypass a reservation', () => {
  const f=fixture();f.reserve();
  assert.throws(()=>f.sb.ctx._setClinicalType({phone:client.phone,clinicalTreatmentType:'פרטני CBT'}),/financial_operation_pending/);
  f.sb.props.DEACTIVATE_CLIENT_SECRET='fixture-deactivate';
  assert.throws(()=>f.sb.ctx._deactivateClient({phone:client.phone,secret:'fixture-deactivate'}),/financial_operation_pending/);
  assert.throws(()=>f.sb.ctx._recordSessionOutcome({sessionId:'fixture-session',phone:client.phone,
    clinicalTreatmentType:'פרטני כללי',therapist:'מעיין דלומי',date:'2026-02-25',outcome:'therapist_cancelled'}),/financial_operation_pending/);
  assert.equal(f.sb.rows('SessionLog').length,0);assert.equal(f.sb.rows('Clients')[0].status,'פעיל');
  assert.equal(f.sb.isLocked(),false);
});


test('append-only client schema additions preserve existing intents and new fields across apply/ack', () => {
  for(const done of [false,true]){
    const f=fixture();f.reserve();if(done)f.apply();
    f.sb.ctx.CLIENTS_HEADERS.push('fixtureFutureColumn');
    f.sb.sheets.Clients.grid[0].push('fixtureFutureColumn');
    f.sb.sheets.Clients.grid[1].push('new column must survive');
    assert.equal(f.discover().operation.cycleDate,'2026-02-28');
    assert.equal(f.apply().operation.state,'done');
    assert.equal(f.sb.rows('Clients')[0].fixtureFutureColumn,'new column must survive');
    assert.equal(f.ack().operation.state,'acknowledged');
    assert.equal(f.sb.rows('Payments').length,1);
  }
});

test('manual corruption repair respects the original payment-id owner even with an empty clientId', () => {
  const f=fixture();f.reserve();
  const old='fixture'+f.sb.ctx.CORRUPTION_MARK;
  f.sb.seed('Payments',f.sb.ctx.PAYMENTS_HEADERS,[{...f.request.payment,clientId:'',notes:old}]);
  f.sb.seed(f.sb.ctx.REPAIR_PLAN_SHEET,f.sb.ctx.REPAIR_PLAN_HEADERS,[{action:'repair',sheet:'Payments',row:2,column:'notes',oldValue:old,newValue:'repaired fixture',approved:true}]);
  assert.throws(()=>f.sb.ctx.applyCorruptedRowRepairsNow(),/financial_operation_pending/);
  assert.equal(f.sb.rows('Payments')[0].notes,old);assert.equal(f.sb.isLocked(),false);
});
