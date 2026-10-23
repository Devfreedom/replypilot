import { Pool } from "pg";

export function createPool(databaseUrl: string): Pool {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    query_timeout: 10_000,
    application_name: "replypilot-api",
  });

  pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error:", error.message);
  });

  return pool;
}
