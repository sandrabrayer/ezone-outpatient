# Header rebrand: drop "E-ZONE" text, show emblem + Hebrew name

**Date:** 2026-07-27
**Scope:** Topbar logo only. Cosmetic. No behaviour, colour, or icon-set change.

## Why

The topbar logo read **"E-ZONE Outpatient"** (English, brand-prefixed). The
header should show the app emblem next to the app's Hebrew name only —
emblem + **"טיפולי חוץ"** — matching the sibling E-ZONE apps.

## Changes

- **`public/index.html`** — the topbar `.logo` was text-only
  (`E-ZONE <span>Outpatient</span>`). It now renders the app's existing manifest
  icon (`icon-v1-192.png`, cache-busted with `?v=__BUILD__`) as a decorative
  (`alt=""`) emblem next to the Hebrew name **"טיפולי חוץ"**. No "E-ZONE" text.
- **`public/style.css`**
  - `.logo` becomes an inline flex row (`display:flex; align-items:center;
    gap:8px; white-space:nowrap; flex:0 0 auto`) so the emblem sits beside the
    name, never wraps, and does not crowd the nav. RTL layout is inherited from
    `<html dir="rtl">`, so the emblem naturally sits on the right of the name.
  - `.logo-mark` sizes the emblem to **30px** desktop, with a **28px** override
    inside the existing `@media (max-width: 600px)` block. A small `border-radius`
    softens the square icon.
  - Colours are untouched — the name keeps `var(--green-2)`; no recolour, no new
    icon set.

## Tests

`test/header-branding.test.js` (new) locks the contract:

1. topbar logo exists
2. logo carries the Hebrew name "טיפולי חוץ"
3. logo no longer shows any "E-ZONE" text
4. logo shows an emblem `<img class="logo-mark">` whose `src` is a manifest icon
   that exists on disk
5. emblem `<img>` stays cache-busted (`?v=__BUILD__`)
6. emblem is decorative (`alt=""`) — the visible name carries the label
7. `.logo` lays out inline and never wraps (RTL-safe, keeps off the nav)
8. emblem is sized 30px desktop / 28px mobile

Run: `npm test` (Node ≥ 18 built-in runner). All existing `pwa.test.js` guards
still pass — the manifest `name` ("E-ZONE Outpatient") and icon assets are
unchanged; only the visible topbar logo changed.

## Screenshots

Before/after captured desktop (1280px) + mobile (390px). Before: "E-ZONE
Outpatient" (English). After: emblem + "טיפולי חוץ".
