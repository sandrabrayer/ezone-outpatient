# OUT tasks 2/3 — acceptance and continuation, 2026-11-20

**Candidate only; no merge, deployment, live financial writes or data repair.**
Owner: this OUT workstream. Base `3e3930119987c069d14f58496fe9cdd3ca463ecd`,
branch `codex/out-payment-workflow-20261120`, parent card #152, program Dashboard
#331. Dashboard #421/#422 and Therapists task 4 are separate owners.

## Evidence by business step

| Step | Implementation exercised | Evidence and remaining boundary |
|---|---|---|
| Inquiry, contact, next action and meeting | Existing Leads, Tasks and Activity, actual Code.gs router | New HTTP/source journey plus existing CRM/contact/lead browser suites |
| Offer and treatment plan | Existing offer/catalog and plan flows | Existing offers-crm and plan-types browser suites included in mandatory browser CI |
| Admission | Existing saveAll, package and per-session conversion | Regression first failed against baseline; source/HTTP prove stale distinct-client conversion refused and exact saved retry accepted |
| Cross-app status | Existing source feed, original referral identity | Actual admission removes Lead, then original ID still resolves active and ended client; no phone/name/financial projection |
| Scheduling and reporting | Existing OUT one-time scheduling and authenticated report receiver | Synthetic HTTP/browser fixtures exercise OUT boundary; this does not prove Therapists approval persistence or its live deployment |
| Monthly collection | Existing renewal journal, Payments, Charges and ledger | Ordinary versus explicit advance, month-end/leap dates, same-month cycle collision, legacy replay and recorded-period preservation |
| Financial views | Existing card, revenue and refund computations | Source receipt readback must agree with card coverage, next date and allocated revenue; no new accounting engine |
| End of treatment | Existing saveAll and secured deactivate receiver | Original referral returns ended; ambiguous shared payer refuses before any client mutation; unique request/retry preserved |
| Role separation and failed reads | Existing signed Node cookie and source scope | Real HTTP rejects forged finance scope and persisted money-task replay; failed task reads show unavailable, not zero |

New regression evidence executes the actual Apps Script source with synthetic
Google services. HTTP evidence also runs the actual Node boundary. Browser CI
runs the real UI, Node and actual source against synthetic upstreams and blocks
non-local browser network traffic. These are distinct from native Google or
live cross-application acceptance.

## Validation checkpoint

Independent workflow review found no blocker in the four bounded fixes:
17/17 actual-source deactivation tests, 9/9 conversion/handoff/privacy probes,
and 3/3 pinned actual Therapists sender/OUT receiver probes. Dashboard consumer
was checked at `3b56b1b1`, Therapists sender at `951f0894`. The new source/HTTP
acceptance and existing handoff set passed 15/15. Dependency audit reports
0 vulnerabilities (including 0 high/critical), with no dependency changes.
The full frozen-candidate suite, final financial review and mandatory browser
CI are still pending; replace this final sentence with exact counts and
commit-linked runs before calling the candidate ready.

Local Chromium launch was denied with `socket() failed: Operation not permitted`
before a page opened. No local browser pass is claimed. The existing pinned
GitHub browser runner is the execution route; browser tests must not silently
skip there. Do not keep retrying or weakening the local sandbox.

## Contracts and unresolved cross-app acceptance

- Dashboard's current handoff consumer accepts the canonical client result when
  queried by the original lead ID. An `unknown` ambiguity remains unverified;
  it must not be converted to a successful referral state.
- Therapists' current remove-patient sender checks `ok:false` before local
  patient/schedule deletion, so `ambiguous_client` stops those changes. Existing
  sender ordering resolves stop flags before the deactivation request; task 4
  must assess that partial-effect path. This OUT change does not claim to fix it.
- Therapists task 4 owns actual scheduling/cancellation/report/coordinator
  approval persistence and exactly one accounting outcome at OUT. It must reuse
  current code and report any cross-app contract finding here, not edit OUT in
  parallel.
- Vacations task 6 is separate: Coordinator draft362 / HR draft154 remain
  unreleased. Only vacations cross to HR; local blocks stay local. Its isolated
  native Google acceptance awaits explicit browser sign-in authorization after
  auto-review rejected that authentication action.

## Release gate and rollback

1. Freeze and independently review the exact candidate. Require complete suite,
   mandatory browser CI, 0 high/critical dependency findings, and no overlapping
   OUT owner. Read the current deployed branch again before release planning.
2. Obtain Sandra's explicit approval for the exact merge/release. Green checks
   do not grant it. Verify a usable backup/recovery checkpoint through the
   existing process before any financial production acceptance.
3. After approved merge, verify Railway `/api/version` is the approved merge
   SHA, health and cache v42. Then use the existing explicit Apps Script deploy
   workflow with that `expected_commit`; never create a new deployment. During
   the transition, an unsupported renewal capability must stop new renewal
   writes and instruct a refresh, not fall back to old arithmetic.
4. Authorized business acceptance checks one ordinary monthly receipt, one
   explicit advance and reload, original-referral status, and the paired
   Therapists outcome. Do not invent or alter real patient records for tests.
5. If a release must be rolled back, first identify pending FinancialOps and
   reconcile using the existing journal. Never blindly replay, delete history,
   or downgrade a pending intent to incompatible source code. Prefer the last
   compatible source; a rollback UI artifact must use a cache number above v42.

## Next action and definition of done

Finish the validation checkpoint and publish one reviewable draft. Task 2/3
development acceptance is not whole-application completion. Production release,
native runtime acceptance and the explicitly listed paired business checks stay
open until their evidence exists. Record the exact head and next action in #152
and Dashboard #331 so another chat resumes rather than repeats this work.
