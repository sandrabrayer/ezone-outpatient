# איש קשר של ליד — the caller's details on a lead (2026-11-21)

Sandra, 21/11/2026: «תוסיף אפשרות לאיש קשר». The Dashboard CRM's «פרטי הפונה», for this app's leads:
the person who called is often not the patient (a parent, a partner, a social worker).

## What Vered / Dana get

- **Lead form** — a new optional section «פרטי הפונה / איש קשר (לא חובה)» between «פרטי המטופל» and
  «פרטים נוספים»: **שם איש הקשר**, **טלפון איש הקשר**, **קשר למטופל** (the Dashboard's list: מטופל /
  אמא / אבא / אח/אחות / בן/בת / בן/בת זוג / סבא/סבתא / קרוב משפחה / חבר/חברה / עו"ס / אחר — «אחר»
  opens a free-text field that must then be filled). Nothing here is required. A typed phone must be
  a valid Israeli number (mobile or landline).
- **Lead card** and **«שימור לידים» card** — one line: «איש קשר: רונית (אמא) · 0525264094».
- **«תיעוד שיחה» on a lead** — a line with the patient's phone and the contact person, and «עם מי»
  starts with the contact person's name (editable).
- **Lead → patient** (activation, and a patient opened from a lead for a one-time session): the
  line «איש קשר: …» is written into the patient's «הערות», because the lead row leaves the Leads
  sheet at that moment.

## Data

- `Leads` sheet: three columns **appended at the end** — `contactName`, `contactPhone`,
  `contactRelation` (22 columns). `_ensureSheet` writes the three header cells on the first save
  after the Apps Script release; old rows read back blank. No other sheet changes.
- `contactPhone` is a `PHONE_COLUMNS` member (text-forced, leading zero kept and recovered).
  It is **never a patient match key**: `CROSS_APP_PHONE_SOURCES` is untouched and it is never
  copied into the patient's `treatmentContactPhone` (that one identifies the patient across apps).
- The source validates every write (`LEAD_CONTACT_COLUMNS`, `_leadContactValue`): name ≤ 80,
  relation ≤ 40, control characters stripped; a phone that is not `0` + 8–9 digits after recovery is
  stored blank — an invalid phone is never written.
- **Old tabs are safe:** a tab loaded before this release sends leads without the three keys; the
  source then keeps the sheet's values instead of blanking them (the same rule as
  `complementaryType`). The new browser always sends the keys, so clearing a field works.
- A change to the contact person alone is a real edit: the lead is stamped (`updatedAt` /
  `updatedBy`) and takes part in the stale-save conflict check like any other column.

## Limits (deliberate)

- **A removed lead («הסר») does not archive its contact person.** The «לידים שהוסרו» header is the
  subject of the pending OP-03 operator correction (`ops/removed-leads-header-correction.gs`, exact
  cells S1:U1, schema-bound); its width was not moved under that procedure.
- **Name and phone of the patient stay required** on a lead (the Dashboard made them optional on
  20/11/2026). Here the patient's phone is the cross-app match key and the duplicate check — a
  separate decision.
- The Dashboard's «טלפון לגבייה ועדכונים» (billing phone = patient / caller / other) is not added.
- `createLead` (the Dashboard → Outpatient handoff) does not carry the Dashboard lead's contact
  person yet; such a lead arrives with the three fields blank and can be filled in «עריכת ליד».
- No patient-card field: on a patient the contact person lives in «הערות» only.

## Deploy note

Node first, then «Deploy Apps Script» (CLAUDE.md rule 4). **Between the two, a contact person typed
in the new form is not stored** — the old script has no such columns and ignores the keys; nothing
else about the save is affected. Dispatch the Apps Script run right after `/api/version` shows the
merge SHA, and re-enter anything typed in that window.

## Files

`apps-script/Code.gs` (`LEADS_HEADERS`, `PHONE_COLUMNS`, `LEAD_CONTACT_COLUMNS`, `_leadContactValue`,
`_saveAll`), `public/index.html`, `public/app.js`, `docs/USER-GUIDE.he.md`,
`EZONE-ECOSYSTEM-STATUS.md`, `test-support/google-operational-drill-candidate.gs` (regenerated),
`test-support/financial-ui-fixture.cjs`. SW cache: the v42 bump of this release covers it.

## Tests

- `test/lead-contact-person.test.js` (new, 6): schema (Leads only, archive and Clients untouched,
  match keys untouched), validation, the old-tab rule, stamping, removal, wiring pins.
- `test/crm-activity-browser.test.js` (+1, real Chromium): a new lead with a contact person —
  invalid phone and unexplained «אחר» refused before anything is sent, saved row, the card line and
  the call form, stored `<i>` never becomes markup.
- Sanctioned header-pin updates (Leads grew 19 → 22): `create-lead`, `lead-assignee`,
  `operational-recovery`, `preferred-house`, `session-who-when`.

## Security

No new route, action, secret or role. Input validated at the source boundary on every write;
output escaped (`escapeHtml`) or written with `textContent`. The contact phone is personal data of a
third party: it is stored only on the lead row and in the patient's notes, shown only inside the
session-gated app, and never sent to another app. `npm audit`: 0 vulnerabilities.

## Rollback

Revert the commit. The three sheet columns stay (append-only) and are ignored by the older code;
the header cells remain until someone clears them by hand (harmless).
