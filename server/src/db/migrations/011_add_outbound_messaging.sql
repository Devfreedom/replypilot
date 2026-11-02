-- Workspace messaging preferences, approval snapshots, and the outbound queue.
--
-- Additive only: inbound WhatsApp records keep their identity and existing
-- reply drafts keep their content. The outbound queue is deliberately separate
-- from whatsapp_messages so provider acceptance can be tracked without
-- pretending a queued message has been delivered.

-- 1. Workspace messaging preferences ---------------------------------------
CREATE TABLE workspace_messaging_settings (
  workspace_id UUID PRIMARY KEY
    REFERENCES workspaces(id) ON DELETE CASCADE,
  default_approval_send_policy TEXT NOT NULL DEFAULT 'approve_only'
    CHECK (
      default_approval_send_policy IN ('approve_only', 'approve_and_send')
    ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO workspace_messaging_settings (workspace_id)
SELECT id
FROM workspaces
ON CONFLICT (workspace_id) DO NOTHING;

-- 2. Draft approval audit fields -------------------------------------------
--
-- approved_by is nullable for historical approvals created before this
-- migration. approval_send_policy is the effective policy snapshot at approval
-- time, so later workspace preference changes cannot rewrite history.
ALTER TABLE reply_drafts
  ADD COLUMN approved_by UUID
    REFERENCES auth_users(id) ON DELETE SET NULL,
  ADD COLUMN send_policy_override TEXT
    CHECK (
      send_policy_override IS NULL
      OR send_policy_override IN ('approve_only', 'approve_and_send')
    ),
  ADD COLUMN approval_send_policy TEXT
    CHECK (
      approval_send_policy IS NULL
      OR approval_send_policy IN ('approve_only', 'approve_and_send')
    ),
  -- Parent key for the composite outbound foreign key. A draft can only
  -- produce outbound records in its own workspace.
  ADD CONSTRAINT reply_drafts_id_workspace_id_key UNIQUE (id, workspace_id);

-- 3. Outbound messages ------------------------------------------------------
--
-- One outbound record per draft. This is the database-level duplicate guard
-- for repeated approval/manual-send requests. The idempotency key is also
-- passed to the provider so retries cannot create a second provider message.
CREATE TABLE outbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL
    REFERENCES workspaces(id) ON DELETE RESTRICT,
  conversation_id UUID NOT NULL,
  reply_draft_id UUID NOT NULL,
  provider TEXT NOT NULL
    CHECK (char_length(btrim(provider)) BETWEEN 1 AND 50),
  provider_message_id TEXT
    CHECK (
      provider_message_id IS NULL
      OR char_length(btrim(provider_message_id)) BETWEEN 1 AND 512
    ),
  content TEXT NOT NULL
    CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (
      status IN (
        'queued',
        'sending',
        'sent',
        'delivered',
        'failed',
        'cancelled'
      )
    ),
  idempotency_key TEXT NOT NULL
    CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 256),
  failure_reason TEXT
    CHECK (failure_reason IS NULL OR char_length(failure_reason) <= 1000),
  attempts INTEGER NOT NULL DEFAULT 0
    CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3
    CHECK (max_attempts > 0),
  next_attempt_at TIMESTAMPTZ,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT outbound_messages_conversation_workspace_fkey
    FOREIGN KEY (conversation_id, workspace_id)
    REFERENCES whatsapp_conversations(id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT outbound_messages_reply_draft_workspace_fkey
    FOREIGN KEY (reply_draft_id, workspace_id)
    REFERENCES reply_drafts(id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT outbound_messages_workspace_idempotency_key
    UNIQUE (workspace_id, idempotency_key),
  -- One outbound record per draft. A later edit preserves the historical
  -- content snapshot and cannot create a second send for the same draft.
  CONSTRAINT outbound_messages_reply_draft_id_key UNIQUE (reply_draft_id)
);

CREATE INDEX outbound_messages_queue_idx
  ON outbound_messages (status, next_attempt_at, queued_at, id)
  WHERE status = 'queued';

CREATE INDEX outbound_messages_workspace_status_created_idx
  ON outbound_messages (workspace_id, status, created_at DESC, id);

CREATE INDEX outbound_messages_workspace_conversation_created_idx
  ON outbound_messages (workspace_id, conversation_id, created_at DESC, id);

-- 4. Unified conversation thread view --------------------------------------
--
-- Inbound message IDs remain their original whatsapp_messages IDs. Outbound
-- rows expose their own outbound_messages IDs. The view is intentionally
-- read-only and keeps provider acceptance (sent) separate from delivery
-- (delivered_at/status = delivered).
CREATE VIEW conversation_thread_messages AS
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
  message.queued_at AS provider_timestamp,
  NULL::text AS processing_status,
  message.status AS outbound_status,
  message.failure_reason AS outbound_failure_reason,
  message.created_at
FROM outbound_messages AS message;

-- Rollback (manual; this migration runner has no down migrations):
--   DROP VIEW IF EXISTS conversation_thread_messages;
--   DROP TABLE IF EXISTS outbound_messages;
--   ALTER TABLE reply_drafts
--     DROP CONSTRAINT IF EXISTS reply_drafts_id_workspace_id_key,
--     DROP COLUMN IF EXISTS approval_send_policy,
--     DROP COLUMN IF EXISTS send_policy_override,
--     DROP COLUMN IF EXISTS approved_by;
--   DROP TABLE IF EXISTS workspace_messaging_settings;
