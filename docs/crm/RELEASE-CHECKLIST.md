# Outpatient CRM / billing — single candidate release checklist

Updated 3 November 2026. **Existing #162 is the sole combined candidate.** It reuses #142–148 and #139/#160 on deployed #158/#161. The October per-PR merge sequence and v21/v22 instructions are superseded. Do not independently merge overlapping drafts, retarget the old CRM chain for a second release, or release #157 as-is.

The [current release record](../OP-BILL-01-INTEGRATED-RELEASE-20261103.md) contains pins, source/runner hashes, executed tests, the prepared native drill and rollback boundaries. No merge/deployment is authorized.

- [ ] Final #162 head/base and general, browser, OP03 and workflow-validation CI are green.
- [ ] Committed dependencies pass audit with zero high/critical findings.
- [ ] Fresh isolated Google recovery proves the exact source, linked Tasks/Activity, journal replay and writer hold; retain native results and owner-only access evidence.
- [ ] Live source/project/binding and real-source backup/manual-tab/header gates are verified. October native results and manifest listings are insufficient.
- [ ] Real-role staging UAT passes: source save, reload, second reader, retries and negative money access. No test data in production.
- [ ] Sandra explicitly approves the exact candidate and release sequence.

After approval only: verify live SW and preserve monotonic v24 or higher; pause writers/open old clients; verify the approved Node SHA live; dispatch the existing explicit Apps Script second phase with that same full `expected_commit`; verify source/UI before reopening writes. Optional `HANDOFF_STATUS_SECRET` stays disabled until separately authorized configuration.

Tasks and Activity are created by CRM writes, never by their read actions. Typed backup includes both. No historical financial migration. Pending new-policy journals, old backups lacking CRM and re-exposure of Dana's finance are explicit rollback blockers. Preserve state and follow the reviewed recovery procedure.

Separate identity/continuation #137/#138 and the Dashboard consumer remain separately gated. This candidate does not claim their deployment or completed real-user acceptance.
