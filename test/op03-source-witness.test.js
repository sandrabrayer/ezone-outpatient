'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const W = require('../ops/op03-source-witness.cjs');
const sha = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
const source = 'function f(){return 1;}\n';
const manifest = '{"timeZone":"Asia/Jerusalem","runtimeVersion":"V8"}\n';
const pins = {
  'Code.gs': {bytes:Buffer.byteLength(source),sha256:sha(source)},
  'appsscript.json': {bytes:Buffer.byteLength(manifest),sha256:sha(manifest)}
};
const content = (changes={}) => ({scriptId: W.SCRIPT_ID, files: [
  {name:'Code',type:'SERVER_JS',source}, {name:'appsscript',type:'JSON',source:manifest}
],...changes});
const project = (changes={}) => ({scriptId:W.SCRIPT_ID,parentId:W.PARENT_ID,updateTime:'2026-10-31T08:00:00Z',...changes});
const cred = (v={}) => JSON.stringify({tokens:{default:{type:'authorized_user',client_id:'client-abc',client_secret:'secret-abc',refresh_token:'refresh-abc',scope:'https://www.googleapis.com/auth/script.projects',...v}}});
const fail = (cb, error) => assert.throws(cb, e=>e instanceof W.WitnessError && e.code===error);

test('literal operation allowlist forbids arbitrary host, URLs, non-HEAD and writes', () => {
  assert.equal(W.allowRequest('GET',W.META_URL),true);
  assert.equal(W.allowRequest('GET',W.CONTENT_URL),true);
  assert.equal(W.allowRequest('POST',W.TOKEN_URL),true);
  for (const [m,u] of [['POST',W.META_URL],['GET',W.CONTENT_URL+'?versionNumber=100'],['GET',W.META_URL+'/updateContent'],['GET','https://evil.example/'],['POST',W.TOKEN_URL+'?other=1'],['PUT',W.CONTENT_URL]]) assert.equal(W.allowRequest(m,u),false);
});

test('clasp 3 credential parsing uses only default; no secret echoed on bad input', () => {
  const c=W.parseClaspCredentials(cred());
  assert.deepEqual(c,{client_id:'client-abc',client_secret:'secret-abc',refresh_token:'refresh-abc'});
  fail(()=>W.parseClaspCredentials('{secret'), 'invalid_credentials');
  fail(()=>W.parseClaspCredentials(JSON.stringify({tokens:{other:{client_id:'abc'}}})), 'unsupported_credentials');
  fail(()=>W.parseClaspCredentials(cred({scope:'https://www.googleapis.com/auth/drive'})), 'insufficient_scope');
  fail(()=>W.parseClaspCredentials(cred({refresh_token:''})), 'invalid_credentials');
});

test('legacy local clasp credential support; unrefreshable legacy-global refuses', () => {
  assert.equal(W.parseClaspCredentials(JSON.stringify({token:{refresh_token:'r'},oauth2ClientSettings:{clientId:'id',clientSecret:'s'}})).refresh_token,'r');
  fail(()=>W.parseClaspCredentials(JSON.stringify({access_token:'legacy-global-only'})), 'unsupported_credentials');
});

test('project script/parent + timestamp must be an exact match', () => {
  assert.equal(W.checkProject(project()), '2026-10-31T08:00:00Z');
  fail(()=>W.checkProject(project({scriptId:'wrong'})), 'project_identity_mismatch');
  fail(()=>W.checkProject(project({parentId:'wrong'})), 'project_identity_mismatch');
  fail(()=>W.checkProject(project({updateTime:''})), 'project_identity_mismatch');
});

test('content inventory validates exact two files, names, types, and source hashes', () => {
  const good=W.inspectContent(content(),pins);
  assert.equal(good.ok,true);
  assert.equal(good.files.length,2);
  assert.equal(good.files.every(x=>x.matchesPinned),true);
  assert.equal(W.inspectContent(content({files:[{name:'Code.gs',type:'SERVER_JS',source},{name:'appsscript.json',type:'JSON',source:manifest}]}),pins).ok,true);
  assert.equal(W.inspectContent(content({files:[{name:'Code',type:'SERVER_JS',source:'changed'}, {name:'appsscript',type:'JSON',source:manifest}]}),pins).ok,false);
  fail(()=>W.inspectContent(content({files:[{name:'Code',type:'SERVER_JS',source}]}),pins), 'source_inventory_mismatch');
  fail(()=>W.inspectContent(content({scriptId:'wrong'}),pins), 'source_inventory_mismatch');
  fail(()=>W.inspectContent(content({files:[{name:'top-secret-patient',type:'SERVER_JS',source}, {name:'appsscript',type:'JSON',source:manifest}]}),pins), 'source_inventory_mismatch');
  fail(()=>W.inspectContent(content({files:[{name:'Code',type:'HTML',source},{name:'appsscript',type:'JSON',source:manifest}]}),pins), 'source_inventory_mismatch');
  fail(()=>W.inspectContent(content({files:[{name:'Code',type:'SERVER_JS',source},{name:'Code',type:'SERVER_JS',source}]}),pins), 'source_inventory_mismatch');
  fail(()=>W.inspectContent(content({files:[{name:'Code',type:'SERVER_JS',source},{name:'appsscript',type:'JSON',source:'broken-json'}]}),pins), 'source_manifest_invalid');
});

test('refresh token response parses bearer and optional scopes', () => {
  assert.equal(W.parseAccessToken({access_token:'abcdef1234',token_type:'Bearer',scope:'https://www.googleapis.com/auth/script.projects'}),'abcdef1234');
  fail(()=>W.parseAccessToken({access_token:'bad',token_type:'Bearer'}), 'token_refresh_failed');
  fail(()=>W.parseAccessToken({access_token:'abcdef1234',token_type:'MAC'}),'token_refresh_failed');
  fail(()=>W.parseAccessToken({access_token:'abcdef1234',scope:'https://www.googleapis.com/auth/drive'}),'insufficient_scope');
});

test('synthetic full flow uses only exact POST token / GET project / GET HEAD / GET project',async()=>{
  const calls=[];
  const fake=async q=>{
    calls.push(q);
    assert.equal(W.allowRequest(q.method,q.url),true);
    if(q.url===W.TOKEN_URL)return{access_token:'fixture-token-abc',token_type:'Bearer'};
    if(q.url===W.META_URL)return project();
    if(q.url===W.CONTENT_URL)return content();
  };
  const report=await W.runWitness({rawCredentials:cred(),request:fake});
  assert.deepEqual(calls.map(q=>[q.method,q.url]),[['POST',W.TOKEN_URL],['GET',W.META_URL],['GET',W.CONTENT_URL],['GET',W.META_URL]]);
  // Test fixture hashes do not equal production pins, so witness safely fails.
  assert.equal(report.ok,false);
  assert.equal(report.files.every(x=>!x.matchesPinned),true);
  const output=JSON.stringify(report);
  assert.ok(!output.includes('fixture-token-abc'));
  assert.ok(!output.includes('secret-abc'));
  assert.ok(!output.includes('function f'));
  assert.ok(!output.includes('patient'));
});

test('synthetic fake GET failure aborts; source timestamp change aborts without output',async()=>{
  const fake=async q=>{
    if(q.method==='POST')return{access_token:'fixture-token-abc'};
    if(q.url===W.META_URL) return project({parentId:'wrong'});
    return content();
  };
  await assert.rejects(W.runWitness({rawCredentials:cred(),request:fake}),{code:'project_identity_mismatch'});
  let n=0;
  const drift=async q=>{
    if(q.method==='POST')return{access_token:'fixture-token-abc'};
    if(q.url===W.CONTENT_URL)return content();
    return project({updateTime: n++ ? '2026-10-31T08:00:01Z' : '2026-10-31T08:00:00Z'});
  };
  await assert.rejects(W.runWitness({rawCredentials:cred(),request:drift}),{code:'source_changed_during_read'});
});

test('direct run is disabled in PRs / pushes / wrong ref / missing explicit token',()=>{
  const valid={OP03_SOURCE_WITNESS_ENABLE:'YES_READ_ONLY_ONCE',GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/claude/youthful-volta-laarnk',GITHUB_REPOSITORY:'sandrabrayer/ezone-outpatient'};
  assert.equal(W.canExecute(valid),true);
  for(const [k,v] of [['OP03_SOURCE_WITNESS_ENABLE',''],['GITHUB_REF','refs/pull/139/merge'],['GITHUB_EVENT_NAME','pull_request'],['GITHUB_ACTIONS','false'],['GITHUB_REPOSITORY','other/repo']])assert.equal(W.canExecute({...valid,[k]:v}),false);
});
