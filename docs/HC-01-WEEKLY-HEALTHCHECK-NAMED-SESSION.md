# HC-01 — Weekly healthcheck named-session fix (01.11.2026)

**Source:** [Issue #150](https://github.com/sandrabrayer/ezone-outpatient/issues/150), [failed weekly healthcheck run #41243135322](https://github.com/sandrabrayer/ezone-outpatient/actions/runs/41243135322), inspected deployed source `a487a3a8` (Oct 31).

## Cause
The healthcheck continued to POST `{pin}` to `/api/verify-pin`. The deployed two-step login now treats this as **preauth** and returns `stage:'name_required'` with an unnamed, short-lived cookie. The server rightly rejects all `/api/sheets` reads for unnamed cookies (`401 name_required`). The monitor misleadingly reported seven critical data outages. `APP_PIN` belongs to the configured `SHARED_PIN_USER` (ורד).

## Scope (healthcheck only)
- Use the existing `SHARED_PIN_USER` and `APP_PIN` to request the named login; verify `stage:'named'` and **exactly one nonempty** `ezone_session` cookie before reading.
- Fail closed on preauth, missing/ambiguous base cookies or failed login; do not generate seven false failures.
- Tests simulate the real two-step contract and reject protected reads without the named cookie; no network requests outside injected mocks.
- Do not echo PIN, cookies, patient info or money data. Do not add secrets or change permissions. No source/backend/Apps Script/Sheets change.

## Release/verification
Draft only. CI and independent review on the exact head first. No manual dispatch/live healthcheck: a live check will use a real named financial user and read data; explicit Sandra approval is required to merge and schedule activation. A green mock test does **not** prove production data is healthy. Any subsequent true 401 after named login requires separate diagnosis.

## Separate unfinished Outpatient work
- Existing CRM #142–148: all draft, not live; stage G head #148 has green CI but not integrated release clearance.
- OP-03 #125/#139/#140: production-safe operational backup remains gated by source-witness review, exact writer pause, Google identity and Sandra approval. It does not yet cover new CRM Tasks/Activity in production.
- Cross-service care handoff #137/#138 + Dashboard #329/#330: identity work is draft only.
- Product audit #149 identifies genuine decisions/gaps about intro no-show/outcome, payer/contact/document/HMO statuses and verified continuation, distinct from the scoped draft CRM release.


## Reconciled release candidate (12 Nov 2026)
The HC-01 two-file fix was ported by exact-context patch onto current production source `777314c039ab1c41c149087965a7bbdfa974a538` in the **same original PR #151**. Unlike the original 1 Nov baseline, this integration preserves all subsequent finance, CRM and Apps Script improvements. It does not touch authentication policy, credentials, packages, pricing, payments, clinical data or production. CI and deployment remain distinct gates.
