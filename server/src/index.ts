import { app } from "./app.js";

const DEFAULT_PORT = 4000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `Invalid PORT "${value}". Expected an integer between 1 and 65535.`,
    );
  }

  return port;
}

function start(): void {
  const port = parsePort(process.env.PORT);

  const server = app.listen(port, "127.0.0.1", () => {
    console.log(`ReplyPilot API listening on http://127.0.0.1:${port}`);
  });

  server.on("error", (error: Error) => {
    console.error(
      "Failed to start ReplyPilot API:",
      error instanceof Error ? error.message : "Unknown error",
    );
    process.exit(1);
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

    server.close((error) => {
      clearTimeout(forceExit);

      if (error) {
        console.error("Error while closing the API server:", error.message);
        process.exit(1);
      }

      process.exit(0);
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
