# CRM navigation order + win-back follow-up (2026-11-03)

Section 3 of the E-ZONE One Outpatient CRM brief.

## Changed
- `public/index.html`: menu order is now היום שלי · לידים · מטופלים · גבייה · הכנסות חודשיות ·
  מסלול המשך · תמחור חבילות · תשלומי מטפלים · **שימור לידים · מטופלים לא פעילים** (the two
  archive-like views last). Every `data-view` id, section and deep link is unchanged.
- «שימור לידים»: each lost lead now carries the shared CRM block (last contact, its outcome,
  next contact, owner, open tasks, «📞 יצרתי קשר» / «➕ משימה») and shows its `assignedTo`.
  A lead without a planned action is NOT an urgent task: «היום שלי» still skips `not_relevant`
  leads; only a real task on such a lead reaches the work screen.
- Archive cards (שימור לידים, מטופלים לא פעילים incl. deleted) moved from inline dark colours to
  light-theme classes (`.arc-card`, `.arc-row`, …); the view titles use `.view-title`.

## Not changed
Data, stages, restore flows, `*_HEADERS`, server routes.

## Tests
`test/crm-nav-order.test.js` (3): last-two order, every tab ↔ section ↔ icon, CRM block + no dark
palette on the archive cards.
