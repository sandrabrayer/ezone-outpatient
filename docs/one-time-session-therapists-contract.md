# One-time sessions — OUT / therapists contract

Source of booking, price and charge: outpatient Apps Script `OneTimeSessions`.
Current paired candidate: OUT #181 + THR #146. Old THR #143/#145 are closed and must not be deployed.
Development verification is not production authorization. See `one-time-session-release-verification.md`.

## 1. Read — price-free feed

`GET /exec?action=getOneTimeSessionsFeed&secret=<ONE_TIME_SESSIONS_SECRET>`

The same secret (at least 32 characters) must be present in OUT and THR **Apps Script** properties.
It is compared in constant time; unset, short or wrong returns `{ok:false,error:'unauthorized'}`.
Never include the value in source, logs or review comments. OUT's Node browser proxy rejects this action (403).

Response: `{ok:true,sessions:[...]}`, sorted by date/time, from 60 days ago onward.
Each item contains only the following keys:

| Key | Meaning |
| --- | --- |
| `id` | Stable session UUID |
| `patientName` | Current client name; saved snapshot if client unavailable |
| `phone` | Current stored client phone with existing recovery; snapshot fallback |
| `therapist` | Exact full therapist name; no fuzzy/partial name matching |
| `date` | `YYYY-MM-DD` |
| `time` | `HH:MM` |
| `location` | Hebrew house/branch label or empty string |
| `status` | `scheduled`, `completed`, `no_show`, `therapist_cancelled`, `cancelled` |
| `clinicalTreatmentType` | Existing supported clinical treatment type |
| `catalogKey` | Informational catalogue key |

No amount, VAT, charge ID, payment state, note or hash crosses this feed.
THR mirrors the exact booking as Schedule ID `ots_<uuid>`; moves/cancellations update the same row.
A terminal OUT source status does not forge a local therapist outcome, coordinator approval or pay record.
Feed failure must be surfaced as unavailable, not silently treated as a valid empty feed.

## 2. Write — outcome

`POST /exec` through the existing signed `recordSessionOutcome` action:

```json
{"action":"recordSessionOutcome","secret":"<SESSION_OUTCOME_SECRET>","oneTimeSessionId":"<uuid>","therapist":"<exact name>","outcome":"happened"}
```

- Allowed outcomes: `happened`, `patient_no_show`, `therapist_cancelled`.
- `patient_cancelled_notice` (2026-11-16, the package credit for a patient's 24-hour notice) is
  **refused** for a one-time session: `{ ok:false, reason:'one_time_outcome_rejected' }`, nothing is
  written. A one-time session is outside the package — there is no credit to grant; a patient's
  advance cancellation is ורד's «ביטול» in OUT. THR never offers or stores that outcome on an
  `ots_` row.
- THR forwards after coordinator approval. Exact UUID outcome forwarding does not require a phone;
  ordinary treatment phone checks remain unchanged.
- Exact therapist must match. Future happened/no-show and cancelled bookings are rejected.
- The OUT booking supplies patient, date, clinical type and price; event phone/date/amounts are ignored.
- Retries upsert one SessionLog row `ots::<uuid>`, not a second pay row. A corrected outcome updates it in place.
- Normal TherapistRates apply; salaried pay is zero; previously forwarded payroll retains its pay.
- One-time rows are outside package quota/credit accounting; `creditsOwed` is untouched.
- Success is price-free: `{ok:true,sessionId:'ots::<uuid>',status:'completed'}`.
  Errors include `not_found`, `unknown_outcome`, `therapist_mismatch`, `session_in_future`,
  `session_cancelled`, `unknown_therapist`, `busy`.

## 3. Availability — patient-aware POST, required before create/move

`POST https://ezone-therapists.up.railway.app/feeds/out-one-time-busy`

Header: `X-One-Time-Busy-Secret: <OUT_ONE_TIME_BUSY_SECRET>`.
Use the dedicated same key in THR Railway and OUT Apps Script; never overwrite the existing
Coordinators `THERAPIST_BUSY_SECRET`. This key is distinct from the one-time feed key above.

```json
{"therapist":"<exact name>","date":"YYYY-MM-DD","time":"HH:MM","patientPhone":"0XXXXXXXXX","excludeOneTimeId":"<optional uuid>"}
```

OUT resolves phone from the exact current Clients.id, never a browser-supplied phone. Move uses the
stored session.clientId. The phone is only in the body, not the URL or response. THR requires its
existing canonical 10-digit format. A 9-digit local landline that OUT accepts cannot pass THR's stricter
calendar-key validator; this fails closed, not free. Do not fabricate a mobile number to bypass it.

THR reads fresh Schedule/active recurring Assignments. Busy means overlap for the same therapist OR
same canonical calendar phone. Date boundaries/durations/cancellations and exact OTS self-exclusion apply.
Residential therapist overlap is additionally checked using its fresh existing feed.

Only `{ok:true,busy:<boolean>,patientChecked:true}` is valid. Old GET remains therapist-only and
never returns patientChecked. Missing key/invalid phone/failed source/malformed or old response blocks
new bookings and moves. All external reads happen outside the OUT global finance lock; exact current
phone/target/revision/local overlaps are revalidated under the lock before mutation. Exact replay is
handled first, without another remote check. Cancellation/outcome/UUID-only syncing is not newly phone-gated.

This is conservative conflict prevention, NOT identity linking or merging. Shared household phones can
over-block. Missing legacy appointment phones cannot establish a same-patient match. Residential patient
identity is not exposed, so residential same-patient overlap is not proven. The check is not a distributed
reservation across two apps; simultaneous independent writes still require operational oversight.

## 4. UI and staged release

THR shows the single-session chip and assigned therapist's permitted outcomes; coordinator approval
remains separate. OUT rejects malformed session/catalogue reads rather than showing false empty state.
After an accepted mutation, failed readback clears actionable stale rows and warns not to repeat the write.
Later successful read clears only the one-time load gap, preserving unrelated finance errors.

After explicit release approval: provision dedicated keys securely; deploy/verify THR's patient-aware
Node route BEFORE OUT's new booking path; release OUT Node plus its separate exact-commit Apps Script
workflow; finish the paired THR Apps Script deployment and verify versions/cache. Verify the existing
catalogue read-only, do not blindly import. Missing integration must remain unavailable throughout staging.
Approved test-patient, clinical/payment-scoped UAT is still required. No source/financial data, secrets,
merges or deployments were changed by this verification work.

## 5. Conflicting outcome (`source_outcome_conflict`)

If the session already holds a terminal result (`completed` / `no_show` / `therapist_cancelled`) that
differs from the incoming `outcome`, `recordSessionOutcome` answers
`{ok:false,error:'source_outcome_conflict',reason:'source_outcome_conflict'}` and writes nothing.
Identical replays still succeed. Corrections are made only via OUT's revision-checked operation;
a new coordinator-correction contract would need an explicit versioned design.
