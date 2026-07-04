# CHANGELOG — Add סניף (location) dropdown to the edit-patient form

## Summary
Added a סניף `<select name="location">` to the edit-patient form
(ערוך פרטי טיפול), wired to pre-select the patient's current `location` on open
and save the chosen value back on submit. Also added the missing רעננה אשר option
to the three other location selects so all location dropdowns share one list.

## Problem
- The edit-patient form had no סניף field at all, so a patient's `location`
  could not be corrected from the UI (only set at create/activate time).
- רעננה אשר was missing from the location dropdowns; it existed only as a
  בית מוצא (house_of_origin) label.

## Changes
- public/index.html
  - editClientForm: added a סניף `<select name="location">` in the
    "פרטים נוספים" section (before בית מוצא), with options:
    — / רעננה הפרדס / רמות השבים / קיסריה גמילה / קיסריה עפרוני / רעננה אשר.
    Not `required` (empty `—` allowed) so existing patients with no location
    still save — matching the בית מוצא select's behavior.
  - Added `<option>רעננה אשר</option>` to the other three location selects
    (leadForm, activateForm, directClientForm) so every location dropdown
    offers the same full list.
- public/app.js
  - openEditClientModal: pre-select the patient's `location`
    (`if (form.location) form.location.value = client.location || ''`).
  - editClientForm submit: snapshot `location` in `prev` (for rollback) and
    persist it via the existing edit-save path
    (`if (fd.has('location')) client.location = (fd.get('location') || '').trim()`).

## Notes
- `location` (סניף) is stored as raw Hebrew text — not keyed — so the chosen
  option value is saved verbatim, no key mapping. בית מוצא (house_of_origin) is
  untouched.
- The card already overrides the displayed location to DAY_CENTER_LOCATION for
  day-center patients, so no day-center special-casing was added to the save.

## Deploy
Frontend only. Railway auto-deploys. No Apps Script redeploy.

## Tests
No automated test added: the edit-form save lives in the browser IIFE in
public/app.js (not exported) and the repo's `node --test` suite has no DOM/jsdom
harness for the form. Adding one would require introducing a DOM test dependency
that does not currently exist. Verify manually instead (below).

## Verification (manual)
- Open a patient's ערוך פרטי טיפול: the סניף dropdown shows the patient's
  current location pre-selected.
- Change סניף to another option and save: the patient's `location` updates and
  the card chip reflects it (for non day-center patients).
- New/lead/activate forms all offer רעננה אשר.
