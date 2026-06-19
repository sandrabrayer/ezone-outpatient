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
   not modeled. Two therapists can sit at different rates (e.g.
   מעיין דלומי ₪250 vs דליה מלמד ₪230). 16 therapists:

   | Therapist | Rate (₪, pre-VAT) |
   |---|---|
   | מעיין דלומי | 250 |
   | תמר גנץ | 250 |
   | אורן כביר | 250 |
   | אביב מלכה | 250 |
   | רמי | 250 |
   | כנרת | 250 |
   | הילה | 250 |
   | עידו בוזגלו | 250 |
   | אלה | 250 |
   | שירן | 250 |
   | דנה | 250 |
   | יפעת | 250 |
   | איתן דשה | 250 |
   | דליה מלמד | 230 |
   | נועה זיפמן | 210 |
   | אסתר | 180 |

2. **Psychiatrists pay BY treatment type, not flat.** ד״ר שפרינץ, ד״ר נטליה and
   ד״ר דנגור perform only two types: **אינטייק → ₪900**, **מעקב פסיכיאטרי → ₪700**.
   A psychiatrist lookup therefore **requires** a valid `treatmentType`.

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

Every therapist returns the correct rate · roster is exactly 16 flat + 3
psychiatrists · the ₪250 vs ₪230 pair proves **per-person, not per-grade** ·
flat therapists ignore `treatmentType` · psychiatrists return 900/700 by type
and throw on missing/invalid type · unknown therapist throws · `therapistPay`
returns raw pre-VAT numbers while `withVat` is a separate, opt-in helper · a
completeness guard that fails loudly if a therapist is added without a valid
rate (flat or psychiatrist).

`node --test test/therapist-pay.test.js` → **12/12 pass**.

## 2026-06-19 — roster replaced with the final Therapists-tab roster

The placeholder roster was replaced **character-for-character** with the live
roster from the Therapists app's *Therapists* tab: **16 flat + 3 psychiatrists**.

- **Removed:** ניר אורן, אלה שפירא, ליאת חגאבי, נועה דואק, חנן וייל, יפעת רומנו,
  כנרת זיידן, רעות חוצה, דניאל סייג (placeholder/old-form names).
- **Added (₪250):** אורן כביר, אביב מלכה, רמי, כנרת, הילה, עידו בוזגלו, אלה,
  שירן, דנה, יפעת.
- **Rate change:** איתן דשה 210 → **250** (per the roster).
- **Kept:** מעיין דלומי 250, תמר גנץ 250, דליה מלמד 230, נועה זיפמן 210, אסתר 180.
- **Psychiatrist added:** ד״ר נטליה (₪900 intake / ₪700 follow-up), alongside
  ד״ר שפרינץ and ד״ר דנגור.

The `apps-script/Code.gs` mirror (`THERAPIST_FLAT_RATES` / `PSYCHIATRIST_RATES`)
was updated in lockstep; the `test/session-outcome.test.js` sync-guard stays
green.

### Deploy (required — the mirror changed)

`Code.gs` changed, so `recordSessionOutcome` will keep computing the **old**
rates until the web app is redeployed. **Redeploy the existing deployment
(`…FOwWYIw`):** Apps Script editor → **Deploy → Manage deployments → ✏️ →
Version: New version → Deploy**. No Script Property or `server.js` change is
needed. Until then, e.g. דליה מלמד's outcome still can't compute against the new
roster.

## Files

- `public/therapist-pay.js` — new UMD module (Node/tests + optional
  `window.TherapistPay`), matching the `treatment-map.js` convention.
- `test/therapist-pay.test.js` — new.
- `CHANGELOG.md`, `CHANGELOG-therapist-pay-table.md`, `README.md` — documented.

## Not in this step

No wiring into any save flow, form, or endpoint. No Sheets/Apps Script/Railway
change. Pure, side-effect-free pay oracle; consuming it is a later step.
