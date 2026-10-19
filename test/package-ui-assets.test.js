'use strict';
/* Browser assets + caches for the Vered-only pricing tab. The script ships to
 * every browser, so it must hold LABELS only: no catalog key list with prices,
 * no price constants, no sheet names, no secrets. Everything monetary comes
 * from the admin RPC after the server-side PIN check. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sandbox } = require('../test-support/apps-script-sandbox');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MODULE = read('public/package-pricing.js');
const INDEX = read('public/index.html');
const APP = read('public/app.js');
const SW = read('public/sw.js');
const seed = JSON.parse(JSON.stringify(sandbox().ctx.PACKAGE_CATALOG_SEED));
const P = require('../public/package-pricing.js');

test('assets: the tab, section and script tag exist; the script keeps ?v=__BUILD__ and loads before app.js', () => {
  assert.match(INDEX, /<button class="tab" data-view="packages" id="packagesTab">תמחור חבילות<\/button>/);
  assert.match(INDEX, /<section id="view-packages" class="view">/);
  const pp = INDEX.indexOf('<script src="package-pricing.js?v=__BUILD__" defer></script>');
  assert.ok(pp > 0 && pp < INDEX.indexOf('<script src="app.js?v=__BUILD__"'));
  for (const m of INDEX.matchAll(/<script src="([^"]+)"/g)) assert.match(m[1], /\?v=__BUILD__$/, m[1]);
});

test('confidentiality: no catalog price, option key, sheet name or secret name is shipped in any browser asset', () => {
  const priceNumbers = new Set();
  for (const s of seed) for (const f of ['pricePerSessionAgorot', 'priceTotalAgorot', 'monthlyPriceAgorot', 'priceMinAgorot', 'priceMaxAgorot']) if (s[f]) priceNumbers.add(String(s[f]));
  const files = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => /\.(js|html|css|webmanifest)$/.test(f));
  assert.ok(files.includes('package-pricing.js'));
  for (const f of files) {
    const src = read('public/' + f);
    for (const s of seed) assert.ok(!src.includes("'" + s.key + "'") && !src.includes('"' + s.key + '"'), f + ' ships option key ' + s.key);
    for (const bad of ['PackageCatalog', 'PackageRequests', 'PACKAGE_CATALOG_SECRET', 'PACKAGE_REQUEST_SECRET', 'CATALOG_ADMIN', 'adminAssertion', 'OUTPATIENT_PROXY_SECRET']) {
      assert.ok(!src.includes(bad), f + ' mentions ' + bad);
    }
  }
  for (const n of priceNumbers) assert.ok(!new RegExp('(^|[^\\d.])' + n + '([^\\d]|$)').test(MODULE), 'package-pricing.js embeds the price ' + n);
  // the markup of the new section is empty: nothing to read before the PIN
  const section = INDEX.slice(INDEX.indexOf('<section id="view-packages"'), INDEX.indexOf('</section>', INDEX.indexOf('<section id="view-packages"')));
  assert.ok(!/\d{4,}/.test(section.replace(/data-[\w-]+="[^"]*"/g, '')), 'no amounts in the section markup');
});

test('confidentiality: the pricing module never writes HTML strings (no innerHTML / document.write / eval) and sends no client-supplied actor', () => {
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) assert.ok(!MODULE.includes(bad), bad);
  assert.ok(!/\buser\s*:/.test(MODULE) && !/actorKey|actorRole|isAdmin|requesterKey\s*:/.test(MODULE), 'authority fields are server-derived (requesterKey is only ever READ from a server row)');
  assert.ok(!/localStorage|sessionStorage/.test(MODULE), 'no browser storage decides access or holds prices');
  assert.match(MODULE, /\/api\/catalog-admin\/rpc/);
  assert.ok(!/\/api\/sheets/.test(MODULE), 'never uses the generic proxy');
});

test('app wiring: the tab renders through PackagePricing.mount; logout and 401 reset it; nothing is cached client-side', () => {
  assert.match(APP, /state\.view === 'packages'\) renderPackages\(\)/);
  assert.match(APP, /window\.PackagePricing\.mount\(\$\('#packagesRoot'\)/);
  assert.match(APP, /fetch\('\/api\/catalog-admin\/logout', \{ method: 'POST' \}\)/);
  assert.match(APP, /function handleUnauthorized\(\) \{[\s\S]{0,200}?try \{ if \(window\.PackagePricing\) window\.PackagePricing\.reset\(\)/);
  assert.ok(!/ez_pkg|packageCatalog|PackageCatalog/.test(APP));
});

test('service worker: cache bumped monotonically (>= v12), /api/ never cached, the pricing script is not pre-cached', () => {
  const v = Number((SW.match(/var CACHE = 'ezone-outpatient-v(\d+)'/) || [])[1]);
  assert.ok(v >= 12, 'v' + v);
  assert.match(SW, /\/api\//);
  const shell = SW.slice(SW.indexOf('var SHELL'), SW.indexOf('];', SW.indexOf('var SHELL')));
  assert.ok(!/package|catalog/i.test(shell));
});

test('labels: every seeded family, tier, unit and status has a Hebrew label (no raw English key on screen)', () => {
  for (const s of seed) {
    assert.ok(P.FAMILY[s.family], 'family ' + s.family);
    assert.ok(P.TIER[s.tier], 'tier ' + s.tier);
    assert.ok(P.UNIT[s.unit], 'unit ' + s.unit);
  }
  assert.ok(P.STATUS.pending && P.STATUS.priced && P.REQUESTER.oren && P.REQUESTER.shahar);
  assert.match(P.STATUS.priced, /לא שולם/, 'priced never reads as paid');
  for (const e of ['revision_conflict', 'selection_required', 'reason_required', 'admin_required', 'upstream_unavailable']) assert.ok(P.ERRORS[e], e);
});

test('money: agorot formatting and shekel parsing are integer-only', () => {
  assert.equal(P.formatAgorot(340000), '3,400 ₪');
  assert.equal(P.formatAgorot(123456), '1,234.56 ₪');
  assert.equal(P.formatAgorot(5), '0.05 ₪');
  assert.equal(P.formatAgorot(null), '—');
  assert.equal(P.parseShekels('3,400'), 340000);
  assert.equal(P.parseShekels('0.1'), 10);
  assert.equal(P.parseShekels('19.99'), 1999);
  for (const bad of ['', 'abc', '-5', '1.234', '1e3', '12345678', '1..2', null]) assert.equal(P.parseShekels(bad), null, String(bad));
});

test('range items (Solo): Vered chooses min / midpoint / max from a fixed list; degenerate or invalid ranges stay safe', () => {
  const solo = seed.find((r) => r.key === 'solo_housing');
  assert.equal(solo.priceMinAgorot, 800000); assert.equal(solo.priceMaxAgorot, 1000000);
  const tiers = P.rangeTiers(solo);
  assert.deepEqual(tiers.map((t) => [t.id, t.agorot]), [['min', 800000], ['mid', 900000], ['max', 1000000]]);
  assert.deepEqual(P.rangeTiers({ priceMinAgorot: 5, priceMaxAgorot: 6 }).map((t) => t.agorot), [5, 5, 6].filter((v, i, a) => i === 0 || v !== a[i - 1]));
  assert.deepEqual(P.rangeTiers({ priceMinAgorot: 700, priceMaxAgorot: 700 }).map((t) => t.agorot), [700], 'min == max collapses to one tier');
  for (const bad of [null, {}, { priceMinAgorot: 0, priceMaxAgorot: 10 }, { priceMinAgorot: 10, priceMaxAgorot: 5 }]) assert.deepEqual(P.rangeTiers(bad), []);
  // every tier is accepted by the server-side range check (min <= price <= max) and the UI no longer takes free text for it
  for (const t of tiers) assert.ok(t.agorot >= solo.priceMinAgorot && t.agorot <= solo.priceMaxAgorot);
  assert.doesNotMatch(MODULE, /מחיר חודשי ב-₪/);
});
