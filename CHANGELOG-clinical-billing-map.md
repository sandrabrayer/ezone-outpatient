# Clinical → billing map module (`public/treatment-map.js`)

A standalone, hardcoded map that translates the **clinical** treatment
vocabulary (the names the sibling E-Zone Therapists app records per session)
into the **billing** vocabulary (what Vered's outpatient dashboard charges for),
plus the client-facing price table (incl. VAT). This is **step 4.1 only** — the
module and its tests. It is deliberately **NOT wired** into the save flow, the
client form, or `getTreatmentPlans` yet.

## Why this was needed

The clinical and billing vocabularies had drifted apart:

- The clinical list is **richer** than billing — it carries CBT/EMDR/דינמי/
  ממוקד-טראומה/עיסוי/התמכרויות/אינטגרטיבי variants the billing side never
  enumerated.
- One name was **renamed**: `מרכז יום` → `ליווי יומי בקהילה` (display-only in
  `app.js`; the day-center/location rule is bound to the new name).

Without a single source of truth, each side guesses. This module pins the
translation and the prices in one place, with tests, before anything consumes it.

## What it exposes

```js
clinicalToBilling(clinicalType)            // -> billing type string (throws if unknown)
billingPrice(billingType, frequencyPerWeek?) // -> price (see rules below)
```

Plus the underlying tables for inspection/tests: `CLINICAL_TO_BILLING`,
`BILLING_PRICES`, `BILLING_TYPES`, the `DAY_CENTER_*` constants,
`PRICE_FLAG_PER_CLIENT`, `isDayCenterBilling`, and `assertMapComplete()`.

## The map (clinical → billing, one-to-one, 12 keys)

All five previously-unmapped clinical types enter the billing list under their
**own exact names** — the billing vocabulary expands; they are **not** folded
into existing types.

| Clinical | Billing |
|---|---|
| פרטני כללי | פרטני *(rename)* |
| פרטני CBT | פרטני CBT |
| פרטני EMDR | פרטני EMDR |
| קבוצה | קבוצה |
| טיפול משפחתי | טיפול משפחתי |
| מעקב פסיכיאטרי | מעקב פסיכיאטרי |
| ליווי יומי בקהילה | ליווי יומי בקהילה *(was מרכז יום)* |
| פסיכודינמי | פסיכודינמי |
| פסיכותרפי ממוקד טראומה | פסיכותרפי ממוקד טראומה |
| עיסוי טיפולי | עיסוי טיפולי |
| טיפול ממוקד התמכרויות | טיפול ממוקד התמכרויות |
| טיפול אינטגרטיבי | טיפול אינטגרטיבי |

## Prices (client-facing, incl. VAT, keyed by billing type)

- **פרטני and all individual variants** (פרטני CBT, פרטני EMDR, פסיכודינמי,
  פסיכותרפי ממוקד טראומה, עיסוי טיפולי, טיפול ממוקד התמכרויות, טיפול
  אינטגרטיבי) → **₪500 / session**.
- **מעקב פסיכיאטרי** → **₪1,100 / session**.
- **אינטייק** → **₪2,300 / session** — a **billing-only** type (no clinical
  source maps to it).
- **ליווי יומי בקהילה** → priced **per month, by frequency**: 3×/week =
  **₪15,000**, 5×/week = **₪18,000**. This is the **only** type whose price needs
  `frequencyPerWeek`; any other (or missing) frequency **throws**.
- **קבוצה, טיפול משפחתי** → **no clinic-wide price exists** in outpatient today.
  Price is free-entry per client (`pricePerSession`; there is no hardcoded
  price-by-type anywhere in the app). We do **not** invent a number —
  `billingPrice` returns `null` (`PRICE_FLAG_PER_CLIENT`) to flag "set per
  client".

## Guarantees locked by tests (`test/treatment-map.test.js`)

- **Map completeness** — exactly the 12 clinical keys are present.
- **One-to-one integrity** — every clinical key yields exactly one billing value
  that exists in the billing vocabulary.
- **The two renames** — `פרטני כללי → פרטני`, and `ליווי יומי בקהילה` still fires
  the day-center rule (bound to the new name; legacy `מרכז יום` + stable key
  still match).
- **Price lookup** — every per-session type returns its price; ליווי returns
  15000 (freq 3) / 18000 (freq 5) and throws for any other/missing frequency;
  קבוצה / טיפול משפחתי flag as `null`.
- **Loud guard** — a 13th clinical type added without a valid billing
  target/price makes `assertMapComplete()` throw.

## Files touched

- `public/treatment-map.js` — new UMD module (Node/tests + optional browser
  global `window.TreatmentMap`), matching the `debt-status.js` /
  `charges-logic.js` / `billing-status.js` convention.
- `test/treatment-map.test.js` — new; 15 cases covering the contracts above.
- `README.md`, `CHANGELOG.md` — documented.

## Not in this step

No wiring into the save flow, the client form, or `getTreatmentPlans`. No Sheets
schema change. No Apps Script / Node / Railway change. The module is a pure,
side-effect-free map + price oracle; consuming it is a later step (4.2+).
