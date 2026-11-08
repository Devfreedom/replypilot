import type { OutboundMessageStatus } from "../messaging/types.js";

/**
 * Webhook verification secrets plus the optional legacy single-workspace
 * configuration. New integrations resolve the workspace from the registered
 * connection for each Meta phone-number ID; the legacy fields remain while
 * existing deployments migrate.
 */
export type WhatsAppIntegrationConfig = Readonly<{
  verifyToken: string;
  appSecret: string;
  phoneNumberId?: string;
  workspaceId?: string;
}>;

export type WhatsAppMessageProcessingStatus = "stored" | "unsupported";

export const CONVERSATION_STATUSES = ["open", "closed", "archived"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/**
 * Query filter for conversation lists. `all` is not a stored status; it means
 * the repository should not restrict rows by status.
 */
export const CONVERSATION_STATUS_FILTERS = [
  ...CONVERSATION_STATUSES,
  "all",
] as const;
export type ConversationStatusFilter =
  (typeof CONVERSATION_STATUS_FILTERS)[number];

export type ConversationCustomer = Readonly<{
  id: string;
  displayName: string | null;
  phoneE164: string | null;
  /**
   * Provider identifier for customers that are not identified by a phone
   * number, for example a WhatsApp business-scoped user ID (BSUID). This is
   * never a phone number and must not be formatted as one.
   */
  providerContactId: string | null;
}>;

export type ConversationSummary = Readonly<{
  id: string;
  customer: ConversationCustomer;
  whatsappConnectionId: string;
  phoneNumberId: string;
  channel: "whatsapp";
  status: ConversationStatus;
  leadId: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageType: string | null;
  lastMessageStatus: WhatsAppMessageProcessingStatus | null;
  lastMessageDirection: "inbound" | "outbound" | null;
  lastMessageOutboundStatus: OutboundMessageStatus | null;
  createdAt: string;
  updatedAt: string;
}>;

export type ConversationPagination = Readonly<{
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
}>;

export const MESSAGE_PAGE_DIRECTIONS = ["before", "after"] as const;
export type MessagePageDirection = (typeof MESSAGE_PAGE_DIRECTIONS)[number];

export type MessageCursorPagination = Readonly<{
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
  prevCursor: string | null;
  direction: MessagePageDirection;
}>;

export type InboundWhatsAppMessage = Readonly<{
  providerMessageId: string;
  phoneNumberId: string;
  senderWaId: string;
  senderPhoneNumber: string | null;
  contactName: string | null;
  messageType: string;
  text: string | null;
  providerTimestamp: Date;
}>;

export type WhatsAppConversation = Readonly<{
  id: string;
  phoneNumberId: string;
  customerWaId: string;
  contactName: string | null;
  leadId: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageType: string | null;
  lastMessageStatus: WhatsAppMessageProcessingStatus | null;
  lastMessageDirection: "inbound" | "outbound" | null;
  lastMessageOutboundStatus: OutboundMessageStatus | null;
  createdAt: string;
  updatedAt: string;
}>;

export type WhatsAppMessage = Readonly<{
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  messageType: string;
  text: string | null;
  providerTimestamp: string;
  /** Null for outbound messages, which use outboundStatus instead. */
  processingStatus: WhatsAppMessageProcessingStatus | null;
  /** Null for inbound messages. `sent` is provider acceptance, not delivery. */
  outboundStatus: OutboundMessageStatus | null;
  failureReason: string | null;
  createdAt: string;
}>;

export type PersistInboundResult = Readonly<{
  stored: number;
  duplicates: number;
}>;

/**
 * A parsed delivery-status event from Meta's webhook `statuses` array.
 * The `providerMessageId` (wamid) is used to match the event back to the
 * corresponding outbound_messages row.
 */
export type DeliveryStatusEvent = Readonly<{
  /** The wamid of the outbound message this event refers to. */
  providerMessageId: string;
  /** The phone-number ID that sent the message (the business sender). */
  phoneNumberId: string;
  /**
   * Provider status. Only the four statuses listed below are processed;
   * others (e.g. "read", "warning") are captured here for completeness.
   */
  status: "sent" | "delivered" | "read" | "failed" | string;
  /**
   * The authoritative event timestamp from Meta, in seconds since epoch.
   * This is preserved exactly as provided by Meta.
   */
  providerTimestamp: Date;
  /**
   * Bounded error description for failed events. Never includes sensitive
   * provider data beyond error code and type.
   */
  errorDescription: string | null;
}>;

