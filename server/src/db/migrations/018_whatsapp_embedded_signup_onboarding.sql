-- WhatsApp Embedded Signup v4 onboarding (Milestone 14B).
--
-- Additive only. M14A owns the whatsapp_connections table and the AES-256-GCM
-- credential columns; this migration adds verification metadata and the
-- short-lived onboarding-session table used to bind a Meta callback to the
-- authenticated user and workspace that initiated it.
--
-- The onboarding table stores only a SHA-256 hash of the browser nonce. The
-- raw nonce is returned once to the initiating browser and is never stored.

-- 1. Connection verification metadata ---------------------------------------
ALTER TABLE whatsapp_connections
  ADD COLUMN last_verified_at TIMESTAMPTZ,
  ADD COLUMN webhook_subscribed_at TIMESTAMPTZ,
  ADD COLUMN last_error TEXT
    CHECK (last_error IS NULL OR char_length(last_error) <= 500);

-- Add the "error" state without relying on PostgreSQL's generated constraint
-- name. The old status check is replaced so connections can be marked as
-- needing attention after a failed re-verification.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint AS con
    JOIN pg_class AS rel ON rel.oid = con.conrelid
    JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = current_schema()
      AND rel.relname = 'whatsapp_connections'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%status%'
  LOOP
    EXECUTE format(
      'ALTER TABLE whatsapp_connections DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;
END $$;

ALTER TABLE whatsapp_connections
  ADD CONSTRAINT whatsapp_connections_status_check
  CHECK (status IN ('pending', 'active', 'disconnected', 'error'));

-- 2. Onboarding sessions -----------------------------------------------------
CREATE TABLE whatsapp_onboarding_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL
    REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL
    REFERENCES auth_users(id) ON DELETE CASCADE,
  state_hash TEXT NOT NULL UNIQUE
    CHECK (
      char_length(state_hash) = 64
      AND state_hash ~ '^[0-9a-f]+$'
    ),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  connection_id UUID
    REFERENCES whatsapp_connections(id) ON DELETE SET NULL,
  failure_code TEXT
    CHECK (failure_code IS NULL OR char_length(failure_code) <= 64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (completed_at IS NULL OR consumed_at IS NOT NULL)
);

CREATE INDEX whatsapp_onboarding_sessions_workspace_user_idx
  ON whatsapp_onboarding_sessions (workspace_id, user_id, created_at DESC);

CREATE INDEX whatsapp_onboarding_sessions_expires_idx
  ON whatsapp_onboarding_sessions (expires_at);

-- Rollback (manual; this migration runner has no down migrations):
--   DROP TABLE IF EXISTS whatsapp_onboarding_sessions;
--   ALTER TABLE whatsapp_connections
--     DROP CONSTRAINT IF EXISTS whatsapp_connections_status_check,
--     ADD CONSTRAINT whatsapp_connections_status_check
--       CHECK (status IN ('pending', 'active', 'disconnected')),
--     DROP COLUMN IF EXISTS last_error,
--     DROP COLUMN IF EXISTS webhook_subscribed_at,
--     DROP COLUMN IF EXISTS last_verified_at;
