-- Correct historical customer first_seen_at values.
--
-- Migration 009 backfilled customers.first_seen_at from the conversation's last
-- activity, so a customer with more than one inbound message recorded the most
-- recent message as its first-seen time. This migration recomputes the value
-- from the earliest associated inbound message instead.
--
-- This is an additive data correction only:
--   * no customer, conversation, or message rows are deleted or recreated;
--   * customer/conversation/message relationships are untouched;
--   * last_seen_at is preserved as the latest known activity;
--   * customers without an inbound message fall back to their created_at.
--
-- It is idempotent: a second run finds every value already correct and performs
-- no updates (the IS DISTINCT FROM guard also avoids unnecessary writes).
WITH inbound_bounds AS (
  SELECT
    target.id AS customer_id,
    MIN(message.provider_timestamp) AS first_inbound_at
  FROM customers AS target
  LEFT JOIN whatsapp_messages AS message
    ON message.workspace_id = target.workspace_id
   AND message.customer_id = target.id
   AND message.direction = 'inbound'
  GROUP BY target.id
)
UPDATE customers AS customer
SET first_seen_at = COALESCE(
      inbound_bounds.first_inbound_at,
      customer.created_at
    ),
    updated_at = now()
FROM inbound_bounds
WHERE inbound_bounds.customer_id = customer.id
  AND customer.first_seen_at IS DISTINCT FROM COALESCE(
        inbound_bounds.first_inbound_at,
        customer.created_at
      );

-- Rollback (manual; this migration runner has no down migrations):
--   This is a data correction with no safe automatic inverse. Restoring the
--   previous (incorrect) values would require re-running migration 009's
--   last-activity expression, which would reintroduce the bug.
