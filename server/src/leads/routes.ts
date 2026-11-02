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
import { approveReplyDraft } from "../reply-drafts/approval.js";
import {
  createReplyDraft,
  getReplyDraftForLead,
  listReplyDraftsForLead,
  replaceGeneratedReplyDraft,
  returnReplyDraftToDraft,
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
        const result = await replaceGeneratedReplyDraft(
          pool,
          workspace.id,
          id.data,
          existingDraftId,
          generated,
        );

        if (result.kind === "not-found") {
          response.status(404).json({ error: "Reply draft not found" });
          return;
        }

        if (result.kind === "send-in-progress") {
          response.status(409).json({
            error:
              "This reply is currently being sent. Wait for the provider outcome before changing it.",
          });
          return;
        }

        response.status(200).json({ draft: result.draft });
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

      const { workspace, user } = getAuthContext(response);
      const lead = await getLeadById(pool, workspace.id, id.data);

      if (!lead) {
        response.status(404).json({ error: "Lead not found" });
        return;
      }

      if (parsed.data.draftReply !== undefined) {
        const result = await updateReplyDraftText(
          pool,
          workspace.id,
          id.data,
          draftId.data,
          parsed.data.draftReply,
        );

        if (result.kind === "not-found") {
          response.status(404).json({ error: "Reply draft not found" });
          return;
        }

        if (result.kind === "send-in-progress") {
          response.status(409).json({
            error:
              "This reply is currently being sent. Wait for the provider outcome before changing it.",
          });
          return;
        }

        response.status(200).json({ draft: result.draft });
        return;
      }

      if (parsed.data.status === "draft") {
        const result = await returnReplyDraftToDraft(
          pool,
          workspace.id,
          id.data,
          draftId.data,
        );

        if (result.kind === "not-found") {
          response.status(404).json({ error: "Reply draft not found" });
          return;
        }

        if (result.kind === "send-in-progress") {
          response.status(409).json({
            error:
              "This reply is currently being sent. Wait for the provider outcome before changing it.",
          });
          return;
        }

        response.status(200).json({ draft: result.draft });
        return;
      }

      if (parsed.data.status !== "approved") {
        response.status(400).json({
          error: "Invalid request",
          details: [
            {
              field: "body.status",
              message: "Provide draftReply or status",
            },
          ],
        });
        return;
      }

      const result = await approveReplyDraft(pool, {
        workspaceId: workspace.id,
        userId: user.id,
        leadId: id.data,
        draftId: draftId.data,
        sendPolicy: parsed.data.sendPolicy,
        conversationId: parsed.data.conversationId,
      });

      if (result.kind === "not-found") {
        response.status(404).json({ error: "Reply draft not found" });
        return;
      }

      if (result.kind === "conversation-required") {
        response.status(409).json({
          error:
            "This lead has no active WhatsApp conversation. Link a conversation before using approve and send.",
        });
        return;
      }

      if (result.kind === "conversation-ambiguous") {
        response.status(409).json({
          error:
            "This lead has multiple active WhatsApp conversations. Supply a conversationId to choose one.",
        });
        return;
      }

      if (result.kind === "conversation-not-found") {
        response.status(409).json({
          error:
            "The selected conversation is not an active conversation linked to this lead.",
        });
        return;
      }

      response.status(200).json({
        draft: result.draft,
        outboundMessage: result.outboundMessage,
      });
    },
  );

  return router;
}
