# Action busy spinner — every button that writes or reloads says it is working (2026-11-05)

**Request (Sandra, production, 2026-11-05):**
«כשלוחצים על כפתורים שמירה איפוס או כל שינוי תוסיף ספינר» — several actions gave
no feedback at all between the click and the result, so users clicked twice; a
double «יצירת הצעה» or «אישור מחיקה» is a duplicate-write risk.

## What ships

A single shared helper, `public/busy.js` (`window.Busy`), wrapped around every
control that starts a write or a reload. It only wraps — no payload, no business
rule, no change to the single-flight / recovery logic of the durable renewal and
extra-charge operations (#170).

```js
Busy.withBusy(button, function () { return save().then(reloadList); });
```

While the action runs the pressed control:

* is **disabled** and carries **`aria-busy="true"`** (plus an `is-busy` class);
* has its label replaced by a **pure-CSS inline spinner** (`.busy-spinner`), with
  the measured width *and* height pinned inline first, so nothing in the row
  moves (checked at 1280 px and 360 px);
* **drops a second click**: the wrapped function is never called again, which is
  the double-submit that caused the duplicate-quote risk;
* is **restored on success and on failure** — the label, the original enabled
  state and the inline sizes all come back.

A `<select>` or `<input>` keeps its content (replacing it would destroy the
options or the value): it gets the disabled + `aria-busy` + `is-busy` treatment
and a soft moving sheen with the progress cursor.

The spinner is a bordered circle built from `currentColor`, so it matches every
button variant in the light theme, and it uses `border-inline-end` — it looks
identical in RTL. Under `prefers-reduced-motion: reduce` nothing spins or
sweeps: the spinner and the sheen fade in and out instead.

## Where the app plugs into it (`public/app.js`)

Three thin adapters keep the diff small and keep the existing control flow
exactly as it was (including every early `return` in the validation paths):

| helper | use |
| --- | --- |
| `busyRun(el, fn)` | one-shot: run `fn` with `el` busy until its promise settles |
| `busyStart` / `busyEnd` | the two halves, for the existing "disable the submit, re-enable it in `.finally()`" forms |
| `busyIs(el)` | the guard — a plainly disabled control still counts as not actionable, exactly as before |

Each one degrades to the previous plain `disabled` toggle when `busy.js` is
absent (this is what the Node fixtures see).

### Buttons that now show a spinner

* **Patient card** — «עריכה» save (`#editClientSubmit`), «חידוש ותשלום»,
  «+ הוסף טיפול», the status `<select>` (פעיל / הפסקה זמנית), «סמן כתשלום לפי
  טיפול?», «✓ שולם» / «בטל סימון», «אישור תשלום מחזור», the per-charge ✏️ edit,
  ✕ delete and the paid ⇄ unpaid badge, «סיים טיפול» → its submit, and the ✕
  permanent delete (one spinner over all three chained writes).
* **גבייה** — the row's תקופת כיסוי save and ↺ reset, the ✏️ collection-amount
  modal (save + «חזרה לסכום המחושב»), and the orphan row's «הסר».
* **Leads** — the lead form save, stage ← / →, «← הפוך למטופל פעיל» → activate
  save, the agreement save, «לא רלוונטי» / removal submits, intake
  (`#directClientSubmit`).
* **«היום שלי» / CRM** — the task row's ✓ complete, 👤 reassign, ✕ withdraw, and
  the 📞 contact / ➕ task / ⏩ defer modal submits; «מסלול המשך» שמור and «צור
  ליד» (the lead creation plus the outcome row, under one spinner).
* **Alerts panels** — «אישור טיפול נוסף», the stop-flag dismiss.
* **תמחור חבילות** (`public/package-pricing.js`) — «יצירת הצעה (טיוטה)»,
  «אישור מחיקה» / «אישור איפוס» (🗑 מחיקה, ↺ איפוס), «אישור תמחור», «בחירת מחיר
  חודשי», «התאמת סכום», «✔ סמן כנשלחה», «⏳ ממתינה להחלטה», «✅ הלקוח אישר»,
  «✕ נדחתה», «הארכה», «עדכון מעקב», «שיוך (ללא חיוב)», the catalog's «שמירה
  כגרסה חדשה» and its initial import, and «רענון».
* **Elsewhere** — the header «רענון» (held until `loadAll()` finishes, not just
  the POST), settings save, credits save / mark-paid, the session correct/add
  form, «סמן כהועבר לחשבת שכר», merge-clients confirm, the stop-alert and
  resume-treatment submits, restore client, sign-in (the PIN button and the
  name button).

For a few screens the busy state is rendered from the screen's own state rather
than from the pressed node, because the action redraws its whole container
before the request returns: «יצירת הצעה» (`F.busy`) and «רענון» (`S.loading`) in
the pricing tab draw a disabled button carrying the same `.busy-spinner`.

### Deliberately left alone

* **«➕ הוספה להצעה» / «➕ הוספת פריט מותאם» / «אישור מחיר ידני»** in the offer
  form, the chip pickers and the calculator's choices — local state only; the
  calculator already shows «…» while its quote is computed.
* Pure **open / close / toggle** controls (modal openers that need no read, tab
  buttons, «ביטול», «סגירה», WhatsApp links, the CSV export).
* **Optimistic card actions re-render their own card** (`setCurrentMonthPaid`,
  `setChargePaid`, the status select, `setBillingMode`): the spinner starts on
  the pressed node and is swapped out with the card a moment later. The second
  click is still refused — by the existing business guard on the new state — and
  the write path is untouched.
* **Modal confirms that close their own modal before the write** — «שחזר
  לטיפול», «חידוש טיפול» (resume), the lead-removal confirm and the stop-alert
  send: the control is off-screen before the request returns, so the optimistic
  row plus its rollback toast stays the feedback. Their submits are still
  single-shot.
* The two **durable recovery flows** (renewal / extra charge) keep their own
  gating; the spinner is laid over the pressed button only, and the label is
  restored without overriding whatever the recovery gating decided.

## Tests

* `test/busy.test.js` — 19 unit tests on the helper with plain fake elements, no
  browser: busy set and cleared on success, on a synchronous `throw` and on a
  rejection; a pre-disabled control stays disabled afterwards; the measured box
  is pinned and released; a `<select>`'s options survive; **re-entrancy blocked**
  (the second call never invokes the action and resolves with `Busy.BLOCKED`);
  `fromEvent` / `withBusyEvent` for delegated handlers.
* `test/action-busy-spinner-browser.test.js` — Playwright (Chromium), the real
  UI + `server.js` + `Code.gs` sandbox, signed in as ורד, at **1280 px and
  360 px**, with the upstream response **held open** so every assertion happens
  mid-request: a patient-card save, the card's «חידוש ותשלום» (width preserved),
  a quote creation, 🗑 מחיקה and «רענון». Each asserts the spinner, the disabled
  state, that a **second click sends no second request**, and that the button
  returns to normal after success **and** after a server error.
* Two existing source-shape guards (`test/offers-crm.test.js`,
  `test/crm-followup-2.test.js`) were updated because the wrapped calls read
  `reason` / `followUp` into a local before the async action starts; the calls
  themselves are unchanged. `test-support/financial-ui-fixture.cjs` now loads the
  four busy adapters alongside the other extracted helpers.

SW cache **v30 → v31** (`index.html`, `busy.js`, `app.js`, `package-pricing.js`,
`style.css` changed). **No `Code.gs` change — no Apps Script phase.**

Supersedes the stale PR #105 («feat(ui): working indicator (spinner) for every
action», branch `feat/busy-indicator`, 2026-09-12), which predates the CRM,
offers and search work; it can be closed.
