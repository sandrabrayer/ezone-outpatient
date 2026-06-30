# CHANGELOG — סניף (location) is the single source of truth

## Summary
Removed every coupling between treatment type (day-center / ליווי יומי בקהילה)
and the `location` (סניף) field. The branch the user selects in the form is now
the single source of truth for every patient — including day-center patients —
on both save and display. Day-center and branch are the same physical place; a
patient may receive both ליווי יומי and פרטני at whatever branch is chosen, so
there is no reason to auto-force or hide the branch.

## Problem
Three places coupled `location` to service type, so a day-center patient's
branch was forced to `רעננה הפרדס` (DAY_CENTER_LOCATION) and could not be shown
or saved as anything else:
1. Display overrode the shown location to `רעננה הפרדס` for day-center patients.
2. The create/activate/direct-create forms forced `location → רעננה הפרדס` on
   save for day-center patients, ignoring the chosen branch.
3. The forms hid the סניף select (and defaulted it to `רעננה הפרדס`,
   `required = false`) when a day-center service was picked.

## Changes (public/app.js)

### Part 1 — Display override removed (3 sites)
The saved `location` always displays; no day-center substitution.
- Dashboard "פילוח לפי סניף" tally (~767): count `c.location` directly.
- Lead card chip (~1724): show `l.location` when present.
- Patient card chip (~1889): show `c.location` when present.

### Part 2 — Save-time forcing removed (3 sites)
The value chosen in the form (`fd.get('location')`) is saved verbatim for all
patients, day-center included. Removed the now-dead `var isDayCenter = ...`
declarations that existed only to force location.
- readLeadFormFields (~2170): `location: (fd.get('location') || '')`.
- direct-create submit (~2828): `location: (fd.get('location') || '')`.
- activate submit (~2954): `location: (fd.get('location') || lead.location)`.

### Part 3 — סניף select always visible / selectable
`updateLocationVisibility` and `updateLocationVisibilityForDirect` no longer
hide, default, or un-require the select based on service type. The סניף field
is visible and `required` for all patients, using the same full option list
already in the selects (incl. רעננה אשר).

## Notes / verification
- `DAY_CENTER_LOCATION` (app.js:54) is now **completely unused** (no reads).
  Left defined intentionally — constant housekeeping is a separate change.
- `hasDayCenter(...)` no longer alters `location` anywhere (save or display).
  Remaining uses are unrelated and legitimate: treatment-label display
  (serviceLabel ~91), the day-center client tab filter (~1866), and the
  day-center service checkbox state (~2237).
- Full path traced: creating a new day-center patient → chosen branch is stored
  in `client.location` → `persist()` maps it through `clientForSheet` which
  sends `location: c.location` (app.js:436) unmodified → the chosen branch
  reaches the Sheet verbatim. Same for the activate and lead paths.

## Deploy
Frontend only. Railway auto-deploys. No Apps Script redeploy.

## Tests
137/139 pass. The 2 failures (`debt-status-forwarding`,
`sheets-secret-forwarding`) are pre-existing `server.js` network-forwarding
tests unrelated to this change (they fail identically without it). No new
automated test added: this is browser-only render/form logic in the app.js IIFE
with no DOM/jsdom harness in the repo. Verify manually:
- Create a new day-center patient, pick רמות → save → card shows רמות.
- Edit an existing mixed patient, change branch → it sticks on save + reload.
