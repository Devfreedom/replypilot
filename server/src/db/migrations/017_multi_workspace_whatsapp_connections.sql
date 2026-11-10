-- Multi-workspace WhatsApp connection infrastructure (Milestone 14A).
--
-- Additive only. The existing whatsapp_connections table is extended rather
-- than duplicated, existing conversation references are preserved, and every
-- existing connection remains usable during the migration.
--
-- Credentials are stored as AES-256-GCM ciphertext in three columns plus the
-- key version. The application encrypts and decrypts them server-side; the
-- database never stores plaintext tokens.

-- 1. Connection metadata -----------------------------------------------------
ALTER TABLE whatsapp_connections
  ADD COLUMN waba_id TEXT
    CHECK (
      waba_id IS NULL
      OR (
        char_length(waba_id) BETWEEN 5 AND 64
        AND waba_id ~ '^[0-9A-Za-z._-]+$'
      )
    ),
  -- New rows default to pending and must be explicitly activated by a trusted
  -- onboarding flow. Existing rows below are backfilled to active so the
  -- current single-workspace integration keeps working.
  ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'disconnected')),
  ADD COLUMN access_token_ciphertext TEXT
    CHECK (
      access_token_ciphertext IS NULL
      OR char_length(access_token_ciphertext) BETWEEN 1 AND 8192
    ),
  ADD COLUMN access_token_iv TEXT
    CHECK (access_token_iv IS NULL OR char_length(access_token_iv) BETWEEN 1 AND 128),
  ADD COLUMN access_token_auth_tag TEXT
    CHECK (
      access_token_auth_tag IS NULL
      OR char_length(access_token_auth_tag) BETWEEN 1 AND 128
    ),
  ADD COLUMN token_expires_at TIMESTAMPTZ,
  ADD COLUMN credential_key_version TEXT
    CHECK (
      credential_key_version IS NULL
      OR char_length(credential_key_version) BETWEEN 1 AND 32
    ),
  ADD COLUMN activated_at TIMESTAMPTZ,
  ADD COLUMN disconnected_at TIMESTAMPTZ;

UPDATE whatsapp_connections
SET status = 'active',
    activated_at = COALESCE(activated_at, created_at)
WHERE status = 'pending';

-- Credential columns must be all present or all absent. This prevents a
-- half-written configuration from being treated as usable.
ALTER TABLE whatsapp_connections
  ADD CONSTRAINT whatsapp_connections_credentials_complete_check
  CHECK (
    (
      access_token_ciphertext IS NULL
      AND access_token_iv IS NULL
      AND access_token_auth_tag IS NULL
      AND credential_key_version IS NULL
    )
    OR (
      access_token_ciphertext IS NOT NULL
      AND access_token_iv IS NOT NULL
      AND access_token_auth_tag IS NOT NULL
      AND credential_key_version IS NOT NULL
    )
  );

CREATE INDEX whatsapp_connections_status_idx
  ON whatsapp_connections (workspace_id, status, created_at ASC, id);

-- 2. Global phone-number ownership ------------------------------------------
--
-- One Meta phone-number ID may resolve to at most one ReplyPilot workspace.
--
-- The index that enforces this is created by migration
-- 019_enforce_global_whatsapp_phone_number_ownership.sql, not here. Before
-- this milestone, the webhook created one connection row per (workspace,
-- phone number) pair, so an existing database can legitimately contain the
-- same Meta phone-number ID in more than one workspace. That data is not
-- wrong enough to delete, and its conversations must be preserved, so this
-- migration only adds the schema and leaves the ownership decision to an
-- explicit, operator-reviewed remediation step:
--
--   server/src/db/remediation/demote_duplicate_whatsapp_connections.sql
--
-- The remediation demotes the losing rows to 'disconnected' instead of
-- deleting them, so every conversation and message stays intact and the
-- remaining non-disconnected row per phone number keeps the number.

-- Rollback (manual; this migration runner has no down migrations):
--   DROP INDEX IF EXISTS whatsapp_connections_status_idx;
--   ALTER TABLE whatsapp_connections
--     DROP CONSTRAINT IF EXISTS whatsapp_connections_credentials_complete_check,
--     DROP COLUMN IF EXISTS disconnected_at,
--     DROP COLUMN IF EXISTS activated_at,
--     DROP COLUMN IF EXISTS credential_key_version,
--     DROP COLUMN IF EXISTS token_expires_at,
--     DROP COLUMN IF EXISTS access_token_auth_tag,
--     DROP COLUMN IF EXISTS access_token_iv,
--     DROP COLUMN IF EXISTS access_token_ciphertext,
--     DROP COLUMN IF EXISTS status,
--     DROP COLUMN IF EXISTS waba_id;
