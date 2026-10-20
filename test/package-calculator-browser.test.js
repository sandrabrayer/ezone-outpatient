'use strict';
/* Real-browser check (Chromium via Playwright) of the Vered pricing calculator: EVERY option is visible as a button
 * (packages grouped by family, months, Solo minimum / midpoint / maximum), and each choice computes a quote.
 * The server side is stubbed at fetch level; the real public/package-pricing.js runs in a real DOM. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function loadChromium() {
  try { return require('playwright').chromium; } catch (_) {}
  try {
    const root = require('node:child_process').execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    return require(path.join(root, 'playwright')).chromium;
  } catch (_) { return null; }
}
const chromium = loadChromium();
if (!chromium && process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw new Error('playwright is required for browser acceptance');
const skipOpt = chromium ? {} : { skip: 'playwright not installed' };

const ITEMS = [
  { key: 'emdr_core', family: 'emdr', tier: 'core', unit: 'per_session_pack', sessions: 4, pricePerSessionAgorot: 85000, allowedMonths: [], active: true, version: 1 },
  { key: 'emdr_standard', family: 'emdr', tier: 'standard', unit: 'per_session_pack', sessions: 8, pricePerSessionAgorot: 85000, allowedMonths: [], active: true, version: 1 },
  { key: 'day_track_basic', family: 'day_track', tier: 'basic', unit: 'per_month', allowedMonths: [1, 3], monthlyPriceAgorot: 1500000, active: true, version: 1 },
  { key: 'solo_housing', family: 'solo_housing', tier: 'range', unit: 'per_month_range', allowedMonths: [3], priceMinAgorot: 800000, priceMaxAgorot: 1000000, active: true, version: 1 }
];

test('calculator: all options are visible buttons; Solo needs a tier and computes for the midpoint', skipOpt, async (t) => {
  let browser;
  try { browser = await chromium.launch(); } catch (e) {
    if (process.env.EZONE_REQUIRE_BROWSER_TESTS === '1') throw e;
    return t.skip('no browser binary');
  }
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.setContent('<!doctype html><html dir="rtl"><body><div id="root"></div></body></html>');
  await page.addScriptTag({ path: path.join(__dirname, '..', 'public', 'package-pricing.js') });
  await page.evaluate((items) => {
    window.fetch = async function (url, init) {
      const body = init && init.body ? JSON.parse(init.body) : {};
      const ok = (o) => ({ status: 200, ok: true, json: async () => o });
      if (String(url).includes('/status')) return ok({ ok: true, configured: true, eligible: true, admin: true });
      if (body.op === 'catalog') return ok({ ok: true, items: items, epoch: 1 });
      if (body.op === 'list') return ok({ ok: true, items: [], counts: { pending: 0, priced: 0 } });
      if (body.op === 'quote') {
        const it = items.find((i) => i.key === body.packageKey);
        if (it.unit === 'per_month_range' && !body.selectedMonthlyAgorot) return ok({ ok: true, quote: { needsSelection: true } });
        const monthly = it.unit === 'per_month_range' ? body.selectedMonthlyAgorot : (it.monthlyPriceAgorot || null);
        const gross = monthly ? monthly * (body.months || 1) : it.sessions * it.pricePerSessionAgorot;
        return ok({ ok: true, quote: { needsSelection: false, monthlyAgorot: monthly, commitmentMonths: body.months || 0, grossAgorot: gross, netAgorot: Math.round(gross / 1.18), vatAgorot: gross - Math.round(gross / 1.18), vatRateBp: 1800 } });
      }
      return ok({ ok: true });
    };
    window.PackagePricing.mount(document.getElementById('root'), {});
  }, ITEMS);
  await page.click('button:has-text("מחשבון")');
  await page.waitForSelector('.pkg-calc');
  // every package is a visible button, grouped by family; no dropdown
  assert.equal(await page.locator('.pkg-calc select').count(), 0);
  assert.equal(await page.locator('.pkg-calc .pkg-fam-title').allTextContents().then((a) => a.filter((x) => /EMDR|מסלול יום|Solo/.test(x)).length), 3);
  assert.ok(await page.locator('.pkg-calc .pkg-chip').count() >= ITEMS.length);
  // a package with several allowed durations shows them all as buttons
  await page.click('.pkg-chip:has-text("בסיסי")');
  await page.waitForSelector('.pkg-chip:has-text("3 חודשים")');
  assert.equal(await page.locator('.pkg-chip:has-text("חודשים")').count(), 2);
  await page.click('.pkg-chip:has-text("3 חודשים")');
  await page.waitForSelector('.pkg-total');
  assert.match(await page.textContent('.pkg-total'), /3 חודשים/);
  // Solo: tiers appear as buttons; nothing is computed until one is chosen
  await page.click('.pkg-chip:has-text("טווח מחיר")');
  await page.waitForSelector('.pkg-chip:has-text("מינימום")');
  assert.equal(await page.locator('.pkg-chip:has-text("מינימום"), .pkg-chip:has-text("אמצע"), .pkg-chip:has-text("מקסימום")').count(), 3);
  assert.equal(await page.locator('.pkg-total').count(), 0);
  await page.click('.pkg-chip:has-text("אמצע")');
  await page.waitForSelector('.pkg-total');
  assert.match(await page.textContent('.pkg-calc'), /9,000/);
  assert.deepEqual(errors, []);
});
