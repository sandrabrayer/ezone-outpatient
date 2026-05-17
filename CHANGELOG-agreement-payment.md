# Changelog — Payment fields in "מתחיל טיפול" (agreement) stage

## Added
- The "מתחיל טיפול" form (agreementForm) now has, directly
  under the monthly package price:
  - Payment status (שולם במלואו / שולם חלקית / לא שולם)
  - Payment date (תאריך תשלום)

## Changed
- Saving the "מתחיל טיפול" form now:
  - stores the payment status and date on the lead
  - sets the next billing date = payment date + 30 days
    (same rule as the activate stage), so reminders and
    stop-treatment alerts trigger correctly from this step.
- Opening the form pre-fills payment status (default
  "שולם במלואו") and payment date (default today), matching
  the activate form's behaviour.

## Safety
- If status is "שולם"/"שולם חלקית" but no date is entered,
  the form blocks with a clear message (consistent with the
  activate form).
- "לא שולם" with no date is allowed and does NOT set a
  billing trigger (correct — nothing paid yet).
- No backend, schema, or data migration changes.
