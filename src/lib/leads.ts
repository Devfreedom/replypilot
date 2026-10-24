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
const replyDraftSchema = z.object({
  intent: z.enum(REPLY_DRAFT_INTENTS),
  summary: z.string(),
  missingInformation: z.array(z.string()),
  draftReply: z.string(),
  provider: z.literal("mock"),
  isDemo: z.literal(true),
});

export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadFilter = "All" | LeadStatus;
export type View = "overview" | "leads" | "follow-ups";
export type LeadChannel = (typeof LEAD_CHANNELS)[number];
export type Lead = z.infer<typeof leadSchema>;
export type ReplyDraft = z.infer<typeof replyDraftSchema>;

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
