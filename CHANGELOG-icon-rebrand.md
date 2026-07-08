# PWA icon rebrand (ecosystem colour scheme)

## Update — fiercer green letter (SW cache v4)

- **Date:** 2026-07-08
- **Branch:** `claude/pwa-icon-rebrand-swc2e6` (PR base: `claude/youthful-volta-laarnk`)
- Colour tweak on the bold E from PR #70 (below). Same branch/PR.

Only the letter colour changed — the **bold glyph geometry is untouched**.

| role       | before             | after                       |
|------------|--------------------|-----------------------------|
| background | `#ffffff` (white)  | `#ffffff` (white, unchanged)|
| letter     | `#2dd47a`          | `#00c853` (fiercer green)   |

### What changed (this update)

- **`scripts/gen-icons.js`** — `FG` letter colour `#2dd47a` → `#00c853`.
- **`public/icon-v1-192/512/maskable.png`** — regenerated (identical geometry,
  new letter colour). Green ink coverage still 26 % (192/512), 17 % (maskable).
- **`public/sw.js`** — **`CACHE` bumped `ezone-outpatient-v3` → `-v4`** so the
  old icon bytes are evicted on the service worker's `activate`.
- **`test/pwa.test.js`** — the letter-colour constant asserted by the icon
  guards updated `#2dd47a` → `#00c853`; cache-version guard raised to `v4+`.
  The boldness guard is unchanged. Full suite: **478 pass / 0 fail**.

**No name change.** No `Code.gs` change / no Apps Script redeploy.

---

## Update — bold letter-E redraw (SW cache v3)

- **Date:** 2026-07-08
- **Branch:** `claude/pwa-icon-rebrand-swc2e6` (PR base: `claude/youthful-volta-laarnk`)
- Follows the merged colour recolour below (PR #69, SW cache v2).

The icons no longer reuse the thin logo glyph. `scripts/gen-icons.js` now
**draws a bold, heavy geometric letter-E from scratch** — a thick vertical stem
plus top / middle / bottom arms — on the same colours (**green `#2dd47a` on a
white `#ffffff` ground**). Pure front-end: no `Code.gs` change, no Apps Script
redeploy.

### Glyph geometry

- Stroke width **≈18.4 % of the canvas** height (27 % of the glyph's own height)
  — a genuinely heavy stroke.
- The glyph fills **~68 % of the canvas** on the `any` icons, centred.
- Middle arm is 80 % of the glyph width (classic slightly-short middle bar).
- Edges are anti-aliased by 4×4 supersampling.
- Green ink coverage: **26 % (192 / 512)**, **17 % (maskable)** of the icon —
  visibly bold, verified by eye at 48 / 64 / 96 px and guarded by a test.
- **Maskable**: the glyph is pulled into the safe zone (~55 % of the canvas) and
  the rest is padded with the **background colour** (opaque white), so nothing
  looks cropped under a launcher mask.

### What changed (this update)

- **`public/icon-v1-192/512/maskable.png`** — redrawn as the bold E (same
  `icon-v1-*` filenames, in place).
- **`scripts/gen-icons.js`** — rewritten to draw the bold E procedurally
  (self-contained, built-in `zlib` only, no new dependencies).
  Re-runnable: `node scripts/gen-icons.js`.
- **`public/sw.js`** — **`CACHE` bumped `ezone-outpatient-v2` → `-v3`** so the
  old (thin-glyph) icon bytes are evicted on the service worker's `activate`.
- **`test/pwa.test.js`** — cache-version guard raised to `v3+`; added a
  **boldness guard** (ink coverage ≥20 % on `any`, ≥12 % on maskable, ≤45 %) so
  a future thin glyph can't slip back in. Full suite: **478 pass / 0 fail**.

**No name change.** No `Code.gs` change / no Apps Script redeploy.

---

## Original — colour recolour (SW cache v2, PR #69, merged)

- **Date:** 2026-07-08
- **Branch:** `claude/pwa-icon-rebrand-swc2e6` (PR base: `claude/youthful-volta-laarnk`)

Part of the ecosystem-wide E-ZONE colour rebrand. Recolours this app's
installable PWA icons to the new scheme — **green letter on a white ground** —
while keeping the **exact same letter-E glyph shape** already shipped. Pure
front-end: no `Code.gs` change, no Apps Script redeploy.

## Colour change

| role       | before             | after              |
|------------|--------------------|--------------------|
| background | `#071410` (dark)   | `#ffffff` (white)  |
| letter     | `#29d488` (green)  | `#2dd47a` (green)  |

## What changed

- **`public/icon-v1-192.png`, `public/icon-v1-512.png`,
  `public/icon-v1-maskable.png`** — recoloured **in place**. The glyph shape is
  untouched: each source pixel is read as a blend `t·letter + (1-t)·background`,
  `t` is recovered from its RGB, and the pixel is re-emitted as
  `t·#2dd47a + (1-t)·#ffffff`. This preserves every anti-aliased edge instead of
  hard-thresholding the mark — the green letter-pixel count is identical to the
  original (21 328 px at 512).
  - The two `any` icons keep their rounded **transparent corners**.
  - The **maskable** icon is flattened to a **fully-opaque white square** (alpha
    forced to 255). Its safe-zone padding is white to the very edge, so the
    launcher mask never reveals a transparent — cropped-looking — corner.

- **`scripts/gen-icons.js`** — new, **self-contained** icon (re)generator. Uses
  only Node's built-in `zlib` (no new dependencies) to decode and re-encode
  8-bit RGBA PNGs, and performs the colour remap above. Re-runnable for future
  ecosystem colour passes: `node scripts/gen-icons.js`.

- **`public/sw.js`** — **`CACHE` bumped `ezone-outpatient-v1` → `-v2`** so the
  old shell and the previously-cached icon bytes are evicted on the service
  worker's `activate`. Filenames stay `icon-v1-*` (recolour in place, per task);
  the cache bump is what forces the fresh bytes to be picked up.

## Tests

`test/pwa.test.js` — the existing 8 guards still pass (manifest validity,
versioned cache name, `/api/` never cached, versioned icon discipline, index
wiring). Added, all dependency-free (built-in `zlib` PNG decode):

- **9.** `sw.js` cache version was bumped past v1 (now `v2+`).
- **10.** every manifest icon is recoloured to a white ground with a green
  letter, with only a small minority of anti-aliased blend pixels and **zero**
  leftover dark `#071410` background pixels.
- **11.** the maskable icon is a fully-opaque white square (all pixels opaque;
  four corners white) so the safe-zone padding is not cropped.

Full suite: **477 pass / 0 fail** (`npm test`).

## Notes

- **No name change** — `manifest.webmanifest` `name`/`short_name` untouched.
- **No `Code.gs` change / no Apps Script redeploy.**
- Filenames kept as `icon-v1-*` in place (per task) rather than bumped to
  `icon-v2-*`. Freshly-installed clients get the new icons immediately and the
  `CACHE` bump evicts the stale bytes; an already-installed Android home-screen
  shortcut may keep its cached launcher icon until re-add (the documented
  filename-versioning trap), an accepted trade-off for this internal tool.
