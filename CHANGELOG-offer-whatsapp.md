# Offer message by WhatsApp — prepared, human-approved, manual «sent» (2026-11-03)

Section 6 of the E-ZONE One Outpatient CRM brief.

## Behaviour
- On a ready / sent / awaiting offer: **«💬 הכן הודעת WhatsApp»** opens a panel with the recipient
  (**אורן** — number from Settings, or **מספר אחר**), an editable message (name, items, total incl.
  VAT, validity, signature — **no medical details**) and a follow-up date.
- **«📲 פתיחת WhatsApp»** opens `https://wa.me/972…?text=…` in a new tab. The recipient is validated
  as `/^0\d{9}$/` (or `+972…`) before normalisation to international format. **Opening WhatsApp
  changes nothing** — nothing is sent automatically.
- **«✔ סמן כנשלחה»** is the manual confirmation: `adminSetPackageRequestStatus { status:'sent',
  sentTo, followUpDate }` records when / to whom / follow-up, writes an `offer_sent` Activity event
  (money-flagged) and the follow-up appears in «היום שלי».
- Sender account: `wa.me` cannot choose the sending number; the panel says so and no sender picker is
  shown (no verified WhatsApp Business connection exists).
- **Oren's number is a setting** (⚙️ הגדרות → «WhatsApp של אורן», Settings sheet key `orenWhatsapp`,
  validated client- and server-side at use), never a constant in code.

## Tests
Covered by `test/offers-crm.test.js` (recipient validation, open ≠ sent, static guard: no phone
number in code, message without medical terms) and `test/offers-crm-browser.test.js` (number from the
settings in the `wa.me` URL, status unchanged until «סמן כנשלחה»).
