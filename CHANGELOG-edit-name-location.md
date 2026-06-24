[CHANGELOG-edit-name-location.md](https://github.com/user-attachments/files/29290811/CHANGELOG-edit-name-location.md)
# CHANGELOG — Editable name + location in patient edit modal

## Summary
Added editable שם מטופל (name) and סניף (location) fields to the patient edit
modal (#editClientModal, מטופלים tab). Both now persist. Also removed the
non-functional עורך/צופה role badge from the top bar.

## Problem
- Name was a read-only heading; no input existed, so corrections (e.g. adding a
  surname to a first-name-only record) could not be saved.
- Location/סניף had no field in this modal at all — only editable on Dashboard.
- The top-bar role badge ("עורך") looked like a button but was a static label;
  it was confusing and is now removed.

## Changes
- public/index.html
  - Added `name` input and `location` select to the edit modal "פרטי מטופל".
  - Removed `<span id="roleBadge">` from the top bar.
- public/app.js
  - openEditClientModal: populate name + location; lock location to
    DAY_CENTER_LOCATION and disable the select for day-center patients.
  - Edit submit handler: read + persist `name` and `location` (day-center
    location stays locked); added both to the `prev` rollback snapshot.
  - applyRole(): removed dead roleBadge text/class logic.

## Data flow (already supported, unchanged)
state.clients -> clientForSheet -> CLIENTS_HEADERS -> _writeAll (positional).
`name` and `location` columns already existed; no schema/migration change.

## Deploy
Frontend only. Railway auto-deploys on merge. No Apps Script redeploy.

## Verification
- Console: fetch('app.js?n='+Date.now())... includes('editClientLocationWrap')
- Manual: edit a patient, change only the name -> saves; change only the סניף
  -> saves; day-center patient -> location locked to רעננה הפרדס.
