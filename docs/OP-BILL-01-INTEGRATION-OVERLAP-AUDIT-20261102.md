# OP-BILL-01 — Verified branch overlap audit (2026-11-02)

## Source refs
- Deployed baseline (last documented, not independently verified live today): `a487a3a8d3677358aa76fa221035d7a46d05f9a6`
- OP-03 integrated backup draft #139: `54e78c41f4c42940d3e395c8f84f3bc385f3c4b5`
- CRM endpoint #148: `2520d957336c53963e6c55b70489ae755bd6fc5d`
- OP-BILL-01 #155: `dbbe66658d42c512220648a602c4d54ed1ad5686`

GitHub compare confirms all three heads descend from the same baseline. Backup ↔ CRM and CRM ↔ billing are **diverged**. No combined tree, merged code, or combined CI exists from this audit.

## Conflicting ownership / attention required
| Area | OP-03 | CRM | Billing | Integration instruction |
|---|---|---|---|---|
| `apps-script/Code.gs` | backup/recovery | Tasks/Activity and money scope | source paid-date journal/write guards | merge functionality at function and authorization boundaries, not file-level last-writer wins |
| `public/app.js` | no branch-level diff against baseline | user access/UI/Today | payment card, renewal, billing editor | preserve both new work queues and financial source-driven state; enforce Dana no-money |
| `.github/workflows/test.yml` | modified | modified | unchanged from baseline | retain full OP-03 and CRM browser suites |
| `test/nightly-backup-data.test.js` | modified | unchanged | modified | preserve both restore integrity and billing regressions |
| `CHANGELOG.md`, `DEPLOY.md`, README / ecosystem docs | modified | modified | generally unchanged | retain release and rollback instructions |
| Service worker / manifest | unchanged by OP-03 | v22 bump in CRM chain | no independent bump | verify final cache version against actual deployed version and correct assets |

### Verified specific source seam
At baseline and OP-03 #139, `_finIntentError` requires `patch.nextBillingDate === _finNext(c,intent.cycleDate)` (due-cycle anchor). In billing #155, new intent guards instead require the **actual payment date** coverage via `_finPaidDateCoverage`, with legacy replay only for stored intents. CRM #148 also adds separate task functions to Code.gs. The integrated file MUST carry both changes and no newly accepted legacy renewal reserve.

## Acceptance before moving from DRAFT
1. Produce a real integrated commit on an isolated branch; do not overwrite existing source branches.
2. Prove exact deployed base/source and current data backup integrity first. For a production deployment, require restore dry-run evidence on isolated copies and explicit authorization.
3. On integrated head, run all OP-03, CRM money scope, billing, journal, revenue/refund and real-browser suites; attach per-job CI links and test counts. Test monetary UI for Vered and money denied for Dana, including direct manipulated requests and cached stale reads.
4. Check payment-date policy with one-month, explicit advance, partial/unpaid, past arrears, duplicate retry, 31st of month and leap-year dates. Confirm no silent history migration.
5. Confirm staged Node/Apps Script compatibility and service worker cache version, smoke and forward-fix plan.
6. Obtain separate Sandra approval before merge/deploy/live financial access or changes.

**This document is an integration audit, not an implementation or release approval.**
