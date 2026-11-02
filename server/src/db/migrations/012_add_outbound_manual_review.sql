-- Ambiguous provider outcomes must not be reported as definite failures or
-- blindly retried when the provider cannot deduplicate by idempotency key.
ALTER TABLE outbound_messages
  DROP CONSTRAINT outbound_messages_status_check;

ALTER TABLE outbound_messages
  ADD CONSTRAINT outbound_messages_status_check
  CHECK (
    status IN (
      'queued',
      'sending',
      'sent',
      'delivered',
      'failed',
      'cancelled',
      'manual_review'
    )
  );
