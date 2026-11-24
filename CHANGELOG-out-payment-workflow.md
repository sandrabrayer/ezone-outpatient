# OUT monthly coverage and workflow integrity — 2026-11-20 candidate

This is the existing OUT implementation on deployed-base `3e393011`, continued
for Sandra's tasks 2 and 3. It does not replace the ledger or import the obsolete
open PR stack. Task 4 remains a separate Therapists acceptance workstream.

## Monthly coverage

A new ordinary fully-paid monthly receipt uses its actual payment date as the
coverage start, one calendar month with end-of-month clamping, and the next day
as the next collection date. A deliberately selected advance has explicit
coverage dates. The renewal form shows the selected period before saving.
New cycles use the exact due date in their payment ID, preventing two distinct
cycles in the same calendar month from overwriting each other. Existing row
IDs and explicit recorded coverage remain authoritative; this is not a history
repair or an inference that an early payment was an advance.

The existing source-owned financial journal remains the only renewal mechanism.
The source advertises the explicit-intent capability; new unversioned intents
are refused. Stored legacy intents keep their original replay representation
and arithmetic. Partial/unpaid and previously recorded periods are preserved.

## Workflow integrity

- `saveAll` refuses a new second client for an already-converted lead under the
  existing lock, before journal/tombstone/row writes. The original referral link
  persists across saves. The UI reads back the winning conversion and stops the
  dependent payment instead of displaying a second successful admission.
- `getHandoffStatus` resolves the original lead ID through the saved client's
  `fromLead` even after the lead row was removed. Historical ambiguous conversions
  yield `unknown`, never an arbitrarily selected patient's status.
- `createTask` rechecks visibility of the persisted idempotent replay target.
  An operational user cannot fetch a financial task using a harmless new payload
  with the same submission ID.
- `deactivateClient` refuses ambiguous shared payer/contact phones before status
  writes. Unique legacy phone calls and exact retries retain their contract.

No source headers or credentials changed. Service worker v42 follows verified
live v41. See `docs/OUT-PAYMENT-WORKFLOW-ACCEPTANCE-20261120.md` for evidence,
cross-app limits, release gates and rollback.
