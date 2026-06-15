# Cross-app treatment-plans endpoint (`getTreatmentPlans`)

A read-only endpoint that lets a sibling app (E-Zone Therapists) show each
outpatient's **treatment plan** — service types + sessions/week — in its
"מטופלי חוץ — תוכנית טיפול" tab. It is the third minimal, secret-gated
projection on this script, alongside `getWinbackSource` and `getDebtStatus`,
and follows the exact same shape and auth model.

## Why this was needed

The therapists treatment-plan tab needs each outpatient's plan (service types +
sessions/week). The existing cross-app reads don't provide it:

- **`getDebtStatus` deliberately doesn't expose it** — it carries only the
  billing tri-state (`debtStatus`, `amountOwed`), by design.
- **`getData` would over-expose** billing/payer fields (`payerName`,
  `payerPhone`, `paymentLink`, prices, bundles) that the therapists app must
  never receive.

So outpatient gets a third minimal, read-only, secret-gated projection rather
than widening an existing one.

## What it returns

```jsonc
{
  "ok": true,
  "clients": [
    { "sourceApp": "ezone-outpatient", "clientId": "c1", "name": "אורי",
      "phone": "050-1234567", "serviceType": "פרטני, פרטני CBT",
      "sessions": "{\"פרטני\":1,\"פרטני CBT\":1}", "status": "פעיל" }
  ]
}
```

`phone` is the **canonical patient phone** — the populated `phone` column,
falling back to `treatmentContactPhone` if `phone` is blank — with leading-zero
recovery (`_recoverPhone`) applied so consumers get the canonical 10-digit form.
This is the **cross-app join key** for the therapists app, so it must not be
blank for a client that has a number. `sessions` is the raw `sessionsPerWeek`
value. **No** `payerName`/`payerPhone`/`paymentLink`/prices/bundles are included.
Every client with an `id` is returned; rows without an id are skipped.

> **Phone-column fix (2026-06):** this projection originally read only
> `treatmentContactPhone`, which is empty for every live client (the real
> patient number lives in the `phone` column added in the stop-flow work). That
> returned `"phone":""` for all clients and broke the therapists-app join. It now
> prefers `phone` and falls back to `treatmentContactPhone`. **Requires an Apps
> Script redeploy.**

## Auth

Same model as `getWinbackSource`/`getDebtStatus`:

- If a Script Property **`TREATMENT_PLANS_SECRET`** is set, the request must
  pass `?secret=<value>` that matches; otherwise →
  `{ ok: false, error: 'unauthorized' }`.
- If the property is absent, the endpoint is open (URL-only obscurity — the
  same security level as every other action on this script).

The secret is **separate from `DEBT_STATUS_SECRET`** so the two endpoints can be
rotated independently. `server.js` already forwards `?secret=` to Apps Script
for any GET action, so the Node proxy needs **no change**.

## Usage

```
GET  /api/sheets?action=getTreatmentPlans&secret=<TREATMENT_PLANS_SECRET>
POST /api/sheets   { "action": "getTreatmentPlans", "secret": "<TREATMENT_PLANS_SECRET>" }
```

(Reaches Apps Script `doGet`/`doPost`. The action is **not** cached.)

## Files touched

- `apps-script/Code.gs` — `_treatmentPlansAuthOk`, `_getTreatmentPlans`,
  dispatch in `doGet` and `doPost`. **Requires an Apps Script redeploy.**
- `test/treatment-plans.test.js` — new; locks the minimal projection.
- `README.md`, `CHANGELOG.md` — documented.

## Provenance

Applied verbatim from the ready-made patch in the therapists repo
(`docs/outpatient-getTreatmentPlans.patch.md`), confirmed to match the
`getDebtStatus`/`getWinbackSource` conventions already in `Code.gs` before
applying.

## Deploy notes

- **Redeploy the Apps Script web app** (the new action lives in `Code.gs`).
- Optionally set the `TREATMENT_PLANS_SECRET` Script Property and the matching
  `TREATMENT_PLANS_SECRET` env var on the therapists Railway service. Without
  it the endpoint is open like the rest.
- No Sheets schema change. No Node/Railway change on the outpatient side.
