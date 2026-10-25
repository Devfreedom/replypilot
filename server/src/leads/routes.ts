import { Router, type Response } from "express";
import type { Pool } from "pg";
import type { ZodError } from "zod";
import {
  MockReplyDraftProvider,
  type ReplyDraftProvider,
} from "../ai/reply-draft.js";
import {
  createReplyDraft,
  getReplyDraftForLead,
  listReplyDraftsForLead,
  replaceGeneratedReplyDraft,
  updateReplyDraftStatus,
  updateReplyDraftText,
} from "../reply-drafts/repository.js";
import {
  createReplyDraftSchema,
  replyDraftIdSchema,
  updateReplyDraftSchema,
} from "../reply-drafts/schemas.js";
import {
  generateReplyDraft,
  legacyReplyDraft,
} from "../reply-drafts/service.js";
import {
  createLead,
  getLeadById,
  listLeads,
  updateLeadStatus,
} from "./repository.js";
import {
  createLeadSchema,
  leadIdSchema,
  updateLeadStatusSchema,
} from "./schemas.js";

function sendValidationError(
  response: Response,
  error: ZodError,
  fieldPrefix = "",
): void {
  response.status(400).json({
    error: "Invalid request",
    details: error.issues.map((issue) => ({
      field:
        [fieldPrefix, ...issue.path.map(String)].filter(Boolean).join(".") ||
        "body",
      message: issue.message,
    })),
  });
}

export function createLeadsRouter({
  pool,
  replyDraftProvider = new MockReplyDraftProvider(),
}: {
  pool: Pool;
  replyDraftProvider?: ReplyDraftProvider;
}): Router {
  const router = Router();

  router.get("/", async (_request, response) => {
    const leads = await listLeads(pool);
    response.status(200).json({ leads });
  });

  router.post("/", async (request, response) => {
    const parsed = createLeadSchema.safeParse(request.body);

    if (!parsed.success) {
      sendValidationError(response, parsed.error, "body");
      return;
    }

    const lead = await createLead(pool, parsed.data);
    response.status(201).json({ lead });
  });

  router.patch("/:id", async (request, response) => {
    const id = leadIdSchema.safeParse(request.params.id);

    if (!id.success) {
      sendValidationError(response, id.error, "id");
      return;
    }

    const parsed = updateLeadStatusSchema.safeParse(request.body);

    if (!parsed.success) {
      sendValidationError(response, parsed.error, "body");
      return;
    }

    const lead = await updateLeadStatus(pool, id.data, parsed.data.status);

    if (!lead) {
      response.status(404).json({ error: "Lead not found" });
      return;
    }

    response.status(200).json({ lead });
  });

  router.post("/:id/draft-reply", async (request, response) => {
    const id = leadIdSchema.safeParse(request.params.id);

    if (!id.success) {
      sendValidationError(response, id.error, "id");
      return;
    }

    const lead = await getLeadById(pool, id.data);

    if (!lead) {
      response.status(404).json({ error: "Lead not found" });
      return;
    }

    let providerResult: unknown;

    try {
      providerResult = await replyDraftProvider.draftReply(
        lead,
        await buildReplyContext(pool, lead),
      );
    } catch {
      response.status(500).json({ error: "Internal server error" });
      return;
    }

    const draft = replyDraftSchema.safeParse(providerResult);

    if (!draft.success) {
      response.status(500).json({ error: "Internal server error" });
      return;
    }

    response.status(200).json(draft.data);
  });

  return router;
}
