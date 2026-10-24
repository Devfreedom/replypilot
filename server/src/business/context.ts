import type { Pool } from "pg";
import type { Lead } from "../leads/types.js";
import { getBusinessProfile, listCatalogue, listKnowledge } from "./repository.js";
import type { CatalogueEntry, KnowledgeEntry, ReplyContext } from "./types.js";

function terms(value: string): Set<string> { return new Set(value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []); }
function relevant<T>(items: T[], text: string, searchable: (item: T) => string): T[] {
  const enquiryTerms = terms(text);
  return items.filter((item) => [...terms(searchable(item))].some((term) => enquiryTerms.has(term)));
}

/** Deterministic keyword matching only; it is not semantic retrieval and returns no match when wording differs. */
export async function buildReplyContext(pool: Pool, lead: Lead): Promise<ReplyContext> {
  const [profile, catalogue, knowledge] = await Promise.all([getBusinessProfile(pool), listCatalogue(pool, true), listKnowledge(pool, true)]);
  const enquiry = `${lead.service} ${lead.lastMessage}`;
  return {
    profile,
    catalogue: relevant<CatalogueEntry>(catalogue, enquiry, (entry) => `${entry.name} ${entry.description}`),
    knowledge: relevant<KnowledgeEntry>(knowledge, enquiry, (entry) => `${entry.title} ${entry.answer}`),
  };
}
