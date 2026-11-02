import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  DEFAULT_OUTBOUND_MAX_ATTEMPTS,
  type OutboundMessageStatus,
} from "../messaging/types.js";
import type {
  OutboundMessageHistoryItem,
  OutboundMessageHistoryRow,
  OutboundMessageRecord,
  OutboundMessageRow,
} from "./types.js";
import type { DeliveryStatusEvent } from "../whatsapp/types.js";

const OUTBOUND_MESSAGE_COLUMNS = `
  id,
  workspace_id,
  conversation_id,
  reply_draft_id,
  provider,
  provider_message_id,
  content,
  status,
  idempotency_key,
  failure_reason,
  attempts,
  max_attempts,
  queued_at,
  started_at,
  sent_at,
  delivered_at,
  created_at,
  updated_at,
  NULL::text AS customer_phone_e164
`;

const OUTBOUND_MESSAGE_SELECT_COLUMNS = `
  message.id,
  message.workspace_id,
  message.conversation_id,
  message.reply_draft_id,
  message.provider,
  message.provider_message_id,
  message.content,
  message.status,
  message.idempotency_key,
  message.failure_reason,
  message.attempts,
  message.max_attempts,
  message.queued_at,
  message.started_at,
  message.sent_at,
  message.delivered_at,
  message.created_at,
  message.updated_at,
  customer.phone_e164 AS customer_phone_e164
`;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function mapOutboundMessageRow(
  row: OutboundMessageRow,
): OutboundMessageRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    replyDraftId: row.reply_draft_id,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    content: row.content,
    status: row.status,
    failureReason: row.failure_reason,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    queuedAt: row.queued_at.toISOString(),
    startedAt: iso(row.started_at),
    sentAt: iso(row.sent_at),
    deliveredAt: iso(row.delivered_at),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapOutboundMessageHistoryRow(
  row: OutboundMessageHistoryRow,
): OutboundMessageHistoryItem {
  const retryBlockReason =
    row.status !== "failed"
      ? null
      : row.reply_draft_status !== "approved"
        ? "draft_not_approved"
        : row.content !== row.reply_draft_content
          ? "content_changed"
          : row.conversation_status !== "open" &&
              row.conversation_status !== "closed"
            ? "conversation_inactive"
            : null;

  return {
    ...mapOutboundMessageRow(row),
    conversation: {
      id: row.conversation_id,
      customer: {
        id: row.customer_id,
        displayName: row.customer_display_name,
        phoneE164: row.customer_phone_e164,
        providerContactId: row.customer_provider_contact_id,
      },
      status: row.conversation_status,
    },
    canRetry: row.status === "failed" && retryBlockReason === null,
    retryBlockReason,
  };
}

export type ConversationResolution =
  | Readonly<{ kind: "ok"; conversationId: string }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "ambiguous" }>;

/**
 * Resolves exactly one eligible WhatsApp conversation. An explicit selection
 * is always validated. Without one, only a single active conversation is
 * accepted; multiple candidates return ambiguous so the caller must ask the
 * owner to choose instead of silently sending to the wrong thread.
 */
export async function resolveConversationForLead(
  client: Pool | PoolClient,
  input: Readonly<{
    workspaceId: string;
    leadId: string;
    conversationId?: string;
  }>,
): Promise<ConversationResolution> {
  if (input.conversationId) {
    const explicit = await client.query<{ id: string }>(
      `
        SELECT id
        FROM whatsapp_conversations
        WHERE workspace_id = $1
          AND id = $2
          AND lead_id = $3
          AND status IN ('open', 'closed')
        LIMIT 1
      `,
      [input.workspaceId, input.conversationId, input.leadId],
    );

    return explicit.rows[0]
      ? { kind: "ok", conversationId: explicit.rows[0].id }
      : { kind: "not-found" };
  }

  const candidates = await client.query<{ id: string }>(
    `
      SELECT id
      FROM whatsapp_conversations
      WHERE workspace_id = $1
        AND lead_id = $2
        AND status IN ('open', 'closed')
      ORDER BY last_message_at DESC NULLS LAST, created_at DESC, id DESC
      LIMIT 2
    `,
    [input.workspaceId, input.leadId],
  );

  if (candidates.rows.length === 0) {
    return { kind: "none" };
  }

  if (candidates.rows.length > 1) {
    return { kind: "ambiguous" };
  }

  return { kind: "ok", conversationId: candidates.rows[0].id };
}

export async function getOutboundMessageForDraft(
  client: Pool | PoolClient,
  workspaceId: string,
  replyDraftId: string,
): Promise<OutboundMessageRecord | null> {
  const result = await client.query<OutboundMessageRow>(
    `
      SELECT ${OUTBOUND_MESSAGE_COLUMNS}
      FROM outbound_messages
      WHERE workspace_id = $1
        AND reply_draft_id = $2
    `,
    [workspaceId, replyDraftId],
  );

  const row = result.rows[0];
  return row ? mapOutboundMessageRow(row) : null;
}

export async function insertQueuedOutboundMessage(
  client: PoolClient,
  input: Readonly<{
    workspaceId: string;
    conversationId: string;
    replyDraftId: string;
    content: string;
    idempotencyKey: string;
    provider?: string;
    maxAttempts?: number;
  }>,
): Promise<OutboundMessageRecord | null> {
  const result = await client.query<OutboundMessageRow>(
    `
      INSERT INTO outbound_messages (
        workspace_id,
        conversation_id,
        reply_draft_id,
        provider,
        content,
        status,
        idempotency_key,
        max_attempts
      )
      VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7)
      ON CONFLICT DO NOTHING
      RETURNING ${OUTBOUND_MESSAGE_COLUMNS}
    `,
    [
      input.workspaceId,
      input.conversationId,
      input.replyDraftId,
      input.provider ?? "mock",
      input.content,
      input.idempotencyKey,
      input.maxAttempts ?? DEFAULT_OUTBOUND_MAX_ATTEMPTS,
    ],
  );

  const row = result.rows[0];
  return row ? mapOutboundMessageRow(row) : null;
}

/**
 * Manual send is the only path that resets a permanently failed record. The
 * content snapshot is never changed, and attempts are reset explicitly so the
 * bounded automatic-retry history remains auditable.
 */
export async function resetFailedOutboundForRetry(
  client: PoolClient,
  workspaceId: string,
  outboundMessageId: string,
): Promise<OutboundMessageRecord | null> {
  const result = await client.query<OutboundMessageRow>(
    `
      UPDATE outbound_messages
      SET status = 'queued',
          attempts = 0,
          failure_reason = NULL,
          next_attempt_at = NULL,
          started_at = NULL,
          updated_at = now()
      WHERE workspace_id = $1
        AND id = $2
        AND status = 'failed'
      RETURNING ${OUTBOUND_MESSAGE_COLUMNS}
    `,
    [workspaceId, outboundMessageId],
  );

  const row = result.rows[0];
  return row ? mapOutboundMessageRow(row) : null;
}

export type ListOutboundMessagesOptions = Readonly<{
  limit: number;
  offset: number;
  status?: OutboundMessageStatus;
  conversationId?: string;
}>;

export async function listOutboundMessages(
  pool: Pool,
  workspaceId: string,
  options: ListOutboundMessagesOptions,
): Promise<
  Readonly<{ messages: OutboundMessageHistoryItem[]; hasMore: boolean }>
> {
  const parameters: unknown[] = [workspaceId];
  const filters: string[] = [];

  if (options.status) {
    parameters.push(options.status);
    filters.push(`AND message.status = $${parameters.length}`);
  }

  if (options.conversationId) {
    parameters.push(options.conversationId);
    filters.push(`AND message.conversation_id = $${parameters.length}`);
  }

  parameters.push(options.limit + 1, options.offset);

  const result = await pool.query<OutboundMessageHistoryRow>(
    `
      SELECT
        ${OUTBOUND_MESSAGE_SELECT_COLUMNS},
        conversation.status AS conversation_status,
        customer.id AS customer_id,
        COALESCE(customer.display_name, conversation.contact_name)
          AS customer_display_name,
        customer.provider_contact_id AS customer_provider_contact_id,
        draft.status AS reply_draft_status,
        draft.draft_reply AS reply_draft_content
      FROM outbound_messages AS message
      JOIN whatsapp_conversations AS conversation
        ON conversation.id = message.conversation_id
       AND conversation.workspace_id = message.workspace_id
      JOIN customers AS customer
        ON customer.id = conversation.customer_id
       AND customer.workspace_id = conversation.workspace_id
      JOIN reply_drafts AS draft
        ON draft.id = message.reply_draft_id
       AND draft.workspace_id = message.workspace_id
      WHERE message.workspace_id = $1
        ${filters.join("\n        ")}
      ORDER BY message.created_at DESC, message.id DESC
      LIMIT $${parameters.length - 1}
      OFFSET $${parameters.length}
    `,
    parameters,
  );

  const hasMore = result.rows.length > options.limit;

  return {
    messages: result.rows
      .slice(0, options.limit)
      .map(mapOutboundMessageHistoryRow),
    hasMore,
  };
}

/**
 * Cancels queued work whose draft is no longer approved, whose approved content
 * no longer matches the outbound snapshot, or whose conversation is no longer
 * active. This is the deterministic authorization gate before the worker claims
 * anything, and it prevents an edited or revoked draft from being sent from an
 * old snapshot.
 */
export async function cancelUnauthorizedQueuedOutbound(
  pool: Pool,
): Promise<number> {
  const result = await pool.query(
    `
      UPDATE outbound_messages AS message
      SET status = 'cancelled',
          failure_reason = CASE
            WHEN EXISTS (
              SELECT 1
              FROM whatsapp_conversations AS conversation
              JOIN customer_suppressions AS suppression
                ON suppression.customer_id = conversation.customer_id
               AND suppression.workspace_id = conversation.workspace_id
              WHERE conversation.id = message.conversation_id
                AND conversation.workspace_id = message.workspace_id
            )
              THEN 'Customer is suppressed and cannot receive outbound messages.'
            ELSE 'Draft content, approval, or active conversation is no longer valid.'
          END,
          next_attempt_at = NULL,
          updated_at = now()
      WHERE message.status = 'queued'
        AND (
          NOT EXISTS (
            SELECT 1
            FROM reply_drafts AS draft
            JOIN whatsapp_conversations AS conversation
              ON conversation.id = message.conversation_id
             AND conversation.workspace_id = message.workspace_id
            WHERE draft.id = message.reply_draft_id
              AND draft.workspace_id = message.workspace_id
              AND draft.status = 'approved'
              AND draft.draft_reply = message.content
              AND conversation.status IN ('open', 'closed')
          )
          OR EXISTS (
            SELECT 1
            FROM whatsapp_conversations AS conversation
            JOIN customer_suppressions AS suppression
              ON suppression.customer_id = conversation.customer_id
             AND suppression.workspace_id = conversation.workspace_id
            WHERE conversation.id = message.conversation_id
              AND conversation.workspace_id = message.workspace_id
          )
        )
      RETURNING message.id
    `,
  );

  return result.rowCount ?? 0;
}

/**
 * Claims a bounded batch with SKIP LOCKED. The returned attempts value is the
 * claim generation: completion updates require the same attempts value, so a
 * stale worker cannot overwrite a newer claim after recovery.
 * The customer's E.164 phone number is resolved here so the provider receives
 * it without an additional round-trip.
 */
export async function claimQueuedOutboundMessages(
  pool: Pool,
  batchSize: number,
  providerName: string,
): Promise<OutboundMessageRow[]> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query<OutboundMessageRow>(
      `
        WITH claimed AS (
          SELECT message.id
          FROM outbound_messages AS message
          WHERE message.status = 'queued'
            AND message.provider = $2
            AND (message.next_attempt_at IS NULL OR message.next_attempt_at <= now())
            AND EXISTS (
              SELECT 1
              FROM reply_drafts AS draft
              JOIN whatsapp_conversations AS conversation
                ON conversation.id = message.conversation_id
               AND conversation.workspace_id = message.workspace_id
              WHERE draft.id = message.reply_draft_id
                AND draft.workspace_id = message.workspace_id
                AND draft.status = 'approved'
                AND draft.draft_reply = message.content
                AND conversation.status IN ('open', 'closed')
                AND NOT EXISTS (
                  SELECT 1
                  FROM customer_suppressions AS suppression
                  WHERE suppression.workspace_id = message.workspace_id
                    AND suppression.customer_id = conversation.customer_id
                )
            )
          ORDER BY message.queued_at ASC, message.id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1
        ),
        updated AS (
          UPDATE outbound_messages AS message
          SET status = 'sending',
              started_at = now(),
              attempts = message.attempts + 1,
              updated_at = now()
          FROM claimed
          WHERE message.id = claimed.id
          RETURNING
            message.id,
            message.workspace_id,
            message.conversation_id,
            message.reply_draft_id,
            message.provider,
            message.provider_message_id,
            message.content,
            message.status,
            message.idempotency_key,
            message.failure_reason,
            message.attempts,
            message.max_attempts,
            message.queued_at,
            message.started_at,
            message.sent_at,
            message.delivered_at,
            message.created_at,
            message.updated_at
        )
        SELECT
          updated.*,
          cust.phone_e164 AS customer_phone_e164
        FROM updated
        JOIN whatsapp_conversations AS conv
          ON conv.id = updated.conversation_id
         AND conv.workspace_id = updated.workspace_id
        JOIN customers AS cust
          ON cust.id = conv.customer_id
         AND cust.workspace_id = conv.workspace_id
      `,
      [batchSize, providerName],
    );

    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Re-checks authorization after the claim commit. A draft can be edited while
 * the worker is between claim and provider call; in that window the claim must
 * be cancelled rather than sending content the owner no longer approved.
 */
export async function isOutboundClaimAuthorized(
  pool: Pool,
  row: OutboundMessageRow,
): Promise<boolean> {
  const result = await pool.query(
    `
      SELECT 1
      FROM outbound_messages AS message
      JOIN reply_drafts AS draft
        ON draft.id = message.reply_draft_id
       AND draft.workspace_id = message.workspace_id
      JOIN whatsapp_conversations AS conversation
        ON conversation.id = message.conversation_id
       AND conversation.workspace_id = message.workspace_id
      WHERE message.id = $1
        AND message.status = 'sending'
        AND message.attempts = $2
        AND draft.status = 'approved'
        AND draft.draft_reply = message.content
        AND conversation.status IN ('open', 'closed')
        AND NOT EXISTS (
          SELECT 1
          FROM customer_suppressions AS suppression
          WHERE suppression.workspace_id = message.workspace_id
            AND suppression.customer_id = conversation.customer_id
        )
      LIMIT 1
    `,
    [row.id, row.attempts],
  );

  return result.rows.length > 0;
}

export async function cancelOutboundClaim(
  pool: Pool,
  row: OutboundMessageRow,
): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE outbound_messages
      SET status = 'cancelled',
          failure_reason =
            'Draft content, approval, or active conversation is no longer valid.',
          next_attempt_at = NULL,
          updated_at = now()
      WHERE id = $1
        AND status = 'sending'
        AND attempts = $2
    `,
    [row.id, row.attempts],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function markOutboundSent(
  pool: Pool,
  row: OutboundMessageRow,
  providerMessageId: string,
): Promise<OutboundMessageRecord | null> {
  const result = await pool.query<OutboundMessageRow>(
    `
      UPDATE outbound_messages
      SET status = 'sent',
          provider_message_id = $3,
          sent_at = now(),
          failure_reason = NULL,
          next_attempt_at = NULL,
          updated_at = now()
      WHERE id = $1
        AND status = 'sending'
        AND attempts = $2
      RETURNING ${OUTBOUND_MESSAGE_COLUMNS}
    `,
    [row.id, row.attempts, providerMessageId],
  );

  const updated = result.rows[0];
  return updated ? mapOutboundMessageRow(updated) : null;
}

export async function markOutboundFailed(
  pool: Pool,
  row: OutboundMessageRow,
  failureReason: string,
  retryDelayMs: number,
): Promise<OutboundMessageRecord | null> {
  const result = await pool.query<OutboundMessageRow>(
    `
      UPDATE outbound_messages
      SET status = CASE
            WHEN attempts >= max_attempts THEN 'failed'
            ELSE 'queued'
          END,
          failure_reason = $3,
          next_attempt_at = CASE
            WHEN attempts >= max_attempts THEN NULL
            ELSE now() + ($4 * interval '1 millisecond')
          END,
          updated_at = now()
      WHERE id = $1
        AND status = 'sending'
        AND attempts = $2
      RETURNING ${OUTBOUND_MESSAGE_COLUMNS}
    `,
    [row.id, row.attempts, failureReason, retryDelayMs],
  );

  const updated = result.rows[0];
  return updated ? mapOutboundMessageRow(updated) : null;
}

export async function markOutboundManualReview(
  pool: Pool,
  row: OutboundMessageRow,
  reason: string,
): Promise<OutboundMessageRecord | null> {
  const result = await pool.query<OutboundMessageRow>(
    `
      UPDATE outbound_messages
      SET status = 'manual_review',
          failure_reason = $3,
          next_attempt_at = NULL,
          updated_at = now()
      WHERE id = $1
        AND status = 'sending'
        AND attempts = $2
      RETURNING ${OUTBOUND_MESSAGE_COLUMNS}
    `,
    [row.id, row.attempts, reason],
  );

  const updated = result.rows[0];
  return updated ? mapOutboundMessageRow(updated) : null;
}

export async function recoverStaleSending(
  pool: Pool,
  staleAfterMs: number,
  providerName: string,
  providerIdempotency: "guaranteed" | "unsupported",
): Promise<{ recovered: number; manualReview: number }> {
  const result = await pool.query<{ status: string }>(
    `
      UPDATE outbound_messages
      SET status = CASE
            WHEN $3 = 'guaranteed'
              AND provider = $2
              AND attempts < max_attempts
              THEN 'queued'
            ELSE 'manual_review'
          END,
          failure_reason = CASE
            WHEN $3 = 'guaranteed'
              AND provider = $2
              AND attempts < max_attempts
              THEN 'Worker outcome is unknown; retry uses the same provider idempotency key.'
            ELSE 'Worker outcome is unknown. Reconcile with the provider before any further send.'
          END,
          next_attempt_at = CASE
            WHEN $3 = 'guaranteed'
              AND provider = $2
              AND attempts < max_attempts
              THEN now()
            ELSE NULL
          END,
          updated_at = now()
      WHERE status = 'sending'
        AND provider = $2
        AND started_at IS NOT NULL
        AND started_at < now() - ($1 * interval '1 millisecond')
      RETURNING status
    `,
    [staleAfterMs, providerName, providerIdempotency],
  );

  return {
    recovered: result.rows.length,
    manualReview: result.rows.filter((row) => row.status === "manual_review")
      .length,
  };
}

/**
 * Looks up an outbound message by its provider message ID (wamid) within a
 * specific workspace. Used by the delivery-status webhook to match Meta events
 * back to the correct row.
 */
export async function getOutboundMessageByWamid(
  pool: Pool,
  workspaceId: string,
  providerMessageId: string,
): Promise<OutboundMessageRecord | null> {
  const result = await pool.query<OutboundMessageRow>(
    `
      SELECT ${OUTBOUND_MESSAGE_COLUMNS}
      FROM outbound_messages
      WHERE workspace_id = $1
        AND provider_message_id = $2
      LIMIT 1
    `,
    [workspaceId, providerMessageId],
  );

  const row = result.rows[0];
  return row ? mapOutboundMessageRow(row) : null;
}

const DELIVERY_EVENT_FAILURE_LIMIT = 500;

function boundedDeliveryReason(value: string | null): string | null {
  if (!value) return null;
  return [...value].slice(0, DELIVERY_EVENT_FAILURE_LIMIT).join("");
}

function deliveryEventKey(event: DeliveryStatusEvent): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        event.phoneNumberId,
        event.providerMessageId,
        event.status,
        event.providerTimestamp.toISOString(),
      ]),
    )
    .digest("hex");
}

function deliveryStatusRank(status: string): number {
  switch (status) {
    case "sent":
      return 1;
    case "failed":
      return 2;
    case "delivered":
      return 3;
    case "read":
      return 4;
    default:
      return 0;
  }
}

export type DeliveryEventProcessingOutcome = "processed" | "ignored" | "duplicate";

/**
 * Inserts an auditable event and applies its state transition atomically.
 * The event key is derived from the provider identity and timestamp, so a
 * webhook redelivery cannot apply the same status twice.
 */
export async function processOutboundDeliveryEvent(
  pool: Pool,
  workspaceId: string,
  event: DeliveryStatusEvent,
  failureReason: string | null,
): Promise<DeliveryEventProcessingOutcome> {
  const client = await pool.connect();
  const eventKey = deliveryEventKey(event);
  const boundedReason = boundedDeliveryReason(failureReason);

  try {
    await client.query("BEGIN");

    const inserted = await client.query<{ id: string }>(
      `
        INSERT INTO whatsapp_delivery_events (
          event_key,
          workspace_id,
          outbound_message_id,
          provider_message_id,
          phone_number_id,
          provider_status,
          provider_timestamp,
          processing_outcome
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'processing')
        ON CONFLICT (workspace_id, event_key) DO NOTHING
        RETURNING id
      `,
      [
        eventKey,
        workspaceId,
        event.providerMessageId,
        event.phoneNumberId,
        event.status,
        event.providerTimestamp,
      ],
    );

    const insertedEvent = inserted.rows[0];
    if (!insertedEvent) {
      const existing = await client.query<{ processing_outcome: string }>(
        `
          SELECT processing_outcome
          FROM whatsapp_delivery_events
          WHERE workspace_id = $1
            AND event_key = $2
          FOR UPDATE
        `,
        [workspaceId, eventKey],
      );
      const outcome = existing.rows[0]?.processing_outcome;

      if (outcome === "processed" || outcome === "ignored") {
        await client.query(
          `
            UPDATE whatsapp_delivery_events
            SET duplicate_count = duplicate_count + 1,
                last_received_at = now(),
                processing_reason = CASE
                  WHEN duplicate_count = 0
                    THEN 'Duplicate provider webhook delivery observed.'
                  ELSE processing_reason
                END
            WHERE workspace_id = $1
              AND event_key = $2
          `,
          [workspaceId, eventKey],
        );
        await client.query("COMMIT");
        return "duplicate";
      }

      await client.query(
        `
          UPDATE whatsapp_delivery_events
          SET processing_outcome = 'processing',
              processing_reason = NULL,
              failure_reason = NULL
          WHERE workspace_id = $1
            AND event_key = $2
        `,
        [workspaceId, eventKey],
      );
    }

    const outbound = await client.query<{
      id: string;
      status: string;
      provider_status_at: Date | null;
    }>(
      `
        SELECT id, status, provider_status_at
        FROM outbound_messages
        WHERE workspace_id = $1
          AND provider_message_id = $2
        FOR UPDATE
      `,
      [workspaceId, event.providerMessageId],
    );
    const message = outbound.rows[0];

    if (!message) {
      await client.query(
        `
          UPDATE whatsapp_delivery_events
          SET processing_outcome = 'ignored',
              processing_reason = 'No outbound message matches this wamid in the configured workspace.'
          WHERE workspace_id = $1
            AND event_key = $2
        `,
        [workspaceId, eventKey],
      );
      await client.query("COMMIT");
      return "ignored";
    }

    await client.query(
      `
        UPDATE whatsapp_delivery_events
        SET outbound_message_id = $3
        WHERE workspace_id = $1
          AND event_key = $2
      `,
      [workspaceId, eventKey, message.id],
    );

    const supportedRank = deliveryStatusRank(event.status);
    if (supportedRank === 0) {
      await client.query(
        `
          UPDATE whatsapp_delivery_events
          SET processing_outcome = 'ignored',
              processing_reason = 'Unsupported provider status.'
          WHERE workspace_id = $1
            AND event_key = $2
        `,
        [workspaceId, eventKey],
      );
      await client.query("COMMIT");
      return "ignored";
    }

    const currentTimestamp = message.provider_status_at;
    const isOlder =
      currentTimestamp !== null &&
      event.providerTimestamp.getTime() < currentTimestamp.getTime();
    const isSameTimestamp =
      currentTimestamp !== null &&
      event.providerTimestamp.getTime() === currentTimestamp.getTime();
    const currentRank = deliveryStatusRank(message.status);
    const isTieRegression =
      isSameTimestamp && supportedRank <= currentRank;
    const isTerminalPositive =
      (message.status === "read" && event.status !== "read") ||
      (message.status === "delivered" &&
        (event.status === "sent" || event.status === "failed"));
    const isTerminalInternal =
      message.status === "cancelled" || message.status === "manual_review";

    if (
      isOlder ||
      isTieRegression ||
      isTerminalPositive ||
      isTerminalInternal
    ) {
      await client.query(
        `
          UPDATE whatsapp_delivery_events
          SET processing_outcome = 'ignored',
              processing_reason = 'Event is stale or cannot advance the current outbound status.'
          WHERE workspace_id = $1
            AND event_key = $2
        `,
        [workspaceId, eventKey],
      );
      await client.query("COMMIT");
      return "ignored";
    }

    const nextFailureReason =
      event.status === "failed"
        ? (boundedReason ?? "Meta reported delivery failure.")
        : null;
    await client.query(
      `
        UPDATE outbound_messages
        SET status = $3,
            provider_status_at = $4,
            sent_at = CASE
              WHEN $3 = 'sent' THEN COALESCE(sent_at, $4)
              ELSE sent_at
            END,
            delivered_at = CASE
              WHEN $3 IN ('delivered', 'read') THEN COALESCE(delivered_at, $4)
              ELSE delivered_at
            END,
            failure_reason = $5,
            updated_at = now()
        WHERE id = $1
          AND workspace_id = $2
      `,
      [
        message.id,
        workspaceId,
        event.status,
        event.providerTimestamp,
        nextFailureReason,
      ],
    );
    await client.query(
      `
        UPDATE whatsapp_delivery_events
        SET processing_outcome = 'processed'
        WHERE workspace_id = $1
          AND event_key = $2
      `,
      [workspaceId, eventKey],
    );
    await client.query("COMMIT");
    return "processed";
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original processing error.
    }

    const failure =
      error instanceof Error ? error.message : "Unknown event-processing failure.";
    await pool.query(
      `
        INSERT INTO whatsapp_delivery_events (
          event_key,
          workspace_id,
          outbound_message_id,
          provider_message_id,
          phone_number_id,
          provider_status,
          provider_timestamp,
          processing_outcome,
          failure_reason
        )
        SELECT
          $1,
          $2,
          (
            SELECT id
            FROM outbound_messages
            WHERE workspace_id = $2
              AND provider_message_id = $3
            LIMIT 1
          ),
          $3,
          $4,
          $5,
          $6,
          'failed',
          $7
        ON CONFLICT (workspace_id, event_key)
        DO UPDATE SET
          processing_outcome = 'failed',
          failure_reason = EXCLUDED.failure_reason,
          outbound_message_id = COALESCE(
            whatsapp_delivery_events.outbound_message_id,
            EXCLUDED.outbound_message_id
          )
      `,
      [
        eventKey,
        workspaceId,
        event.providerMessageId,
        event.phoneNumberId,
        event.status,
        event.providerTimestamp,
        boundedDeliveryReason(failure),
      ],
    );
    throw error;
  } finally {
    client.release();
  }
}

function directDeliveryEvent(
  providerMessageId: string,
  status: string,
  providerTimestamp: Date,
  errorDescription: string | null = null,
): DeliveryStatusEvent {
  return {
    providerMessageId,
    phoneNumberId: "00000",
    status,
    providerTimestamp,
    errorDescription,
  };
}

export async function markOutboundDeliveryEventSent(
  pool: Pool,
  workspaceId: string,
  providerMessageId: string,
  eventTimestamp: Date,
): Promise<boolean> {
  return (
    (await processOutboundDeliveryEvent(
      pool,
      workspaceId,
      directDeliveryEvent(providerMessageId, "sent", eventTimestamp),
      null,
    )) === "processed"
  );
}

export async function markOutboundDeliveryEventDelivered(
  pool: Pool,
  workspaceId: string,
  providerMessageId: string,
  eventTimestamp: Date,
): Promise<boolean> {
  return (
    (await processOutboundDeliveryEvent(
      pool,
      workspaceId,
      directDeliveryEvent(providerMessageId, "delivered", eventTimestamp),
      null,
    )) === "processed"
  );
}

export async function markOutboundDeliveryEventRead(
  pool: Pool,
  workspaceId: string,
  providerMessageId: string,
  eventTimestamp: Date,
): Promise<boolean> {
  return (
    (await processOutboundDeliveryEvent(
      pool,
      workspaceId,
      directDeliveryEvent(providerMessageId, "read", eventTimestamp),
      null,
    )) === "processed"
  );
}

export async function markOutboundDeliveryEventFailed(
  pool: Pool,
  workspaceId: string,
  providerMessageId: string,
  eventTimestamp: Date,
  failureReason: string,
): Promise<boolean> {
  return (
    (await processOutboundDeliveryEvent(
      pool,
      workspaceId,
      directDeliveryEvent(
        providerMessageId,
        "failed",
        eventTimestamp,
        failureReason,
      ),
      failureReason,
    )) === "processed"
  );
}
