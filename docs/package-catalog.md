# Package catalog and pricing requests (OP-PKG, draft)

A **quotation source** for outpatient packages. Oren / Shahar (house managers,
in the therapists app) pick a predefined option for a patient; **Vered** (this
app) sees the price, can adjust it with a recorded reason, approves it and may
attach the approved quote to a client or lead.

It never creates a charge, payment, renewal, credit, `TherapistRates` change or
payout. `priced` means **quoted/approved, not paid**.

> Status: draft for review. **End-to-end completion is not claimed**: the
> therapists side is a contract only (`docs/package-therapists-contract.md`).

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
   constant-time compare; 5 attempts / 15 min per client address **and** 25 / 15
   min globally; must differ from `APP_PIN`; fails closed (503) when unset.
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

## PDF → catalog mapping

Source: *קטלוג שירותים איזון 2026*, version 2.0, May 2026. Every price includes VAT (p9).
Each seeded row stores this reference in `sourceRef`.

| Key | PDF | Rule imported | Gross (agorot) |
| --- | --- | --- | --- |
| `day_track_basic` | p3 | מסלול בסיסי, 3 days/week, per **month**; allowed months `1` | 1,500,000 / month |
| `day_track_extended` | p3 | מסלול מורחב, 5 days/week, per month; `1` | 1,800,000 / month |
| `emdr_core` / `_standard` / `_complex` | p5 | 4 / 8 / 16 sessions × 850 ₪ | 340,000 / 680,000 / 1,360,000 |
| `emdr_single` | p5 | one session 850 ₪ (30-day conversion credit **not modelled**) | 85,000 |
| `cbt_core` / `_standard` / `_complex` | p6 | 6 / 12 / 20 sessions × 500 ₪ | 300,000 / 600,000 / 1,000,000 |
| `cbt_single` | p6 | one session 500 ₪ (30-day credit **not modelled**) | 50,000 |
| `emdr_cbt_combined` | p6 | 12 sessions, **flat** 8,500 ₪ (not 12 × a rate) | 850,000 |
| `continuation_monthly` | p7 | טיפולי המשך, 4 sessions/month, 2,000 ₪, month-to-month; `1` | 200,000 / month |
| `psychiatric_consult` | p7 | ייעוץ פסיכיאטרי 900 ₪ per meeting | 90,000 |
| `psychiatric_diagnosis` | p7 | אבחון פסיכיאטרי one-time 2,500 ₪ incl. written report | 250,000 |
| `solo_housing` | p8 | Solo, **range** 8,000–10,000 ₪ / month, 3 months; Vered must select | 800,000–1,000,000 / month |

`psychiatric_consult` (900) ≠ billing «מעקב פסיכיאטרי» (1,100) and
`psychiatric_diagnosis` (2,500) ≠ billing «אינטייק» (2,300): the PDF does not equate
them, so they are separate keys and the existing billing constants are untouched.

## Unresolved business questions (please confirm)

1. **VAT rate.** The PDF only says prices include VAT. **18 % (1800 bp) is an
   assumption** (Israel's rate from 2025-01-01); it is stored per row and editable by Vered.
2. **Day-track commitment length** is not stated — `allowedMonths = 1` (monthly).
3. **30-day single-session → package credit** (EMDR/CBT) is not modelled; Vered
   uses *adjust* with a reason.
4. **EMDR Complex frequency** (weekly vs biweekly) is not modelled.
5. **Solo extension** beyond 3 months ("by clinical judgment") is not modelled.
6. **Psychiatric consult vs follow-up** and **diagnosis vs intake** kept distinct
   (see above) — confirm they really are different services.
7. **Who owns «מסלול המשך» and the stop/resume flows after Yarden.** Not invented:
   UI/toast copy now says «צוות מסלול המשך». Name an owner when decided.
8. Whether a *priced* request should later trigger a charge — deliberately **out of scope**.

## Yarden (ירדן) — what code does and what stays manual

Code: removed from the login picker and the `assignedTo` dropdown; added to
`RETIRED_SESSION_USERS`, so `/api/verify-pin` falls back to a user-less session
for her name **and any still-valid cookie carrying her name is refused (401)**;
UI copy is neutral; historical `updatedBy` text is never rewritten.

Not closable by code: anyone who still **knows the shared `APP_PIN`** can sign in
without a name (the user-less fallback). To fully revoke, **rotate `APP_PIN` and
`SESSION_SECRET`** (see below; this logs everyone out once).

## Configuration required (values are never in code or git)

Railway → project → **ezone-outpatient** service → **Variables**:

| Variable | Rule |
| --- | --- |
| `CATALOG_ADMIN_PIN` | Vered's pricing PIN, 8–32 chars, **different from `APP_PIN`** |
| `CATALOG_ADMIN_ASSERTION_SECRET` | ≥ 32 random chars, distinct from every other secret |
| `APP_PIN`, `SESSION_SECRET` | rotate once to revoke Yarden's knowledge/cookies |

Apps Script → project → **Project Settings → Script properties**:

| Property | Rule |
| --- | --- |
| `CATALOG_ADMIN_ASSERTION_SECRET` | **same value** as on Railway |
| `PACKAGE_CATALOG_SECRET` | ≥ 32 chars, price-free reads — **therapists app only** |
| `PACKAGE_REQUEST_SECRET` | ≥ 32 chars, submissions only — **therapists app only** |

All four must be pairwise distinct and distinct from `OUTPATIENT_PROXY_SECRET`;
otherwise Apps Script fails closed (`unauthorized`). Therapists side (Railway,
therapists service): `PACKAGE_CATALOG_SECRET`, `PACKAGE_REQUEST_SECRET`, the
Apps Script URL they already use, and `PACKAGE_WHATSAPP_NUMBER` (proposed name; international
digits; no default). Until set, everything above answers 503/unauthorized.

After deploy, Vered opens **תמחור חבילות → ייבוא ראשוני** once (idempotent), reviews
the rows against the PDF, and checks the VAT rate.

## Confidentiality findings (not fixed here — separate follow-up)

The task asks not to claim "no amounts reach managers" while these exist:

1. **Public price constants.** `public/treatment-map.js` (₪500 / 1,100 / 2,300 / 600,
   day-center 15,000 / 18,000) and `public/therapist-pay.js` (per-therapist pay
   rates) are served unauthenticated by `express.static` (`server.js`). They are
   *billing / payout* constants, not this catalog, and moving them changes how the
   billing UI loads — so **no billing math or file was changed here**. Recommended
   separate PR: serve them behind `requireSession` (or compute server-side).
2. **`amountOwed` browser payload (therapists app).** `debtStatus` rows carry
   `amountOwed`, which the therapists browser stores and renders
   (`public/app.js` ~L793, 2716–3628) for every signed-in session.
   **Managers (Oren/Shahar) are coordinators and DO receive debt amounts today**
   (the debt gate needs them), so stripping for "non-coordinators" would not help
   them. Removing amounts is a **release blocker** (Sandra, 2026-10-18): a separate
   PR that leaves billing math and the debt block/approval path alone (scope in the
   therapists repo, `docs/amount-owed-removal-scope.md`). Documentation does not
   complete it; do not claim "no amounts reach managers" until it ships.
3. This draft's own confidentiality is enforced by construction (separate
   secrets, allowlisted builders, tests), not by deleting known price fields.

## Overlap with PR #121 (extra-charge journal, draft, not touched)

#121 (`codex/op02-extra-charge-journal-20261018`, head `b5cad10`) changes 20 files.
Shared with this change: `apps-script/Code.gs`, `public/app.js`, `public/index.html`,
`public/sw.js`, `CHANGELOG.md`, `DEPLOY.md`, `README.md`, `EZONE-ECOSYSTEM-STATUS.md`,
`docs/USER-GUIDE.he.md`, `docs/source-auth-boundary.md`,
`test/financial-save-browser.test.js`, `test/nightly-backup-data.test.js`.

Risks for the second PR to merge:

* **Service-worker version collision** — both set `ezone-outpatient-v12`. The
  second merge must re-bump from the **live** version.
* **Backup** — both extend `_integrityCaptureData`/restore tests; the manifest
  row-count and `length` assertions (`8 → 10` here) must be recombined.
* **`financial-save-browser.test.js`** — #121's new tests log in as `ירדן`; she is
  retired here (user-less fallback), so use another current name.
* Textual conflicts in `Code.gs` (adjacent top-level additions), `app.js`/`index.html`
  (tab list, script tags), changelog/docs.
No behavioural dependency: this feature touches no charge/payment/renewal path.

## Release (later approval — not executed)

1. Sandra approves this PR → merge on `claude/youthful-volta-laarnk`.
2. Poll `/api/version` until `commit` = the merge SHA; check `/healthz`.
3. `apps-script/**` changed → dispatch **Deploy Apps Script** (Actions → Run
   workflow, branch `claude/youthful-volta-laarnk`) with `expected_commit` = the
   full merge SHA. It republishes the **existing** deployment. Never paste `Code.gs`,
   never create a new deployment. There is **no push trigger**.
4. Set the configuration above, run the one-time import, then implement and test
   the therapists side.
