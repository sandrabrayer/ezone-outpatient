# Secured `setClinicalType` write endpoint (task 4.5b)

The **write** half of the clinical→billing pipeline: the E-Zone Therapists app
can now push a patient's clinical treatment type onto the matching outpatient
client, which derives and overwrites `serviceType` server-side. This is the
**endpoint only** — no therapists-side sender and no UI control are built here.

## What it does

- New POST action **`setClinicalType`** on the Apps Script web app
  (`apps-script/Code.gs`):

  ```
  POST /exec { action:'setClinicalType', secret, phone, clinicalTreatmentType }
  ```

- **Fail-closed auth** (`_clinicalTypeAuthOk`, gated by a new
  `CLINICAL_TYPE_SECRET` Script Property): an unset, empty, or mismatched secret
  is **rejected** (`{ ok:false, error:'unauthorized' }`). This is the same model
  as `flagStop` — **NOT** the fail-open read pattern (`getDebtStatus` /
  `getTreatmentPlans` open when their secret is unset). This is an external write
  to `Clients`, so no-secret means no-write.

- **Match by canonical phone**, reusing the shared `_recoverPhone` normalization
  (`+972`/`00`/dashes/leading-zero recovery) against the same phone fields the
  stop-flag matcher checks: `phone`, `treatmentContactPhone`, `payerPhone`.

## Outcomes (never fail-open, never guess)

| Case | Result | Sheet |
| --- | --- | --- |
| **single** phone match | `{ ok:true, matched:1 }` | sets `clinicalTreatmentType`, derives + overwrites `serviceType`, writes the row |
| **no** match | `{ ok:false, reason:'no_match' }` | **writes nothing** |
| **multiple** matches | `{ ok:false, reason:'multi_match' }` | **writes nothing** |
| **unknown** clinical type (not in the map, or empty) | `{ ok:false, reason:'unknown_type' }` | **writes nothing** |
| invalid phone | `{ ok:false, reason:'invalid_phone' }` | writes nothing |

A multi-match is never resolved by guessing (no name tiebreaker) — the safe
default is to write nothing and leave it to a human, exactly the never-fail-open
discipline used by the debt-status endpoint.

## Reuses the 4.5a derive — no duplicated map

The unknown-type check uses the **same** inline `CLINICAL_TO_BILLING` map, and a
single match calls the **same** `_deriveClientServiceType` / `_clinicalToBilling`
that `_saveAll` already runs. The map is validated *before* the write (so an
unknown type rejects cleanly rather than throwing mid-write), and the derive runs
clinical → billing so clinical stays the authoritative source of `serviceType`.

## Writes only two fields; positional safety

Only `clinicalTreatmentType` and the derived `serviceType` change on the matched
client object. `_writeAll` rewrites the full `Clients` array by **position**, so
every other cell on the matched row — and every untouched row — is written back
exactly as read. `clinicalTreatmentType` remains the last append-only column
(after `phone`), so a legacy row lacking the cell stays aligned.

## Router

Registered in `doPost` only (POST-only, like `flagStop`) — secret pulled from
`payload.secret` or `?secret=`, checked by `_clinicalTypeAuthOk`, then dispatched
to `_setClinicalType`. Not added to `doGet`.

## Tests (`test/set-clinical-type.test.js`)

Code.gs can't be `require`d in Node, so the suite mirrors the logic and **parses
the real `CLINICAL_TO_BILLING` map and `CLIENTS_HEADERS` out of Code.gs** (no
re-typed map). Cases:

- the map used here deep-equals `public/treatment-map.js` (reuse, not duplicate)
- auth is **fail-closed** (unset / empty / wrong secret rejected; exact match ok)
- single match writes + derives, returns `matched:1`, leaves other rows untouched
- the two renames derive correctly: `פרטני כללי → פרטני` **and**
  `ליווי יומי בקהילה → ליווי יומי בקהילה` (the day-center rule, bound to the new name)
- a newly-billable type (`פסיכודינמי`) derives to its own name
- phone is normalized (`+972` / dashes) and matches `treatmentContactPhone`/`payerPhone`
- no-match / multi-match / unknown-type / empty-type / invalid-phone all **write
  nothing** (snapshot before == after)
- positional safety: only the two target fields change; a legacy row with no
  `clinicalTreatmentType` cell stays aligned (`phone`, `id`, others intact) after
  a write-back

All 145 tests green (`npm test`).

## Files touched

- `apps-script/Code.gs` — `_clinicalTypeAuthOk`, `_setClinicalType`, and the
  `setClinicalType` dispatch in `doPost`. **Requires an Apps Script redeploy.**
- `test/set-clinical-type.test.js` — new.
- `CHANGELOG.md`, `CHANGELOG-set-clinical-type.md`, `README.md`.

## Not in this step

No therapists-side sender / push, no UI control, no Sheets migration.

## Deploy / config (required before this works live)

1. **Redeploy the Apps Script web app** to the existing deployment
   (`…FOwWYIw`): Apps Script editor → **Deploy → Manage deployments → ✏️ →
   Version: New version → Deploy**. The new action lives in `Code.gs`, so a fresh
   `/exec` version is required.
2. **Set the `CLINICAL_TYPE_SECRET` Script Property** (Apps Script editor →
   Project Settings → Script Properties). Until it is set, the endpoint
   fail-closes and rejects every call. This same value must be carried to the
   E-Zone Therapists side as the secret it POSTs.
