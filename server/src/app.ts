import { toNodeHandler } from "better-auth/node";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { Pool } from "pg";
import {
  resolveReplyDraftProviderKind,
  type ReplyDraftProvider,
} from "./ai/reply-draft.js";
import {
  createAuth,
  type AuthRateLimitOptions,
} from "./auth/config.js";
import { createBusinessRouter } from "./business/routes.js";
import { createLeadsRouter } from "./leads/routes.js";
import { createOutboundMessagesRouter } from "./outbound/routes.js";
import { createReplyDraftsRouter } from "./reply-drafts/routes.js";
import { createSettingsRouter } from "./settings/messaging-routes.js";
import { createConversationsRouter } from "./whatsapp/conversation-routes.js";
import { createWhatsAppConnectionsRouter } from "./whatsapp/connections-routes.js";
import type { EmbeddedSignupConfig } from "./whatsapp/embedded-signup-config.js";
import { createWhatsAppInboxRouter } from "./whatsapp/inbox-routes.js";
import { createWhatsAppOperationsRouter } from "./whatsapp/operations-routes.js";
import type { OnboardingRateLimitConfig } from "./whatsapp/onboarding-rate-limit.js";
import type { WhatsAppIntegrationConfig } from "./whatsapp/types.js";
import { createWhatsAppWebhookRouter } from "./whatsapp/webhook-routes.js";
import { createWorkspaceRouter } from "./workspaces/routes.js";

const JSON_BODY_LIMIT = "10kb";
const AUTH_BODY_LIMIT_BYTES = 16_384;

function enforceAuthBodyLimit(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const rawContentLength = request.headers["content-length"];
  const firstContentLength = Array.isArray(rawContentLength)
    ? rawContentLength[0]
    : rawContentLength;

  if (firstContentLength !== undefined) {
    const parsedLength = Number(firstContentLength);

    if (Number.isFinite(parsedLength) && parsedLength > AUTH_BODY_LIMIT_BYTES) {
      response.setHeader("Connection", "close");
      response.status(413).json({ error: "Request body too large" });
      return;
    }
  }

  if (request.method === "GET" || request.method === "HEAD") {
    next();
    return;
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let finished = false;

  const cleanup = () => {
    request.off("data", onData);
    request.off("end", onEnd);
    request.off("error", onError);
    request.off("aborted", onAborted);
  };

  const onData = (chunk: Buffer | string) => {
    if (finished) {
      return;
    }

    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > AUTH_BODY_LIMIT_BYTES) {
      finished = true;
      cleanup();
      request.pause();

      if (!response.headersSent) {
        response.setHeader("Connection", "close");
        response.once("finish", () => {
          request.destroy();
        });
        response.status(413).json({ error: "Request body too large" });
      } else {
        request.destroy();
      }
      return;
    }

    chunks.push(buffer);
  };

  const onEnd = () => {
    if (finished) {
      return;
    }

    finished = true;
    cleanup();

    if (chunks.length > 0 && request.headers["content-type"]) {
      request.body = Buffer.concat(chunks).toString("utf8");
    }

    next();
  };

  const onError = (error: Error) => {
    if (finished) {
      return;
    }

    finished = true;
    cleanup();
    next(error);
  };

  const onAborted = () => {
    if (finished) {
      return;
    }

    finished = true;
    cleanup();
  };

  request.on("data", onData);
  request.on("end", onEnd);
  request.on("error", onError);
  request.on("aborted", onAborted);
}

export type AppAuthOptions = Readonly<{
  secret: string;
  baseURL?: string;
  trustedOrigins?: string[];
  rateLimit?: AuthRateLimitOptions;
  trustedProxyCidrs?: string[];
}>;

export function createApp({
  pool,
  auth: authOptions,
  replyDraftProvider,
  whatsapp = null,
  embeddedSignup = null,
  metaFetch,
  onboardingRateLimit,
}: {
  pool: Pool;
  auth: AppAuthOptions;
  replyDraftProvider?: ReplyDraftProvider;
  whatsapp?: WhatsAppIntegrationConfig | null;
  embeddedSignup?: EmbeddedSignupConfig | null;
  metaFetch?: typeof fetch;
  onboardingRateLimit?: OnboardingRateLimitConfig | null;
}): Express {
  const app = express();
  const auth = createAuth({
    pool,
    secret: authOptions.secret,
    baseURL: authOptions.baseURL,
    trustedOrigins: authOptions.trustedOrigins ?? [],
    rateLimit: authOptions.rateLimit,
    trustedProxyCidrs: authOptions.trustedProxyCidrs,
  });

  app.disable("x-powered-by");

  app.set("trust proxy", 1);

  app.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    response.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );

    // HSTS is only sent over HTTPS. Sending it on a plain HTTP response
    // would pin a browser to HTTPS for a host that does not serve it.
    if (request.secure) {
      response.setHeader("Strict-Transport-Security", "max-age=31536000");
    }

    next();
  });

  // Better Auth must receive the raw request before a JSON body parser.
  // Browser requests reach this handler through the Next.js /api rewrite.
  app.all("/api/auth/*splat", enforceAuthBodyLimit, toNodeHandler(auth));

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
    createWorkspaceRouter({
      pool,
      auth,
      replyDraftProvider: resolveReplyDraftProviderKind(replyDraftProvider),
    }),
  );
  app.use(
    "/api/leads",
    createLeadsRouter({ pool, auth, replyDraftProvider }),
  );
  app.use("/api/business", createBusinessRouter({ pool, auth }));
  app.use("/api/settings", createSettingsRouter({ pool, auth }));
  app.use("/api/reply-drafts", createReplyDraftsRouter({ pool, auth }));
  app.use(
    "/api/outbound-messages",
    createOutboundMessagesRouter({ pool, auth }),
  );
  app.use("/api/whatsapp", createWhatsAppInboxRouter({ pool, auth }));
  app.use(
    "/api/whatsapp",
    createWhatsAppConnectionsRouter({
      pool,
      auth,
      embeddedSignup,
      metaFetch,
      onboardingRateLimit,
    }),
  );
  app.use(
    "/api/whatsapp",
    createWhatsAppOperationsRouter({ pool, auth, whatsapp }),
  );
  app.use("/api/conversations", createConversationsRouter({ pool, auth }));

  app.use((_request: Request, response: Response) => {
    response.status(404).json({ error: "Not found" });
  });

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      if (response.headersSent) {
        _next(error);
        return;
      }

      if (
        error instanceof SyntaxError &&
        "status" in error &&
        error.status === 400
      ) {
        response.status(400).json({ error: "Invalid JSON body" });
        return;
      }

      // A body that exceeds the limit is rejected before it is parsed. It is
      // an expected condition, not an internal failure, so it must not be
      // logged as one.
      if (
        typeof error === "object" &&
        error !== null &&
        "type" in error &&
        error.type === "entity.too.large"
      ) {
        response.status(413).json({ error: "Payload too large" });
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
