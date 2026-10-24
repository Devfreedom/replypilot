import { z } from "zod";
import type { Lead } from "../leads/types.js";
import type { ReplyContext } from "../business/types.js";

export const REPLY_DRAFT_INTENTS = [
  "availability",
  "pricing",
  "service-details",
  "booking",
  "general-enquiry",
] as const;

export const replyDraftSchema = z.object({
  intent: z.enum(REPLY_DRAFT_INTENTS),
  summary: z.string().min(1).max(500),
  missingInformation: z.array(z.string().min(1).max(200)).max(10),
  draftReply: z.string().min(1).max(2_000),
  provider: z.literal("mock"),
  isDemo: z.literal(true),
});

export type ReplyDraft = z.infer<typeof replyDraftSchema>;

export interface ReplyDraftProvider {
  /** Context contains active, keyword-matched approved business facts for a future grounded provider. */
  draftReply(lead: Lead, context?: ReplyContext): Promise<unknown>;
}

function getIntent(message: string): ReplyDraft["intent"] {
  const normalized = message.toLowerCase();

  if (/available|availability|free|open/.test(normalized)) return "availability";
  if (/price|pricing|cost|package|quote/.test(normalized)) return "pricing";
  if (/book|booking|confirm|reserve/.test(normalized)) return "booking";
  if (/detail|information|service|offer/.test(normalized)) {
    return "service-details";
  }

  return "general-enquiry";
}

function missingInformationFor(intent: ReplyDraft["intent"]): string[] {
  switch (intent) {
    case "availability":
      return ["Preferred date and time", "Event location"];
    case "pricing":
      return ["Event date", "Event location", "What the customer needs"];
    case "booking":
      return ["Preferred date and time", "Event location"];
    case "service-details":
      return ["What the customer needs", "Preferred date"];
    case "general-enquiry":
      return ["What the customer needs", "Preferred date and location"];
  }
}

function replyFor(intent: ReplyDraft["intent"], lead: Lead): string {
  const name = lead.name.trim();

  switch (intent) {
    case "availability":
      return `Hi ${name}, thanks for reaching out about ${lead.service}. Could you please share your preferred date, time, and location so we can understand your enquiry better?`;
    case "pricing":
      return `Hi ${name}, thanks for asking about ${lead.service}. Could you share the event date, location, and what you need so we can provide relevant information?`;
    case "booking":
      return `Hi ${name}, thanks for your interest in ${lead.service}. Could you share your preferred date, time, and location so we can discuss your enquiry?`;
    case "service-details":
      return `Hi ${name}, thanks for reaching out about ${lead.service}. Could you tell us more about what you need and your preferred date?`;
    case "general-enquiry":
      return `Hi ${name}, thanks for your message about ${lead.service}. Could you share a little more about what you need, along with your preferred date and location?`;
  }
}

function summaryFor(lead: Lead): string {
  const summary = `Enquiry from ${lead.name} about ${lead.service}: ${lead.lastMessage}`;

  return summary.length <= 500 ? summary : `${summary.slice(0, 497)}...`;
}

export class MockReplyDraftProvider implements ReplyDraftProvider {
  async draftReply(lead: Lead): Promise<ReplyDraft> {
    const intent = getIntent(lead.lastMessage);

    return {
      intent,
      summary: summaryFor(lead),
      missingInformation: missingInformationFor(intent),
      draftReply: replyFor(intent, lead),
      provider: "mock",
      isDemo: true,
    };
  }
}
