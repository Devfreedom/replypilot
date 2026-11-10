-- Global WhatsApp phone-number ownership (Milestone 14A follow-up).
--
-- One Meta phone-number ID must resolve to at most one ReplyPilot workspace.
-- Before Milestone 14A the webhook created one connection row per (workspace,
-- phone number) pair, so an existing database can hold the same Meta number in
-- more than one workspace. Those rows carry real conversation history, so they
-- are never deleted here.
--
-- The index is partial: it covers every connection that can own inbound
-- routing (any status other than 'disconnected'). A connection that an operator
-- has explicitly disconnected is retained for audit but no longer competes for
-- the phone number.
--
-- When duplicates still exist among non-disconnected rows, this migration
-- fails without changing anything and names the conflicting rows. The
-- operator then runs the reviewed remediation script and re-runs the
-- migrations:
--
--   server/src/db/remediation/demote_duplicate_whatsapp_connections.sql

DO $$
DECLARE
  offending TEXT;
  failure_message TEXT;
BEGIN
  SELECT string_agg(
    format(
      'phone_number_id=%s connection_id=%s workspace_id=%s status=%s created_at=%s',
      connection.phone_number_id,
      connection.id,
      connection.workspace_id,
      connection.status,
      connection.created_at
    ),
    E'\n  ' ORDER BY connection.phone_number_id, connection.created_at
  )
  INTO offending
  FROM whatsapp_connections AS connection
  WHERE connection.status <> 'disconnected'
    AND connection.phone_number_id IN (
      SELECT phone_number_id
      FROM whatsapp_connections
      WHERE status <> 'disconnected'
      GROUP BY phone_number_id
      HAVING count(*) > 1
    );

  IF offending IS NOT NULL THEN
    failure_message :=
      'Cannot enforce global WhatsApp phone-number ownership. One or more Meta phone-number IDs are still connected to more than one workspace:'
      || E'\n  '
      || offending
      || E'\n\nNo data was changed. Review and run server/src/db/remediation/demote_duplicate_whatsapp_connections.sql, which demotes the duplicate rows to ''disconnected'' and keeps every conversation, then run the migrations again.';

    RAISE EXCEPTION '%', failure_message;
  END IF;
END $$;

-- A database that already received the earlier full index keeps its name but
-- gains the partial predicate, so a repeated migration never fails on a
-- pre-existing index.
DROP INDEX IF EXISTS whatsapp_connections_phone_number_id_uidx;

CREATE UNIQUE INDEX whatsapp_connections_phone_number_id_uidx
  ON whatsapp_connections (phone_number_id)
  WHERE status <> 'disconnected';

-- Rollback (manual; this migration runner has no down migrations):
--   DROP INDEX IF EXISTS whatsapp_connections_phone_number_id_uidx;
