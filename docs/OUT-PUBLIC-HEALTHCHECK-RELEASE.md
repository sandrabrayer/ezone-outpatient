# OUT public-only healthcheck — release scope

Approval: Sandra approved merge and activation of PR #197 on 2026-11-22. This document records the agreed scope; it is not proof of a live run.

- Weekly and manually dispatched monitor checks only public `GET /api/version`, `GET /healthz`, and `GET /` on the OUT HTTPS origin.
- No authentication, access to patient records, billing data, Google Sheets or secret values.
- The monitor certifies public Node availability only. It does not certify a source backup, restore integrity or clinical-finance correctness (OUT issue #124 remains separate).
- Release gates: required PR status checks must pass on the final head; merge must preserve all subsequent production changes; confirm the weekly schedule is present on the default branch and obtain one successful real public-only workflow run. If live dispatch is unavailable, the feature cannot be declared operationally accepted.
- Never bypass branch protection to merge, and do not change Apps Script deployment, credentials or patient data as part of this monitor release.
