# Patient-card redesign — two-column layout + psychiatric frequency fix

Restructures the **active-patient** card (`clientCard` in `public/app.js`) into a
two-column layout and corrects the psychiatric follow-up frequency unit. **Lead
cards keep their layout** (only the frequency-unit bug is fixed there too).
Frontend-only — no data-model/header/Code.gs change, no Apps Script redeploy.

Four commits, one per logical change.

## 1. Theme tokens (`public/style.css`)

All derived from existing theme values — no new hue:
- `--blue-soft` / `--blue-deep`: promoted verbatim from the existing
  `chip-next` / `next-bill` blue (`#cce5ff` / `#004085`). `chip-next` and
  `next-bill` now reference these tokens.
- `--panel-money` / `--panel-plan` (+ matching borders): `color-mix` tints of
  `--green-deep` and `--blue-deep` over `--panel`, so each card half is distinct
  from the card background and from each other.
- **Fallback:** the panel-tint *use sites* (`.cc-money` / `.cc-plan`) set a
  precomputed static hex (`#124733`/`#1a6a49`, `#0d3845`/`#13536e` — computed
  from the same tokens) as the base, then opt into the `color-mix` tokens via
  `@supports`. A `var()`/`color-mix` value the browser can't resolve becomes
  invalid at computed-value time and falls back to transparent (not to a prior
  declaration), so the hex must be the base — guaranteeing the tints always
  render even on browsers without `color-mix`.

## 2. Card restructure (`public/app.js`, `public/style.css`)

- **Top band (full width):** renewal banner → name + status badge → phone +
  location.
- **Body (two columns):**
  - **כספים (right, RTL reads first)** — tint `--panel-money`: single
    `חבילה חודשית` amount (the redundant `הכנסה` is dropped — `monthlyRevenue` is
    literally `pricePerSession`, always equal), the `חבילה` paid chip (still the
    editor toggle), then `שולם ב` / `גבייה הבאה` / `תחילת טיפול` stacked
    label-over-value. `גבייה הבאה` is highlighted with the promoted blue.
  - **תוכנית טיפול (left)** — tint `--panel-plan`: scope chip, treatment-type
    rows (name + frequency), `בית מוצא`. Total-sessions/week and day-counting are
    dropped. (Standalone service-name chips are dropped — redundant with the
    treatment rows. Location + scope are preserved, relocated.)
- **Actions** span the bottom (unchanged behavior).
- **Card width:** min raised `280 → 380px` so two columns fit (≈3→2 per row on a
  typical desktop, acceptable). Below `560px` the two halves stack with **money
  on top**.

## 3. Extra-charges placement (`public/app.js`)

The additional-treatments (extra charges) list now renders **inside the
תוכנית טיפול panel** rather than below the card body. It is **not** redundant
with the base paid chip (this was confirmed in investigation): it shows active
additional treatments + their paid status and carries the editor-only **×
remove** control. It only renders when the patient has active charges, so empty
cards stay clean.

## 4. מעקב פסיכיאטרי frequency unit (`public/charges-logic.js`, `public/app.js`)

Psychiatric follow-up is **monthly**, but every treatment type was rendering
`/שבוע`. New pure helper `sessionFrequencyUnit(serviceType)` returns `חודש` for
`מעקב פסיכיאטרי` and `שבוע` for all others (mirrored inline in `app.js`). Applied
at **both** render sites — the patient card and the lead card's agreement-stage
chips (`leadCard`) — since the wrong unit is a data-correctness bug everywhere.
The lead card's layout is otherwise untouched.

## Tests

`test/charges.test.js` — `sessionFrequencyUnit`: `מעקב פסיכיאטרי` → `חודש`; all
other types (`פרטני`, `פרטני CBT`, `פרטני EMDR`, `קבוצה`, `טיפול משפחתי`,
`מרכז יום`) → `שבוע`. Full pure-module suite green. Pre-existing
`sheets-secret-forwarding.test.js` (EADDRINUSE) and `debt-status-forwarding.test.js`
(`express` not installed) are environmental and unrelated.

## Files touched

- `public/style.css` — tokens, two-column layout, panel tints, mobile stacking,
  card width.
- `public/app.js` — `clientCard` restructure, `sessionFrequencyUnit` (inline),
  `leadCard` unit fix.
- `public/charges-logic.js` — `sessionFrequencyUnit` (pure).
- `test/charges.test.js` — unit test.
