# Treatment-type rename: "מרכז יום" → "ליווי יומי בקהילה"

**Date:** 2026-06-11
**Scope:** Display-label rename of the day-center treatment type, driven by
licensing. Implemented as **stable-key + display-label + backward-compat alias**.
**No sheet migration / backfill.**

## Why

The treatment type previously labelled **"מרכז יום"** must now be presented as
**"ליווי יומי בקהילה"** for licensing reasons. Existing rows in the Sheet keep
their stored value; nothing is rewritten.

## Model

```js
DAY_CENTER_KEY     = 'day_center'              // stable, never changes
DAY_CENTER_LABEL   = 'ליווי יומי בקהילה'         // display only
DAY_CENTER_ALIASES = ['מרכז יום', 'ליווי יומי בקהילה', 'day_center']
```

The `serviceType` column is **not keyed** — it stores the display **label**
(comma-joined). Therefore new writes persist `DAY_CENTER_LABEL`, while existing
`"מרכז יום"` rows continue to match through `DAY_CENTER_ALIASES`.

## Changes (all in `public/app.js`)

- **Constants** — added `DAY_CENTER_KEY`, `DAY_CENTER_LABEL`, `DAY_CENTER_ALIASES`
  ahead of `SERVICE_TYPES`. Removed the single-value `DAY_CENTER` constant.
- **STORE + RENDER** — the `SERVICE_TYPES` entry is now `DAY_CENTER_LABEL`. This
  is the checkbox value (persisted on new writes) and the option/tab/chart label
  (rendered). The legacy `"מרכז יום"` option is retired (no longer selectable).
- **COMPARE** — `hasDayCenter()` now matches against `DAY_CENTER_ALIASES` instead
  of a single constant, so old and new values both resolve as day-center.
- Replaced all inline `services.indexOf(DAY_CENTER) !== -1` /
  `picked.indexOf(DAY_CENTER) !== -1` comparisons with `hasDayCenter(...)`
  (lead form read, location-visibility for lead + direct forms, direct-client
  add, lead activation).
- **Client-tab filter** — special-cased: when the active tab is the day-center
  label, filtering uses `hasDayCenter()` so existing `"מרכז יום"` rows still
  appear under the renamed tab.

## Behavior for existing data

- Old rows render their stored `"מרכז יום"` label in service chips (acceptable —
  no backfill). All day-center *logic* (location routing, tab filter, form
  prefill) still treats them correctly via aliases.
- New rows store and render `"ליווי יומי בקהילה"`.

## Tests

`test/day-center.test.js` — covers `hasDayCenter()` for all three alias values
(`'מרכז יום'`, `'ליווי יומי בקהילה'`, `'day_center'`) plus a negative case.
Run: `npm test`.

## Follow-up: edit-modal checked-state alias gap

`populateServiceGroup` (`public/app.js`) renders the service-type checkboxes
from `SERVICE_TYPES`, so the day-center checkbox value is now `DAY_CENTER_LABEL`.
The checked test was strict (`picked.indexOf(s) !== -1`), so a legacy lead
stored as `"מרכז יום"` rendered the day-center box **unchecked** — and saving
would have dropped the service (data loss on legacy rows).

Fix: the checked test is now alias-aware **for the day-center option only** —
`s === DAY_CENTER_LABEL ? hasDayCenter(picked) : picked.indexOf(s) !== -1`. All
other service types keep strict matching (matching is not broadened elsewhere).

STORE side (confirmed): on save, `readServiceGroup` returns each checked
checkbox's `value`, which for the day-center option is `DAY_CENTER_LABEL`. So
editing a legacy `"מרכז יום"` lead with the box checked **heals the row to
`DAY_CENTER_LABEL` one-way**. No duplicates: there is a single day-center
checkbox, and the old stored string is not carried separately.

Test coverage added to `test/day-center.test.js`: a picked array containing
`"מרכז יום"` (and `'day_center'`) yields checked=true for the day-center option;
the option is unchecked when no day-center service is stored; non-day-center
options remain strict (a legacy day-center value never checks unrelated types).

## Not touched

- `apps-script/Code.gs` — **no change** (the string never appeared there). No
  redeploy required.
- `DAY_CENTER_LOCATION` (`'רעננה הפרדס'`) — a location name, unrelated to the
  treatment label.
