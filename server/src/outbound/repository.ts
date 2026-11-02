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
          failure_reason =
            'Draft content, approval, or active conversation is no longer valid.',
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
        )
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

/**
 * Delivery-status event: "sent" acknowledgement from the Meta platform.
 * Only advances the status when the current state allows it (sent → sent is
 * idempotent, but cannot overwrite delivered or read).
 */
export async function markOutboundDeliveryEventSent(
  pool: Pool,
  workspaceId: string,
  providerMessageId: string,
  eventTimestamp: Date,
): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE outbound_messages
      SET status = 'sent',
          sent_at = COALESCE(sent_at, $3),
          updated_at = now()
      WHERE workspace_id = $1
        AND provider_message_id = $2
        AND status IN ('sent', 'sending', 'queued')
        AND status NOT IN ('delivered', 'read')
    `,
    [workspaceId, providerMessageId, eventTimestamp],
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Delivery-status event: customer device acknowledged receipt.
 * delivered cannot regress to sent. An already-read row is not downgraded.
 */
export async function markOutboundDeliveryEventDelivered(
  pool: Pool,
  workspaceId: string,
  providerMessageId: string,
  eventTimestamp: Date,
): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE outbound_messages
      SET status = 'delivered',
          delivered_at = COALESCE(delivered_at, $3),
          updated_at = now()
      WHERE workspace_id = $1
        AND provider_message_id = $2
        AND status NOT IN ('read', 'cancelled', 'failed', 'manual_review')
    `,
    [workspaceId, providerMessageId, eventTimestamp],
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Delivery-status event: customer read the message.
 * read is the terminal positive state; it cannot be overwritten by delivered
 * or sent events. Sets delivered_at if not already set to preserve the audit
 * trail.
 */
export async function markOutboundDeliveryEventRead(
  pool: Pool,
  workspaceId: string,
  providerMessageId: string,
  eventTimestamp: Date,
): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE outbound_messages
      SET status = 'read',
          delivered_at = COALESCE(delivered_at, $3),
          updated_at = now()
      WHERE workspace_id = $1
        AND provider_message_id = $2
        AND status NOT IN ('read', 'cancelled', 'failed', 'manual_review')
    `,
    [workspaceId, providerMessageId, eventTimestamp],
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Delivery-status event: Meta reports a permanent failure to deliver.
 * Only recorded when the message is in a state where failure is meaningful;
 * does not overwrite a delivered or read status. The raw error object is
 * passed as a bounded JSON string for audit purposes but must not include
 * sensitive provider data.
 */
export async function markOutboundDeliveryEventFailed(
  pool: Pool,
  workspaceId: string,
  providerMessageId: string,
  eventTimestamp: Date,
  failureReason: string,
): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE outbound_messages
      SET status = 'failed',
          failure_reason = $4,
          updated_at = now()
      WHERE workspace_id = $1
        AND provider_message_id = $2
        AND status NOT IN (
          'delivered', 'read', 'cancelled', 'failed', 'manual_review'
        )
    `,
    [workspaceId, providerMessageId, eventTimestamp, failureReason],
  );

  return (result.rowCount ?? 0) > 0;
}
