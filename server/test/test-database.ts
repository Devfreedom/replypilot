import type { Pool } from "pg";
import { runMigrations } from "../src/db/migrate.js";
import {
  LEGACY_WORKSPACE_ID,
  LEGACY_WORKSPACE_NAME,
} from "../src/workspaces/repository.js";

type DatabaseIdentity = Readonly<{
  hostname: string;
  port: string;
  database: string;
}>;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `${name} is required. Load .env or set it explicitly before running API tests.`,
    );
  }

  return value;
}

function normalizeHostname(hostname: string): string {
  const normalized = hostname.toLowerCase();

  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(normalized)
    ? "loopback"
    : normalized;
}

function parseDatabaseUrl(name: string, value: string): DatabaseIdentity {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL connection URL.`);
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`${name} must use the postgres:// or postgresql:// protocol.`);
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));

  if (!database) {
    throw new Error(`${name} must include a database name.`);
  }

  return {
    hostname: normalizeHostname(url.hostname),
    port: url.port || "5432",
    database,
  };
}

export function getTestDatabaseUrl(): string {
  const testUrl = requireEnv("TEST_DATABASE_URL");
  const developmentUrl = requireEnv("DATABASE_URL");
  const test = parseDatabaseUrl("TEST_DATABASE_URL", testUrl);
  const development = parseDatabaseUrl("DATABASE_URL", developmentUrl);

  if (
    test.hostname === development.hostname &&
    test.port === development.port &&
    test.database === development.database
  ) {
    throw new Error(
      "Refusing to run API tests against the development database. Set TEST_DATABASE_URL to a dedicated test database.",
    );
  }

  if (["postgres", "template0", "template1"].includes(test.database)) {
    throw new Error(
      "TEST_DATABASE_URL must point to a dedicated test database, not a maintenance database.",
    );
  }

  return testUrl;
}

export async function prepareTestDatabase(pool: Pool): Promise<void> {
  await runMigrations(pool);
  await resetTestData(pool);
}

/**
 * Resets every table used by the API tests. This is only ever called with the
 * dedicated TEST_DATABASE_URL connection, which getTestDatabaseUrl verifies.
 */
export async function resetTestData(pool: Pool): Promise<void> {
  await pool.query(
    `
      TRUNCATE TABLE
        whatsapp_messages,
        whatsapp_conversations,
        reply_drafts,
        business_profiles,
        catalogue_entries,
        knowledge_entries,
        leads,
        workspace_memberships,
        workspaces,
        auth_sessions,
        auth_accounts,
        auth_verifications,
        auth_users
      CASCADE
    `,
  );

  await pool.query(
    `
      INSERT INTO workspaces (id, name)
      VALUES ($1, $2)
      ON CONFLICT (id) DO NOTHING
    `,
    [LEGACY_WORKSPACE_ID, LEGACY_WORKSPACE_NAME],
  );
}
