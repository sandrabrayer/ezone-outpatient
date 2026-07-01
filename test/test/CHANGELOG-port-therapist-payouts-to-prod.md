[CHANGELOG-port-therapist-payouts-to-prod.md](https://github.com/user-attachments/files/29563601/CHANGELOG-port-therapist-payouts-to-prod.md)
# CHANGELOG — Port therapist-payout ("תשלומי מטפלים") tab into production

## Why
The therapist-payment tab (with its Excel/CSV export for payroll) was built and
merged into branch `claude/youthful-volta-laarnk`, but production on Railway was
later repointed to `claude/ezone-outpatient-dashboard-hKjf9`, which branched off
**before** the payout work and never received it. Result: the tab "disappeared"
from the live site even though the code was never lost. Switching Railway back was
rejected because the dashboard branch is 32 commits ahead with unrelated
production work (billing fixes, card-charge toggle, location-as-source-of-truth,
createLead handoff, etc.). This change instead **ports the payout feature forward**
onto the current production branch.

## What was verified before writing code (read-only)
- All 15 payout functions + 10 config constants are **net-new** to production —
  zero name collisions.
- Full dependency closure: every internal call in the ported subsystem resolves
  within the merged file.
- The two pre-existing full-suite failures (`debt-status-forwarding`,
  `sheets-secret-forwarding`) fail identically on untouched production and are a
  sandbox artifact (missing `express` dev-dep) — unrelated to this change.

## Frontend (public/)
- **index.html**: added `תשלומי מטפלים` nav tab; added `#view-payouts` section
  (month picker, KPI cards, export button, payout list); added three module
  script includes.
- **app.js**: added payout state fields (`sessionLog`, `sessionLogLoading`,
  `sessionLogError`, `payoutMonth`, `payoutExpanded`); wired `payouts` into the
  view router; added `apiGetSessionLog()`; ported the payout render/compute/export
  block (`renderPayouts`, `payoutTherapistCard`, `ensureSessionLogLoaded`,
  `handlePayoutListClick`, `markTherapistForwarded`, `exportPayoutCsv`, helpers);
  added event wiring (month change, list click, export).
- **therapist-pay.js / therapist-payout.js / payout-export.js**: ported verbatim
  (pure UMD modules; single source of truth for pay rates, monthly aggregation,
  and CSV export).

## Backend (apps-script/Code.gs)
- Appended the self-contained **THERAPIST-PAYOUT SUBSYSTEM**: pricing/config
  constants (`CLINICAL_TO_BILLING`, `THERAPIST_FLAT_RATES`, `PSYCHIATRIST_RATES`,
  `BILLING_PRICES`, `DAY_CENTER_*`, `GROUP_BILLING`), `SESSION_LOG_HEADERS`,
  `SESSION_STATUS_BY_OUTCOME`, and functions `_getSessionLog`,
  `_recordSessionOutcome`, `_markForwarded`, `_payoutMonthOf`,
  `_computeSessionPay`, `_computeSessionValue`, `_therapistPay`,
  `_sessionOutcomeAuthOk`, `_billingPrice`, `_clinicalToBilling`,
  `_isDayCenterBilling`, `_planWeeklyFrequency`, `_toCredits`, `_monthKey`,
  `_hasOwn`, `_deriveClientServiceType`.
- Routing:
  - `doGet`: `getSessionLog` (internal read).
  - `doPost`: `recordSessionOutcome` (**secured** cross-app receiver — fail-closed
    via `_sessionOutcomeAuthOk`, reading `SESSION_OUTCOME_SECRET` from Script
    Properties), `markForwarded` (internal), `getSessionLog` (internal).

## Security
- `recordSessionOutcome` fails closed on secret mismatch, matching the existing
  cross-app secured-endpoint pattern (`getDebtStatus`, `getTreatmentPlans`).
- `SESSION_OUTCOME_SECRET` is read from Script Properties (never hardcoded) and
  must be set identically on both the outpatient and therapists Apps Scripts.

## Tests
- Added `test/therapist-pay.test.js` (12), `test/payout-export.test.js` (6),
  `test/therapist-payout.test.js` (9) — 27 passing, covering pay-rate lookups,
  psychiatrist-by-type rates, `withVat`, monthly bucketing/edge cases, numeric
  coercion of Sheets cells, and CSV export shape.
- No regressions introduced.

## Deferred (follow-up PR)
- The inline "+ הוסף סשן חסר" / "תיקון סשן" session-correction modal
  (`openSessionModal`, `correctSessionOutcome` route) — not required for the
  payroll export and pulls in extra modal HTML/handlers. The correct-session
  click branch is safely inert (no dangling reference).

## Post-merge steps (manual)
1. Railway auto-deploys the frontend on merge — hard-refresh to confirm the tab
   renders.
2. **Apps Script**: copy merged `apps-script/Code.gs` into the outpatient Apps
   Script editor (correct/live deployment of the two) → Save → deploy a NEW
   VERSION of the EXISTING deployment (keep `/exec` URL stable).
3. Set `SESSION_OUTCOME_SECRET` in outpatient Apps Script Script Properties
   (identical to the therapists app).
4. Verify via DevTools Network: `getSessionLog` returns `{ok:true,...}` and the
   payout tab populates for a month with recorded sessions.
