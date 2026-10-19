# Package feature — release checklist (OP-PKG: Outpatient #122 + Therapists #105)

**Status 2026-10-19: preparation only. Nothing below has been run. No merge, deploy, Railway change or Script-Property change is
approved.** Sandra gives the final production approval on concrete reviewed heads. This is the single checklist; the therapists
repo links here. **No step ever prints, pastes into chat, logs or commits a secret value** — checks use variable *names*,
fingerprints you generate yourself, and functional (200/503) results.

Legend: 🧑 = Sandra/operator action (Claude never changes Railway or Script Properties) · ✅ = verification · 🔒 = secret handling.

## 0. Gates (all must be true before step 3)

| Gate | Owner | State |
| --- | --- | --- |
| Outpatient #123 merged/released (`0941004`, SW v13) and Therapists #106 merged/released (`e9021a5`, SW v46) | — | shipped (reported by the reviewer; live behaviour not verified here) |
| Both package branches contain the latest deployed bases (no force-push); exact heads reviewed | Claude | see the PR descriptions |
| PDF mapping verified against the original (all 15 rows match) | Claude | **done 2026-10-19** — `docs/package-catalog.md` |
| **Business confirmations:** 18 % VAT rate; May-2026 prices still current; psychiatric consult/follow-up and diagnosis/intake distinctions; day-track/credit/Solo/continuation-owner questions | 🧑 Sandra | **open** — `docs/package-catalog.md` → "Unresolved business questions" |
| Live service-worker versions read and monotonic (Outpatient must be < `v14`, Therapists < `v47`) | 🧑 | **open** — step 1.3 (not readable from the build sandbox) |
| Final approval of the concrete heads | 🧑 Sandra | **not given** |

## 1. Pre-flight (read-only)

1. ✅ **Railway branch**: Railway → project → *ezone-outpatient* → Settings → Source: connected branch must be
   `claude/youthful-volta-laarnk`. Same for *ezone-therapists*: `claude/inspiring-tesla-jipobw`. (It is not stored in the repo.)
2. ✅ **Variable NAMES present** (Railway → service → Variables; look at names only, do not reveal values):

   | Service | Must exist | Currently (names-only check, 2026-10-19, by the reviewer) |
   | --- | --- | --- |
   | ezone-outpatient | `APP_PIN`, `SESSION_SECRET`, `OUTPATIENT_PROXY_SECRET`, **`CATALOG_ADMIN_PIN`**, **`CATALOG_ADMIN_ASSERTION_SECRET`** | the last two are **absent** |
   | ezone-therapists | `ROLE_CODES`, `OUTPATIENT_SHEETS_URL`, **`PACKAGE_CATALOG_SECRET`**, **`PACKAGE_REQUEST_SECRET`**, **`PACKAGE_WHATSAPP_NUMBER`** | the last three are **absent**; `ROLE_CODES` exists, contents unverified |
   | Outpatient Apps Script → Project Settings → Script properties | `OUTPATIENT_PROXY_SECRET`, **`CATALOG_ADMIN_ASSERTION_SECRET`**, **`PACKAGE_CATALOG_SECRET`**, **`PACKAGE_REQUEST_SECRET`** | **not inspected** — do not infer |

3. ✅ **Live SW versions** (browser DevTools → Application → Service Workers, or open `/sw.js` and read the `CACHE` line):
   Outpatient `https://ezone-outpatient.up.railway.app/sw.js` (`ezone-outpatient-vN`), Therapists
   `https://ezone-therapists.up.railway.app/sw.js` (`ezone-therapists-vN`). Record N for each. The branches carry **v14** and **v47**;
   if the live N is ≥ those numbers, the branch must be re-bumped before release (monotonic rule).
4. ✅ `https://ezone-outpatient.up.railway.app/api/version` → note `commit`; it is the base the release builds on.

## 2. Secrets and configuration (🧑 Sandra/operator, before releasing anything)

🔒 Generate **three new, distinct, random** secrets on your own machine (password manager, or `openssl rand -base64 48`), each ≥ 32
chars. Never reuse an existing secret; never type them into chat. For each, write down only a **fingerprint** (first 8 hex of its
SHA-256) so alignment can be compared later without revealing it — without leaving the value in shell history:
`read -rs S; printf %s "$S" | sha256sum | cut -c1-8; unset S` (paste the value at the silent prompt).

| # | Secret | Set in | Same value in | Notes |
| --- | --- | --- | --- | --- |
| 1 | **admin assertion** `CATALOG_ADMIN_ASSERTION_SECRET` | Outpatient **Railway** variable | Outpatient **Script property** `CATALOG_ADMIN_ASSERTION_SECRET` | ≥ 32; ≠ `OUTPATIENT_PROXY_SECRET`, ≠ `SESSION_SECRET` |
| 2 | **catalog / read** `PACKAGE_CATALOG_SECRET` | Therapists **Railway** variable | Outpatient **Script property** `PACKAGE_CATALOG_SECRET` | price-free reads + status; **not** set on Outpatient Railway |
| 3 | **request / write** `PACKAGE_REQUEST_SECRET` | Therapists **Railway** variable | Outpatient **Script property** `PACKAGE_REQUEST_SECRET` | submissions only; ≠ #2 |

All four Apps Script secrets (`CATALOG_ADMIN_ASSERTION_SECRET`, the two `PACKAGE_*`, `OUTPATIENT_PROXY_SECRET`) must be **pairwise
distinct**, otherwise Apps Script fails closed (`unauthorized`). The therapists service also refuses (503) a package secret that
is short, equal to the other, or equal to any other secret it holds.

Other configuration:

| Item | Where | Rule |
| --- | --- | --- |
| `CATALOG_ADMIN_PIN` | Outpatient Railway | **Vered alone** knows it; 8–32 chars; ≠ `APP_PIN`; not shared with anyone else |
| `PACKAGE_WHATSAPP_NUMBER` | Therapists Railway | digits only, international (e.g. 9725XXXXXXXX), `^\d{9,15}$`; destination is config only — there is no default and the browser can never set it |
| `ROLE_CODES` | Therapists Railway | `{"coordinator":{"אורן":"<6+ digit code>","שחר":"<a DIFFERENT 6+ digit code>"}}` — **distinct personal codes** for Oren and Shahar; keep every other approved setting; a single shared coordinator code lets each sign in as the other |
| `APP_PIN` + `SESSION_SECRET` rotation | Outpatient Railway | a **coordinated operator step** (signs everyone out once; revokes a leaver's shared-PIN knowledge). Do it deliberately, not as a side effect; Claude does not do it |

Railway click path: railway.com → the project → the service → **Variables** → *New Variable* → name + value → save. A variable change
applies only to deployments started **after** saving (redeploy if needed). Script properties: script.google.com → the Outpatient
project → **Project Settings** (gear) → **Script properties** → edit → Save. Never paste `Code.gs`; never create a new deployment.

### 2.1 Alignment checks that never print a value

* ✅ Fingerprints are only for the moment you enter a secret (compute it from the value you are about to paste, compare it with the one
  you recorded at generation). Railway/Script Properties are never read back for comparison — after entry, rely on the functional checks below.
* ✅ Outpatient: `GET /api/catalog-admin/status` (signed in) → `{"configured": true}` proves PIN length/difference and the
  assertion secret's presence/length/distinctness on the Node side. `false` ⇒ one of them is missing or mis-set.
* ✅ After #122 is live and the Script properties are set: Vered signs in to «תמחור חבילות» (PIN). If the Node assertion secret
  and the Script property differ, the first action answers `unauthorized` — fix #1 and retry.
* ✅ After #105 is live: as Oren, the catalog loads (15 items) ⇒ #2 aligned; a test request submits ⇒ #3 aligned.
  `503 package_not_configured` ⇒ a therapists variable is missing/short/equal/reused; `unauthorized`/`upstream_unavailable` ⇒ the
  value differs from the Script property.
* ✅ `ROLE_CODES`: sign in as Oren with Oren's code (works), then try Oren's code under Shahar's name (must be refused). Do not
  read the variable to check.

## 3. Release — #122 first (🧑 only after Sandra's final approval on the exact head)

1. Merge #122 into `claude/youthful-volta-laarnk` (draft → ready first; the PR base must stay that branch). Record the **full merge SHA**.
2. ✅ Poll `https://ezone-outpatient.up.railway.app/api/version` every 30 s (max 10 min) until `commit` equals the merge SHA; `GET /healthz` → 200.
   If it never matches, inspect the deployment status and report; do not disable checks or deploy another commit.
3. #122 changes `apps-script/**` → GitHub → Actions → **Deploy Apps Script** → *Run workflow* on `claude/youthful-volta-laarnk` with
   `expected_commit` = the full merge SHA. Wait for success and the **existing** deployment's new version (stop and recheck if the
   branch moved). Never paste `Code.gs`, never create a new deployment, **never roll the Outpatient source back to @97** (an extra-charge
   intent may exist; #121's financial journal must be preserved).
4. ✅ Time 3 requests to the production URL; record status codes and times.

## 4. Controlled enablement (🧑 Vered + Sandra)

1. Vered signs in with the app PIN + her name, opens «תמחור חבילות», enters the separate admin PIN.
2. **One-time import** («ייבוא ראשוני», idempotent — refuses if any row exists). Review the 15 rows against the verified PDF table
   in `docs/package-catalog.md`; confirm the VAT rate (assumed 18 %). Fix any row **by editing** (appends a new version; nothing is overwritten).
3. ✅ Check: exactly 15 active rows; `sourceRef` present on each; the manager-facing feed (`getPackageCatalogPublic`) carries no price.

## 5. Release #105 (Therapists) (🧑 after step 4 and final approval)

1. #105 changes **no** Apps Script paths, so no Apps Script deploy starts and none is needed. Merge into `claude/inspiring-tesla-jipobw`, record the full SHA.
2. ✅ Poll `https://ezone-therapists.up.railway.app/api/version` until `commit` equals the merge SHA; time 3 requests.
3. ✅ Smoke with **approved test data only** (never real patients):
   * **Oren** and **Shahar** (own codes): catalog shows 15 items, no price anywhere; submit a request; the confirmation shows the
     real status; the «שלח לורד בוואטסאפ» button opens `wa.me/<configured number>` with only *first name + last four digits + reference*.
   * Lost-reply drill (devtools → Offline during the submit, then back online and re-enter the tab): one row, real status, working button.
   * **Ordinary therapist** and anonymous: every `/api/packages/*` route refused (403/401).
   * **Vered**: sees the request, can adjust (with reason), approve, attach; status flips to «תומחר» for the manager; **no charge/payment is created**.
   * A deliberate wrong code for Shahar under Oren's name is refused.
4. If anything is wrong: stop; do not "fix forward" in production; report. (Rollback of Node = redeploy the previous Railway deployment; never roll the Outpatient Apps Script source back to @97.)

## 6. Rollback / abort notes

* The catalog and requests sheets are append-only; a bad catalog row is superseded by a new version, not deleted.
* Disabling the feature for managers without a deploy: remove `PACKAGE_CATALOG_SECRET`/`PACKAGE_REQUEST_SECRET` from the therapists
  Railway service (routes then answer `503 package_not_configured`) — an operator action, not Claude's.
* Residual limitations that stay documented: any holder of the shared Outpatient `APP_PIN` can read the (now session-only) price/pay
  constants after sign-in; shared per-IP / global PIN-failure caps can pause Vered's PIN entry for up to 15 minutes (a restart clears them).

## 7. Final report template (rule 7)

PR links · merge SHAs · test counts · Apps Script deploy run (Outpatient only) · `/api/version` results · 3 request timings · only the manual steps left.
