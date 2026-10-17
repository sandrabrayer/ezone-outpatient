# OP-01 — source authentication boundary

Status: candidate prepared 2026-10-16 from Outpatient
`afa9e8c0d4e3e04a9eabd7230db59a27030dee67`. Owner: Codex. No production
merge, deployment, source-data access or configuration inspection was performed.
The separate CRM projection draft #114 remains untouched.

## Verified problem and scope

The browser's signed session was checked by Node, but internal source actions
could reach their handlers directly without a credential. Three cross-app read
helpers also accepted requests when their Script Property was missing. These
are verified code/synthetic findings; the live `/exec` was not probed.

The fix authenticates all 16 GET and 46 POST method/action pairs before any
business handler or Sheets operation. Unknown/unclassified actions are denied.
Internal operations use `OUTPATIENT_PROXY_SECRET`, carried as `proxySecret`;
consumers retain their narrower `secret` and existing property names. No key
from one class authorizes another. `resolveStopFlag` preserves its two existing
contracts: a body `secret` selects the phone receiver; otherwise the by-id
internal route requires the proxy key. GET `saveAll` is removed. Malformed POST
JSON is rejected rather than becoming an empty default save.

The Node session gate remains first. Node always overwrites `proxySecret` and
`user`, refuses absent/short proxy configuration before cache access, and does
not expose raw upstream failures, URLs or non-JSON bodies. The configured proxy
credential must contain at least 32 non-padding characters. Nothing is added to
the public frontend, schema, financial formulas, user list or role permissions.

## Internal action inventory

All actions below require the Outpatient Node credential. Existing browser
call sites are in `public/app.js`; transport is `server.js:/api/sheets`.
This inventory is a code contract, not proof every feature is used in production.

| Method | Actions |
| --- | --- |
| GET | `getData`, `getPayments`, `getCharges`, `getSettings`, `getExtraSessionRequests`, `getStopFlags`, `getMyStopAlerts`, `getSessionLog`, `getContinuation`, `getCredits`, `getRemovedClients` |
| POST reads | `getData`, `getPayments`, `getCharges`, `getSettings`, `getStopFlags`, `getMyStopAlerts`, `getSessionLog`, `getContinuation`, `getCredits`, `getRemovedClients` |
| POST writes | `saveAll`, `approveExtraSession`, `correctSessionOutcome`, `markForwarded`, `createStopAlert`, `resumeTreatmentAlert`, `saveContinuation`, `mergeClients`, `restoreRemovedClient`, `saveSettings`, `savePayment`, `updatePayment`, `saveCredit`, `savePaymentAmountOverride`, `repairStaleNextBilling`, `saveCharge`, `updateCharge`, `removeCharge`, `removePayment`, `removeChargesForClient`, `removePaymentsForClient`, `removeLead` |
| POST dual path | `resolveStopFlag` by id uses the proxy key; by phone uses the existing `STOP_FLAG_SECRET` body field |

## Consumer inventory and compatibility

Read sources: Therapists `db60ce94b5e533e089799b8aea7f6e245ca8fa07`,
[`server.js`](https://github.com/sandrabrayer/ezone-therapists/blob/db60ce94b5e533e089799b8aea7f6e245ca8fa07/server.js),
[`apps-script/Code.gs`](https://github.com/sandrabrayer/ezone-therapists/blob/db60ce94b5e533e089799b8aea7f6e245ca8fa07/apps-script/Code.gs);
Dashboard
[`server.js`](https://github.com/sandrabrayer/E-Zone-Dashboard/blob/58c9bb33af2bd0f8b492be1ce0692edf8e9e236b/server.js).

| Source actions | Method | Required source property | Observed caller / release check |
| --- | --- | --- | --- |
| `getDebtStatus` | GET/POST | `DEBT_STATUS_SECRET` | Therapists Node **and** Therapists Apps Script; both can currently omit the key. Confirm all three locations match before release |
| `getTreatmentPlans` | GET/POST | `TREATMENT_PLANS_SECRET` | Therapists Node **and** Therapists Apps Script; same three-location check |
| `getWinbackSource` | GET/POST | `WINBACK_SECRET` | Documented export; no active caller verified in the current Dashboard snapshot. Determine whether it is used; configure the matching consumer if used. No anonymous fallback |
| `scanClientColumns` | GET/POST | `COLUMN_REPAIR_SECRET` | Maintenance-only scan; no normal app caller identified; remain unavailable when unset |
| `getStopAlerts` | GET/POST | `STOP_ALERTS_SECRET` | Therapists Node |
| `markStopAlertRead`, `markStopAlertUnread` | POST | `STOP_ALERTS_SECRET` | Therapists Node |
| `flagStop`, `resolveStopFlag` by phone | POST | `STOP_FLAG_SECRET` | Therapists Apps Script; preserve query-only `flagStop` and body-based phone-resolution formats |
| `setClinicalType` | POST | `CLINICAL_TYPE_SECRET` | Therapists Apps Script |
| `deactivateClient` | POST | `DEACTIVATE_CLIENT_SECRET` | Therapists Apps Script |
| `requestExtraSession` | POST | `EXTRA_SESSION_SECRET` | Therapists Apps Script |
| `recordSessionOutcome` | POST | `SESSION_OUTCOME_SECRET` | Therapists Apps Script; existing idempotent outcome/billing engine unchanged |
| `createLead` | POST | `CREATE_LEAD_SECRET` | Dashboard Node uses its `OUTPATIENT_LEAD_SECRET`; names differ, value must match |

Existing source helper gates are kept and the three optional-read helpers now
also fail closed independently. Narrow credential scopes are unchanged.
No live credentials were read and no key values belong in this document.
External/manual callers not present in these repositories remain unverified.

### Separate OP-06 finding

Therapists `_postTreatmentsGiven` still emits `recordTreatmentGiven` using
`TREATMENT_GIVEN_SECRET`. The reviewed Outpatient baseline has no corresponding
HTTP route. This predates this patch (previously `unknown action`, now denied);
do not invent a receiver or change billing rules to make it appear successful.
Determine whether this path is still active, reconcile it with
`recordSessionOutcome`, and verify visible pending/retry handling in OP-06.
The security fix does not claim that every legacy integration is functional.

## Configuration and ordered release

**Not ready to merge until these prerequisites are verified.** `AGENTS.md`
requires Sandra's separate production approval. `CLAUDE.md` forbids Codex from
changing Railway settings/variables or reading Railway logs. The configuration
owner performs the following steps; do not paste a key into chat or the PR.

1. Generate a new random credential (for example 32 random bytes encoded as
   hex, 64 characters) in a secure local/password-manager context. Do not reuse
   the PIN, session-signing key or a consumer key.
2. In [Railway](https://railway.com/dashboard), open the existing E-ZONE
   Outpatient project → production environment → Outpatient service → Variables.
   Add `OUTPATIENT_PROXY_SECRET` with that value and apply the variable change.
   Verify the existing version still works; do not change the branch, domain,
   workbook binding or existing variables. Runtime variables apply to new
   deployments, not to a process that is already running.
3. Open the **existing** Outpatient Apps Script project identified by the repo's
   `.clasp.json` → Project Settings → Script Properties. Add the same
   `OUTPATIENT_PROXY_SECRET`. Do not paste source code or create a new deployment.
4. Verify the configured consumers in the table above, especially debt and
   treatment-plan keys in Therapists Node, Therapists Apps Script and Outpatient
   Apps Script. Record pass/fail and active-consumer status only, never values.
   Do not rotate working consumer keys as part of this release. If a required
   key is missing, configure its source and all relevant callers before release.
5. Refresh source/branch/ownership, record the currently active deployment
   version and backup status, and require green candidate CI plus Sandra's
   approval for this specific PR. Existing backup verification remains evidence
   of that run, not proof of a fresh backup or source configuration.
6. After approved merge, Railway deploys the new Node version first. It continues
   to work with the previous source because that source ignores `proxySecret`.
   GitHub's Apps Script workflow waits for the exact merge SHA at `/api/version`
   and a successful `/healthz`. Missing/short Node proxy configuration returns
   503. Only after this gate does clasp push and publish a new version of the
   **same** source deployment. If readiness times out, source is untouched.
7. Verify Apps Script workflow success, Node commit, authenticated reads and
   the relevant consumer projections. Negative source checks must request only
   rejected/dummy actions and must not retrieve patient data. Verify a synthetic
   save in an isolated source before an approved, narrowly scoped live smoke
   check. No real payment or patient mutation is authorized by this document.
   Distinguish local synthetic, CI/browser, source deployment and live-use proof.

The deployment readiness gate proves only Node version and local key presence.
It cannot prove source-key equality, consumer configuration, Google identity or
end-to-end behavior. Configuration verification is therefore a release gate,
not an optional follow-up. No feature flag can silently reopen authentication.

### Rollback

Prefer correcting a mismatched configuration or rolling forward while keeping
the auth boundary. Do not roll Node back to the old credential-free proxy while
the source is protected: that would stop normal access. Do not silently revert
the source to its unauthenticated version. Any emergency rollback to that
version needs an explicit decision accepting the reopened access, the recorded
previous version, a controlled write pause and coordinated layer ordering.
Reverting a web deployment alone does not revert Apps Script Head used by the
nightly job. No rollback restores or rewrites patient/billing data.

## Acceptance and remaining work

- Real Code.gs routers: every method/action pair rejects absent, wrong and
  unconfigured credentials without invoking a business handler or Sheets.
- Valid internal and scoped consumer credentials still reach their handlers;
  query-only consumer POSTs and the dual stop-resolution route are preserved.
- Actual HTTP session proxy → real source fixture: authorized reads/payment
  save work, caller-supplied identity/credential cannot override the server,
  missing sessions cannot read even after cache fill, and errors hide secrets.
- Malformed payloads, unknown methods/actions and GET writes cannot mutate data.
- Full suite, browser CI and dependency audit must pass the stated gates.

Still open: live configuration/release/acceptance; named-user role permissions
(the current name picker is not RBAC and Ortal has not been added); OP-02 lock
failure and partial-write integrity; scheduled backup proof; performance; finance
semantics; OP-06 integration mismatch above. A passing authentication test is
not a claim that every authorized user has the correct business permissions.
