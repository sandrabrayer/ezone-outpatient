# OP-03 native Google drill — 2026-10-26

All five phases **PASS** on the synthetic fixture. This closes isolated
round-trip acceptance for candidate
`09a00ab5e9d057c3d3c1913f93415fb949233860`. It is not production certification,
a production restore, an approved manual-tab exception or release approval.
The approval pin remains blank. No production code or data was changed.

## Provenance and isolation

New standalone [test project](https://script.google.com/home/projects/1Pb1fn4r__aeRFyha-IweLjgfy8QN50WzBAfML9SGrl-GiV3OHvwkJ2Ub/edit),
named `OP03 SYNTHETIC NOT PRODUCTION 20261026 PR125`, was created in Sandra's
account. Project Settings initially showed no Script Properties.

The dedicated harness was built from the candidate and bound to that project.
The entire saved editor file was copied back and compared with the fresh build:
exact equality, 116,221 characters / 117,842 UTF-8 bytes. The repository's
generated file remains unbound; no execution-specific binding was committed.

Runtime: V8; default project and workbook timezone: `America/Los_Angeles`.
Report timestamps below are UTC. This fixture passing does not resolve the
separate date-helper drift tracked under OP-02.

Initial auto-detected consent included Sheets and third-party UI; it was
cancelled without granting access. The test manifest was explicitly limited to
`https://www.googleapis.com/auth/spreadsheets`. The revised screen was inspected
and Sandra completed consent. This scope covers all account Sheets; only the
reviewed harness restricts operations to its three newly created IDs. No mail,
external-fetch, Drive, deployment or trigger permission was granted.
The project remains authorized; no automatic revocation is claimed.

Before capture, all three files had `shared:false` and exactly one permission,
Sandra as owner. The same metadata check passed after all five phases. Target
metadata initially showed only default Sheet1; restore checked it was empty.
No deployment or scheduled trigger was created. Authorization prompts before
the first run produced zero executions. The final execution list showed exactly
five Editor executions, all Completed. No phase was rerun or reset.

Source SHA-256:
`928958b4427d08fde649e1e0c9f7e5401fea703dad84003a74d1c0ca640ce6bc`

Helper SHA-256:
`8c7286d432cb5099a4de671e2b2f194397f58bb2837d998c61366ba5b93edcff`

Project-bound drill-definition SHA-256:
`88f83a34f11b9a45f52bd8e6a7e2c8456046d50c83a16d51d229818b0e706741`

## Retained artifacts

Tag: `f5c48aa7-92c6-43ec-b1db-7916c6c036c8`. Each name begins with
`OP03 SYNTHETIC NOT PRODUCTION` and ends with its role.

- [Source](https://docs.google.com/spreadsheets/d/1WlaKF8Tok7NYDO16efir90LbqZ6FAlfqaPBq8P4aMfI/edit?usp=drivesdk)
- [Backup and _DrillReport](https://docs.google.com/spreadsheets/d/18njYPOj-oXD3s5J-shRNHbUNYxmflZUN0ZDMYyM3kkc/edit?usp=drivesdk)
- [Restored target](https://docs.google.com/spreadsheets/d/17N_foD_ee9BHSRlROdpK6s-Qw0ZjvjcMHP5HFxfCFbk/edit?usp=drivesdk)

[Raw report and redacted permission observations](op03-google-drill-2026-10-26.json)
were read through the Google connector after native execution. All artifacts
and phase markers were retained. The owner account was verified during the
reads; personal email addresses are redacted in the committed permission copy.

## Results and timings

| Phase | Report timestamp (UTC) | Report ms | Logger ms | Google execution s | Result |
| --- | --- | ---: | ---: | ---: | --- |
| prepare | 08:21:41.829 | 22,487 | 22,696 | 24.263 | PASS |
| capture | 08:24:07.838 | 40,505 | 40,639 | 42.091 | PASS |
| restore | 08:26:16.048 | 32,436 | 32,634 | 34.744 | PASS |
| verify | 08:28:17.837 | 46,004 | 46,300 | 48.542 | PASS |
| manual | 08:30:31.860 | 59,658 | 59,851 | 61.297 | PASS |

Report timing is sampled before its write; logger timing follows report/state
writes; Google's duration includes execution overhead. The longest execution
was 61.297 s. This small fixture is not a production-volume or quota benchmark.

Actual reviewed source helpers, using native Sheets, verified twenty manifest
entries (nineteen registered datasets plus metadata), optional absence, native
copy into a distinct empty target and exact typed readback. Values included
literal strings, leading zeroes, booleans, numbers and a Date instant.

The real recovery finish/journal/cache path passed. Missing SessionLog,
unverified configuration and the original source as target were refused.
Renewal, extra-charge, cancellation and paid-session retries left Payments,
ClientCharges, FinancialOps and Clients unchanged. The two session rows kept
the payroll forwarding stamp and configured rate 777. Catalog, approved quote,
audit scalar types and the source grids survived operational verification.

The final phase separately preserved synthetic empty Sheet1 and Copy of Clients
in a second snapshot, then correctly refused certification with a blank pin.
It intentionally adds those tabs to the synthetic source; the source-unchanged
assertion belongs to the earlier verify phase.

## Remaining gates and exact return point

The successful manual-policy branch and its repeated final proof were **not**
executed natively; no real recovery evidence packet or code pin exists. This
drill does not establish actual archive correctness/native properties,
production configuration, scheduled admission/drain/retention, mail delivery
or production-scale timing.

Next collect trigger/timezone/alert/configuration evidence and contemporaneous
real manual-tab evidence during an agreed writer pause. Review the exact target
policy and its native acceptance/timing before enabling any exception. Keep the
pin empty and PR125 in draft. Sandra's separate production approval remains
required before the ordered Node/Apps Script release.
