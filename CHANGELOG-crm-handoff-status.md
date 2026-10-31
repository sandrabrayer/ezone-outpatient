# Handoff status feed for the Dashboard — OP-CRM-2 / G2 (Phase D, 2026-10-31)

Phase D of the Outpatient CRM program (issue #141), stacked on Phase C. Outpatient side only. Draft; no merge, no Apps Script / Railway deploy.

## Why
Today the Dashboard knows only «נשלח» about a patient it referred (gap G2, `docs/crm/OUTPATIENT-STAGE0.md`). This gives it a **read-only, purpose-scoped, exact-id** way to learn what happened next, without money, clinical data, notes or phone.

## Contract (`apps-script/Code.gs`)
- Action `getHandoffStatus` — GET or POST to the Outpatient `/exec`, **fail-closed** behind the new Script Property **`HANDOFF_STATUS_SECRET`** (constant-time compare; no other secret, incl. the proxy key, opens it). Same pattern as `getTreatmentPlans`.
- Request: `outpatientIds` (comma list or array — the lead/client ids the Dashboard already receives from `createLead` and stores) and/or `dashboardPatientIds` (Dashboard `Patients.id`; matches the append-only identity column **once PR #137 is live** — absent column = no match, never an error). Max 200 ids, token-sanitized. **Never name or phone.**
- Response: `{ ok, sourceApp:'ezone-outpatient', states:[…], results:[{ outpatientId, entity:'lead'|'client', dashboardPatientId, state, stateDate, assignedTo, nextAction, nextActionDate, lastActionDate, updatedAt }] }`.
- `state` ∈ `referred` (new, no contact) · `contacted` (contact logged / intro stage without a date) · `intro_scheduled` · `intro_passed` (date passed, no decision) · `plan` · `not_relevant` · `admitted` (client, start date in the future) · `active` · `ended`. A converted lead answers as its client (`fromLead`). `nextAction` = the earliest open non-money task of the subject (lead-era tasks follow the client); `lastActionDate` = latest Activity event.

## Dashboard side (owner: ChatGPT — contract filed in issue #141, D-FB-1)
Call `getHandoffStatus` with the stored `outpatientId` (AuditLog `details.outpatientId` today; a column after D-ID-2) when rendering the patient/CRM card, cached ≤60 s, and show state / owner / next action instead of «נשלח». Secret: set the same value as `HANDOFF_STATUS_SECRET` in the Dashboard's configuration. No write path.

## Dependencies / not done here
- **G1 (owner across the handoff)** is implemented in PR #137's `createLead` (`assignedTo` validated against the Outpatient allow-list). Not duplicated here; no new user identities.
- Exact-id linking by `dashboardPatientId` depends on #137 (columns) and Dashboard #329/#330 (feed/handoff carry the id). This feed is useful immediately by `outpatientIds`.
- No automatic name/phone linking anywhere.

## Operator step (not now — at release)
Apps Script → Project settings → Script properties: add `HANDOFF_STATUS_SECRET` (≥32 random chars) and give the same value to the Dashboard. Until it is set the action answers `unauthorized`.

## Tests
`test/crm-handoff-status.test.js` (4): fail-closed auth incl. other secrets/proxy key, every state + converted lead + contacted-by-activity + next action, no money/PII in the answer and money tasks never the next action, exact ids only / list sanitizing / absent-vs-present identity column. Full suite 1749/1749.
