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
registered in the system**. On the outpatient side that is the **canonical
patient phone** — the **`phone`** column, falling back to
**`treatmentContactPhone`** when blank, leading-zero recovered — *not*
`payerPhone` (which may be a parent or institution). The endpoint projects
`name` and that canonical phone as `phone`; the therapists app normalizes and
matches on both.

> **Phone-column fix (2026-06):** this projection originally read only
> `treatmentContactPhone`, which is empty for every live client (the real
> patient number lives in the `phone` column added in the stop-flow work) — so
> it returned a blank `phone` join key. It now prefers `phone` and falls back to
> `treatmentContactPhone`, with leading-zero recovery, mirroring the same fix in
> `getTreatmentPlans`. **Requires an Apps Script redeploy.**

## Never-fail-open: three outcomes, not two

A missing record must **not** silently pass as "no debt". The endpoint returns
**every** client (not just debtors) with a **tri-state** `debtStatus`, so the
consumer can tell *confirmed no debt* apart from *couldn't determine*:

| situation (per client)               | `debtStatus` | consumer routing       |
| ------------------------------------ | ------------ | ---------------------- |
| has payment rows, open balance > 0   | `debt`       | block + approval       |
| has payment rows, nothing owing      | `clear`      | allow                  |
| **zero payment rows**                | `unknown`    | **flag** for manual    |

The consumer adds two more flag cases from the phone match itself:
phone matches **no** client → flag (no record); phone matches **>1** client →
flag (ambiguous). `unknown` deliberately does **not** collapse to `clear`:
absence of a payment row is absence of evidence, not evidence of payment.

## What it returns

```jsonc
{
  "ok": true,
  "clients": [
    { "sourceApp": "ezone-outpatient", "clientId": "c1", "name": "אורי",
      "phone": "050-1234567", "debtStatus": "debt",    "amountOwed": 400 },
    { "sourceApp": "ezone-outpatient", "clientId": "c2", "name": "דנה",
      "phone": "052-7654321", "debtStatus": "clear",   "amountOwed": 0 },
    { "sourceApp": "ezone-outpatient", "clientId": "c3", "name": "מאיה",
      "phone": "054-1111111", "debtStatus": "unknown", "amountOwed": 0 }
  ]
}
```

`phone` is the canonical patient phone (the `phone` column, falling back to
`treatmentContactPhone`, leading-zero recovered). Clients are returned **regardless of status**
— an open balance still matters after discharge (`סיים טיפול`), and a discharged
client with no rows is still `unknown`. Nothing else is exposed: no `payerPhone`,
`paymentLink`, prices, bundles, or per-month rows.

## The debt rule (single source of truth)

Two levels:

1. **Per row that EXISTS** — amount still owed:

   | `status` (resolved)      | owed                         |
   | ------------------------ | ---------------------------- |
   | `paid`                   | `0`                          |
   | `''` / null (blank cell) | `0` (a billed month, blank status cell = settled) |
   | `partial` / `unpaid`     | `max(0, amountDue - amountPaid)` |

2. **Per client** — `debt` if the row sum is `> 0` (rounded to the cent);
   `clear` if rows exist and nothing is owed; `unknown` if there are **no rows
   at all**.

The "don't assume paid" rule lives at the **client level** (zero rows =
`unknown`). The per-row blank-cell handling matches `public/billing-status.js`:
a row that exists with a blank status is a billed month treated as settled, not
a debt. (Boundary decision, flagged for review: an existing all-blank-status
client resolves to `clear`; only the *absence* of rows is `unknown`.)

The rule lives in **`public/debt-status.js`** (`clientDebtStatus`,
`computeClientDebt`) and is **mirrored inline** in `apps-script/Code.gs`
(`_getDebtStatus`), because Apps Script cannot import the module.
`test/debt-status.test.js` guards the module; any change to the rule must update
both places together — exactly the pattern already used by `billing-status.js`
and its inline twin in `app.js`.

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
