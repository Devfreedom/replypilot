import { z } from "zod";
import { BRAND } from "./brand";
import {
  APPROVAL_SEND_POLICIES,
  outboundMessageSchema,
  type OutboundMessage,
} from "./messaging";
import type { ReplyDraftProviderKind } from "./workspace";

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

export const leadValidationDetailSchema = z.object({
  field: z.string(),
  message: z.string(),
});

export type LeadValidationDetail = z.infer<typeof leadValidationDetailSchema>;

/** The error payload the API returns when a lead cannot be created. */
export const leadCreationErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  conflictingLeadId: z.uuid().optional(),
  details: z.array(leadValidationDetailSchema).optional(),
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

  readonly details: readonly LeadValidationDetail[] | undefined;

  constructor(
    message: string,
    options: Readonly<{
      code?: string;
      conflictingLeadId?: string;
      details?: readonly LeadValidationDetail[];
    }> = {},
  ) {
    super(message);
    this.name = "LeadApiError";
    this.code = options.code;
    this.conflictingLeadId = options.conflictingLeadId;
    this.details = options.details;
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
export const REPLY_DRAFT_DECISIONS = ["reply", "clarify", "abstain"] as const;
export type ReplyDraftDecision = (typeof REPLY_DRAFT_DECISIONS)[number];
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

const replyDraftBaseSchema = z.object({
  intent: z.enum(REPLY_DRAFT_INTENTS),
  decision: z.enum(REPLY_DRAFT_DECISIONS).default("reply"),
  summary: z.string(),
  missingInformation: z.array(z.string()),
  draftReply: z.string(),
  provider: z.enum(["mock", "gemini"]),
  isDemo: z.boolean(),
});

function hasValidProviderDemoFlag(draft: {
  provider: "mock" | "gemini";
  isDemo: boolean;
}): boolean {
  return draft.provider === "mock"
    ? draft.isDemo === true
    : draft.isDemo === false;
}

const replyDraftSchema = replyDraftBaseSchema.refine(hasValidProviderDemoFlag, {
  message: "Provider and demo flag do not match.",
});

const approvalSendPolicySchema = z.enum(APPROVAL_SEND_POLICIES);

const savedReplyDraftSchema = replyDraftBaseSchema
  .extend({
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
  })
  .refine(hasValidProviderDemoFlag, {
    message: "Provider and demo flag do not match.",
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

export type DraftReplyBanner = Readonly<{
  tone: "neutral" | "warning";
  text: string;
}>;

/**
 * Resolves the provenance/status banner shown at the top of `DraftReplyDialog`.
 * Keeps workspace-level provider configuration (`replyDraftProvider`) separate
 * from persisted draft provenance (`selectedDraft`), returns `null` during
 * loading/error/empty states, and avoids claiming live AI is disabled unless
 * the workspace is confirmed to use `"mock"`.
 */
export function resolveDraftReplyBanner({
  isLoading,
  error,
  selectedDraft,
  replyDraftProvider,
  brandName = BRAND.name,
}: Readonly<{
  isLoading: boolean;
  error: string | null;
  selectedDraft: Pick<SavedReplyDraft, "provider" | "isDemo"> | null;
  replyDraftProvider?: ReplyDraftProviderKind | null;
  brandName?: string;
}>): DraftReplyBanner | null {
  if (isLoading || error !== null || selectedDraft === null) {
    return null;
  }

  if (selectedDraft.provider === "gemini" && !selectedDraft.isDemo) {
    return {
      tone: "neutral",
      text: "AI-suggested reply grounded in your saved business profile and catalogue. Review and edit before approving; nothing is sent without your approval.",
    };
  }

  const workspaceProvider: ReplyDraftProviderKind | null =
    replyDraftProvider ?? null;

  switch (workspaceProvider) {
    case "gemini":
      return {
        tone: "warning",
        text: `This saved draft was generated earlier by ${brandName}'s demonstration mock provider. Click Regenerate draft to generate a live Gemini AI draft; nothing sends automatically without your explicit action.`,
      };
    case "mock":
      return {
        tone: "warning",
        text: `Demonstration output from ${brandName}'s mock provider (no live AI model is enabled). Approval records your review; nothing sends automatically without your explicit action.`,
      };
    case null:
      return {
        tone: "warning",
        text: `This saved draft is demonstration output from ${brandName}'s mock provider. Approval records your review; nothing sends automatically without your explicit action.`,
      };
  }
}

export const CUSTOMER_MESSAGE_TOGGLE_LENGTH = 140;

/**
 * Determines whether the compact 2-line customer message quote in Compose
 * needs a Show more / Show less toggle.
 */
export function shouldShowCustomerMessageToggle(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }

  return (
    trimmed.length > CUSTOMER_MESSAGE_TOGGLE_LENGTH ||
    trimmed.includes("\n")
  );
}

/**
 * Returns true when an AI-abstained draft must be manually edited and saved
 * before Approve / Approve & Send actions can be enabled.
 */
export function isDraftApprovalBlockedByAbstention(
  draft: Pick<SavedReplyDraft, "decision"> | null,
): boolean {
  return draft?.decision === "abstain";
}

/**
 * Warning copy shown in Compose when the assistant abstained from answering.
 */
export function resolveDraftAbstentionNotice(
  draft: Pick<SavedReplyDraft, "decision"> | null,
): string | null {
  if (!isDraftApprovalBlockedByAbstention(draft)) {
    return null;
  }

  return "AI abstained from answering this enquiry because it falls outside your approved business information. Edit the draft with a manual reply and save changes before approving or sending.";
}

