# OP-BILL-01 release acceptance — 2 November 2026

The review overlay in #162 replaced the missing-receipt button from merged #161 with a label. A real Chromium regression against Express and the actual Apps Script handlers reproduced the missing button (0 found, expected 1). Preserve that existing action only when `missingCyclePayment` validates the historical cycle and there is no paid receipt. Do not offer it for an irregular anchor or a disputed already-paid period.

After explicit confirmation the historical date/coverage and client anchor remain unchanged, exactly one receipt exists after reload and a second user's read, and the confirmation is no longer offered. A recorded old-cycle receipt may still require period reconciliation; this patch does not falsely certify it as an ordinary new paid-date month.

Two browser regressions and six source transition tests were added. The transition fixture contains the verbatim deployed-base `_finIntentError` validator, with its source SHA and function hash recorded. It verifies that stored old operations remain recoverable after upgrade, while a pending new paid-date operation cannot be interpreted by the old source on downgrade. Acknowledged history stays readable.

The remaining policy TODO is now an executed source-to-card-to-revenue test: persisted renewal coverage agrees with the next collection date and the monthly revenue allocation; an explicit two-month advance remains intact. Both use the actual Apps Script save handlers with synthetic in-memory Sheets.

Only the card renderer changes at runtime in this acceptance patch. Existing #162 source policy, finance data, schema, permissions, cache v24 and release workflows are unchanged. See the release acceptance record for candidate and broader integration results; no production approval is implied.
