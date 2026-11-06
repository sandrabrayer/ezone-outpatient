# Hotfix — client saves refused as stale after #163/#165; package change re-pricing (2026-11-04)

## Symptom (ורד, production, 2026-11-04)

Changing a patient's package from the card (עריכה / חידוש ותשלום) did not save. The red
banner read «השינוי ל־<4 names> לא נשמר — אורן / ורד עדכן/ה קודם. הנתונים רועננו.» although
nobody else had edited those patients, and it came back on retry. The new package and price
never appeared on the card.

## Root cause

`server.js` caches the Apps Script `getData` bulk read for 60 s (`getDataCache`) and every
successful write through `/api/sheets` invalidates it. The gap: a `GET /api/sheets` whose
upstream read was **already in flight** when a write (saveAll, applyRenewal, …) landed came
back **after** the invalidation carrying the **pre-write sheet** — and was stored as the fresh
cache. For the next 60 s every tab that reloaded (any user, and the tab's own reload after a
conflict) received rows without that write and without its who/when stamps:

1. the tab now echoes the OLD `updatedAt` for every row written in that window;
2. its next `saveAll` changes a row (the package change) → `_staleConflictCols` sees
   sheet stamp ≠ echoed stamp AND a content diff → the row is refused;
3. rows ורד herself had just saved are reported as «ורד עדכן/ה קודם», rows אורן saved as
   «אורן עדכן/ה קודם» — the "4 names" are exactly the rows written between the overtaken read
   and the poisoned cache's expiry;
4. the conflict reload read the same poisoned cache → the same refusal on retry; the edit was
   rolled back in the UI (`Object.assign(client, prev)`), so the new package/price never showed.

The race existed before, but this week made it likely: three concurrent users (ורד, אורן,
דנה), CRM writes on nearly every click (tasks, activity, continuation sync, offers) that
invalidate the cache constantly, and more parallel reads per `loadAll`, so an upstream read is
in flight most of the time a write lands.

The stale-save conflict check itself (`apps-script/Code.gs` `_saveAll` → `_staleConflictCols`)
is correct and is **not** weakened.

## Fix

### `server.js` — read-after-write guard on the getData cache
- `getDataCache.generation` is bumped by every `invalidateCache()`.
- The GET handler remembers the generation before the upstream read. If a write bumped it
  while the read was in flight, the read is **re-read once** (the common case: one save
  overlapped) and the fresh answer is served and cached (`X-Cache: MISS`); if a second write
  overtakes the re-read, the answer is served **uncached** (`X-Cache: BYPASS`) and the cache
  stays empty. A read that lost the race is never stored.
- `?fresh=1` keeps bypassing the cache as before.

### `public/app.js` — stale-picture reloads bypass the cache
- `apiLoad(fresh)` / `loadAll({ fresh: true })`: the reload after a conflict and after
  `staleSave: true` requests `/api/sheets?fresh=1`. Ordinary loads (boot, refresh button,
  renewal flows) keep the cache.

### `public/conflicts.js` — reason-aware banner
- A row refused with `reason: 'financial_operation_pending'` (the financial journal still
  holds an open renewal / extra-charge operation on it — e.g. a חידוש ותשלום applied but not
  yet confirmed with «אישור וסגירה») is no longer reported as «<editor> עדכן/ה קודם». It says:
  «השינוי ל־<name> לא נשמר — יש פעולה כספית פתוחה (חידוש ותשלום / הוסף טיפול) על הכרטיס.
  יש לפתוח אותה מהכרטיס, לאשר את ההשלמה ואז לשמור שוב.» Stale rows keep the existing wording;
  a mixed response shows both sentences, names never cross over.

### `public/sw.js`
- `CACHE` v26 → **v27** (app.js and conflicts.js changed; live was v26 at #165 / 2f0d630).

## Package change re-pricing (verified, no new rules)

- **עריכה**: the per-service frequency host and «סכום חודשי» are written as entered
  (`sessionsPerWeek`, `pricePerSession`); one row stamped, nothing else re-stamped.
- **חידוש ותשלום**: the journal flow (`reserveRenewal` → `applyRenewal`) writes
  `pricePerSession` = the renewal amount, the new frequency and `packageChangeDate` = the paid
  date (the cycle re-anchor), plus the paid base-payment row. Until «אישור וסגירה» the row is
  reserved by the journal (by design, OP-BILL-01) — the banner now says so.
- The card has **no catalog-driven automatic price** today: the monthly amount is entered by
  ורד (catalog pricing lives in «תמחור חבילות» / offers). Nothing new was invented; once the
  save goes through, the entered price is what the card shows.

## Tests

- `test/proxy-read-after-write.test.js` — real `server.js` + real `Code.gs` (sandbox): an
  overtaken read is re-read and the cache holds the post-write stamp; a twice-overtaken read is
  served `BYPASS` with an empty cache; `?fresh=1` and the undisturbed path unchanged; app.js
  source contract for the fresh reloads. The first two tests fail on the previous `server.js`.
- `test/package-change-save-browser.test.js` — Playwright (Chromium), ורד + אורן:
  1. עריכה package change saves once, re-prices from the amount, persists across a reload, and
     a second edit from the same tab is not a self-conflict;
  2. a tab stale only for rows אורן edited still saves its own change; the banner names only
     his rows; the reload carries `?fresh=1`; the next edit is accepted;
  3. חידוש ותשלום re-prices (`1800`, frequency 2, `packageChangeDate` = paid date); before
     «אישור וסגירה» an עריכה save is refused with the open-operation wording (never
     «עדכן/ה קודם»); after it the same edit saves.
- `test/name-picker-conflicts.test.js` — reason-aware wording; `test/payout-followups.test.js`
  and `test/stale-save-prevention.test.js` follow the `loadAll(opts)` signature.

## Deploy

- Node only (Railway auto-deploy on merge). **No `apps-script/Code.gs` change → no Apps Script
  phase.**
- PWA: first load after the deploy may still be the old shell — reopen / refresh once (v27).

## Known limits (not changed here)

- A full-snapshot save from a tab that is stale for rows it did **not** edit still reports
  those rows in the banner as «השינוי … לא נשמר» although the tab's own change went through;
  the row-level refusal is correct, the wording is pessimistic. Left as is (behavioural change
  beyond a hotfix).
- Writes that reach Apps Script without the proxy (cross-app receivers) never invalidate the
  proxy cache; they touch meta columns only, which the conflict diff ignores.
