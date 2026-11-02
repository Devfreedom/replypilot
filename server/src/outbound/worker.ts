import type { Pool } from "pg";
import {
  OutboundProviderError,
  type OutboundMessageProvider,
} from "./provider.js";
import {
  cancelOutboundClaim,
  cancelUnauthorizedQueuedOutbound,
  claimQueuedOutboundMessages,
  isOutboundClaimAuthorized,
  markOutboundFailed,
  markOutboundSent,
  recoverStaleSending,
} from "./repository.js";

export const DEFAULT_WORKER_BATCH_SIZE = 10;
export const DEFAULT_WORKER_RETRY_DELAY_MS = 2_000;
export const DEFAULT_WORKER_STALE_AFTER_MS = 5 * 60 * 1_000;
const MAX_RETRY_DELAY_MS = 60_000;

export type OutboundWorkerOptions = Readonly<{
  batchSize?: number;
  baseRetryDelayMs?: number;
  staleAfterMs?: number;
}>;

export type OutboundWorkerResult = Readonly<{
  recovered: number;
  cancelled: number;
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
}>;

/**
 * One bounded worker tick. Claims are committed before the provider call, so
 * the provider is never inside a database transaction. Completion updates are
 * conditional on the claim generation and status, making stale workers safe.
 */
export async function runOutboundWorkerOnce(
  pool: Pool,
  provider: OutboundMessageProvider,
  options: OutboundWorkerOptions = {},
): Promise<OutboundWorkerResult> {
  const batchSize = options.batchSize ?? DEFAULT_WORKER_BATCH_SIZE;
  const baseRetryDelayMs =
    options.baseRetryDelayMs ?? DEFAULT_WORKER_RETRY_DELAY_MS;
  const staleAfterMs =
    options.staleAfterMs ?? DEFAULT_WORKER_STALE_AFTER_MS;

  const recovered = await recoverStaleSending(pool, staleAfterMs);
  const cancelledBeforeClaim = await cancelUnauthorizedQueuedOutbound(pool);
  const claimed = await claimQueuedOutboundMessages(pool, batchSize);

  let cancelled = cancelledBeforeClaim;
  let sent = 0;
  let retried = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of claimed) {
    if (!(await isOutboundClaimAuthorized(pool, row))) {
      if (await cancelOutboundClaim(pool, row)) {
        cancelled += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    try {
      const result = await provider.send({
        conversationId: row.conversation_id,
        content: row.content,
        idempotencyKey: row.idempotency_key,
      });

      const updated = await markOutboundSent(
        pool,
        row,
        result.providerMessageId,
      );

      if (updated) {
        sent += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      const failureReason =
        error instanceof OutboundProviderError
          ? error.message
          : "Outbound provider failed.";

      const retryDelayMs = Math.min(
        baseRetryDelayMs * 2 ** Math.max(0, row.attempts - 1),
        MAX_RETRY_DELAY_MS,
      );

      const updated = await markOutboundFailed(
        pool,
        row,
        failureReason,
        retryDelayMs,
      );

      if (!updated) {
        skipped += 1;
      } else if (updated.status === "failed") {
        failed += 1;
      } else {
        retried += 1;
      }
    }
  }

  return {
    recovered,
    cancelled,
    claimed: claimed.length,
    sent,
    retried,
    failed,
    skipped,
  };
}
