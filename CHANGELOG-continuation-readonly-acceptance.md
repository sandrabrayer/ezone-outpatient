# Continuation read-only acceptance fixes — 2026-11-08

Base: deployed `5f6225f5c85cc3ed17db2a31e3339fa868a74cab` (PR #174).

## Problem and behavior

Today renders Tasks before the admitted roster arrives. The roster completion
only re-rendered the continuation tab, leaving Today with `—` names. Clicking
one of those rows put `—` into the continuation name search and displayed an
empty list even though the patient was present.

Roster completion now re-renders Today if it is the active screen. The direct
action focuses the continuation card using the task's existing `cont:<ref>`
subject, or the existing workflow key for a legacy meeting row. It does not
identify a person by their displayed name. Navigation before roster completion
waits for the same read and then shows the matching card. If the subject is no
longer present, a clear warning replaces the misleading empty-list message.
The user can return to all admitted patients or type a normal name search.

The milestone strip also distinguishes a valid admission date without a usable
phone/identifier from a missing admission date. No identity, dates, task or
workflow data is repaired or rewritten.

## Validation and release boundary

Four browser regression cases in `test/read-only-boot-browser.test.js` exercise
the real browser, Node server and Apps Script handlers against synthetic,
in-memory data. They check delayed reads, an early click, same-name neighbours,
an absent subject, missing identifiers, missing dates and identifier-only rows.
Each verifies no source write and identical source sheets/properties.

Executed locally: **2,250 passed, 0 failed, 0 skipped**, including the synthetic
browser cases (Node 24, Chromium 153; test-only browser tooling outside the app).
The focused continuation/read-only run passed 13/13. All four new cases failed
against the unchanged deployed `app.js` (negative control), then passed with the
candidate. Exact-subject navigation also passes at 360px with no horizontal
overflow. `npm audit`: 0 vulnerabilities. Native production writes were not run.

The existing two continuation/read-only browser files are added to the existing
browser CI job, where a missing browser is an error. No new workflow or agent.

Frontend-only release, SW v34 (live v33 independently read on 2026-11-08).
Sandra's explicit merge/deploy approval remains required. No Apps Script phase
is needed. After release, verify the deployed commit and repeat read-only Today
→ continuation navigation. Rollback: revert the merge; no data rollback.

PR #137 / Dashboard #329/#330 exact-origin referral deduplication remains
separate and unresolved. This change does not claim full cross-app acceptance.
