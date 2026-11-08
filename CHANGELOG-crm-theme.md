# Light CRM theme on the Outpatient's own palette (OP-CRM-4, 2026-10-29)

Sandra, 29/10: «תעשה את הפורמט של העיצוב דומה לדשבורד אבל עם צבעי רקע שונים וכמובן ספציפיקציות של התוכנה עצמה».
Same **format** as the Dashboard CRM (E-Zone-Dashboard `public/crm/crm.css`), different **colours**, the Outpatient's own
screens and terms.

## What changed

- **`public/style.css` `:root`** — token values moved from the dark green theme to a light one. Token NAMES are unchanged, so
  every existing rule keeps working:
  - page `--bg #EDF4EF` (sage mist; Dashboard uses slate `#E6ECF2`), surfaces white, `--panel-2 #DCE8DF`, `--border #B5CBBC`;
  - text `#0F2219` / soft `#2F4A3C` / muted `#4E665A`;
  - action `--green #157A52` (forest; Dashboard uses teal `#0B6B63`), value colour `--green-2 #0E6B46`, `--green-deep #0B5236`;
  - `--red #B42318`, `--amber #9A5B00`, `--blue-soft #DCEBFA` (background only), `--blue-deep #1D4F8C` (text).
  - All 40-odd hard-coded dark colours (banners, status chips, retention cards, patient-card halves, stop/warn banners,
    charge statuses, duplicate report) mapped to light equivalents: red = exception, amber = waiting, green = done — always next
    to a word or icon (`test/crm-theme.test.js` #6). WhatsApp / stop / resume brand buttons unchanged.
  - Dark radial gradients, translucent dark top bar and the heavy shadow removed; `--shadow` is the Dashboard's `0 1px 3px`.
- **Layout (desktop ≥ 900px)** — the Dashboard-CRM format: fixed 220px menu on the **right** (logo, vertical tabs with an icon
  per screen, session/actions pinned to the bottom), content on the left, full width. **Below 900px nothing moved**: the top
  bar and the horizontally scrolling tab strip are exactly as before (mobile screenshot checked).
- **`public/index.html`** `theme-color` `#071410 → #EDF4EF`; **`public/manifest.webmanifest`** `background_color #EDF4EF`,
  `theme_color #157A52`. Icons unchanged (still the dark ground with the green «O» — `test/pwa.test.js` keeps pinning them).
- **SW cache** `v21 → v22` (`index.html` and the manifest are in the precached shell).
- `apps-script/**` **not touched** — no Apps Script release.

## Contrast (WCAG AA, pinned by `test/crm-theme.test.js`)

text on white ≥ 7 · muted on white ≥ 4.5 · white on the primary button ≥ 4.5 (that is why `--green` is `#157A52`, not the
brighter `#178A5A`) · value green, red, amber and blue on white ≥ 4.5.

## Not changed

Any behaviour, data, route or markup other than the `theme-color` meta. «היום שלי», the kanban, the patient card, billing,
revenue, retention and continuation screens render on the same classes with the new values.

## Tests

`test/crm-theme.test.js` (6): light tokens + own palette (not the Dashboard's), AA contrast, no dark leftovers, side-menu
layout + an icon for every tab + mobile strip kept, theme-color/manifest/SW v22+, state chips carry a word. Pins updated in
`card-money-panel-fixes`, `monthly-revenue` (expected-revenue colour is now `--blue-deep`). Full suite 1700/1700.

## Release

Draft PR → Sandra's approval → merge → `/api/version` = merge SHA → hard refresh, `/sw.js` shows `v22`.
