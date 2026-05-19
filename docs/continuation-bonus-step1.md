# Outpatient-Continuation Bonus — Step 1 Design & Assumptions

**Scope of this document:** the OUTPATIENTS computation only (step 1 of 4).
It explains *what* `public/continuation-bonus.js` computes, *why* each
decision was made, and *which assumptions* must be confirmed before the
number is wired into DASHBOARD (step 2).

## The rule (from the project brief)

> A manager earns 5% of the monthly treatment package for each former
> patient of their house who continues as an outpatient.

Confirmed with stakeholder:

- **Cadence:** paid **every month** the patient continues (not one-time).
- **Basis figure (5% of what):** *not yet finalised* → implemented as a
  configurable switch so the rule can be set without a code change.

## Why the output is per-house, not per-manager

OUTPATIENTS stores only `house_of_origin` on each client. It has **no
manager identity** anywhere in its schema (`apps-script/Code.gs`
`CLIENTS_HEADERS`). The house→manager mapping already exists downstream in
DASHBOARD/MANAGERS. Computing per-house here:

- keeps OUTPATIENTS from owning/duplicating data it does not have,
- makes the downstream join trivial and unambiguous (house id → manager),
- matches the existing cross-app pattern (`getWinbackSource` also projects
  neutral, minimal fields and lets the consumer interpret them).

The canonical house ids (must stay in sync with `HOUSE_OF_ORIGIN_LABELS`
in `public/app.js`):

| id        | label (he)      | payable? |
|-----------|-----------------|----------|
| `raanana` | רעננה אשר       | yes      |
| `ramot`   | רמות השבים      | yes      |
| `efroni`  | קיסריה עפרוני   | yes      |
| `rehab`   | קיסריה ריהאב    | yes      |
| `external`| חיצוני          | **no** — not a house; excluded |

## Data model used (confirmed from `apps-script/Code.gs` + `public/app.js`)

A *continuing outpatient* = a row in the **`Clients`** sheet.

| field             | meaning here                                            |
|-------------------|---------------------------------------------------------|
| `house_of_origin` | source house ("מאיזה בית"); attribution key             |
| `status`          | `פעיל` / `הפסקה זמנית` / `סיים טיפול`                    |
| `pricePerSession` | **monthly package amount** for clients (UI: "חבילה חודשית"); this is exactly the app's own `monthlyRevenue()` figure — the name is legacy |
| `billingType`     | `monthly` / `single` / `bundle`                         |
| `sessionsPerWeek` | used only by the `treatments` proxy for bundle clients  |
| `bundlePrice`     | defensive fallback only when no monthly figure present  |
| `startDate`       | first month the patient can accrue                      |
| `exitDate`        | last month the patient can accrue                       |

## Configurable business rules

| option              | default     | effect |
|---------------------|-------------|--------|
| `ratePct`           | `5`         | the percentage |
| `basis`             | `'package'` | `'package'` = 5% of `pricePerSession` (contracted monthly package). `'treatments'` = 5% of a documented proxy for treatments actually received that month |
| `countPausedStatus` | `false`     | whether `הפסקה זמנית` months accrue (a paused patient receives no treatment that month, so default is no) |
| `weeksPerMonth`     | `4.33`      | only used by the `treatments` proxy for bundle billing |

### The `treatments` basis is an approximation — read before choosing it

The sheet does **not** store per-month delivered-treatment revenue. When
`basis='treatments'`:

- monthly billing → same as the package figure (a month of package == a
  month of treatment),
- bundle billing → `pricePerSession × sessionsPerWeek × weeksPerMonth`
  (sessions actually scheduled per month).

This is conservative and clearly labelled in the preview. **If finance needs
true delivered-treatment amounts, that data does not exist in the current
schema and must be sourced before `basis='treatments'` is used in
production.** This is the main open item blocking step 2 sign-off.

## Accrual logic (per patient, per month M)

1. Exclude if `house_of_origin` ∉ {raanana, ramot, efroni, rehab}.
2. Exclude if `status === 'סיים טיפול'`. Exclude if `הפסקה זמנית` unless
   `countPausedStatus`. `פעיל` / empty-legacy → continuing.
3. Exclude if M is before the `startDate` month or after the `exitDate`
   month. Missing `startDate` → treated as already ongoing. Missing
   `exitDate` → open-ended.
4. Otherwise accrue `basisAmount × ratePct/100` to that house for month M.

Rounding is applied once at the end (per house and total) for ₪-display
parity with the rest of the app (`Math.round`, matching `money()`).

## Safety properties

- Pure: no I/O, no network, mutates nothing (test-enforced).
- Cannot affect occupancy, billing, or the win-back endpoint — it is a new,
  separate, read-only module not imported by any existing code path yet.
- Fail-fast on invalid `basis`/`ratePct` (throws) so a misconfiguration can
  never silently emit a wrong money figure.
- No new dependencies.

## How to preview the money impact (before step 2)

```js
const CB = require('./public/continuation-bonus.js');
const w = CB.computeWindow(clients, '2026-04', '2026-06', { basis: 'package', ratePct: 5 });
console.log(CB.previewText(w));   // human-readable, sends nothing anywhere
```

`clients` is the same array the app already loads from `/api/sheets`.

## Open items to confirm before step 2 (hand-off to DASHBOARD)

1. Final `basis`: `package` or `treatments`?
2. If `treatments`: is the documented proxy acceptable, or must a real
   per-month delivered figure be added to the schema first?
3. Which month(s) DASHBOARD expects per feed refresh (current month only, or
   a trailing window) — affects the step-2 hand-off shape, not this module.
