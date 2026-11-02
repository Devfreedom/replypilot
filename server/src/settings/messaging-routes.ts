import { Router, type Response } from "express";
import type { Pool } from "pg";
import { z, type ZodError } from "zod";
import type { AuthInstance } from "../auth/config.js";
import {
  createRequireWorkspace,
  getAuthContext,
} from "../auth/middleware.js";
import { APPROVAL_SEND_POLICIES } from "../messaging/types.js";
import {
  getWorkspaceMessagingSettings,
  updateWorkspaceMessagingSettings,
} from "./messaging-repository.js";

const updateMessagingSettingsSchema = z
  .object({
    defaultApprovalSendPolicy: z.enum(APPROVAL_SEND_POLICIES),
  })
  .strict();

function sendValidationError(response: Response, error: ZodError): void {
  response.status(400).json({
    error: "Invalid request",
    details: error.issues.map((issue) => ({
      field: issue.path.map(String).join(".") || "body",
      message: issue.message,
    })),
  });
}

export function createSettingsRouter({
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
  const requireOwner = createRequireWorkspace({
    auth,
    pool,
    roles: ["owner"],
  });

  router.get("/messaging", requireMember, async (_request, response) => {
    const { workspace } = getAuthContext(response);
    const settings = await getWorkspaceMessagingSettings(pool, workspace.id);
    response.status(200).json({ settings });
  });

  router.patch("/messaging", requireOwner, async (request, response) => {
    const parsed = updateMessagingSettingsSchema.safeParse(request.body);

    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }

    const { workspace } = getAuthContext(response);
    const settings = await updateWorkspaceMessagingSettings(
      pool,
      workspace.id,
      parsed.data.defaultApprovalSendPolicy,
    );

    response.status(200).json({ settings });
  });

  return router;
}
