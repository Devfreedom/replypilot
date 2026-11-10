-- Operator-run remediation for duplicate WhatsApp phone-number ownership.
--
-- WHY THIS EXISTS
-- ---------------
-- Before Milestone 14A the webhook created one connection row per (workspace,
-- phone number) pair. Migration
-- 019_enforce_global_whatsapp_phone_number_ownership.sql requires a Meta
-- phone-number ID to resolve to at most one workspace, and it refuses to
-- apply while the same number is still connected to more than one workspace.
--
-- This script resolves that conflict WITHOUT deleting anything:
--
--   * For every phone-number ID that is still connected to more than one
--     workspace, the oldest connection keeps the number.
--   * Every other connection for that number is set to 'disconnected'. The row,
--     its conversations, and its messages are all preserved, and the foreign
--     keys stay valid.
--   * A disconnected connection cannot receive inbound events and cannot send
--     outbound messages, so inbound routing becomes unambiguous again.
--
-- It never deletes, reassigns, or moves a conversation, lead, or customer.
--
-- HOW TO USE IT
-- -------------
-- 1. Read the pre-flight report below and confirm the duplicate rows are the
--    ones you expect. Confirm which workspace legitimately owns the number
--    (the Meta business account that sent the messages).
-- 2. If the keeper row is not the correct one, stop: this script keeps the
--    oldest row, and a hand-reviewed UPDATE is safer than an automatic guess.
-- 3. Run the script once, in a transaction, against the target database:
--
--      psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f server/src/db/remediation/demote_duplicate_whatsapp_connections.sql
--
-- 4. Re-run the migrations: npm run db:migrate

\set ON_ERROR_STOP on

BEGIN;

-- Guard: this script needs the Milestone 14A status column.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'whatsapp_connections'
      AND column_name = 'status'
  ) THEN
    RAISE EXCEPTION
      'whatsapp_connections.status does not exist. Apply the migrations up to 017_multi_workspace_whatsapp_connections.sql first.';
  END IF;
END $$;

-- Pre-flight report. Read this before the update below.
SELECT
  connection.phone_number_id,
  connection.id AS connection_id,
  connection.workspace_id,
  connection.status,
  connection.created_at,
  (SELECT count(*)::int
     FROM whatsapp_conversations AS conversation
    WHERE conversation.whatsapp_connection_id = connection.id) AS conversations,
  row_number() OVER (
    PARTITION BY connection.phone_number_id
    ORDER BY connection.created_at ASC, connection.id ASC
  ) AS keeper_rank
FROM whatsapp_connections AS connection
WHERE connection.status <> 'disconnected'
  AND connection.phone_number_id IN (
    SELECT phone_number_id
    FROM whatsapp_connections
    WHERE status <> 'disconnected'
    GROUP BY phone_number_id
    HAVING count(*) > 1
  )
ORDER BY connection.phone_number_id, connection.created_at, connection.id;

-- Demote every duplicate except the keeper for its phone-number ID.
DO $$
DECLARE
  demoted RECORD;
  has_last_error BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'whatsapp_connections'
      AND column_name = 'last_error'
  ) INTO has_last_error;

  FOR demoted IN
    SELECT
      connection.id,
      connection.phone_number_id,
      connection.workspace_id
    FROM whatsapp_connections AS connection
    WHERE connection.status <> 'disconnected'
      AND connection.phone_number_id IN (
        SELECT phone_number_id
        FROM whatsapp_connections
        WHERE status <> 'disconnected'
        GROUP BY phone_number_id
        HAVING count(*) > 1
      )
      AND connection.id NOT IN (
        SELECT keeper.id
        FROM whatsapp_connections AS keeper
        WHERE keeper.status <> 'disconnected'
          AND keeper.phone_number_id IN (
            SELECT phone_number_id
            FROM whatsapp_connections
            WHERE status <> 'disconnected'
            GROUP BY phone_number_id
            HAVING count(*) > 1
          )
          AND keeper.id = (
            SELECT ranked.id
            FROM whatsapp_connections AS ranked
            WHERE ranked.status <> 'disconnected'
              AND ranked.phone_number_id = keeper.phone_number_id
            ORDER BY ranked.created_at ASC, ranked.id ASC
            LIMIT 1
          )
      )
  LOOP
    IF has_last_error THEN
      UPDATE whatsapp_connections
      SET status = 'disconnected',
          disconnected_at = COALESCE(disconnected_at, now()),
          last_error = 'Demoted by the duplicate phone-number remediation script: this Meta phone number is owned by another workspace. The connection was preserved for audit and history.',
          updated_at = now()
      WHERE id = demoted.id;
    ELSE
      UPDATE whatsapp_connections
      SET status = 'disconnected',
          disconnected_at = COALESCE(disconnected_at, now()),
          updated_at = now()
      WHERE id = demoted.id;
    END IF;

    RAISE NOTICE
      'Demoted connection % (phone_number_id=%, workspace_id=%) to disconnected; no rows were deleted.',
      demoted.id,
      demoted.phone_number_id,
      demoted.workspace_id;
  END LOOP;
END $$;

-- Post-condition: at most one non-disconnected connection per phone number.
SELECT
  connection.phone_number_id,
  count(*)::int AS remaining_non_disconnected
FROM whatsapp_connections AS connection
WHERE connection.status <> 'disconnected'
GROUP BY connection.phone_number_id
HAVING count(*) > 1;

COMMIT;
