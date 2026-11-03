-- Durable Meta delivery-event audit, ordering, and suppression integrity.

ALTER TABLE outbound_messages
  ADD COLUMN provider_status_at TIMESTAMPTZ,
  ADD CONSTRAINT outbound_messages_id_workspace_id_key UNIQUE (id, workspace_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM customer_suppressions AS suppression
    LEFT JOIN customers AS customer
      ON customer.id = suppression.customer_id
     AND customer.workspace_id = suppression.workspace_id
    WHERE customer.id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot add workspace-scoped suppression constraint: mismatched customer/workspace records exist';
  END IF;
END
$$;

ALTER TABLE customer_suppressions
  ADD CONSTRAINT customer_suppressions_customer_workspace_fkey
  FOREIGN KEY (customer_id, workspace_id)
  REFERENCES customers (id, workspace_id)
  ON DELETE CASCADE;

CREATE UNIQUE INDEX outbound_messages_workspace_provider_message_id_uidx
  ON outbound_messages (workspace_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

DROP INDEX IF EXISTS outbound_messages_workspace_provider_message_id_idx;

CREATE TABLE whatsapp_delivery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT NOT NULL
    CHECK (event_key ~ '^[0-9a-f]{64}$'),
  workspace_id UUID NOT NULL
    REFERENCES workspaces(id) ON DELETE CASCADE,
  outbound_message_id UUID,
  provider_message_id TEXT NOT NULL
    CHECK (char_length(btrim(provider_message_id)) BETWEEN 1 AND 512),
  phone_number_id TEXT NOT NULL
    CHECK (char_length(btrim(phone_number_id)) BETWEEN 5 AND 32),
  provider_status TEXT NOT NULL
    CHECK (char_length(btrim(provider_status)) BETWEEN 1 AND 64),
  provider_timestamp TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duplicate_count INTEGER NOT NULL DEFAULT 0
    CHECK (duplicate_count >= 0),
  processing_outcome TEXT NOT NULL
    CHECK (processing_outcome IN ('processing', 'processed', 'ignored', 'failed')),
  processing_reason TEXT
    CHECK (processing_reason IS NULL OR char_length(processing_reason) <= 500),
  failure_reason TEXT
    CHECK (failure_reason IS NULL OR char_length(failure_reason) <= 500),
  CONSTRAINT whatsapp_delivery_events_workspace_event_key
    UNIQUE (workspace_id, event_key),
  CONSTRAINT whatsapp_delivery_events_outbound_workspace_fkey
    FOREIGN KEY (outbound_message_id, workspace_id)
    REFERENCES outbound_messages (id, workspace_id)
    ON DELETE RESTRICT
);

CREATE INDEX whatsapp_delivery_events_workspace_received_idx
  ON whatsapp_delivery_events (workspace_id, received_at DESC, id);

CREATE INDEX whatsapp_delivery_events_outbound_provider_timestamp_idx
  ON whatsapp_delivery_events (outbound_message_id, provider_timestamp DESC)
  WHERE outbound_message_id IS NOT NULL;
