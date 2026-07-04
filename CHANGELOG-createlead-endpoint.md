# createLead endpoint (outpatient side)

**Date:** 2026-06-28

Lets the **E-Zone Dashboard** push a discharged patient into the Outpatient app
as a **new lead**. When the Dashboard discharges a patient with disposition
**"released to outpatient care"** (`released_outpatient`), it POSTs the patient
to this endpoint and a fresh lead is created for Vered to work — landing in the
first kanban stage exactly like a hand-entered lead.

The Dashboard half already shipped (merged); this builds the Outpatient receiver.
**`Clients` is never touched** — this only creates a `Leads` row.

## Inbound contract (what the Dashboard sends)

```
POST <APPS_SCRIPT_EXEC_URL>?action=createLead
Content-Type: application/json

{ "secret": "<CREATE_LEAD_SECRET>",
  "name":  "patient name",
  "phone": "0541234567",          // MAY be empty — hand-entered patients have none
  "house": "efroni",              // a Dashboard houseId key (see mapping)
  "note":  "source + notes combined" }   // free text, may be empty

→ { "ok": true,  "id": "id_..." }                 // success
→ { "ok": false, "error": "unauthorized" }        // bad/missing secret (fail-closed)
→ { "ok": false, "error": "missing_name" }        // name required
```

The Dashboard POSTs **directly to the Apps Script `/exec`** (the same path
`flagStop` uses) — **no `server.js` change**; the Node proxy is not in this path.

## Auth — new shared secret `CREATE_LEAD_SECRET`

Mirrors the `flagStop` receiver (an external write), **not** the read endpoints:

- The secret is read **only** from a Script Property named **`CREATE_LEAD_SECRET`**
  (`PropertiesService.getScriptProperties().getProperty('CREATE_LEAD_SECRET')`).
- **FAIL-CLOSED:** if the property is **unset**, every request is **rejected**
  (unlike the read endpoints, which are open when their secret is unset). An
  empty or wrong secret is rejected too.
- The secret is **never hardcoded and never logged**.

**Where to set it** — Apps Script editor: **⚙ Project Settings → Script
Properties → Add script property** → name **`CREATE_LEAD_SECRET`**, value = the
shared secret you give the Dashboard. Until it is set, `createLead` rejects every
request.

## House mapping (Dashboard houseId → Outpatient `house_of_origin`)

The Dashboard houseId keys are **identical** to the Outpatient
`house_of_origin` keys (`HOUSE_OF_ORIGIN_LABELS` in `public/app.js`), so the
mapping is **1:1 / verbatim — no remapping table**:

| key | Hebrew label |
|---|---|
| `raanana` | רעננה אשר |
| `ramot` | רמות השבים |
| `efroni` | קיסריה עפרוני |
| `rehab` | קיסריה ריהאב |
| `external` | חיצוני |

> The `arfoni` in the original contract example was a **placeholder**, not a real
> Dashboard key — disregarded.

**Guard:** if an **unknown** house key ever arrives, it is stored **as-is** —
the lead is still created. An unexpected house never fails the write.

## New lead row (matches an in-app new lead)

Built to mirror `addLeadFromForm` in `public/app.js`. Written to the `Leads`
sheet (`LEADS_HEADERS`) as a single appended row:

| Column | Value |
|---|---|
| `id` | generated `id_<base36 time>_<base36 rand>` (same shape as in-app `uid()`) |
| `name` | sanitized, trimmed, ≤200 chars (required) |
| `phone` | normalized via `_recoverPhone` (leading-zero canonical); **empty stays empty** |
| `serviceType`, `location` | `''` (unknown at intake) |
| `note` | sanitized, ≤2000 chars (may be empty) |
| `stage` | `'new'` — first kanban stage |
| `sessionsPerWeek`, `pricePerSession`, `startDate`, `introDateTime` | `''` |
| `created` | today (`yyyy-MM-dd`, script timezone) |
| `house_of_origin` | mapped house key (verbatim) |
| `not_relevant_reason`, `not_relevant_note` | `''` |

## Apps Script (`apps-script/Code.gs`)

- **`_createLeadAuthOk(params)`** — fail-closed auth reading `CREATE_LEAD_SECRET`
  from Script Properties (mirror of `_stopFlagAuthOk`).
- **`_createLead(payload)`** — validates `name`, normalizes `phone` (empty OK),
  sanitizes `name`/`note`, maps `house`, then under a `LockService` lock
  `_ensureSheet('Leads', LEADS_HEADERS)` + `appendRow(...)` a single new lead.
  Returns `{ ok:true, id }`. Cannot reuse `_saveAll` (it rewrites the whole sheet
  from full client state) — this is a single-row append like `_flagStop`.
- **`_mapLeadHouse`**, **`_sanitizeLeadText`** (trim + strip control chars +
  length cap), **`_leadUid`** (mirrors `uid()`) helpers.
- **`doPost`** — new `action === 'createLead'` block: merges the body `secret`
  into the auth params, rejects with `{ ok:false, error:'unauthorized' }` on bad
  secret, else returns `_createLead(payload)`.

## Security

- Secret from Script Properties **only**, **fail-closed**, **never logged**.
- Inputs sanitized before they hit the sheet: `name`/`note` trimmed, control
  chars stripped, length-capped (200 / 2000); `phone` normalized; `house`
  trimmed.
- `Clients` is never modified.

## Tests (`test/create-lead.test.js`, `node --test`)

Mirrors the un-importable Apps Script logic (same approach as
`test/stop-flag-match.test.js`) plus source-guards on `Code.gs`:

- valid `createLead` writes a correct brand-new lead row (normalized phone,
  `stage:'new'`, `created`=today, empty activation fields);
- missing / wrong / empty secret **fails closed with no write**;
- unset `CREATE_LEAD_SECRET` rejects (never open);
- **empty phone** (and missing phone field) accepted and stored empty;
- an **unmapped house key** still creates the lead (stored as-is);
- blank name rejected (`missing_name`, no row);
- all five known house keys map 1:1 verbatim;
- source-guards: `createLead` routed in `doPost`; auth fail-closed + reads
  `CREATE_LEAD_SECRET`; lead uses `stage:'new'` + `created`/`appendRow`; secret
  never logged; the test mirror's columns equal `LEADS_HEADERS`.

## Deployment

⚠️ **Apps Script redeploy required.** This endpoint lives in the Apps Script
Web App, so it only goes live after a redeploy:

**Deploy → Manage deployments → ✏️ (pencil) → Version: New version → Deploy.**

**NEVER "New deployment"** — that mints a brand-new `/exec` URL and breaks both
the Dashboard and the Outpatient app, which share the single existing
deployment. The live deployment is whatever `/exec` URL is set as `SHEETS_URL`
on the Outpatient Railway service (the repo stores no deployment ID / `.clasp.json`).

After deploying, set the **`CREATE_LEAD_SECRET`** Script Property (above) to the
shared secret the Dashboard uses.

## Commits

- _pending_ — add `createLead` endpoint (`_createLead`, `_createLeadAuthOk`,
  helpers, `doPost` route), `test/create-lead.test.js`, this changelog.
