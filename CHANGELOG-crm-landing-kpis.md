# Landing: headline KPIs back on top (OP-CRM-G, 2026-10-31)

Sandra, 31/10: the opening screen must still show «מטופלים פעילים», «הכנסה חודשית» and «לידים פתוחים» at a glance, and the breakdowns should not be hidden.

- `public/index.html`: the three KPIs moved from the collapsed «מדדים ופילוחים» panel to the **top of the landing screen**, above «היום שלי». «הכנסה חודשית» carries `money-only` → hidden for an operational session (CSS `body.ops-scope`; the server already strips the data it is computed from). The breakdowns panel («📊 פילוחים») is **open by default**.
- `public/my-day.js`: card label «פניות ללא היכרות» → **«פניות שטרם נקבעה להן היכרות»** (new inquiries + intro-stage leads with no scheduled intro date; the hint counts intros that passed without a decision).
- `public/style.css`: compact 3-across KPI row, 2-across for ops (no revenue), stacked on phones.
- `test/my-day.test.js` pins: KPIs above `#myDay`, revenue money-only, breakdowns open. Full suite 1755/1755. No Code.gs change.
