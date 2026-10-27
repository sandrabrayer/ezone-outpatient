# OP-03 operational recovery coverage — draft, 2026-10-19

## Integrate the existing PR133 base — 2026-10-27 (draft only)

A single state-only close/reopen refreshed PR125's previously exposed base 336
to b14db799, the PR133 merge from October26. The head, title and body were
preserved and the PR returned to open/draft/unmerged. The actual newer base
has two documentation conflicts; resolve them while retaining both current
OP-03 history and the merged roster/security change. Preserve PR133's Node
runtime, public assets/SW20 and tests exactly. Do not repeat the already merged
PR133 release or claim its live runtime/configuration was reverified here.

Apps Script, test-support tooling, workflows and dependency files remain
identical to dc09d5d3; frozen native evidence is unchanged. One full local UTC
integration run on Node 24.22.1 passes 1,787/fails 0/skips 38 of 1,825 tests. Current
remote CI and the bounded integration review are recorded against the actual
published head in PR125; older results retain their original attribution.
No live data/header correction, Google phase, deployment or production merge.

## Real-source readiness observation — 2026-10-27 (read-only)

Record the current source and nightly-snapshot header comparison: three of the
four PR132-affected prefixes match; the removed-leads archive retains18 of21
headers and lacks updatedAt/updatedBy/preferredHouse. Formula-aware reads found
its proposed three-column tail empty. Prepare a guarded three-header correction
proposal without changing production. Today's nightly manifest still covers
the old ten datasets, not the complete v2 recovery contract. Correct the main
runbook's stale native-acceptance status and retain a bounded current-head CI
event-recovery plan. See the
[readiness evidence and exact proposal](docs/evidence/op03-release-readiness-2026-10-27.md).
No implementation, test fixture, production value, workflow or deployment changed.

## Separate synthetic policy acceptance — 2026-10-27 (all four native phases passed)

Complete an extension in the existing isolated test project, preserving the
completed five-phase code, state, reports and workbooks. Its own namespaces and
fixed project/baseline identity guard new backup, native-copy and empty-target
artifacts. Original source access is read-only. A separate verifier binds a
synthetic policy to retained native packets, observed owner-only permissions
and exact committed evidence bytes; the production approval pin stays blank.

Native Sheets API observations include cell formatting and row/column metadata;
source/copy/target comparisons and a final native comparison before hold release
prevent a successful copy alone from being treated as preservation evidence.
The real finish function remains verbatim, with wrappers measuring its two
internal proofs, native verification, cache/property order and lock timing.
Missing service access, inconsistent evidence or phase failure refuse progress
without resetting or automatically retrying. See
[the separate policy-drill procedure](docs/google-manual-policy-drill.md).

Follow-up to Claude's bounded static review of 136ec453 binds the committed
evidence narrative to a unique generated machine-readable block containing the
actual state, packet, inventory, permission and manifest/metadata digests. Three
permission checkpoints bind stable file/owner identities and creation times to
the preparation, capture, restore and verifier chronology. Native-copy creation
must fall inside the observed capture interval. A fixed four-minute cooperative
budget is checked around expensive work, proof completion and immediately before
hold deletion. A deadline refusal before hold removal preserves the hold and
best-effort diagnostics. An in-flight Google call or hard execution termination
cannot be interrupted; a failure after successful finish can leave the hold
already cleared, so diagnostics record its actual value. The retained fixture
has 13 sheets and 26,748 allocated cells,
so the 100,000-cell bound is unchanged.

After Sandra's explicit action-time approval of the displayed terms, Google
Sheets API v4 was activated in the same project. The saved manifest retained
the sole existing Sheets scope, V8 and timezone. Original code/state and all
five earlier results stayed unchanged. The new saved setup matched its complete
78,920-byte local build before execution. Prepare, capture and restore each
passed once, with Google durations 9.226/123.653/106.596s. Three chronological
Drive observations confirmed owner-only files. Full native comparisons matched
the original source, fresh native copy and restored target. The exact packets,
states, external proof and generated binding are retained in the
[frozen evidence record](docs/evidence/op03-manual-tabs-2026-10-27.md).
That record remains frozen at its pre-verifier checkpoint. After publication
and independent review, the separately built fixed verifier passed once in
104.427s. A changed policy was refused; both valid finish proofs passed. Their
core durations were 10,296ms and 6,064ms, with a further 29,128ms native comparison
inside the second proof before it returned. The valid script lock was held for
46,104ms; the full finish took 46,347ms. The fixture hold was removed last, and
the final state is `verified`, `running:false`, with no failure flag. Nine Google
executions are Completed: the original five and the new four, with no repeated
phase. Supplementary owner-only observations before and after final verification,
the final packet/state/report and timing limits are retained in the separate
[result addendum](docs/evidence/op03-manual-tabs-2026-10-27-result.md).
This evidence does not approve the production pin, real archive recovery or
production-scale timing.

Validation after review hardening: 25 dedicated service-double regressions
passed. The full UTC suite on Node 24.22.1 passed 1,779 tests, failed 0 and skipped
38 (1,817 total). The fresh dependency audit reported 0 vulnerabilities; its
lockfile is unchanged. Independent local static review found no
remaining concrete blocker in its inspected scope after the noted hardening.
CI/browser and Claude review outcomes are recorded separately on the final
draft commit; none of these local checks is a new Google execution.

## Integrated native Google acceptance — 2026-10-27

All five phases passed on candidate 3297311c in the already prepared isolated
project, after exact code/consent inspection and fresh zero-execution/state
checks. Preferred-house preservation and held-writer refusal passed alongside
the financial/session retry and manual-tab refusal checks. The three new
synthetic workbooks were owner-only before capture and after completion.
Google durations were 35.615/55.475/39.284/45.727/81.587s. Retain
[the report, raw evidence and exact return point](docs/evidence/op03-google-drill-2026-10-27.md).
No old phase or project was repeated/reset, no production data/code changed and
no merge/deploy occurred. At this five-phase checkpoint, approved manual-policy
native success and its double proof were still open; the separate synthetic
extension above later completed them. Real recovery evidence and separate
production approval remain open.

## PR132 integration — 2026-10-26 (draft)

- Integrate base 336c8ef9 into PR125; preserve preferred-house business logic,
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
  only for09a00ab5; the combined harness had not run in Google at that checkpoint.
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
