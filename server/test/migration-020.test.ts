import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import {
  DatabaseUnreachableError,
  OutdatedDatabaseSchemaError,
  REQUIRED_MIGRATIONS,
  assertRequiredMigrations,
} from "../src/db/schema.js";
import { getTestDatabaseUrl } from "./test-database.js";

const MIGRATIONS_DIR = path.join(
  process.cwd(),
  "server",
  "src",
  "db",
  "migrations",
);

const MIGRATION_FILE_PATTERN = /^\d+_.+\.sql$/;

const MIGRATION_020 = "020_lead_e164_and_conversation_linking.sql";

const LEGACY_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";

let maintenancePool: Pool;
let disposablePool: Pool;
let disposableDatabaseName: string;

/**
 * Reads the rollback statements that the migration documents in its comment
 * block.
 *
 * The rollback is only documentation, so the statements are executed exactly as
 * they are written. If the documented rollback cannot be executed, the
 * migration is not safely reversible and this test fails.
 */
async function readDocumentedRollback(): Promise<string> {
  const sql = await readFile(
    path.join(MIGRATIONS_DIR, MIGRATION_020),
    "utf8",
  );

  const marker = "-- Rollback";
  const markerIndex = sql.indexOf(marker);

  assert.notEqual(
    markerIndex,
    -1,
    "The migration must document how to roll it back",
  );

  const block = sql.slice(markerIndex);
  const statements: string[] = [];

  for (const line of block.split("\n")) {
    const trimmed = line.trim();

    // The documented statements are indented SQL inside the comment block. The
    // prose around them is indented by a single space, so only the deeper
    // indentation is treated as a statement.
    const match = trimmed.match(/^--(\s{3,})(\S.*)$/);

    if (!match) {
      continue;
    }

    statements.push(match[2]);
  }

  assert.ok(
    statements.length > 0,
    "The documented rollback must contain executable statements",
  );

  return statements.join("\n");
}

/** Applies the migration files in order, skipping the named file. */
async function applyMigrations(
  pool: Pool,
  skip: string | null,
): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((file) => MIGRATION_FILE_PATTERN.test(file))
      .sort();

    for (const file of files) {
      if (file === skip) {
        continue;
      }

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");

      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [file],
      );
      await client.query("COMMIT");

      applied.push(file);
    }
  } finally {
    client.release();
  }

  return applied;
}

before(async () => {
  const testUrl = getTestDatabaseUrl();
  const url = new URL(testUrl);

  disposableDatabaseName = `replypilot_migration_020_${randomUUID().slice(0, 8)}`;

  // The maintenance connection is used only to create and drop the disposable
  // database. It never touches the development or the test database.
  const maintenanceUrl = new URL(url);
  maintenanceUrl.pathname = "/postgres";

  maintenancePool = new Pool({
    connectionString: maintenanceUrl.toString(),
    max: 1,
    connectionTimeoutMillis: 5_000,
  });

  await maintenancePool.query(
    `CREATE DATABASE "${disposableDatabaseName}"`,
  );

  const disposableUrl = new URL(url);
  disposableUrl.pathname = `/${disposableDatabaseName}`;

  disposablePool = new Pool({
    connectionString: disposableUrl.toString(),
    max: 2,
    connectionTimeoutMillis: 5_000,
  });
});

after(async () => {
  if (disposablePool) {
    await disposablePool.end();
  }

  if (maintenancePool) {
    await maintenancePool.query(
      `DROP DATABASE IF EXISTS "${disposableDatabaseName}" WITH (FORCE)`,
    );
    await maintenancePool.end();
  }
});

test("migration 020 backfills only corroborated rows and keeps ambiguous rows", async () => {
  await applyMigrations(disposablePool, MIGRATION_020);

  await disposablePool.query(
    `
      INSERT INTO workspaces (id, name)
      VALUES ($1, 'Disposable Workspace')
      ON CONFLICT (id) DO NOTHING
    `,
    [LEGACY_WORKSPACE_ID],
  );

  await disposablePool.query(
    `
      INSERT INTO customers (id, workspace_id, phone_e164, display_name)
      VALUES ($1, $2, '+2348012345678', 'Disposable Customer')
    `,
    [randomUUID(), LEGACY_WORKSPACE_ID],
  );

  const corroboratedId = randomUUID();
  const ambiguousId = randomUUID();
  const emptyId = randomUUID();

  await disposablePool.query(
    `
      INSERT INTO leads (id, workspace_id, name, service, channel, status, last_message, whatsapp_number)
      VALUES
        ($1, $3, 'Corroborated', 'Service', 'Manual', 'New', 'Message', '2348012345678'),
        ($2, $3, 'Ambiguous', 'Service', 'Manual', 'New', 'Message', '08012345678'),
        ($4, $3, 'No number', 'Service', 'Manual', 'New', 'Message', NULL)
    `,
    [corroboratedId, ambiguousId, LEGACY_WORKSPACE_ID, emptyId],
  );

  const migrationSql = await readFile(
    path.join(MIGRATIONS_DIR, MIGRATION_020),
    "utf8",
  );
  await disposablePool.query(migrationSql);

  const rows = await disposablePool.query<{
    id: string;
    whatsapp_number: string | null;
  }>(
    "SELECT id, whatsapp_number FROM leads ORDER BY name",
  );

  const byName = new Map(
    rows.rows.map((row) => [row.id, row.whatsapp_number]),
  );

  assert.equal(
    byName.get(corroboratedId),
    "+2348012345678",
    "A customer corroborates the country, so the row becomes E.164",
  );
  assert.equal(
    byName.get(ambiguousId),
    "08012345678",
    "An uncorroborated national row keeps its digits, because its country is unknown",
  );
  assert.equal(byName.get(emptyId), null);
});

test("migration 020 rejects a duplicate across number formats but not across workspaces", async () => {
  const otherWorkspaceId = randomUUID();

  await disposablePool.query(
    "INSERT INTO workspaces (id, name) VALUES ($1, 'Other Workspace')",
    [otherWorkspaceId],
  );

  await assert.rejects(
    () =>
      disposablePool.query(
        `
          INSERT INTO leads (id, workspace_id, name, service, channel, status, last_message, whatsapp_number)
          VALUES ($1, $2, 'Duplicate', 'Service', 'Manual', 'New', 'Message', '2348012345678')
        `,
        [randomUUID(), LEGACY_WORKSPACE_ID],
      ),
    /duplicate key value/,
  );

  await disposablePool.query(
    `
      INSERT INTO leads (id, workspace_id, name, service, channel, status, last_message, whatsapp_number)
      VALUES ($1, $2, 'Other workspace duplicate', 'Service', 'Manual', 'New', 'Message', '+2348012345678')
    `,
    [randomUUID(), otherWorkspaceId],
  );
});

test("migration 020 adds the linking audit columns", async () => {
  const columns = await disposablePool.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'whatsapp_conversations'
        AND column_name IN ('lead_linked_by', 'lead_linked_at')
    `,
  );

  assert.deepEqual(
    columns.rows.map((row) => row.column_name).sort(),
    ["lead_linked_at", "lead_linked_by"],
  );

  const foreignKey = await disposablePool.query<{ confdeltype: string }>(
    `
      SELECT confdeltype
      FROM pg_constraint
      WHERE conname = 'whatsapp_conversations_lead_linked_by_fkey'
    `,
  );

  assert.equal(
    foreignKey.rows[0]?.confdeltype,
    "n",
    "The audit column keeps its value when the user is deleted",
  );
});

test("the documented rollback of migration 020 executes and restores the previous schema", async () => {
  const rollback = await readDocumentedRollback();

  await disposablePool.query(rollback);

  const rows = await disposablePool.query<{ whatsapp_number: string | null }>(
    "SELECT whatsapp_number FROM leads WHERE whatsapp_number IS NOT NULL",
  );

  for (const row of rows.rows) {
    assert.match(
      row.whatsapp_number ?? "",
      /^[0-9]{5,32}$/,
      "The rollback restores the digits-only representation",
    );
  }

  const columns = await disposablePool.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'whatsapp_conversations'
        AND column_name IN ('lead_linked_by', 'lead_linked_at')
    `,
  );

  assert.equal(
    columns.rows.length,
    0,
    "The rollback removes the audit columns",
  );

  await assert.rejects(
    () =>
      disposablePool.query(
        `
          INSERT INTO leads (id, workspace_id, name, service, channel, status, last_message, whatsapp_number)
          VALUES ($1, $2, 'E.164 after rollback', 'Service', 'Manual', 'New', 'Message', '+2348012345678')
        `,
        [randomUUID(), LEGACY_WORKSPACE_ID],
      ),
    /leads_whatsapp_number_check/,
    "The digits-only constraint is restored",
  );
});

test("the API refuses to start against a database without migration 020", async () => {
  await assert.rejects(
    () => assertRequiredMigrations(disposablePool),
    (error: unknown) => {
      assert.ok(error instanceof OutdatedDatabaseSchemaError);
      assert.match(error.message, /db:migrate/);
      assert.match(error.message, /020_lead_e164_and_conversation_linking/);
      return true;
    },
  );

  await disposablePool.query(
    "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING",
    [MIGRATION_020],
  );

  await assertRequiredMigrations(disposablePool);
});

test("the API refuses to start when the migration tracking table is missing", async () => {
  const disposableUrl = new URL(
    (disposablePool.options.connectionString as string) ??
      "postgresql://invalid",
  );
  const databaseName = `replypilot_no_tracking_${randomUUID().slice(0, 8)}`;
  disposableUrl.pathname = `/${databaseName}`;

  await maintenancePool.query(`CREATE DATABASE "${databaseName}"`);

  const barePool = new Pool({
    connectionString: disposableUrl.toString(),
    max: 1,
    connectionTimeoutMillis: 5_000,
  });

  try {
    await assert.rejects(
      () => assertRequiredMigrations(barePool),
      (error: unknown) => {
        assert.ok(error instanceof OutdatedDatabaseSchemaError);
        assert.match(error.message, /db:migrate/);
        assert.match(
          error.message,
          /tracking table does not exist/i,
          "A missing tracking table is reported as an unmigrated database",
        );
        assert.doesNotMatch(
          error.message,
          /could not be reached/i,
          "A missing table is not a connectivity failure",
        );
        return true;
      },
    );

    // The guard is read-only: it must not have created the tracking table.
    const tables = await barePool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    assert.equal(
      tables.rows.some((row) => row.table_name === "schema_migrations"),
      false,
      "The guard never applies a migration",
    );
  } finally {
    await barePool.end();
    await maintenancePool.query(
      `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
    );
  }
});

test("the API reports an unreachable database separately from an outdated schema", async () => {
  // A closed port on the loopback interface fails fast.
  const unreachablePool = new Pool({
    connectionString:
      "postgresql://replypilot:replypilot@127.0.0.1:1/replypilot_test",
    max: 1,
    connectionTimeoutMillis: 3_000,
  });

  try {
    await assert.rejects(
      () => assertRequiredMigrations(unreachablePool),
      (error: unknown) => {
        assert.ok(
          error instanceof DatabaseUnreachableError,
          "A connectivity failure is not reported as an outdated schema",
        );
        assert.ok(!(error instanceof OutdatedDatabaseSchemaError));
        assert.match(error.message, /could not be reached/i);
        assert.match(error.message, /refuses to start/i);
        assert.doesNotMatch(
          error.message,
          /db:migrate/i,
          "A connectivity failure must not send the operator to the migration command",
        );
        return true;
      },
    );
  } finally {
    await unreachablePool.end();
  }
});

test("the required migrations are declared", () => {
  assert.ok(
    REQUIRED_MIGRATIONS.includes(
      MIGRATION_020 as (typeof REQUIRED_MIGRATIONS)[number],
    ),
    "The API depends on migration 020",
  );
});
