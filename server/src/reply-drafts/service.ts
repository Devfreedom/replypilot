import type { Pool } from "pg";
import {
  replyDraftSchema,
  type ReplyDraft,
  type ReplyDraftProvider,
} from "../ai/reply-draft.js";
import { buildReplyContext } from "../business/context.js";
import {
  buildReplyDraftSources,
  type ReplyDraftSource,
} from "../business/provenance.js";
import type { Lead } from "../leads/types.js";

function sourceKey(source: Pick<ReplyDraftSource, "id" | "type">): string {
  return `${source.type}:${source.id}`;
}

/**
 * The provider selects which context facts it used, but the stored and
 * returned values always come from the server-side context. A provider cannot
 * introduce a fact ID outside that context or substitute different text.
 */
function canonicalizeSources(
  reportedSources: ReplyDraftSource[],
  lead: Lead,
  context: Awaited<ReturnType<typeof buildReplyContext>>,
): ReplyDraftSource[] {
  const candidates = new Map(
    buildReplyDraftSources(lead, context).map((source) => [
      sourceKey(source),
      source,
    ]),
  );
  const selected = new Map<string, ReplyDraftSource>();

  for (const reported of reportedSources) {
    const key = sourceKey(reported);
    const canonical = candidates.get(key);

    if (!canonical) {
      throw new Error(
        "Provider reported a business fact that was not selected from active approved context.",
      );
    }

    selected.set(key, canonical);
  }

  return [...selected.values()];
}

export async function generateReplyDraft(
  pool: Pool,
  lead: Lead,
  provider: ReplyDraftProvider,
): Promise<ReplyDraft> {
  const context = await buildReplyContext(pool, lead);
  const providerResult = await provider.draftReply(lead, context);
  const parsed = replyDraftSchema.safeParse(providerResult);

  if (!parsed.success) {
    throw new Error("Provider returned invalid reply draft output.");
  }

  return {
    ...parsed.data,
    sources: canonicalizeSources(parsed.data.sources, lead, context),
  };
}

export function legacyReplyDraft(draft: ReplyDraft): Omit<
  ReplyDraft,
  "sources"
> {
  return {
    intent: draft.intent,
    summary: draft.summary,
    missingInformation: draft.missingInformation,
    draftReply: draft.draftReply,
    provider: draft.provider,
    isDemo: draft.isDemo,
  };
}
