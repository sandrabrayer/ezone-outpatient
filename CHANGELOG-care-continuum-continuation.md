# Pre-discharge continuation wiring (OP-ID-2)

Date: 2026-10-30. Stacked draft on OP-ID-1 (PR #137). No merge, no Apps Script or Railway deploy, no production write.

## Purpose
«רצף הטיפול מתחיל לפני השחרור מהבית». The continuation track (מסלול המשך) now carries the Dashboard's stable stay identity, and the to_outpatient decision creates-or-links the Outpatient lead **server-side** through the OP-ID-1 `_createLead` rules — so the later discharge handoff links to that same lead instead of creating a second one.

## A. Continuation persistence (`apps-script/Code.gs`)
- `CONTINUATION_HEADERS` += `dashboardPatientId, dashboardPersonId, outpatientId, outpatientEntity` (append-only tail; `_ensureSheet` relabels in place, old rows read back blank).
- `_saveContinuation` match order: a row with the same `dashboardPatientId` (stable id wins) → else the legacy `key` (`name|house|entryDate`): an id-less legacy row **upgrades in place** and receives the id; a legacy row carrying a *different* id → `continuation_identity_conflict`, nothing written; two rows sharing one id → same conflict. An id-less (legacy) payload still saves and never downgrades an id-bearing row.
- `outcomeDate` is **server-stamped** (Asia/Jerusalem today) when an outcome is set or changed; an unchanged outcome keeps its original date; a payload value is ignored.
- Link fields are written only when the payload carries a valid pair (`outpatientId` token + `outpatientEntity` ∈ lead|client — the Node orchestration below); otherwise the on-sheet link is preserved. Malformed id/link → `invalid_identity` / `invalid_link`, nothing written.

## B. Node source validation (`server.js`, `lib/continuation-identity.js`)
- The Dashboard roster fetch is shared (`fetchAdmittedRoster`, ≤60 s cache, `fresh` bypass) between `GET /api/continuation-roster` and identity resolution.
- `saveContinuation` through `/api/sheets` and the new orchestration route take `dashboardPatientId` **only as a lookup**: the server resolves exactly one current admitted roster row by exact `id` (cached roster first, one fresh re-fetch before failing) and overwrites `name, house, entryDate, key, dashboardPatientId, dashboardPersonId` from it. 0 matches → `continuation_patient_not_admitted` (404); a feed without any ids (D-ID-1 not live) → `continuation_identity_unavailable` (409); >1 → `continuation_identity_conflict` (409); no/malformed id → `continuation_identity_required` (400). No phone/name lookup exists on this path.
- Browser-supplied `phone, outpatientId, outpatientEntity, assignedTo, source, handoffSource, continuationKey, outcomeDate, linkSource/trusted/verified, user, secret, proxySecret` are dropped before forwarding (`BROWSER_STRIPPED_FIELDS`).
- `createContinuationLead` is **forbidden** (403) on the `/api/sheets` pass-through.

## C. `createContinuationLead` orchestration
- New Apps Script action `createContinuationLead`, authenticated **only** by `OUTPATIENT_PROXY_SECRET` (`SOURCE_POST_AUTH`; never a GET; a cross-app `CREATE_LEAD_SECRET` does not open it). It builds the handoff exactly as the old browser path did (note «מקור: מסלול המשך | פגישה: …», Dashboard house mapped by `CONTINUATION_HOUSE_TO_ORIGIN`, raw house kept in the note when unmapped), **forces** `source='continuation'` and `assignedTo=_requestUser(payload)`, then delegates to `_createLead` — exact stable-id precedence, fail-closed `possible_duplicate`, idempotent replay (`matched:true`, same id). Writes nothing itself.
- `POST /api/continuation/to-outpatient` `{dashboardPatientId, meetingDate, note}` (session required): resolve → `createContinuationLead` → **only after success** `saveContinuation outcome=to_outpatient` with the observed `outpatientId/outpatientEntity`. A `possible_duplicate` / `identity_conflict` (409) saves no outcome. If the second write fails: `continuation_link_save_failed` (502) with the lead id; a retry is safe because step 2 is idempotent by stable identity.

## D. Activation
- In `_saveAll`, a **brand-new** client whose `fromLead` names an on-sheet lead copies `CARE_ID_FIELDS` from that **on-sheet** lead (the Leads snapshot already read — no extra Sheets read). Browser identity on the client was already blanked by `_carePreserveExisting`; existing clients keep their on-sheet identity.

## E. Frontend (`public/app.js`)
- VM carries `dashboardPatientId` / `dashboardPersonId` from the roster; persisted rows join by id first, legacy key second (legacy rows still render).
- Ordinary save sends `key, dashboardPatientId, meetingDate, outcome, note` only; the server's returned row replaces the optimistic one.
- to_outpatient calls `/api/continuation/to-outpatient`; the old `continuationCreateLead` (local `uid()` lead + `persist()`) is removed. After success core Leads/Clients reload. A roster row without a Dashboard id fails visibly («חסר מזהה מטופל מהדשבורד (D-ID-1)») — no PII fallback. Hebrew texts for every server error code.
- The manual add-lead form and its duplicate modal outside continuation are untouched.

## Compatibility / safety
- Append-only everywhere; `REMOVED_LEADS_HEADERS` (OP-03 / PR #125) and `public/style.css` (PR #135) untouched. No SW bump (app.js is not precached; index.html unchanged).
- **Ordering dependency:** ordinary continuation saves and to_outpatient require the Dashboard roster to carry `id` (D-ID-1, Dashboard PR #329). Until that is live, the tab still renders and legacy rows still show, but saves fail visibly with `continuation_identity_unavailable`. Release OP-ID-2 only after D-ID-1 is deployed.
- Apps Script change → explicit second-phase release after a separately approved merge (repo rule 4). Not authorized here.

## Tests
- `test/continuation-identity-gs.test.js` (11): schema/auth table, stable-id upsert, legacy-key upgrade, no downgrade, identity conflicts write nothing, server-owned link fields, createContinuationLead auth/forcing/mapping/idempotency/fail-closed duplicate, activation copies from the on-sheet lead and never from the browser.
- `test/continuation-identity-routes.test.js` (10): pure resolver (exact id only, 0/>1/no-id feed), builders strip browser fields, saveContinuation overwrite + drop list + cookie user, fail-closed statuses with no upstream write, forbidden pass-through, two-step orchestration with observed link, duplicate saves no outcome, link-save failure + safe retry, session required, roster route unchanged.
- `test/continuation-identity-frontend.test.js` (6): source guard — manual path gone, stable id carried, id-first join, save payload shape, visible failure, manual lead form untouched.
- `test/continuation-browser.test.js` (3, real Chromium; added to the `lead-save-browser` CI job): server-side create+link and idempotent replay through the UI; id-less roster row fails visibly with nothing written; ordinary save carries the id and a PII collision refuses the lead.
- Guards updated append-only: `continuation-code` header pin, `continuation-roster-forwarding` (shared fetch).
