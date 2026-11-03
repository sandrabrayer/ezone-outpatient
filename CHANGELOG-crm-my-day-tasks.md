# «היום שלי» as a working CRM — one task engine, priority order (OP-CRM-1b / Phase C, 2026-10-31)

Phase C of the Outpatient CRM program (issue #141), stacked on OP-CRM-3B. Improves the merged OP-CRM-1 screen; no rebuild. Draft only.

## What changed (`public/my-day.js`, `public/app.js`, `public/style.css`)
- **Persisted tasks are rows.** `MyDay.build` now takes `tasks` (getTasks) and `activity` (getActivity). Every open/deferred task is a row (name from the lead/client, kind, owner, due date/time, «נדחתה מ-…» when deferred). Money tasks never reach an operational session's rows (server hides them; the model double-checks).
- **No second engine.** A derived row (new lead without contact, intro to schedule, intro passed without decision, plan to activate, renewal due) is **suppressed** when an open task already covers that subject and kind family — a refresh never duplicates manual work. A lead with a logged contact becomes «להמשיך מעקב» (`lead_waiting`) instead of «ללא קשר ראשון», and is never urgent by age.
- **Priority order** (program §6), each row exactly once, cards and sections from the same rows:
  1. באיחור ומחויבויות עם מועד (late rows, dated+timed commitments, today's tasks)
  2. שיחות להיום · 3. שיחות היכרות היום · 4. היכרויות שעברו ללא החלטה · 5. פניות ללא קשר ראשון · 6. תחילת טיפול והמשך טיפול · 7. אישורים וחריגים · (ורד: חידושים וגבייה) · בהמשך השבוע.
- New cards «משימות לביצוע» and «שיחות להיום» (null → «המידע אינו זמין» when getTasks did not load; 0 only when it loaded empty). Card click still filters by domain (`משימות ושיחות לביצוע` added).
- Task rows carry 📞 ✓ ⏩ inline (the Phase B handlers), so the day is worked from the opening screen; the subject button opens the lead modal / client card as before. Dates are Asia/Jerusalem (`today()`); a task is late only by its own due date.

## Tests
`test/my-day.test.js` +4 (13–16): task rows + names, derived suppression + first-contact awareness, priority order / single appearance / card parity, ops money exclusion; pins updated. Full suite 1741/1741.
