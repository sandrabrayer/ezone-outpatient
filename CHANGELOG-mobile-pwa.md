# Mobile / PWA layer ("the phone option")

- **Date:** 2026-07-05
- **Branch:** `claude/mobile-pwa-layer-89p2e0` (PR base: `claude/youthful-volta-laarnk`)

Adds an installable Progressive Web App layer so E-ZONE Outpatient can be added
to a phone home screen and opened standalone. Pure front-end: **no Code.gs
change, no Apps Script redeploy.**

## New files

- **`public/manifest.webmanifest`** — web app manifest. RTL/Hebrew, `standalone`
  display, `portrait-primary`, `#071410` background/theme, `start_url`/`scope`
  `./`, and the three icons below.
- **`public/sw.js`** — service worker, **network-first** (same recipe as
  ezone-therapists). This is a live-data app, so the network always wins; the
  cache is a fallback only, letting an installed app open offline (read-only of
  whatever was last seen). **`/api/` requests are never cached or intercepted**
  (data must stay live). Only same-origin GET responses are cached.
- **`public/icon-v1-192.png`, `public/icon-v1-512.png`,
  `public/icon-v1-maskable.png`** — app icons. The shared E-ZONE logo recolored
  to the app colors (**`#29d488` on `#071410`**). Filenames are **versioned from
  day one** because Android caches launcher icons aggressively and will not
  refresh a re-used filename.

## Edits

- **`public/index.html`** — two surgical edits:
  1. `viewport` gains `viewport-fit=cover`; after `<title>` add the manifest
     link, `theme-color`, the Apple web-app meta tags, and the apple-touch-icon.
  2. Before the `app.js` script, an **inline** `<script>` registers `sw.js` on
     `load`. No `?v=__BUILD__` cache-buster was touched.
- **`public/style.css`** — appended a **Mobile / PWA pass** section (nothing
  above it changed): `≤600px` handling for topbar/tabs (horizontal swipe strip),
  toolbars, pipeline counters, occupancy bars, billing/summary rows and modals
  (bottom-sheet); `pointer: coarse` touch targets ≥40px with 16px inputs to stop
  iOS zoom-on-focus; and `display-mode: standalone` safe-area insets for
  notches / home indicator.

## Tests

- **`test/pwa.test.js`** — 8 guard tests (`node:test` + `assert`) locking:
  1. manifest parses; name/lang/dir/display + start_url/scope.
  2. icons cover 192 any / 512 any / 512 maskable; every src is versioned and
     the file exists.
  3. SW cache name is versioned (`ezone-outpatient-v\d+`).
  4. `/api/` guard runs before `respondWith`.
  5. SW ignores non-GET.
  6. every icon filename in SW is versioned.
  7. index.html wires manifest / SW / apple-touch-icon; every external script
     stays `?v=__BUILD__`.
  8. the SW-registration `<script>` is inline (no `src`).

## Notes

- **No `Code.gs` change / no Apps Script redeploy.**
- The service worker **never caches `/api/`** — data is always live.

## Future icon-change procedure (Android icon-cache trap)

When the icons change, do **all** of the following together:

1. Ship the new files as **`icon-v2-*`** (bump the version in the filename — do
   not overwrite `icon-v1-*`).
2. Update **`manifest.webmanifest`** icon `src`s to the new filenames.
3. Update the **`SHELL`** array in `sw.js` to the new icon filenames.
4. Update the **`apple-touch-icon`** href in `index.html`.
5. **Bump `CACHE`** in `sw.js` to `ezone-outpatient-v2` so the old shell (and
   old icons) are evicted on activate.
