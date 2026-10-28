export type WhatsAppIntegrationConfig = Readonly<{
  verifyToken: string;
  appSecret: string;
  phoneNumberId: string;
  workspaceId: string;
}>;

export type WhatsAppMessageProcessingStatus = "stored" | "unsupported";

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
