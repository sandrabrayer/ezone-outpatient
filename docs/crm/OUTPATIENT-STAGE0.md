# Outpatient → CRM: Stage 0 mapping (2026-10-29)

Ground truth for turning the Outpatient app into the second CRM surface, on the
same model as the Dashboard CRM (E-Zone-Dashboard `docs/crm/SPEC` — «הוראות
האיפיון והעיצוב»). Everything here was read from this repo's code on the
deployed branch `claude/youthful-volta-laarnk` (HEAD `b14db79`) and from the
Dashboard's deployed branch; nothing was tested against production data.

Legend: **verified** = read in code and covered by a test; **tested** = exercised
locally with fixtures; **not verified** = inferred, needs a production check.

## 1. Who uses it (verified — `lib/users.js`, `lib/catalog-admin.js`)

| Person | Sign-in | What the server lets her do |
| --- | --- | --- |
| ורד | `APP_PIN` | everything, incl. pricing (`CATALOG_ADMIN_USERS`) |
| אורן | `USER_PIN_OREN` | everything except pricing |
| דנה | `USER_PIN_DANA` | everything except pricing — **including every money field** |

There are **no roles** in this app: `SESSION_USERS` is a flat list. The Dashboard
CRM's rule «דנה operational, without money, enforced server-side» has **no
server counterpart here** → gap **G3** below.

## 2. Screens today (verified — `public/index.html`, `public/app.js`)

| Tab (`data-view`) | What it is | CRM role |
| --- | --- | --- |
| `dashboard` → now **«היום שלי»** | KPIs, locator, credits, renewals, stop flags, extra requests, breakdowns | opening screen (OP-CRM-1) |
| `leads` | kanban `new → intro → agreement → active` + `not_relevant` | lead pipeline |
| `clients` | patients by service type, money panel, renewals | customer file |
| `continuation` | המשך טיפול roster (from the houses) | continuity queue |
| `sessions` / `therapist-pay` / `revenue` | logs & money | finance (ורד) |
| `inactive` | discharged patients | archive |

## 3. Data (verified — `apps-script/Code.gs` `*_HEADERS`, append-only)

- **Leads**: `id name phone serviceType location sessionsPerWeek pricePerSession startDate stage note created house_of_origin not_relevant_note introDateTime assignedTo … preferredHouse`.
  `assignedTo` ∈ `SESSION_USERS` (dropdown in the lead modal, pinned by `test/lead-assignee.test.js`).
- **Clients**: 38 columns incl. money (`pricePerSession`, renewal/charge fields) and `assignedTo`.
- **STOP_FLAGS** (`status` pending/approved/rejected, `reportedBy`, `reportedAt`, `clientId`), **EXTRA_SESSION** requests (`status`, `used`, `quota`, `monthKey`, `requestedBy`), **CONTINUATION** rows (`meetingDate`, `outcome`), **STOP_ALERTS**.
- No Tasks / Activity sheets here (the Dashboard added `Tasks` + `Activity` in PR #314) → OP-CRM-3.

## 4. The Dashboard → Outpatient handoff, checked against the rules

Path: Dashboard `sendToOutpatient` (`lib/ambulatory-handoff.js`) → `POST /exec`
`{ action:'createLead', secret, name, phone, house, note, preferredHouse }` →
`_createLead` (Code.gs ~L4004) → **one new Leads row**: `stage:'new'`,
`created:today`, `house_of_origin:<mapped>`, `note`, `preferredHouse`.

| Rule (CRM spec) | Status | Evidence |
| --- | --- | --- |
| Fail-closed auth on an external write | **verified** | `_createLeadAuthOk` — `CREATE_LEAD_SECRET` must exist and match; secret never logged |
| Input validation / no free-text injection | **verified** | `_sanitizeLeadText` (control chars stripped, 2000 cap), `_preferredHouseOrNull` rejects unknown houses with no row written, phone via `_recoverPhone` |
| Lead lands in the first stage with its origin house | **verified** | `stage:'new'`, `house_of_origin` (pardes → `raanana_pardes` alias) |
| Lead appears on the Outpatient opening screen as «ליצור קשר ולתאם שיחת היכרות», **not** late by age | **tested** (OP-CRM-1) | `test/my-day.test.js` #1 — `lead_new` is `undated`, never urgent |
| Owner travels with the lead | **❌ G1** | `_createLead` never writes `assignedTo`; Dashboard sends no owner |
| Dashboard knows what happened after sending | **❌ G2** | nothing flows back; the Dashboard shows «נשלח» forever |
| דנה sees no money | **❌ G3 (display only)** | `MyDay.NO_MONEY_USERS` hides renewals/collection client-side; the API still returns money to her |
| Duplicate protection | **not verified** | no phone dedupe server-side (documented); the in-app duplicate warning fires only on manual entry |

### G1 — owner lost across the handoff
Dashboard `sendToOutpatient` sends `name, phone, house, note, preferredHouse`;
`_createLead` writes no `assignedTo`. Result: every handed-off lead is unowned
until someone opens it. Fix (OP-CRM-2): Dashboard sends `assignedTo` (the
Dashboard owner, mapped to a `SESSION_USERS` name or blank), `_createLead`
accepts it **only if** it is in `SESSION_USERS` (else blank, never rejected —
the lead must still be created).

### G2 — no status feedback
The Dashboard marks the patient «נשלח לאמבולטורי» at send time and never learns
«נוצר קשר / נקבעה היכרות / התחיל טיפול / לא רלוונטי». Fix (OP-CRM-2): a
read-only, shared-secret endpoint on this app (`getLeadStatus` by lead id or
phone, same auth pattern as the existing cross-app reads, `no-store`) that the
Dashboard polls when it renders the ambulatory card. No write from the
Dashboard into Outpatient beyond `createLead`.

### G3 — money separation is client-side only
Same decision as the Dashboard: operational people (דנה) must not receive money
fields from the server. Fix (OP-CRM-3 or its own PR): `OPS_USER_IDS`-style
list in `lib/users.js`; the session-gated read routes strip
`pricePerSession`, renewal/charge/collection fields and the money tabs' data
for those names (fail-closed: unknown name = ops). Until then «היום שלי» hides
money for דנה but the clients tab does not.

## 5. PR plan (one PR at a time, draft → Sandra's approval → merge)

| PR | Scope | Apps Script release? |
| --- | --- | --- |
| **OP-CRM-1** (this PR) | «היום שלי» opening tab: `public/my-day.js` pure model, cards/urgent/domain lists, metrics collapsed below; SW v21 | no |
| OP-CRM-2 | G1 + G2: `assignedTo` across the handoff, `getLeadStatus` read endpoint; Dashboard side in E-Zone-Dashboard | **yes** (Code.gs) |
| OP-CRM-3 | Tasks + Activity sheets, contact log, «יצרתי קשר» panel ported from the Dashboard; G3 server-side money stripping | **yes** |
| OP-CRM-4 | Light Monday-style theme (Dashboard tokens), grouped nav | no |

## 6. Manual production checks (not done here — no production writes for testing)

1. After OP-CRM-1 is live: as דנה, open the app — «היום שלי» shows no «חידושים וגבייה» card; as ורד it does.
2. Discharge a **test** patient from the Dashboard to outpatient only if a sandbox sheet is configured; otherwise skip — the handoff path is covered by `test/create-lead.test.js`.
3. `curl -s https://ezone-outpatient.up.railway.app/sw.js | grep -o 'ezone-outpatient-v[0-9]*'` → `v21`.
