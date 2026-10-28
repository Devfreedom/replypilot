import { Router, type Response } from "express";
import type { Pool } from "pg";
import type { ZodError } from "zod";
import {
  MockReplyDraftProvider,
  type ReplyDraftProvider,
} from "../ai/reply-draft.js";
import type { AuthInstance } from "../auth/config.js";
import {
  createRequireWorkspace,
  getAuthContext,
} from "../auth/middleware.js";
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
  DuplicateLeadWhatsAppNumberError,
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
  auth,
  replyDraftProvider = new MockReplyDraftProvider(),
}: {
  pool: Pool;
  auth: AuthInstance;
  replyDraftProvider?: ReplyDraftProvider;
}): Router {
  const router = Router();
  const requireMember = createRequireWorkspace({
    auth,
    pool,
    roles: ["owner", "member"],
  });
  const requireOwner = createRequireWorkspace({
    auth,
    pool,
    roles: ["owner"],
  });

  router.get("/", requireMember, async (_request, response) => {
    const { workspace } = getAuthContext(response);
    const leads = await listLeads(pool, workspace.id);
    response.status(200).json({ leads });
  });

  router.post("/", requireOwner, async (request, response) => {
    const parsed = createLeadSchema.safeParse(request.body);

    if (!parsed.success) {
      sendValidationError(response, parsed.error, "body");
      return;
    }

    const { workspace } = getAuthContext(response);

    try {
      const lead = await createLead(pool, workspace.id, parsed.data);
      response.status(201).json({ lead });
    } catch (error) {
      if (error instanceof DuplicateLeadWhatsAppNumberError) {
        response.status(409).json({ error: error.message });
        return;
      }

      throw error;
    }
  });

  router.patch("/:id", requireOwner, async (request, response) => {
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

    const { workspace } = getAuthContext(response);
    const lead = await updateLeadStatus(
      pool,
      workspace.id,
      id.data,
      parsed.data.status,
    );

    if (!lead) {
      response.status(404).json({ error: "Lead not found" });
      return;
    }

    response.status(200).json({ lead });
  });

  router.post("/:id/draft-reply", requireOwner, async (request, response) => {
    const id = leadIdSchema.safeParse(request.params.id);

    if (!id.success) {
      sendValidationError(response, id.error, "id");
      return;
    }

    const { workspace } = getAuthContext(response);
    const lead = await getLeadById(pool, workspace.id, id.data);

    if (!lead) {
      response.status(404).json({ error: "Lead not found" });
      return;
    }

    try {
      const draft = await generateReplyDraft(
        pool,
        workspace.id,
        lead,
        replyDraftProvider,
      );
      response.status(200).json(legacyReplyDraft(draft));
    } catch {
      response.status(500).json({ error: "Internal server error" });
    }
  });

  router.get(
    "/:id/reply-drafts",
    requireMember,
    async (request, response) => {
      const id = leadIdSchema.safeParse(request.params.id);

      if (!id.success) {
        sendValidationError(response, id.error, "id");
        return;
      }

      const { workspace } = getAuthContext(response);
      const lead = await getLeadById(pool, workspace.id, id.data);

      if (!lead) {
        response.status(404).json({ error: "Lead not found" });
        return;
      }

      const drafts = await listReplyDraftsForLead(
        pool,
        workspace.id,
        id.data,
      );
      response.status(200).json({ drafts });
    },
  );

  router.post(
    "/:id/reply-drafts",
    requireOwner,
    async (request, response) => {
      const id = leadIdSchema.safeParse(request.params.id);

      if (!id.success) {
        sendValidationError(response, id.error, "id");
        return;
      }

      const parsed = createReplyDraftSchema.safeParse(request.body ?? {});

      if (!parsed.success) {
        sendValidationError(response, parsed.error, "body");
        return;
      }

      const { workspace } = getAuthContext(response);
      const lead = await getLeadById(pool, workspace.id, id.data);

      if (!lead) {
        response.status(404).json({ error: "Lead not found" });
        return;
      }

      const existingDraftId = parsed.data.draftId;

      if (existingDraftId) {
        const existing = await getReplyDraftForLead(
          pool,
          workspace.id,
          id.data,
          existingDraftId,
        );

        if (!existing) {
          response.status(404).json({ error: "Reply draft not found" });
          return;
        }
      }

      let generated;

      try {
        generated = await generateReplyDraft(
          pool,
          workspace.id,
          lead,
          replyDraftProvider,
        );
      } catch {
        response.status(500).json({ error: "Internal server error" });
        return;
      }

      if (existingDraftId) {
        const draft = await replaceGeneratedReplyDraft(
          pool,
          workspace.id,
          id.data,
          existingDraftId,
          generated,
        );

        if (!draft) {
          response.status(404).json({ error: "Reply draft not found" });
          return;
        }

        response.status(200).json({ draft });
        return;
      }

      const draft = await createReplyDraft(
        pool,
        workspace.id,
        id.data,
        generated,
      );
      response.status(201).json({ draft });
    },
  );

  router.patch(
    "/:id/reply-drafts/:draftId",
    requireOwner,
    async (request, response) => {
      const id = leadIdSchema.safeParse(request.params.id);

      if (!id.success) {
        sendValidationError(response, id.error, "id");
        return;
      }

      const draftId = replyDraftIdSchema.safeParse(request.params.draftId);

      if (!draftId.success) {
        sendValidationError(response, draftId.error, "draftId");
        return;
      }

      const parsed = updateReplyDraftSchema.safeParse(request.body);

      if (!parsed.success) {
        sendValidationError(response, parsed.error, "body");
        return;
      }

      const { workspace } = getAuthContext(response);
      const lead = await getLeadById(pool, workspace.id, id.data);

      if (!lead) {
        response.status(404).json({ error: "Lead not found" });
        return;
      }

      const draft =
        parsed.data.draftReply !== undefined
          ? await updateReplyDraftText(
              pool,
              workspace.id,
              id.data,
              draftId.data,
              parsed.data.draftReply,
            )
          : await updateReplyDraftStatus(
              pool,
              workspace.id,
              id.data,
              draftId.data,
              parsed.data.status ?? "draft",
            );

      if (!draft) {
        response.status(404).json({ error: "Reply draft not found" });
        return;
      }

      response.status(200).json({ draft });
    },
  );

  return router;
}
