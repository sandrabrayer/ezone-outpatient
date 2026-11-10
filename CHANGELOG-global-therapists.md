# Salaried («גלובלי») therapists — 2026-11-10

**Why.** Sandra: therapists with no per-session rate in `TherapistRates` are
actually salaried (גלובלי) — they get no per-session payment for outpatient
work. The app could not tell "salaried" from "rate forgotten": both made
`_therapistPay` throw, so `recordSessionOutcome` **refused** every session by
those therapists (`unknown_therapist`). Their sessions were missing from the
SessionLog — and from any profitability view built on it.

**Data (done 2026-11-10).** Every blank `flatRate` in `TherapistRates` that
had no other rate now reads `גלובלי` (14 names, incl. אוהד לביא). The three
psychiatrists with intake/follow-up rates are unchanged.

**Change.**
- `apps-script/Code.gs`
  - `_isGlobalRate(v)`: exactly `גלובלי` (trimmed) or `global` (any case).
    Anything else — blank, a typo like `גלובאלי`, `גלובלי 250` — is not.
  - `_loadTherapistRates` carries `global`; `_therapistPay` returns **0** for a
    salaried name. A **blank** rate still throws (fail-closed): a forgotten
    rate is never mistaken for a salaried therapist.
  - `SESSION_LOG_HEADERS` **appended** `payModel` (`'global'` | `''`), written
    by `recordSessionOutcome` from the roster (`_therapistPayModel`, never
    throws).
  - `_markForwarded` never stamps a `payModel: 'global'` row.
- `public/therapist-payout.js` — `isGlobalPay(row)`; salaried rows are kept
  out of every payout view (live month and הפרשים), so «תשלומי מטפלים» and
  the payroll export show per-session therapists only.
- `public/app.js` — the roster-add toast now says to fill a rate **or**
  `גלובלי`.

**Profitability note.** Salaried sessions now carry their session value
(revenue side) with therapist cost 0. Their real cost is salary, which lives
outside this app — a cost-per-session for profitability is a separate,
not-yet-built step.

**Tests.** `test/global-therapists.test.js` (5): salaried happened/no-show →
recorded at 0 with `payModel: 'global'` and a session value; per-session
unchanged; blank / typo / unknown still refused with nothing written; payout
view excludes salaried rows; `markForwarded` stamps 0 salaried rows and still
stamps per-session ones; exact-word matching. `test/session-outcome.test.js`
header-order guard updated for the appended column. Drill candidate
regenerated.

**Release.** `Code.gs` changed → Deploy Apps Script after merge. The rate
cache (120 s) means the change is effective within ~2 minutes of the deploy.
