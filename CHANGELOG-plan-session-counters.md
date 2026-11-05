# Session counters for the therapists app, monthly units, אינטייק (2026-11-05)

Sandra, 05/11 (therapists-app audit): «כשטיפול מתקיים וזה חלק מסדרה זה צריך לציין את זה וגם לעקוב
לאחר כמה טיפולים נשארו … אם המטפל ביטל יש למטופל קרדיט, אם המטופל לא הגיע ולא הודיע אז הוא איבד את זה».

## What changed (Apps Script `Code.gs`, mirror `public/treatment-map.js`)
1. **`getTreatmentPlans` → four new fields per client** (additive, counts only):
   - `monthQuota` — the plan's sessions per calendar month (`_planMonthlyQuota`: weekly × 4, monthly × 1).
   - `monthUsed` — «happened» rows in `SessionLog` for this client this month.
   - `monthRemaining` — `max(0, quota − used)`, or `null` when the plan has no countable frequency.
   - `makeupSessions` — `Clients.creditsOwed` as a number (a therapist cancellation adds one; a
     session beyond the quota draws one). A COUNT of sessions, never an amount — the money-free
     projection contract holds (`test/treatment-plans-phone.test.js` E pins the key set and
     `/pay|amount|price|charge|billing|credit/i` on keys).
   The therapists app shows «מפגש X מתוך Y», the make-up sessions and a renewal alert at
   «1 session left or 7 days» from these.
2. **Monthly units** — `sessionsPerWeek` may carry `_units` (`שבוע` / `חודש`, written by the client form).
   The credit engine used `_planWeeklyFrequency × 4`, so «מעקב פסיכיאטרי 1 / חודש» had a quota of 4 and
   never drew a credit. `_planMonthlyQuota` honours the unit; `_recordSessionOutcome` uses it (the
   event-frequency fallback stays). `_planWeeklyFrequency` is unchanged for its other callers.
3. **`אינטייק`** — `PSYCHIATRIST_RATES` pays ₪900 for it and `BILLING_PRICES` prices it, but it was
   missing from `CLINICAL_TO_BILLING`, so `recordSessionOutcome` / `correctSessionOutcome` answered
   `unknown_type` and a psychiatrist's intake never reached SessionLog or the payout. Added (13 keys).
   Unknown types still fail closed.

`test-support/google-operational-drill-candidate.gs` regenerated with the builder (helper set changed:
`_planMonthlyQuota`, `_happenedInMonth`). No sheet header changed. No SW bump (no `public/` UI change —
`treatment-map.js` is a pure module; `v29` stays).

## Tests
`test/plan-session-counters.test.js` (6): counters from plan + log (other months / outcomes excluded);
remaining floor + null quota + credits count; monthly units arithmetic; the credit engine draws on the
2nd monthly session; אינטייק accepted and paid ₪900 / valued ₪2,300, unknown still rejected; the
projection stays money-free. Updated pins: `planned-exit-date` (B), `treatment-plans-phone` (E),
`session-outcome` (אינטייק), `clinical-derive`, `treatment-map`, `set-clinical-type` (13 keys).
Suite 2195 green.
