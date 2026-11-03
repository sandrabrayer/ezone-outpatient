# OP-03 integrated native Google drill — 2026-10-27

All five phases **PASS** on the synthetic fixture at candidate
`3297311c4706cf650dbcbeb66b23c586dbc40d1c`, including the PR132 preferred-house
integration. This closes this candidate's isolated round-trip acceptance.
It is not production certification, an approved manual-tab exception, a live
restore, or release approval. The production and original harness policy pins
remain blank.

## Existing project and authorization

The existing standalone [test project](https://script.google.com/home/projects/1zZkII4vZXE-VJfSeWmYBjiobIf8CfLrrio6S1RGiZFq0qkn2VGwK4S8B/edit)
was reused, named `OP03 SYNTHETIC NOT PRODUCTION 20261026 3297311c`.
No replacement project was created and no state was reset. The historical
[October 26 candidate evidence](op03-google-drill-2026-10-26.md) and its separate
project/workbooks were not altered or rerun.

The CAPTCHA was completed using Sandra's supplied response and normal secure
sign-in. The saved Code.gs was read in full from the editor without editing:
119,399 characters / 121,088 UTF-8 bytes, identical to the retained project-bound
build. Its full-file SHA256 is
`1ddb8de07a08d5b427f0ca06e914d3da0f5394af5c17363f8c4844aeb173f773`.

The first authorization attempt produced no execution. After Sandra asked to
continue in response to the specific permission request, the agent inspected
the actual consent screen and completed consent. Google requested only
"See, edit, create, and delete all your Google Sheets spreadsheets."
The manifest explicitly contained only
`https://www.googleapis.com/auth/spreadsheets`. This is account-wide access;
the reviewed harness's exact project/workbook ID checks supply the narrower
synthetic boundary. No Drive, mail, external-fetch, deployment or trigger scope
was granted. No automatic revocation is claimed.

After consent, fresh Executions and Project Settings observations still showed
zero executions and no Script Properties. Only then was preparation started.
Each following phase required its predecessor's PASS report and a matching idle
state with no failure marker. The final list contained exactly five Editor
executions, all Completed; no phase was repeated. No deployment or trigger was
created.

Runtime was V8. The project and all three workbooks used
`America/Los_Angeles`; report timestamps below are UTC. The separate date-helper
drift work under OP-02 remains open.

## Code identity

| Identity | SHA256 |
| --- | --- |
| Production source Code.gs | `bd597c3991c0daf7dbd83ccebf634dc01c905bed62639a0d7af704fb559e6014` |
| Exact copied helper closure | `f73935f89f9dbaf9bf3b6f4908bb837783e15accb3c6597da69603b255ba4c63` |
| Project-bound drill definition | `4c9f57d33f7ffd15441005cccc81a96dfc0d2ed8b0ee1c5fcc9f20b55d93cc91` |
| Original unbound drill definition | `16ed23771260956206fced0e8c51d4a6eec1cf6ec95e9ebff051da38b6199df2` |

The repository's generated runner remains unbound and refuses execution until
explicitly bound to an isolated project. No execution-specific binding replaced
that safe default.

## Retained private artifacts

Tag: `e341511c-fa72-40ed-928d-206e4a75b826`. Each name begins with
`OP03 SYNTHETIC NOT PRODUCTION` and ends with its role.

- [Source](https://docs.google.com/spreadsheets/d/1ksrByHl88PMGkKI8RjpGvQoX8zUPZFjcvy0t36c6FLE/edit?usp=drivesdk)
- [Backup and _DrillReport](https://docs.google.com/spreadsheets/d/1UWQkFMe7U3i4A9KVnEvw09qd83xIZyhNy9nRCXsagbQ/edit?usp=drivesdk)
- [Restored target](https://docs.google.com/spreadsheets/d/1ogZ_2oWxkoSIVwJqWvjLi_3vlr8J_U31RmqBqLaDRkI/edit?usp=drivesdk)

Before capture and after all five phases, the Drive connector returned
`shared:false` and exactly one permission, Sandra as owner, for each file.
The restore phase checked the distinct target's initial single sheet was empty
before copying. The final inventories contain 13 source tabs (including the two
manual fixtures), 45 backup/report tabs and 11 restored registered tabs.

The [raw report, metadata and redacted permission observations](op03-google-drill-2026-10-27.json)
retain the exact current-candidate evidence. Personal email addresses are
redacted in that repository copy. The workbook contents are synthetic.

## Results and timings

| Phase | Report timestamp (UTC) | Report ms | Logger ms | Google execution s | Result |
| --- | --- | ---: | ---: | ---: | --- |
| prepare | 13:22:17.127 | 33,792 | 34,060 | 35.615 | PASS |
| capture | 13:24:37.780 | 53,601 | 54,085 | 55.475 | PASS |
| restore | 13:26:12.416 | 36,877 | 37,029 | 39.284 | PASS |
| verify | 13:27:59.006 | 43,697 | 43,868 | 45.727 | PASS |
| manual | 13:30:20.246 | 79,834 | 80,050 | 81.587 | PASS |

Report time is sampled before its write, logger time after report/state writes,
and Google's execution duration includes execution overhead. The longest
execution was 81.587 seconds. These small synthetic fixtures do not establish
production-scale performance or approved-policy double-proof timing.

The exact source helpers, running with native Sheets, verified 20 manifest
entries: 19 registered datasets and recovery metadata, including explicit
optional absence. Native copies into the distinct target matched typed grids.
Literal strings, leading zeroes, booleans, numbers and the audit Date survived.

The real finish/journal/cache path passed. Unverified configuration, the
original source as target, and a missing SessionLog were refused. A
preferred-house write while held was refused without changing Clients, and the
preferred-house value survived recovery. Renewal, extra-charge, cancellation
and paid-session retries left Payments, ClientCharges, FinancialOps and Clients
unchanged. The payroll forwarding stamp, configured rate 777, catalog, approved
synthetic quote and audit scalar types survived verification.

The last phase intentionally added empty Sheet1 and a separate synthetic
Copy of Clients archive to the synthetic source. Both were preserved in the
22-entry `2099-12-31` snapshot set, and certification was correctly refused with
the blank policy pin. The source-unchanged assertion belongs to the preceding
verify phase; it does not claim that the final phase left source inventory
unchanged.

## Exact return point and limits

`OP03_DRILL_STATE.phase` is `manual_block_verified`; `running` is false;
`failed` is absent. Its exact raw UTF-8 SHA256 is
`47ac4ce4c4372b9bfa85fb6d254f6c008c73a46e9a67db6eff422f28ba25e55f`.
The raw state string and final namespaced fixture properties are retained in
the JSON evidence. The fixture recovery hold is absent. Preserve all five
report rows, source/backup/target artifacts and original Code.gs. Do not reset
or rerun them.

The approved manual-policy success branch and its two internal proofs have not
run in this evidence set. They require a separately identified extension in
this same test project, its own state/report/cache/property namespaces, a fresh
coordinated synthetic capture/native copy and private empty target, and a fixed
test-only policy bound to actual retained evidence. No production pin is enabled
by this result.

Real manual-tab evidence, production configuration and a current-schema v2 set,
alert delivery, release readiness and Sandra's separate production approval
remain open. This drill did not execute the scheduled nightly job, send mail,
test retention/drain at production volume, merge PR125 or deploy either tier.
