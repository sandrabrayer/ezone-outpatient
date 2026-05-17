# Changelog — Treatment plan in patient edit form

## Added
- The "ערוך פרטי טיפול" (edit patient) modal now includes a
  **Treatment plan** section:
  - Treatment types (multi-select checkboxes)
  - Sessions per week for each selected treatment
- These were previously only set during lead activation, forcing
  staff to record them manually in the notes field for patients
  who were already active.

## Changed
- Saving the edit form now also:
  - saves the selected treatment types + sessions/week
  - recalculates the next billing date (payment date + 30 days),
    consistent with the lead-activation flow, so reminders/alerts
    stay correct.

## Safety
- If no treatment type is selected, the existing plan is kept
  (no accidental wipe).
- If no payment date is set, the next billing date is left
  unchanged.
- On save error, all fields roll back to previous values.
- No backend, schema, or data migration changes.
