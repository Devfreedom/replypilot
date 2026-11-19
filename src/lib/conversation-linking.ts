import { z } from "zod";

/**
 * Stable, shared errors for lead conversation linkage.
 *
 * These mirror the server codes in `server/src/leads/errors.ts` and
 * `server/src/outbound/errors.ts` so the UI can tell the situations apart:
 * this lead has no conversation yet, this conversation belongs to a different
 * phone number, this lead's subscriber cannot be identified, this lead already
 * has a conversation, and the WhatsApp connection is disconnected.
 */

/** Stable machine-readable code for a lead without a linked conversation. */
export const WHATSAPP_CONVERSATION_REQUIRED_CODE =
  "WHATSAPP_CONVERSATION_REQUIRED";

/** Stable machine-readable code for a phone-number mismatch. */
export const WHATSAPP_CONVERSATION_PHONE_MISMATCH_CODE =
  "WHATSAPP_CONVERSATION_PHONE_MISMATCH";

/**
 * Stable machine-readable code for a lead whose subscriber identity is not
 * established.
 */
export const WHATSAPP_CONVERSATION_LEAD_NUMBER_UNKNOWN_CODE =
  "WHATSAPP_CONVERSATION_LEAD_NUMBER_UNKNOWN";

/** Stable machine-readable code for a lead that already has a conversation. */
export const WHATSAPP_CONVERSATION_LEAD_ALREADY_LINKED_CODE =
  "WHATSAPP_CONVERSATION_LEAD_ALREADY_LINKED";

/** Stable machine-readable code for a conversation linked to another lead. */
export const WHATSAPP_CONVERSATION_ALREADY_LINKED_CODE =
  "WHATSAPP_CONVERSATION_ALREADY_LINKED";

/** Stable machine-readable code for a conversation that cannot be linked. */
export const WHATSAPP_CONVERSATION_NOT_LINKABLE_CODE =
  "WHATSAPP_CONVERSATION_NOT_LINKABLE";

/** Stable machine-readable code for a disconnected WhatsApp connection. */
export const WHATSAPP_CONNECTION_DISCONNECTED_CODE =
  "WHATSAPP_CONNECTION_DISCONNECTED";

/** Stable machine-readable code for a WhatsApp connection that is not active. */
export const WHATSAPP_CONNECTION_PENDING_CODE = "WHATSAPP_CONNECTION_PENDING";

/** Stable machine-readable code for a WhatsApp connection that needs attention. */
export const WHATSAPP_CONNECTION_ERROR_CODE = "WHATSAPP_CONNECTION_ERROR";

/** Stable machine-readable code for a conversation with no WhatsApp connection. */
export const WHATSAPP_CONNECTION_MISSING_CODE = "WHATSAPP_CONNECTION_MISSING";

/** Stable machine-readable code for an AI-abstained reply draft. */
export const REPLY_DRAFT_ABSTAINED_CODE = "draft_abstained";

/** Stable machine-readable code for a suppressed customer opt-out/block. */
export const WHATSAPP_CUSTOMER_SUPPRESSED_CODE = "customer_suppressed";

/** Stable machine-readable code for a draft locked by an existing sent/unresolved outbound message. */
export const OUTBOUND_IN_PROGRESS_CODE = "outbound_in_progress";

/**
 * The guidance shown for each stable error code.
 *
 * The code is what distinguishes the situations; the message only explains
 * what to do next.
 */
export const WHATSAPP_ERROR_GUIDANCE: Readonly<Record<string, string>> = {
  [WHATSAPP_CONVERSATION_REQUIRED_CODE]:
    "This lead has no WhatsApp conversation yet. Link an existing conversation to this lead, or wait until the customer messages the business number.",
  [WHATSAPP_CONVERSATION_PHONE_MISMATCH_CODE]:
    "That conversation is with a different phone number than this lead. Check the lead's WhatsApp number, or correct the lead before linking.",
  [WHATSAPP_CONVERSATION_LEAD_NUMBER_UNKNOWN_CODE]:
    "This lead's WhatsApp number is not in international format, so its subscriber cannot be identified. Re-enter the lead's number with its country before linking a conversation.",
  [WHATSAPP_CONVERSATION_LEAD_ALREADY_LINKED_CODE]:
    "This lead already has an active WhatsApp conversation. Link the conversation to a different lead, or remove the existing link first.",
  [WHATSAPP_CONVERSATION_ALREADY_LINKED_CODE]:
    "That conversation is already linked to another lead. Unlink it first, or choose a different conversation.",
  [WHATSAPP_CONVERSATION_NOT_LINKABLE_CODE]:
    "Only an active WhatsApp conversation can be linked to a lead.",
  [WHATSAPP_CONNECTION_DISCONNECTED_CODE]:
    "The WhatsApp connection for this conversation is disconnected. Reconnect it before sending.",
  [WHATSAPP_CONNECTION_PENDING_CODE]:
    "The WhatsApp connection for this conversation is not active yet. Activate it before sending.",
  [WHATSAPP_CONNECTION_ERROR_CODE]:
    "The WhatsApp connection for this conversation needs attention. Verify it before sending.",
  [WHATSAPP_CONNECTION_MISSING_CODE]:
    "This conversation has no WhatsApp connection in this workspace.",
  [REPLY_DRAFT_ABSTAINED_CODE]:
    "AI abstained from answering this enquiry. Edit the draft with a manual reply before approving or sending.",
  [WHATSAPP_CUSTOMER_SUPPRESSED_CODE]:
    "Customer is suppressed and cannot receive outbound messages.",
  [OUTBOUND_IN_PROGRESS_CODE]:
    "This reply already has a sent or unresolved outbound message and cannot be edited or unapproved.",
};

/** The error payload the API returns for a rejected request. */
export const apiErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
});

export type ApiErrorPayload = z.infer<typeof apiErrorSchema>;

/**
 * Reads the stable code and the message from an API error body.
 *
 * A body without a code is still usable, but a coded body lets the UI show
 * the right guidance instead of one generic sentence.
 */
export function parseApiError(data: unknown): ApiErrorPayload | null {
  const parsed = apiErrorSchema.safeParse(data);

  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

/**
 * The message to show for an API error body.
 *
 * The server's own message wins when there is one, because it is written for
 * the situation. Otherwise the shared guidance for the code is used.
 */
export function apiErrorMessage(data: unknown, fallback: string): string {
  const parsed = parseApiError(data);

  if (!parsed) {
    return fallback;
  }

  if (parsed.error.trim()) {
    return parsed.error;
  }

  if (parsed.code && WHATSAPP_ERROR_GUIDANCE[parsed.code]) {
    return WHATSAPP_ERROR_GUIDANCE[parsed.code];
  }

  return fallback;
}

/** A conversation that may be linked to a lead. */
const linkableConversationSchema = z.object({
  id: z.uuid(),
  customerDisplayName: z.string().nullable(),
  customerPhoneE164: z.string().nullable(),
  status: z.string(),
  linkedLeadId: z.uuid().nullable(),
});

const linkableConversationsResponseSchema = z.object({
  conversations: z.array(linkableConversationSchema),
  pagination: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextOffset: z.number().int().nonnegative().nullable(),
  }),
});

export type LinkableConversation = z.infer<typeof linkableConversationSchema>;

export type LinkableConversationsPage = Readonly<{
  conversations: LinkableConversation[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
}>;

export function parseLinkableConversations(
  data: unknown,
): LinkableConversationsPage | null {
  const parsed = linkableConversationsResponseSchema.safeParse(data);

  if (!parsed.success) {
    return null;
  }

  return {
    conversations: parsed.data.conversations,
    pagination: parsed.data.pagination,
  };
}

/**
 * Whether a conversation can be offered for linking to this lead.
 *
 * The server already filters the list, so this is a second, local guard that
 * keeps a stale response from offering a conversation that belongs to another
 * lead or is no longer active.
 */
export function isConversationLinkable(
  conversation: LinkableConversation,
  leadId: string,
): boolean {
  if (conversation.linkedLeadId && conversation.linkedLeadId !== leadId) {
    return false;
  }

  return conversation.status === "open" || conversation.status === "closed";
}

/** A short label for a conversation that can be linked. */
export function linkableConversationLabel(
  conversation: LinkableConversation,
): string {
  const name = conversation.customerDisplayName?.trim();
  const phone = conversation.customerPhoneE164?.trim();
  const identity = name || phone || "Unknown contact";

  return phone && phone !== name
    ? `${identity} · ${phone}`
    : identity;
}
