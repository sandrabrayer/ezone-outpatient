# Therapist pay table module (`public/therapist-pay.js`)

A standalone, hardcoded source of truth for the **pay** side — what E-ZONE pays
each therapist per session. It is the counterpart to `treatment-map.js` (which
is the client-facing **billing** side). This is **module + tests only** — it is
**NOT wired** into any save flow, form, or endpoint.

## All rates are PRE-VAT

The table stores **raw, pre-VAT** numbers and `therapistPay()` returns them
untouched. VAT is applied at payment time via the separate `withVat(amount,
rate=0.18)` helper, which is **never** called inside `therapistPay()`.

## Two pay structures

1. **Flat per-session, keyed per therapist.** The rate is tied to the
   **individual**, not to a grade — grade is a label only and is intentionally
   not modeled. Two "grade-A" therapists can sit at different rates (e.g.
   מעיין דלומי ₪250 vs דליה מלמד ₪230). 15 therapists:

   | Therapist | Rate (₪, pre-VAT) |
   |---|---|
   | מעיין דלומי | 250 |
   | ניר אורן | 250 |
   | תמר גנץ | 250 |
   | דליה מלמד | 230 |
   | אלה שפירא | 230 |
   | ליאת חגאבי | 230 |
   | נועה דואק | 230 |
   | חנן וייל | 230 |
   | יפעת רומנו | 220 |
   | כנרת זיידן | 220 |
   | איתן דשה | 210 |
   | נועה זיפמן | 210 |
   | רעות חוצה | 200 |
   | דניאל סייג | 200 |
   | אסתר | 180 |

2. **Psychiatrists pay BY treatment type, not flat.** ד״ר שפרינץ and ד״ר דנגור
   perform only two types: **אינטייק → ₪900**, **מעקב פסיכיאטרי → ₪700**. A
   psychiatrist lookup therefore **requires** a valid `treatmentType`.

## API

```js
therapistPay(therapistName, treatmentType?)  // -> pre-VAT rate (number)
withVat(amount, rate = 0.18)                 // -> amount incl. VAT (helper only)
```

- Flat therapist → their flat rate (`treatmentType` ignored).
- Psychiatrist → rate for the given type; **throws** if the type is missing or
  not `אינטייק` / `מעקב פסיכיאטרי`.
- Unknown therapist → **throws**.

Also exposed for inspection/tests: `FLAT_RATES`, `PSYCHIATRIST_RATES`,
`PSYCH_TYPES`, `isFlatTherapist`, `isPsychiatrist`, `assertTableComplete`.

## Tests (`test/therapist-pay.test.js`, 12 cases)

Every therapist returns the correct rate · roster is exactly 15 flat + 2
psychiatrists · the ₪250 vs ₪230 pair proves **per-person, not per-grade** ·
flat therapists ignore `treatmentType` · psychiatrists return 900/700 by type
and throw on missing/invalid type · unknown therapist throws · `therapistPay`
returns raw pre-VAT numbers while `withVat` is a separate, opt-in helper · a
completeness guard that fails loudly if a therapist is added without a valid
rate (flat or psychiatrist).

`node --test test/therapist-pay.test.js` → **12/12 pass**.

## Files

- `public/therapist-pay.js` — new UMD module (Node/tests + optional
  `window.TherapistPay`), matching the `treatment-map.js` convention.
- `test/therapist-pay.test.js` — new.
- `CHANGELOG.md`, `CHANGELOG-therapist-pay-table.md`, `README.md` — documented.

## Not in this step

No wiring into any save flow, form, or endpoint. No Sheets/Apps Script/Railway
change. Pure, side-effect-free pay oracle; consuming it is a later step.
