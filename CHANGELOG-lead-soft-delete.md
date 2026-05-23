# Changelog — "soft-delete leads via הסר button"

Adds a soft-delete flow for leads in the Outpatient app. Clicking הסר on a lead card opens a confirmation modal; on confirm, the lead row is moved from the `Leads` sheet to a new `לידים שהוסרו` sheet with two appended columns (`removedAt`, `originSheet`). The lead disappears from the live UI. Restoration is manual via Google Sheets for v1.

## [Unreleased]

### Why this exists

1. Vered needs a way to remove leads that should never have been in the system (test entries, duplicates, accidental creations) without losing the data — manually deleting rows in the sheet is error-prone and loses audit trail.
2. Hard-delete is irreversible. Soft-delete preserves the full row plus a timestamp, so any removal can be reviewed or reversed from the spreadsheet.
3. The flow mirrors the inpatient Dashboard's existing move-to-separate-sheet pattern (commit e6605d6 in E-Zone-Dashboard) for cross-app consistency.

### Added (apps-script/Code.gs)

- `REMOVED_LEADS_HEADERS` array — mirrors `LEADS_HEADERS` through `not_relevant_note`, then appends `removedAt` and `originSheet`. Append-only per the `_ensureSheet` rule.
- `_removeLead(lead)` function — id-keyed, atomic via `LockService.getScriptLock()`, mirrors `_upsertPayment`'s pattern. Validates `lead` and `lead.id`. Looks up row in `Leads` by id. Builds a row object keyed by `LEADS_HEADERS`, sets `removedAt = new Date().toISOString()` and `originSheet = 'Leads'`. Appends to `'לידים שהוסרו'` via `_ensureSheet`, then deletes the source row. Append-first / delete-after so a mid-script failure duplicates rather than loses.
- Router line in `doPost`: `if (action === 'removeLead') return _json(_removeLead(payload.lead));`. Placed immediately after the `savePayment` route. Not added to `doGet` — soft-delete is a mutation, POST-only.

### Added (public/index.html)

- `#removeLeadModal` confirmation modal. Title: `להסיר את הליד?`. Body: `פעולה זו תסיר אותו מהמערכת.`. Cancel button uses `data-close` for the existing global close behavior. Confirm button is `btn-danger` (destructive). Placed as a sibling of `#notRelevantReasonModal` inside the same parent container.

### Added (public/app.js)

- `removingLeadId` module-level variable.
- `openRemoveLeadModal(lead)` / `closeRemoveLeadModal()` — mirror the existing not-relevant modal open/close pair.
- `persistRemoveLead(lead)` async wrapper — `apiPostAction('removeLead', { lead: leadForSheet(lead) })`.
- Submit handler for `#removeLeadForm` — optimistic UI update (splice from `state.leads` before the POST), rollback from `prevLeads` snapshot on failure, toast on both paths.
- `הסר` button on each lead card — `btn btn-danger`, rendered immediately after the `לא רלוונטי` button inside the same render branch.

### Not changed (intentional)

- `_getData` — `removedLeads` is NOT surfaced to the frontend in v1. Removed leads are visible only in the Google Sheet directly.
- `_saveAll` / `persist()` — soft-delete does NOT route through the bulk save path. `_writeAll`'s clear-and-rewrite would corrupt the removed-leads sheet and re-add the lead to `Leads` on the next save.
- `doGet` — mutations stay POST-only.
- No `deletedBy` field — single shared password, only Vered uses Outpatient, no per-user identity.
- No in-app restore UI for v1. Manual restore via Google Sheets is acceptable.

### Safety

- `LockService.getScriptLock()` with 30s wait wraps the entire move operation. Concurrent saves cannot interleave with the append + delete.
- Append-before-delete ordering: if the script process is killed between the two operations, the lead is duplicated (recoverable: delete from `Leads`) rather than lost.
- Optimistic UI rollback on POST failure restores `state.leads` from a snapshot and re-renders so the UI matches the actual backend state.
- `_ensureSheet` is append-only; `REMOVED_LEADS_HEADERS` order will never be reordered destructively across deploys.
- No new auth gate. Matches existing CRUD endpoints (`saveAll`, `savePayment`, `saveSettings`).

### Manual test checklist (run on live URL after Railway deploy completes)

1. Open the app. Open any lead card. Verify a `הסר` button is visible next to `לא רלוונטי`, styled as destructive.
2. Click `הסר`. Verify the confirmation modal opens with title `להסיר את הליד?` and body `פעולה זו תסיר אותו מהמערכת.`.
3. Click `ביטול`. Verify the modal closes and the lead is still present in the list.
4. Click `הסר` again on the same lead. Click `כן, הסר`. Verify the modal closes, a `הליד הוסר` toast appears, and the lead disappears from the list.
5. Reload the page. Verify the lead is still gone.
6. Open the Google Sheet. Verify a new tab `לידים שהוסרו` exists with the expected headers. Verify the removed lead's row is present with `removedAt` populated as an ISO timestamp and `originSheet` set to `Leads`.
7. Open the original `Leads` tab. Verify the removed lead's row is gone.
8. Pick any non-removed lead. Save an edit (any field change). Verify the lead persists normally and `לידים שהוסרו` is NOT affected.
9. Optional rollback test: temporarily break the Apps Script URL in the Node env (or block the network briefly). Click `הסר` on a lead. Verify the lead reappears (rollback) and an error toast shows.
