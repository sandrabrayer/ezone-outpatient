# Forwarded-row therapist-pay freeze

A re-marked session no longer rewrites `therapistPay` on a `SessionLog` row that
has already been forwarded to payroll.

**Scope:** this one guard, nothing else. No schema change, no new endpoint, no UI
change, no change to who may do what.

---

## The bug

`SessionLog.forwardedToPayroll` holds the `YYYY-MM` payroll cycle a session was
handed to חשבת שכר in. `_markForwarded` is the only thing that sets it, and once
set the row is **settled**: the payout view filters it out so it never appears in
a total again.

`_recordSessionOutcome` upserts by `sessionId`. It preserved the **stamp** across
that upsert — but only the stamp:

```js
// before
if (oldRow && String(oldRow.forwardedToPayroll || '').trim() !== '') {
  rowObj.forwardedToPayroll = String(oldRow.forwardedToPayroll).trim();
}
```

`rowObj.therapistPay` was the freshly computed figure, written unconditionally.
So re-marking (or a corrected re-send of) an already-forwarded session silently
overwrote the pay on a row payroll had **already paid out**.

Nothing surfaced it. The row is excluded from the payout view, so the rewritten
figure never shows up anywhere again — the sheet just quietly stops agreeing with
the money that actually left the clinic.

### The case that loses the most

| | at forwarding | after a re-mark to `therapist_cancelled` |
|---|---|---|
| `outcome` | `happened` | `therapist_cancelled` |
| `therapistPay` | **250** — paid to the therapist | **0** |
| `forwardedToPayroll` | `2026-06` | `2026-06` (preserved) |

₪250 left the clinic. The record now says ₪0. There is no trace of the 250 in the
sheet and no view that would have shown the change.

`happened ⇄ patient_no_show` is the *harmless* re-mark, incidentally: both are
paying outcomes at the same rate (`_computeSessionPay` returns 0 only for
`therapist_cancelled` and for `קבוצה`), so the recomputation happened to land on
the same number. The damage came from crossing the `therapist_cancelled` (or
group) boundary, from a changed `therapist` or `clinicalTreatmentType`, or from a
`TherapistRates` edit between the forwarding and the re-mark.

---

## The fix

`wasForwarded` is derived once and drives both the stamp preservation and the new
freeze:

```js
var wasForwarded = !!(oldRow && String(oldRow.forwardedToPayroll || '').trim() !== '');
if (wasForwarded) {
  rowObj.forwardedToPayroll = String(oldRow.forwardedToPayroll).trim();
}

// ---- FORWARDED ROWS ARE PAY-FROZEN -------------------------------------
if (wasForwarded) {
  rowObj.therapistPay = _toNumberOrZero(oldRow.therapistPay);
}
```

and the result reports the row value rather than the discarded recomputation, so
a caller sees what was actually stored:

```js
therapistPay: rowObj.therapistPay,
```

New helper, so a blank or stray string in the cell cannot become `NaN` in the
sheet:

```js
function _toNumberOrZero(v) {
  if (v === '' || v === null || v === undefined) return 0;
  var n = Number(v);
  return isFinite(n) ? n : 0;
}
```

### It applies to every outcome

Deliberately unconditional. The question the guard answers is **not** "what did
this session turn out to be" — it is "what was payroll already sent". An
already-forwarded `happened` row is frozen for exactly the same reason a
`patient_no_show` one is. A test asserts the block's unconditional shape, so a
future outcome condition has to argue with it.

A genuine pay correction on a settled row belongs in the **next** cycle as a
**הפרש**, which is what the payout view's differences block already exists for —
not as a silent rewrite of a row nobody will look at again.

### What the freeze does NOT change

- **`outcome`, `sessionStatus`, and every other field** still correct normally.
  The row is not frozen; only its pay is.
- **The credit engine.** `creditsOwed` is a separate, still-open ledger — a
  cancellation credit is still granted on a forwarded row, and the reversal logic
  is untouched.
- **Validation order.** The pay compute (and therefore the `unknown_therapist`
  rejection) still runs *before* the freeze, so a bad payload fails loudly and
  writes nothing, forwarded or not.
- **The stamp preservation**, which is pre-existing behaviour and still asserted.
- **Un-forwarded rows.** They recompute from scratch exactly as before, and still
  pick up a `TherapistRates` change.
- **`PAID_OUTCOMES`** in `public/therapist-payout.js` — still the plain
  outcome-based map `{ happened: true, patient_no_show: true }`, guard-tested to
  stay that way and to know nothing about any pay status.

A whitespace-only stamp is **not** forwarded (the test is `.trim() !== ''`), so a
stray space cannot freeze a live row.

---

## Files

| file | change |
|---|---|
| `apps-script/Code.gs` | `_toNumberOrZero` helper; `wasForwarded` + the freeze in `_recordSessionOutcome`; result reads `rowObj.therapistPay` |
| `test/forwarded-pay-freeze.test.js` | new, 24 tests |
| `CHANGELOG.md`, `CHANGELOG-forwarded-pay-freeze.md` | this |

No other file is touched. `SESSION_LOG_HEADERS` is unmodified — no column is
added, so no existing row changes meaning.

---

## Tests

`test/forwarded-pay-freeze.test.js` (24). Code.gs cannot be `require()`d in Node,
so the upsert is mirrored with the sheet I/O as an in-memory array (the technique
`session-outcome.test.js` and `session-credits.test.js` already use) — and
**source-scan guards** assert the real `Code.gs` contains the helper, the
`wasForwarded` derivation, the unconditional freeze block, the `rowObj` result
read and the surviving stamp preservation, so the mirror cannot drift into
testing a fiction.

Contracts locked:

- forwarded + re-marked → `therapistPay` is the **stored** value, for every outcome
- the loss case: forwarded `happened` → `therapist_cancelled` no longer zeroes it
- a frozen **0 stays 0** — the freeze is not "keep the larger number"
- a `TherapistRates` change cannot rewrite a forwarded row
- the freeze survives a chain of re-marks
- **no leak**: un-forwarded rows still recompute, still pick up a rate change; a
  brand-new row is never frozen; a whitespace-only stamp does not freeze; another
  session's row is untouched
- the `forwardedToPayroll` stamp still survives the upsert
- the returned result reports the frozen pay
- credit effects are **not** frozen
- an unknown therapist still rejects on a forwarded row, writing nothing
- the upsert still replaces in place — no duplicate row
- `_toNumberOrZero` never yields `NaN`; a blank stored pay freezes at 0; a
  stringified pay freezes as a **number**, not a string
- `PAID_OUTCOMES` is untouched

Suite **944 → 968**, all green.

---

## Deploying

**Requires an Apps Script redeploy** (Deploy → Manage deployments → New version)
for the guard to take effect. No new Script Property, no env var, no schema
migration — `SESSION_LOG_HEADERS` is unchanged, so existing rows are read and
written exactly as before.

Until the redeploy lands, every re-mark of an already-forwarded session keeps
rewriting its pay.

## What this does not do

It stops the rewrite **from now on**. It does not repair rows already rewritten,
and it cannot — the old amount was overwritten in place and the sheet kept no
copy of it. See the repo discussion on detecting historical cases; the short
version is that `SessionLog` alone cannot confirm them, and the exported payroll
CSVs and the Google Sheets version history are the only records of the
pre-rewrite figures.
