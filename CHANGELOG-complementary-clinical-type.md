# «טיפול משלים» as a recordable clinical type — 2026-11-11

## Why
Complementary sessions (e.g. somatic therapy by אילנה יופה) had no clinical type that
outpatient accepted: «טיפול משלים» existed only as a PLAN type (2026-11-09, subtype in
`complementaryType`). The therapists app's pushes (`setClinicalType`,
`recordSessionOutcome`) were refused as `unknown_type`, so these sessions were booked
under «טיפול משפחתי» to get paid — which also valued them at the family price (₪600).

## What changed
- `public/treatment-map.js` and the `apps-script/Code.gs` mirror:
  `CLINICAL_TO_BILLING['טיפול משלים'] = 'טיפול משלים'` (14 clinical keys).
- `BILLING_PRICES['טיפול משלים'] = null` (`PRICE_FLAG_PER_CLIENT`): the SessionLog
  `clientSessionValue` is written blank (flag) — the existing day-center-without-frequency
  path. Therapist pay comes from `TherapistRates` as for every type (flat rate; blank rate
  still fails closed).
- The subtype (יוגה / דיקור / רפלקסולוגיה / אמנות / טיפול סומטי) is NOT a clinical type;
  `טיפול סומטי` sent as a type is still `unknown_type` (test-pinned).
- `test-support/google-operational-drill-candidate.gs` regenerated (it embeds the helper
  sources; the historical drill is unchanged).

## Not changed
- No sheet header, no SW / UI change, no historical SessionLog rewrite. Sessions already
  recorded as «טיפול משפחתי» stay as recorded.

## Price (follow-up, 2026-11-11)
- Sandra set the patient price: **₪500 per session (incl. VAT)** — `BILLING_PRICES`
  in both files; the null allow-list test is back to `[]`. Sessions recorded before this
  deploy keep their blank value (not rewritten).

## Deploy
Two-phase per CLAUDE.md: merge → `/api/version` = merge SHA → dispatch «Deploy Apps Script»
with `expected_commit` = merge SHA. Must be live BEFORE ezone-therapists offers the type.
