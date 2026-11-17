-- Lead WhatsApp numbers become E.164, and a conversation may be linked to a
-- lead explicitly.
--
-- A lead's WhatsApp number is now stored in E.164 ("+2348012345678"), the same
-- representation `customers.phone_e164` already uses. That makes a lead number
-- and a customer number directly comparable, which is what the linkage checks
-- need.
--
-- Existing rows are handled carefully:
--
-- - A row whose digits already match a customer in the same workspace is
--   backfilled to that customer's E.164 value. The customer row is the proof
--   that the digits belong to that country, so no country code is guessed.
-- - A row that no customer corroborates keeps its digits. Its country is
--   unknown, so it is not rewritten. A row that stores international digits
--   still matches an inbound sender with exactly those digits, which is the
--   behaviour it had before. A row that stores a national number matches no
--   international sender, because its country is unknown; the API refuses to
--   link such a lead by hand and refuses to create a second lead for the same
--   subscriber rather than guessing its country.
--
-- The unique index moves from the raw column to the E.164 value so the same
-- subscriber cannot be recorded twice, and the digit comparison stays unique
-- for the rows that keep their digits.

ALTER TABLE leads
  DROP CONSTRAINT IF EXISTS leads_whatsapp_number_check;

ALTER TABLE leads
  ADD CONSTRAINT leads_whatsapp_number_check
  CHECK (
    whatsapp_number IS NULL
    OR whatsapp_number ~ '^\+[1-9][0-9]{4,14}$'
    OR whatsapp_number ~ '^[0-9]{5,32}$'
  );

-- Backfill only the rows a same-workspace customer corroborates.
UPDATE leads AS lead
   SET whatsapp_number = customer.phone_e164
  FROM customers AS customer
 WHERE customer.workspace_id = lead.workspace_id
   AND customer.phone_e164 = '+' || lead.whatsapp_number
   AND lead.whatsapp_number ~ '^[0-9]{5,32}$';

-- The uniqueness rule now applies to the E.164 value. The digit form is kept
-- unique as well so a corroborated row and a not-yet-corroborated row that
-- describe the same subscriber cannot both exist.
--
-- A legacy row that stores a national number cannot be compared here, because
-- its country is unknown and guessing one would be wrong. Those rows are left
-- untouched, and the API refuses to create a second lead for the same
-- subscriber by comparing the candidate number against the numbering plan of
-- the candidate's own country.
DROP INDEX IF EXISTS leads_workspace_whatsapp_number_uidx;

CREATE UNIQUE INDEX leads_workspace_whatsapp_number_uidx
  ON leads (workspace_id, ltrim(whatsapp_number, '+'))
  WHERE whatsapp_number IS NOT NULL;

-- A conversation records who linked it to a lead, and when. This is the audit
-- trail for an explicit owner action.
ALTER TABLE whatsapp_conversations
  ADD COLUMN lead_linked_by UUID REFERENCES auth_users(id) ON DELETE SET NULL,
  ADD COLUMN lead_linked_at TIMESTAMPTZ;

-- Rollback (manual; this migration runner has no down migrations).
--
-- Run these statements in this order. The first statement is required: the
-- backfilled rows now hold an E.164 value with a leading "+", which the
-- original digits-only constraint would reject.
--
--   UPDATE leads
--      SET whatsapp_number = ltrim(whatsapp_number, '+')
--    WHERE whatsapp_number ~ '^\+[1-9][0-9]{4,14}$';
--
--   DROP INDEX IF EXISTS leads_workspace_whatsapp_number_uidx;
--
--   CREATE UNIQUE INDEX leads_workspace_whatsapp_number_uidx
--     ON leads (workspace_id, whatsapp_number)
--     WHERE whatsapp_number IS NOT NULL;
--
--   ALTER TABLE whatsapp_conversations
--     DROP COLUMN lead_linked_by,
--     DROP COLUMN lead_linked_at;
--
--   ALTER TABLE leads
--     DROP CONSTRAINT leads_whatsapp_number_check,
--     ADD CONSTRAINT leads_whatsapp_number_check
--       CHECK (whatsapp_number IS NULL OR whatsapp_number ~ '^[0-9]{5,32}$');
