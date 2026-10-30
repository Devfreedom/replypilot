-- Customer and conversation foundation for the WhatsApp inbox.
--
-- Additive only: existing leads stay a separate concept, existing inbound
-- messages keep their identity, and every existing conversation/message is
-- backfilled from the provider identifiers already stored on it. Nothing is
-- deleted or rewritten.

-- 1. WhatsApp connections ---------------------------------------------------
--
-- Each provider phone-number ID is resolved to one connection row per
-- workspace. The schema allows additional connections later; this milestone
-- only resolves the single configured number.
CREATE TABLE whatsapp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL
    REFERENCES workspaces(id) ON DELETE RESTRICT,
  phone_number_id TEXT NOT NULL
    CHECK (
      char_length(phone_number_id) BETWEEN 5 AND 32
      AND phone_number_id ~ '^[0-9]+$'
    ),
  display_phone_number TEXT
    CHECK (
      display_phone_number IS NULL
      OR char_length(btrim(display_phone_number)) BETWEEN 5 AND 32
    ),
  label TEXT
    CHECK (
      label IS NULL
      OR char_length(btrim(label)) BETWEEN 1 AND 120
    ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_connections_workspace_phone_number_key
    UNIQUE (workspace_id, phone_number_id),
  -- Parent key for the composite conversation foreign key.
  CONSTRAINT whatsapp_connections_id_workspace_id_key
    UNIQUE (id, workspace_id)
);

CREATE INDEX whatsapp_connections_workspace_created_idx
  ON whatsapp_connections (workspace_id, created_at ASC, id);

INSERT INTO whatsapp_connections (workspace_id, phone_number_id)
SELECT DISTINCT workspace_id, phone_number_id
FROM whatsapp_conversations
ON CONFLICT (workspace_id, phone_number_id) DO NOTHING;

-- 2. Customers --------------------------------------------------------------
--
-- A customer is workspace-scoped contact identity, deliberately separate from
-- leads. phone_e164 is the canonical identity when a phone number is known;
-- provider_contact_id preserves the original provider identifier (for example
-- a business-scoped WhatsApp user ID) when it is not.
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL
    REFERENCES workspaces(id) ON DELETE RESTRICT,
  phone_e164 TEXT
    CHECK (
      phone_e164 IS NULL
      OR phone_e164 ~ '^\+[1-9][0-9]{4,14}$'
    ),
  provider_contact_id TEXT
    CHECK (
      provider_contact_id IS NULL
      OR (
        char_length(provider_contact_id) BETWEEN 5 AND 256
        AND provider_contact_id ~ '^[A-Za-z0-9._-]+$'
      )
    ),
  display_name TEXT
    CHECK (
      display_name IS NULL
      OR char_length(btrim(display_name)) BETWEEN 1 AND 200
    ),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customers_identity_present_check
    CHECK (phone_e164 IS NOT NULL OR provider_contact_id IS NOT NULL),
  -- Parent key for composite customer foreign keys.
  CONSTRAINT customers_id_workspace_id_key UNIQUE (id, workspace_id)
);

-- Phone identity is unique per workspace, never globally.
CREATE UNIQUE INDEX customers_workspace_phone_e164_uidx
  ON customers (workspace_id, phone_e164)
  WHERE phone_e164 IS NOT NULL;
CREATE UNIQUE INDEX customers_workspace_provider_contact_uidx
  ON customers (workspace_id, provider_contact_id)
  WHERE provider_contact_id IS NOT NULL;
CREATE INDEX customers_workspace_last_seen_idx
  ON customers (workspace_id, last_seen_at DESC, id);

-- Backfill one customer per distinct sender identity already stored on a
-- conversation. Numeric WhatsApp IDs that are not valid E.164 are kept as the
-- provider identifier rather than guessed or discarded.
INSERT INTO customers (
  workspace_id,
  phone_e164,
  provider_contact_id,
  display_name,
  first_seen_at,
  last_seen_at
)
SELECT DISTINCT ON (conversation.workspace_id, conversation.customer_wa_id)
  conversation.workspace_id,
  CASE
    WHEN conversation.customer_wa_id ~ '^[1-9][0-9]{4,14}$'
      THEN '+' || conversation.customer_wa_id
    ELSE NULL
  END,
  CASE
    WHEN conversation.customer_wa_id ~ '^[1-9][0-9]{4,14}$'
      THEN NULL
    ELSE conversation.customer_wa_id
  END,
  conversation.contact_name,
  COALESCE(conversation.last_message_at, conversation.created_at),
  COALESCE(conversation.last_message_at, conversation.created_at)
FROM whatsapp_conversations AS conversation
ORDER BY
  conversation.workspace_id,
  conversation.customer_wa_id,
  conversation.created_at ASC
ON CONFLICT DO NOTHING;

-- 3. Conversations ----------------------------------------------------------
ALTER TABLE whatsapp_conversations
  ADD COLUMN customer_id UUID,
  ADD COLUMN whatsapp_connection_id UUID,
  ADD COLUMN channel TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (channel = 'whatsapp'),
  ADD COLUMN status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'archived'));

UPDATE whatsapp_conversations AS conversation
SET customer_id = customer.id
FROM customers AS customer
WHERE customer.workspace_id = conversation.workspace_id
  AND (
    (
      conversation.customer_wa_id ~ '^[1-9][0-9]{4,14}$'
      AND customer.phone_e164 = '+' || conversation.customer_wa_id
    )
    OR (
      conversation.customer_wa_id !~ '^[1-9][0-9]{4,14}$'
      AND customer.provider_contact_id = conversation.customer_wa_id
    )
  );

UPDATE whatsapp_conversations AS conversation
SET whatsapp_connection_id = connection.id
FROM whatsapp_connections AS connection
WHERE connection.workspace_id = conversation.workspace_id
  AND connection.phone_number_id = conversation.phone_number_id;

-- Every conversation above is derived from stored provider identifiers, so a
-- NULL here means the backfill could not associate the record safely. Failing
-- inside the migration transaction rolls the whole change back instead of
-- silently dropping history.
ALTER TABLE whatsapp_conversations
  ALTER COLUMN customer_id SET NOT NULL,
  ALTER COLUMN whatsapp_connection_id SET NOT NULL;

-- Defensive: if historic data already contains more than one active
-- conversation for the same customer and connection, keep the most recently
-- active one and archive the rest so no history is deleted.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY workspace_id, customer_id, whatsapp_connection_id
      ORDER BY last_message_at DESC NULLS LAST, created_at DESC, id DESC
    ) AS position
  FROM whatsapp_conversations
  WHERE status IN ('open', 'closed')
)
UPDATE whatsapp_conversations AS conversation
SET status = 'archived', updated_at = now()
FROM ranked
WHERE conversation.id = ranked.id
  AND ranked.position > 1;

-- At most one open or closed conversation per customer and connection.
-- Archived conversations are excluded so a later inbound message can start a
-- new conversation instead of reopening old history.
CREATE UNIQUE INDEX whatsapp_conversations_active_customer_connection_uidx
  ON whatsapp_conversations (
    workspace_id,
    customer_id,
    whatsapp_connection_id
  )
  WHERE status IN ('open', 'closed');

-- The old constraint allowed only one conversation per customer and provider
-- number forever. Conversations now represent a thread over time.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT con.conname
  INTO constraint_name
  FROM pg_constraint AS con
  WHERE con.conrelid = 'whatsapp_conversations'::regclass
    AND con.contype = 'u'
    AND con.conkey = ARRAY[
      (
        SELECT attribute.attnum
        FROM pg_attribute AS attribute
        WHERE attribute.attrelid = 'whatsapp_conversations'::regclass
          AND attribute.attname = 'workspace_id'
      ),
      (
        SELECT attribute.attnum
        FROM pg_attribute AS attribute
        WHERE attribute.attrelid = 'whatsapp_conversations'::regclass
          AND attribute.attname = 'phone_number_id'
      ),
      (
        SELECT attribute.attnum
        FROM pg_attribute AS attribute
        WHERE attribute.attrelid = 'whatsapp_conversations'::regclass
          AND attribute.attname = 'customer_wa_id'
      )
    ]::SMALLINT[];

  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE whatsapp_conversations DROP CONSTRAINT %I',
      constraint_name
    );
  END IF;
END $$;

ALTER TABLE whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_customer_workspace_fkey
    FOREIGN KEY (customer_id, workspace_id)
    REFERENCES customers(id, workspace_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT whatsapp_conversations_connection_workspace_fkey
    FOREIGN KEY (whatsapp_connection_id, workspace_id)
    REFERENCES whatsapp_connections(id, workspace_id)
    ON DELETE RESTRICT,
  -- Parent key that keeps a message's customer aligned with its conversation.
  ADD CONSTRAINT whatsapp_conversations_id_workspace_customer_key
    UNIQUE (id, workspace_id, customer_id);

CREATE INDEX whatsapp_conversations_workspace_status_activity_idx
  ON whatsapp_conversations (
    workspace_id,
    status,
    last_message_at DESC NULLS LAST,
    created_at DESC,
    id
  );
CREATE INDEX whatsapp_conversations_workspace_customer_idx
  ON whatsapp_conversations (
    workspace_id,
    customer_id,
    last_message_at DESC NULLS LAST,
    id
  );
CREATE INDEX whatsapp_conversations_workspace_connection_idx
  ON whatsapp_conversations (workspace_id, whatsapp_connection_id);
CREATE INDEX whatsapp_conversations_workspace_customer_wa_id_idx
  ON whatsapp_conversations (
    workspace_id,
    phone_number_id,
    customer_wa_id
  );

-- 4. Inbound messages -------------------------------------------------------
ALTER TABLE whatsapp_messages
  ADD COLUMN customer_id UUID;

UPDATE whatsapp_messages AS message
SET customer_id = conversation.customer_id
FROM whatsapp_conversations AS conversation
WHERE conversation.id = message.conversation_id
  AND conversation.workspace_id = message.workspace_id;

ALTER TABLE whatsapp_messages
  ALTER COLUMN customer_id SET NOT NULL;

-- The message's customer is enforced to match its conversation's customer.
ALTER TABLE whatsapp_messages
  ADD CONSTRAINT whatsapp_messages_conversation_customer_workspace_fkey
    FOREIGN KEY (conversation_id, workspace_id, customer_id)
    REFERENCES whatsapp_conversations(id, workspace_id, customer_id)
    ON DELETE CASCADE;

CREATE INDEX whatsapp_messages_workspace_customer_timestamp_idx
  ON whatsapp_messages (
    workspace_id,
    customer_id,
    provider_timestamp DESC,
    created_at DESC,
    id
  );

-- Rollback (manual; this migration runner has no down migrations):
--   DROP INDEX IF EXISTS whatsapp_messages_workspace_customer_timestamp_idx;
--   ALTER TABLE whatsapp_messages
--     DROP CONSTRAINT IF EXISTS whatsapp_messages_conversation_customer_workspace_fkey,
--     DROP COLUMN IF EXISTS customer_id;
--   DROP INDEX IF EXISTS whatsapp_conversations_workspace_customer_wa_id_idx;
--   DROP INDEX IF EXISTS whatsapp_conversations_workspace_connection_idx;
--   DROP INDEX IF EXISTS whatsapp_conversations_workspace_customer_idx;
--   DROP INDEX IF EXISTS whatsapp_conversations_workspace_status_activity_idx;
--   ALTER TABLE whatsapp_conversations
--     DROP CONSTRAINT IF EXISTS whatsapp_conversations_id_workspace_customer_key,
--     DROP CONSTRAINT IF EXISTS whatsapp_conversations_connection_workspace_fkey,
--     DROP CONSTRAINT IF EXISTS whatsapp_conversations_customer_workspace_fkey,
--     DROP COLUMN IF EXISTS status,
--     DROP COLUMN IF EXISTS channel,
--     DROP COLUMN IF EXISTS whatsapp_connection_id,
--     DROP COLUMN IF EXISTS customer_id;
--   ALTER TABLE whatsapp_conversations
--     ADD CONSTRAINT whatsapp_conversations_workspace_id_phone_number_id_custome_key
--     UNIQUE (workspace_id, phone_number_id, customer_wa_id);
--   DROP INDEX IF EXISTS whatsapp_conversations_active_customer_connection_uidx;
--   DROP TABLE IF EXISTS customers;
--   DROP TABLE IF EXISTS whatsapp_connections;
