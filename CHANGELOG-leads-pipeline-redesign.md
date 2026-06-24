[CHANGELOG-leads-pipeline-redesign.md](https://github.com/user-attachments/files/29290889/CHANGELOG-leads-pipeline-redesign.md)
# CHANGELOG — לידים pipeline redesign (3 stages + auto-convert)

## Summary
Restructured the לידים board from 4 columns to 3, and made lead->patient
conversion remove the lead entirely (no more duplication across לידים and
מטופלים).

## Problem
- A converted lead stayed on the board parked at an `active` stage, so the same
  person appeared both as a lead (לידים) and as a client (מטופלים).
- The board carried redundant columns (מטופל פעיל, מתחיל טיפול).

## New pipeline (3 columns)
1. פרטים אישיים  (was `new` / ליד חדש)
2. שיחת היכרות   (`intro`, unchanged)
3. תוכנית טיפול  (was `agreement` / מתחיל טיפול) — terminal lead stage

From תוכנית טיפול, "הפוך למטופל פעיל" opens the activate modal: fill plan + take
first payment -> a client record is created (carrying lead data via fromLead) ->
the lead is removed. Client record is the source of truth post-conversion.

## Changes (public/app.js)
- STAGES: removed `active`; renamed `new`->פרטים אישיים, `agreement`->תוכנית טיפול.
- Progression buttons: dropped the active-stage branch; added an explicit
  "← הפוך למטופל פעיל" button on the terminal (agreement) column that calls
  openActivateModal.
- Conversion (activate submit): replaced `lead.stage = 'active'` (+ field copies)
  with removal of the lead from state.leads (persist() rewrites the sheet).
- loadAll(): one-time cleanupConvertedLeads() — on load, removes any lead that
  already has a matching client (linked by fromLead) and persists the trimmed
  list. This cleared the ~16 pre-existing stranded leads.

## Note: finished patients
Confirmed already working: a client with status 'סיים טיפול' is filtered out of
מטופלים and shown in שימור לידים. No change needed.

## Deploy
Frontend only. Railway auto-deploys. No Apps Script redeploy.

## Verification
- Console: includes('cleanupConvertedLeads') and includes('הפוך למטופל פעיל').
- לידים shows 3 columns; converting a lead removes it and creates the patient;
  no duplicates remain.
