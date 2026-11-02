# Combined release candidate — assembly checkpoint, NOT integrated

Date: 2026-11-02. This isolated branch currently contains **only** OP-BILL-01 #155 source head `dbbe66658d42c512220648a602c4d54ed1ad5686` plus this manifest. Do **not** claim a combined CRM/backup candidate or release readiness.

Input refs pinned at discovery:
- last documented deployed baseline: `a487a3a8d3677358aa76fa221035d7a46d05f9a6`
- OP-03 recovery integration #139: `54e78c41f4c42940d3e395c8f84f3bc385f3c4b5`
- CRM endpoint #148: `2520d957336c53963e6c55b70489ae755bd6fc5d`
- OP-BILL-01 #155: `dbbe66658d42c512220648a602c4d54ed1ad5686`

GitHub compare confirms diverged branches. The source has common edits and cannot be assembled safely by copying whole files.

**Required integration, not yet implemented:**
1. Merge OP-03 backup/recovery code preserving all native evidence and staging policies.
2. Reconcile CRM server-side money filtering, tasks/activity, Outpatient UI, service worker v22.
3. Reconcile the billing _finPaidDateCoverage source enforcement, immutable legacy OP-02 replay and paid-through display.
4. Re-run complete tests against the actual combined commit, including money access control and backup/restore and browser tests; independently prove OP-03 live source/restore integrity.
5. Prepare live read-only reconciliation proposal and seek owner consent before reading any financial patient records.
6. Document coordinated Node/Apps Script release, exact source version, recovery/forward-fix, and obtain a separate production approval.

No production merges, deployments, workflow installation, live payments or data repair.
