# One-time psychiatric services + one-time booking for a lead — 2026-11-16

Branch `claude/one-time-psychiatric-20261116`, base `claude/youthful-volta-laarnk` @ `a09670d`.

## Why

Sandra asked for a one-time treatment (טיפול חד פעמי) that is also psychiatric, and decided
(2026-11-16):

1. **All four psychiatric services** are bookable as a one-time session — ייעוץ פסיכיאטרי
   (900 ₪), מעקב פסיכיאטרי (1,100 ₪), אבחון פסיכיאטרי (2,500 ₪), אינטייק (2,300 ₪). They are
   four different services (this closes open question 7 of `docs/package-catalog.md`).
2. **Leads / non-patients** can book one too.
3. The flow is **identical** to the existing one-time session (charge on the card, outside the
   package quota, passed to the therapists app, the psychiatrist marks it, payout via SessionLog).

## What was already there (found in the read-only investigation)

«+ טיפול חד פעמי» shipped on 2026-11-11 (`CHANGELOG-one-time-session.md`) and already offered
two psychiatric services from the PDF catalog — `psychiatric_consult` (ייעוץ, 900 ₪) and
`psychiatric_diagnosis` (אבחון, 2,500 ₪) — for **patients only**. Missing: the two
billing-priced services (1,100 ₪ / 2,300 ₪), which were not catalog rows, and any way to book
for a lead.

## What changed

### 1. Two new catalog services

| Key | Service | Unit | Gross (agorot) | Clinical type (decides the pay) |
| --- | --- | --- | --- | --- |
| `psychiatric_consult` (existing) | ייעוץ פסיכיאטרי | per session | 90,000 | מעקב פסיכיאטרי |
| `psychiatric_followup` (**new**) | מעקב פסיכיאטרי | per session | 110,000 | מעקב פסיכיאטרי |
| `psychiatric_diagnosis` (existing) | אבחון פסיכיאטרי | flat | 250,000 | אינטייק |
| `psychiatric_intake` (**new**) | אינטייק פסיכיאטרי | flat | 230,000 | אינטייק |

- The two rows are **appended at the end** of `PACKAGE_CATALOG_SEED`, so every existing key keeps
  its `sortOrder`. Their `sourceRef` says `Owner decision 2026-11-16: …` (they are not in the PDF).
- `ONE_TIME_CLINICAL_BY_KEY` maps them to the existing clinical types, so a follow-up pays the
  psychiatrist's `followupRate` and an intake the `intakeRate` — the existing fail-closed pay rule
  (`_therapistPay`); a therapist without that rate cannot be marked (no pay is invented).
- **Nothing in billing moved:** `public/treatment-map.js`, `public/therapist-pay.js`,
  `BILLING_PRICES` and every billing calculation are untouched. No PDF row was re-priced or aliased.

### 2. The catalog import is add-only on a seeded catalog

`adminSeedPackageCatalog` used to refuse (`already_seeded`) whenever the catalog had any row, so a
service added to the seed later could never reach the live catalog. Now:

- empty catalog → every seed row, epoch 1 (unchanged);
- seeded catalog → **only the seed keys that have no row at all** (any version, active or not),
  under one new epoch. No existing row, price, version or `active` flag is touched; a key ורד
  deactivated is not re-added;
- nothing missing → `already_seeded` (unchanged answer).

`adminGetPackageCatalog` additionally returns `missingSeedKeys` (key names only). «תמחור חבילות» →
קטלוג shows «יש N שירותים חדשים שעדיין אינם בקטלוג» + **«הוספת השירותים החדשים לקטלוג»** when it is
not empty. Same admin op (`seed`), same assertion and privilege — no new action or allowlist entry.

### 3. Labels by catalog key

Two services now share one clinical type, so `OneTimeSessions.serviceLabel` decides by the
**catalog key** first (`SERVICE_BY_KEY_HE`), then falls back to the clinical-type label. Own
properties only. New tier labels in «תמחור חבילות»: `followup` → מעקב, `intake` → אינטייק.

### 4. «+ טיפול חד פעמי» on a lead card

- Shown to a full money-scope editor (hidden for דנה, like the card button).
- The same modal opens titled «טיפול חד פעמי — ליד», with a notice: on save the lead moves to the
  patients list as «תשלום לפי טיפול» — no package, no billing cycle.
- **Nothing is written until «שמירה».** On save:
  1. the lead is saved as a patient through the confirmed-save path (`persistClientChange`,
     `requireIds`): `billingMode: 'per_session'`, `fromLead` = the lead id (history, assignee,
     preferred house and house of origin follow), blank `serviceType`, `pricePerSession 0`, blank
     `billingDay` / `paymentStatus` / `paymentDate` / `nextBillingDate`. **No payment row, no
     renewal cycle** — the existing per-session rules keep the person out of the overdue list, the
     collection tasks and the money KPIs;
  2. the session and its charge are created through the **unchanged** `createOneTimeSession` +
     durable extra-charge path. The source receives a client id and a catalog key — never a lead id
     or an amount.
- Stops **before any write**: a lead without a usable phone (the source checks the therapists diary
  by the patient's phone), a patient who already has that phone, no location.
- If the source refuses the booking **after** the conversion (e.g. the psychiatrist is busy), the
  modal says so, stays open as an ordinary patient booking, and a second save never converts twice.
- A failed conversion save is rolled back in the browser (the lead returns to its place).

Why a conversion and not a "lead charge": charges, payments, SessionLog, the busy check and the
therapists feed are all keyed on a **client**. Booking for a bare lead would have needed a second
money path beside the audited one. The per-session patient (2026-11-04) is the existing model for
"pays for a single session, no package".

## Security / integrity

- Price: source only, from the active catalog row; the browser sends no amount (tested with a
  forged amount).
- Authority: the lead button is a money action — hidden for an operational session; the proxy and
  Apps Script refusals for `createOneTimeSession` are unchanged. The catalog add needs the same
  pricing privilege + HMAC assertion as the first import.
- Therapists feed: unchanged allowlist — no amount, charge, note or hash (tested for a psychiatric
  session).
- Append-only: no sheet header changed. No new sheet, column, secret, Script Property or Railway
  variable.
- `npm audit`: 0 vulnerabilities.

## Known limits (documented, not hidden)

- The lead **leaves the leads pipeline** when it becomes a per-session patient (the same rule as
  «הפוך למטופל פעיל»). To sell a package later, change «אופן חיוב» on the patient card.
- A per-session patient with no payment row reads `debtStatus: 'unknown'` in `getDebtStatus` until
  a payment exists — the existing rule for any patient without a billing record (a flag, not a debt).
- `getTreatmentPlans` still projects a `renewalDate` (start + 1 month) for a per-session patient —
  pre-existing for every per-session patient, more visible now. Not changed here (cross-app contract).
- Therapists app: the tiers `followup` / `intake` have no Hebrew label there yet (it shows the key
  in the manager catalog). A small follow-up in `ezone-therapists`; no contract field changed.
- The charge description uses the clinical type («טיפול חד פעמי — מעקב פסיכיאטרי · …») also for a
  ייעוץ, as before; the card strip shows the service's own name.

## Files

`apps-script/Code.gs`, `public/app.js`, `public/index.html`, `public/style.css`,
`public/one-time-sessions.js`, `public/package-pricing.js`, `public/sw.js` (v38 → v39),
`test/one-time-psychiatric.test.js` (new), `test/one-time-lead-browser.test.js` (new),
`test/package-catalog.test.js`, `test/one-time-session.test.js`, `test/one-time-session-logic.test.js`,
`test/offers-crm.test.js`, `test-support/google-operational-drill-candidate.gs` (regenerated — Code.gs changed),
`docs/USER-GUIDE.he.md`, `docs/package-catalog.md`, `docs/package-therapists-contract.md`,
`docs/one-time-session-therapists-contract.md`, `DEPLOY.md`, `EZONE-ECOSYSTEM-STATUS.md`, `CHANGELOG.md`.

## Tests

- `test/one-time-psychiatric.test.js` — the four services (keys, source prices, clinical types, own
  labels); each one booked → charge draft (browser = source) → outcome → one SessionLog row at the
  psychiatrist's follow-up / intake rate, outside the quota, no credit effect; fail-closed pay;
  price-free feed; the lead → per-session patient save (no cycle, no payment row) and its booking;
  wiring guards.
- `test/one-time-lead-browser.test.js` (Chromium, 1280px + 360px) — the lead flow end to end
  (double click = one patient, one session, one charge), nothing written before save, retry after a
  refused booking, phone / duplicate stops, no button for דנה, and the catalog «add new services»
  button on a catalog imported before this change.
- `test/package-catalog.test.js` — the add-only import (re-priced and deactivated rows untouched,
  one new epoch, idempotent, still assertion-gated); four distinct psychiatric keys and prices.

## Release

1. Merge after Sandra's approval; `/api/version` = merge SHA; `/healthz`.
2. Dispatch **Deploy Apps Script** (`expected_commit` = merge SHA) — `apps-script/Code.gs` changed.
3. ורד: «תמחור חבילות» → קטלוג → **«הוספת השירותים החדשים לקטלוג»** (once).

Rollback: revert the merge and redeploy the same way. The two catalog rows stay in the sheet
(append-only versions); with the old code they have no clinical mapping, so the one-time modal
simply stops offering them. A lead that was converted stays a per-session patient; sessions and
charges created meanwhile are ordinary one-time sessions and charges.
