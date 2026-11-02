# OP-03 — Google Apps Script read-only source witness

2026-10-31. Draft-only tooling stacked on integrated backup candidate PR #139.

- Adds fixed-ID, fixed-endpoint Apps Script HEAD source witness in ops/, outputting only hashes, sizes and match flags.
- Checks both project and parent IDs, original two-file inventory, pinned hashes and project updateTime stability.
- Rejects unrecognized clasp credentials, unexpected source, missing scope, redirects, non-allowlisted requests and unauthorized workflow context.
- Synthetic-only unit tests; manual security runbook and a NON-EXECUTABLE workflow sketch. No credentialed PR CI.
- Does not change Apps Script sources, original OP-03 helper, historical recovery evidence, release workflow, production data or configurations.
- No live source read or helper installation has been executed. PR #139 and original PR #125 are not merged/deployed by this candidate.
