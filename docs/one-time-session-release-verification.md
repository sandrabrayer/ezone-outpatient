# One-time sessions #181 — verification checkpoint, 14 November 2026

## Status and ownership

Implementation defects described below are fixed on OUT code commit
`7db4ae28d509fe229ca441d8e453560dee1d6d8a` (parent frontend fix `e7453e2`).
Paired THR #146 code is `2a876317ae04f21ae90c78a2a281905f28905411`.
Documentation-only commits after these do not change the verified runtime/test source.
Both candidates remain DRAFT: NO production merge, deployment, secrets, catalogue or patient/financial
records were changed in this pass. Current production is not the candidate.

## Fixed defects

1. Malformed HTTP-success session/catalogue responses no longer become false empty arrays.
   `otsReadList` requires HTTP success, parsed object, `ok === true` and an actual list.
2. Accepted cancel/move/outcome followed by failed readback no longer leaves stale actionable rows
   or an ordinary success notice. State becomes unknown, an OTS-only load gap is shown, and the user
   is told not to repeat the accepted write. Recovery removes only that gap, not finance gaps.
3. Same-patient / different-therapist overlap with a regular or recurring THR booking is now checked.
   OUT reads the exact current Clients.id phone, sends it in the protected POST body, requires
   `patientChecked === true`, and revalidates the source key/target under its write lock. Exact replay
   remains before network; remote calls stay outside the global finance lock. Missing phone or old,
   failed/malformed calendar replies refuse the new booking. The old KNOWN GAP test was replaced.

## Independently observed GitHub CI

- OUT `7db4ae2`: Test run **43624981719**, both `test` and `lead-save-browser` jobs SUCCESS.
- OUT `7db4ae2`: OP03 CRM typed backup synthetic **43624981723**, SUCCESS.
- THR `2a87631`: Tests **43624098869**, SUCCESS.
- Earlier OUT frontend `e7453e2`: Test **43624065714** and OP03 **43624065678**, SUCCESS.

Author-reported focused execution on `7db4ae2`: one-time source + generated drill, **33/33 pass**.
Author-reported frontend execution on `e7453e2`: Chromium one-time browser suite **16/16 pass**,
full browser-required suite **2359/2359 pass, zero skipped**. These reports are not represented as
independently extracted CI test counts. Prior count differences between environments were not reconciled.
Ordinary Node CI may skip browser-only suites; the dedicated browser job and explicit Chromium run
are distinct evidence, not an assumption that every browser scenario ran in every CI job.

## Independent selected-source execution (synthetic only)

The coordinator/reviewer executed actual function bodies locally with synthetic dependencies:

- **14/14 assertions**: OUT `_otsExternalBusy` at `7db4ae2` connected through a synthetic transport
  adapter to exact THR busy module at `2a87631` (Git blob `dcff14bc559f8444eeb4af5cc5e9f3b198acae26`).
  Regular and recurring same-patient conflicts, different therapists, adjacent intervals, other patient,
  cancellation, exact OTS exclusion, missing phone/key, wrong key, legacy response, malformed response,
  missing source and outage. Existing selected phone helpers were reused unchanged. This is NOT a real
  Express/HTTPS/Apps Script integration test.
- **12/12 assertions**: actual `otsReadList`, `otsReload`, `otsAfterWrite` from `e7453e2`, unchanged
  by the backend patch. Malformed lists fail, readback warning replaces ordinary success, only reads
  occur, and recovery preserves existing payments/charges gaps. Rendering/transport were test doubles.
  Finance-gap preservation was explicitly verified here, not claimed as a new Chromium regression.
- **8/8 assertions**: actual OUT `_otsFeed` at `34338e7` -> actual THR `_oneTimeFeed` and
  `_syncOneTimeSessions` at `3a4655e`. Those functions were unchanged by subsequent reviewed patches.
  Price-free projection, exact UUID/field mirror, replay, move history, source terminal status without
  forged approval/pay, malformed-feed no writes, cancellation and cancellation replay. Sheets, transport,
  clock/properties and elementary cell/phone helpers were synthetic.

The OUT GitHub worker cannot read the THR repository with its installation credentials. The independent
reviewer read both through the available connector; no canned response was labelled as a full paired run.

## Remaining release gates / limitations

Explicit approval is still required for BOTH OUT #181 and THR #146 merge/deploy, the separate Apps Script
releases and secure provisioning of the two distinct dedicated keys. THR's patient-aware Node route must
be live before OUT enables its new booking path. Exact versions/cache and current catalogue must be
checked; do not blindly import. See `one-time-session-therapists-contract.md` for deployment order.

Live signed-in clinical/payment UAT has NOT been run: authorized test patient, create/replay, diary,
move/cancel, therapist outcome -> coordinator approval -> one SessionLog/pay row, unchanged quotas/credits,
operational no-money permissions and real source readback remain release acceptance steps.

Phone equality is conservative conflict prevention, never identity linking. Shared household numbers
can over-block; old appointments missing a usable phone cannot establish the patient match. THR requires
its canonical ten-digit calendar phone, so local nine-digit landlines fail closed. Residential feed has
therapist-only scope. This is not a distributed reservation against simultaneous writers in two apps.
No claim of live end-to-end acceptance or universal absence of scheduling conflicts is made.

Resume here: re-read both heads and approval scope; do not reopen old #143/#145 or repeat completed audits.
