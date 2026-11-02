import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { MockOutboundMessageProvider } from "./provider.js";
import { runOutboundWorkerOnce } from "./worker.js";

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1_000;

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();

  if (!raw) {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

function log(
  event: string,
  fields: Readonly<Record<string, unknown>> = {},
): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...fields,
    }),
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pollIntervalMs = positiveInteger(
    "OUTBOUND_WORKER_POLL_MS",
    DEFAULT_POLL_INTERVAL_MS,
  );
  const batchSize = positiveInteger(
    "OUTBOUND_WORKER_BATCH_SIZE",
    DEFAULT_BATCH_SIZE,
  );
  const staleAfterMs = positiveInteger(
    "OUTBOUND_WORKER_STALE_MS",
    DEFAULT_STALE_AFTER_MS,
  );
  const pool = createPool(config.databaseUrl);
  const provider = new MockOutboundMessageProvider();
  let stopping = false;

  function requestStop(signal: string): void {
    if (stopping) {
      return;
    }

    stopping = true;
    log("outbound_worker_stopping", { signal });
  }

  process.on("SIGINT", () => requestStop("SIGINT"));
  process.on("SIGTERM", () => requestStop("SIGTERM"));

  log("outbound_worker_started", {
    pollIntervalMs,
    batchSize,
    staleAfterMs,
    provider: "mock",
  });

  try {
    while (!stopping) {
      try {
        const result = await runOutboundWorkerOnce(pool, provider, {
          batchSize,
          staleAfterMs,
        });

        if (
          result.recovered > 0 ||
          result.cancelled > 0 ||
          result.claimed > 0 ||
          result.sent > 0 ||
          result.retried > 0 ||
          result.failed > 0 ||
          result.skipped > 0
        ) {
          log("outbound_worker_tick", result);
        }
      } catch (error) {
        log("outbound_worker_error", {
          message:
            error instanceof Error ? error.message : "Unknown worker error.",
        });
      }

      if (!stopping) {
        await sleep(pollIntervalMs);
      }
    }
  } finally {
    await pool.end();
    log("outbound_worker_stopped");
  }
}

void main().catch((error: unknown) => {
  log("outbound_worker_fatal", {
    message: error instanceof Error ? error.message : "Unknown fatal error.",
  });
  process.exitCode = 1;
});
