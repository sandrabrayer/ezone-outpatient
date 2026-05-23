# Changelog — "duplicate-lead phone-based soft warning"

Adds a client-side soft warning when a user tries to create a new lead whose phone number matches an existing (non-removed) lead. On match, a confirmation modal opens showing the existing lead's name and offers ביטול or הוסף בכל זאת. The check runs only on the new-lead path; editing an existing lead is unaffected. The backend (`apps-script/Code.gs`) is not changed — dedup is purely a client-side UX guardrail.

## [Unreleased]

### Why this exists

1. Vered can accidentally enter the same lead twice (same phone) and the system had zero protection — every submission created a new row regardless of overlap with existing leads.
2. Earlier testing showed real-world impact: a single session produced 12+ duplicate test entries because nothing prevents re-submission of the same phone number.
3. `_writeAll` is clear-and-rewrite — once a duplicate is created, the sheet faithfully preserves it on every subsequent save. There is no backend pass that collapses duplicates, so they persist forever once introduced.
4. A soft warning (not a hard block) preserves legitimate same-phone cases — e.g., family members sharing a single phone number. Vered keeps full agency to override.

### Added (public/app.js)

- `pendingDuplicateLead` module-level variable — holds `{ existing, onConfirm }` while the modal is open; cleared on close.
- `openDuplicateLeadModal(existingLead, onConfirm)` / `closeDuplicateLeadModal()` — mirror the existing not-relevant modal open/close pair. The open helper fills `#duplicateLeadExistingName` via `textContent`.
- `closeDuplicateLeadModal()` added to the global `[data-close]` cleanup chain so ביטול hides the modal alongside every other modal.
- Refactored `#leadForm` submit handler — extracted the add-flow into a local `runAddFlow()` function. The dedup check runs only on the new-lead path (`!editingLeadId` branch): normalizes the submitted phone via the existing `normalizePhone()` helper, scans `state.leads` for a match while ignoring leads with `stage === 'removed'`, and on hit re-enables the submit button and opens the duplicate modal with `runAddFlow` as the confirm callback. On miss, calls `runAddFlow()` directly.
- Submit handler for `#duplicateLeadForm` — snapshots `pendingDuplicateLead`, closes the modal, then invokes the stored `onConfirm` callback (= `runAddFlow`).

### Added (public/index.html)

- `#duplicateLeadModal` confirmation modal. Title: `ליד עם טלפון זה כבר קיים`. Body: shows `ליד קיים: <span id="duplicateLeadExistingName"></span>` (filled dynamically) followed by `להוסיף בכל זאת?`. Cancel button uses `data-close` for the existing global close behavior. Confirm button is `btn-primary` and submits the form. Placed as a sibling of `#notRelevantReasonModal` inside the same parent container.

### Not changed (intentional)

- `apps-script/Code.gs` — dedup is client-side only. The backend remains permissive. A malicious user could bypass the check, but the threat model is accidental Vered double-entry, not adversarial input.
- No server-side phone uniqueness constraint. `_writeAll`'s clear-and-rewrite semantics would conflict with that anyway (it rewrites the sheet from the client's array on every save).
- Edit path (`editingLeadId` branch) — unchanged. Editing an existing lead never triggers the dedup check; otherwise the lead would false-positive against its own pre-edit phone.
- Empty phone — skipped. No point in matching empty strings, and some leads may legitimately have no phone on file.
- `normalizePhone()` helper — reused from `public/app.js:565`, not duplicated. Same canonicalization on both sides of the comparison (strip whitespace/dashes/parens, normalize `+` / `00` / leading `0` to `972`).

### Safety

- `textContent` (not `innerHTML`) used when filling the existing-lead name in the modal — prevents XSS via user-entered names.
- `submit.disabled = false` set immediately before `openDuplicateLeadModal` so ביטול leaves the form usable (the user can edit the phone and re-submit without a page reload).
- `runAddFlow` re-sets `submit.disabled = true` at the top of its body — guards against double-submit on the modal-confirm path where the button was re-enabled before the modal opened.
- Soft warning (not a hard block) preserves legitimate duplicates such as family-shared phone numbers. Vered keeps full agency to override.
- Removed leads (`stage === 'removed'`) are excluded from the check so a soft-deleted phone can be re-added without obstruction. Harmless on this base (soft-delete is not merged here yet); compatible with that feature when it does land.

### Also fixed during rebase

- `closeRemoveLeadModal()` added to the global `[data-close]` cleanup chain. Discovered during conflict resolution against PR #5 (soft-delete). The remove-modal's ביטול button hid the modal via the generic chain handler but did not clear `removingLeadId`. Not a correctness bug (the id is overwritten on the next `openRemoveLeadModal` call) but a cleanliness fix.

### Manual test checklist (run on live URL after Railway deploy completes)

1. Open the app, hard refresh.
2. Create a new lead with a unique phone. Verify normal save flow, no modal appears.
3. Try to create a second lead with the EXACT same phone. Verify:
   - The duplicate modal opens with title `ליד עם טלפון זה כבר קיים`.
   - The existing lead's name is shown in the body.
   - Two buttons: `ביטול` and `הוסף בכל זאת`.
4. Click `ביטול`. Verify the modal closes, no lead is created, and the lead form remains usable (edit the phone and re-submit successfully).
5. Repeat step 3 then click `הוסף בכל זאת`. Verify the duplicate lead IS created (legitimate override path) and persists after a page reload.
6. Edit an existing lead and change its phone to match another lead's phone. Verify NO modal appears (edit path doesn't dedup against itself).
7. Soft-delete a lead via `הסר` (if the soft-delete feature is also deployed). Then create a new lead with the soft-deleted lead's phone. Verify NO modal (removed leads are excluded). If soft-delete is NOT deployed on this base yet, skip this step.
8. Create a lead with an empty phone field. Verify save flows normally with no modal.
9. Same-phone in different formats: enter `+972-50-1234567` for the first lead and `0501234567` for the second. Verify `normalizePhone` collapses them to the same canonical form and the modal opens (normalization works end-to-end).
