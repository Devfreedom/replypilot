import { z } from "zod";

const processingStatusSchema = z.enum(["stored", "unsupported"]);

const conversationSchema = z.object({
  id: z.uuid(),
  phoneNumberId: z.string(),
  customerWaId: z.string(),
  contactName: z.string().nullable(),
  leadId: z.uuid().nullable(),
  lastMessageAt: z.iso.datetime({ offset: true }).nullable(),
  lastMessagePreview: z.string().nullable(),
  lastMessageType: z.string().nullable(),
  lastMessageStatus: processingStatusSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

const messageSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  direction: z.enum(["inbound", "outbound"]),
  messageType: z.string(),
  text: z.string().nullable(),
  providerTimestamp: z.iso.datetime({ offset: true }),
  processingStatus: processingStatusSchema,
  createdAt: z.iso.datetime({ offset: true }),
});

const conversationsResponseSchema = z.object({
  conversations: z.array(conversationSchema),
});

const conversationMessagesResponseSchema = z.object({
  conversation: conversationSchema,
  messages: z.array(messageSchema),
});

export type WhatsAppConversation = z.infer<typeof conversationSchema>;
export type WhatsAppMessage = z.infer<typeof messageSchema>;

export function parseConversationsResponse(
  data: unknown,
): WhatsAppConversation[] | null {
  const parsed = conversationsResponseSchema.safeParse(data);
  return parsed.success ? parsed.data.conversations : null;
}

export function parseConversationMessagesResponse(
  data: unknown,
): { conversation: WhatsAppConversation; messages: WhatsAppMessage[] } | null {
  const parsed = conversationMessagesResponseSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function conversationDisplayName(
  conversation: WhatsAppConversation,
): string {
  const name = conversation.contactName?.trim();

  if (name) {
    return name;
  }

  return /^\d+$/.test(conversation.customerWaId)
    ? `+${conversation.customerWaId}`
    : conversation.customerWaId;
}

export function conversationPreview(
  conversation: WhatsAppConversation,
): string {
  if (!conversation.lastMessageType) {
    return "No messages yet";
  }

  if (conversation.lastMessageStatus === "unsupported") {
    return `Unsupported ${conversation.lastMessageType} message`;
  }

  return conversation.lastMessagePreview?.trim() || "Message content unavailable";
}

export function formatWhatsAppTimestamp(value: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
