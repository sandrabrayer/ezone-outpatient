# Payroll report emailed to מורן — outpatient receiver (2026-11-19)

Branch `claude/payroll-email-20261119`, base `claude/youthful-volta-laarnk` @ `9490f7a`.
Paired with ezone-therapists `claude/payroll-to-moran-20261119` (the «שליחה למורן» button).
**Release this PR first.**

## Why

Sandra (2026-11-19): therapist payouts belong with the therapists app, with the report going
straight to מורן (HR) by email. Decisions: no pay amounts shown in either app's new flow; אורן
presses the button and handles corrections in the therapists app; the address is
moran@totalgroup.co.il (stored as a Script Property, never in code).

## What

`apps-script/Code.gs`:

- `sendPayrollReport` in `SOURCE_POST_AUTH` → `PAYROLL_SEND_SECRET` (dedicated, ≥ 32 chars,
  constant-time). The browser proxy key never authorizes it.
- `_payrollSummary` / `_payrollGroup` / `_payrollCsv` — mirror of
  `TherapistPayout.monthlyPayoutSummary` + `PayoutExport.buildPayoutCsv`. The CSV is
  **byte-identical** to the existing «ייצוא לאקסל» (parity test over mixed fixtures:
  paid / no-show / cancelled / notice / salaried / closed months / הפרשים / future / garbage).
- `_sendPayrollReport` — validates month (`YYYY-MM`, 2026-01 … current month, Israel time)
  and actor; recipient only from `PAYROLL_REPORT_EMAIL` (single address, no separators —
  anything else = `not_configured`). Under the script lock: summary → `MailApp.sendEmail`
  (subject «תשלומי מטפלים — YYYY-MM», CSV with BOM attached, Hebrew body with counts, sender
  name) → stamp `forwardedToPayroll` with each row's own month on exactly the reported rows →
  `logAudit_('payroll_sent')`. Mail before stamp: a failed send stamps nothing.
- Reply: `{ ok, sent, month, therapists, paidSessions, sessions, differenceSessions }` — no
  amount, no patient, no address. Empty report → `{ ok:true, sent:false, reason:'nothing_to_send' }`.
- No patient name or phone in the mail body or the CSV.

No sheet column, no Node or UI change. `MailApp` scope (`script.send_mail`) was already in
`appsscript.json` — no re-authorization.

## Tests

`test/payroll-email.test.js` (11): parity (3 months × 3 fixtures), VAT/header mirrors,
fail-closed auth (unset / short / wrong / empty / missing), proxy key refused, recipient only
from the property (caller-supplied `to` ignored, malformed refused), month/actor validation,
full send (recipient, subject, attachment bytes, stamps, counts-only reply, no patient data,
audit), CR/LF in the actor name, double press → nothing_to_send, late row → הפרשים stamped
with its own month, failed send stamps nothing, current vs future month. Full suite 2469/2469.

## Configuration (Sandra)

Outpatient Apps Script → Project Settings → Script properties:

| Property | Value |
| --- | --- |
| `PAYROLL_SEND_SECRET` | ≥ 32 random chars — **same value** on the therapists Apps Script |
| `PAYROLL_REPORT_EMAIL` | `moran@totalgroup.co.il` |

Until both are set the therapists button answers «השליחה למורן עדיין לא הוגדרה».

## Rollback

Revert the PR and redeploy Apps Script. Stamped rows stay stamped (same meaning as Moran's
«הועבר» button).
