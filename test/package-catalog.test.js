'use strict';
/* Package catalog / pricing requests (Apps Script side, real Code.gs in a vm).
 * Covers: calculations + VAT rounding, append-only headers, the seed (PDF
 * mapping), the manager/admin secret boundaries, the admin assertion, the
 * allowlist contract (nested financial fields never reach manager outputs or
 * errors), idempotent requests (same id retried long after, conflicts, no
 * window dedupe), revision/op-id replay for adjust/approve/attach, catalog
 * versioning vs. immutable snapshots, and that nothing touches billing. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { sandbox } = require('../test-support/apps-script-sandbox');
const { signAssertion } = require('../lib/catalog-admin');

const CAT = 'package-catalog-secret-0123456789abcdef-A';
const REQ = 'package-request-secret-0123456789abcdef-B';
const ASSERT = 'catalog-admin-assertion-secret-0123456789-C';
const uuid = () => crypto.randomUUID();

function env() {
  const sb = sandbox();
  Object.assign(sb.props, { PACKAGE_CATALOG_SECRET: CAT, PACKAGE_REQUEST_SECRET: REQ, CATALOG_ADMIN_ASSERTION_SECRET: ASSERT });
  return sb;
}
function admin(sb, action, body = {}, opts = {}) {
  const b = { user: 'ורד', ...body };
  const adminAssertion = signAssertion(action, opts.signBody || b, opts.secret || ASSERT, opts.assertion);
  return sb.post({ action, ...b, adminAssertion });
}
const seeded = () => { const sb = env(); assert.equal(admin(sb, 'adminSeedPackageCatalog').ok, true); return sb; };
const epochOf = (sb) => admin(sb, 'adminGetPackageCatalog').catalogEpoch;
function submit(sb, over = {}, secret = REQ) {
  const body = { action: 'createPackageRequest', secret, requestId: uuid(), requesterKey: 'oren', patientName: 'דנה כהן',
    patientPhone: '0501234567', packageKey: 'emdr_core', months: 0, catalogEpoch: epochOf(sb), ...over };
  return JSON.parse(sb.ctx.doPost({ postData: { contents: JSON.stringify(body) }, parameter: {} }).getContent());
}
const status = (sb, params, secret = CAT) => sb.get({ action: 'getPackageRequestStatus', secret, ...params });
const publicCatalog = (sb, secret = CAT) => sb.get({ action: 'getPackageCatalogPublic', secret });
const quote = (sb, packageKey, months, sel) => admin(sb, 'adminQuotePackage',
  { packageKey, ...(months !== undefined ? { months } : {}), ...(sel !== undefined ? { selectedMonthlyAgorot: sel } : {}) });
const firstReq = (sb) => admin(sb, 'adminListPackageRequests').items[0];

/* ---------------- calculations ---------------- */
test('calc: every PDF package computes the documented gross (integer agorot), monthly vs total kept apart', () => {
  const sb = seeded();
  const gross = (k, m) => quote(sb, k, m).quote.grossAgorot;
  assert.equal(gross('emdr_core'), 340000);        // 4 x 850
  assert.equal(gross('emdr_standard'), 680000);    // 8 x 850
  assert.equal(gross('emdr_complex'), 1360000);    // 16 x 850
  assert.equal(gross('emdr_single'), 85000);
  assert.equal(gross('cbt_core'), 300000);         // 6 x 500
  assert.equal(gross('cbt_standard'), 600000);     // 12 x 500
  assert.equal(gross('cbt_complex'), 1000000);     // 20 x 500
  assert.equal(gross('cbt_single'), 50000);
  assert.equal(gross('emdr_cbt_combined'), 850000);// flat, NOT 12 x a rate
  assert.equal(gross('psychiatric_consult'), 90000);
  assert.equal(gross('psychiatric_diagnosis'), 250000);
  assert.equal(gross('day_track_basic', 1), 1500000);
  assert.equal(gross('day_track_extended', 1), 1800000);
  assert.equal(gross('continuation_monthly', 1), 200000);
  const m = quote(sb, 'day_track_basic', 1).quote;
  assert.equal(m.monthlyAgorot, 1500000);
  assert.equal(m.commitmentMonths, 1);
});

test('calc: the 900/1,100 and 2,500/2,300 pairs stay DISTINCT keys; no key equates them', () => {
  const sb = seeded();
  const keys = admin(sb, 'adminGetPackageCatalog').items.map((i) => i.key);
  for (const k of ['psychiatric_consult', 'psychiatric_diagnosis']) assert.ok(keys.includes(k));
  assert.ok(!keys.some((k) => /follow|intake/.test(k)), 'no catalog key silently aliases the billing follow-up/intake services');
});

test('calc: a price RANGE needs Vered\'s selection — never min or midpoint — and is range-checked', () => {
  const sb = seeded();
  const q = quote(sb, 'solo_housing', 3).quote;
  assert.equal(q.needsSelection, true);
  assert.equal(q.grossAgorot, null);
  assert.equal(quote(sb, 'solo_housing', 3, 900000).quote.grossAgorot, 2700000);
  assert.equal(quote(sb, 'solo_housing', 3, 900000).quote.monthlyAgorot, 900000);
  assert.equal(quote(sb, 'solo_housing', 3, 799999).error, 'selection_out_of_range');
  assert.equal(quote(sb, 'solo_housing', 3, 1000001).error, 'selection_out_of_range');
  assert.equal(quote(sb, 'solo_housing', 3, 900000.5).error, 'selection_out_of_range');
  assert.equal(quote(sb, 'solo_housing', 3, '900000').error, 'selection_out_of_range', 'strings are not amounts');
});

test('calc: months and quantities are predefined — no free-form duration or count', () => {
  const sb = seeded();
  assert.equal(quote(sb, 'day_track_basic', 2).error, 'invalid_months');
  assert.equal(quote(sb, 'day_track_basic', 0).error, 'invalid_months');
  assert.equal(quote(sb, 'solo_housing', 2).error, 'invalid_months');
  assert.equal(quote(sb, 'solo_housing', 6, 900000).error, 'invalid_months');
  assert.equal(quote(sb, 'emdr_core', 3).error, 'invalid_months');
  assert.equal(quote(sb, 'no_such_key').error, 'invalid_package');
  assert.equal(quote(sb, 'day_track_basic', '1').error, 'invalid_months');
});

test('calc: VAT split is inclusive, integer, round-half-up, and net + vat always equals gross', () => {
  const { ctx } = env();
  const split = (g, bp = 1800) => JSON.parse(JSON.stringify(ctx._pkgSplitVat(g, bp)));
  assert.deepEqual(split(118000), { netAgorot: 100000, vatAgorot: 18000 });
  assert.deepEqual(split(0), { netAgorot: 0, vatAgorot: 0 });
  assert.deepEqual(split(100), { netAgorot: 85, vatAgorot: 15 });   // 84.74 -> 85
  assert.deepEqual(split(1, 1800), { netAgorot: 1, vatAgorot: 0 }); // 0.847 -> 1
  assert.deepEqual(split(50, 0), { netAgorot: 50, vatAgorot: 0 });
  for (let g = 0; g < 5000; g += 7) for (const bp of [0, 1700, 1800, 2000]) {
    const r = split(g, bp);
    assert.ok(Number.isInteger(r.netAgorot) && Number.isInteger(r.vatAgorot) && r.vatAgorot >= 0);
    assert.equal(r.netAgorot + r.vatAgorot, g);
  }
  const a = split(340000), b = split(340000);
  assert.deepEqual(a, b, 'deterministic');
});

test('calc: an unsupported VAT basis or a corrupt row never yields a price', () => {
  const { ctx } = env();
  const row = { unit: 'flat', vatBasis: 'exclusive', vatRateBp: 1800, priceTotalAgorot: 1000 };
  assert.equal(ctx._pkgComputeQuote(row, 0, null).error, 'unsupported_vat_basis');
  assert.equal(ctx._pkgComputeQuote(Object.assign({}, row, { vatBasis: 'inclusive', vatRateBp: 9999 }), 0, null).error, 'invalid_package');
  assert.equal(ctx._pkgComputeQuote(null, 0, null).error, 'invalid_package');
  assert.equal(ctx._pkgComputeQuote({ unit: 'bogus', vatBasis: 'inclusive' }, 0, null).error, 'invalid_package');
});

/* ---------------- headers / seed / backup ---------------- */
test('headers: both package sheets are append-only (guard pins the exact current order)', () => {
  const { ctx } = env();
  assert.equal(JSON.stringify(ctx.PACKAGE_CATALOG_HEADERS), JSON.stringify([
    'id', 'key', 'version', 'epoch', 'family', 'tier', 'unit', 'sessions', 'sessionMinutes', 'allowedMonths',
    'pricePerSessionAgorot', 'priceTotalAgorot', 'monthlyPriceAgorot', 'priceMinAgorot', 'priceMaxAgorot',
    'vatBasis', 'vatRateBp', 'active', 'sortOrder', 'sourceRef', 'validFromIso', 'createdAtIso', 'createdBy']));
  assert.equal(JSON.stringify(ctx.PACKAGE_REQUEST_HEADERS), JSON.stringify([
    'id', 'payloadHash', 'status', 'revision', 'requesterKey', 'patientName', 'patientPhone', 'packageKey', 'months',
    'catalogRowId', 'catalogEpoch', 'selectedMonthlyAgorot', 'quoteSnapshot', 'adjustedTotalAgorot', 'adjustReason',
    'adjustLog', 'approvedTotalAgorot', 'approvedSnapshot', 'approvedAtIso', 'approvedBy', 'attachedType', 'attachedId',
    'attachedAtIso', 'attachedBy', 'opLog', 'createdAtIso', 'updatedAt', 'updatedBy']));
});

test('seed: every PDF family is imported once, idempotently, each row with a PDF page reference', () => {
  const sb = env();
  assert.equal(admin(sb, 'adminSeedPackageCatalog').seeded, 15);
  assert.equal(admin(sb, 'adminSeedPackageCatalog').error, 'already_seeded');
  const rows = sb.rows('PackageCatalog');
  assert.equal(rows.length, 15);
  const fam = new Set(rows.map((r) => r.family));
  for (const f of ['day_track', 'emdr', 'cbt', 'emdr_cbt', 'continuation', 'psychiatric', 'solo_housing']) assert.ok(fam.has(f), f);
  for (const r of rows) {
    assert.match(String(r.sourceRef), /^PDF p\d+/, r.key + ' needs a page reference');
    assert.equal(r.vatBasis, 'inclusive');
    assert.equal(Number(r.vatRateBp), 1800);
  }
  assert.equal(new Set(rows.map((r) => r.key)).size, 15);
});

test('backup: both package sheets are captured and an absent one is recorded, not created', () => {
  const sb = env();
  const cap = sb.ctx._integrityCaptureData(sb.ctx.SpreadsheetApp.getActiveSpreadsheet());
  const names = cap.map((c) => c.source);
  assert.ok(names.includes('PackageCatalog') && names.includes('PackageRequests'));
  assert.equal(cap.find((c) => c.source === 'PackageCatalog').absent, true);
  assert.equal(sb.sheets.PackageCatalog, undefined, 'capture must not create the live sheet');
});

/* ---------------- secrets / boundaries ---------------- */
test('boundary: catalog secret reads price-free data only; request secret submits only; proxy key unlocks neither', () => {
  const sb = seeded();
  const PROXY = sb.props.OUTPATIENT_PROXY_SECRET;
  assert.equal(publicCatalog(sb, CAT).ok, true);
  for (const bad of [REQ, PROXY, 'x', '']) assert.deepEqual(publicCatalog(sb, bad), { ok: false, error: 'unauthorized' });
  assert.deepEqual(status(sb, { requesterKey: 'oren' }, REQ), { ok: false, error: 'unauthorized' });
  assert.deepEqual(status(sb, { requesterKey: 'oren' }, PROXY), { ok: false, error: 'unauthorized' });
  assert.equal(submit(sb, {}, REQ).ok, true);
  for (const bad of [CAT, PROXY, 'x']) assert.deepEqual(submit(sb, {}, bad), { ok: false, error: 'unauthorized' });
  // proxy key via the generic path also cannot reach manager handlers
  assert.deepEqual(sb.post({ action: 'createPackageRequest', requestId: uuid(), requesterKey: 'oren' }), { ok: false, error: 'unauthorized' });
  assert.deepEqual(sb.post({ action: 'getPackageCatalogPublic' }), { ok: false, error: 'unauthorized' });
});

test('boundary: package secrets must be >=32 chars and distinct, or the feature fails closed', () => {
  const sb = seeded();
  sb.props.PACKAGE_REQUEST_SECRET = CAT;   // same as the catalog secret
  assert.equal(submit(sb, {}, CAT).error, 'unauthorized');
  assert.equal(publicCatalog(sb, CAT).error, 'unauthorized');
  sb.props.PACKAGE_REQUEST_SECRET = 'short';
  assert.equal(submit(sb, {}, 'short').error, 'unauthorized');
  sb.props.PACKAGE_REQUEST_SECRET = REQ;
  sb.props.PACKAGE_CATALOG_SECRET = sb.props.OUTPATIENT_PROXY_SECRET;
  assert.equal(publicCatalog(sb, sb.props.OUTPATIENT_PROXY_SECRET).error, 'unauthorized');
});

test('admin boundary: proxy key alone is not enough — every private action needs a valid body-bound assertion', () => {
  const sb = seeded();
  const actions = ['adminGetPackageCatalog', 'adminSeedPackageCatalog', 'adminSavePackageCatalogRow', 'adminQuotePackage',
    'adminListPackageRequests', 'adminAdjustPackageRequest', 'adminApprovePackageRequest', 'adminAttachPackageRequest'];
  for (const a of actions) {
    assert.deepEqual(sb.post({ action: a, user: 'ורד' }), { ok: false, error: 'unauthorized' }, a + ' (no assertion)');
    assert.deepEqual(sb.post({ action: a, user: 'ורד', adminAssertion: 'v1.1.2.3' }), { ok: false, error: 'unauthorized' }, a + ' (garbage)');
  }
  // wrong proxy key + valid assertion
  const b = { user: 'ורד' };
  const as = signAssertion('adminGetPackageCatalog', b, ASSERT);
  assert.equal(JSON.parse(sb.ctx.doPost({ postData: { contents: JSON.stringify({ action: 'adminGetPackageCatalog', proxySecret: 'nope', ...b, adminAssertion: as }) }, parameter: {} }).getContent()).error, 'unauthorized');
  // manager secrets never unlock admin actions
  for (const s of [CAT, REQ]) {
    const r = JSON.parse(sb.ctx.doPost({ postData: { contents: JSON.stringify({ action: 'adminGetPackageCatalog', secret: s, proxySecret: s, ...b, adminAssertion: as }) }, parameter: {} }).getContent());
    assert.equal(r.error, 'unauthorized');
  }
  assert.equal(admin(sb, 'adminGetPackageCatalog').ok, true);
});

test('admin assertion: tampered body, other action, expired, far-future, wrong secret and missing secret are all refused', () => {
  const sb = seeded();
  const now = Math.floor(Date.now() / 1000);
  assert.equal(admin(sb, 'adminQuotePackage', { packageKey: 'emdr_core' }).ok, true);
  // body signed for emdr_core but sent as cbt_core
  const signed = { user: 'ורד', packageKey: 'emdr_core' };
  const as = signAssertion('adminQuotePackage', signed, ASSERT);
  assert.equal(sb.post({ action: 'adminQuotePackage', user: 'ורד', packageKey: 'cbt_core', adminAssertion: as }).error, 'unauthorized');
  // actor swapped after signing
  assert.equal(sb.post({ action: 'adminQuotePackage', user: 'אורן', packageKey: 'emdr_core', adminAssertion: as }).error, 'unauthorized');
  // signed for a different action
  assert.equal(sb.post({ action: 'adminGetPackageCatalog', ...signed, adminAssertion: as }).error, 'unauthorized');
  // expired / too far ahead
  assert.equal(admin(sb, 'adminGetPackageCatalog', {}, { assertion: { nowSec: now - 400, ttlSec: 60 } }).error, 'unauthorized');
  assert.equal(admin(sb, 'adminGetPackageCatalog', {}, { assertion: { nowSec: now, ttlSec: 3600 } }).error, 'unauthorized');
  // wrong secret
  assert.equal(admin(sb, 'adminGetPackageCatalog', {}, { secret: 'a-completely-different-secret-0123456789' }).error, 'unauthorized');
  // secret not configured / too short / equal to the proxy key => fail closed
  sb.props.CATALOG_ADMIN_ASSERTION_SECRET = '';
  assert.equal(admin(sb, 'adminGetPackageCatalog').error, 'unauthorized');
  sb.props.CATALOG_ADMIN_ASSERTION_SECRET = sb.props.OUTPATIENT_PROXY_SECRET;
  assert.equal(admin(sb, 'adminGetPackageCatalog', {}, { secret: sb.props.OUTPATIENT_PROXY_SECRET }).error, 'unauthorized');
});

/* ---------------- allowlist contract ---------------- */
const FINANCIAL_KEY = /agorot|price|total|gross|net|vat|amount|adjust|approved|snapshot|quote|(^|[^a-z])owed|paid|revenue|cost|fee|sum/i;
function deepScan(value, path, hits, secrets) {
  if (value === null || value === undefined) return;
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FINANCIAL_KEY.test(k)) hits.push(path + '.' + k);
      deepScan(v, path + '.' + k, hits, secrets);
    }
    return;
  }
  const s = String(value);
  for (const sec of secrets) if (s.includes(sec)) hits.push(path + '=' + sec);
}

test('allowlist contract: nested financial fields injected into stored rows never reach manager feeds, submit/status or errors', () => {
  const sb = seeded();
  const ok = submit(sb, { packageKey: 'emdr_standard' });
  assert.equal(ok.ok, true);
  // Poison every stored place a leak could come from: nested JSON blobs, extra
  // keys inside them, and price-looking numbers in the catalog + request rows.
  const POISON = { grossAgorot: 777777, amountOwed: 424242, nested: { priceTotalAgorot: 313131, deeper: [{ vatAgorot: 98989, netAgorot: 76767 }] } };
  const rsh = sb.sheets.PackageRequests, rg = rsh.grid, h = rg[0];
  for (const col of ['quoteSnapshot', 'approvedSnapshot', 'adjustLog', 'opLog']) rg[1][h.indexOf(col)] = JSON.stringify(POISON);
  rg[1][h.indexOf('adjustedTotalAgorot')] = 555555;
  rg[1][h.indexOf('approvedTotalAgorot')] = 666666;
  rg[1][h.indexOf('adjustReason')] = 'amountOwed 424242';
  const csh = sb.sheets.PackageCatalog.grid, ch = csh[0];
  csh[1][ch.indexOf('sourceRef')] = 'ignored text 777777';
  const secrets = ['777777', '424242', '313131', '98989', '76767', '555555', '666666', '85000', '680000', '340000', '1500000', '850000', '1360000'];
  const outputs = {
    catalog: publicCatalog(sb),
    submitSame: submit(sb, {}, REQ),                 // new id: fresh submit
    status: status(sb, { requesterKey: 'oren' }),
    statusById: status(sb, { requesterKey: 'oren', requestId: ok.requestId }),
    errBadSecret: publicCatalog(sb, 'x'),
    errBadPkg: submit(sb, { packageKey: 'nope' }),
    errConflict: submit(sb, { requestId: ok.requestId, patientName: 'שם אחר' }),
    errStale: submit(sb, { catalogEpoch: 999 }),
    errRequester: status(sb, { requesterKey: 'admin' }),
    errId: status(sb, { requesterKey: 'oren', requestId: 'not-a-uuid' })
  };
  for (const [name, out] of Object.entries(outputs)) {
    const hits = [];
    deepScan(out, name, hits, secrets);
    assert.deepEqual(hits, [], name + ' leaked: ' + JSON.stringify(out));
  }
  // Exact allowlisted shapes (anything extra is a contract break).
  const sortedKeys = (o) => Object.keys(o).sort().join();
  for (const it of outputs.catalog.items) assert.equal(sortedKeys(it), 'allowedMonths,family,key,needsPricing,sessionMinutes,sessions,sortOrder,tier,unit');
  assert.equal(sortedKeys(outputs.catalog), 'catalogEpoch,items,ok');
  assert.equal(sortedKeys(outputs.submitSame), 'duplicate,ok,requestId,status');
  assert.equal(sortedKeys(outputs.status), 'items,ok');
  for (const it of outputs.status.items) assert.equal(sortedKeys(it), 'createdAt,months,packageKey,requestId,status');
});

test('allowlist contract: a corrupt/unreadable store yields a FIXED error code, never internal text', () => {
  const sb = seeded();
  submit(sb, {});
  sb.sheets.PackageRequests.getDataRange = () => { throw new Error('boom 424242 /secret/path price=999'); };
  sb.sheets.PackageRequests.getRange = () => { throw new Error('boom 424242 /secret/path price=999'); };
  for (const out of [status(sb, { requesterKey: 'oren' }), submit(sb, {})]) {
    assert.equal(out.ok, false);
    assert.match(out.error, /^[a-z_]+$/);
    assert.ok(!JSON.stringify(out).includes('424242'));
  }
});

test('manager feeds never expose another requester\'s requests; status is scoped to the derived requesterKey', () => {
  const sb = seeded();
  const o = submit(sb, { requesterKey: 'oren' }), s = submit(sb, { requesterKey: 'shahar' });
  assert.deepEqual(status(sb, { requesterKey: 'oren' }).items.map((i) => i.requestId), [o.requestId]);
  assert.deepEqual(status(sb, { requesterKey: 'shahar' }).items.map((i) => i.requestId), [s.requestId]);
  assert.deepEqual(status(sb, { requesterKey: 'shahar', requestId: o.requestId }).items, []);
  assert.equal(submit(sb, { requesterKey: 'yael' }).error, 'invalid_requester');
});

/* ---------------- reliable requests ---------------- */
test('request: same id + same payload returns the existing safe result — also long after (no time window)', () => {
  const sb = seeded();
  const id = uuid();
  const epoch = epochOf(sb);
  const first = submit(sb, { requestId: id, catalogEpoch: epoch });
  assert.deepEqual([first.ok, first.duplicate, first.status], [true, false, 'pending']);
  // The script's clock jumps 3 hours ahead: an old retry must still dedupe.
  vm.runInContext(`globalThis.__RealDate = Date; globalThis.Date = class extends __RealDate {
    constructor(...a) { if (a.length) super(...a); else super(__RealDate.now() + 3 * 3600 * 1000); }
    static now() { return __RealDate.now() + 3 * 3600 * 1000; } };`, sb.ctx);
  const again = submit(sb, { requestId: id, catalogEpoch: epoch });
  vm.runInContext('globalThis.Date = __RealDate;', sb.ctx);
  assert.deepEqual([again.ok, again.duplicate, again.requestId], [true, true, id]);
  assert.equal(sb.rows('PackageRequests').length, 1, 'no duplicate row');
});

test('request: same id + different payload is rejected and changes nothing', () => {
  const sb = seeded();
  const id = uuid();
  assert.equal(submit(sb, { requestId: id }).ok, true);
  for (const over of [{ patientName: 'מישהו אחר' }, { packageKey: 'cbt_core' }, { requesterKey: 'shahar' }, { patientPhone: '0521111111' }]) {
    assert.deepEqual(submit(sb, { requestId: id, ...over }), { ok: false, error: 'request_id_conflict' });
  }
  assert.equal(sb.rows('PackageRequests').length, 1);
});

test('request: the SAME patient/package under a NEW id is a new request (no window dedupe)', () => {
  const sb = seeded();
  assert.equal(submit(sb, {}).duplicate, false);
  assert.equal(submit(sb, {}).duplicate, false);
  assert.equal(sb.rows('PackageRequests').length, 2);
});

test('request: concurrency — a busy lock writes nothing; a retry after the lock frees creates exactly one row', () => {
  const sb = seeded();
  const id = uuid();
  const orig = sb.lock.waitLock;
  sb.lock.waitLock = () => { throw new Error('Lock timeout'); };
  assert.deepEqual(submit(sb, { requestId: id }), { ok: false, error: 'busy' });
  assert.equal(sb.rows('PackageRequests').length, 0);
  sb.lock.waitLock = orig;
  const a = submit(sb, { requestId: id }), b = submit(sb, { requestId: id });
  assert.deepEqual([a.duplicate, b.duplicate], [false, true]);
  assert.equal(sb.rows('PackageRequests').length, 1);
  assert.equal(sb.isLocked(), false, 'lock released');
});

test('request: server-side validation — stale catalog, unknown option, bad months, bad id, bad phone; client amounts ignored', () => {
  const sb = seeded();
  assert.equal(submit(sb, { catalogEpoch: 99 }).error, 'stale_catalog');
  assert.equal(submit(sb, { catalogEpoch: undefined }).error, 'stale_catalog');
  assert.equal(submit(sb, { packageKey: 'free_form' }).error, 'invalid_package');
  assert.equal(submit(sb, { packageKey: 'day_track_basic', months: 7 }).error, 'invalid_months');
  assert.equal(submit(sb, { packageKey: 'day_track_basic', months: '1' }).error, 'invalid_months');
  assert.equal(submit(sb, { packageKey: 'emdr_core', months: 2 }).error, 'invalid_months');
  assert.equal(submit(sb, { requestId: 'nope' }).error, 'invalid_request_id');
  assert.equal(submit(sb, { patientPhone: '12' }).error, 'invalid_phone');
  assert.equal(submit(sb, { patientName: ' ' }).error, 'invalid_patient');
  const r = submit(sb, { packageKey: 'emdr_core', totalAgorot: 1, grossAgorot: 1, amount: 1, price: 1, quoteSnapshot: '{"grossAgorot":1}' });
  assert.equal(r.ok, true);
  const rec = sb.rows('PackageRequests')[0];
  assert.equal(JSON.parse(rec.quoteSnapshot).grossAgorot, 340000, 'the SERVER computed the amount');
  assert.ok(!JSON.stringify(rec).includes('"amount"'));
});

test('request: a phone number survives Sheets coercion as text (leading zero kept)', () => {
  const sb = seeded();
  submit(sb, { patientPhone: '0501234567' });
  assert.equal(sb.rows('PackageRequests')[0].patientPhone, '0501234567');
});

test('request: solo is accepted as pending with needsSelection — no price chosen for Vered', () => {
  const sb = seeded();
  const r = submit(sb, { packageKey: 'solo_housing', months: 3 });
  assert.equal(r.ok, true);
  const snap = JSON.parse(sb.rows('PackageRequests')[0].quoteSnapshot);
  assert.equal(snap.needsSelection, true);
  assert.equal(snap.grossAgorot, null);
  assert.equal(snap.monthlyAgorot, null);
});

/* ---------------- approval / attachment ---------------- */
function run(sb, action, id, rev, extra = {}, opId = uuid()) {
  return admin(sb, action, { requestId: id, opId, expectedRevision: rev, ...extra });
}

test('approve: moves pending -> priced (quoted, NOT paid), replay is idempotent, stale revision is refused', () => {
  const sb = seeded();
  const r = submit(sb, { packageKey: 'cbt_standard' });
  const op = uuid();
  const a = run(sb, 'adminApprovePackageRequest', r.requestId, 1, {}, op);
  assert.equal(a.ok, true);
  assert.equal(a.request.status, 'priced');
  assert.equal(a.request.approvedTotalAgorot, 600000);
  assert.equal(a.request.revision, 2);
  const replay = run(sb, 'adminApprovePackageRequest', r.requestId, 1, {}, op);   // same op id, stale revision
  assert.deepEqual([replay.ok, replay.replay, replay.request.revision], [true, true, 2]);
  assert.equal(run(sb, 'adminApprovePackageRequest', r.requestId, 1).error, 'revision_conflict');
  assert.equal(run(sb, 'adminApprovePackageRequest', r.requestId, 2).error, 'already_priced');
  assert.equal(status(sb, { requesterKey: 'oren' }).items[0].status, 'priced');
});

test('adjust: needs a recorded reason, is logged, and changes the approved total — the original quote snapshot stays', () => {
  const sb = seeded();
  const r = submit(sb, { packageKey: 'emdr_standard' });
  assert.equal(run(sb, 'adminAdjustPackageRequest', r.requestId, 1, { adjustedTotalAgorot: 600000 }).error, 'reason_required');
  assert.equal(run(sb, 'adminAdjustPackageRequest', r.requestId, 1, { adjustedTotalAgorot: -5, reason: 'x y' }).error, 'invalid_adjustment');
  assert.equal(run(sb, 'adminAdjustPackageRequest', r.requestId, 1, { adjustedTotalAgorot: 1.5, reason: 'x y' }).error, 'invalid_adjustment');
  const adj = run(sb, 'adminAdjustPackageRequest', r.requestId, 1, { adjustedTotalAgorot: 600000, reason: 'הנחת קיזוז' });
  assert.equal(adj.ok, true);
  const ap = run(sb, 'adminApprovePackageRequest', r.requestId, 2);
  assert.equal(ap.request.approvedTotalAgorot, 600000);
  const rec = sb.rows('PackageRequests')[0];
  assert.equal(JSON.parse(rec.quoteSnapshot).grossAgorot, 680000, 'original quote kept');
  const log = JSON.parse(rec.adjustLog);
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].from, log[0].to, log[0].by, log[0].reason], [680000, 600000, 'ורד', 'הנחת קיזוז']);
});

test('solo: approval is blocked until Vered selects a price in range; the selection is recorded', () => {
  const sb = seeded();
  const r = submit(sb, { packageKey: 'solo_housing', months: 3 });
  assert.equal(run(sb, 'adminApprovePackageRequest', r.requestId, 1).error, 'selection_required');
  assert.equal(run(sb, 'adminAdjustPackageRequest', r.requestId, 1, { adjustedTotalAgorot: 100, reason: 'לא מותר' }).error, 'selection_required');
  assert.equal(run(sb, 'adminAdjustPackageRequest', r.requestId, 1, { selectedMonthlyAgorot: 700000 }).error, 'selection_out_of_range');
  assert.equal(run(sb, 'adminAdjustPackageRequest', r.requestId, 1, { selectedMonthlyAgorot: 900000 }).ok, true);
  const ap = run(sb, 'adminApprovePackageRequest', r.requestId, 2);
  assert.equal(ap.request.approvedTotalAgorot, 2700000);
});

test('attach: stores a REFERENCE only — no charge, payment or credit is created; replay and conflicts are safe', () => {
  const sb = seeded();
  sb.seed('Clients', sb.ctx.CLIENTS_HEADERS, [{ id: 'c-1', name: 'לקוח' }]);
  sb.seed('Leads', sb.ctx.LEADS_HEADERS, [{ id: 'l-1', name: 'ליד' }]);
  const before = JSON.stringify(['Clients', 'Leads', 'Payments', 'ClientCharges', 'Credits', 'TherapistRates'].map((n) => sb.rows(n)));
  const r = submit(sb, {});
  assert.equal(run(sb, 'adminAttachPackageRequest', r.requestId, 1, { targetType: 'client', targetId: 'c-1' }).error, 'not_priced');
  run(sb, 'adminApprovePackageRequest', r.requestId, 1);
  assert.equal(run(sb, 'adminAttachPackageRequest', r.requestId, 2, { targetType: 'client', targetId: 'nope' }).error, 'target_not_found');
  assert.equal(run(sb, 'adminAttachPackageRequest', r.requestId, 2, { targetType: 'patient', targetId: 'c-1' }).error, 'invalid_target');
  const op = uuid();
  const at = run(sb, 'adminAttachPackageRequest', r.requestId, 2, { targetType: 'client', targetId: 'c-1' }, op);
  assert.equal(at.ok, true);
  assert.equal(at.request.attachedId, 'c-1');
  assert.equal(run(sb, 'adminAttachPackageRequest', r.requestId, 2, { targetType: 'client', targetId: 'c-1' }, op).replay, true);
  assert.equal(run(sb, 'adminAttachPackageRequest', r.requestId, 3, { targetType: 'client', targetId: 'c-1' }).noop, true, 'same target, new op id: no-op');
  assert.equal(run(sb, 'adminAttachPackageRequest', r.requestId, 3, { targetType: 'lead', targetId: 'l-1' }).error, 'already_attached');
  const after = JSON.stringify(['Clients', 'Leads', 'Payments', 'ClientCharges', 'Credits', 'TherapistRates'].map((n) => sb.rows(n)));
  assert.equal(after, before, 'existing billing / client / lead data is untouched');
  for (const n of ['Payments', 'ClientCharges', 'Credits']) assert.equal(sb.rows(n).length, 0);
});

/* ---------------- versions / snapshots ---------------- */
test('versioning: a catalog edit appends v2, flips only the old active cell, never alters an existing quote', () => {
  const sb = seeded();
  const r = submit(sb, { packageKey: 'emdr_core' });
  const e1 = epochOf(sb);
  const before = JSON.parse(sb.rows('PackageRequests')[0].quoteSnapshot);
  const row = admin(sb, 'adminGetPackageCatalog').items.find((i) => i.key === 'emdr_core');
  const save = admin(sb, 'adminSavePackageCatalogRow', { key: 'emdr_core', expectedVersion: row.version,
    fields: { family: 'emdr', tier: 'core', unit: 'per_session_pack', sessions: 4, sessionMinutes: 60, pricePerSessionAgorot: 90000, sourceRef: 'PDF p5 (updated)' } });
  assert.equal(save.ok, true);
  assert.equal(save.version, 2);
  assert.equal(save.catalogEpoch, e1 + 1);
  const all = sb.rows('PackageCatalog').filter((x) => x.key === 'emdr_core');
  assert.deepEqual(all.map((x) => [x.id, Number(x.active), Number(x.pricePerSessionAgorot)]), [['emdr_core@v1', 0, 85000], ['emdr_core@v2', 1, 90000]]);
  assert.deepEqual(JSON.parse(sb.rows('PackageRequests')[0].quoteSnapshot), before, 'existing quote unchanged');
  const ap = run(sb, 'adminApprovePackageRequest', r.requestId, 1);
  assert.equal(ap.request.approvedTotalAgorot, 340000, 'approved on the quote\'s own catalog version, not the new price');
  assert.equal(quote(sb, 'emdr_core').quote.grossAgorot, 360000, 'new quotes use v2');
  assert.equal(submit(sb, { catalogEpoch: e1 }).error, 'stale_catalog', 'a manager on the old catalog must refresh');
  assert.equal(submit(sb, {}).ok, true);
  // concurrent edit: expectedVersion is a revision check
  assert.equal(admin(sb, 'adminSavePackageCatalogRow', { key: 'emdr_core', expectedVersion: 1,
    fields: { family: 'emdr', tier: 'core', unit: 'per_session_pack', sessions: 4, pricePerSessionAgorot: 1 } }).error, 'version_conflict');
});

test('catalog edit validation: a row that cannot produce a quote or has non-integer money is refused', () => {
  const sb = seeded();
  const bad = [
    { family: 'x_fam', tier: 'x_tier', unit: 'flat', priceTotalAgorot: 12.5 },
    { family: 'x_fam', tier: 'x_tier', unit: 'flat' },
    { family: 'x_fam', tier: 'x_tier', unit: 'per_month', monthlyPriceAgorot: 1000 },
    { family: 'x_fam', tier: 'x_tier', unit: 'per_month_range', allowedMonths: '3', priceMinAgorot: 900, priceMaxAgorot: 800 },
    { family: 'x_fam', tier: 'x_tier', unit: 'weird', priceTotalAgorot: 1000 },
    { family: 'X Bad', tier: 'x_tier', unit: 'flat', priceTotalAgorot: 1000 }
  ];
  for (const fields of bad) assert.equal(admin(sb, 'adminSavePackageCatalogRow', { key: 'new_option', expectedVersion: 0, fields }).error, 'invalid_fields', JSON.stringify(fields));
  assert.equal(admin(sb, 'adminSavePackageCatalogRow', { key: 'New Option', expectedVersion: 0, fields: { family: 'x_fam', tier: 'x_tier', unit: 'flat', priceTotalAgorot: 1000 } }).error, 'invalid_package');
  assert.equal(admin(sb, 'adminSavePackageCatalogRow', { key: 'new_option', expectedVersion: 0, fields: { family: 'x_fam', tier: 'x_tier', unit: 'flat', priceTotalAgorot: 1000 } }).ok, true);
});

test('actor: the admin user in the audit trail comes from the signed body (Node overwrites it), never a client role field', () => {
  const sb = seeded();
  const r = submit(sb, {});
  run(sb, 'adminApprovePackageRequest', r.requestId, 1);
  assert.equal(sb.rows('PackageRequests')[0].approvedBy, 'ורד');
});
