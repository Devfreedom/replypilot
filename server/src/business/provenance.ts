import { z } from "zod";
import type { Lead } from "../leads/types.js";
import { searchTerms } from "./context.js";
import { formatMinorUnits } from "./money.js";
import type {
  CatalogueEntry,
  KnowledgeEntry,
  ReplyContext,
} from "./types.js";

export const REPLY_DRAFT_SOURCE_TYPES = [
  "catalogue",
  "faq",
  "policy",
] as const;

export const replyDraftSourceSchema = z
  .object({
    id: z.uuid(),
    type: z.enum(REPLY_DRAFT_SOURCE_TYPES),
    title: z.string().min(1).max(240),
    content: z.string().min(1).max(5_000),
    reason: z.string().min(1).max(300),
    priceMinor: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    currencyCode: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
  })
  .strict();

export type ReplyDraftSource = z.infer<typeof replyDraftSourceSchema>;

export const MAX_SOURCES = 50;
const MAX_SOURCE_REASON_LENGTH = 300;
const MAX_VISIBLE_TERM_LENGTH = 40;

export const replyDraftSourcesSchema = z
  .array(replyDraftSourceSchema)
  .max(MAX_SOURCES);

function formatVisibleTerm(term: string): string {
  if (term.length <= MAX_VISIBLE_TERM_LENGTH) {
    return `"${term}"`;
  }

  return `"${term.slice(0, MAX_VISIBLE_TERM_LENGTH - 3)}..."`;
}

function sourceReason(lead: Lead, searchableText: string): string {
  const enquiryTerms = searchTerms(
    `${lead.service ?? ""} ${lead.lastMessage ?? ""}`,
  );
  const sharedTerms = [...searchTerms(searchableText)]
    .filter((term) => enquiryTerms.has(term))
    .sort();

  if (sharedTerms.length === 0) {
    return "Selected by the current keyword rule. Keyword matching is not semantic retrieval; verify that this fact is relevant.";
  }

  const visibleTerms = sharedTerms.slice(0, 3).map(formatVisibleTerm);
  const termList =
    visibleTerms.length === 1
      ? visibleTerms[0]
      : `${visibleTerms.slice(0, -1).join(", ")} and ${
          visibleTerms[visibleTerms.length - 1]
        }`;

  const reason = `Keyword match on ${termList}. Keyword matching only, not semantic retrieval; verify that this fact is relevant.`;

  return reason.length <= MAX_SOURCE_REASON_LENGTH
    ? reason
    : `${reason.slice(0, MAX_SOURCE_REASON_LENGTH - 3)}...`;
}

function catalogueContent(entry: CatalogueEntry): string {
  const details: string[] = [];
  const description = (entry.description ?? "").trim();

  if (description) {
    details.push(description);
  }

  if (entry.priceMinor === null) {
    details.push("Price: not set in the approved catalogue.");
  } else {
    details.push(
      `Price: ${formatMinorUnits(entry.priceMinor, entry.currencyCode)}`,
    );
  }

  const availabilityNotes = (entry.availabilityNotes ?? "").trim();

  if (availabilityNotes) {
    details.push(`Availability: ${availabilityNotes}`);
  }

  return details.join("\n");
}

export function buildCatalogueReplySource(
  entry: CatalogueEntry,
  lead: Lead,
): ReplyDraftSource {
  const name = entry.name ?? "";
  const description = entry.description ?? "";

  return {
    id: entry.id,
    type: "catalogue",
    title: name,
    content: catalogueContent(entry),
    reason: sourceReason(lead, `${name} ${description}`),
    priceMinor: entry.priceMinor,
    currencyCode: entry.currencyCode,
  };
}

export function buildKnowledgeReplySource(
  entry: KnowledgeEntry,
  lead: Lead,
): ReplyDraftSource {
  const title = entry.title ?? "";
  const answer = (entry.answer ?? "").trim();

  return {
    id: entry.id,
    type: entry.entryType,
    title,
    content: answer,
    reason: sourceReason(lead, `${title} ${answer}`),
    priceMinor: null,
    currencyCode: null,
  };
}

/**
 * Builds the canonical source list from the same active, keyword-matched
 * context that is passed to the provider. These values are not accepted from
 * the browser or copied from provider-supplied content.
 */
export function buildReplyDraftSources(
  lead: Lead,
  context: ReplyContext,
): ReplyDraftSource[] {
  return [
    ...context.catalogue.map((entry) =>
      buildCatalogueReplySource(entry, lead),
    ),
    ...context.knowledge.map((entry) =>
      buildKnowledgeReplySource(entry, lead),
    ),
  ].slice(0, MAX_SOURCES);
}
