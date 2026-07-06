# מסלול המשך: tenure sorting + entry-date display

Small, frontend-only UI change to the **מסלול המשך** (continuation-track) tab.
The dashboard roster now delivers a live `entryDate` per patient, so each row can
show the admission date and the house sort can key on real tenure.

## What changed

1. **Entry date beside the tenure badge.** Every patient row renders the
   admission date as `dd/mm/yyyy` next to its tenure badge, and stays blank when
   the roster carries no `entryDate`. It reuses the existing app-wide
   `displayDate()` helper (`YYYY-MM-DD → DD/MM/YYYY`) — no new date formatting.

2. **Tenure sort is now a pure, exported, unit-tested comparator.** The ordering
   rule (already used inline) moved into `public/continuation-logic.js` as
   `compareByTenure(a, b)`:
   - **tenure DESC** — longest-admitted first (largest whole-months tenure), i.e.
     the patients closest to finishing their stay float to the top;
   - rows with a **missing / invalid `entryDate`** (`months == null`) always sort
     **last**;
   - **Hebrew-alphabetical** tiebreak on name for equal tenure (and for two
     missing-date rows).

   `public/app.js`'s `continuationSort` now delegates to
   `ContinuationLogic.compareByTenure` (single source of truth, same pattern as
   `buildKey` / `monthsSince` / `bucketOf`). Behavior is unchanged from the prior
   inline comparator; it is now covered by tests.

## Files touched

- `public/continuation-logic.js` — new pure `compareByTenure` export.
- `public/app.js` — render the entry date beside the badge; delegate the sort to
  the shared comparator.
- `public/style.css` — **append-only** `.continuation-entrydate` (small, muted,
  tabular-nums). It is plain text (not a control), sits inside the flex-wrap
  `.continuation-main`, and wraps under the existing ≤600px row-stacking rule, so
  the mobile pass (≥40px touch targets, ≤600px stacking) is unaffected.
- `test/continuation-logic.test.js` — new `compareByTenure` unit tests: normal
  ordering, missing-date-last, Hebrew tiebreak (dated + two-missing), purity.

## Not touched

- **`apps-script/Code.gs`** — frontend-only change; the `entryDate` field is
  already delivered by the dashboard roster and stored in the continuation sheet.
- `CLIENTS_HEADERS` / `CONTINUATION_HEADERS` — unchanged.

## Tests

`npm test` — the continuation suites pass (26/26 in
`continuation-logic` + `continuation-code`). The only failures are the two
env-dependent `Cannot find module 'express'` errors that occur when
`node_modules` is absent (`debt-status-forwarding`, `sheets-secret-forwarding`) —
pre-existing and unrelated to this change.
