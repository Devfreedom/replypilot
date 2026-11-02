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

export type OutboundMessageRow = Readonly<{
  id: string;
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
}>;

export type OutboundMessageHistoryRow = Readonly<
  OutboundMessageRow & {
    conversation_status: ConversationStatus;
    customer_id: string;
    customer_display_name: string | null;
    customer_phone_e164: string | null;
    customer_provider_contact_id: string | null;
    reply_draft_status: string;
    reply_draft_content: string;
  }
>;
