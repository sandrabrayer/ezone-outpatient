# Cross-app debt-status endpoint (`getDebtStatus`)

A read-only endpoint that lets a sibling app (E-Zone Therapists) block or warn
on a patient who has an **open balance** in outpatient. It is the billing
counterpart to `getWinbackSource` and follows the same shape and auth model.

## Why this was needed (investigation finding)

The therapists app needs to answer "does this person owe money in outpatient?"
during patient intake. That answer did **not** previously exist as a readable
projection:

- **Debt is not a single field.** It is spread across per-month rows in the
  `Payments` sheet (`status`, `amountDue`, `amountPaid`), keyed to a client by
  `clientId`. "Who owes" is a join + reduction, not a column read.
- **The debt rows carry no phone.** Phone lives on the `Clients` sheet
  (`treatmentContactPhone`, `payerPhone`), so matching requires joining
  `Payments → Clients` by `clientId`.
- **`getWinbackSource` deliberately excludes all billing/payer data**, so it
  could not be reused.

So the endpoint had to be added rather than invented on the consumer side.

## Matching contract

Decided with the product owner: a patient is matched on **name + the phone
registered in the system**. On the outpatient side that phone is
**`treatmentContactPhone`** (the patient / treatment contact), *not*
`payerPhone` (which may be a parent or institution). The endpoint therefore
projects `name` and `treatmentContactPhone` as `phone`; the therapists app
normalizes and matches on both.

## What it returns

```jsonc
{
  "ok": true,
  "debtors": [
    {
      "sourceApp":  "ezone-outpatient",
      "clientId":   "c1",
      "name":       "אורי",
      "phone":      "050-1234567",   // treatmentContactPhone
      "amountOwed": 400,
      "kind":       "debtor"
    }
  ]
}
```

Only clients with `amountOwed > 0` are included. Debtors are returned
**regardless of client status** — an open balance still matters after
discharge (`סיים טיפול`). Nothing else is exposed: no `payerPhone`,
`paymentLink`, prices, bundles, or per-month rows.

## The debt rule (single source of truth)

For one payment row, the amount still owed is:

| `status` (resolved)      | owed                         |
| ------------------------ | ---------------------------- |
| `paid`                   | `0`                          |
| `''` / null / legacy     | `0` (legacy row, assumed paid) |
| `partial` / `unpaid`     | `max(0, amountDue - amountPaid)` |

A client owes when the sum across all their rows is `> 0` (rounded to the
cent to avoid float dust). This is the **same rule** as `public/billing-status.js`
— only an explicit `partial`/`unpaid` counts; an empty status is assumed paid,
so legacy rows never produce phantom debt.

The rule lives in **`public/debt-status.js`** (`computeDebtors`) and is
**mirrored inline** in `apps-script/Code.gs` (`_getDebtStatus`), because Apps
Script cannot import the module. `test/debt-status.test.js` guards the module;
any change to the rule must update both places together — exactly the pattern
already used by `billing-status.js` and its inline twin in `app.js`.

## Auth

Same model as `getWinbackSource`:

- If a Script Property **`DEBT_STATUS_SECRET`** is set, the request must pass
  `?secret=<value>` that matches; otherwise → `{ ok: false, error: 'unauthorized' }`.
- If the property is absent, the endpoint is open (URL-only obscurity — the
  same security level as every other action on this script).

`server.js` already forwards `?secret=` to Apps Script for any GET action
(`server.js:82`), so the Node proxy needs **no change**.
`test/debt-status-forwarding.test.js` locks this for `getDebtStatus`.

## Usage

```
GET  /api/sheets?action=getDebtStatus&secret=<DEBT_STATUS_SECRET>
POST /api/sheets   { "action": "getDebtStatus", "secret": "<DEBT_STATUS_SECRET>" }
```

(Reaches Apps Script `doGet`/`doPost`. The action is **not** cached — only the
bulk `getData` read is.)

## Files touched

- `apps-script/Code.gs` — `_debtAuthOk`, `_getDebtStatus` (+ inline debt rule),
  dispatch in `doGet` and `doPost`. **Requires an Apps Script redeploy.**
- `public/debt-status.js` — canonical debt rule module (new).
- `test/debt-status.test.js`, `test/debt-status-forwarding.test.js` — new.
- `README.md`, `CHANGELOG.md` — documented.

## Deploy notes

- **Redeploy the Apps Script web app** (the new action lives in `Code.gs`).
- Optionally set the `DEBT_STATUS_SECRET` Script Property and the matching
  `secret` on the therapists app. Without it the endpoint is open like the rest.
- No Sheets schema change. No Node/Railway change required beyond a normal
  deploy of the new test/static files.

## Observation (not changed here)

While tracing phone fields, note `_getWinbackSource` reads `c.phone` for
discharged clients (`Code.gs`), but the `Clients` sheet has no `phone` column
(it uses `treatmentContactPhone`/`payerPhone`), so that field is always blank
for discharged clients. Left untouched — out of scope for this change — but
worth a follow-up.
