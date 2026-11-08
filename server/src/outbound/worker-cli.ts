import { hostname } from "node:os";
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { loadMetaOutboundConfig } from "./meta-config.js";
import { ConnectionAwareMetaProvider } from "./meta-connection-provider.js";
import { MockOutboundMessageProvider, type OutboundMessageProvider } from "./provider.js";
import { runOutboundWorkerOnce, type OutboundWorkerResult } from "./worker.js";
import { recordWorkerHeartbeat } from "./worker-status.js";

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

/**
 * Local-only controlled-failure controls for the mock provider. They let a
 * developer demonstrate bounded retries, permanent failure, and manual review
 * through the real queue/worker path without contacting any provider.
 *
 * These variables are rejected in production so a deployment can never be
 * configured into simulated failures by accident.
 */
function readMockControlKeys(name: string): Record<string, number> {
  const raw = process.env[name]?.trim();

  if (!raw) {
    return {};
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `${name} is a local development control and must not be set in production.`,
    );
  }

  const keys = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (keys.length === 0) {
    throw new Error(`${name} must contain at least one idempotency key.`);
  }

  return Object.fromEntries(keys.map((key) => [key, 10]));
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
  const workerId = `${hostname()}:${process.pid}`;
  const workerStartedAt = new Date();

  // Local-only controlled failure controls. Empty in normal development.
  const mockFailKeys = readMockControlKeys("OUTBOUND_MOCK_FAIL_KEYS");
  const mockAmbiguousKeys = readMockControlKeys(
    "OUTBOUND_MOCK_AMBIGUOUS_KEYS",
  );

  // Load Meta outbound configuration. Fails closed for production and invalid
  // enabled configurations.
  const metaConfig = loadMetaOutboundConfig();

  const providers: Array<
    Readonly<{ provider: OutboundMessageProvider; label: string }>
  > = [];

  const mockProvider = new MockOutboundMessageProvider({
    failures: mockFailKeys,
    ambiguous: mockAmbiguousKeys,
  });

  // The WhatsApp provider resolves each conversation's workspace-owned
  // connection at send time. The legacy test configuration is still passed for
  // the single-test-workspace integration during migration. Registering it
  // even when no connection exists is safe: only rows queued for the
  // "whatsapp" provider are claimed.
  providers.push({
    provider: new ConnectionAwareMetaProvider(pool, {
      legacyConfig: metaConfig,
    }),
    label: "whatsapp",
  });
  providers.push({
    provider: mockProvider,
    label: "mock",
  });

  if (metaConfig) {
    // Never log the access token or any credential. Only log non-secret
    // identifiers for operational visibility.
    log("outbound_worker_provider_meta", {
      senderPhoneNumberId: metaConfig.senderPhoneNumberId,
      testWorkspaceId: metaConfig.testWorkspaceId,
      graphApiVersion: metaConfig.graphApiVersion,
      allowedRecipients: metaConfig.allowedRecipients.size,
    });
  } else {
    log("outbound_worker_provider_meta", { legacyConfigured: false });
  }

  if (Object.keys(mockFailKeys).length > 0) {
    log("outbound_worker_mock_failures", {
      keys: Object.keys(mockFailKeys).length,
    });
  }

  if (Object.keys(mockAmbiguousKeys).length > 0) {
    log("outbound_worker_mock_ambiguous", {
      keys: Object.keys(mockAmbiguousKeys).length,
    });
  }

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
    providers: providers.map(({ label }) => label),
  });

  try {
    while (!stopping) {
      for (const { provider } of providers) {
        let lastTick: OutboundWorkerResult | Readonly<{ error: string }>;

        try {
          const result = await runOutboundWorkerOnce(pool, provider, {
            batchSize,
            staleAfterMs,
          });
          lastTick = result;

          if (
            result.recovered > 0 ||
            result.cancelled > 0 ||
            result.claimed > 0 ||
            result.sent > 0 ||
            result.retried > 0 ||
            result.failed > 0 ||
            result.manualReview > 0 ||
            result.skipped > 0
          ) {
            log("outbound_worker_tick", { provider: provider.name, ...result });
          }
        } catch (error) {
          lastTick = {
            error:
              error instanceof Error ? error.message : "Unknown error.",
          };
          log("outbound_worker_error", {
            provider: provider.name,
            message: lastTick.error,
          });
        }

        try {
          await recordWorkerHeartbeat(pool, {
            provider: provider.name,
            workerId,
            workerStartedAt,
            lastTick,
          });
        } catch (error) {
          log("outbound_worker_heartbeat_error", {
            provider: provider.name,
            message:
              error instanceof Error ? error.message : "Unknown error.",
          });
        }
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
