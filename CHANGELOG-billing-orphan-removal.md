# CHANGELOG — Remove orphaned billing (גבייה) rows for deleted patients

## Summary
Added the ability to remove stray גבייה payment rows belonging to patients who
were deleted (e.g. test records). Deleting a patient now also removes their
payment rows automatically.

## Problem
The גבייה "open balances" list reads from payment records (state.payments). When
a patient was deleted, the client row was removed but their payment rows survived
in the Payments sheet, so deleted test patients kept showing in גבייה with no way
to remove them.

## Changes
- apps-script/Code.gs  (** requires Apps Script redeploy **)
  - Added _removePayment(paymentId): deletes a single Payments row by id
    (LockService-guarded, mirrors _removeCharge).
  - doPost: routed action 'removePayment' -> _removePayment.
- public/app.js
  - removePayment(id): posts the 'removePayment' action.
  - removePaymentsForClient(clientId): removes all payment rows for a client.
  - Patient permanent-delete (✕): after persist(), also calls
    removePaymentsForClient so payments don't get orphaned going forward.
  - buildBillingRow: for a row whose payment.clientId no longer matches any
    client (orphan), render a red "הסר" button (editor only) that removes that
    payment row and re-renders גבייה.

## Deploy (two-step)
1. Commit Code.gs + app.js.
2. Apps Script: paste Code.gs -> Ctrl+S -> Deploy -> Manage deployments ->
   existing deployment -> pencil -> New version -> Deploy. Keep the /exec URL.
Frontend (app.js) auto-deploys via Railway.

## Verification
- Console: includes('billing-remove').
- In גבייה (editor mode), orphan rows show "הסר"; clicking removes the row with a
  "הוסר" toast and no "_removePayment is not defined" error.

## Note
A prior paste of Code.gs corrupted the _removeCharge/_removePayment region
(dangling braces -> whole file failed to compile -> "_removePayment is not
defined"). Fixed by rewriting both functions as cleanly separated blocks;
validated with node --check.
