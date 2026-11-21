# «טיפול תחלואה כפולה» — a new plan treatment type (2026-11-21)

Sandra, 21/11/2026: «תוסיף גם במסגרת הטיפולים שאפשר לבחור אופציה טיפול תחלואה כפולה».

## What changed

- `public/app.js`: `DUAL_DIAGNOSIS_LABEL = 'טיפול תחלואה כפולה'`, appended to `SERVICE_TYPES` after
  «טיפול משלים». It is offered wherever a plan's treatments are picked — the lead form, «מתחיל
  טיפול», activation, direct intake and «עריכה» — with its own frequency row (per week by default,
  changeable to per month like every type), is shown in the card's «תוכנית טיפול» panel and in the
  «מטופלים» service filter, and travels to the therapists app inside the plan (`getTreatmentPlans`
  already projects `serviceType` / `sessionsPerWeek`).
- Patient type: a plan with it is «טיפולים פרטניים» by the existing rule (any non-psychiatric,
  non-day-centre plan). No change to `public/patient-type.js`.
- Stored like every other plan type — the Hebrew label inside `serviceType` and the
  `sessionsPerWeek` JSON. No sheet column, no Code.gs change.

## Plan-only — deliberately

It has **no price, no clinical → billing mapping and no therapist rate** (the same first step
«טיפול משלים» took on 2026-11-09). So:

- it is **not** offered in «+ הוסף טיפול» / the charge editor (`chargeServiceTypes()`), because the
  source refuses a charge under a type it has no price for;
- a session cannot be recorded under it from the therapists app (`unknown_type`) until it is added
  to `CLINICAL_TO_BILLING` / `BILLING_PRICES` (both files) and to `TherapistRates`.

## Open decisions (Sandra)

1. The patient price per session (incl. VAT), or that it is priced only through the monthly package.
2. The therapist pay rate(s) for it.
3. Whether ezone-therapists should show it as its own clinical type (a follow-up PR there).

## Tests

`test/dual-diagnosis-plan-type.test.js` (new) and the `SERVICE_TYPES` pin in
`test/complementary-and-dual-therapist.test.js`. SW cache bump shared with
CHANGELOG-crm-dashboard-parity.md (v41 → v42).
