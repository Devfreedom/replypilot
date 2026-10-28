import type { Pool } from "pg";
import type { Lead } from "../leads/types.js";
import { getBusinessProfile, listCatalogue, listKnowledge } from "./repository.js";
import type { CatalogueEntry, KnowledgeEntry, ReplyContext } from "./types.js";

/**
 * Common words are ignored so that an unrelated entry does not become
 * "relevant" merely by sharing words such as "the" or "you".
 */
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "you",
  "your",
  "are",
  "can",
  "with",
  "this",
  "that",
  "have",
  "from",
  "our",
  "about",
  "what",
  "when",
  "where",
  "does",
  "how",
  "much",
  "need",
  "want",
  "please",
  "thank",
  "thanks",
  "hello",
  "would",
  "could",
  "should",
  "will",
  "may",
  "any",
  "all",
  "not",
  "but",
  "his",
  "her",
  "its",
  "who",
  "why",
  "was",
  "were",
  "been",
  "being",
  "has",
  "had",
  "into",
  "out",
  "over",
  "under",
  "then",
  "than",
  "too",
  "very",
  "just",
  "also",
  "one",
  "two",
  "get",
  "got",
  "let",
  "make",
  "use",
  "using",
]);

export function searchTerms(value: string): Set<string> {
  const matches = value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  return new Set(matches.filter((term) => !STOP_WORDS.has(term)));
}

function relevant<T>(
  items: T[],
  text: string,
  searchable: (item: T) => string,
): T[] {
  const enquiryTerms = searchTerms(text);

  if (enquiryTerms.size === 0) {
    return [];
  }

  return items.filter((item) => {
    const itemTerms = searchTerms(searchable(item));
    return [...itemTerms].some((term) => enquiryTerms.has(term));
  });
}

/**
 * Deterministic keyword matching only. It is not semantic retrieval and
 * returns no match when the wording differs. Only active, approved entries
 * are loaded, so deactivated facts can never reach reply context.
 */
export async function buildReplyContext(
  pool: Pool,
  workspaceId: string,
  lead: Lead,
): Promise<ReplyContext> {
  const [profile, catalogue, knowledge] = await Promise.all([
    getBusinessProfile(pool, workspaceId),
    listCatalogue(pool, workspaceId, true),
    listKnowledge(pool, workspaceId, true),
  ]);

  const enquiry = `${lead.service} ${lead.lastMessage}`;

  return {
    profile,
    catalogue: relevant<CatalogueEntry>(
      catalogue,
      enquiry,
      (entry) => `${entry.name} ${entry.description}`,
    ),
    knowledge: relevant<KnowledgeEntry>(
      knowledge,
      enquiry,
      (entry) => `${entry.title} ${entry.answer}`,
    ),
  };
}
