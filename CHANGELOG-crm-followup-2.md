# CRM follow-up 2 — Sandra's production review of PRs #163 / #165 (2026-11-04)

Five changes requested after testing production (`2f0d630`, Apps Script v104, SW v26). Draft PR against
`claude/youthful-volta-laarnk`; no billing math for package clients, no payment / charge / renewal path and no
existing header order touched. One commit per change.

## 1. Billing mode per client — «חבילה / חודשי» vs «תשלום לפי טיפול»
**Before:** every client was a monthly package: a פרטני client who pays before each single session was shown as
overdue («🛑 עצור טיפול»), sat in «תשלומים באיחור», counted in «חידושים וגבייה» and in the billing tab's due list.
**After:** client field **`billingMode`** ∈ {`package`, `per_session`} — ONE append-only column at the very END of
`CLIENTS_HEADERS` (position 39) mirrored at the end of `CLIENTS_REMOVED_HEADERS`; blank / legacy reads as `package`.
- **Server (`apps-script/Code.gs`):** `BILLING_MODES`, `_billingModeOrBlank` (anything else stored blank, never
  coerced); `_saveAll` follows the `plannedExitDate` pattern — a payload WITHOUT the key keeps the sheet value (pre-column
  tab), a sent value is validated; a money key (`OPS_CLIENT_MONEY_KEYS` + `lib/money-scope.js MONEY_KEYS`) so an
  operational session (דנה) never sees or changes it. Tombstone / restore copy it by header name.
  **No data migration:** nothing in Code.gs writes `per_session` by itself (guard-tested); a save never rewrites a
  blank cell to `package`.
- **UI (`public/app.js`, `public/index.html`, `public/charges-logic.js`):** «אופן חיוב» select in עריכה, מעבר למטופל
  פעיל and הוספת מטופל ישירות (disabled for an ops session like every money field). Effects of `per_session`:
  `renewalInfo()` returns `{ status: 'per_session' }` → no overdue / due_soon banner, no `renewal_overdue` /
  `renewal_due` row in «היום שלי», never in «תשלומים באיחור», not in the renewals panel, KPI «חידושים וגבייה» excludes
  it; the card's money panel shows **«משלם/ת לפי טיפול»** (+ «מחיר לטיפול» when an amount exists) instead of the
  paid chip / «גבייה הבאה»; no monthly base due item in the billing tab (`clientsDueOn` and the `dueItemsOn` mirror);
  extra charges, monthly revenue and the nightly backup are unaffected.
- **Suggestion chip «סמן כתשלום לפי טיפול?»** (editor, full money scope) on an active client whose ONLY service is
  פרטני, with no monthly amount and no paid package row — one click flips THIS client (`setBillingMode`, optimistic,
  rolled back on failure). A client with a monthly amount is never suggested: Vered flips those by hand in עריכה.

## 2. «💰 הצעת מחיר» from the patient card
**Before:** a quote for an existing patient meant going to «תמחור חבילות», opening the form and searching the name.
**After:** the client card (ורד, full money scope — display rule; the catalog privilege decides server-side) has
**«💰 הצעת מחיר»**: `PackagePricing.mountOfferForm(host, { target: 'client:<id>', … })` renders the **same**
`newRequestView(F, done)` inside the card (collapsible) with the target chip **locked** (no «החלפה», no search),
loads the catalog privilege + data if the tab never did, prices every line there; on creation the host re-reads the
price-free summaries and the card shows the quote in its «הצעת מחיר» line at once. No second form implementation
(`class: 'pkg-new card'` occurs once).

## 3. Delete / reset a quote (ורד only, server-enforced)
- **«🗑 מחיקה»** = soft delete: `adminDeletePackageRequest` → `status = 'deleted'`, `adjustLog` +
  `{ at, by, kind: 'deleted', from, to, reason? }`; the row stays in `PackageRequests`; hidden from `adminListPackageRequests`,
  `getPackageOfferSummaries` (so from the cards, «היום שלי», «מסלול המשך») and the Node `/api/offers` filter. Idempotent
  (op id replay, a second delete is a no-op). `PACKAGE_CRM_STATUSES` + `deleted` (appended).
- **«↺ איפוס»** = `adminResetPackageRequest` → back to `pending` (draft) with `items = '[]'`, pricing / approval /
  sent / decision fields blanked, target + validity + follow-up + notes kept, logged (`kind: 'reset'`). `_pkgItemsOf`
  treats an explicit `[]` as empty (only a BLANK cell is a legacy one-item row); `adjust` / `approve` on an empty draft →
  `items_required`; the card shows «ההצעה אופסה — אין בה פריטים» + «➕ הצעה חדשה לאותו לקוח» (prefilled target).
- **Permissions:** `lib/users.js OFFER_DELETE_USERS = ['ורד']` (own list, like `PRICE_OVERRIDE_USERS`);
  `server.js requirePricingPrivilege` → **403 `offer_delete_vered_only`** for any other session before anything travels;
  `Code.gs PACKAGE_DELETE_USERS` refuses a forged call with `vered_only`. Ops `deleteRequest` / `resetRequest` in the
  `ADMIN_OPS` allowlist with `['requestId', 'opId', 'expectedRevision', 'reason']` only.
- **UI:** in-app confirmation (`role="alertdialog"`, optional reason, «אישור מחיקה / איפוס», «ביטול») — never
  `window.confirm`. Tests prove no other sheet row changes (full snapshot before / after).

## 4. New-quote target picker — three sources, one field
**Before:** clients + every lead, flat.
**After:** `matchTargetsGrouped` (pure, exported) → section headers **«מטופלים»** (outpatient clients: name · phone ·
serviceType · house), **«מאושפזים»** (the Dashboard admitted roster — `state.continuationRoster`, the SAME fetch «מסלול
המשך» uses, loaded on demand; id = `ContinuationLogic.patientRef` — `id:<dashboard id>` | `phone:05…`; sub = house),
**«לידים פתוחים»** (stage not `not_relevant` / `active`; sub = referring house / «חיצוני»), each capped per section.
- New target type **`roster`** on `adminCreatePackageRequest` / `adminAttachPackageRequest` (`PACKAGE_ROSTER_REF_RE`,
  `_pkgTargetOk`); the picked name / phone travel with the request (this source has no roster to look them up); the
  stable ref is stored in `attachedType` / `attachedId` and carried by the price-free summaries, so the quote shows on
  the patient's row in «מסלול המשך» (`vm.offer` falls back to a roster-attached quote) and in «היום שלי» under the
  continuation subject `cont:<ref>`; the Activity event of a roster quote is filed under `cont:<ref>` too.
- «שם לקוח לא רשום» + phone remain for true walk-ins only.

## 5. WhatsApp — «הכן הודעת WhatsApp» did nothing
**Root cause (reproduced with Playwright at 360 px):** the button only toggled a panel appended at the END of the card —
at 360×740 it rendered at y≈792, below the fold, so nothing visible happened; inside it, «פתיחת WhatsApp» refused
silently (toast only) until a recipient was chosen from a `<select>` whose only preset (אורן) was **disabled when the
setting was empty**; and the `window.open` call is blocked in the installed PWA / some mobile browsers.
**After:** `whatsappLinks(r)` renders two explicit, SYNCHRONOUS links right under the status — real anchors
`<a href="https://wa.me/972…?text=…" target="_blank" rel="noopener">`, no `window.open` anywhere in the module:
**«שליחה לאורן»** (number from the `orenWhatsapp` setting; when empty an inline hint «מספר ה-WhatsApp של אורן לא
הוגדר — ⚙️ הגדרות» opens the settings modal) and **«שליחה למטופל»** (the quote target's phone, normalised; disabled
with the reason when there is none). «✏️ נוסח ההודעה» edits the text and rewrites both hrefs. Message: Hebrew, items ×
qty, total incl. VAT, validity, signature — no medical details.
Status still changes only via **«✔ סמן כנשלחה»** (in-card panel: לאורן / למטופל/ת / למספר אחר + follow-up). The row
now stores the recipient **kind + last four digits only** (`oren` | `patient:1234` | `other:1234`), never a full number
(`_pkgAdminSetStatus`; `sentToText` renders it; a legacy full number still displays).

## Schema / files
- `CLIENTS_HEADERS` + `billingMode` (39 columns), `CLIENTS_REMOVED_HEADERS` + `billingMode`; `PACKAGE_REQUEST_HEADERS`
  unchanged. Header pins updated in the existing tests; `test-support/google-operational-drill-candidate.gs` regenerated
  (`TZ=UTC node test-support/build-google-operational-drill.cjs`).
- `public/sw.js`: `ezone-outpatient-v26 → v27` (live confirmed v26 before the bump).

## Tests
- `test/billing-mode.test.js` (10): schema, money key, `_saveAll` validation / carry / ops preservation / tombstone +
  restore, no-migration guard, UI contracts, `dueItemsOn` mirror.
- `test/crm-followup-2.test.js` (7): roster target create / attach / feed, 403 + `vered_only` for אורן / דנה / forged
  actor, soft delete (trail, hidden, idempotent, no other sheet touched), reset (empty draft, `items_required`), sent
  recipient kinds + Activity subject, grouped picker, static guards (no `window.open` / `window.confirm`, one form).
- `test/crm-followup-2-browser.test.js` (Playwright 1280 + 360, RTL, no horizontal scroll): per-session card / My
  Day / KPI, suggestion chip flips and persists one client only, edit-modal toggle; card quote with locked target;
  three picker sections and a roster quote on the continuation row; WhatsApp anchors (href asserted, opening changes
  nothing, missing-Oren hint → settings), mark sent to the patient (`patient:4567`); in-app reset / delete confirm,
  deleted quote gone from list, card and «היום שלי».
- `test/offers-crm.test.js`, `test/offers-crm-browser.test.js` updated to the new WhatsApp contract and allowlist.

## Security
No new secrets, routes or client-side authority. Delete / reset decided from the signed session at Node and re-checked
at the source; allowlisted fields only; roster refs validated by regex at the source; recipient numbers never stored in
full; all UI text via `textContent`; anchors carry `rel="noopener"`. `npm audit`: 0 high / 0 critical.
