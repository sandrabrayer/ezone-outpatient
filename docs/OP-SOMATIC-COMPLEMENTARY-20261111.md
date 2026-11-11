# OP — Somatic complementary treatment subtype

11 Nov 2026. **DRAFT / not deployed.**

The existing treatment type `טיפול משלים` has a CLOSED subtype list; `somatic` is added as a stable allowed key, displayed `טיפול סומטי` in the plan picker and summaries. Both the UI and Apps Script validator now admit `somatic`. The stored `complementaryType` column is REUSED; no schema migration or additional treatment/charge ledger.

The user wants the active practitioner אילנה יופה categorized as somatic rather than family therapy. This PR **does not** alter any real practitioner, client plan, signed agreement, rate, scheduled session, payer or payment entry. Authorized staff should use existing roster management to ensure she is selectable under the exact registered name and has a separately reviewed complementary-treatment rate if needed. The relevant client's approved OUT plan must be explicitly changed to `טיפול משלים → טיפול סומטי` by its current owner before THR booking can use that type; old recorded family sessions must not be silently relabeled or rebilled.

THR displays this new subtype via its paired THR-08 draft. Merge/deploy OUT before THR, separately approved and with protected finance + historical record acceptance. Existing `privateTherapists` dual-individual selection is unchanged.
