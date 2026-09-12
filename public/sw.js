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
 * - v6 (2026-09-12): working indicator — new busy.js module, the spinner
 *   markup/CSS in index.html + style.css, and app.js routed through the
 *   withBusy/busyAttach helpers. CACHE bumped so an installed app cannot
 *   serve the old shell against the new app.js.
 */
var CACHE = 'ezone-outpatient-v6';
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

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.pathname.indexOf('/api/') === 0) return;

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok && url.origin === self.location.origin) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match('./index.html'); });
    })
  );
});
