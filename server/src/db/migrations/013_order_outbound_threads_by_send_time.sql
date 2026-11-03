-- Once a provider accepts an outbound message, order it by that recorded
-- acceptance time rather than the earlier queue time. Inbound rows are
-- unchanged, and queued outbound rows continue to use queued_at.
CREATE OR REPLACE VIEW conversation_thread_messages AS
SELECT
  message.id,
  message.workspace_id,
  message.conversation_id,
  message.direction,
  message.message_type,
  message.text_content,
  message.provider_timestamp,
  message.processing_status,
  NULL::text AS outbound_status,
  NULL::text AS outbound_failure_reason,
  message.created_at
FROM whatsapp_messages AS message
UNION ALL
SELECT
  message.id,
  message.workspace_id,
  message.conversation_id,
  'outbound'::text AS direction,
  'text'::text AS message_type,
  message.content AS text_content,
  COALESCE(message.sent_at, message.queued_at) AS provider_timestamp,
  NULL::text AS processing_status,
  message.status AS outbound_status,
  message.failure_reason AS outbound_failure_reason,
  message.created_at
FROM outbound_messages AS message;
