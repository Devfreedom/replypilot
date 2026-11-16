import type { Pool } from "pg";

/**
 * The migrations the running code depends on.
 *
 * The API writes lead numbers in E.164 and records who linked a conversation
 * to a lead. Both need the schema that migration 020 creates, so the API
 * refuses to start against a database that has not applied it.
 */
export const REQUIRED_MIGRATIONS = [
  "020_lead_e164_and_conversation_linking.sql",
] as const;

/**
 * Raised when the database cannot be reached at all.
 *
 * This is deliberately a different failure from an outdated schema: an
 * operator must be able to tell "the database is down" from "the database is
 * behind", because the remedy is different.
 */
export class DatabaseUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseUnreachableError";
  }
}

/**
 * Raised when the database schema does not match the running code.
 *
 * The message names the remedy, because the failure otherwise surfaces as an
 * opaque database error deep inside a request.
 */
export class OutdatedDatabaseSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutdatedDatabaseSchemaError";
  }
}

/**
 * PostgreSQL error codes that mean the server could not be reached.
 *
 * These are the connection-level codes from libpq, plus the SQLSTATE class
 * 08 (connection exception) and 57P0x (cannot connect now).
 */
const CONNECTION_ERROR_CODES =
  /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|EPIPE|57P0[123]|08000|08001|08003|08004|08006|08007|08P01)$/;

/** The PostgreSQL SQLSTATE for an undefined table. */
const UNDEFINED_TABLE_CODE = "42P01";

function isConnectionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  if ("code" in error) {
    const code = error.code;

    if (typeof code === "string" && CONNECTION_ERROR_CODES.test(code)) {
      return true;
    }
  }

  return (
    "message" in error &&
    typeof error.message === "string" &&
    /timeout exceeded when trying to connect|Connection terminated|server closed the connection/i.test(
      error.message,
    )
  );
}

function isUndefinedTableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === UNDEFINED_TABLE_CODE
  );
}

/**
 * Fails when the database has not applied every required migration.
 *
 * The guard is read-only. It never applies a migration itself: the API refuses
 * to start and the operator runs the migration deliberately.
 *
 * The migration tracking table is read directly. A database that has never
 * been migrated has no such table, which is reported separately from a
 * database that cannot be reached at all.
 */
export async function assertRequiredMigrations(pool: Pool): Promise<void> {
  let appliedVersions: Set<string>;

  try {
    const result = await pool.query<{ version: string }>(
      "SELECT version FROM schema_migrations",
    );

    appliedVersions = new Set(result.rows.map((row) => row.version));
  } catch (error) {
    if (isConnectionError(error)) {
      const detail =
        error instanceof Error && error.message ? ` (${error.message})` : "";

      throw new DatabaseUnreachableError(
        `The database could not be reached${detail}. The API refuses to start without a verified schema. Check that the database is running and that the connection settings are correct.`,
      );
    }

    if (isUndefinedTableError(error)) {
      throw new OutdatedDatabaseSchemaError(
        "The database schema is out of date: the migration tracking table does not exist, so no migration has been applied. Run \"npm run db:migrate\" before starting the API.",
      );
    }

    const detail =
      error instanceof Error && error.message ? ` (${error.message})` : "";

    throw new OutdatedDatabaseSchemaError(
      `The database schema is out of date: the applied migrations could not be read${detail}. Run "npm run db:migrate" before starting the API.`,
    );
  }

  const missing = REQUIRED_MIGRATIONS.filter(
    (version) => !appliedVersions.has(version),
  );

  if (missing.length > 0) {
    throw new OutdatedDatabaseSchemaError(
      `The database schema is out of date. Missing migrations: ${missing.join(
        ", ",
      )}. Run "npm run db:migrate" before starting the API.`,
    );
  }
}
