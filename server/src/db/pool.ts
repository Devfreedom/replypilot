import { Pool } from "pg";

const DEFAULT_STATEMENT_TIMEOUT_MS = 15_000;
const DEFAULT_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS = 30_000;
const DEFAULT_QUERY_TIMEOUT_MS = 10_000;

export type CreatePoolOptions = Readonly<{
  statementTimeoutMs?: number;
  idleInTransactionSessionTimeoutMs?: number;
}>;

export function createPool(
  databaseUrl: string,
  options: CreatePoolOptions = {},
): Pool {
  const statementTimeoutMs =
    options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  const idleInTransactionSessionTimeoutMs =
    options.idleInTransactionSessionTimeoutMs ??
    DEFAULT_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS;

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    ...(statementTimeoutMs > 0
      ? {
          query_timeout: Math.min(DEFAULT_QUERY_TIMEOUT_MS, statementTimeoutMs),
          statement_timeout: statementTimeoutMs,
        }
      : {}),
    ...(idleInTransactionSessionTimeoutMs > 0
      ? {
          idle_in_transaction_session_timeout:
            idleInTransactionSessionTimeoutMs,
        }
      : {}),
    application_name: "replypilot-api",
  });

  pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error:", error.message);
  });

  return pool;
}
