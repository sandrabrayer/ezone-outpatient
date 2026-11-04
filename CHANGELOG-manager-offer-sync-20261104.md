# OUT → Therapists package-request status bridge (4 Nov 2026)

## Proven production issue
Outpatient #163 added stages `sent`, `awaiting_decision`, `approved`, `rejected`, `expired` to the existing `PackageRequests` workflow. The deployed `_pkgStatusItem` and `_pkgSubmitView` still return `priced` only for literal source status `priced`, otherwise `pending`. A manager who opens a previously sent/approved/rejected request in Therapists sees the false status "waiting for pricing"; this is a data-contract mismatch, not a database synchronization outage.

## Changes / no changes
- Use the new isolated `_pkgManagerStatusView` source allowlist (without shadowing the existing `_pkgManagerStatus` action handler) to translate legacy `pending → pending`, `priced → priced`, new `ready_to_send → priced`, and keep the remaining five documented CRM milestones as-is.
- Both request read and exact request-id retry use this safe projection. The shared-secret manager feed stays requester-scoped and allowlisted: only the existing fields `requestId,status,packageKey,months,createdAt`; no amount, notes, phone, price, clinical data or client write.
- No new schema, no writes, no changes to billing or the main CRM engine.
- Synthetic test pins each status and verifies no duplicate requests, immutable request ID, and no money/PII.

## Release order (requires separate Sandra approval)
1. Deploy matching Therapists UI/proxy update (accept new price-free status keys) **first** so it can understand both legacy and new replies.
2. Deploy this Outpatient source read-only bridge with the existing Apps Script deployment mechanism, after exact-head CI and source backup/recovery validation.
3. Confirm one legitimate request in authorized sessions after refresh; don't create a fictitious patient/offer just to test. If no such case, leave business acceptance pending.

No production changes performed in this draft. Keep central E-ZONE One #331 and OUT #152 updated, no separate CRM/task store.
