# Global patient search on «היום שלי» (2026-11-04)

Sandra, from production: **«תוסיף אפשרות חיפוש מטופל מהמסך הראשון»** — Vered had
to leave the opening screen for the מטופלים tab (or מטופלים לא פעילים, or
לידים) to find somebody.

## What shipped

- **A single search box pinned at the top of «היום שלי»**, above the KPI strip,
  full width, RTL, placeholder «חיפוש מטופל — שם או טלפון…»
  (`public/index.html`, `.gs-wrap` / `#globalSearch`).
- **Matching** (`public/global-search.js`, new, pure + UMD):
  - name — partial match **anywhere**, case-insensitive, Hebrew niqqud /
    cantillation (U+0591–U+05C7) stripped on both sides;
  - phone — **digits only on both sides**, so `052-378-7911`, `0523787911` and
    `3787911` all find the same client;
  - a blank query matches nothing (no list at rest).
- **Results** — a dropdown under the box, at most 8 rows, each
  `name · phone · service/house` plus a status hint **פעיל / לא פעיל / ליד**.
  Active clients first, then inactive, then open leads; alphabetical (folded)
  inside each group.
- **Sources** are the lists the app has **already loaded** — `state.clients`
  and `state.leads`. **No new backend call and no new Apps Script action.**
  Only *open* leads are offered (`not_relevant` lives in שימור לידים, `active`
  already has a client card), exactly as the לידים tab and the offer picker do.
- **Opening a result** reuses the existing navigation: `dashOpenInTab` for a
  client (the tab's own search is prefilled, so only that card shows, and the
  card is scrolled into view) and `openLeadModal` for a lead. No card rendering
  is duplicated. The box is cleared when a result is opened.
- **Keyboard** — ↓ / ↑ move the highlight, Enter opens it (or the first row),
  Esc clears and closes; a click anywhere outside closes the dropdown. Input is
  debounced ~150 ms.
- **Money / permissions** — a result row carries **no financial field at all**
  (asserted structurally in the unit tests and in the DOM in the browser
  tests), so an operational session (דנה) uses it exactly as ורד does. Nothing
  new is read: whatever a user cannot see in a list cannot appear here, because
  the list *is* the source.
- **Mobile 360 px** — the box is full width, the dropdown is absolutely
  positioned with `inset-inline: 0` under the box (so it never pushes the KPI
  strip down and never overflows sideways) and scrolls at `50vh`.

Distinct from the existing **«🔎 איתור מטופל»** panel lower on the dashboard
(`public/patient-search.js`), which stays as it is: that one is the forensic
cross-store locator (tombstones, billing-only orphans, money on the row) built
after the 2026-08-26 dropped-row incident. This one is the everyday
jump-to-patient box.

## Tests

- `test/global-search.test.js` — 10 unit tests over the exported matcher: blank
  query, partial/case-insensitive names, niqqud, every phone punctuation, open
  leads only, status hint + target tab, the structural "no financial field"
  guard, ranking, the 8-row cap, malformed input.
- `test/global-patient-search-browser.test.js` — Playwright at **1280** and
  **360**, real `server.js` + the real `Code.gs` in the in-memory sandbox:
  the box sits above the KPI strip and is full width; name → rows; phone with
  dashes → one row; ↓↓ Enter opens the inactive patient; a click opens the
  client card with the tab search prefilled; a lead opens its modal; Esc and
  click-outside close; no money in the dropdown HTML; **דנה** sees the same
  rows and no money; no horizontal overflow at 360.

## Deploy

- `public/sw.js` **v28 → v29** (`index.html`, `app.js`, `style.css` changed).
  The LIVE `/sw.js` could not be fetched from this sandbox (egress blocked) —
  verify production still serves **v28** before releasing.
- **`apps-script/Code.gs` is unchanged — no Apps Script phase.**
