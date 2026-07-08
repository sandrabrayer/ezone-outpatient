# PWA icon rebrand (ecosystem colour scheme)

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

---

## Follow-up: fiercer letter green (2026-07-08)

- **Branch:** `claude/bold-e-icon-color-9p18sr` (PR base: `claude/youthful-volta-laarnk`)

Second colour pass over the same in-place recolour pipeline. The letter is
pushed to a **fiercer green**; the white ground and the exact letter-E glyph
geometry are untouched (recolour reads the currently-baked pixels and re-emits
`t·newLetter + (1-t)·white`, so the green letter-pixel count is unchanged).

### Colour change

| role       | before            | after             |
|------------|-------------------|-------------------|
| background | `#ffffff` (white) | `#ffffff` (white) |
| letter     | `#2dd47a` (green) | `#00c853` (green) |

### What changed

- **`scripts/gen-icons.js`** — `OLD_*` re-pointed to the colours currently baked
  into the committed PNGs (`#ffffff` ground, `#2dd47a` letter) so a re-run reads
  the live pixels correctly, and `NEW_LETTER` set to `#00c853`.
- **`public/icon-v1-192.png`, `public/icon-v1-512.png`,
  `public/icon-v1-maskable.png`** — regenerated in place (`node scripts/gen-icons.js`).
  Glyph geometry and the fully-opaque white maskable square are preserved.
- **`public/sw.js`** — `CACHE` bumped `ezone-outpatient-v2` → `-v3` so the
  previously-cached icon bytes are evicted on the service worker's `activate`.
- **`test/pwa.test.js`** — the icon-colour guard's `GREEN` reference updated
  `#2dd47a` → `#00c853`. The letter-presence (boldness) guard
  (`green > opaque * 0.02`) and the maskable/opacity/no-dark-pixel guards are
  unchanged.

### Note

The repo's live state at the time of this change had the service-worker cache at
`-v2` (not `-v3`), so "bump by one" lands on `-v3`. Any cache name that differs
from the previous one busts the stale icon bytes.

Full suite: green (`npm test`).

---

## Follow-up: from-scratch BOLD geometric E (2026-07-08)

- **Branch:** `claude/bold-e-icon-color-9p18sr` (PR base: `claude/youthful-volta-laarnk`)

The earlier "bold E" (PR #70) was **closed unmerged**, so the previous recolour
pass above was applied to the *old thin* glyph. This change abandons the
recolour approach entirely and **draws a bold geometric E from scratch**.

### What changed

- **`scripts/gen-icons.js`** — rewritten to **DRAW** the glyph (no longer
  recolours an existing PNG). The E is a heavy block letter: a thick vertical
  stem plus top / middle / bottom arms, centred on a white square.
  - stroke thickness **`0.185`** of the canvas (~18-20% of canvas height)
  - glyph height **`0.68`** of the canvas (E fills ~65-70%)
  - middle arm shortened to `0.80` of the glyph width so it reads as an E
  - edges are axis-aligned, so per-pixel coverage is computed **analytically**
    (exact pixel-rectangle overlap, inclusion-exclusion over the stem/arm
    rects) — clean anti-aliasing with no supersampling
  - `draw()` / `glyphRects()` are exported so the tests and preview tooling can
    reuse the exact same geometry
- **`public/icon-v1-192.png`, `public/icon-v1-512.png`,
  `public/icon-v1-maskable.png`** — regenerated (`node scripts/gen-icons.js`).
  The maskable icon draws the same glyph at scale `0.8` so it sits inside the
  launcher **safe zone** with white padding all the way to the edge; every icon
  is a fully-opaque white square.
- **`test/pwa.test.js`** — added test **12**, a real **boldness guard**: green
  letter ink coverage must stay **≥ 20%** on any-purpose icons and **≥ 12%** on
  the maskable icon (a pixel is "ink" when it is closer to the letter green than
  to white). A regression to a thin/hairline glyph fails this.

### Colours (unchanged from the previous pass)

| role       | value             |
|------------|-------------------|
| background | `#ffffff` (white) |
| letter     | `#00c853` (green) |

### Verification

- Rendered at **48 / 64 / 96 px** (both any-purpose and maskable scales) — the
  E stays a legible, heavy block glyph at every size.
- Measured ink coverage: **any-purpose ≈ 35%**, **maskable ≈ 22.7%**.
- Service-worker cache kept at **`ezone-outpatient-v3`** (no bump this pass).
- Full suite: **478 pass / 0 fail** (`npm test`).

---

## Correction: restore the ORIGINAL logo, recolour to fluorescent green (2026-07-08)

- **Branch:** `claude/bold-e-icon-color-9p18sr` (PR base: `claude/youthful-volta-laarnk`)

The two prior passes on this branch were wrong direction: the recolour landed
on the old thin glyph, and the from-scratch pass replaced the real mark with a
block **E**. This restores the **original E-ZONE logo glyph** and recolours it
in place — **no block E, no white ground**.

### What changed

- **`public/icon-v1-192.png`, `public/icon-v1-512.png`,
  `public/icon-v1-maskable.png`** — the **original** glyph PNGs (dark `#071410`
  ground, `#29d488` logo) were recovered from git history (`c7d5773^`, the state
  **before** PR #69's green-on-white recolour), then recoloured via the
  blend-remap.
- **`scripts/gen-icons.js`** — back to the **recolour** generator (decode →
  blend-remap → encode; no from-scratch drawing). Colours:

  | role       | before            | after                    |
  |------------|-------------------|--------------------------|
  | background | `#071410` (dark)  | `#071410` (dark, kept)   |
  | logo       | `#29d488` (green) | `#39ff14` (fluorescent)  |

  Each source pixel is read as a blend `t·logo + (1-t)·background`, `t` recovered
  from its RGB, and re-emitted as `t·#39ff14 + (1-t)·#071410` — anti-aliasing
  preserved, the mark never redrawn. The two `any` icons keep their transparent
  corners; the **maskable** icon is flattened to a fully-opaque **dark** square
  so its safe-zone padding stays dark to the edge.
- **`test/pwa.test.js`** — palette guards updated for **dark ground + green
  logo** (test 10 now asserts the dark ground dominates, the green logo is
  present, blends stay a small minority, and there is **no leftover white
  ground**; test 11 asserts the maskable is a fully-opaque **dark** square with
  dark corners). Test 12 replaced with a **logo-presence guard**: the
  fluorescent-green logo must occupy **≥ 5%** of an any-purpose icon and **≥ 3%**
  of the maskable icon.

### Verification

- Rendered at **48 / 64 / 96 px** (any-purpose and maskable) — the original
  logo glyph is intact and legible; nothing is a block E.
- Measured logo coverage: **any ≈ 10-11%**, **maskable ≈ 6.9%**.
- Service-worker cache kept at **`ezone-outpatient-v3`** (still bumped; no change
  this pass).
- Full suite: **478 pass / 0 fail** (`npm test`).
