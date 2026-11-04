# CRM follow-up 1 — Sandra's production review of PR #163 (2026-11-04)

Three changes requested after reviewing production (`bbe6df9`). Draft PR against `claude/youthful-volta-laarnk`;
no billing / renewal logic and no header order touched.

## 1. «היום שלי»: «תשלומים באיחור» + «מעקבים ומשימות במועד» (`public/my-day.js`, `public/app.js`, `public/style.css`)
**Before:** section 1 «באיחור ומחויבויות עם מועד» mixed unpaid cycles with continuation offers, offer follow-ups,
contacts and late tasks.
**After:** section 1 **«תשלומים באיחור»** (`overdue_payments`) holds ONLY overdue payment / collection rows —
`renewal_overdue` + a `collection` task whose date passed (`isOverduePayment`). Section 2 **«מעקבים ומשימות במועד»**
(`dated`) takes everything else that is late, binding (today + time) or a task due today — same row layout
(amber frame; payments keep the red one). Each row still appears exactly once; the rest of the order is unchanged.
The «חידושים וגבייה» card hint now reads `N תשלומים באיחור · M בשבוע הקרוב` from the same rows (`model.overduePayments`).
An empty section is not rendered; דנה (no money) never sees the payments section.

## 2. Offer form — «למי ההצעה» (`public/package-pricing.js`, `public/app.js`, `public/style.css`)
**Before:** a `<select>`, a name input and a phone input crammed into one row.
**After:** a large full-width search field (type a name or a phone — digits match formatted numbers); up to 8 matches as
**name · phone · house/type**, clients first; a pick becomes a chip with «✕ החלפה». «שם לקוח לא רשום» + phone sit on their
own full-width row beneath (hidden once a target is picked). `app.js` hands the picker `phone` and `serviceType · location`
only. `matchTargets` is exported (pure) and unit-tested. 1280 px and 360 px, no horizontal scroll.

## 3. Pricing flexibility — ורד only, server-enforced (`lib/users.js`, `lib/catalog-admin.js`, `server.js`, `apps-script/Code.gs`, UI)
- **Custom line item** `{ custom:true, title, qty, unitAgorot }` — a treatment not in the catalog.
- **Manual unit-price override** on a catalog line `{ …, overrideUnitAgorot, overrideReason }` — reason mandatory; the line
  shows the catalog price struck through next to the override (form and request card), with the reason.
- **Server:** `ITEM_FIELDS` appended (`custom`, `title`, `unitAgorot`, `overrideUnitAgorot`, `overrideReason`);
  `requirePricingPrivilege` runs **before** the admin privilege — a session whose signed name is not in
  `PRICE_OVERRIDE_USERS = ['ורד']` (kept separate from `CATALOG_ADMIN_USERS`) gets **403 `pricing_override_vered_only`**;
  `validatePricingItems` answers **400** (`reason_required`, `invalid_amount`, `invalid_custom_item`) before anything travels.
  Code.gs re-validates (`PACKAGE_PRICE_OVERRIDE_USERS`, `vered_only` / `reason_required`), prices every line itself
  (`_pkgPriceItems(cat, items, now, user)`), keeps `catalogUnitAgorot` on an overridden line, and derives
  **before-VAT / VAT 18 % / total from the priced lines only** — browser totals are not in any allowlist and never read.
- **Trail:** every override / custom line is appended to the request's `adjustLog` at creation:
  `{ at, by (session actor), kind: 'override'|'custom', item, qty, from (catalog unit price | null), to, reason }`. Rendered in the card log.
- **Schema:** no new columns — lines live in the existing `items` JSON, the trail in `adjustLog`. `PACKAGE_REQUEST_HEADERS` untouched.
- The manager path (`createPackageRequest`, therapists app) has no such fields; `adjust` / `approve` / statuses unchanged.
- UI: the custom-line block and «✏️ מחיר ידני» are shown to ורד (display rule; the server decides). Browser estimate shows
  לפני מע״מ / מע״מ 18% / סה״כ with «המחיר הסופי מחושב בשרת».

## SW
`ezone-outpatient-v25 → v26` (app.js, style.css, my-day.js, package-pricing.js). Confirm LIVE `/sw.js` is `v25` before merging.

## Tests
- `test/my-day.test.js`: 15 updated, **17 new** (payments-only section, dated section, KPI parity, דנה); `test/continuation-milestones.test.js` pin.
- `test/offers-crm.test.js`: ITEM_FIELDS pin, **picker matcher**, **pricing flexibility happy path** (totals, snapshot, adjustLog, upstream allowlist, approve),
  **refusals** (400 reason/amount/custom shape, 403 אורן/דנה at Node, `vered_only` at the source for אורן/שחר/no user, nothing written, headers unchanged).
- `test/offers-crm-browser.test.js` (Playwright 1280 + 360): picker geometry + phone/name search, override without reason refused,
  struck-through catalog price, custom line, estimate split, stored totals/log, card rendering, no horizontal scroll.
- `docs/USER-GUIDE.he.md` updated (My Day order, picker, custom line / override).

## Security
No new secrets or endpoints. Authority from the signed session only; forbidden body fields unchanged; amounts validated as
integers at both layers; all UI text via `textContent`. `npm audit`: 0 high / 0 critical.
