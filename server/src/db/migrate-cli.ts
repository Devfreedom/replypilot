import { loadConfig } from "../config.js";
import { runMigrations } from "./migrate.js";
import { createPool } from "./pool.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  try {
    const applied = await runMigrations(pool);

    if (applied.length === 0) {
      console.log("No pending migrations.");
      return;
    }

    console.log(`Applied migrations: ${applied.join(", ")}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    "Database migration failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
