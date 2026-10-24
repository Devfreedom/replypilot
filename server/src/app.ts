import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { Pool } from "pg";
import type { ReplyDraftProvider } from "./ai/reply-draft.js";
import { createBusinessRouter } from "./business/routes.js";
import { createLeadsRouter } from "./leads/routes.js";

const JSON_BODY_LIMIT = "10kb";

export function createApp({
  pool,
  replyDraftProvider,
}: {
  pool: Pool;
  replyDraftProvider?: ReplyDraftProvider;
}): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.get("/api/health", async (_request: Request, response: Response) => {
    try {
      await pool.query("SELECT 1");
      response.status(200).json({ status: "ok" });
    } catch {
      response.status(503).json({ status: "unavailable" });
    }
  });

  app.use("/api/leads", createLeadsRouter({ pool, replyDraftProvider }));
  app.use("/api/business", createBusinessRouter({ pool }));

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
