# Patient-card money-panel fix set

Four patient-card fixes, all reproduced/verified end-to-end against a stub
`/api/sheets` backend driven through the real `public/` files in a Playwright
browser harness (the same stub-backend + browser pattern as the previous card
sessions). **Frontend-only — `apps-script/Code.gs` was NOT changed, so no Apps
Script redeploy is required.** `CLIENTS_HEADERS` is untouched (append-only).

Base branch: `claude/youthful-volta-laarnk` (after PR #60).

## #1 שולם quick action in חידוש ותשלום — reproduced, already correct

**Reported:** the שולם quick action inside the חידוש ותשלום modal fails with
`Error: Unknown clinical treatment type: "paid"`, suspected mis-wired to the
clinical-type endpoint.

**Finding (reproduced live first):** on the committed youthful-volta base the
שולם button is **already correctly wired** to the existing `setCurrentMonthPaid`
path. Driving it in the browser harness posts **`savePayment`** (not `saveAll` /
`setClinicalType`), shows `החודש סומן כשולם`, flips the card's package chip to
שולם and persists the current-month base payment — **no clinical-type error**,
including when the client carries a real `clinicalTreatmentType`.

The `Unknown clinical treatment type: "paid"` string can only be thrown by
`Code.gs _deriveClientServiceType`, which runs on `saveAll` / `setClinicalType`
only. The שולם path never calls either (it calls `persistPayment` →
`apiPostAction('savePayment', …)` → `_upsertPayment`, which touches only the
Payments sheet). The frontend contains **no** `setClinicalType` POST at all.
The button was introduced already-correct in PR #60; the regression is not
present on this base (a stale cached `app.js?v=…` on the live tab is the likely
source of the original observation — each deploy cache-busts the bundle).

**What shipped for #1:** a **regression lock** (no production change needed).
`test/card-money-panel-fixes.test.js` guards that the `#renewMarkPaid` handler
calls `setCurrentMonthPaid(c, true)`, that `setCurrentMonthPaid` persists via
`persistPayment`→`savePayment` and never `saveAll`/`setClinicalType`, that the
renew modal has no clinical field, and that the frontend never posts
`setClinicalType`. Any future re-wire to the clinical endpoint fails the suite.

> **Code.gs change? NO.** The שולם path is a pure `savePayment` upsert; it never
> reaches the clinical derive. No Apps Script change is warranted or made.

## #2 All money content moves to the right כספים panel

The extra-charge rows (חד-פעמי / חודשי chips with the paid-toggle) used to render
in the **left** תוכנית טיפול panel. They now render in the **right** כספים panel
alongside the monthly amount, paid chip and dated rows — so every money item is
on one side. The left panel is now purely clinical (treatment-type rows, session
credit, בית מוצא).

- `public/app.js` (`clientCard`): `chargesHtml` moved from the `cc-plan` block
  into the `cc-money` block.
- `public/style.css`: the two-column split is now `1.25fr 0.75fr` (money wider,
  plan narrower). The green/blue tints and the `@supports (background:
  color-mix(...))` fallback pattern are unchanged, and the `≤560px` rule still
  collapses the card to a single stacked column (money on top).

## #3 Extra-charge inline edit (✏️)

Each extra-charge row now shows an **✏️ edit** action for editors (next to the
existing paid-toggle and ✕ delete, both unchanged). It opens a small modal
(`#editChargeModal`) prefilled with the charge's **type / amount / description /
date** (plus billing-day + weekly frequency for monthly charges) — the
wrong-amount-correction use case. Saving writes back through the **same charge
row**: the submit handler looks the charge up by id and calls the existing
`persistCharge` (`saveCharge`, a row upsert by id), so the `chg-<chargeId>` id
stays stable — an edit **updates** the row and never creates a duplicate.
Optimistic update + `render()`, with a full field snapshot rolled back on a
failed save.

- `public/index.html`: new `#editChargeModal` / `#editChargeForm`.
- `public/app.js`: `openEditChargeModal` / `closeEditChargeModal` /
  `updateEditChargeBillingDayVisibility`, the `#editChargeForm` submit handler,
  and the per-row `data-charge-edit` button + wiring.
- `public/style.css`: `.charge-edit` control styling.

## #4 אחראי-טיפול remnants removed (UI + duplicate checks)

The אחראי-טיפול role was removed from the product. The **טלפון אחראי טיפול**
field/section is deleted from the edit modal, and `treatmentContactPhone` is
dropped from the patient-**identity** duplicate checks. This is **UI + payload
only** — the sheet column stays.

- `public/index.html`: removed the `אחראי טיפול` section title and the
  `treatmentContactPhone` input from the edit-client form.
- `public/app.js`: removed the edit-save read/validate/assignment of the contact
  phone (`tcPhone`); the patient-identity duplicate guards
  (`clientIdentityPhones`, `duplicateClientReport`) now key on the patient's own
  `phone` only. The already-neutralised (PR #60) contact-phone duplicate *block*
  stays gone.
- **Kept on purpose:** `treatmentContactPhone` remains a **legacy read-only
  column** — `normalizeClient` still hydrates it and `clientForSheet` passes the
  loaded value through (it is simply never sourced from a UI control anymore), so
  the cross-app phone-matching that legitimately uses it (stop-flag resolution,
  debt-status projection, deactivate matching) and the overdue `wa-stop`
  WhatsApp action keep working off existing data. This mirrors the
  responsible-removal precedent ("keep the column, stop writing it from the UI").
- **`CLIENTS_HEADERS` is untouched** — `treatmentContactPhone` is mid-array;
  removing it would shift every later column (incl. the `phone` cross-app join
  key) on the positional sheet. The column is kept; the UI just stops writing it.

## Tests

`test/card-money-panel-fixes.test.js` (17 cases): #1 wiring lock (4), #2 panel
placement + split + tints + mobile stack (4), #3 edit-transition pure mirror +
row/handler guards (4), #4 UI-removal + identity-check + kept-column guards (5).

Updated for the #4 removal (they asserted the old behaviour):
- `test/responsible-removal.test.js` — the "KEPT field" case now asserts the
  edit-modal field/section are **gone** from `index.html` while the legacy column
  + `buildStopTreatmentMsg` survive in `app.js`.
- `test/duplicate-clients.test.js` — identity mirror is `[c.phone]` only; the
  "matches on contact phone" expectation is inverted; fixtures give the patient a
  `phone`. Stop-flag matching still includes the contact phone (unchanged).
- `test/card-edit-renewal-fix.test.js` — identity mirror updated to `[c.phone]`.

**Full suite:** `413 pass, 0 fail` (`node --test`, with dependencies installed).
The only tests that fail in a dependency-less sandbox are the two pre-existing,
environmental server-forwarding tests (`debt-status-forwarding`,
`sheets-secret-forwarding`) — they boot Express and are unrelated to this change.

## Browser-harness verification (29 checks, all green)

שולם posts `savePayment` with no clinical error and flips the chip; the charges
render in `.cc-money` (not `.cc-plan`); the charge edit round-trips (400→550) on
the same `chgAAA` id with no duplicate; the edit modal has no
`treatmentContactPhone` field; and the existing flows — edit save, renewal +
package save, add-charge — still pass with no clinical error. Panels stack to one
column at ≤560px with the charges still in the money panel.
