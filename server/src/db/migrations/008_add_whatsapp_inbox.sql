-- Single-business inbound WhatsApp test integration.
--
-- A lead may carry the exact WhatsApp phone number used for a reliable
-- conversation-to-lead match. Existing leads remain unassociated because the
-- new column is nullable; names and other uncertain signals are not used.
ALTER TABLE leads
  ADD COLUMN whatsapp_number TEXT
    CHECK (
      whatsapp_number IS NULL
      OR whatsapp_number ~ '^[0-9]{5,32}$'
    );

CREATE UNIQUE INDEX leads_workspace_whatsapp_number_uidx
  ON leads (workspace_id, whatsapp_number)
  WHERE whatsapp_number IS NOT NULL;

CREATE TABLE whatsapp_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL
    REFERENCES workspaces(id) ON DELETE RESTRICT,
  phone_number_id TEXT NOT NULL
    CHECK (
      char_length(phone_number_id) BETWEEN 5 AND 32
      AND phone_number_id ~ '^[0-9]+$'
    ),
  customer_wa_id TEXT NOT NULL
    CHECK (
      char_length(customer_wa_id) BETWEEN 5 AND 256
      AND customer_wa_id ~ '^[A-Za-z0-9._-]+$'
    ),
  contact_name TEXT
    CHECK (
      contact_name IS NULL
      OR char_length(btrim(contact_name)) BETWEEN 1 AND 200
    ),
  lead_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ,
  UNIQUE (workspace_id, phone_number_id, customer_wa_id),
  -- Parent key for the composite message foreign key.
  UNIQUE (id, workspace_id),
  CONSTRAINT whatsapp_conversations_lead_workspace_fkey
    FOREIGN KEY (lead_id, workspace_id)
    REFERENCES leads(id, workspace_id)
    ON DELETE SET NULL (lead_id)
);

CREATE INDEX whatsapp_conversations_workspace_activity_idx
  ON whatsapp_conversations (workspace_id, last_message_at DESC NULLS LAST, created_at DESC, id);
CREATE INDEX whatsapp_conversations_lead_id_idx
  ON whatsapp_conversations (lead_id)
  WHERE lead_id IS NOT NULL;

CREATE TABLE whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL
    REFERENCES workspaces(id) ON DELETE RESTRICT,
  conversation_id UUID NOT NULL,
  provider_message_id TEXT NOT NULL
    CHECK (char_length(btrim(provider_message_id)) BETWEEN 1 AND 512),
  direction TEXT NOT NULL DEFAULT 'inbound'
    CHECK (direction IN ('inbound', 'outbound')),
  message_type TEXT NOT NULL
    CHECK (char_length(btrim(message_type)) BETWEEN 1 AND 64),
  text_content TEXT
    CHECK (
      text_content IS NULL
      OR char_length(text_content) <= 10000
    ),
  provider_timestamp TIMESTAMPTZ NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'stored'
    CHECK (processing_status IN ('stored', 'unsupported')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_messages_provider_message_uidx
    UNIQUE (workspace_id, provider_message_id),
  CONSTRAINT whatsapp_messages_conversation_workspace_fkey
    FOREIGN KEY (conversation_id, workspace_id)
    REFERENCES whatsapp_conversations(id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT whatsapp_messages_processing_status_content_check
    CHECK (
      (processing_status = 'stored' AND text_content IS NOT NULL)
      OR (processing_status = 'unsupported' AND text_content IS NULL)
    )
);

CREATE INDEX whatsapp_messages_conversation_timestamp_idx
  ON whatsapp_messages (workspace_id, conversation_id, provider_timestamp ASC, created_at ASC, id);
CREATE INDEX whatsapp_messages_workspace_created_idx
  ON whatsapp_messages (workspace_id, created_at DESC, id);
