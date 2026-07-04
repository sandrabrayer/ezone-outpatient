[CHANGELOG-location-unlock-raanana-asher.md](https://github.com/user-attachments/files/29300092/CHANGELOG-location-unlock-raanana-asher.md)
# CHANGELOG — Unlock סניף for day-center + add רעננה אשר

## Summary
Removed the day-center location lock so the סניף (location) field is always
editable, and added רעננה אשר as a location option.

## Problem
- Patients with ליווי יומי בקהילה (day-center) had their סניף forced to
  רעננה הפרדס and the field disabled/hidden, so a day-center patient could not be
  moved to another branch (e.g. רמות השבים) — the dropdown was greyed out.
- רעננה אשר existed only as a בית מוצא (house_of_origin) value, not as a סניף.

## Changes
- public/app.js
  - Edit modal open/save: סניף always editable; saves the chosen value (no force
    to DAY_CENTER_LOCATION, no disable).
  - Activate + direct-create modals: stop hiding/forcing the location field for
    day-center; it stays visible and required.
  - Display (occupancy tally, client card chip, lead card chip): show the stored
    `location` instead of substituting DAY_CENTER_LOCATION for day-center.
  - LOCATIONS: added 'רעננה אשר' (after 'רעננה הפרדס').
  - DAY_CENTER_LOCATION constant left defined but no longer enforces location.
- public/index.html
  - Added <option>רעננה אשר</option> to all four location selects (lead create,
    activate, direct-create, edit). house_of_origin selects unchanged.

## Deploy
Frontend only. Railway auto-deploys. No Apps Script redeploy.

## Verification
- Console: includes("רעננה אשר").
- Edit a day-center patient (e.g. ליאור): סניף dropdown is enabled; change to
  רמות השבים -> saves and the card shows רמות השבים.
- New patients can be assigned רעננה אשר.

---

## Addendum — בית מוצא house list completed
Added the two missing houses to the בית מוצא (house_of_origin) dropdown so it
lists all 5 houses (ריהאב + חיצוני kept):
- public/app.js HOUSE_OF_ORIGIN_LABELS: added
  raanana_pardes -> רעננה הפרדס, kisaria_gmila -> קיסריה גמילה.
- public/index.html: added both <option>s to all 3 house_of_origin selects.
Stable code keys (never rename): raanana_pardes, raanana, ramot, kisaria_gmila,
efroni, rehab, external.

Final בית מוצא order: רעננה הפרדס, רעננה אשר, רמות השבים, קיסריה גמילה,
קיסריה עפרוני, קיסריה ריהאב, חיצוני.

Frontend only. No Apps Script redeploy.
