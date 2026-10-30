import { z } from "zod";

const processingStatusSchema = z.enum(["stored", "unsupported"]);

export const CONVERSATION_STATUSES = ["open", "closed", "archived"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const CONVERSATION_FILTERS = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
] as const satisfies readonly {
  value: ConversationStatus | "all";
  label: string;
}[];

export type ConversationFilter = (typeof CONVERSATION_FILTERS)[number]["value"];

const conversationStatusSchema = z.enum(CONVERSATION_STATUSES);

const conversationCustomerSchema = z.object({
  id: z.uuid(),
  displayName: z.string().nullable(),
  phoneE164: z.string().nullable(),
  providerContactId: z.string().nullable(),
});

const conversationSchema = z.object({
  id: z.uuid(),
  customer: conversationCustomerSchema,
  whatsappConnectionId: z.uuid(),
  phoneNumberId: z.string(),
  channel: z.literal("whatsapp"),
  status: conversationStatusSchema,
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

const paginationSchema = z.object({
  limit: z.number().int().positive(),
  hasMore: z.boolean(),
  offset: z.number().int().nonnegative().optional(),
  nextOffset: z.number().int().nonnegative().nullable().optional(),
  nextCursor: z.string().nullable().optional(),
  prevCursor: z.string().nullable().optional(),
  direction: z.enum(["before", "after"]).optional(),
});

const conversationsResponseSchema = z.object({
  conversations: z.array(conversationSchema),
  pagination: paginationSchema.optional(),
});

const conversationMessagesResponseSchema = z.object({
  conversation: conversationSchema,
  messages: z.array(messageSchema),
  pagination: paginationSchema.optional(),
});

export type WhatsAppConversation = z.infer<typeof conversationSchema>;
export type WhatsAppCustomer = z.infer<typeof conversationCustomerSchema>;
export type WhatsAppMessage = z.infer<typeof messageSchema>;
export type WhatsAppPagination = z.infer<typeof paginationSchema>;

export type ConversationsResponse = Readonly<{
  conversations: WhatsAppConversation[];
  pagination: WhatsAppPagination | null;
}>;

export type ConversationMessagesResponse = Readonly<{
  conversation: WhatsAppConversation;
  messages: WhatsAppMessage[];
  pagination: WhatsAppPagination | null;
}>;

export function parseConversationsResponse(
  data: unknown,
): ConversationsResponse | null {
  const parsed = conversationsResponseSchema.safeParse(data);

  if (!parsed.success) {
    return null;
  }

  return {
    conversations: parsed.data.conversations,
    pagination: parsed.data.pagination ?? null,
  };
}

export function parseConversationMessagesResponse(
  data: unknown,
): ConversationMessagesResponse | null {
  const parsed = conversationMessagesResponseSchema.safeParse(data);

  if (!parsed.success) {
    return null;
  }

  return {
    conversation: parsed.data.conversation,
    messages: parsed.data.messages,
    pagination: parsed.data.pagination ?? null,
  };
}

export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  open: "Open",
  closed: "Closed",
  archived: "Archived",
};

/**
 * A customer may be identified by a normalized phone number or by a provider
 * contact ID (for example a BSUID). A provider ID is never a phone number and
 * is therefore never prefixed with `+`.
 */
export function conversationDisplayName(
  conversation: WhatsAppConversation,
): string {
  const name = conversation.customer.displayName?.trim();

  if (name) {
    return name;
  }

  const phone = conversation.customer.phoneE164?.trim();

  if (phone) {
    return phone;
  }

  const providerId = conversation.customer.providerContactId?.trim();

  if (providerId) {
    return providerId;
  }

  return `Customer ${conversation.customer.id.slice(0, 8)}`;
}

export type ConversationIdentity = Readonly<{
  label: string;
  value: string;
}>;

export function conversationIdentity(
  conversation: WhatsAppConversation,
): ConversationIdentity {
  const phone = conversation.customer.phoneE164?.trim();

  if (phone) {
    return { label: "Phone", value: phone };
  }

  const providerId = conversation.customer.providerContactId?.trim();

  if (providerId) {
    return { label: "WhatsApp contact ID", value: providerId };
  }

  return { label: "Customer", value: conversation.customer.id };
}

export function conversationInitials(
  conversation: WhatsAppConversation,
): string {
  const name = conversationDisplayName(conversation);
  const letters = name.replace(/[^A-Za-z]/g, "");

  if (letters) {
    return letters.slice(0, 2).toUpperCase();
  }

  const digits = name.replace(/\D/g, "");
  return digits.slice(-2) || "#";
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

export function mergeConversations(
  existing: readonly WhatsAppConversation[],
  incoming: readonly WhatsAppConversation[],
): WhatsAppConversation[] {
  const byId = new Map(
    existing.map((conversation) => [conversation.id, conversation]),
  );

  for (const conversation of incoming) {
    if (!byId.has(conversation.id)) {
      byId.set(conversation.id, conversation);
    }
  }

  return [...byId.values()];
}

/**
 * Preserves the order returned by the API. Pages are already chronological, so
 * an older page is prepended and a newer page is appended. Deduplicating by ID
 * keeps a cursor page from repeating its anchor row if a request overlaps.
 */
export function mergeMessages(
  existing: readonly WhatsAppMessage[],
  incoming: readonly WhatsAppMessage[],
  placement: "older" | "newer",
): WhatsAppMessage[] {
  const seen = new Set(existing.map((message) => message.id));
  const additions = incoming.filter((message) => {
    if (seen.has(message.id)) {
      return false;
    }

    seen.add(message.id);
    return true;
  });

  return placement === "older"
    ? [...additions, ...existing]
    : [...existing, ...additions];
}

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function formatWhatsAppTimestamp(value: string | null): string {
  const date = parseDate(value);

  if (!date) {
    return value ? "Unknown time" : "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatConversationTimestamp(
  value: string | null,
  now = new Date(),
): string {
  const date = parseDate(value);

  if (!date) {
    return value ? "Unknown time" : "";
  }

  if (sameLocalDay(date, now)) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameLocalDay(date, yesterday)) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatMessageTime(value: string): string {
  const date = parseDate(value);

  if (!date) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatMessageDay(
  value: string,
  now = new Date(),
): string {
  const date = parseDate(value);

  if (!date) {
    return "Unknown date";
  }

  if (sameLocalDay(date, now)) {
    return "Today";
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameLocalDay(date, yesterday)) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(date);
}

export function messageDayKey(value: string): string {
  const date = parseDate(value);

  if (!date) {
    return "unknown";
  }

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function formatMessageTitle(value: string): string {
  const date = parseDate(value);
  return date ? date.toLocaleString() : "Unknown time";
}
