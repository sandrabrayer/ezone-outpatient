# טיפול משלים + שני מטפלים לפרטני — 2026-11-09

## טיפול משלים (complementary treatment)

- New treatment type **«טיפול משלים»** in the plan menu (SERVICE_TYPES), with a
  required subtype picked from a closed menu: **יוגה / דיקור / רפלקסולוגיה /
  אמנות**.
- Stable English keys `yoga / acupuncture / reflexology / art` are what is
  stored (new **append-only** Clients column `complementaryType`, position 40,
  mirrored on the Clients-removed tombstone); the Hebrew labels are render-time
  only. The server validates on every write (`_complementaryTypeOrBlank`): a
  payload without the key (pre-column tab) keeps the sheet value, an invalid
  value stores blank.
- The subtype picker renders inside the sessions host under the «טיפול משלים»
  frequency row — in the עריכה modal, the activation form and the direct-intake
  form (the agreement / renewal / extra-charge hosts do not persist it and do
  not show it). Saving with «טיפול משלים» picked and no subtype is refused.
- The patient card's תוכנית טיפול panel shows «טיפול משלים — יוגה» etc.

## שני מטפלים לטיפול פרטני

- When the plan has **טיפול פרטני 2+ בשבוע**, two selects — «מטפל/ת 1 — פרטני»
  / «מטפל/ת 2 — פרטני» — appear under the frequency row, populated from the
  TherapistRates roster names. Picking the same name twice is refused
  («יש לבחור שני מטפלים שונים לטיפול פרטני»); partial / blank is allowed.
- Stored in the new **append-only** Clients column `privateTherapists`
  (position 41, tombstone-mirrored) as a JSON array of 1-2 distinct names;
  server-validated (`_privateTherapistsOrBlank` — trimmed, distinct, ≤2, ≤80
  chars each, else blank). The selects hide when the frequency drops below
  2/שבוע, and hidden picks are not persisted.
- New names-only internal read **`getTherapistNames`** (doGet/doPost, behind
  `OUTPATIENT_PROXY_SECRET`, registered in both SOURCE auth maps): the
  TherapistRates **names only**, sorted — no rates or any other column ever
  cross. It is a **pure read** (never `_ensureSheet`s or seeds TherapistRates),
  preserving the read-only-boot contract; the frontend fetches it fail-soft as
  an 11th parallel read in `loadAll`.

## Therapists-app handoff

`getTreatmentPlans` now projects **`complementaryType`** (stable key) and
**`privateTherapists`** (array of names) per client — names/keys only, no
amounts, the minimal-projection contract holds. The therapists app receives
them with its existing feed; rendering them there is a follow-up in
`ezone-therapists`.

## Guard-test updates (sanctioned appends)

CLIENTS_HEADERS grew 39 → 41; the header-pinning guards were updated
deliberately: clients-column-order (frozen literal), billing-mode,
preferred-house, planned-exit-date, session-who-when, session-credits,
lead-assignee, responsible-removal, saveall-tombstone, nightly-integrity,
operational-recovery (old-width), corrupted-rows-cleanup,
stale-next-billing-repair, treatment-plans-phone (projection key set), and
source-auth-boundary (the new action's auth policy). The generated
google-operational-drill candidate was regenerated.

New tests: `test/complementary-and-dual-therapist.test.js` (10).
SW cache v34 → v35.
