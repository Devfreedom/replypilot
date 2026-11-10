import type { Pool } from "pg";
import {
  OutboundProviderAmbiguousError,
  OutboundProviderError,
  MOCK_OUTBOUND_PROVIDER_NAME,
  type OutboundMessageProvider,
} from "./provider.js";
import {
  cancelOutboundClaim,
  cancelUnauthorizedQueuedOutbound,
  claimQueuedOutboundMessages,
  isOutboundClaimAuthorized,
  markOutboundFailed,
  markOutboundManualReview,
  markOutboundSent,
  markOutboundSentWhileConnectionActive,
  recoverStaleSending,
} from "./repository.js";
import {
  describeConnectionSendFailure,
  getConversationConnectionStatus,
} from "../whatsapp/connections.js";

export const DEFAULT_WORKER_BATCH_SIZE = 10;
export const DEFAULT_WORKER_RETRY_DELAY_MS = 2_000;
export const DEFAULT_WORKER_STALE_AFTER_MS = 5 * 60 * 1_000;
const MAX_RETRY_DELAY_MS = 60_000;
const MAX_FAILURE_REASON_LENGTH = 1000;

function boundedFailureReason(reason: string): string {
  let codePointLength = 0;
  let characterLength = 0;

  for (const character of reason) {
    if (codePointLength === MAX_FAILURE_REASON_LENGTH) break;
    codePointLength += 1;
    characterLength += character.length;
  }

  return reason.slice(0, characterLength);
}

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
  manualReview: number;
  skipped: number;
}>;

/**
 * One bounded worker tick. Claims are committed before the provider call, so
 * the provider is never inside a database transaction. Draft mutations reject
 * while a row is sending, so the final authorization check reserves the
 * approved snapshot until the provider call completes. Provider idempotency
 * controls whether an unknown outcome can be retried after worker recovery.
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

  const recovery = await recoverStaleSending(
    pool,
    staleAfterMs,
    provider.name,
    provider.idempotency,
  );
  const cancelledBeforeClaim = await cancelUnauthorizedQueuedOutbound(pool);
  const claimed = await claimQueuedOutboundMessages(
    pool,
    batchSize,
    provider.name,
  );

  let cancelled = cancelledBeforeClaim;
  let sent = 0;
  let retried = 0;
  let failed = 0;
  let manualReview = recovery.manualReview;
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

    const retryDelayMs = Math.min(
      baseRetryDelayMs * 2 ** Math.max(0, row.attempts - 1),
      MAX_RETRY_DELAY_MS,
    );

    // Independent connection check. The provider is not called at all when the
    // conversation's connection cannot deliver, so no request reaches Meta and
    // no simulated delivery can be recorded as sent.
    const connectionStatus = await getConversationConnectionStatus(
      pool,
      row.workspace_id,
      row.conversation_id,
    );

    if (connectionStatus !== "active") {
      const reason = boundedFailureReason(
        `Outbound send rejected: ${describeConnectionSendFailure(connectionStatus)}`,
      );

      const updated = await markOutboundFailed(pool, row, reason, retryDelayMs);

      if (!updated) {
        skipped += 1;
      } else if (updated.status === "failed") {
        failed += 1;
      } else {
        retried += 1;
      }

      continue;
    }

    try {
      const result = await provider.send({
        conversationId: row.conversation_id,
        content: row.content,
        idempotencyKey: row.idempotency_key,
        recipientPhone: row.customer_phone_e164,
        workspaceId: row.workspace_id,
      });

      if (provider.name === MOCK_OUTBOUND_PROVIDER_NAME) {
        // A simulated delivery cannot observe the connection, so the sent
        // transition is guarded by the connection state itself. A disconnect
        // that lands between the check above and this transition must not be
        // recorded as a successful send.
        const transition = await markOutboundSentWhileConnectionActive(
          pool,
          row,
          result.providerMessageId,
        );

        if (transition.kind === "sent") {
          sent += 1;
        } else if (transition.kind === "connection-unusable") {
          const reason = boundedFailureReason(
            `Outbound send rejected: ${describeConnectionSendFailure(
              transition.status,
            )}`,
          );

          const updated = await markOutboundFailed(
            pool,
            row,
            reason,
            retryDelayMs,
          );

          if (!updated) {
            skipped += 1;
          } else if (updated.status === "failed") {
            failed += 1;
          } else {
            retried += 1;
          }
        } else {
          skipped += 1;
        }
      } else {
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
      }
    } catch (error) {
      const ambiguous =
        error instanceof OutboundProviderAmbiguousError ||
        !(error instanceof OutboundProviderError);
      const failureReason = boundedFailureReason(
        error instanceof Error
          ? error.message
          : "Outbound provider returned an unknown failure.",
      );

      const updated =
        ambiguous &&
        (provider.idempotency !== "guaranteed" ||
          row.attempts >= row.max_attempts)
          ? await markOutboundManualReview(
              pool,
              row,
              boundedFailureReason(
                `Provider outcome is ambiguous: ${failureReason} Reconcile with the provider before any further send.`,
              ),
            )
          : await markOutboundFailed(pool, row, failureReason, retryDelayMs);

      if (!updated) {
        skipped += 1;
      } else if (updated.status === "manual_review") {
        manualReview += 1;
      } else if (updated.status === "failed") {
        failed += 1;
      } else {
        retried += 1;
      }
    }
  }

  return {
    recovered: recovery.recovered,
    cancelled,
    claimed: claimed.length,
    sent,
    retried,
    failed,
    manualReview,
    skipped,
  };
}
