# Changelog — "not relevant" reason persistence fix

Fixes a silent data-loss bug introduced in bf2b54e where the
not_relevant_reason value captured in the modal never reached the
sheet because leadForSheet did not include the field in its
serialized payload.

## [Unreleased]

### Why this exists

1. bf2b54e added a not_relevant_reason column to LEADS_HEADERS and
   a modal UI to capture the reason, but the client-side leadForSheet
   helper that serializes leads for the save payload did not include
   the new field.
2. Result: persist() -> apiSave() -> _writeAll iterates LEADS_HEADERS
   and writes row[header] for each column. For not_relevant_reason
   the lookup was always undefined, coerced to '', so every save
   silently wiped the column to empty — including for rows that had
   a reason set on a prior save.
3. The UI appeared to work (modal closed, lead moved to the
   not-relevant stage) so the bug was easy to miss in casual testing.

### Changed (public/app.js)

- leadForSheet: added not_relevant_reason: l.not_relevant_reason || ''
  to the returned object, immediately before house_of_origin, so the
  value round-trips through persist() -> apiSave() -> _writeAll to
  the sheet.

### Not changed (intentional)

- No backend changes — LEADS_HEADERS already contained
  not_relevant_reason from bf2b54e.
- No UI changes — modal HTML and submit handler from bf2b54e are
  unchanged.
- No schema migration — _ensureSheet already non-destructively
  extends the header row on read.

### Safety

- Single additive change to one object literal. No existing line
  modified or removed.
- No new dependencies, no new network calls.
- Defensive coercion (|| '') matches the convention used for every
  other field in leadForSheet — undefined or null becomes ''.

### Manual test checklist (for live verification after deploy)

1. Open an active lead, click לא רלוונטי, select a reason, submit.
2. Reload the page. Open the same lead's retention card.
3. Confirm the סיבה row is rendered with the selected reason text.
4. Open the Leads sheet directly. Confirm the not_relevant_reason
   column for that row contains the selected value (e.g.
   never_relevant), not an empty cell.
5. Edit an unrelated field on a different lead and save. Reload.
   Confirm the previously-set not_relevant_reason on the first lead
   is still intact (regression check — the original bug wiped this
   on every save).
