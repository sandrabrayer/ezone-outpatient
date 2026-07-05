# Retarget the wa-stop "הודעת עצירת טיפול" button to Yarden

The overdue-renewals **🛑 הודעת עצירת טיפול** WhatsApp button used to open a chat
with the legacy per-patient `treatmentContactPhone` (the אחראי-טיפול contact,
removed from the product and empty for every live client — so the button was
effectively dead). It now messages **Yarden** — a single, configurable phone
number — with an instruction to stop the patient's treatment so she can cancel
the sessions in the therapists app.

**Frontend-only. `apps-script/Code.gs` was NOT changed** — the new number rides
the existing generic key/value Settings store (`_saveSettings` persists whatever
keys it is given, `_getSettings` reads them all back), so **no Apps Script
redeploy is required.** `CLIENTS_HEADERS` is untouched.

Base branch: `claude/youthful-volta-laarnk` (after PR #61).

## What changed (`public/`)

- **New setting `yardenStopPhone`.** A "טלפון ירדן (הודעות עצירת טיפול)" field was
  added to the existing ⚙️ הגדרות modal (`public/index.html`) and wired through
  the four existing settings touch-points in `public/app.js` — `state.settings`
  init, the `loadAll` mapping, `openSettingsModal` prefill, and the `settingsForm`
  submit — exactly like the bank-detail settings. It persists through the same
  `saveSettings` / `getSettings` path (no new storage).
- **`wa-stop` handler retargeted** (`handleRenewalActionClick`): it now reads
  `state.settings.yardenStopPhone`, builds the wa.me link with the existing
  `openWhatsApp` → `phoneToWa` → `normalizePhone` helpers, and — when the number
  is unset/invalid — shows the toast `לא הוגדר טלפון של ירדן — יש להגדיר בהגדרות ⚙️`
  instead of silently doing nothing. The **dead read of `c.treatmentContactPhone`
  in this flow is removed** (the column itself stays; `CLIENTS_HEADERS`
  untouched, still read/round-tripped elsewhere for cross-app matching).
- **Message reworded** (`buildStopTreatmentMsg`): from a patient-facing "payment
  not settled, don't provide treatment" note to a short instruction addressed to
  Yarden — `ירדן, יש להפסיק את הטיפול של <שם> — התשלום החודשי לא הוסדר. נא לבטל
  את המפגשים במערכת המטפלים. תודה, צוות E-ZONE איזון`. Short, Hebrew, RTL-safe;
  the patient name is interpolated.

> **Code.gs change? NO.** Settings are a generic `key`/`value` sheet; a new key
> round-trips with no backend change and no redeploy.

## Tests

`test/wa-stop-retarget.test.js` (9 cases): `yardenStopPhone` round-trips through
the key/value Settings store (mirror of `_saveSettings`/`_getSettings`); the
wa-link targets the configured number in any input format (`+972`, spaces,
dashes) via the `normalizePhone`/`phoneToWa` mirrors; the unset-number and
missing-settings cases take the toast path and open nothing; and source guards
prove the modal field is wired through all four settings touch-points, the
`wa-stop` branch reads `state.settings.yardenStopPhone` (not
`treatmentContactPhone`), and the message is the reworded Yarden instruction.

No existing test asserted the old stop-message text or the contact-phone in this
button (only a source-existence check for `buildStopTreatmentMsg`, still valid),
so no other test needed updating.

**Full suite:** `422 pass, 0 fail` (`node --test`, with dependencies installed).
The only tests that fail in a dependency-less sandbox are the two pre-existing,
environmental server-forwarding tests (`debt-status-forwarding`,
`sheets-secret-forwarding`) — unrelated to this change.

## Browser-harness verification (12 checks, all green)

Stub `/api/sheets` backend + Playwright over the real `public/` files, overdue
client on the dashboard: with no number set the button toasts
`לא הוגדר טלפון של ירדן …` and opens nothing; saving `050-123-4567` in ⚙️ הגדרות
persists via `saveSettings` and prefills on reopen; the button then opens
`https://wa.me/972501234567?text=…` with the reworded message addressed to ירדן
and naming the patient.
