import { Router, type Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import type { AuthInstance } from "../auth/config.js";
import {
  createRequireWorkspace,
  getAuthContext,
} from "../auth/middleware.js";
import {
  getConversation,
  listConversations,
  listMessagesForConversation,
} from "./repository.js";

const conversationIdSchema = z.uuid();

function validationError(response: Response, message: string): void {
  response.status(400).json({
    error: "Invalid request",
    details: [{ field: "conversationId", message }],
  });
}

export function createWhatsAppInboxRouter({
  pool,
  auth,
}: {
  pool: Pool;
  auth: AuthInstance;
}): Router {
  const router = Router();
  const requireMember = createRequireWorkspace({
    auth,
    pool,
    roles: ["owner", "member"],
  });

  router.get("/conversations", requireMember, async (_request, response) => {
    const { workspace } = getAuthContext(response);
    response.status(200).json({
      conversations: await listConversations(pool, workspace.id),
    });
  });

  router.get(
    "/conversations/:conversationId/messages",
    requireMember,
    async (request, response) => {
      const parsed = conversationIdSchema.safeParse(
        request.params.conversationId,
      );

      if (!parsed.success) {
        validationError(response, "Conversation ID must be a valid UUID.");
        return;
      }

      const { workspace } = getAuthContext(response);
      const conversation = await getConversation(
        pool,
        workspace.id,
        parsed.data,
      );

      if (!conversation) {
        response.status(404).json({ error: "Conversation not found" });
        return;
      }

      response.status(200).json({
        conversation,
        messages: await listMessagesForConversation(
          pool,
          workspace.id,
          parsed.data,
        ),
      });
    },
  );

  return router;
}
