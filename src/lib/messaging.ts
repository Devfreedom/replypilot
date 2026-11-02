import { z } from "zod";

export const APPROVAL_SEND_POLICIES = [
  "approve_only",
  "approve_and_send",
] as const;
export type ApprovalSendPolicy = (typeof APPROVAL_SEND_POLICIES)[number];

export const APPROVAL_SEND_POLICY_LABELS: Record<
  ApprovalSendPolicy,
  string
> = {
  approve_only: "Approve only",
  approve_and_send: "Approve and queue for sending",
};

export const APPROVAL_SEND_POLICY_DESCRIPTIONS: Record<
  ApprovalSendPolicy,
  string
> = {
  approve_only:
    "Approval records your review. A send must be started explicitly from an approved draft.",
  approve_and_send:
    "Approval also queues the reply for the mock outbound worker. Nothing is sent to WhatsApp in this milestone.",
};

export const OUTBOUND_MESSAGE_STATUSES = [
  "queued",
  "sending",
  "sent",
  "delivered",
  "read",
  "failed",
  "cancelled",
  "manual_review",
] as const;
export type OutboundMessageStatus =
  (typeof OUTBOUND_MESSAGE_STATUSES)[number];

export const OUTBOUND_STATUS_LABELS: Record<OutboundMessageStatus, string> = {
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed",
  cancelled: "Cancelled",
  manual_review: "Needs review",
};

export const OUTBOUND_STATUS_DESCRIPTIONS: Record<
  OutboundMessageStatus,
  string
> = {
  queued: "Waiting for the outbound worker.",
  sending: "The worker is attempting provider acceptance.",
  sent: "The mock provider accepted the message. Delivery is not confirmed.",
  delivered: "The provider reported delivery.",
  failed: "The provider rejected the message after the allowed attempts.",
  cancelled: "The approval or active conversation is no longer valid.",
  manual_review:
    "The provider outcome is unknown. Do not retry until you check the provider's own records. ReplyPilot cannot reconcile this automatically.",
};

const approvalSendPolicySchema = z.enum(APPROVAL_SEND_POLICIES);
const outboundStatusSchema = z.enum(OUTBOUND_MESSAGE_STATUSES);

export const outboundMessageSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  replyDraftId: z.uuid(),
  provider: z.string(),
  providerMessageId: z.string().nullable(),
  content: z.string(),
  status: outboundStatusSchema,
  failureReason: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  queuedAt: z.iso.datetime({ offset: true }),
  startedAt: z.iso.datetime({ offset: true }).nullable(),
  sentAt: z.iso.datetime({ offset: true }).nullable(),
  deliveredAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

const outboundCustomerSchema = z.object({
  id: z.uuid(),
  displayName: z.string().nullable(),
  phoneE164: z.string().nullable(),
  providerContactId: z.string().nullable(),
});

const outboundHistoryItemSchema = outboundMessageSchema.extend({
  conversation: z.object({
    id: z.uuid(),
    customer: outboundCustomerSchema,
    status: z.enum(["open", "closed", "archived"]),
  }),
  canRetry: z.boolean(),
  retryBlockReason: z
    .enum([
      "draft_not_approved",
      "content_changed",
      "conversation_inactive",
    ])
    .nullable(),
});

const outboundMessagesResponseSchema = z.object({
  messages: z.array(outboundHistoryItemSchema),
  pagination: z.object({
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextOffset: z.number().int().nonnegative().nullable(),
  }),
});

const outboundMessageLookupResponseSchema = z.object({
  outboundMessage: outboundMessageSchema.nullable(),
});

const messagingSettingsSchema = z.object({
  defaultApprovalSendPolicy: approvalSendPolicySchema,
});

const messagingSettingsResponseSchema = z.object({
  settings: messagingSettingsSchema,
});

export type OutboundMessage = z.infer<typeof outboundMessageSchema>;
export type OutboundHistoryItem = z.infer<typeof outboundHistoryItemSchema>;
export type OutboundRetryBlockReason =
  | "draft_not_approved"
  | "content_changed"
  | "conversation_inactive";
export type OutboundMessagesResponse = z.infer<
  typeof outboundMessagesResponseSchema
>;
export type MessagingSettings = z.infer<typeof messagingSettingsSchema>;

export function parseOutboundMessage(data: unknown): OutboundMessage | null {
  const parsed = outboundMessageSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function parseOutboundMessageLookupResponse(
  data: unknown,
): Readonly<{ outboundMessage: OutboundMessage | null }> | null {
  const parsed = outboundMessageLookupResponseSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function parseSendOutboundMessageResponse(
  data: unknown,
): OutboundMessage | null {
  const parsed = z
    .object({ outboundMessage: outboundMessageSchema })
    .safeParse(data);
  return parsed.success ? parsed.data.outboundMessage : null;
}

export function sendPolicyChoiceForDraftSelection(
  previousDraftId: string | null,
  nextDraftId: string,
  currentChoice: ApprovalSendPolicy | "default",
): ApprovalSendPolicy | "default" {
  return previousDraftId === nextDraftId ? currentChoice : "default";
}

export function preferredConversationIdForDraft(
  existingConversationId: string | null,
  conversations: readonly Readonly<{ id: string }>[],
): string {
  if (existingConversationId !== null) {
    return conversations.some(
      (conversation) => conversation.id === existingConversationId,
    )
      ? existingConversationId
      : "";
  }

  return conversations.length === 1 ? conversations[0].id : "";
}

export function isRetryableConversationStatus(
  status: "open" | "closed" | "archived",
): boolean {
  return status === "open" || status === "closed";
}

export function retryBlockDescription(
  reason: OutboundRetryBlockReason,
): string {
  switch (reason) {
    case "draft_not_approved":
      return "The draft is no longer approved. Approve it again before retrying.";
    case "content_changed":
      return "The draft differs from the original message snapshot. Create a new draft to send revised content.";
    case "conversation_inactive":
      return "This conversation is archived. Reopen it before retrying. The message cannot be retargeted.";
  }
}

export function canRetryOutboundForRole(
  role: "owner" | "member" | null,
  canRetry: boolean,
): boolean {
  return role === "owner" && canRetry;
}

export function parseOutboundMessagesResponse(
  data: unknown,
): OutboundMessagesResponse | null {
  const parsed = outboundMessagesResponseSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function parseMessagingSettingsResponse(
  data: unknown,
): MessagingSettings | null {
  const parsed = messagingSettingsResponseSchema.safeParse(data);
  return parsed.success ? parsed.data.settings : null;
}

export function outboundStatusLabel(status: OutboundMessageStatus): string {
  return OUTBOUND_STATUS_LABELS[status];
}

/**
 * Provider acceptance (`sent`) is deliberately distinct from delivery
 * (`delivered`). UI copy must not describe `sent` as delivered.
 */
export function outboundStatusDescription(
  status: OutboundMessageStatus,
): string {
  return OUTBOUND_STATUS_DESCRIPTIONS[status];
}
