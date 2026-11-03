# OP-BILL-01 integrated release candidate — 3 November 2026

Continue existing #162 on deployed #158/#161, preserving its 2 November acceptance correction. Reuse CRM #148 (includes #142–147 and Dana's server money boundary) and OP-03 #160 (includes #139). No parallel PR or replacement billing/CRM engine. Retain and validate the compatible dependency patches from #139.

Eight reproduced failures: six CRM mutation actions could wait for the lock and write after recovery started; two reads could create missing sheets. The three mutation entry points now check the hold inside the lock. Reads return empty collections for absent tables without creating/expanding a schema. Twenty source-backed cases cover admission, queued hold, busy lock and reads.

Backup tests now assert an independently enumerated complete source set rather than old counts. Pre-CRM cases explicitly omit schemas; current schemas match exact expected headers. Typed capture, checksum tampering, half-present pairs and old opaque snapshots remain fail-closed.

The historical generated drill is byte-for-byte unchanged. A separate disabled candidate runner restores a real source-created contact and follow-up and verifies replay has no extra task/event. Manual-policy tooling binds the exact inventory and hashes. These are synthetic tests and prepared native tooling, not fresh native Google evidence. Production approval pins remain blank.

See `docs/OP-BILL-01-INTEGRATED-RELEASE-20261103.md` for remaining native/access/approval gates.
