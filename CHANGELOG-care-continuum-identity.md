# Care-continuum identity foundation (OP-ID-1)

Date: 2026-10-30. Draft only; no merge or production deploy authorized.

## Purpose
The care continuum now starts before discharge. Today the Outpatient continuation queue is keyed by `name|house|entryDate`, while the discharge handoff can create a second unrelated lead. OP-ID-1 establishes the stable identity layer without inventing a new person id.

## Contract
Wire fields accepted by `createLead`:
- `dashboardPatientId`: Dashboard `Patients.id` — one stay/admission.
- `dashboardPersonId`: Dashboard `Patients.personId` — root id for a returning stay.
- `dashboardLeadId`: Dashboard lead id when known.
- `source`: accepted stable handoff source; stored as `handoffSource`.
- `continuationKey`: legacy continuation key for traceability.
- `assignedTo`: accepted only when it is a current Outpatient assignee.

Cross-stay person key is derived as `dashboardPersonId || dashboardPatientId`.

## Matching
`createLead` matches only on stable ids, in order:
1. `dashboardPatientId`
2. `dashboardLeadId`
3. derived person key

Only open Leads and active Clients participate. More than one exact hit fails closed with `identity_conflict`. Phone + normalized name never auto-links; it only returns `possibleDuplicateOf`.

A closed historical episode is not overwritten.

## Storage safety
The five identity/provenance columns are append-only on active Leads, Clients and Clients-removed. `REMOVED_LEADS_HEADERS` is intentionally unchanged because OP-03/PR125 owns that archive scope. Browser `saveAll` preserves existing identity and cannot inject or overwrite it.

OP-ID-2 will connect the pre-discharge continuation row to these fields and copy identity onto Clients during activation.

## Release
Apps Script changes require the explicit Outpatient second-phase release after a separately approved merge. This draft is not authorized for merge or deployment.
