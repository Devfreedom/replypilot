import { loadConfig } from "../config.js";
import { createPool } from "./pool.js";
import { seedLeads } from "./seed.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  try {
    const inserted = await seedLeads(pool);

    if (inserted === 0) {
      console.log("Sample leads already present; nothing inserted.");
      return;
    }

    console.log(`Inserted ${inserted} sample lead(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    "Database seed failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  process.exitCode = 1;
});
