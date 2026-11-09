# Plan types kept on save + therapist search / roster add — 2026-11-09

## Bug: «לא נשמרים שינויים» — the picked treatment types reverted on every save

**Symptom (production, 2026-11-09).** In עריכה, ורד picked several treatment
types (e.g. פרטני + ליווי יומי בקהילה + מעקב פסיכיאטרי, or added טיפול משלים),
saved («נשמר»), and after a refresh the card showed ONE type again.

**Root cause.** `_saveAll` ran `_deriveClientServiceType()` on every client in
every save. For any row with a `clinicalTreatmentType` (set by the therapists
app), it OVERWROTE `serviceType` with the single billing type mapped from the
clinical type. `sessionsPerWeek` kept every picked type, so the row ended up
inconsistent (e.g. `serviceType = "מעקב פסיכיאטרי"`,
`sessionsPerWeek = {"פרטני":2,"ליווי יומי בקהילה":1,"מעקב פסיכיאטרי":2}`).
Read-only check of the live sheet: **11 active clients** carried exactly this
signature; every one had a clinical type, and the clinical-derived type was
always one of the frequency keys. The rule dated from the single-type era
(«clinical is the source of truth») and became destructive once plans became
multi-type.

**Fix.**
- **Source (`apps-script/Code.gs`)** — `_saveAll` now calls
  `_fillBlankServiceType()`: the clinical type only fills a **blank**
  `serviceType`; a saved plan is never replaced. Fail-soft on an unknown
  clinical value is unchanged. The explicit cross-app `setClinicalType`
  receiver keeps its documented derive-and-overwrite behaviour.
- **Read-side recovery (`public/app.js` `recoverPlanServices`)** — for exactly
  the damaged signature (clinical type set + stored serviceType is ONE type +
  that type is a frequency key + every other key is a known plan type), the
  plan is restored from the frequency keys in their saved order. Nothing is
  written on read (read-only-boot contract holds); the next deliberate save
  stores the restored plan, and the therapists app sees it after that save.
  Rows saved during that save are stamped with the saver, like any change.

## Also found (not code — one click)

One client has a renewal journal op in state `done` since 2026-11-01 that was
never closed with «אישור וסגירה». While an op is open, every edit of that one
patient is refused («פעולה כספית פתוחה»). Closing it on the card releases the
row. No code change.

## חיפוש מטפל/ת + הוספה לרשימה

- The «מטפל/ת 1/2 — פרטני» pickers get a search box: typing filters BOTH
  pickers (quotes, dots, dashes and spaces are ignored, so «דר ילנה» finds
  «ד"ר ילנה …»); a picked name always stays visible; **Enter** places a single
  match into the first empty picker (never submits the form).
- A name missing from the roster (e.g. «אוהד לביא») shows
  «+ הוסף את «…» לרשימת המטפלים» — **full money-scope sessions only** (ורד,
  אורן; never דנה). It posts the new internal action **`addTherapistToRoster`**:
  - `OUTPATIENT_PROXY_SECRET` (both SOURCE auth maps), the proxy-decided
    `moneyScope` must be `full` (re-checked in Code.gs, fail-closed);
  - name validated (2–80 chars, letters/marks/space and `' " . - ׳ ״` only,
    whitespace collapsed) — anything else `invalid_name`, nothing written;
  - LockService; **idempotent** (exact trimmed name → `existed:true`);
  - appends ONE `TherapistRates` row with the **name only** — every rate cell
    blank, so payouts for that name keep failing closed until ורד fills the
    rate. Never renames, deletes or touches a rate; clears the 120 s rate cache.
- Names render with `textContent` only.

**Ecosystem note.** Staffing remains the roster source of truth for the
therapists app; this only adds a missing name to the outpatient picker list.
The spelling must match the therapists app exactly for payouts to match
(TherapistRates matching is exact-string).

## Tests

- `test/plan-types-save-fix.test.js` (12) — save keeps a multi-type plan;
  adding a type is stored; blank still derived; unknown clinical never blocks;
  setClinicalType still overwrites; roster add (append names-only, idempotent,
  ops/blank scope refused, invalid names refused, proxy key required); the
  read-side recovery accepts only the exact signature.
- `test/plan-types-save-browser.test.js` (3, Playwright, real server + Code.gs)
  — a damaged row opens with every type checked and saves whole twice; search
  filters, Enter picks, «אוהד לביא» is added (rates blank) and saved as
  therapist 2, and appears after reload; דנה never sees the add button.
- Drill candidate regenerated (source hash only). SW v35 → v36.
