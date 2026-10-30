export type WhatsAppIntegrationConfig = Readonly<{
  verifyToken: string;
  appSecret: string;
  phoneNumberId: string;
  workspaceId: string;
}>;

export type WhatsAppMessageProcessingStatus = "stored" | "unsupported";

export const CONVERSATION_STATUSES = ["open", "closed", "archived"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export type ConversationCustomer = Readonly<{
  id: string;
  displayName: string | null;
  phoneE164: string | null;
}>;

export type ConversationSummary = Readonly<{
  id: string;
  customer: ConversationCustomer;
  whatsappConnectionId: string;
  phoneNumberId: string;
  channel: "whatsapp";
  status: ConversationStatus;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageType: string | null;
  lastMessageStatus: WhatsAppMessageProcessingStatus | null;
  createdAt: string;
  updatedAt: string;
}>;

export type ConversationPagination = Readonly<{
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
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
  processingStatus: WhatsAppMessageProcessingStatus;
  createdAt: string;
}>;

export type PersistInboundResult = Readonly<{
  stored: number;
  duplicates: number;
}>;
