# Per-tab name search — Payouts tab

Completes the per-tab name search across the app by adding the last missing
search box: the **Payouts** tab (תשלומי מטפלים). Every other list tab —
Leads, Clients, Billing, Retention, Continuation — already had a `#…Search`
input (see `CHANGELOG-name-search.md`); Payouts was the only list tab without
one. This change closes that gap and extracts the shared matching rule into a
tested, framework-free helper.

## Tab inventory (list-displaying tabs)

| Tab | Hebrew | Search box |
|-----|--------|-----------|
| Leads | לידים | `#leadsSearch` (pre-existing) |
| Clients | מטופלים | `#clientsSearch` (pre-existing) |
| Billing | גבייה | `#billingSearch` (pre-existing) |
| Retention | שימור לידים | `#retentionSearch` (pre-existing) |
| **Payouts** | **תשלומי מטפלים** | **`#payoutSearch` (new)** |
| Continuation | מסלול המשך | `#continuationSearch` (pre-existing) |

`Dashboard` is a KPI/panel summary, not a card list — no search box.

## What changed

### `public/name-search.js` (new)

A pure, framework-free helper — the single source of truth for the search rule
that every tab already applied inline. UMD-wrapped like `billing-status.js`
(`module.exports` for tests, `window.NameSearch` for the browser).

- `matchesName(name, query)` — trimmed, case-insensitive substring match;
  empty/whitespace query matches everything; `null`/`undefined` names are safe.
- `filterByName(items, query, getName)` — returns a **new** array; empty query
  returns a shallow copy of the whole list (current behavior exactly); no match
  returns `[]`. The functions hold no state between calls, which is what makes
  per-tab independence structurally guaranteed.

### `public/index.html`

- Loads `name-search.js` (deferred, before `app.js`).
- Payouts toolbar: new `<input id="payoutSearch" class="search"
  placeholder="חיפוש לפי שם מטפל…" />`, matching the existing `.search` styling
  used on every other tab (RTL-safe — no direction-specific rules).

### `public/app.js`

- `state.payoutSearch` added (init `''`), alongside the other per-tab search
  states. It is independent — searching Payouts does not touch any other tab.
- `renderPayouts` filters the therapist cards (and the הפרשים / differences
  cards) via `NameSearch.filterByName(..., t => t.therapist)`. A new
  no-results message is shown when a query matches nothing.
- Wired a new `'input'` listener on `#payoutSearch` that re-renders **only**
  the Payouts view.

## Design choices (reported)

- **Match target = therapist name.** The Payouts tab is a per-therapist monthly
  summary; each card's identity is the therapist (`t.therapist`). Patient names
  live only inside each card's collapsed session-detail table, so the card-level
  "name" is the therapist name. Filtering by therapist name is the clear user
  expectation for this tab.
- **No phone matching on this tab.** Phone numbers are not shown on the payout
  card surface (only patient phones inside the expandable detail), so per the
  task's "if phones are readily available on the card" condition, phone matching
  was **not** included here.
- **KPIs stay global.** The four payout KPIs (therapist count, paid sessions,
  pre-VAT, incl-VAT) remain the month overview and do **not** change when the
  user types — consistent with the documented billing-tab precedent
  (`CHANGELOG-name-search.md`). Only the rendered card list narrows.
- **Excel export unchanged.** `lastPayoutSummary` still holds the full,
  unfiltered month, so the "ייצוא לאקסל" export continues to export the entire
  month regardless of the search box.
- **Empty query = current behavior exactly.** An empty search renders every card
  as before.

## Tests

`test/name-search.test.js` (13 tests, `node:test` — the repo's runner):

- name match, case-insensitivity, query trimming, safe null handling
- empty query returns all (as a copy, source not mutated)
- no-match returns empty
- default identity `getName` for string lists
- per-tab independence: two tabs with distinct query states filter
  independently, and clearing one does not affect the other

Full suite: **499 tests, 0 failures** (requires `npm install` first — two
forwarding integration tests need the `express` dependency).

## Not changed

- Frontend only. No backend / Apps Script changes.
- `CLIENTS_HEADERS` and all sheet schemas untouched.
- The five pre-existing search boxes and their wiring are untouched.
