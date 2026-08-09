# CHANGELOG — getTreatmentPlans: treatment period (startDate + exitDate)

## Summary
The `getTreatmentPlans` cross-app projection now returns each client's treatment
**start date** (`startDate`) and **end date** (`exitDate`), so the E-Zone
Therapists app can show the treatment period on each patient card.

## Why
The therapists app matches outpatients by phone and reads their plan from
`getTreatmentPlans`. It had everything except the treatment dates. The dates
already live on the **Clients** sheet — `startDate` (col 7) and `exitDate`
(col 9, the discharge/exit date) — and `_getTreatmentPlans` already reads the
full row via `_readAll`; they were simply not in the returned object.

## Change
`_getTreatmentPlans()` in `apps-script/Code.gs` — two fields added to the
`out.push({…})` projection:

```javascript
startDate: cl.startDate || '',
exitDate:  cl.exitDate  || ''
```

- `_readAll` normalizes a Date cell to a `yyyy-MM-dd` string, so that is the
  shape delivered; the therapists frontend reformats to DD/MM/YYYY and renders
  «—» for a blank (active patient) or malformed value.
- `exitDate` is blank while the patient is still in treatment.
- **No sheet schema change. No new secret. No payer/billing data added** — the
  minimal-projection contract (never expose payer/price/bundle/link) is intact.

## Tests
`test/treatment-plans.test.js` — the pure `projectPlans` mirror is updated to
include `startDate`/`exitDate`, the empty-defaults deep-equal is extended, and
two cases are added: the period projects through, and an active patient (no
`exitDate`) projects `exitDate: ''` (present, never `undefined`). Full suite:
`npm test` → 501 pass, 0 fail.

## Deploy
Merging this into the deployed branch `claude/youthful-volta-laarnk` triggers the
Deploy Apps Script workflow (`clasp push` → `clasp deploy` as a **new version of
the existing deployment**), so the `/exec` URL is unchanged and all consumers
keep working. The therapists card starts showing the dates as soon as the deploy
completes; before then it harmlessly shows «—».
