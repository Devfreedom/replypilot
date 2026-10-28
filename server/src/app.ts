import { toNodeHandler } from "better-auth/node";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { Pool } from "pg";
import type { ReplyDraftProvider } from "./ai/reply-draft.js";
import {
  createAuth,
  type AuthRateLimitOptions,
} from "./auth/config.js";
import { createBusinessRouter } from "./business/routes.js";
import { createLeadsRouter } from "./leads/routes.js";
import { createWhatsAppInboxRouter } from "./whatsapp/inbox-routes.js";
import type { WhatsAppIntegrationConfig } from "./whatsapp/types.js";
import { createWhatsAppWebhookRouter } from "./whatsapp/webhook-routes.js";
import { createWorkspaceRouter } from "./workspaces/routes.js";

const JSON_BODY_LIMIT = "10kb";

export type AppAuthOptions = Readonly<{
  secret: string;
  baseURL?: string;
  trustedOrigins?: string[];
  rateLimit?: AuthRateLimitOptions;
}>;

export function createApp({
  pool,
  auth: authOptions,
  replyDraftProvider,
  whatsapp = null,
}: {
  pool: Pool;
  auth: AppAuthOptions;
  replyDraftProvider?: ReplyDraftProvider;
  whatsapp?: WhatsAppIntegrationConfig | null;
}): Express {
  const app = express();
  const auth = createAuth({
    pool,
    secret: authOptions.secret,
    baseURL: authOptions.baseURL,
    trustedOrigins: authOptions.trustedOrigins ?? [],
    rateLimit: authOptions.rateLimit,
  });

  app.disable("x-powered-by");

  // Better Auth must receive the raw request before a JSON body parser.
  // Browser requests reach this handler through the Next.js /api rewrite.
  app.all("/api/auth/*splat", toNodeHandler(auth));

  // Meta signs the exact raw body bytes, so the webhook's raw parser must run
  // before the shared JSON parser. Only this route receives a raw body.
  app.use(
    "/api/webhooks/whatsapp",
    createWhatsAppWebhookRouter({ pool, config: whatsapp }),
  );

  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.get("/api/health", async (_request: Request, response: Response) => {
    try {
      await pool.query("SELECT 1");
      response.status(200).json({ status: "ok" });
    } catch {
      response.status(503).json({ status: "unavailable" });
    }
  });

  app.use(
    "/api/workspace",
    createWorkspaceRouter({ pool, auth }),
  );
  app.use(
    "/api/leads",
    createLeadsRouter({ pool, auth, replyDraftProvider }),
  );
  app.use("/api/business", createBusinessRouter({ pool, auth }));
  app.use("/api/whatsapp", createWhatsAppInboxRouter({ pool, auth }));

  app.use((_request: Request, response: Response) => {
    response.status(404).json({ error: "Not found" });
  });

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express identifies error handlers by this four-argument signature.
      _next: NextFunction,
    ) => {
      if (
        error instanceof SyntaxError &&
        "status" in error &&
        error.status === 400
      ) {
        response.status(400).json({ error: "Invalid JSON body" });
        return;
      }

      console.error(
        "Unhandled API error:",
        error instanceof Error ? error.stack : "Unknown error",
      );
      response.status(500).json({ error: "Internal server error" });
    },
  );

  return app;
}
