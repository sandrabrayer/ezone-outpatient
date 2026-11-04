# Offers CRM in «תמחור חבילות» — new offer, statuses, items (2026-11-03)

Section 5 of the E-ZONE One Outpatient CRM brief. Built on the EXISTING model
(`PackageCatalog`, `PackageRequests`, `POST /api/catalog-admin/rpc`) — no parallel pricing engine.

## Added
- **«➕ הצעת מחיר חדשה»** (Vered, pricing tab): pick a lead / client (or type a name + phone), add
  catalog items — packages, single treatments, or both — with quantity (1–20), duration and the Solo
  tier (minimum / midpoint / maximum, no default); validity (default +14 days), follow-up date,
  owner (ורד / אורן / דנה), notes. Created as a **draft**; a `requestId` minted once per form makes a
  double click ONE request (`adminCreatePackageRequest` replays the id).
- **Prices server-side only**: every line is computed by Code.gs from the ACTIVE catalog row
  (`_pkgPriceItems`); a browser amount is never read. Inactive / unknown package, bad quantity, Solo
  without a tier, bad dates / assignee / target are refused.
- **Statuses** (stable keys, Hebrew at render): `draft` · `ready_to_send` · `sent` ·
  `awaiting_decision` · `approved` · `rejected` · `expired`. Legacy rows map at READ time
  (`pending` → draft, `priced` → ready_to_send, never rewritten); `expired` is computed from
  `validUntil` at read time, never stored; extending the validity revives the offer.
  Transitions are forward-only (`adminSetPackageRequestStatus`, idempotent op id + revision):
  ready_to_send → sent (manual, needs a recipient) → awaiting_decision → approved | rejected.
  A draft must have its pricing approved first (existing «אישור תמחור»).
- **Discount** = the existing `adjust` (Vered only, reason mandatory → `adjustLog`). **«אושרה» means
  the client accepted the offer — no charge, no payment, no renewal** (asserted in tests).
- **Price-free summaries**: `GET /api/offers` (session, full money scope only; דנה → 403) →
  `getPackageOfferSummaries` (id, CRM status, patient, attached lead/client, follow-up, validity,
  owner, item count — no amount). Shown on the lead / client card (CRM block, «הצעת מחיר» line),
  in «היום שלי» (a sent / awaiting offer on its follow-up date, a ready one to send) and in
  «מסלול המשך» (offer attached to the patient's workflow row).
- Requests tab: status filter chips (פתוחות / הכל / each status), items list per card, validity /
  follow-up / sent / decision line, per-state actions, attach (reference only) in any priced state.

## Schema (append-only)
`PACKAGE_REQUEST_HEADERS` + `items` (JSON snapshot; a legacy row reads as one item), `validUntil`,
`assignee`, `notes`, `followUpDate`, `sentAtIso`, `sentTo`, `decisionAtIso`, `createdFrom`.
Text-forced: the date / ISO columns. `requesterKey` of an app-created offer is `outpatient`.

## Permissions (server-enforced)
| who | result |
| --- | --- |
| ורד | creates, prices, discounts, approves, sends, decides (catalog-admin session) |
| אורן / שחר | Therapists app only (unchanged manager feed); catalog login refused (`vered_only`) |
| דנה | pricing tab hidden AND `/api/offers` 403; offer Activity events are money-flagged and filtered from her reads |
| anyone | `user` / `actor` / `role` / `requesterKey` in the body → 400; `/api/sheets` refuses every `*Package*` action |

## Tests
`test/offers-crm.test.js` (7: pricing from catalog, refusals, full flow, expired/legacy, roles, static
guards), `test/offers-crm-browser.test.js` (2, Playwright 1280px + 360px: form → double click → approve →
WhatsApp → sent → lead card → «היום שלי»), `test/package-catalog.test.js` header pin updated.

## Not changed
Charges, payments, renewals, credits, `TherapistRates`, therapist payouts, the manager actions,
`treatment-map.js` / `therapist-pay.js`.
