# One-time sessions — therapists-app contract

Source: outpatient Apps Script (`/exec`, the existing deployment). Owner of the
data: the outpatient app (`OneTimeSessions` sheet). See `CHANGELOG-one-time-session.md`.

## 1. Read — price-free feed

`GET /exec?action=getOneTimeSessionsFeed&secret=<ONE_TIME_SESSIONS_SECRET>`

- Secret: Script Property `ONE_TIME_SESSIONS_SECRET` on the outpatient Apps Script,
  **≥ 32 characters**, compared in constant time. Unset, short or wrong →
  `{ ok:false, error:'unauthorized' }` (fail closed). The therapists side stores the
  same value (Script Property / Railway variable — never in code or git).
- The outpatient Node proxy refuses this action from a browser (403); call `/exec` directly.
- Response: `{ ok:true, sessions:[ … ] }`, sorted by date + time, from 60 days ago onward.
  Each item has **exactly** these keys (pinned by `test/one-time-session.test.js`):

| key | meaning |
| --- | --- |
| `id` | session UUID (stable) |
| `patientName` | the client's current name (snapshot if the client is gone) |
| `phone` | the client's current phone, canonical `0XXXXXXXXX` |
| `therapist` | exact full name (same string as `TherapistRates` / the staffing roster) |
| `date` | `YYYY-MM-DD` |
| `time` | `HH:MM` (24h) |
| `location` | Hebrew house/branch label or `''` |
| `status` | `scheduled` · `completed` · `no_show` · `therapist_cancelled` · `cancelled` |
| `clinicalTreatmentType` | `פרטני EMDR` · `פרטני CBT` · `מעקב פסיכיאטרי` · `אינטייק` |
| `catalogKey` | the catalog row key (informational) |

**No amount, price, VAT, charge id, payment state, note or hash ever crosses.**
Match a session to a therapist by **exact** name; never by a partial or normalized name.

## 2. Write — mark the outcome

`POST /exec` with the existing `recordSessionOutcome` action and secret:

```json
{ "action": "recordSessionOutcome", "secret": "<SESSION_OUTCOME_SECRET>",
  "oneTimeSessionId": "<id>", "therapist": "<exact name>", "outcome": "happened" }
```

- `outcome`: `happened` · `patient_no_show` · `therapist_cancelled`.
- `therapist` must equal the session's therapist (`therapist_mismatch` otherwise).
- `happened` / `patient_no_show` are refused before the session date (`session_in_future`).
- A cancelled session takes no outcome (`session_cancelled`).
- Idempotent: re-sending the same outcome writes the same single SessionLog row
  (`sessionId` = `ots::<id>`); a different outcome corrects it in place.
- The session row is authoritative for date, patient, clinical type and price —
  `phone`, `date`, `clinicalTreatmentType`, `user`, amounts in the event are ignored.
- Response: `{ ok:true, sessionId:'ots::<id>', status:'completed' }` — price-free.
  Errors: `{ ok:false, error, reason }` with `not_found`, `unknown_outcome`,
  `therapist_mismatch`, `session_in_future`, `session_cancelled`,
  `unknown_therapist` (no usable rate in `TherapistRates` — nothing written), `busy`.

Pay: the normal `TherapistRates` rule (salaried «גלובלי» → 0). Not part of the
package: no quota, no credit. A row already forwarded to payroll keeps its pay.

## 3. What the therapists app should show

The assigned therapist's schedule/dashboard: a «חד פעמי» chip with
date · time · patient · service (Hebrew by clinical type) · location, and
«בוצע» / «לא הגיע» / «בוטל ע״י המטפל/ת» actions for a `scheduled` session on or
after its date. Feed unavailable → keep the last data, amber notice, zero writes.
