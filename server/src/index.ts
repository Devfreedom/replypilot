import { createApp } from "./app.js";
import {
  GeminiReplyDraftProvider,
  MockReplyDraftProvider,
} from "./ai/reply-draft.js";
import { createResendPasswordResetEmailSender } from "./auth/password-reset-email.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { assertRequiredMigrations } from "./db/schema.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function start(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  // The running code depends on a specific schema. Starting against a
  // database that has not applied it would fail later, inside a request, with
  // an opaque database error.
  await assertRequiredMigrations(pool);
  
  const replyDraftProvider = config.gemini
    ? new GeminiReplyDraftProvider(config.gemini)
    : new MockReplyDraftProvider();

  const app = createApp({
    pool,
    auth: {
      secret: config.betterAuthSecret,
      baseURL: config.betterAuthUrl,
      trustedOrigins: config.trustedOrigins,
      trustedProxyCidrs: config.trustedProxyCidrs,
      nodeEnv: config.nodeEnv,
      sendResetPasswordEmail: config.email
        ? createResendPasswordResetEmailSender(config.email)
        : undefined,
    },
    replyDraftProvider,
    whatsapp: config.whatsapp,
    embeddedSignup: config.embeddedSignup,
    onboardingRateLimit: config.onboardingRateLimit,
  });

  if (config.whatsapp) {
    console.log(
      "WhatsApp inbound webhook configured for the single test workspace.",
    );
  } else {
    console.log(
      "WhatsApp inbound webhook disabled: WHATSAPP_* variables are not configured.",
    );
  }

  const server = app.listen(config.port, config.host, () => {
    console.log(
      `ReplyPilot API listening on http://${config.host}:${config.port}`,
    );
  });

  server.on("error", (error: Error) => {
    console.error(
      "Failed to start ReplyPilot API:",
      error instanceof Error ? error.message : "Unknown error",
    );
    void pool.end().then(
      () => process.exit(1),
      () => process.exit(1),
    );
  });

  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`Received ${signal}. Shutting down ReplyPilot API...`);

    const forceExit = setTimeout(() => {
      console.error("Timed out waiting for open connections to close.");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    server.close((serverError) => {
      clearTimeout(forceExit);

      if (serverError) {
        console.error(
          "Error while closing the API server:",
          serverError.message,
        );
      }

      void pool.end().then(
        () => process.exit(serverError ? 1 : 0),
        (poolError: unknown) => {
          console.error(
            "Error while closing the database pool:",
            poolError instanceof Error ? poolError.message : "Unknown error",
          );
          process.exit(1);
        },
      );
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

try {
  await start();
} catch (error) {
  console.error(
    "Failed to start ReplyPilot API:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exit(1);
}
