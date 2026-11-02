import { Router, type Response } from "express";
import type { Pool } from "pg";
import type { ZodError } from "zod";
import type { AuthInstance } from "../auth/config.js";
import {
  createRequireWorkspace,
  getAuthContext,
} from "../auth/middleware.js";
import { queueManualSend } from "../outbound/service.js";
import {
  replyDraftIdSchema,
  sendReplyDraftSchema,
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

export function createReplyDraftsRouter({
  pool,
  auth,
}: {
  pool: Pool;
  auth: AuthInstance;
}): Router {
  const router = Router();
  const requireOwner = createRequireWorkspace({
    auth,
    pool,
    roles: ["owner"],
  });

  router.post("/:id/send", requireOwner, async (request, response) => {
    const draftId = replyDraftIdSchema.safeParse(request.params.id);

    if (!draftId.success) {
      sendValidationError(response, draftId.error, "id");
      return;
    }

    const parsed = sendReplyDraftSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      sendValidationError(response, parsed.error, "body");
      return;
    }

    const { workspace } = getAuthContext(response);
    const result = await queueManualSend(pool, {
      workspaceId: workspace.id,
      draftId: draftId.data,
      conversationId: parsed.data.conversationId,
    });

    if (result.kind === "not-found") {
      response.status(404).json({ error: "Reply draft not found" });
      return;
    }

    if (result.kind === "not-approved") {
      response.status(409).json({
        error: "Only approved drafts can be sent.",
      });
      return;
    }

    if (result.kind === "conversation-required") {
      response.status(409).json({
        error:
          "This lead has no active WhatsApp conversation. Link a conversation before sending.",
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

    if (result.kind === "not-retryable") {
      response.status(409).json({
        error: "This outbound message is cancelled and cannot be retried.",
      });
      return;
    }

    if (result.kind === "manual-review") {
      response.status(409).json({
        error:
          "The provider outcome is unknown. Reconcile with the provider before any further send.",
      });
      return;
    }

    if (result.kind === "content-changed") {
      response.status(409).json({
        error:
          "The draft content changed after this outbound message was created. Start a new draft to send the revised reply.",
      });
      return;
    }

    response.status(200).json({ outboundMessage: result.outboundMessage });
  });

  return router;
}
