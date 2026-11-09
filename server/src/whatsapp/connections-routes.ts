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
import {
  toPublicEmbeddedSignupConfig,
  type EmbeddedSignupConfig,
} from "./embedded-signup-config.js";
import { createMetaGraphClient } from "./meta-graph.js";
import {
  completeWhatsAppOnboarding,
  createOnboardingSession,
  OnboardingError,
  verifyWhatsAppConnection,
} from "./onboarding.js";

const connectionIdSchema = z.uuid();
const metaIdSchema = z
  .string()
  .trim()
  .regex(/^\d{5,32}$/, "must be a numeric Meta identifier");

const onboardingCompleteSchema = z
  .object({
    state: z.string().trim().min(20, "must be the issued onboarding state"),
    code: z.string().trim().min(8, "must be a Meta authorization code"),
    wabaId: metaIdSchema,
    phoneNumberId: metaIdSchema,
  })
  .strict();

function sendValidationError(response: Response, error: ZodError): void {
  response.status(400).json({
    error: "Invalid request",
    details: error.issues.map((issue) => ({
      field: issue.path.map(String).join(".") || "connectionId",
      message: issue.message,
    })),
  });
}

function sendOnboardingError(response: Response, error: OnboardingError): void {
  response
    .status(error.httpStatus)
    .json({ error: error.message, code: error.code });
}

/**
 * Workspace WhatsApp connection and Embedded Signup APIs.
 *
 * Reads are available to owners and members. Disconnecting, starting
 * onboarding, completing onboarding, and re-verifying are owner-only. The
 * workspace always comes from the authenticated session; no endpoint accepts
 * a workspace ID. Credentials are never returned.
 */
export function createWhatsAppConnectionsRouter({
  pool,
  auth,
  embeddedSignup = null,
  metaFetch,
}: {
  pool: Pool;
  auth: AuthInstance;
  embeddedSignup?: EmbeddedSignupConfig | null;
  metaFetch?: typeof fetch;
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

  function metaClient() {
    return embeddedSignup
      ? createMetaGraphClient(embeddedSignup, metaFetch)
      : null;
  }

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

  router.post(
    "/connections/:connectionId/verify",
    requireOwner,
    async (request, response) => {
      const connectionId = connectionIdSchema.safeParse(
        request.params.connectionId,
      );

      if (!connectionId.success) {
        sendValidationError(response, connectionId.error);
        return;
      }

      if (!embeddedSignup) {
        response.status(503).json({
          error: "WhatsApp onboarding is not configured.",
          code: "not_configured",
        });
        return;
      }

      const { workspace } = getAuthContext(response);

      try {
        const result = await verifyWhatsAppConnection({
          pool,
          config: embeddedSignup,
          workspaceId: workspace.id,
          connectionId: connectionId.data,
          metaClient: metaClient() ?? undefined,
        });

        response.status(200).json(result);
      } catch (error) {
        if (error instanceof OnboardingError) {
          sendOnboardingError(response, error);
          return;
        }

        throw error;
      }
    },
  );

  router.get(
    "/onboarding/config",
    requireOwner,
    (_request, response) => {
      response.status(200).json({
        config: toPublicEmbeddedSignupConfig(embeddedSignup),
      });
    },
  );

  router.post(
    "/onboarding/sessions",
    requireOwner,
    async (_request, response) => {
      if (!embeddedSignup) {
        response.status(503).json({
          error: "WhatsApp onboarding is not configured.",
          code: "not_configured",
        });
        return;
      }

      const { user, workspace } = getAuthContext(response);
      const session = await createOnboardingSession(pool, {
        workspaceId: workspace.id,
        userId: user.id,
      });

      response.status(201).json({
        state: session.state,
        expiresAt: session.expiresAt.toISOString(),
      });
    },
  );

  router.post(
    "/onboarding/complete",
    requireOwner,
    async (request, response) => {
      const body = onboardingCompleteSchema.safeParse(request.body);

      if (!body.success) {
        sendValidationError(response, body.error);
        return;
      }

      if (!embeddedSignup) {
        response.status(503).json({
          error: "WhatsApp onboarding is not configured.",
          code: "not_configured",
        });
        return;
      }

      const { user, workspace } = getAuthContext(response);

      try {
        const result = await completeWhatsAppOnboarding({
          pool,
          config: embeddedSignup,
          workspaceId: workspace.id,
          userId: user.id,
          state: body.data.state,
          code: body.data.code,
          wabaId: body.data.wabaId,
          phoneNumberId: body.data.phoneNumberId,
          metaClient: metaClient() ?? undefined,
        });

        response
          .status(result.verification === "active" ? 200 : 202)
          .json(result);
      } catch (error) {
        if (error instanceof OnboardingError) {
          sendOnboardingError(response, error);
          return;
        }

        throw error;
      }
    },
  );

  return router;
}
