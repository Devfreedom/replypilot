-- Meta WhatsApp Cloud API outbound support.
--
-- 1. Widens outbound_messages.content to match WhatsApp's 4096-character limit.
-- 2. Adds an index on outbound_messages.provider_message_id to support
--    efficient delivery-status webhook lookups by wamid.
-- 3. Adds customer_suppressions for workspace-scoped opt-out/block records.

-- 1. Widen outbound content limit to match WhatsApp's 4096-character cap ------
ALTER TABLE outbound_messages
  DROP CONSTRAINT IF EXISTS outbound_messages_status_check;

ALTER TABLE outbound_messages
  ADD CONSTRAINT outbound_messages_status_check
  CHECK (
    status IN (
      'queued',
      'sending',
      'sent',
      'delivered',
      'read',
      'failed',
      'cancelled',
      'manual_review'
    )
  );

ALTER TABLE outbound_messages
  DROP CONSTRAINT IF EXISTS outbound_messages_content_check;

ALTER TABLE outbound_messages
  ADD CONSTRAINT outbound_messages_content_check
  CHECK (char_length(btrim(content)) BETWEEN 1 AND 4096);

-- 2. Delivery-status webhook lookup by wamid --------------------------------
--
-- provider_message_id is set when Meta accepts a message. Delivery events
-- from the webhook carry the same wamid and must be matched back to the row
-- without a full table scan.
CREATE INDEX outbound_messages_workspace_provider_message_id_idx
  ON outbound_messages (workspace_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- 3. Customer suppressions --------------------------------------------------
--
-- A minimal workspace-scoped opt-out / block list. Suppressed customers must
-- never receive outbound messages, regardless of conversation status or the
-- service window. This is deliberately separate from leads and not a marketing
-- consent management system.
CREATE TABLE customer_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL
    REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL
    REFERENCES customers(id) ON DELETE CASCADE,
  reason TEXT NOT NULL
    CHECK (
      reason IN ('opt_out', 'blocked', 'admin')
    ),
  notes TEXT
    CHECK (notes IS NULL OR char_length(btrim(notes)) <= 500),
  suppressed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  suppressed_by UUID
    REFERENCES auth_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_suppressions_workspace_customer_key
    UNIQUE (workspace_id, customer_id)
);

CREATE INDEX customer_suppressions_workspace_customer_idx
  ON customer_suppressions (workspace_id, customer_id);

-- Rollback (manual):
--   DROP TABLE IF EXISTS customer_suppressions;
--   DROP INDEX IF EXISTS outbound_messages_workspace_provider_message_id_idx;
--   ALTER TABLE outbound_messages DROP CONSTRAINT IF EXISTS outbound_messages_content_check;
--   ALTER TABLE outbound_messages ADD CONSTRAINT outbound_messages_content_check
--     CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000);
