# Extra charges per client (חיובים נוספים)

Vered can now layer ad-hoc treatments — one-time or recurring monthly — on
top of each client's base monthly subscription. Each charge flows into
גבייה independently. The base monthly behavior is unchanged.

## What changed

### Backend — `apps-script/Code.gs`
- New schema `CHARGES_HEADERS` and sheet `ClientCharges`.
- New functions, mirroring `_upsertPayment` / `_removeLead`:
  - `_getCharges()` — returns `{ ok:true, charges: [...] }`.
  - `_upsertCharge(charge)` — `LockService`, id-based upsert.
  - `_removeCharge(chargeId)` — `LockService`, find by id, `deleteRow`. No
    audit sheet (charges are not legal records).
- `doGet` accepts `getCharges`.
- `doPost` accepts `getCharges`, `saveCharge`, `updateCharge`, `removeCharge`.

### Frontend state — `public/app.js`
- `state.charges = []`.
- New helpers `normalizeChargeFromSheet`, `chargeForSheet`, `persistCharge`,
  `persistRemoveCharge`.
- `loadAll` fetches charges via a new `apiGetCharges()` (mirrors
  `apiGetPayments`). A failure to load charges falls back to `[]` and
  warns to the console, same pattern as payments.

### Payment id scheme (read-side migration)
- Old scheme:  `pay::<clientId>::<YYYY-MM>`
- New scheme:
  - base monthly:    `pay::<clientId>::base::<YYYY-MM>`
  - extra monthly:   `pay::<clientId>::chg-<chargeId>::<YYYY-MM>`
  - one-time extra:  `pay::<clientId>::chg-<chargeId>::once`
- `paymentId(client, dueDateISO, kind, chargeId)` is the new signature.
  `kind` is `'base'` or `'extra'`; `chargeId` is required when
  `kind === 'extra'`. The function reads the charge's `billingType`
  from `state.charges` to choose between `<YYYY-MM>` and `once`.
- `paymentForClientOn` now performs a two-step lookup: it tries the new
  base-monthly id first, then falls back to the legacy id. If a legacy
  row exists in the sheet it keeps its legacy id forever — both shapes
  coexist without conflict. New patients and new months always get the
  new shape. There is no row rewrite or deletion.
- `isLegacyBasePaymentId(id)` and `paymentKindFromId(id)` helpers classify
  an id at runtime (4 `::` segments = new shape, 3 = legacy base).
- New `paymentForExtraOn(client, charge, dueDateISO)` mirrors
  `paymentForClientOn` for extra charges.

### Billing — `clientsDueOn` + renderers
- `clientsDueOn(dateISO)` return shape changed from `Client[]` to
  `{ client, kind:'base'|'extra', charge?, dueDate, amount }[]`. All
  callers updated.
- For each active client, base monthly emits a `kind:'base'` row when the
  billingDay matches (unchanged logic). Then every active charge for that
  client is considered:
  - `billingType === 'monthly'`: emits an extra row when
    `(charge.billingDay || dayOfMonth(charge.chargeDate))` matches the
    selected day-of-month AND `monthKey(selected) >= monthKey(chargeDate)`.
  - `billingType === 'one_time'`: emits an extra row when
    `charge.chargeDate === selectedISO`.
- `buildBillingRow(client, payment, dueDateISO, isCarry, kind, charge)`
  now takes `kind` + `charge`. When `kind === 'extra'`, the row gets the
  `billing-row-extra` class (amber left-border accent + subtle background
  tint) and the patient cell reads
  `חיוב נוסף: <description> — <client.name>`.
- `renderBillingOpenList` infers extra-ness from the payment id
  (`::chg-` segment), looks up the charge object in `state.charges`,
  and passes that to `buildBillingRow`. Carry rows for extras therefore
  also get the description prefix and the marker class.
- `renderBillingMonthlySummary` is unchanged. KPIs stay global; the
  per-client breakdown sums by `clientId`, so a client with extras
  shows a single combined line (collected and outstanding pooled).
- `recompute` inside `buildBillingRow` now preserves `payment.billingType`
  (was hardcoded `'monthly'`) so one-time extras keep their billingType
  through edits.

### Client card UI — `clientCard`
- Inline list `<ul class="client-charges">` under the card body lists the
  client's active charges:
  - `חודשי: <desc> — ₪<amt> (יום <billingDay>)`
  - `חד-פעמי: <desc> — ₪<amt> (<chargeDate>)`
  - Each row has a small `×` (edit-only) that calls `handleRemoveCharge`.
- New action button `+ הוסף טיפול` (edit-only) placed alongside
  `✏️ ערוך`, before `סיים טיפול`. Opens the new add-charge modal.

### New modal `#addChargeModal` — `index.html`
- Title `הוסף טיפול` + dynamic subtitle showing the client name.
- Fields: `סוג חיוב` (one_time / monthly), `סכום ₪`, `תיאור`,
  `תאריך`, `יום גבייה חודשי` (shown only when type=monthly), `הערות`.
- `chargeDate` defaults to today on open. `billingDay` falls back to
  `dayOfMonth(chargeDate)` when left blank (server stores '' and the
  renderer applies the fallback at display/billing time).
- Submit posts via `apiPostAction('saveCharge', { charge })`, pushes to
  `state.charges`, re-renders, toasts `הטיפול נוסף`. Errors revert the
  state.charges push and surface a toast.

### Styling — `public/style.css`
- `.billing-row-extra` — amber right-border accent + light tint
  (subtle, the row layout itself is unchanged).
- `.client-charges` / `.charge-row` / `.charge-remove` — compact inline
  list under each client card.

## "במקום" (replace monthly)

No new mechanism was built for replacing the monthly amount. To change a
client's base monthly, Vered edits `monthlyAmount` on the existing
`#editClientModal`. Documented here so that path is not later rebuilt.

## Edit-only / role gating

All new interactive controls carry `class="edit-only"`:
- `+ הוסף טיפול` button on each card.
- The `×` remove button on each inline charge row.
- The add-charge modal opens only when `state.role === 'editor'` because
  the button that opens it is hidden for viewers (existing CSS rule on
  `.edit-only`).
- Server-side, `_upsertCharge` / `_removeCharge` are not gated — same
  trust model as the existing `_upsertPayment` / `_removeLead`. The PIN
  gate is a client-side guard.

## Not changed (deliberate)

- `clientsDueOn` callers outside billing (none).
- `renderBillingOpenList` and `renderBillingMonthlySummary` were not
  rewritten — they already operate on `state.payments` and naturally
  surface extras via their `dueDate` / `monthKey`.
- `paymentId()` callers: only billing renderers used it before, and they
  now go through `paymentForClientOn` / `paymentForExtraOn`, so the
  signature change is local.
- `test/charges.test.js` covers the new payment-id scheme, legacy-id
  recognition, `clientsDueOn` returning base+extras on the same date,
  and the start-month gate for monthly extras. The pure helpers live in
  `public/charges-logic.js` (same UMD pattern as `billing-status.js` —
  Node tests `require()` it; the browser uses the inline copy in
  `app.js`).

## Deployment notes

1. **Frontend** — Railway auto-deploys on push to the merged branch.
2. **Apps Script** — paste `apps-script/Code.gs` into the Sheets-bound
   script editor, save (Ctrl+S), then:
   - Deploy → Manage deployments → existing deployment → pencil ✏️
   - Version: New version
   - Deploy
3. **Sheet** — no manual migration needed. The `ClientCharges` sheet is
   auto-created on first `getCharges` / `saveCharge` call via
   `_ensureSheet`.

## Manual test checklist on the live URL

After both deploys:

a. Open a client → `+ הוסף טיפול` → one-time, amount 500, date = tomorrow.
   Check it appears on the card as a charge row. Open גבייה, set date to
   tomorrow → row appears with `חיוב נוסף: ...` prefix.
b. Same client → `+ הוסף טיפול` → monthly, amount 1000, billing day 5,
   start date today. Open גבייה, set date to next 5th of month → row
   appears. Set date to 5th of month two months from now → row still
   appears.
c. Mark the extra charge paid → confirm base monthly row's status is
   independent (separate payment rows in the sheet).
d. Leave one-time extra unpaid → advance billing date past its date →
   confirm it appears in "יתרות פתוחות" with the correct client name and
   description.
e. Remove an extra charge from the card → confirm `×` → confirm the
   charge row disappears and גבייה stops showing it on future dates.
f. Existing clients with old-id payments: their base monthly still loads
   correctly with paid/unpaid intact (legacy id stays legacy, no
   duplicate row).
