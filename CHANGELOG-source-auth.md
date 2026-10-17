# OP-01 — source authentication candidate, 2026-10-16

The signed browser session did not protect direct Apps Script access to internal
actions, and three consumer reads were open when their keys were absent. A
central method/action policy now rejects requests before business/source access,
using a dedicated server credential for internal operations and the existing
scoped consumer keys. GET saves and malformed JSON are rejected.

Node injects the server-owned credential, preserves signed-session identity,
fails closed on missing configuration and suppresses credential-bearing upstream
errors. The source deploy workflow waits for the matching, ready Node deployment
to avoid tightening the source before its caller is updated.

No production deployment or credential inspection has occurred. Baseline:
`afa9e8c0d4e3e04a9eabd7230db59a27030dee67`. No schema, financial calculation,
role list, frontend asset/cache version or dependency change. Existing test
fixtures now authenticate successful source calls; the obsolete open-source
expectations are replaced with explicit rejection assertions.

Local validation: 1,274 tests, 1,265 passed, 0 failed, 9 browser skips
(`TZ=UTC node --test --test-concurrency=1`). The 140 new cases comprise 132
source/deployment-boundary tests and eight HTTP-proxy cases. Dependency audit:
0 critical, 0 high, one pre-existing moderate issue; dependencies unchanged.
CI and browser results are recorded in the PR when available. The new tests
execute the real source routers and the HTTP session proxy with synthetic Google
services; no production rows are read/written. Native Google runtime and live
consumer acceptance remain release checks, not claimed from local tests.

See [source-auth-boundary.md](docs/source-auth-boundary.md) for the complete
caller/action inventory, configuration steps, rollout/rollback, and open tasks.
The pre-existing `recordTreatmentGiven` sender/receiver mismatch is tracked in
OP-06; it is not repaired by changing billing behavior in this security patch.
