# Changelog — Lead "not relevant" reason

Implementation of the spec at `docs/SPEC-lead-not-relevant-reason.md`.
When a user clicks the "לא רלוונטי" button on a lead, a small modal
now asks her to pick one of three fixed reasons before the lead is
actually moved.

## [Unreleased]

### Why this exists

The "לא רלוונטי" button previously moved a lead to the not-relevant
pile immediately, with no captured reason. That meant downstream
reporting could only count "how many" not-relevant leads, not "why" —
losing important business signal:

1. People who were never relevant to begin with.
2. Former house residents who continued as outpatients, then stopped.
3. Brand-new outpatients who started, then stopped.

These are materially different cases and should be reportable. Free
text won't do — they need to be fixed, comparable categories.

### Added (`public/index.html`)

A new modal `#notRelevantReasonModal`, matching the existing modal
pattern (`class="modal"` + `modal-card` + `modal-title`). Contains a
single required `<select name="not_relevant_reason">` with three
options + an empty default:

| Internal value         | Hebrew label                              |
|------------------------|-------------------------------------------|
| `never_relevant`       | לא היה רלוונטי מלכתחילה                    |
| `stopped_from_house`   | המשיך מאחד הבתים והפסיק                   |
| `stopped_new`          | ליד חדש שהתחיל והפסיק                       |

OK / ביטול buttons via the same `data-close` pattern other modals use.

### Changed (`public/app.js`)

1. The "לא רלוונטי" button on lead cards now calls
   `openNotRelevantReasonModal(lead)` instead of moving the lead
   immediately.
2. New helpers near `moveLead`:
   - `NOT_RELEVANT_REASON_LABELS` dictionary (mirrors
     `HOUSE_OF_ORIGIN_LABELS`).
   - `notRelevantReasonLabel(v)` — safe label lookup with empty
     fallback.
   - `openNotRelevantReasonModal(lead)` / `closeNotRelevantReasonModal()`
     — mirrors the exit-modal pattern.
3. `closeNotRelevantReasonModal()` added to the chain of close-all
   calls invoked by `data-close` buttons.
4. New submit handler on `#notRelevantReasonForm`:
   - Rejects with a toast if the user submits without picking a reason
     (the `required` HTML attribute already prevents this in browsers
     that honor it, but the JS check is a defensive belt-and-braces).
   - Captures a `prev` snapshot and reverts both `lead.stage` and
     `lead.not_relevant_reason` if `persist()` fails — same defensive
     pattern as the edit-client form.
5. The retention-card render in the שימור לידים view gains one new
   row: `retRow('סיבה', notRelevantReasonLabel(l.not_relevant_reason))`.
   `retRow` returns empty when the value is empty, so legacy
   not-relevant rows without a reason simply don't show that row.

### Changed (`apps-script/Code.gs`)

- `LEADS_HEADERS` now includes `'not_relevant_reason'`.
- `_ensureSheet` extends the existing sheet non-destructively on next
  read; no migration script required. Pre-existing rows get blank
  values.

### Not changed (intentional)

- No edit affordance to retroactively categorise existing not-relevant
  leads. Per the operator, existing not-relevant rows are throwaway
  test data; going forward every not-relevant lead is categorised at
  click time. Keeping this out of scope keeps the change small.
- Bonus computation: untouched. The not-relevant-reason field is a
  leads-side reporting category; it does not feed
  `getContinuationBonus`.
- DASHBOARD / MANAGERS: nothing changed in either repo.

### Safety

- `node -c public/app.js` returns silent (no syntax errors).
- Pure-module tests: 7/7 pass. (The pre-existing
  `sheets-secret-forwarding.test.js` hang is unrelated — same as
  every prior PR in this work-stream.)
- No new dependencies.
- Read-only with respect to clients/billing/bonus — only the Leads
  sheet gains a new column, only the not-relevant button workflow
  changes.

### Manual test checklist (for live verification after deploy)

1. Open OUTPATIENTS → לידים.
2. Click "לא רלוונטי" on an active lead.
3. The new modal appears titled "סיבת אי-רלוונטיות".
4. Click ביטול — modal closes, the lead remains in its original
   column unchanged.
5. Reopen the modal, click אישור without picking a reason — toast
   "יש לבחור סיבה", modal stays open.
6. Pick a reason, click אישור — toast "סומן כלא רלוונטי", lead
   moves into the "לא רלוונטי" pile.
7. Open שימור לידים — the new card shows a "סיבה" row with the
   Hebrew label.
8. (Optional regression) On an existing not-relevant lead with no
   reason set, the card simply doesn't show the "סיבה" row — no
   broken or blank label.
