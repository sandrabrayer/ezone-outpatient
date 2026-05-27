# Per-tab name search

Adds a name-search input to the Leads, Retention, and Billing tabs, matching the
exact pattern of the existing `#clientsSearch` on the Clients tab
(case-insensitive substring match against `name`, trimmed query, re-renders on
every `input` event).

## What changed

### `public/index.html`
- Leads toolbar: placeholder narrowed from
  `חיפוש לפי שם או טלפון…` to `חיפוש לפי שם…`.
- Retention toolbar: new `<input id="retentionSearch" class="search">`.
- Billing toolbar: new `<input id="billingSearch" class="search">`.

### `public/app.js`
- `state.retentionSearch` and `state.billingSearch` added (both init to `''`).
- `renderLeads`: filter is now name-only (drops phone — see "Design note"
  below) to align with the `clientsSearch` pattern.
- `renderRetention`: applies `state.retentionSearch` to both lists
  (`לא רלוונטים` and `סיימו טיפול`).
- `renderBilling` / `renderBillingOpenList` / `renderBillingMonthlySummary`:
  apply `state.billingSearch` to (a) the due list at the selected date, (b)
  open balances carried over from earlier dates, and (c) the per-client
  breakdown (`#billMonthByClient`) inside the monthly summary. Filter is on
  `client.name` / `payment.clientName`. The monthly KPIs
  (`#billMonthCollected`, `#billMonthOutstanding`) stay global — they are
  computed from the unfiltered month set so the totals at the top of the
  panel don't change when the user types a name.
- Wired two new `'input'` listeners in `wireEvents` (`#retentionSearch`,
  `#billingSearch`).

## Design note

Leads search matches name only, consistent with all other tabs. Confirmed
with product owner.

## Not changed

- No backend changes.
- The `#leadsSearch` element id and existing wiring were kept; only the filter
  shape and placeholder changed.
- `state.leadSearch` was already present and is untouched.
