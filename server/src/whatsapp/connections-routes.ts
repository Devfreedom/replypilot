import { Router, type Response } from "express";
import type { Pool } from "pg";
import { z, type ZodError } from "zod";
import type { AuthInstance } from "../auth/config.js";
import {
  createRequireWorkspace,
  getAuthContext,
} from "../auth/middleware.js";
import {
  disconnectWhatsAppConnection,
  getWhatsAppConnection,
  listWhatsAppConnections,
} from "./connections.js";

const connectionIdSchema = z.uuid();

function sendValidationError(response: Response, error: ZodError): void {
  response.status(400).json({
    error: "Invalid request",
    details: error.issues.map((issue) => ({
      field: issue.path.map(String).join(".") || "connectionId",
      message: issue.message,
    })),
  });
}

/**
 * Read and disconnect APIs for workspace WhatsApp connections.
 *
 * Reads are available to owners and members of the authenticated workspace.
 * Disconnecting is owner-only. Every query is scoped to the authenticated
 * workspace; there is deliberately no endpoint that accepts a workspace ID or
 * lets a browser claim a phone number. Credentials are never returned.
 */
export function createWhatsAppConnectionsRouter({
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

  router.get("/connections", requireMember, async (_request, response) => {
    const { workspace } = getAuthContext(response);
    const connections = await listWhatsAppConnections(pool, workspace.id);
    response.status(200).json({ connections });
  });

  router.get(
    "/connections/:connectionId",
    requireMember,
    async (request, response) => {
      const connectionId = connectionIdSchema.safeParse(
        request.params.connectionId,
      );

      if (!connectionId.success) {
        sendValidationError(response, connectionId.error);
        return;
      }

      const { workspace } = getAuthContext(response);
      const connection = await getWhatsAppConnection(
        pool,
        workspace.id,
        connectionId.data,
      );

      if (!connection) {
        response.status(404).json({ error: "Connection not found" });
        return;
      }

      response.status(200).json({ connection });
    },
  );

  router.post(
    "/connections/:connectionId/disconnect",
    requireOwner,
    async (request, response) => {
      const connectionId = connectionIdSchema.safeParse(
        request.params.connectionId,
      );

      if (!connectionId.success) {
        sendValidationError(response, connectionId.error);
        return;
      }

      const { workspace } = getAuthContext(response);
      const connection = await disconnectWhatsAppConnection(
        pool,
        workspace.id,
        connectionId.data,
      );

      if (!connection) {
        response.status(404).json({ error: "Connection not found" });
        return;
      }

      response.status(200).json({ connection });
    },
  );

  return router;
}
