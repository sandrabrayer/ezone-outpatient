# Package catalog and pricing requests (OP-PKG, draft)

A **quotation source** for outpatient packages. Oren / Shahar (house managers,
in the therapists app) pick a predefined option for a patient; **Vered** (this
app) sees the price, can adjust it with a recorded reason, approves it and may
attach the approved quote to a client or lead.

It never creates a charge, payment, renewal, credit, `TherapistRates` change or
payout. `priced` means **quoted/approved, not paid**.

> Status (2026-10-19): **draft, not released, no production enablement approved.** The
> therapists side now EXISTS as ezone-therapists **#105** (draft; contract:
> `docs/package-therapists-contract.md`). Both prerequisites have shipped (Outpatient #123,
> Therapists #106 — see "Confidentiality status"). Remaining gates: the PDF/business confirmations
> below, the configuration checklist (`docs/package-release-checklist.md`) and Sandra's final
> production approval on the concrete heads. Nothing here has been run against production.

## Who can see what

| Actor | Gets | Never gets |
| --- | --- | --- |
| Oren / Shahar (therapists app) | price-free catalog (key, family, tier, sessions, allowed months, `needsPricing`); their own request IDs + status (`pending`/`priced`) | any amount, total, VAT, adjustment, approval, snapshot, other requester's rows |
| Ordinary therapists | nothing — no access to any new endpoint | everything |
| Vered (this app) | everything, **after** the separate `CATALOG_ADMIN_PIN` | — |
| Anyone with only `APP_PIN` / any display name | the normal app | the pricing tab's data (the server answers 401) |

### Authorization layers (Vered only)

1. **Session** — normal signed `APP_PIN` cookie (`requireSession`).
2. **Server-verified `CATALOG_ADMIN_PIN`** → `POST /api/catalog-admin/login`:
   constant-time compare; only WRONG PINs count, in three failure-only buckets per 15 min —
   **5 per base session, 30 per client address, 60 global** (see "Lock-out — residual risk");
   8–32 chars; must differ from `APP_PIN`; fails closed (503) when unset or mis-set.
3. **Scoped, signed, HttpOnly cookie** `ezone_catalog_admin` — 15 minutes,
   `SameSite=Strict`, `Path=/api/catalog-admin`, `Secure` on HTTPS, token scope
   `catalog-admin` (never verifies as a session and vice versa).
4. **Only gateway** `POST /api/catalog-admin/rpc`: the upstream body is rebuilt
   from a per-op allowlist; the actor (`user`) is taken from the signed session,
   any browser-supplied `user/actor/role/requesterKey/adminAssertion/…` is
   rejected (`400 forbidden_field`).
5. **Apps Script re-verifies** — Node adds a body-bound HMAC assertion
   (`v1.<exp>.<nonce>.<hmac>`; message `pkgadmin.v1|action|exp|nonce|sha256(canonical body)`;
   ≤ 300 s ahead). The proxy key alone unlocks **no** private action.
6. **Generic `/api/sheets` is closed** for every `*package*` / `admin*` action
   (403 `forbidden_action`) and for authority fields (400).

A selected display name or `sessionStorage` value never grants anything.
The assertion is not single-use; replay is harmless because every mutation is
idempotent by op id (below) and reads are reads.

## Data model (append-only headers)

`PackageCatalog` — `id, key, version, epoch, family, tier, unit, sessions,
sessionMinutes, allowedMonths, pricePerSessionAgorot, priceTotalAgorot,
monthlyPriceAgorot, priceMinAgorot, priceMaxAgorot, vatBasis, vatRateBp, active,
sortOrder, sourceRef, validFromIso, createdAtIso, createdBy`.
A catalog edit **appends** `key@vN+1` with a new global `epoch` and flips only the
previous row's `active` cell. No price cell is ever overwritten.

`PackageRequests` — `id (UUID), payloadHash, status, revision, requesterKey,
patientName, patientPhone, packageKey, months, catalogRowId, catalogEpoch,
selectedMonthlyAgorot, quoteSnapshot, adjustedTotalAgorot, adjustReason,
adjustLog, approvedTotalAgorot, approvedSnapshot, approvedAtIso, approvedBy,
attachedType, attachedId, attachedAtIso, attachedBy, opLog, createdAtIso,
updatedAt, updatedBy`.
`quoteSnapshot` / `approvedSnapshot` are immutable JSON of the exact figures used;
a later catalog edit cannot change an existing quote.

Both sheets are created lazily by `_ensureSheet`, are in the nightly backup
(`package-catalog-`, `package-requests-`; absent ones are recorded, not created)
and the restore manifest accepts 9 rows (legacy, 8 sheets) or 11 (current).
Sheets-coercible columns (`payloadHash`, ISO stamps, `allowedMonths`,
`patientPhone`) are forced to text.

### Money

Integer **agorot** everywhere (cap 1,000,000 ₪). `vatBasis = 'inclusive'` (the PDF
states all prices include VAT, p9), `vatRateBp` in basis points.
`net = floor((gross·10000 + floor(denom/2)) / denom)`, `denom = 10000 + bp`,
`vat = gross − net` (round half up; `net + vat == gross` always).
Monthly price and full commitment total are separate fields
(`monthlyAgorot` vs `grossAgorot`/`commitmentMonths`).

### Reliability

* **Request** — client UUID + SHA-256 of the canonical payload, checked and
  written under the script lock. Same id + same payload → existing safe result
  (`duplicate:true`) at any later time; same id + different payload →
  `request_id_conflict`; **no** patient/package time-window dedupe; lock busy →
  `busy`, nothing written.
* **Adjust / approve / attach** — op UUID in `opLog` (replay = success, no second
  effect), `expectedRevision` (`revision_conflict`), `priced` is terminal,
  attach is idempotent to the same target and `already_attached` otherwise.
* **Validation is server-side only** — package key must be active, months must be
  in the row's `allowedMonths`, the catalog `epoch` must be current
  (`stale_catalog`), a client amount is never read.

## PDF → catalog mapping (VERIFIED against the original, 2026-10-19)

Source file: *איזון E-ZONE — קטלוג שירותים 2026*, **version 2.0, May 2026 edition**, 9 pages, A4 landscape
(PDF metadata: created 2026-05-26; file `קטלוג_שירותים_איזון_2026_5.pdf`, sha256 `1f374f6693b7a254eeecfc8cd1ee472c1c7080ef81ef38569aa7948b4d326bb5`).
All nine pages were read (rasterised, not only text-extracted). Page numbers below are the PDF's physical pages.
**Result: every one of the 15 seeded amounts, session counts and durations matches the PDF; no numeric
discrepancy was found.** What the PDF says beyond the seeded fields is listed under "Unresolved business questions" —
none of it was added to scope or to any billing path.

| Key | PDF p. | What the PDF says | Seeded | Match |
| --- | --- | --- | --- | --- |
| `day_track_basic` | 3 | מסלול בסיסי — 3 days/week, 08:30–16:00 incl. lunch; **15,000 ₪ per month** («חבילה חודשית / לחודש») | 1,500,000 agorot / month, `allowedMonths 1` | ✓ |
| `day_track_extended` | 3 | מסלול מורחב — Sun–Thu (5 days/week); **18,000 ₪ per month** | 1,800,000 / month, `1` | ✓ |
| `emdr_core` | 5 | Core — 4 sessions × 60 min, weekly; **3,400 ₪ total**, 850 ₪/session | 4 × 85,000 = 340,000 | ✓ |
| `emdr_standard` | 5 | Standard — 8 sessions, weekly; **6,800 ₪** | 8 × 85,000 = 680,000 | ✓ |
| `emdr_complex` | 5 | Complex — 16 sessions, **weekly or biweekly**; **13,600 ₪** | 16 × 85,000 = 1,360,000 | ✓ |
| `emdr_single` | 5 | single EMDR session, 60 min, **850 ₪**, no commitment; convertible to a package within 30 days with credit for the session | 85,000 (credit not modelled) | ✓ |
| `cbt_core` | 6 | Core — 6 sessions × 50 min, weekly; **3,000 ₪**, 500 ₪/session | 6 × 50,000 = 300,000 | ✓ |
| `cbt_standard` | 6 | Standard — 12 sessions; **6,000 ₪** | 12 × 50,000 = 600,000 | ✓ |
| `cbt_complex` | 6 | Complex — 20 sessions; **10,000 ₪** | 20 × 50,000 = 1,000,000 | ✓ |
| `cbt_single` | 6 | single CBT session, 50 min, **500 ₪**; 30-day conversion with credit | 50,000 (credit not modelled) | ✓ |
| `emdr_cbt_combined` | 6 | 12 sessions (6 CBT + 6 EMDR), **flat 8,500 ₪** | 850,000 flat; `sessionMinutes 0` (the PDF gives no single duration) | ✓ |
| `continuation_monthly` | 7 | טיפולי המשך — **graduates of the balancing houses only**; 4 sessions/month (weekly) × 50 min, same therapist; **2,000 ₪ per month**; month-to-month, no long-term commitment; maintenance, not EMDR | 200,000 / month, 4 × 50, `1` (eligibility not enforced) | ✓ |
| `psychiatric_consult` | 7 | ייעוץ פסיכיאטרי — card labelled **«מעקב חודשי»** (one meeting a month, 30–45 min), **900 ₪ per meeting**; external referrals and graduates; no commitment | 90,000; `sessionMinutes 0` | ✓ |
| `psychiatric_diagnosis` | 7 | אבחון פסיכיאטרי — one-time, 60–90 min, incl. written report (delivered within 7 working days); **2,500 ₪** | 250,000 flat | ✓ |
| `solo_housing` | 8 | Solo — 3 months, extension "by clinical judgment"; **8,000–10,000 ₪ per month** incl. support | min 800,000 / max 1,000,000, `3`; Vered selects | ✓ |

Page 9 («הערות חשובות») states: **all prices include VAT**; **prices are valid at the date of issue**; EMDR and CBT are also
offered as an embedded protocol inside the day track per the leading therapist's clinical judgment; every patient has a
clinical assessment before treatment starts. Page 2 notes that the house network is priced **individually by clinical
profile and treatment track** (the houses are not part of this catalog).

`psychiatric_consult` (900) ≠ billing «מעקב פסיכיאטרי» (1,100) and
`psychiatric_diagnosis` (2,500) ≠ billing «אינטייק» (2,300): the PDF does not equate
them, so they are separate keys and the existing billing constants are untouched.

## Unresolved business questions (owner decisions — nothing here was invented or added to scope)

From the PDF check and the earlier review. None changes billing; each is either "not modelled" or "assumed":

1. **VAT rate — assumption, unconfirmed.** The PDF only says prices include VAT (p9). **18 % (1800 bp)** is an
   application assumption (Israel's rate from 2025-01-01); stored per row, editable by Vered, and
   used only to display the net/VAT split. Sandra/accounting must confirm the rate (and that the split is wanted).
2. **Are the May 2026 prices still current?** The PDF says prices are valid at the date of issue (p9) and carries no
   end date. Confirm nothing changed between May and release before Vered runs the initial import.
3. **Day track:** commitment length is not stated (`allowedMonths = 1`, monthly); the weekly entitlements printed on p3
   (individual ×2/week, psychiatrist ×2/month, supplementary ×1/week, groups ×3/week) are not modelled
   (`sessions = 0`); whether EMDR/CBT given *inside* the day track (p9) is included in the monthly fee is not stated.
4. **30-day credit** for converting a single EMDR/CBT session into a package (p5/p6) is **not modelled**; Vered
   uses *adjust* with a reason.
5. **EMDR Complex** frequency (weekly vs biweekly, p5) and the **combined bundle** composition (6 CBT + 6 EMDR, p6) are
   not modelled.
6. **Solo** extension beyond 3 months ("by clinical judgment", p8) is not modelled.
7. **Psychiatric services:** the PDF labels the 900 ₪ consult «מעקב חודשי», while billing has «מעקב פסיכיאטרי»
   at 1,100 ₪; and the 2,500 ₪ diagnosis vs billing «אינטייק» at 2,300 ₪. They are kept as distinct keys
   (see below) — confirm whether they are different services or the same service at two prices.
8. **Eligibility** printed in the PDF («מתאים ל…», and «לבוגרי הבתים המאזנים בלבד» for טיפולי המשך) is **not enforced** by the catalog.
9. **Who owns «מסלול המשך» and the stop/resume flows after Yarden.** Not invented: UI copy says «צוות מסלול המשך».
   Name an owner when decided.
10. Whether a *priced* request should later trigger a charge — deliberately **out of scope**.

## Yarden (ירדן) — what code does and what stays manual

Code: removed from the login picker and the `assignedTo` dropdown; added to
`RETIRED_SESSION_USERS`. **Sign-in is now two-step and fail-closed:**

1. `POST /api/verify-pin {pin}` mints only a **name-less PIN-stage session** (10 minutes, unique login id).
   It can reach **nothing but** `GET /api/users` and `GET /api/me` (the name picker). Every other route —
   reads, writes, debug, pricing — answers `401 name_required`.
2. The picker re-posts `{pin, user}`; only an allow-listed name receives the 7-day **named** session.
   An unknown / free-text / **retired** name is **refused (`403 user_not_allowed`, no cookie)** — it never
   degrades to a session. A still-valid old cookie carrying a retired or unknown name is refused (`401`).
   Old name-less cookies (the former "user-less fallback") no longer reach data routes.

Not closable by code: anyone who still **knows the shared `APP_PIN`** can complete step 1 and then pick
any *current* name. Name-attribution is therefore not authentication of a person; to fully revoke a leaver's
knowledge, **rotate `APP_PIN` and `SESSION_SECRET`** (see below; this logs everyone out once) —
rotation complements, and does not replace, these code checks.

## Pricing authorization model (what the code enforces)

* `CATALOG_ADMIN_PIN` is verified **on the server** and mints a 15-minute HttpOnly,
  SameSite=Strict, Path-scoped cookie that carries only a random id. The id points at an
  **in-memory server-side admin session** bound to the **exact base session cookie** and the
  **named user** it was minted for. A copied admin cookie is useless with any other session or user.
* **Revocation is server-side:** `/api/catalog-admin/logout` and `/api/logout` delete the record
  (and every record of that base session) immediately; **every successful `/api/verify-pin` login
  (re-login or account switch) also revokes the privilege of the session whose cookie it presented and
  clears the admin cookie**; a server restart forgets all records (fail closed — re-enter the PIN);
  absolute 15-minute expiry.
* **Unique login identity:** every session token carries a random 128-bit login id inside the signed
  payload, so two logins of the same name in the same second never share a token (and thus never share
  the admin binding). Cookies minted before this change (no login id) still serve ordinary routes until
  they expire, but cannot enter pricing (`403 fresh_login_required`) — sign in again once.
* **Lock-out — residual risk (honest statement):** only *wrong* PINs count, a correct PIN is never counted,
  and the per-session cap (5 / 15 min) is the primary control. **But the per-IP cap (30) and the global
  cap (60) are shared:** 30 wrong admin-PIN attempts from the office address, or 60 anywhere, DO block
  Vered's fresh session for up to 15 minutes (the limiter runs before her PIN is evaluated, which is what
  keeps the cap meaningful against guessing). A block returns `429` + `Retry-After` and is logged.
  Recovery: wait out `Retry-After` (≤ 15 min), or restart the service (clears the in-memory counters).
  Not relaxed on purpose: letting a correct PIN bypass the shared caps would remove their value against
  a holder of the shared `APP_PIN` who rotates sessions. PIN length is 8–32.
* Apps Script still verifies the body-bound HMAC assertion (the second, independent check).

## Configuration — an explicit PREREQUISITE of enablement (values are never in code or git)

The feature is inert until configured (every route fails closed). The complete, ordered checklist — exact
locations, what must match what, and presence/alignment checks that never print a value — is
**`docs/package-release-checklist.md`** (single source; the therapists repo links to it). Summary of what exists:

* Outpatient **Railway** variables: `CATALOG_ADMIN_PIN` (Vered only, 8–32 chars, ≠ `APP_PIN`),
  `CATALOG_ADMIN_ASSERTION_SECRET` (≥ 32 random chars, distinct from every other secret).
* Outpatient **Apps Script → Script properties**: the **same** `CATALOG_ADMIN_ASSERTION_SECRET`, plus
  `PACKAGE_CATALOG_SECRET` and `PACKAGE_REQUEST_SECRET` (≥ 32 chars each; the four secrets pairwise distinct and distinct
  from `OUTPATIENT_PROXY_SECRET`, otherwise Apps Script fails closed).
* Therapists **Railway** variables: the same `PACKAGE_CATALOG_SECRET` and `PACKAGE_REQUEST_SECRET`, and
  `PACKAGE_WHATSAPP_NUMBER` (digits, international; no default; unset = no WhatsApp button).
* `ROLE_CODES` with a **distinct personal code** for Oren and for Shahar; `APP_PIN` / `SESSION_SECRET` rotation is a
  coordinated operator step (it signs everyone out once). Claude never changes Railway or Script Properties.

Controlled enablement: configure → release #122 → authorised one-time catalog import (Vered reviews the 15 rows against
the PDF table above and the VAT rate) → only then release #105 → verify with approved test data.

## Confidentiality status (2026-10-19)

Both prerequisite fixes are **merged to their deployed branches** (reported released by the reviewer on 2026-10-19; this
document does not claim live verification):

1. **Public price/pay constants — Outpatient #123**, merge `0941004` on `claude/youthful-volta-laarnk` (SW v13, Apps Script
   source 98 unchanged). `treatment-map.js` / `therapist-pay.js` are served only to signed-in sessions, `no-store`, canonical path
   only; the service worker never caches them. **Residual limitation (kept):** anyone who knows the shared Outpatient `APP_PIN`
   can sign in and read those constants — rotate `APP_PIN`/`SESSION_SECRET` to remove a leaver's access.
2. **`amountOwed` in the therapists browser — Therapists #106**, merge `e9021a5` (SW v46, Apps Script source 74). Amounts are
   removed from browser payloads; the debt block, the Ron/Sandra approval path and billing are unchanged; the approval audit
   figure fails closed during the new-Node/old-script window.
3. This feature's own confidentiality is by construction (separate secrets, allowlisted builders, tests), not by deleting
   known price fields.

Say "managers receive no price or debt amount from these paths" only for the code paths covered by the tests above and only
after the live deployment is verified; do not extend it to other data (e.g. a shared-PIN holder, other apps).

## Integration with PR #121 (extra-charge journal) — RESOLVED in this branch

#121 (`codex/op02-extra-charge-journal-20261018`) was **merged into
`claude/youthful-volta-laarnk` at `2d4950f`** (2026-10-18 18:11 UTC) while this draft was open.
This branch now contains that base (merge commit, no force-push; #121's branch untouched).

* **Service worker:** #121 took `ezone-outpatient-v12`; #123 (now merged, deployed base `0941004`) took v13; this feature
  is **`ezone-outpatient-v14`**. The live value cannot be read from the build sandbox (production is blocked by its proxy):
  before release, check what production serves and keep the bump monotonic (CLAUDE.md rule 5) — see the checklist.
* **Backups:** both sets are combined — the nightly set is 10 sheets
  (`Clients, Leads, לידים שהוסרו, Clients-removed, Payments, ClientCharges, Credits, FinancialOps,
  PackageCatalog, PackageRequests`); legacy 8- and 9-row manifests still restore; #121's mixed-kind
  manifest restore test passes unchanged on the combined set.
* **Yarden:** #121's browser tests now sign in as **שירן** (not the retired ירדן); no test in the
  merged tree relies on her name.
* **Behaviour:** no dependency — this feature touches no charge/payment/renewal path.

## Release order and per-repo mechanics (NOT executed — needs Sandra's final approval on concrete heads)

Order: **#121** (merged `2d4950f`) → **#123** (merged `0941004`) and **Therapists #106** (merged `e9021a5`) → **#122** (this) →
authorised catalog import → **ezone-therapists#105** last. The deployed bases were refreshed into both package branches
without force-push (see the PR descriptions for exact heads). Each merge/deploy still needs its own explicit approval.

| | Outpatient (`ezone-outpatient`, deployed branch `claude/youthful-volta-laarnk`) | Therapists (`ezone-therapists`, deployed branch `claude/inspiring-tesla-jipobw`) |
|---|---|---|
| Node/Railway | auto-deploys on merge; poll `/api/version` until `commit` = merge SHA, check `/healthz` | same, on its own URL |
| Apps Script | **manual second phase:** dispatch *Deploy Apps Script* on the deployed branch with `expected_commit` = the approved full merge SHA (no push trigger). #122 changes `apps-script/**`, so this phase is required | **automatic on push** when `apps-script/**`, `.clasp.json`, the workflow, `scripts/check-apps-script.js` or `server/apps-script-fetch.js` change. #106 changed `Code.gs` (its automatic deploy belongs to that release); **#105 changes none of these**, so merging it starts no Apps Script deploy and needs no extra source deployment |
| Never | paste `Code.gs`, create a new deployment, roll the Outpatient source back to **97** (an extra-charge intent may exist; #121's journals must be preserved) | same |

Per outpatient merge:
1. Sandra approves → merge. 2. Poll `/api/version` + `/healthz`. 3. Dispatch *Deploy Apps Script* with `expected_commit` = the
merge SHA; wait for success and the existing deployment's new version (stop and recheck if the branch moved). 4. Time 3 requests.
Then the configuration + authorised import (checklist) and only after that #105. Before the first outpatient release confirm
the **live** SW version (`ezone-outpatient-v14` must be above it).
