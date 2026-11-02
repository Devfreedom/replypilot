import type {
  OutboundMessageStatus,
} from "../messaging/types.js";
import type {
  ConversationCustomer,
  ConversationStatus,
} from "../whatsapp/types.js";

export type OutboundMessageRecord = Readonly<{
  id: string;
  conversationId: string;
  replyDraftId: string;
  provider: string;
  providerMessageId: string | null;
  content: string;
  status: OutboundMessageStatus;
  failureReason: string | null;
  attempts: number;
  maxAttempts: number;
  queuedAt: string;
  startedAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type OutboundMessageHistoryItem = Readonly<
  OutboundMessageRecord & {
    conversation: Readonly<{
      id: string;
      customer: ConversationCustomer;
      status: ConversationStatus;
    }>;
    canRetry: boolean;
    retryBlockReason:
      | "draft_not_approved"
      | "content_changed"
      | "conversation_inactive"
      | null;
  }
>;

/**
 * Raw DB row returned by claimQueuedOutboundMessages and other repository
 * queries. Includes workspace_id and customer_phone_e164 so the worker can
 * pass them to the provider without extra round-trips.
 */
export type OutboundMessageRow = Readonly<{
  id: string;
  workspace_id: string;
  conversation_id: string;
  reply_draft_id: string;
  provider: string;
  provider_message_id: string | null;
  content: string;
  status: OutboundMessageStatus;
  idempotency_key: string;
  failure_reason: string | null;
  attempts: number;
  max_attempts: number;
  queued_at: Date;
  started_at: Date | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
  updated_at: Date;
  /** Resolved from the conversation customer. Null for BSUID-only customers. */
  customer_phone_e164: string | null;
}>;

export type OutboundMessageHistoryRow = Readonly<{
  id: string;
  workspace_id: string;
  conversation_id: string;
  reply_draft_id: string;
  provider: string;
  provider_message_id: string | null;
  content: string;
  status: OutboundMessageStatus;
  idempotency_key: string;
  failure_reason: string | null;
  attempts: number;
  max_attempts: number;
  queued_at: Date;
  started_at: Date | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
  updated_at: Date;
  /** Null for BSUID-only customers (from conversation join). */
  customer_phone_e164: string | null;
  conversation_status: ConversationStatus;
  customer_id: string;
  customer_display_name: string | null;
  customer_provider_contact_id: string | null;
  reply_draft_status: string;
  reply_draft_content: string;
}>;
