import { Router, type Response } from "express";
import type { Pool } from "pg";
import { z, type ZodError } from "zod";
import type { AuthInstance } from "../auth/config.js";
import {
  createRequireWorkspace,
  getAuthContext,
} from "../auth/middleware.js";
import { OUTBOUND_MESSAGE_STATUSES } from "../messaging/types.js";
import {
  getOutboundMessageForDraft,
  listOutboundMessages,
} from "./repository.js";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_OFFSET = 1_000_000;

const listQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE),
    offset: z.coerce.number().int().min(0).max(MAX_OFFSET).default(0),
    status: z.enum(OUTBOUND_MESSAGE_STATUSES).optional(),
    conversationId: z.uuid().optional(),
  })
  .strict();

function sendValidationError(response: Response, error: ZodError): void {
  response.status(400).json({
    error: "Invalid request",
    details: error.issues.map((issue) => ({
      field: issue.path.map(String).join(".") || "query",
      message: issue.message,
    })),
  });
}

function pagination(
  limit: number,
  offset: number,
  hasMore: boolean,
  count: number,
) {
  return {
    limit,
    offset,
    hasMore,
    nextOffset: hasMore ? offset + count : null,
  };
}

export function createOutboundMessagesRouter({
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

  router.get("/by-draft/:draftId", requireMember, async (request, response) => {
    const draftId = z.uuid().safeParse(request.params.draftId);

    if (!draftId.success) {
      sendValidationError(response, draftId.error);
      return;
    }

    const { workspace } = getAuthContext(response);
    const outboundMessage = await getOutboundMessageForDraft(
      pool,
      workspace.id,
      draftId.data,
    );

    response.status(200).json({ outboundMessage });
  });

  router.get("/", requireMember, async (request, response) => {
    const parsed = listQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }

    const { workspace } = getAuthContext(response);
    const { limit, offset, status, conversationId } = parsed.data;
    const result = await listOutboundMessages(pool, workspace.id, {
      limit,
      offset,
      status,
      conversationId,
    });

    response.status(200).json({
      messages: result.messages,
      pagination: pagination(
        limit,
        offset,
        result.hasMore,
        result.messages.length,
      ),
    });
  });

  return router;
}
