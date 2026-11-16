import { z } from "zod";
import {
  APPROVAL_SEND_POLICIES,
  outboundMessageSchema,
  type OutboundMessage,
} from "./messaging";

export const LEAD_STATUSES = [
  "New",
  "Contacted",
  "Quoted",
  "Booked",
] as const;

export const LEAD_CHANNELS = ["WhatsApp", "Manual"] as const;

const leadSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  service: z.string(),
  channel: z.enum(LEAD_CHANNELS),
  status: z.enum(LEAD_STATUSES),
  lastMessage: z.string(),
  whatsappNumber: z.string().nullable(),
  nextFollowUpAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

const leadsResponseSchema = z.object({ leads: z.array(leadSchema) });
const leadResponseSchema = z.object({ lead: leadSchema });

/**
 * Stable machine-readable code for a confirmed duplicate lead number.
 *
 * A duplicate is confirmed when another lead in the workspace holds exactly
 * the same subscriber number.
 */
export const WHATSAPP_LEAD_DUPLICATE_NUMBER_CODE =
  "WHATSAPP_LEAD_DUPLICATE_NUMBER";

/**
 * Stable machine-readable code for a possible duplicate that could not be
 * resolved.
 *
 * Another lead stores the number in a national format whose country is not
 * recorded, so the API cannot confirm whether it is the same customer.
 */
export const WHATSAPP_LEAD_NUMBER_UNRESOLVED_CODE =
  "WHATSAPP_LEAD_NUMBER_UNRESOLVED";

/** The error payload the API returns when a lead cannot be created. */
export const leadCreationErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  conflictingLeadId: z.uuid().optional(),
});

export type LeadCreationErrorPayload = z.infer<typeof leadCreationErrorSchema>;

/**
 * An error returned by the lead API.
 *
 * The stable code travels with the error so the UI can react to the specific
 * situation instead of showing one generic message.
 */
export class LeadApiError extends Error {
  readonly code: string | undefined;

  readonly conflictingLeadId: string | undefined;

  constructor(
    message: string,
    options: Readonly<{
      code?: string;
      conflictingLeadId?: string;
    }> = {},
  ) {
    super(message);
    this.name = "LeadApiError";
    this.code = options.code;
    this.conflictingLeadId = options.conflictingLeadId;
  }
}

/**
 * Reads a lead creation error body.
 *
 * Returns null for a body that is not an error payload, so a caller can fall
 * back to its own message.
 */
export function parseLeadCreationError(
  data: unknown,
): LeadCreationErrorPayload | null {
  const parsed = leadCreationErrorSchema.safeParse(data);

  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}
export const REPLY_DRAFT_INTENTS = [
  "availability",
  "pricing",
  "service-details",
  "booking",
  "general-enquiry",
] as const;
export const REPLY_DRAFT_REVIEW_STATUSES = ["draft", "approved"] as const;
export const REPLY_DRAFT_SOURCE_TYPES = ["catalogue", "faq", "policy"] as const;

const replyDraftSourceSchema = z.object({
  id: z.uuid(),
  type: z.enum(REPLY_DRAFT_SOURCE_TYPES),
  title: z.string(),
  content: z.string(),
  reason: z.string(),
  priceMinor: z.number().int().min(0).nullable(),
  currencyCode: z.string().nullable(),
});

const replyDraftSchema = z.object({
  intent: z.enum(REPLY_DRAFT_INTENTS),
  summary: z.string(),
  missingInformation: z.array(z.string()),
  draftReply: z.string(),
  provider: z.literal("mock"),
  isDemo: z.literal(true),
});

const approvalSendPolicySchema = z.enum(APPROVAL_SEND_POLICIES);

const savedReplyDraftSchema = replyDraftSchema.extend({
  id: z.uuid(),
  leadId: z.uuid(),
  status: z.enum(REPLY_DRAFT_REVIEW_STATUSES),
  sources: z.array(replyDraftSourceSchema),
  approvedAt: z.iso.datetime({ offset: true }).nullable(),
  approvedBy: z.uuid().nullable(),
  sendPolicyOverride: approvalSendPolicySchema.nullable(),
  approvalSendPolicy: approvalSendPolicySchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

const replyDraftResponseSchema = z.object({ draft: savedReplyDraftSchema });
const replyDraftsResponseSchema = z.object({
  drafts: z.array(savedReplyDraftSchema),
});
const approvalResponseSchema = z.object({
  draft: savedReplyDraftSchema,
  outboundMessage: outboundMessageSchema.nullable(),
});
const sendResponseSchema = z.object({
  outboundMessage: outboundMessageSchema,
});

export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadFilter = "All" | LeadStatus;
export type View = "overview" | "leads" | "follow-ups";
export type LeadChannel = (typeof LEAD_CHANNELS)[number];

export function parseDashboardView(value: string | null): View {
  return value === "leads" || value === "follow-ups" ? value : "overview";
}

export function dashboardViewHref(view: View): string {
  return `/?view=${view}`;
}
export type Lead = z.infer<typeof leadSchema>;
export type ReplyDraft = z.infer<typeof replyDraftSchema>;
export type ReplyDraftSource = z.infer<typeof replyDraftSourceSchema>;
export type ReplyDraftReviewStatus =
  (typeof REPLY_DRAFT_REVIEW_STATUSES)[number];
export type SavedReplyDraft = z.infer<typeof savedReplyDraftSchema>;

export const LEAD_FILTERS: LeadFilter[] = [
  "All",
  "New",
  "Contacted",
  "Quoted",
  "Booked",
];

export function parseLeadsResponse(data: unknown): Lead[] | null {
  const parsed = leadsResponseSchema.safeParse(data);
  return parsed.success ? parsed.data.leads : null;
}

export function parseLeadResponse(data: unknown): Lead | null {
  const parsed = leadResponseSchema.safeParse(data);
  return parsed.success ? parsed.data.lead : null;
}

export function parseReplyDraftResponse(data: unknown): ReplyDraft | null {
  const parsed = replyDraftSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function parseSavedReplyDraftResponse(
  data: unknown,
): SavedReplyDraft | null {
  const parsed = replyDraftResponseSchema.safeParse(data);
  return parsed.success ? parsed.data.draft : null;
}

export function parseReplyDraftsResponse(
  data: unknown,
): SavedReplyDraft[] | null {
  const parsed = replyDraftsResponseSchema.safeParse(data);
  return parsed.success ? parsed.data.drafts : null;
}

export type ReplyDraftApprovalResult = Readonly<{
  draft: SavedReplyDraft;
  outboundMessage: OutboundMessage | null;
}>;

export function parseReplyDraftApprovalResponse(
  data: unknown,
): ReplyDraftApprovalResult | null {
  const parsed = approvalResponseSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function parseSendReplyDraftResponse(
  data: unknown,
): OutboundMessage | null {
  const parsed = sendResponseSchema.safeParse(data);
  return parsed.success ? parsed.data.outboundMessage : null;
}

export function isFollowUpDue(lead: Lead, now = Date.now()): boolean {
  if (lead.status === "Booked" || lead.nextFollowUpAt === null) {
    return false;
  }

  const followUpAt = Date.parse(lead.nextFollowUpAt);
  return Number.isFinite(followUpAt) && followUpAt <= now;
}

export function formatCreatedAt(timestamp: string): string {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/** Short follow-up date used in follow-up lists and indicators. */
export function formatFollowUpDate(timestamp: string): string | null {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/**
 * Presentational helper for overdue context. The due rule itself stays in
 * `isFollowUpDue` (due or overdue = followUpAt is in the past and lead not booked).
 */
export function followUpOverdueDays(lead: Lead, now = Date.now()): number {
  if (lead.nextFollowUpAt === null) {
    return 0;
  }

  const followUpAt = Date.parse(lead.nextFollowUpAt);

  if (!Number.isFinite(followUpAt) || followUpAt > now) {
    return 0;
  }

  return Math.max(0, Math.floor((now - followUpAt) / 86_400_000));
}

