# Read-only boot — opening, navigating and refreshing Outpatient never writes (2026-11-07)

**Source:** issue #149, Work acceptance audit 2026-11-06, findings **R6** (write on read) and **R10**
(failed reads masked as empty). Baseline: production `68b78a570fa93d2a1be6e89be8e99fe7cf7b43ea`
(PR #164 merged, Apps Script v108). Goal: Work can open the signed-in UI for a read-only acceptance
pass without any source write.

## What was wrong (deployed code)

1. `public/app.js` `loadAll` → `cleanupConvertedLeads` → `persist()` (a full `saveAll`) whenever an
   active lead was already referenced by a client's `fromLead`. A page open wrote the Leads sheet.
2. `server.js` `GET /api/continuation-roster` on a fresh roster awaited `runContinuationSync`, which
   POSTs `syncContinuationMilestones` — creating, moving and **cancelling** Tasks and appending Activity.
   The browser fetched the roster right after boot, so every sign-in / refresh after the 60 s roster
   cache expired could change tasks.
3. `loadAll` turned a failed payments / charges / … read into `[]` — indistinguishable from «none».

## What ships

| Path | Before | After |
| --- | --- | --- |
| Boot (`loadAll`) | `persist()` when converted leads found | display filter only; the source's `_saveAll` drops converted leads on the next **deliberate** save (it already did) |
| `GET /api/continuation-roster` | sync on cache miss | **pure read** (`X-Cache` HIT/MISS) |
| `POST /api/continuation-sync` | on-demand re-run | **the only writer** of milestone tasks; `requireSession` + `application/json` (415 otherwise) |
| `GET /api/continuation-sync/preview` | — | read-only dry run → «N שינויים ממתינים» |
| Source `previewContinuationMilestones` | — | `_syncContinuationMilestones(payload, { dryRun: true })`: no lock, no `_ensureSheet`, returns before any write; proxy secret; refused from `/api/sheets` like the real action |
| Failed reads | `[]` silently | banner «מידע לא זמין: …», continuation-status warning |

**Authorization is unchanged:** the same signed-in allow-listed users who could already edit the
continuation track (ורד, אורן, דנה — the sync is money-free, `moneyScope: ops`). Unsigned, forged,
unnamed-legacy and retired cookies → 401. A browser can never supply the patient list
(`syncContinuationMilestones` / `previewContinuationMilestones` on `/api/sheets` → 403).

**Idempotency / retry:** every milestone task has a stable id `cont::<ref>::<entryDate>::m<n>` and each
Activity event a stable key, so replaying the sync after a lost answer creates, moves and closes
nothing twice (proved in the browser by applying the request server-side and dropping the response).
A roster that cannot be read → 502, **nothing closed**; `rosterComplete` is sent only for a good roster.

No new task engine, no new sheet, no schema change (headers untouched), no data migration, no
change to money paths (#164 guard untouched), roles or secrets.

## Behaviour change for staff

Milestone tasks no longer appear just because someone opened the app. In «מסלול המשך» the bar shows
«N שינויים ממתינים במשימות ההמשך»; pressing **«🔄 עדכון משימות המשך»** applies them (toast: opened /
moved / closed). Saving a terminal status (סירב/ה, נסגר, עבר/ה לטיפול המשך) still closes that
patient's open tasks immediately.

## Release order

1. Node (Railway) first: the roster GET stops writing immediately. Until step 2 the preview answers
   «לא זמין» (old source: unknown action) — the button still works with the existing action.
2. Apps Script: dispatch «Deploy Apps Script» with `expected_commit` = merge SHA (Code.gs changed:
   new read-only action only). SW cache v32 → v33.

**Rollback:** revert the merge commit (Node); the Apps Script addition is additive and harmless to
leave, or roll back via the existing deployment version.

## Tests

- `test/read-only-boot-browser.test.js` — Chromium, real `server.js`, real `Code.gs` handlers in the
  synthetic sandbox, fake Dashboard roster. A write = any sheet grid / script property changed **or**
  any non-read source action forwarded. Acceptance 1–8 of the request (open, refresh, two windows,
  cache miss, explicit sync once, lost-answer retry, outage, unauthorized). Verified to **fail on the
  deployed code** (opening the app deleted the converted lead) and pass here.
- `test/continuation-milestones.test.js` — dry run predicts the real sync exactly, writes nothing
  (not even the Tasks sheet), takes no lock; replay → 0/0/0; proxy-only.
- `test/continuation-crm-browser.test.js` — opening the tab: 0 syncs, 0 tasks; button → 6 created once.

## Not covered / still open

- Native Google (real Apps Script runtime) and a signed-in production read-only pass by Work — to be
  done after approval and deployment; synthetic only here.
- Other reads that *bootstrap a missing sheet* (header row only) in a brand-new spreadsheet are not
  data writes and are unchanged; production already has those sheets.
- #137 exact-ID referral idempotency (separate draft) is not part of this change.
