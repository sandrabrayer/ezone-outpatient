# Browser-tab favicon — letter O (2026-10-20)

## Why
The browser tab showed no icon, so the app was hard to find among many open tabs.
Root cause: no favicon file and no `<link rel="icon">`; a browser's automatic
`GET /favicon.ico` fell through to the SPA catch-all (`app.get('*', sendIndex)`)
and received `200 text/html` (confirmed on production). Not a static-path or
service-worker issue.

## What changed
- **`scripts/gen-favicons.js`** (new, no dependencies): draws the letter
  **O** on a rounded square in the existing PWA palette (`#071410` /
  `#39ff14`, reused from `icon-v1-*.png` instead of a new style), and writes
  `public/favicon.ico` (16/32/48), `favicon.svg`, `favicon-16x16.png`,
  `favicon-32x32.png`. The apple-touch-icon already existed and is unchanged.
- **`server.js`**: explicit public routes for exactly those four paths, before
  auth and the SPA catch-all — fixed file per route, explicit image type,
  `nosniff`, 1-day cache, script-free CSP on the SVG. No auth middleware change.
- **HTML**: icon `<link>` tags (root-absolute) in `public/index.html` (PIN / name-picker screen + app — the only page).
- **`public/sw.js`**: cache `v17` → `v18` (live was v17), so installed PWAs refresh.
- **Docs**: `docs/favicons.md` (where the icons live, how to replace them),
  `README.md`, `EZONE-ECOSYSTEM-STATUS.md`.

## Tests
`test/favicon.test.js` (15 tests): files exist and equal the generator
output; ICO/PNG structure and sizes; SVG has no script / external refs; the 16px
mark is the right letter and colours; each icon route is `200` + image type +
`nosniff` + cache header **without a cookie** (GET and HEAD); traversal,
encoded-traversal, look-alike and directory probes never return an image,
source or a listing; every HTML file under `public/` and every served page
carries the link tags; SW cache floor v18.

## Security
- Static-only, public by design (an icon is never session data). Exact paths,
  fixed files, `dotfiles: 'deny'`, no directory listing, no traversal.
- No new dependencies. No Apps Script / `Code.gs` change. No secrets.

## Deploy
Frontend + Node only — Railway auto-deploy. No Apps Script deploy, no Railway
variable change.
