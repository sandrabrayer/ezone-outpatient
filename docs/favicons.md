# Browser-tab favicons

E-ZONE Outpatient shows a distinct tab icon: the letter **O** on a rounded square,
in this app's existing PWA palette (ground `#071410`, letter `#39ff14` — the same
colours as `icon-v1-*.png`). The sibling app uses a different letter *and* colour
(therapists = pink **T**, outpatient = green **O**), so the two are easy to tell
apart at 16px among many open tabs.

## Where the icons live

All under `public/` (served from the site root):

| File | Use |
|---|---|
| `favicon.ico` | Legacy / default `/favicon.ico` request — 16, 32 and 48 px PNG entries |
| `favicon.svg` | Vector icon for modern browsers |
| `favicon-32x32.png` | 32px tab icon (hi-dpi tabs, bookmarks) |
| `favicon-16x16.png` | 16px tab icon |

The home-screen (PWA) icons are unchanged: `icon-v1-*.png` via `manifest.webmanifest`,
and the existing `apple-touch-icon` link.

## How they are wired

- **HTML** — every page the app serves has these tags in `<head>`
  (`public/index.html`), with root-absolute paths:
  ```html
  <link rel="icon" href="/favicon.ico" sizes="32x32" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="icon" href="/favicon-32x32.png" type="image/png" sizes="32x32" />
  <link rel="icon" href="/favicon-16x16.png" type="image/png" sizes="16x16" />
  ```
- **Server** (`server.js`, `FAVICONS`) — the four exact paths are explicit public
  routes, registered before any auth and before the SPA catch-all. Each maps to
  one fixed file (no user input reaches the file path: no traversal, no
  directory listing), with an explicit image `Content-Type`,
  `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=86400`
  (1 day), and — for the SVG — `Content-Security-Policy: default-src 'none'`.
  Before this, `/favicon.ico` fell through to the SPA catch-all and came back as
  `200 text/html`, which is why the tab showed no icon.

## How to replace them

1. Edit `APP` (letter / colours) or `GEOMETRY` in `scripts/gen-favicons.js`
   (no dependencies; geometry is on a 16-unit grid so edges stay crisp at 16/32px).
   The `T` and `O` marks are built in; another letter needs its own shape in
   `inLetter()` and `svg()`.
2. Run `node scripts/gen-favicons.js` — rewrites the four files in `public/`.
3. Bump `CACHE` in `public/sw.js` monotonically **from the LIVE version** (check
   what production serves) so installed PWAs drop the old icons.
4. `npm test` — `test/favicon.test.js` fails if the committed files differ from
   the generator output, if a route stops being public / image-typed, or if any
   HTML page under `public/` lacks the link tags.

Browsers cache favicons hard; after a deploy a hard refresh (or closing and
reopening the tab) may be needed to see a change.
