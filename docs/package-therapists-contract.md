# Therapists-app integration contract (OP-PKG) — IMPLEMENTED in ezone-therapists #105 (draft, not released)

This is the contract between this app (source of the catalog and requests) and the **ezone-therapists** repo. The therapists
side is implemented in **ezone-therapists #105** (draft; routes in `server.js` + `server/packages.js`, UI in
`public/package-request.js`; tests `test/packages-*.test.js`, `test/package-request-browser.test.js`,
`test/package-request-recovery-browser.test.js`). **Nothing is released or enabled**: configuration, the PDF/business
confirmations and Sandra's final approval remain (`docs/package-release-checklist.md`). Where the shipped behaviour goes beyond
the original contract below, a **"Shipped:"** note says so.

## 0. Principles

* Only **Oren** and **Shahar** may use the feature. Their identity comes from the
  **signed therapists session** (server side). A name typed in the browser, a
  request field, or `localStorage` never selects `requesterKey`.
* **Ordinary therapists**: no access to any new route (`403`), no tab, no markup
  with prices. They keep patient lists + their own schedule only.
* **No price, ever** reaches the therapists browser from this feature. Build
  *explicit allowlisted* response objects (copy named fields) — never forward the
  upstream JSON and never "delete known price fields".
* Two distinct secrets in the therapists service (Railway variables, ≥ 32 chars,
  different from each other, from every other secret and from the proxy key):
  `PACKAGE_CATALOG_SECRET` (catalog + status reads) and `PACKAGE_REQUEST_SECRET`
  (submissions). The outpatient `OUTPATIENT_SHEETS_URL` proxy key unlocks neither.
  Fail closed (`503 package_not_configured`) when either is missing/short/equal.

## 1. Role

Add a `house_manager` capability next to the coordinator/therapist roles in
`public/roles.js` + `server.js`, bound to the signed session name:

```
HOUSE_MANAGER_REQUESTER = { 'אורן': 'oren', 'שחר': 'shahar' }   // server-side constant
requesterKey = Roles.coordinatorKey(session.coordinator)          // '' => 403 (keys live next to COORDINATOR_NAMES)
```
(Use the exact display names as they appear in the therapists roster.) A
coordinator who is not Oren/Shahar does **not** get it unless Sandra decides so.

## 2. Therapists Node routes (all `requireSession` + manager check, `Cache-Control: no-store`)

| Route | Upstream (Apps Script `OUTPATIENT_SHEETS_URL`) | Secret |
| --- | --- | --- |
| `GET /api/packages/catalog` | GET `action=getPackageCatalogPublic` | `PACKAGE_CATALOG_SECRET` |
| `POST /api/packages/requests` | POST `createPackageRequest` | `PACKAGE_REQUEST_SECRET` |
| `GET /api/packages/requests` (`?requestId=` optional) | GET `action=getPackageRequestStatus&requesterKey=…` | `PACKAGE_CATALOG_SECRET` |

Pass the secret in the `secret` field/param (not `proxySecret`). Always set
`requesterKey` from §1; reject (`400 forbidden_field`) a browser body containing
`requesterKey`, `secret`, `action`, `user`, any `*Agorot`, `amount`, `price`, `total`.

### `GET /api/packages/catalog` → browser
```json
{ "ok": true, "catalogEpoch": 3,
  "items": [ { "key": "emdr_core", "family": "emdr", "tier": "core", "unit": "per_session_pack",
               "sessions": 4, "sessionMinutes": 60, "allowedMonths": [], "needsPricing": false, "sortOrder": 30 } ] }
```
Copy exactly these 9 item fields + `ok`/`catalogEpoch`. (`needsPricing:true` only for
`solo_housing`: show «המחיר ייקבע על ידי ורד».) Months picker = `allowedMonths`
(empty ⇒ no months control). **No free quantity or duration inputs.**

### `POST /api/packages/requests` ← browser
```json
{ "requestId": "<uuid v4, generated ONCE per form>", "patientName": "דנה כהן",
  "patientPhone": "0501234567", "packageKey": "emdr_core", "months": 0, "catalogEpoch": 3 }
```
Upstream adds `requesterKey`. Validate before sending: UUID v4, `patientName` 2–120
chars, phone `^0\d{9}$` or empty, `packageKey` ∈ last catalog, `months` an integer
(0 if none), `catalogEpoch` integer.

Response to the browser — **only**:
```json
{ "ok": true, "requestId": "…", "status": "pending", "duplicate": false,
  "whatsapp": { "available": true, "url": "https://wa.me/<digits>?text=<urlencoded>" } }
```
Errors: `{ "ok": false, "error": "<code>" }` with codes from the fixed set
`unauthorized, invalid_request_id, invalid_requester, invalid_patient, invalid_phone,
invalid_package, invalid_months, stale_catalog, request_id_conflict, busy,
package_error, package_not_configured, upstream_unavailable, forbidden_field`.
Map anything else (timeouts, HTML, non-JSON, exceptions) to `upstream_unavailable`.
Never echo upstream text, URLs, secrets or stack traces.
**Shipped:** the browser-visible set also contains `role_required` (a session that is not Oren/Shahar, 403) and `invalid_body`.

### `GET /api/packages/requests` → browser
```json
{ "ok": true, "items": [ { "requestId": "…", "status": "pending|priced", "packageKey": "emdr_core",
                           "months": 0, "createdAt": "2026-10-18T09:00:00.000Z" } ] }
```
Status is a flag only (`priced` = Vered approved; **not** paid; show no amount).

## 3. Retry / idempotency

* Generate `requestId` once when the form opens; keep it until a *confirmed*
  response. On timeout/network error **resend the same id and payload** — also
  minutes later. Apps Script returns the existing request (`duplicate:true`).
  **Shipped:** the id is frozen together with the COMPLETE original payload (name, phone, package, months and the original
  `catalogEpoch`) from the first send; a background catalog refresh never changes it. If the reply was lost and the request
  list already shows the id, the confirmation is **recovered by re-sending exactly the frozen request** — Apps Script answers an
  existing id (same payload) with the stored safe result *before* its catalog-freshness check, writes no second row, and the
  Node server rebuilds the WhatsApp link from configuration. The recovered confirmation shows the real status.
* Same id with a different payload → `request_id_conflict`: tell the user to
  start a new request (new id). Never reuse an id for edited data.
* Disable the submit button while in flight; no automatic dedupe by patient/package.
* On `stale_catalog`, re-fetch the catalog and let the user re-confirm.

## 4. WhatsApp («שלח לורד בוואטסאפ»)

Shown **only after** a confirmed `ok:true` submission. The destination comes from
configuration (`PACKAGE_WHATSAPP_NUMBER`, digits with country code, validated
`^\d{9,15}$`); there is **no hardcoded or fallback number** — if unset, return
`whatsapp.available=false` and show «מספר ורד לא הוגדר» (the request is still saved;
Vered sees the badge). Build the link **on the server**:

```
text = `בקשת תמחור ${requestId.slice(0,8)} — ${firstName}, טלפון ****${last4}`
url  = `https://wa.me/${number}?text=${encodeURIComponent(text)}`
```
Prefilled content is only first name, last four phone digits and the request
reference — **no price, no full phone, no free text, no clinical notes**. The
browser opens it in response to the user's click (`window.open(url,'_blank','noopener')`);
never auto-send or auto-open.

## 5. Hebrew labels (render time only; keys stay English in storage/API)

family: `day_track`→מסלול יום · `emdr`→EMDR · `cbt`→CBT · `emdr_cbt`→EMDR + CBT ·
`continuation`→טיפולי המשך · `psychiatric`→פסיכיאטריה · `solo_housing`→Solo — דיור.
tier: `basic`→בסיסי · `extended`→מורחב · `core`→Core · `standard`→Standard ·
`complex`→Complex · `single`→טיפול בודד · `combined`→משולב · `monthly`→חודשי ·
`consult`→ייעוץ · `diagnosis`→אבחון · `range`→טווח מחיר.
status: `pending`→ממתין לתמחור · `priced`→תומחר. All UI RTL.

## 6. `amountOwed` and other price paths in the therapists app — resolved by shipped prerequisites

Oren and Shahar ARE the coordinators (`Roles.COORDINATOR_NAMES`), and the debt gate used to send them `amountOwed`. This was a
release blocker (Sandra, 2026-10-18) and is fixed by **Therapists #106** (merged `e9021a5`, SW v46): amounts are removed from
browser payloads, the debt gate decides by `debtStatus`, the block + Ron/Sandra approval path and billing are unchanged, and the
approval audit figure fails closed in the new-Node/old-script window. The public price constants in this app are fixed by
**Outpatient #123** (merged `0941004`). Residual limitation: a holder of the shared Outpatient `APP_PIN` can still read those
constants after signing in. The package feature itself adds no amount (allowlisted, tested). Do not widen the claim beyond these
paths, and not before the live deployment is verified.

## 7. Therapists tests (the original list; implemented in #105 — all items below exist)

1. Role: ordinary therapist and unauthenticated → every new route `403/401`; Oren
   and Shahar → allowed; a coordinator without a requester key (e.g. a former
   one) → `403`.
2. `requesterKey` always from the session; a body/query `requesterKey` → `400`.
3. Distinct secrets: catalog route uses only the catalog secret, submission only
   the request secret; missing/short/equal → `503` and **no upstream call**.
4. Allowlist contract: stub upstream returning nested price/total/vat/snapshot/
   `amountOwed` fields and error text; deep-scan every response and error body for
   financial keys and the injected values — none present.
5. Idempotent retry: same id + payload twice (and after > 60 s) → one request;
   different payload → `request_id_conflict`.
6. WhatsApp: link only after success; content limited to first name + last-4 + ref;
   missing config → `available:false`, no number in code (`grep` test).
7. Browser assets/caches: no catalog price, `*Agorot`, secret name in `public/**`
   or the service-worker cache list; the service worker never caches `/api/`.
8. `amountOwed` absent from coordinator payloads — covered by #106 (`test/amounts-*.test.js`, `test/audit-bridge-old-source.test.js`).
9. Lost reply: the frozen request survives catalog changes and tab re-entry; recovery returns the real status and the configured
   WhatsApp button with one row (`test/package-request-recovery-browser.test.js`, real Chromium against the real server).

## 8. Order of rollout

See `docs/package-release-checklist.md` (single checklist). In short: configuration prerequisites → Outpatient #122 (matching Node SHA
live, then the explicit *Deploy Apps Script* dispatch with `expected_commit`) → authorised one-time catalog import and review →
Therapists #105 (Node only; it changes no Apps Script path) → smoke with approved test data. Never roll the Outpatient source back
to @97. No step is approved yet.
