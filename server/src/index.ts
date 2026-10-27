import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

function start(): void {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const app = createApp({
    pool,
    auth: {
      secret: config.betterAuthSecret,
      baseURL: config.betterAuthUrl,
      trustedOrigins: config.trustedOrigins,
    },
  });

  const server = app.listen(config.port, "127.0.0.1", () => {
    console.log(
      `ReplyPilot API listening on http://127.0.0.1:${config.port}`,
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
  start();
} catch (error) {
  console.error(
    "Failed to start ReplyPilot API:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exit(1);
}
