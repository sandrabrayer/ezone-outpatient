# OP-03 operational recovery coverage — draft, 2026-10-19

## PR132 integration — 2026-10-26 (draft)

- Integrate base336c8ef9 into PR125; preserve preferred-house business logic,
  public assets/SW19, server and dependency ranges exactly as that base.
- Add the post-lock recovery-hold check to `_setPreferredHouse` before
  `_ensureSheet`, so queued requests cannot extend headers or change cells.
  The new queued-request regression failed before the fix (write succeeded).
- Eight new regressions cover admission/queued/busy refusal, nonempty preferred
  house across all four appended schemas and refusal of each old-width schema
  at preflight/finish, retaining the hold without inventing missing cells.
- Regenerate the unbound drill. Its fixture sets a preferred house through the
  real writer; verification checks restored value and refusal while held.
  Source/helper/definition hashes change. Native evidence below remains valid
  only for09a00ab5; the combined harness has not run in Google yet.
- Keep exact schema validation and the blank manual-policy pin. Require a fresh
  verified v2 set with all current headers before certifying recovery; deployment
  alone or the first subsequent night does not establish this condition.
- This implements stage4 (backup/recovery) of the canonical ten-app program.
  CRM, financial controls, remaining write integrity and performance remain
  explicit return points. No new feature, live write or production release.
- Local UTC full suite: 1,754 pass / 0 fail / 38 skipped (1,792 total).
  Fresh npm audit: 0 vulnerabilities. CI browser execution and exact-head
  independent review are recorded separately in PR125.

## Native Google acceptance evidence — 2026-10-26 (historical candidate)

All five phases passed on candidate 09a00ab5, using a new standalone project
and three private synthetic workbooks. The entire saved harness matched the
reviewed build. Google execution durations: 24.263/42.091/34.744/48.542/61.297s.
Retain [raw evidence and limits](docs/evidence/op03-google-drill-2026-10-26.md).
This follow-up changes documentation only; the runtime, unbound generated
harness, blank approval pin, public assets and dependencies remain unchanged.
Claude's bounded evidence review of9f204b22 found no blocker; follow-up clarifies
native retry age versus local June2031 coverage and redacts owner email addresses.
The successful manual-policy path/repeated proof, real evidence packet,
configuration/scheduled evidence and separate production approval remain open.
Earlier dated entries below describe their status at that time.

## Disabled manual-tab policy verifier — 2026-10-25

- Implement the revised evidence contract after Claude's bounded design review
  at e9a26111 (PR comment6401543025). Review was static and ran no tests.
- Require a valid nonempty reviewed in-code pin, canonical fixed-field typed
  fingerprint, exact source/backup/day/target/manifest/metadata/tab set and
  explicit contemporaneous out-of-band evidence. Ship the pin empty.
- Preserve typed unknown grids separately from known schemas; reject formulas,
  allocated-size changes and nonempty structural tabs. Repeat proof immediately
  before hold release, preserving real journal/cache/config checks.
- No version-2 metadata migration, scopes, property configuration or HTTP route.
  Target creation/permissions and native properties remain operator evidence;
  code cannot prove their provenance. See docs/manual-tab-recovery-policy.md.
- Update compatible lockfile patches for the Oct22 body-parser high-severity
  advisory GHSA-27r3-jxmh-p828, discovered by a fresh audit. No package.json range
  or application route change. Tests/audit results are recorded on the exact PR
  commit, not inherited from the Oct20 results below.
- Real evidence packet, reviewed per-recovery pin, native Google drill and
  separate production approval remain open. No production change.
- Local UTC full suite: 1,713 pass / 0 fail / 38 skipped (1,751 total), including
  44 new manual-policy regressions. Fresh npm audit: 0 vulnerabilities after
  Express 4.22.1 → 4.22.3, body-parser 1.20.8 → 1.20.9 and qs → 6.16.1.
  CI/browser results and implementation review are separate exact-head evidence.
- Claude's bounded static implementation review of f6eddada found no blocker
  (comment6401651506); it read code, but not test bodies, policy docs or generated
  helpers. Follow-up explicitly refuses a policy when no unknown tabs exist,
  adds native-copy/sheet-ID/count/interval/bounds/late-marker failure cases, and
  documents retained markers, operator classification and native timing limits.
  Follow-up full UTC suite: 1,723 pass / 0 fail / 38 skipped (1,761 total),
  including 54 new manual-policy regressions across both commits. Final-head
  CI and any follow-up review are recorded separately in PR125.

## Current-base integration and isolated drill preparation — 2026-10-20 evening

- Integrate base 8b68cd75 (#127/#128/#129), retaining its sign-in, calculator,
  favicons and SW18 byte-for-byte. Resolve only two documentation conflicts.
- Add reproducible helper-hashed Google drill generation and five separate
  phases using newly created synthetic source/backup/target workbooks.
- Keep project/phase/hash guards, scoped fixture properties, failure evidence,
  both journal kinds, cancellation/payroll identity, custom rate, approved quote
  and native typed readback in the acceptance contract. Unknown tabs still block.
- Thirteen local service-double tests pass after review. These are not Google execution evidence.
  Include the base's calculator browser test in the existing CI browser job.
- No source runtime logic changed after 29195b24. Access to an isolated Google
  runtime, the manual-tab plan and production approval remain open.

- Adds SessionLog, TherapistRates, Settings and six workflow/audit tables to the
  locked backup set, preserving their own schemas and optional absence.
- Captures unknown tabs as values with explicit inventory; requires a reviewed
  plan before operationally certifying them. Keeps legacy manifests inspectable.
- Adds versioned recovery metadata, strict complete-set verification, expanded
  retention and compact snapshot grids. No credentials are backed up.
- Adds editor-only recovery hold/preflight/release checks; queued cooperating
  writers recheck the hold under their lock. Settings writes now share the lock.
- Real-source recovery regressions cover duplicate credit prevention, payroll
  forwarding stamps and custom rates, alongside existing mixed journal tests.
- No business calculations, public assets, catalog ownership or production data
  changed. Google round-trip, manual-tab plan, independent review and production
  approval remain open. See [the runbook](docs/operational-recovery.md).

## Integration with released packages — 2026-10-20

- Integrates deployed f7b37d7 (#122/#126) into the existing draft, preserving
  current pricing access and SW 15 with no new public-asset change.
- Retains both package datasets and checks recovery hold after _pkgLock acquires.
- Adds real seeded/approved package restore/retry and queued-writer regressions.
- Records read-only manual-tab inventory and a proposed archive treatment;
  unknown-tab gate remains closed pending review. No production writes.

## Limited review follow-up — 2026-10-20

- Clarifies that missing required operational state is inspection-only, registry
  evolution needs a reviewed migration path, and configuration remains an
  operator attestation without persistent who/when evidence.
- Adds nine real-source failure/order/inventory regressions after Claude's
  limited static review of 917bae83. No runtime code changed in this follow-up.
- Review does not cover writer locks/journal internals or replace the Google drill.

## Backup/recovery coordination — 2026-10-20

- Reproduced the second Claude review's overlap: a pre-hold job could still write
  source inventory/sentinels after capture. A whole-run ScriptLock-protected
  marker now blocks recovery completion until all backup writes finish.
- New jobs cannot enter during a hold or another job. Begin reports draining;
  finish refuses while active. No long script lock spans snapshot/network work.
- Adds five overlap/concurrency/failure/abandoned-marker tests; removing the
  finish guard makes both overlap regressions fail. Full UTC after two observability regressions: 1640/0/37.
- Documents verified operator cleanup for uncatchable termination, plus remaining
  hold-age alert, manual-tab retirement and remnant-monitoring follow-ups.

- Final review follow-up: admission lock timeout alerts through the existing path;
  completion lock timeout logs a stranded-marker diagnosis, with two regressions.

## Drill review follow-up — 2026-10-20

Claude statically reviewed head545cb134 (comment6296064861), without tests or
reading the complete generated helper closure. No blocker in that limited scope.
The follow-up clarifies artifact verification and per-repo ID denial, refuses
pre-existing project property names without reading values, records phase
duration, and preserves the original error if evidence writing also fails.
Six additional regressions cover interruption, duplicate IDs, backup/target
rename, property isolation and verification under a June2031 clock. Full UTC:
1669 pass,0 fail,38 skipped (1707 total). No source runtime logic changed.
