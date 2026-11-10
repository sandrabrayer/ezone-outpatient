# Apps Script release gate — ignore paste whitespace around the SHA — 2026-11-10

**Why.** Releasing PR #177, two "Deploy Apps Script" runs (#39, #40) failed in
the first step with «Expected a full approved commit SHA» although the right
SHA was entered: the copied value carried leading spaces (list indentation).
Nothing was deployed — the gate failed closed as designed — but the release
needed a third run.

**Change (`scripts/wait-for-source-proxy.js`).** `deploymentTarget` strips
leading/trailing spaces, tabs and line breaks from `EXPECTED_COMMIT` before
validating. Nothing else is normalised: the value must still be exactly 40
lowercase hex characters and still equal the checked-out `GITHUB_SHA`. The
error now says what is expected.

**Tests (`test/source-deploy-gate.test.js`).** Padded values (leading spaces,
trailing space/newline, tab + CRLF) are accepted and return the bare SHA; an
embedded space, an invisible RTL mark, uppercase and 41 characters are still
rejected. The previous "padded SHA is rejected" case is replaced by these.

**Release.** The workflow file is unchanged; this only touches the gate
script. Per CLAUDE.md a gate change is followed by a normal Apps Script
dispatch (no `Code.gs` change — it republishes the same source).
