# «למי ההצעה» — browse the picker without typing (2026-11-04)

Sandra, from production: **«הצעת מחיר עם אפשרות בחירת שם או מהמאושפזים או
מהלידים הקיימים»**. Since #167 the picker only rendered after **2+ typed
characters** (`if (q.length < 2) { list.hidden = true; return; }` in
`whoPicker`/`fill()`), so clicking the empty field showed nothing: Vered could
only find a name she already knew, where before #167 a `<select>` let her open
and scan. A regression in her eyes.

## What shipped (`public/package-pricing.js`, `public/style.css`)

- **Focusing or clicking the empty field opens the grouped list at once**, with
  the existing section headers «מטופלים (n) · מאושפזים (n) · לידים פתוחים (n)»,
  the existing row markup and the existing click handler. The 2-character floor
  is gone, so a single typed character now filters too; typing is otherwise
  unchanged.
- **Browse contract** (deliberate change, documented in the source):
  `matchTargetsGrouped(targets, '', perType)` now returns **every** target
  grouped, through a new pure `browseTargets(targets)`. `matchTargets` keeps its
  own contract — a blank query there still matches nothing — so no existing unit
  test changed.
- Each section is capped at `BROWSE_PER_TYPE = 15` while browsing (6 while
  filtering, as before), sections stay in the `TARGET_SECTIONS` order, rows are
  sorted by name (`he` locale) through one shared comparator. `total` in the
  header stays **uncapped**, so «מאושפזים (23)» is honest, and a truncated
  section ends with one muted row **«הקלידי שם או טלפון לסינון…»**.
- The dropdown scrolls instead of growing: `.pkg-who-list` `max-height`
  `280px → 45vh`.
- **Esc** closes the list and **a click outside** closes it (capture-phase
  listener that removes itself once the picker is gone). Picking a row behaves
  exactly as before.
- Empty sections are still omitted. **A roster-load failure is not surfaced in
  the picker:** the module is handed a flat `targets` array by
  `offerTargets()` in `app.js` and cannot distinguish "no admitted patients"
  from "the roster did not load", and the brief said not to invent plumbing —
  so no «רשימת המאושפזים אינה זמינה כרגע» row was added. Making that honest
  needs `offerTargets()` to pass a per-source load state; worth doing, but it is
  a separate change.
- No new backend call, no change to how `offerTargets()` is built, no financial
  data on a row.

## Tests

- `test/offer-picker-browse.test.js` — 6 unit tests: the empty-query browse
  contract (every source, section order, he-locale sort), the per-section cap +
  `truncated` + uncapped `total`, empty sections omitted, `browseTargets` purity,
  typing still filtering (one character included) while `matchTargets('')` stays
  `[]`, and static guards (no `q.length < 2`, focus/Esc/outside-click wiring,
  the truncation row, no price on a picker row).
- `test/global-patient-search-browser.test.js` — Playwright at **1280** and
  **360**: clicking the empty field shows the three sections with honest totals
  and all six targets, the list is scrollable and bounded, a not-relevant lead
  is never offered, typing narrows to one section and clearing goes back to
  browse, an admitted patient is picked straight out of the browse list, the
  manual «לקוח שאינו במערכת» row still works, Esc closes.
- `test/crm-followup-2.test.js` and `test/crm-followup-2-browser.test.js` are
  unchanged and still green.

## Deploy

Same SW bump as the patient-search change (`v28 → v29`). **`Code.gs` unchanged
— no Apps Script phase.**
