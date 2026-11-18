import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  OUTBOUND_MESSAGE_STATUSES,
  type OutboundMessageStatus,
} from "../messaging/types.js";

export const WORKER_HEARTBEAT_STALE_AFTER_MS = 30_000;

const OPAQUE_WORKER_ID_PATTERN = /^worker-[0-9a-f]{8,32}$/i;
const ALLOWED_NUMERIC_TICK_KEYS = [
  "recovered",
  "cancelled",
  "claimed",
  "sent",
  "retried",
  "failed",
  "manualReview",
  "skipped",
] as const;

export function anonymizeWorkerId(rawWorkerId: string): string {
  const trimmed = rawWorkerId.trim();

  if (OPAQUE_WORKER_ID_PATTERN.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  const digest = createHash("sha256")
    .update(trimmed, "utf8")
    .digest("hex")
    .slice(0, 12);
  return `worker-${digest}`;
}

export function sanitizeWorkerTick(
  rawTick: unknown,
): Readonly<Record<string, unknown>> {
  if (typeof rawTick !== "object" || rawTick === null || Array.isArray(rawTick)) {
    return {};
  }

  const record = rawTick as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const key of ALLOWED_NUMERIC_TICK_KEYS) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      sanitized[key] = value;
    }
  }

  if ("error" in record && record.error !== undefined && record.error !== null) {
    sanitized.error = "worker_tick_failed";
  }

  return sanitized;
}

export type OutboundWorkerHeartbeat = Readonly<{
  provider: string;
  workerId: string;
  workerStartedAt: string;
  lastSeenAt: string;
  lastTick: Readonly<Record<string, unknown>>;
}>;

type HeartbeatRow = Readonly<{
  provider: string;
  worker_id: string;
  worker_started_at: Date;
  last_seen_at: Date;
  last_tick: unknown;
}>;

export type OutboundQueueSummary = Readonly<{
  counts: Readonly<Record<OutboundMessageStatus, number>>;
  total: number;
  oldestQueuedAt: string | null;
}>;

/**
 * Upserts the liveness record for one provider adapter. The CLI calls this on
 * every poll so the dashboard can distinguish "idle worker" from "worker not
 * running". Tick data is operational counters only; it must never include
 * message content or credentials.
 */
export async function recordWorkerHeartbeat(
  pool: Pool,
  input: Readonly<{
    provider: string;
    workerId: string;
    workerStartedAt: Date;
    lastTick: Readonly<Record<string, unknown>>;
  }>,
): Promise<void> {
  await pool.query(
    `
      INSERT INTO outbound_worker_heartbeats (
        provider,
        worker_id,
        worker_started_at,
        last_seen_at,
        last_tick,
        updated_at
      )
      VALUES ($1, $2, $3, now(), $4::jsonb, now())
      ON CONFLICT (provider) DO UPDATE
      SET worker_id = EXCLUDED.worker_id,
          worker_started_at = EXCLUDED.worker_started_at,
          last_seen_at = now(),
          last_tick = EXCLUDED.last_tick,
          updated_at = now()
    `,
    [
      input.provider,
      input.workerId,
      input.workerStartedAt,
      JSON.stringify(input.lastTick),
    ],
  );
}

export async function listWorkerHeartbeats(
  pool: Pool,
): Promise<OutboundWorkerHeartbeat[]> {
  const result = await pool.query<HeartbeatRow>(
    `
      SELECT provider, worker_id, worker_started_at, last_seen_at, last_tick
      FROM outbound_worker_heartbeats
      ORDER BY provider ASC
    `,
  );

  return result.rows.map((row) => ({
    provider: row.provider,
    workerId: anonymizeWorkerId(row.worker_id),
    workerStartedAt: row.worker_started_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    lastTick: sanitizeWorkerTick(row.last_tick),
  }));
}

export async function getOutboundQueueSummary(
  pool: Pool,
  workspaceId: string,
): Promise<OutboundQueueSummary> {
  const [countsResult, oldestResult] = await Promise.all([
    pool.query<{ status: OutboundMessageStatus; count: number }>(
      `
        SELECT status, count(*)::int AS count
        FROM outbound_messages
        WHERE workspace_id = $1
        GROUP BY status
      `,
      [workspaceId],
    ),
    pool.query<{ oldest: Date | null }>(
      `
        SELECT min(queued_at) AS oldest
        FROM outbound_messages
        WHERE workspace_id = $1
          AND status = 'queued'
      `,
      [workspaceId],
    ),
  ]);

  const counts = Object.fromEntries(
    OUTBOUND_MESSAGE_STATUSES.map((status) => [status, 0]),
  ) as Record<OutboundMessageStatus, number>;

  for (const row of countsResult.rows) {
    counts[row.status] = row.count;
  }

  return {
    counts,
    total: Object.values(counts).reduce((sum, value) => sum + value, 0),
    oldestQueuedAt: oldestResult.rows[0]?.oldest?.toISOString() ?? null,
  };
}
