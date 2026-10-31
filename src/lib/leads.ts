import { z } from "zod";

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

const savedReplyDraftSchema = replyDraftSchema.extend({
  id: z.uuid(),
  leadId: z.uuid(),
  status: z.enum(REPLY_DRAFT_REVIEW_STATUSES),
  sources: z.array(replyDraftSourceSchema),
  approvedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

const replyDraftResponseSchema = z.object({ draft: savedReplyDraftSchema });
const replyDraftsResponseSchema = z.object({
  drafts: z.array(savedReplyDraftSchema),
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

