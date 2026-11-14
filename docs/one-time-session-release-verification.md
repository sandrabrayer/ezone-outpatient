# One-time session (#181) — synthetic release verification, 2026-11-14

Pinned OUT head: `b6fa5062fdd5d046449c86c3349e3fd2caf627c0` (verified unchanged before writing).
Paired THR #146 head `3a4655eda7abc445dc9ff196794bd47d3df8c5d7`: **not verifiable here** — the
therapists repository is not reachable with this job's credentials (only ezone-outpatient,
E-Zone-Dashboard, ezone-managers, ezone-hadrachot are visible). No THR code was executed and no
THR route was mocked as a stand-in; the real OUT↔THR paired run remains a human/CI task.

Newly executed (OUT only, synthetic sandbox): full `npm test` with Chromium installed and
`EZONE_REQUIRE_BROWSER_TESTS=1`: 2345 tests, 2345 pass, 0 fail, 0 skipped (before the one
characterisation test added in this pass).

## Gap: same patient, different therapist, regular THR appointment
NOT guarded. `_otsConflict` (Code.gs) sees only OneTimeSessions rows; `_otsExternalBusy` sends only
`therapist`, `date`, `time` (+ `excludeOneTimeId`), so the THR busy answer is therapist-scoped. A patient
who already has a regular THR appointment with another therapist can be booked for an overlapping
one-time session. Pinned by the characterisation test in `test/one-time-session.test.js`.
Needs a product decision / a patient dimension in the busy contract (both repos) before broad release.
