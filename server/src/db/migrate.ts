import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";

const MIGRATIONS_DIR = path.join(
  process.cwd(),
  "server",
  "src",
  "db",
  "migrations",
);

const MIGRATION_LOCK_ID = 72_734_001;
const MIGRATION_FILE_PATTERN = /^\d+_.+\.sql$/;

export async function runMigrations(pool: Pool): Promise<string[]> {
  const client = await pool.connect();
  let hasLock = false;
  const applied: string[] = [];

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    hasLock = true;

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((file) => MIGRATION_FILE_PATTERN.test(file))
      .sort();

    if (files.length === 0) {
      throw new Error(`No migration files found in ${MIGRATIONS_DIR}`);
    }

    const result = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations",
    );
    const appliedVersions = new Set(result.rows.map((row) => row.version));

    for (const file of files) {
      if (appliedVersions.has(file)) {
        continue;
      }

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");

      await client.query("BEGIN");

      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version) VALUES ($1)",
          [file],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }

      applied.push(file);
    }

    return applied;
  } finally {
    if (hasLock) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [
          MIGRATION_LOCK_ID,
        ]);
      } catch {
        // The connection may already be unusable; releasing it is enough.
      }
    }

    client.release();
  }
}
