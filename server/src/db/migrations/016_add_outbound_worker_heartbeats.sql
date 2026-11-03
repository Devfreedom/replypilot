-- Operational heartbeat for standalone outbound workers.
--
-- The worker is a separate process. Without a durable heartbeat the frontend
-- can only infer activity from status transitions. This table lets the API
-- report whether a worker for a given provider is alive, when it was last
-- seen, and the result of its most recent bounded tick. It stores no customer
-- content and no credentials.

CREATE TABLE outbound_worker_heartbeats (
  provider TEXT PRIMARY KEY
    CHECK (char_length(btrim(provider)) BETWEEN 1 AND 50),
  worker_id TEXT NOT NULL
    CHECK (char_length(btrim(worker_id)) BETWEEN 1 AND 200),
  worker_started_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_tick JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rollback (manual; this migration runner has no down migrations):
--   DROP TABLE IF EXISTS outbound_worker_heartbeats;
