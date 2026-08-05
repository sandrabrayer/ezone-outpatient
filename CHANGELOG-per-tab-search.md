# Per-tab name search — payouts tab + shared helper

Completes per-tab name search across every list tab by adding it to the one tab
that still lacked it — **תשלומי מטפלים (payouts)** — and extracts the filter
logic into a small, unit-tested pure helper so the behaviour is shared and
locked by tests.

## Context

Name search already shipped on five list tabs, each filtering inline
(case-insensitive substring on the card's name, trimmed query, empty = all):

| Tab | id | state |
|---|---|---|
| לידים (leads) | `#leadsSearch` | `state.leadSearch` |
| מטופלים (clients) | `#clientsSearch` | `state.clientSearch` |
| גבייה (billing) | `#billingSearch` | `state.billingSearch` |
| שימור לידים (retention) | `#retentionSearch` | `state.retentionSearch` |
| מסלול המשך (continuation) | `#continuationSearch` | `state.continuationSearch` |

The **דשבורד (dashboard)** tab is KPIs + alert panels, not a card list, so it is
intentionally excluded. The **payouts** tab was the remaining gap.

## What changed

### `public/name-search.js` (new)

A pure, UMD helper (`module.exports` for Node tests, `window.NameSearch` in the
browser) so the filter is shared and testable outside the `app.js` IIFE:

- `matchesName(name, query)` — case-insensitive substring; empty/whitespace
  query matches everything; `null`/`undefined` name never throws.
- `filterByName(list, query, nameOf)` — returns a **new** array (input never
  mutated, order preserved); empty query returns all; `nameOf` maps a card to
  its name string (defaults to `.name`), which lets non-`.name` cards — e.g. the
  therapist-keyed payout cards — be filtered.

### `public/index.html`

- Payouts toolbar: new `<input id="payoutSearch" class="search"
  placeholder="חיפוש לפי שם…">`, matching the other tabs' header control exactly
  (same class, same RTL-safe styling).
- Loads `name-search.js` (cache-busted `?v=__BUILD__`) **before** `app.js` so the
  `window.NameSearch` global is defined by the time `app.js` runs.

### `public/app.js`

- `state.payoutSearch` added (init `''`) — a **per-tab** field, independent of the
  other tabs' search state.
- `renderPayouts`: filters the therapist cards (both the main list and the
  הפרשים / differences list) by **therapist name** via
  `NameSearch.filterByName`. When a query matches nothing, shows
  `אין תוצאות לחיפוש`; the month-empty message (`אין סשנים לחודש זה`) is
  unchanged.
- New `#payoutSearch` `input` listener wired in `wireEvents`, re-rendering the
  payouts view live on each keystroke.

## Decisions (per the task)

- **What the payouts search filters:** the payouts tab's cards are grouped by
  **therapist**, so the search filters therapist cards by therapist name — the
  card's own primary name, exactly as every other tab filters its card's name.
- **Phone matching: not included on payouts.** Phone lives on individual
  *session* rows inside a card, not on the therapist card itself, so there is no
  card-level phone to match. Name-only keeps payouts consistent with the other
  five tabs (all name-only today).
- **Counts/totals stay global on payouts.** The top KPI row (therapists, paid
  sessions, pre-VAT, incl-VAT) is a whole-month payroll roll-up; a user typing a
  name is *locating* a therapist, not recomputing the month's payroll. Changing
  the totals would also mislead against the Excel export, which always covers the
  full month. `lastPayoutSummary` (the export source) is therefore left
  **unfiltered**. This mirrors the billing tab, whose month KPIs also stay
  global. Each therapist card still shows its own per-therapist stats.
- **Empty query = current behavior exactly:** `filterByName` returns the full
  list unchanged (a copy) when the query is empty/whitespace.

## Tests — `test/name-search.test.js` (new)

`node:test` (repo convention), importing `public/name-search.js` directly:

- name match, case-insensitivity, empty query returns all, no-match returns
  empty;
- `nameOf` accessor filters therapist-keyed (non-`.name`) cards;
- input list is never mutated;
- **per-tab independence:** because the helper is pure, filtering one tab's list
  with one query leaves another tab's list (filtered with a different query)
  untouched — modelling `state.payoutSearch` vs `state.clientSearch` isolation.

Full suite: `npm test` → all search/frontend tests pass, zero regressions. (Two
pre-existing failures — `debt-status-forwarding`, `sheets-secret-forwarding` —
fail identically on the base branch: they need the `express` dependency, which is
absent in this environment. Unrelated to this change.)

## Not changed

- No backend / Apps Script changes; frontend-only.
- `CLIENTS_HEADERS` and all sheet schemas untouched.
- The five existing tab searches and their inline filters are untouched.
