import { Router, type Response } from "express";
import type { Pool } from "pg";
import { z, type ZodError } from "zod";
import type { AuthInstance } from "../auth/config.js";
import {
  createRequireWorkspace,
  getAuthContext,
} from "../auth/middleware.js";
import {
  getConversationSummary,
  listConversationSummaries,
  listMessagesForConversationPage,
} from "./repository.js";
import { CONVERSATION_STATUSES } from "./types.js";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_OFFSET = 1_000_000;

const conversationIdSchema = z.uuid();

const paginationSchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).max(MAX_OFFSET).default(0),
});

const listQuerySchema = paginationSchema
  .extend({ status: z.enum(CONVERSATION_STATUSES).optional() })
  .strict();

const messagesQuerySchema = paginationSchema.strict();

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
        "query",
      message: issue.message,
    })),
  });
}

function pagination(limit: number, offset: number, hasMore: boolean, count: number) {
  return {
    limit,
    offset,
    hasMore,
    nextOffset: hasMore ? offset + count : null,
  };
}

/**
 * Authenticated conversation reads. Every query is scoped to the workspace
 * resolved from the session; a conversation in another workspace is reported
 * as not found rather than forbidden so IDs cannot be probed.
 */
export function createConversationsRouter({
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

  router.get("/", requireMember, async (request, response) => {
    const parsed = listQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }

    const { workspace } = getAuthContext(response);
    const { limit, offset, status } = parsed.data;
    const result = await listConversationSummaries(pool, workspace.id, {
      limit,
      offset,
      status,
    });

    response.status(200).json({
      conversations: result.conversations,
      pagination: pagination(
        limit,
        offset,
        result.hasMore,
        result.conversations.length,
      ),
    });
  });

  router.get(
    "/:conversationId/messages",
    requireMember,
    async (request, response) => {
      const id = conversationIdSchema.safeParse(request.params.conversationId);

      if (!id.success) {
        sendValidationError(response, id.error, "conversationId");
        return;
      }

      const parsed = messagesQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        sendValidationError(response, parsed.error);
        return;
      }

      const { workspace } = getAuthContext(response);
      const conversation = await getConversationSummary(
        pool,
        workspace.id,
        id.data,
      );

      if (!conversation) {
        response.status(404).json({ error: "Conversation not found" });
        return;
      }

      const { limit, offset } = parsed.data;
      const result = await listMessagesForConversationPage(
        pool,
        workspace.id,
        id.data,
        { limit, offset },
      );

      response.status(200).json({
        conversation,
        messages: result.messages,
        pagination: pagination(
          limit,
          offset,
          result.hasMore,
          result.messages.length,
        ),
      });
    },
  );

  router.get("/:conversationId", requireMember, async (request, response) => {
    const id = conversationIdSchema.safeParse(request.params.conversationId);

    if (!id.success) {
      sendValidationError(response, id.error, "conversationId");
      return;
    }

    const { workspace } = getAuthContext(response);
    const conversation = await getConversationSummary(
      pool,
      workspace.id,
      id.data,
    );

    if (!conversation) {
      response.status(404).json({ error: "Conversation not found" });
      return;
    }

    response.status(200).json({ conversation });
  });

  return router;
}
