/* E-ZONE Outpatient service worker.
 * Strategy: NETWORK-FIRST (same recipe as ezone-therapists). This is a
 * live-data app — never serve a stale API response or a stale app.js. Cache is
 * a fallback only, so an installed app still opens offline (read-only of
 * whatever was last seen).
 *
 * Hard rules:
 * - /api/ requests are NEVER cached or intercepted (data must always be live).
 * - Only same-origin GET responses are cached.
 * - Icon-cache trap: icon filenames are VERSIONED (icon-v1-*). When icons
 *   change, ship icon-v2-* AND bump CACHE below — Android caches launcher
 *   icons aggressively and will not refresh otherwise.
 * - v2 (2026-07-08): ecosystem colour rebrand — the icon-v1-* PNGs were
 *   recoloured in place (green letter on a white ground). CACHE bumped so the
 *   old shell + cached icon bytes are evicted on activate.
 * - v3 (2026-07-08): letter recoloured to a fiercer green (#2dd47a -> #00c853),
 *   white ground and glyph geometry unchanged. CACHE bumped to evict the
 *   previously-cached icon bytes.
 * - v4 (2026-09-04): name picker + conflict refusal — new conflicts.js
 *   module, new index.html markup (picker screen, header name, conflict
 *   banner) and CSS. CACHE bumped so an installed app cannot serve the old
 *   shell with the new app.js.
 * - v5 (2026-09-12): ירדן added to the login name picker / assignedTo list
 *   (lib/users.js + index.html). CACHE bumped so an installed app cannot keep
 *   serving the old index.html whose משוייך ל dropdown lacks her.
 * - v6 (2026-09-15): credits / refunds ledger — new credits-ledger.js module,
 *   new index.html markup (credits modal, mark-paid modal, the
 *   "זיכויים ממתינים לתשלום" section on גבייה) and CSS. CACHE bumped so an
 *   installed app cannot serve the old shell, whose index.html never loads
 *   credits-ledger.js, alongside the new app.js that needs it.
 * - v7 (2026-09-20): monthly revenue view — new monthly-revenue.js module, a
 *   new הכנסות חודשיות tab + section in index.html, and CSS. CACHE bumped so
 *   an installed app cannot serve the old shell, whose index.html never loads
 *   monthly-revenue.js, alongside the new app.js that renders the tab.
 * - v8 (2026-09-28): patient-card phone chip — new phone-issue.js module, a
 *   new index.html script tag, and CSS. CACHE bumped so an installed app cannot
 *   serve the old shell, whose index.html never loads phone-issue.js, alongside
 *   the new app.js that renders the «חסר טלפון» / «טלפון לא תקין» chip.
 * - v9 (2026-10-18): confirmed financial saves, partial-save warning and
 *   payment verification state. Keep the warning markup and app.js together.
 * - v10 (2026-10-18): planned discharge date (תאריך סיום מתוכנן) — new date
 *   input in the edit-client modal (index.html) read/saved by app.js. Bumped
 *   so an installed app never pairs the old shell with the new app.js.
 * - v11 (2026-10-18): source-owned renewal recovery, original-cycle resume
 *   and explicit review. Live v10 was verified after #119 before this bump.
 * - v12 (2026-10-18): durable additional-charge creation and recovery UI.
 *   Live v11 was verified before this bump; new markup and app.js stay paired.
 * - v13 (2026-10-18): price / pay constants are session-only. treatment-map.js and
 *   therapist-pay.js are no longer cached and no longer static <script> tags; bumping
 *   the cache name also DELETES every previously cached copy of them on activate.
 *   Check the LIVE version before releasing (CLAUDE.md rule 5).
 *   Review follow-up: the protected-path test now DECODES the path (up to 4 levels, fail-closed on
 *   undecodable input) before it is matched, so /%74reatment-map.js and friends are never intercepted,
 *   cached or served from cache; responses marked no-store / private are never put in the cache; and any
 *   already-stored alias is evicted on activate and on a 'purge-protected' message (sent at sign-out).
 * - v14 (2026-10-18): package catalog / pricing tab — new package-pricing.js
 *   module, a new תמחור חבילות tab + section in index.html, and CSS. Re-bumped
 *   v12 → v13 → v14 after #121 (v12) and #123 (v13) take their numbers; before
 *   release re-check the LIVE version (CLAUDE.md rule 5). The service worker
 *   still never caches /api/.
 * - v15 (2026-10-19): the pricing tab no longer asks for a second code (Vered's
 *   signed-in name opens it); package-pricing.js changed. LIVE v14 was verified
 *   (#122 merge 3c1d260) before this bump.
 */
var CACHE = 'ezone-outpatient-v15';
var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-v1-192.png',
  './icon-v1-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

// Price / pay constants must never be cached. The path is DECODED before matching so an encoded or
// re-cased alias is classified exactly like the canonical name; anything undecodable, or that keeps
// changing after 4 decodes, is treated as protected (fail closed).
var PROTECTED_STEM = /(treatment-map|therapist-pay)(?![a-z0-9-])/;
function isProtectedPath(pathname) {
  var decoded = String(pathname || '');
  for (var i = 0; i < 4; i++) {
    var next;
    try { next = decodeURIComponent(decoded); } catch (e) { return true; }
    if (next === decoded) return PROTECTED_STEM.test(decoded.toLowerCase());
    decoded = next;
  }
  return true;
}
// A response the server marked no-store / private must not be written to Cache Storage.
function isUncacheable(res) {
  var cc = (res && res.headers && res.headers.get('cache-control')) || '';
  return /(^|[\s,])(no-store|private)(?=$|[\s,;=])/i.test(cc);
}
// Evict every stored entry whose URL names a protected file under ANY spelling.
function purgeProtected() {
  return caches.keys().then(function (names) {
    return Promise.all(names.map(function (n) {
      return caches.open(n).then(function (c) {
        return c.keys().then(function (reqs) {
          return Promise.all(reqs.filter(function (r) {
            try { return isProtectedPath(new URL(r.url).pathname); } catch (e) { return true; }
          }).map(function (r) { return c.delete(r); }));
        });
      });
    }));
  });
}

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(purgeProtected).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'purge-protected') e.waitUntil(purgeProtected());
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.pathname.indexOf('/api/') === 0) return;
  // Price / pay constants are session-only and never cached or served from cache (a cached copy would
  // outlive the sign-in and be readable offline). Straight to the network, under every spelling.
  if (isProtectedPath(url.pathname)) return;

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok && url.origin === self.location.origin && !isUncacheable(res)) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match('./index.html'); });
    })
  );
});
