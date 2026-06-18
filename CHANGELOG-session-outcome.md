# Session-outcome receiver + pay/value compute (task 4.8-step3-out)

The **outpatient receiver** for session-outcome events: the E-Zone Therapists app
reports what happened in a session, and this endpoint computes the **therapist
pay** + the **client session value** and logs one reconciliation row. This is the
**receiver + compute only** — there is **no therapists-side sender** here (that is
the next task).

## What it does

- New POST action **`recordSessionOutcome`** on the Apps Script web app
  (`apps-script/Code.gs`):

  ```
  POST /exec { action:'recordSessionOutcome', secret, sessionId, phone,
               therapist, clinicalTreatmentType, date, outcome }
  ```

  Optional fields: `patientName` (else backfilled from a single client match) and
  `freqPerWeek` (only used by `ליווי יומי בקהילה`).

- **Fail-closed auth** (`_sessionOutcomeAuthOk`, gated by a new
  `SESSION_OUTCOME_SECRET` Script Property): an unset, empty, or mismatched secret
  is **rejected** (`{ ok:false, error:'unauthorized' }`) — same model as
  `flagStop` / `setClinicalType`, **not** the fail-open read pattern.

## Compute

`billingType = _clinicalToBilling(clinicalTreatmentType)` (the existing 4.5a
clinical→billing map), then:

| outcome | sessionStatus | therapistPay | clientSessionValue |
| --- | --- | --- | --- |
| `happened` | `consumed` | `_therapistPay(therapist, clinicalType)` (showed up → paid) | `_billingPrice(billingType, freq?)` |
| `patient_no_show` | `forfeited` | `_therapistPay(therapist, clinicalType)` (**therapist showed up → still paid**) | `_billingPrice(billingType, freq?)` |
| `therapist_cancelled` | `credited` | **0** (never delivered → never paid) | `_billingPrice(billingType, freq?)` |
| **group** (`קבוצה`), any paid outcome | as above | **0** | **0** (decided-free) |

- **No-show pays, therapist-cancelled does not.** The pay turns on whether the
  *therapist* showed up, not the patient.
- **Group is 0/0.** `קבוצה` short-circuits pay to 0 (it is bundled, not billed
  standalone) and `_billingPrice('קבוצה')` is already a decided `0`.
- **`ליווי יומי בקהילה` with no frequency in the event** → `clientSessionValue`
  is stored as **`null`** (a blank cell — a *flag*, distinct from a real `0`),
  **never guessed**. The therapist is still paid their flat rate; only the value
  is flagged. (Pass `freqPerWeek` 3/5 to price it: 15000 / 18000.)

### Rejections (write nothing)

- **unknown outcome** (not `happened`/`therapist_cancelled`/`patient_no_show`) →
  `{ ok:false, reason:'unknown_outcome' }`
- **unknown clinical type** (not in the 12-key map; incl. billing-only `אינטייק`,
  which has no clinical source) → `{ ok:false, reason:'unknown_type' }`
- **unknown therapist** on a *paid non-group* outcome (`happened`/`no_show`) →
  `{ ok:false, reason:'unknown_therapist' }`. (`therapist_cancelled` and group
  never look up the therapist, so they log fine regardless.)
- missing `sessionId` → `{ ok:false, reason:'missing_session_id' }`
- bad `ליווי` frequency → `{ ok:false, reason:'invalid_frequency' }`

A wrong/missing secret is rejected at the router (`unauthorized`) before any of
this.

## Log: the `SessionLog` tab (upsert by sessionId)

One row per session, keyed on `sessionId`:

```
sessionId, phone, patientName, clientId, therapist, clinicalTreatmentType,
billingType, date, outcome, therapistPay, clientSessionValue, sessionStatus,
matchStatus, recordedAt
```

- **Upsert by `sessionId`** (the `_upsertPayment`/`_upsertCharge` pattern): if a
  row with that id exists it is **overwritten** (so a corrected outcome recomputes
  pay on the *same* row — never a duplicate, never stale pay); otherwise appended.
- **Append-only / positional-safe**: `_ensureSheet`/`_writeAll` map columns by
  position; the row is built by header order. `phone` is auto-formatted as text
  (`PHONE_COLUMNS`) so leading zeros survive.
- **The log is keyed by session, not by client.** A phone match is *enrichment
  only*, never a gate: a single hit fills `clientId` (and backfills `patientName`)
  with `matchStatus:'matched'`; no hit still logs with `matchStatus:'no_match'`;
  multiple hits log with `matchStatus:'multi_match'`. The reconciliation row always
  writes.
- **Clients is never modified.**

Return: `{ ok:true, sessionId, therapistPay, clientSessionValue, sessionStatus,
upserted|appended }`.

## Server-side mirrors + sync-guards

The Apps Script runtime can't import the modules, so the pay table
(`public/therapist-pay.js`) and the price half of `public/treatment-map.js` are
**mirrored** in `Code.gs` — exactly as `CLINICAL_TO_BILLING` already is:

- `THERAPIST_FLAT_RATES`, `PSYCHIATRIST_RATES` (+ `_therapistPay`)
- `BILLING_PRICES`, `DAY_CENTER_MONTHLY_BY_FREQ` (+ `_billingPrice`)

`test/session-outcome.test.js` **parses each literal out of Code.gs** and asserts
it **deep-equals** the canonical module, so the mirror can never silently drift
(the same guard discipline as `test/clinical-derive.test.js`).

## Psychiatrist note (intake vs follow-up)

Psychiatrists pay **by treatment type**: `אינטייק` → 900, `מעקב פסיכיאטרי` → 700.
Follow-up (`מעקב פסיכיאטרי`) is a clinical session type and flows end-to-end
(pay 700, value 1100). **Intake (`אינטייק`) is billing-only** — it has no clinical
source in the 12-key map (consistent with `treatment-map.js`), so an end-to-end
intake *event* rejects as `unknown_type`. Intake **pay** is still covered by the
mirror and a direct `_therapistPay` unit test.

## Router

Registered in `doPost` only (POST-only, like `flagStop`/`setClinicalType`) —
secret pulled from `payload.secret` or `?secret=`, checked by
`_sessionOutcomeAuthOk`, then dispatched to `_recordSessionOutcome`. Not added to
`doGet`.

## Tests (`test/session-outcome.test.js`)

Code.gs can't be `require`d in Node, so the suite mirrors the logic and **parses
the real pay/billing tables and `SESSION_LOG_HEADERS` out of Code.gs** (no re-typed
tables). 27 cases:

- mirror sync-guards (flat rates, psychiatrist rates, billing prices, day-center
  frequencies) all deep-equal the modules
- each outcome computes the correct pay + value + status (incl. `patient_no_show`
  **pays**, `therapist_cancelled` pays **0**, group **0/0**)
- correction: same `sessionId` re-sent flips the row — `happened →
  therapist_cancelled` recomputes pay to **0** (no duplicate, no stale pay), and
  the reverse restores it
- psychiatrist pay by type (intake **900** / follow-up **700**); follow-up flows
  end-to-end
- unknown outcome / unknown clinical type / unknown therapist / missing sessionId
  all **write nothing**; auth is **fail-closed** (unset/empty/wrong secret rejected)
- `ליווי` with no freq stores **null** (flag), with freq prices by frequency
- client match enrichment never gates the log (matched / no_match / multi_match)
- positional safety on the new tab (header order, round-trip, null vs `0`)

All tests green (`npm test`).

## Files touched

- `apps-script/Code.gs` — pay/billing mirrors (`THERAPIST_FLAT_RATES`,
  `PSYCHIATRIST_RATES`, `BILLING_PRICES`, `DAY_CENTER_MONTHLY_BY_FREQ`,
  `_therapistPay`, `_billingPrice`), `SESSION_LOG_HEADERS`,
  `_sessionOutcomeAuthOk`, `_recordSessionOutcome`, and the
  `recordSessionOutcome` dispatch in `doPost`. **Requires an Apps Script redeploy.**
- `test/session-outcome.test.js` — new.
- `CHANGELOG.md`, `CHANGELOG-session-outcome.md`, `README.md`.

## Not in this step

No therapists-side sender / push, no UI, no Sheets migration. Receiver + compute
only.

## Deploy / config (required before this works live)

1. **Redeploy the Apps Script web app** to the existing deployment
   (`…FOwWYIw`): Apps Script editor → **Deploy → Manage deployments → ✏️ →
   Version: New version → Deploy**. The new action lives in `Code.gs`, so a fresh
   `/exec` version is required.
2. **Set the `SESSION_OUTCOME_SECRET` Script Property** (Apps Script editor →
   Project Settings → Script Properties). Until it is set, the endpoint
   fail-closes and rejects every call. This same value must be **carried to the
   E-Zone Therapists side** as the secret it POSTs.
