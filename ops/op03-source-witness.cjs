'use strict';

/**
 * OP-03 one-shot Apps Script HEAD witness. DRAFT ONLY.
 * No Google access occurs on import. Actual execution requires a separately
 * reviewed, manually dispatched, trusted workflow on the deployed branch.
 * This module never writes Google source/data and never prints source/tokens.
 */
const crypto = require('node:crypto');
const https = require('node:https');

const SCRIPT_ID = '1JSI3Ahqnen0pxi1x5q24nBku8Nk8I5iFNqRC-yMcTv1EDKTh6KhmSuSX';
const PARENT_ID = '17dVBbOuf09c7dug1Tpq9Fr8_3fxfg0M87F9ChkGMCyc';
const SCRIPT_ROOT = 'https://script.googleapis.com/v1/projects/' + SCRIPT_ID;
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const META_URL = SCRIPT_ROOT;
const CONTENT_URL = SCRIPT_ROOT + '/content'; // HEAD: no versionNumber
const PINNED = Object.freeze({
  'Code.gs': Object.freeze({ type: 'SERVER_JS', bytes: 385042, sha256: '5a9c368dec1a59d1644068aa7aa87b9ed02ebbd2f5a0b04f008d97e9ca867f8a' }),
  'appsscript.json': Object.freeze({ type: 'JSON', bytes: 645, sha256: '44bc79cfed3f8f46a3200eb83ee576c59cbcaacdebb0900124d7cd471a2b5d2e' })
});
const READONLY_SCOPE = 'https://www.googleapis.com/auth/script.projects.readonly';
const WRITE_SCOPE = 'https://www.googleapis.com/auth/script.projects';
const AUTHORIZATION = 'OP03_SOURCE_WITNESS_ENABLE';
const AUTHORIZATION_VALUE = 'YES_READ_ONLY_ONCE';
const DEPLOYED_REF = 'refs/heads/claude/youthful-volta-laarnk';

// Fixed errors only: never expose raw errors, HTTP bodies, credentials or PII.
class WitnessError extends Error {
  constructor(code) { super(code); this.name = 'WitnessError'; this.code = code; }
}
const refuse = (code) => { throw new WitnessError(code); };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const digest = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

function parseClaspCredentials(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 256 * 1024) refuse('invalid_credentials');
  let data;
  try { data = JSON.parse(raw); } catch (_) { refuse('invalid_credentials'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) refuse('invalid_credentials');
  // clasp 3.x: tokens.default. clasp 1.x local: token + oauth2ClientSettings.
  // The ancient global shape without client credentials cannot be refreshed
  // safely here; reject instead of embedding OAuth client secrets in source.
  let entry;
  if (data.tokens && own(data.tokens, 'default')) {
    entry = data.tokens.default;
  } else if (data.token && data.oauth2ClientSettings) {
    entry = Object.assign({}, data.token, {
      client_id: data.oauth2ClientSettings.clientId,
      client_secret: data.oauth2ClientSettings.clientSecret
    });
  } else refuse('unsupported_credentials');
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) refuse('invalid_credentials');
  if (entry.type !== undefined && entry.type !== 'authorized_user') refuse('invalid_credentials');
  for (const k of ['client_id', 'client_secret', 'refresh_token']) {
    if (typeof entry[k] !== 'string' || !entry[k] || entry[k].length > 8192) refuse('invalid_credentials');
  }
  const creds = { client_id: entry.client_id, client_secret: entry.client_secret, refresh_token: entry.refresh_token };
  if (typeof entry.scope === 'string' && entry.scope.trim()) {
    const scopes = entry.scope.trim().split(/\s+/);
    if (!scopes.includes(READONLY_SCOPE) && !scopes.includes(WRITE_SCOPE)) refuse('insufficient_scope');
  }
  return creds;
}

function allowRequest(method, url) {
  const key = String(method || '').toUpperCase() + ' ' + String(url || '');
  return key === 'GET ' + META_URL || key === 'GET ' + CONTENT_URL || key === 'POST ' + TOKEN_URL;
}

function safeRequest({ method, url, headers = {}, body = '', maxBytes = 2097152 }) {
  if (!allowRequest(method, url)) return Promise.reject(new WitnessError('request_not_allowlisted'));
  if (method === 'GET' && body) return Promise.reject(new WitnessError('request_not_allowlisted'));
  if (method === 'POST' && url !== TOKEN_URL) return Promise.reject(new WitnessError('request_not_allowlisted'));
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const request = https.request({
      protocol: 'https:', hostname: parsed.hostname, path: parsed.pathname,
      port: 443, method, headers, timeout: 12000, rejectUnauthorized: true
    }, (response) => {
      if (response.statusCode !== 200) { response.resume(); return reject(new WitnessError('remote_refused')); }
      let bytes = 0;
      const chunks = [];
      response.on('data', (buf) => {
        bytes += buf.length;
        if (bytes > maxBytes) {
          response.destroy();
          return reject(new WitnessError('response_too_large'));
        }
        chunks.push(buf);
      });
      response.on('end', () => {
        let parsedBody;
        try { parsedBody = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch (_) { return reject(new WitnessError('invalid_response')); }
        resolve(parsedBody);
      });
      response.on('error', () => reject(new WitnessError('remote_unavailable')));
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => reject(new WitnessError('remote_unavailable')));
    if (body) request.write(body);
    request.end();
  });
}

function parseAccessToken(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response) ||
      typeof response.access_token !== 'string' || response.access_token.length < 8 ||
      response.access_token.length > 8192 ||
      (response.token_type && response.token_type.toLowerCase() !== 'bearer')) refuse('token_refresh_failed');
  if (typeof response.scope === 'string' && response.scope.trim()) {
    const scopes = response.scope.trim().split(/\s+/);
    if (!scopes.includes(READONLY_SCOPE) && !scopes.includes(WRITE_SCOPE)) refuse('insufficient_scope');
  }
  return response.access_token;
}

function checkProject(meta) {
  if (!meta || typeof meta !== 'object' || meta.scriptId !== SCRIPT_ID || meta.parentId !== PARENT_ID ||
      !/^\d{4}-\d\d-\d\dT/.test(String(meta.updateTime || ''))) refuse('project_identity_mismatch');
  return meta.updateTime;
}

function canonicalName(item) {
  if (!item || typeof item.name !== 'string' || typeof item.type !== 'string') return null;
  if ((item.name === 'Code' || item.name === 'Code.gs') && item.type === 'SERVER_JS') return 'Code.gs';
  if ((item.name === 'appsscript' || item.name === 'appsscript.json') && item.type === 'JSON') return 'appsscript.json';
  return null; // Unexpected names are NOT included in the report (could be PII).
}

function inspectContent(content, pins = PINNED) {
  if (!content || content.scriptId !== SCRIPT_ID || !Array.isArray(content.files) || content.files.length !== 2) {
    refuse('source_inventory_mismatch');
  }
  const inventory = [];
  const seen = new Set();
  for (const item of content.files) {
    const name = canonicalName(item);
    if (!name || seen.has(name) || !own(pins, name) || typeof item.source !== 'string' || !item.source) {
      refuse('source_inventory_mismatch');
    }
    seen.add(name);
    if (name === 'appsscript.json') {
      try {
        const manifest = JSON.parse(item.source);
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) refuse('source_manifest_invalid');
      } catch (e) {
        if (e instanceof WitnessError) throw e;
        refuse('source_manifest_invalid');
      }
    }
    const hash = digest(item.source), bytes = Buffer.byteLength(item.source, 'utf8');
    inventory.push({ name, type: item.type, bytes, sha256: hash,
      matchesPinned: bytes === pins[name].bytes && hash === pins[name].sha256 });
  }
  inventory.sort((a, b) => a.name.localeCompare(b.name));
  return {
    ok: inventory.every(f => f.matchesPinned),
    source: 'live_apps_script_HEAD',
    projectMatched: true, parentMatched: true,
    pinnedBaselineMatched: inventory.every(f => f.matchesPinned),
    files: inventory
  };
}

async function runWitness({ rawCredentials, request = safeRequest } = {}) {
  const credentials = parseClaspCredentials(rawCredentials);
  const form = new URLSearchParams({
    client_id: credentials.client_id,
    client_secret: credentials.client_secret,
    refresh_token: credentials.refresh_token,
    grant_type: 'refresh_token'
  }).toString();
  const refreshed = await request({method:'POST',url:TOKEN_URL,
    headers: {'content-type':'application/x-www-form-urlencoded','content-length':Buffer.byteLength(form)},
    body:form,maxBytes:16384});
  const accessToken = parseAccessToken(refreshed);
  const headers = {authorization:'Bearer '+accessToken,accept:'application/json'};
  const firstMeta = await request({method:'GET',url:META_URL,headers,maxBytes:16384});
  const stamp = checkProject(firstMeta);
  const source = await request({method:'GET',url:CONTENT_URL,headers,maxBytes:2097152});
  const latestMeta = await request({method:'GET',url:META_URL,headers,maxBytes:16384});
  if (checkProject(latestMeta) !== stamp) refuse('source_changed_during_read');
  return inspectContent(source);
}

function canExecute(env) {
  return env && env[AUTHORIZATION] === AUTHORIZATION_VALUE &&
    env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
    env.GITHUB_REF === DEPLOYED_REF && env.GITHUB_REPOSITORY === 'sandrabrayer/ezone-outpatient';
}

async function main(env = process.env) {
  if (!canExecute(env)) {
    process.stdout.write(JSON.stringify({ok:false,error:'execution_not_authorized'})+'\n');
    return 1;
  }
  try {
    const report = await runWitness({rawCredentials:env.CLASPRC_JSON});
    process.stdout.write(JSON.stringify(report)+'\n');
    return report.ok ? 0 : 2;
  } catch (err) {
    process.stdout.write(JSON.stringify({ok:false,error:err instanceof WitnessError ? err.code : 'internal_failure'})+'\n');
    return 1;
  }
}

module.exports = { SCRIPT_ID, PARENT_ID, META_URL, CONTENT_URL, TOKEN_URL, PINNED, WitnessError,
  parseClaspCredentials, allowRequest, parseAccessToken, checkProject, canonicalName,
  inspectContent, runWitness, canExecute, main };
if (require.main === module) main().then(code => {process.exitCode = code;}).catch(() => {process.exitCode = 1;});
