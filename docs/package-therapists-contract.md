# Therapists-app integration contract (OP-PKG) — NOT IMPLEMENTED

This is the exact contract for the **ezone-therapists** repo. Nothing here is
built or tested in that repo yet, so **the feature is not complete end to end**.
Do the work as its own draft PR there (one PR at a time, explicit-path `git add`,
tests + CHANGELOG + docs, `npm audit` 0 high/critical).

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
requesterKey = HOUSE_MANAGER_REQUESTER[session.name]            // undefined => 403
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

## 6. `amountOwed` and other price paths in the therapists app (required dependency)

The therapists browser currently receives `debtStatus.amountOwed` and renders it
(`public/app.js` ~L793, 2716, 2722, 2795, 2828, 2841, 2977, 3628). Until a
non-coordinator session receives **no amount**, do **not** claim "managers never see
amounts". Required (a separate, reviewed change from this feature; billing math
untouched): in `server.js`, strip `amountOwed` (and any nested money) from every
payload for sessions that are not coordinators; render the debt chip as
«חוב פתוח» without a number for them.

## 7. Therapists tests to add

1. Role: ordinary therapist and unauthenticated → every new route `403/401`; Oren
   and Shahar → allowed; a coordinator not in the map → `403`.
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
8. `amountOwed` absent from non-coordinator payloads.

## 8. Order of rollout

Outpatient PR merged + Node live + Apps Script dispatch (see
`docs/package-catalog.md` → Release) → set Script properties and the
therapists Railway variables → one-time catalog import by Vered → deploy the
therapists PR → smoke with a test patient (no real data) → remove nothing else.
