# getTreatmentPlans: a validated join phone + `phoneIssue` (why a patient has none)

**Date:** 2026-09-28 · **Apps Script redeploy:** yes (automatic — clasp CI on
merge to `claude/youthful-volta-laarnk`) · **Frontend assets:** yes (SW `v7 → v8`)

## The report

The E-Zone Therapists app did not show 14 outpatient patients. The therapists
roster is **keyed by phone** and drops a row whose phone yields no match key
without a trace (`ezone-therapists` `public/roster.js`: `if (!key) return;`).
Both of its base sources — `getTreatmentPlans` and `getDebtStatus` — projected

```js
_recoverPhone(cl.phone) || _recoverPhone(cl.treatmentContactPhone)
```

with **no validation**. (The report described the older
`cl.treatmentContactPhone || ''` projection; that was replaced in June — the
deployed script already preferred `phone`.)

## Phase 0 — what the live data showed (read-only audit, 2026-09-28)

Audit of the live `Clients` tab (50 rows). Every phone column checked:
`treatmentContactPhone`, `payerPhone`, `phone`.

- **13 of the 14 reported patients have no phone in any column.** All three
  cells are blank. Not one has a formatting problem: no lost leading zero,
  no dashes, no `+972`, no spaces.
  - 11 are lead conversions whose client row never received a number.
  - 2 were added directly (the direct-add form's phone field is optional).
  - One of the 11 has a number on its removed lead record, but that number is
    identical to **another** client's phone. That is why nothing is
    backfilled from leads: that would be a guess.
- **The 14th was not named.** Every other row carries a valid 10-digit number
  in its phone column(s). One row's only number sits next to a payer name. The
  export cannot say whether that number is in `payerPhone` (not a candidate, so
  the row would emit `''`) or in `phone`. The post-deploy feed settles it: it
  flags exactly the rows the therapists app cannot key.
- **Exactly one row has a legacy `treatmentContactPhone`.** It holds a number
  that belongs to a different person elsewhere in the same sheet, while that
  row's own `phone` is valid. This decided the fallback order (below).

**Consequence:** no normalization can make these 13 patients appear. The fix is
to enter their phone numbers. This change makes that visible on both sides and
hardens the rule for the future.

## The rule (one rule, three places)

`public/phone-issue.js` documents it. `apps-script/Code.gs` (`_canonicalPhone`,
`_crossAppPhone`) and `public/debt-status.js` mirror it. A parity test pins all
three.

1. **Candidates, in order:** `phone` (the patient's own number, the documented
   cross-app join key), then `treatmentContactPhone`. `payerPhone` is **never**
   a candidate, because a payer is not the patient.
2. **Normalize at read** with `_recoverPhone`: strip separators, change
   `+972` / `972` / `00972` to `0`, and restore a leading zero that Sheets
   dropped. This is the same function every inbound receiver (`flagStop`,
   `recordSessionOutcome`, …) applies to these cells, so an emitted phone
   always matches back.
3. **Accept only a canonical value**, `/^0\d{9}$/` (the therapists app's own
   `CANONICAL_RE`). The first accepted candidate wins, so an **invalid `phone`
   no longer hides a valid `treatmentContactPhone`**. Before, a malformed but
   non-empty `phone` short-circuited the `||`.
4. **Otherwise** `phone: ''` and `phoneIssue` is one of:
   - `'missing'`: no candidate carries a digit.
   - `'invalid'`: some candidate has digits that are not a canonical mobile.

   The code never guesses. An invalid value is never truncated, padded or
   split. `9720501234567` (a `+972` number with the trunk zero kept) stays
   invalid, exactly as the entry form already rejects it.

### Decisions

- **The order stays `phone` → `treatmentContactPhone`.** The request asked
  for `treatmentContactPhone` first. Three things argue against it:
  - The live data: that order would re-key the one row with a legacy contact
    phone to **another person's number**.
  - It would diverge from the product-owner-agreed debt-gate contract.
  - It helps none of the 13 patients.

  To flip it, change `CROSS_APP_PHONE_SOURCES` in both files; the tests pin
  it on purpose.
- **`getDebtStatus` emits the same validated phone (value only, no new
  key).** The two feeds are the roster's two base sources. If only one were
  validated, an invalid-phone client would carry two different keys and split
  into two therapists cards. For all 50 live rows its output is byte-identical
  to before, because no live phone is invalid.
- **`phoneIssue` is on `getTreatmentPlans` only.** It is `''` whenever `phone`
  is non-empty. It is derived at read time and never stored.
  `CLIENTS_HEADERS` is untouched.

## Contract

`getTreatmentPlans` row keys are the previous projection **+ `phoneIssue`**,
with no other change:

```jsonc
{ "sourceApp": "ezone-outpatient", "clientId": "c1", "name": "…",
  "phone": "",            // '' or /^0\d{9}$/
  "phoneIssue": "missing", // '' | 'missing' | 'invalid'
  "serviceType": "…", "sessions": "…", "status": "…",
  "startDate": "…", "exitDate": "", "renewalDate": "…" }
```

No billing or payment key was added (guard-tested). Nothing breaks for the
consumer. The therapists server's `planProjection` whitelists its keys, its
`/api/treatment-plans` route relays the reply as-is, and its roster reads only
named fields, so the extra key is ignored until the therapists app chooses to
display it.

## Outpatient UI: the amber chip

A patient card whose client has no canonical phone now shows an amber chip in
the header row:

- **«⚠ חסר טלפון»** when the number is missing.
- **«⚠ טלפון לא תקין»** when it is invalid, next to the bad 📞 number.

Its tooltip says the patient will not appear in the therapists app until a
valid 10-digit mobile is entered via עריכה. The chip uses the same rule as the
feed (`EzonePhoneIssue.cardPhoneIssue`), so **chip ⇔ `phoneIssue`**. The one
exception is a cross-app-deactivated (`לא פעיל`) client, which is not in the
feeds at all. The chip is advisory and fail-soft: no chip if the module fails
to load. It uses existing amber tokens (`--amber`, the `.status-pause` family).
Verified in a real browser against a local fake upstream, on desktop and on a
390 px phone viewport.

## Files

- `apps-script/Code.gs`: `CANONICAL_PHONE_RE`, `CROSS_APP_PHONE_SOURCES`,
  `_canonicalPhone`, `_crossAppPhone`. `_getTreatmentPlans` emits
  `phone` + `phoneIssue`. `_getDebtStatus` emits the same `phone`. Doc
  comments updated.
- `public/phone-issue.js` (new): the documented rule, UMD
  (`window.EzonePhoneIssue`).
- `public/debt-status.js`: `crossAppPhone` mirror, used by
  `computeClientDebt`.
- `public/app.js`: `phoneIssueChipHtml`, and the chip in the card's
  `client-meta` row.
- `public/style.css`: `.chip-phone-issue`.
- `public/index.html`: loads `phone-issue.js` before `app.js`.
- `public/sw.js`: `CACHE` `v7 → v8` (bumped from the live version).
- `test/treatment-plans-phone.test.js` (new, 24 tests). It runs the **real**
  `Code.gs` in a `vm` sandbox and covers:
  - every normalization case, and that an invalid value is never guessed;
  - the fallback order and `payerPhone` exclusion;
  - a 1,521-pair Code.gs ⇔ module ⇔ debt-module parity sweep;
  - both endpoints executed, the plans and debt phones equal per client, and
    both endpoints read-only;
  - the doGet route and its secret gate;
  - the contract key set, `CLIENTS_HEADERS` untouched, and `phoneIssue` never
    stored.
- `test/phone-issue-chip.test.js` (new, 8 tests): the card verdict and
  wording, the real `phoneIssueChipHtml` (escaping, fail-soft), its placement
  and style, the script order, the SW bump, and `server.js` untouched.
- `test/treatment-plans.test.js`: mirror updated; the contract guard gains
  `phoneIssue` **only**; 2 new cases.
- `test/debt-status.test.js`: 1 new case (canonical-only phone, and the same
  phone as the plans feed).
- `README.md`, `CHANGELOG.md`, `CHANGELOG-treatment-plans-endpoint.md`,
  `docs/USER-GUIDE.he.md`, `EZONE-ECOSYSTEM-STATUS.md`.

Mutation-checked: reverting the projection, swapping the order, disabling
validation, or reverting the debt phone each turns the new suite red.

## Deploy

- Merging to `claude/youthful-volta-laarnk` triggers **Deploy Apps Script**
  (`clasp push` → `clasp deploy -i <DEPLOYMENT_ID>`). That publishes a new
  version of the **existing** deployment, so the `/exec` URL is unchanged. Do not
  paste code by hand and do not create a new deployment.
- Railway redeploys the frontend from the same branch. SW `v8` evicts the old
  shell on activate.
- No new secret, no Script Property, no Railway variable, no sheet column.

## Follow-ups (not in this change)

- **Data:** enter the missing phone numbers in outpatient (עריכה → טלפון). The
  amber chip marks every card that needs one.
- **Therapists app:** surface `phoneIssue`, for example a «מטופלי חוץ ללא
  טלפון» list built from the relayed feed instead of dropping those rows. The
  roster needs no change to keep working.
- The direct-add form accepts an empty phone (`required=false`). Making the
  phone required there would stop new cases at the source. That is a product
  decision.
