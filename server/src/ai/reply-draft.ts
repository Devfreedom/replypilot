import { z } from "zod";
import {
  buildCatalogueReplySource,
  buildKnowledgeReplySource,
  replyDraftSourcesSchema,
  type ReplyDraftSource,
} from "../business/provenance.js";
import { formatMinorUnits } from "../business/money.js";
import type {
  CatalogueEntry,
  KnowledgeEntry,
  ReplyContext,
} from "../business/types.js";
import type { Lead } from "../leads/types.js";

export { formatMinorUnits } from "../business/money.js";

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
  sources: replyDraftSourcesSchema.default([]),
});

export type ReplyDraft = z.infer<typeof replyDraftSchema>;

export interface ReplyDraftProvider {
  /**
   * The context contains active, keyword-matched approved business facts for a
   * future grounded provider. The mock provider uses these facts when present.
   */
  draftReply(lead: Lead, context?: ReplyContext): Promise<unknown>;
}

const MAX_REPLY_LENGTH = 1_900;

function getIntent(message: string): ReplyDraft["intent"] {
  const normalized = message.toLowerCase();

  if (/available|availability|free|open/.test(normalized)) {
    return "availability";
  }

  if (/price|pricing|cost|package|quote/.test(normalized)) {
    return "pricing";
  }

  if (/book|booking|confirm|reserve/.test(normalized)) {
    return "booking";
  }

  if (/detail|information|service|offer/.test(normalized)) {
    return "service-details";
  }

  return "general-enquiry";
}

function baseMissingInformationFor(intent: ReplyDraft["intent"]): string[] {
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

function catalogueFact(entry: CatalogueEntry): string {
  const name = `Our approved catalogue lists ${entry.name}`;

  if (entry.priceMinor === null) {
    return `${name}, but no price is set, so the price needs confirmation.`;
  }

  return `${name} at ${formatMinorUnits(
    entry.priceMinor,
    entry.currencyCode,
  )}.`;
}

function knowledgeFact(entry: KnowledgeEntry): string {
  const label = entry.entryType === "faq" ? "FAQ" : "policy";
  const answer = entry.answer.replace(/\s+/g, " ").trim();

  if (answer.length > 700) {
    return `Approved ${label} — ${entry.title}: the full approved text needs confirmation before it is quoted.`;
  }

  return `Approved ${label} — ${entry.title}: ${answer}`;
}

function groundedFacts(context?: ReplyContext): string[] {
  if (!context) {
    return [];
  }

  const facts = [
    ...context.catalogue.map(catalogueFact),
    ...context.knowledge.map(knowledgeFact),
  ];

  return facts.filter((fact) => fact.length <= 700);
}

function appendFacts(reply: string, facts: string[]): string {
  let result = reply;

  for (const fact of facts) {
    const candidate = `${result} ${fact}`;

    if (candidate.length > MAX_REPLY_LENGTH) {
      continue;
    }

    result = candidate;
  }

  return result;
}

function policyTopic(message: string): string | null {
  const normalized = message.toLowerCase();

  if (/refund/.test(normalized)) return "refund";
  if (/cancel/.test(normalized)) return "cancellation";
  if (/reschedul/.test(normalized)) return "rescheduling";
  if (/deposit/.test(normalized)) return "deposit";
  if (/payment/.test(normalized)) return "payment";
  if (/terms|policy|contract/.test(normalized)) return "policy";

  return null;
}

function missingInformationFor(
  intent: ReplyDraft["intent"],
  lead: Lead,
  context?: ReplyContext,
): string[] {
  const missing = baseMissingInformationFor(intent);
  const catalogue = context?.catalogue ?? [];
  const knowledge = context?.knowledge ?? [];

  if (
    intent === "pricing" &&
    !catalogue.some((entry) => entry.priceMinor !== null)
  ) {
    missing.push("An approved price for the requested service");
  }

  const topic = policyTopic(lead.lastMessage);

  if (topic && knowledge.length === 0) {
    missing.push(`An approved ${topic} policy`);
  }

  return [...new Set(missing)].slice(0, 10);
}

export class MockReplyDraftProvider implements ReplyDraftProvider {
  async draftReply(lead: Lead, context?: ReplyContext): Promise<ReplyDraft> {
    const intent = getIntent(lead.lastMessage);
    const facts = groundedFacts(context);

    return {
      intent,
      summary: summaryFor(lead),
      missingInformation: missingInformationFor(intent, lead, context),
      draftReply: appendFacts(replyFor(intent, lead), facts),
      provider: "mock",
      isDemo: true,
    };
  }
}
