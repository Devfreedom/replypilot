/**
 * Workspace-scoped customer suppression.
 *
 * Suppressed customers must never receive outbound messages. Suppression is
 * checked immediately before any provider request and cannot be bypassed by
 * frontend input. This is a minimal opt-out/block mechanism, not a full
 * marketing consent management system.
 */

import type { Pool, PoolClient } from "pg";

export type SuppressionReason = "opt_out" | "blocked" | "admin";

export type SuppressionRecord = Readonly<{
  id: string;
  workspaceId: string;
  customerId: string;
  reason: SuppressionReason;
  notes: string | null;
  suppressedAt: string;
  suppressedBy: string | null;
}>;

type SuppressionRow = Readonly<{
  id: string;
  workspace_id: string;
  customer_id: string;
  reason: SuppressionReason;
  notes: string | null;
  suppressed_at: Date;
  suppressed_by: string | null;
}>;

function mapRow(row: SuppressionRow): SuppressionRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    customerId: row.customer_id,
    reason: row.reason,
    notes: row.notes,
    suppressedAt: row.suppressed_at.toISOString(),
    suppressedBy: row.suppressed_by,
  };
}

/**
 * Checks whether a customer is suppressed within the given workspace.
 * Always workspace-scoped; a suppression in one workspace never affects another.
 */
export async function isCustomerSuppressed(
  pool: Pool | PoolClient,
  workspaceId: string,
  customerId: string,
): Promise<boolean> {
  const result = await pool.query(
    `
      SELECT 1
      FROM customer_suppressions
      WHERE workspace_id = $1
        AND customer_id = $2
      LIMIT 1
    `,
    [workspaceId, customerId],
  );

  return result.rows.length > 0;
}

/**
 * Retrieves the suppression record for a customer, if any.
 */
export async function getCustomerSuppression(
  pool: Pool | PoolClient,
  workspaceId: string,
  customerId: string,
): Promise<SuppressionRecord | null> {
  const result = await pool.query<SuppressionRow>(
    `
      SELECT id, workspace_id, customer_id, reason, notes, suppressed_at, suppressed_by
      FROM customer_suppressions
      WHERE workspace_id = $1
        AND customer_id = $2
      LIMIT 1
    `,
    [workspaceId, customerId],
  );

  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

/**
 * Suppresses a customer within a workspace.
 * Idempotent via the unique constraint on (workspace_id, customer_id).
 * Returns the existing or newly created suppression record.
 */
export async function suppressCustomer(
  pool: Pool | PoolClient,
  input: Readonly<{
    workspaceId: string;
    customerId: string;
    reason: SuppressionReason;
    notes?: string | null;
    suppressedBy?: string | null;
  }>,
): Promise<SuppressionRecord> {
  const result = await pool.query<SuppressionRow>(
    `
      INSERT INTO customer_suppressions (
        workspace_id,
        customer_id,
        reason,
        notes,
        suppressed_by
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (workspace_id, customer_id)
      DO UPDATE SET
        reason = EXCLUDED.reason,
        notes = COALESCE(EXCLUDED.notes, customer_suppressions.notes),
        suppressed_at = EXCLUDED.suppressed_at,
        suppressed_by = COALESCE(EXCLUDED.suppressed_by, customer_suppressions.suppressed_by)
      RETURNING id, workspace_id, customer_id, reason, notes, suppressed_at, suppressed_by
    `,
    [
      input.workspaceId,
      input.customerId,
      input.reason,
      input.notes ?? null,
      input.suppressedBy ?? null,
    ],
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error("Customer suppression insert/update did not return a row.");
  }

  return mapRow(row);
}

/**
 * Removes a suppression for a customer.
 * Returns true when a record was removed.
 */
export async function unsuppressCustomer(
  pool: Pool | PoolClient,
  workspaceId: string,
  customerId: string,
): Promise<boolean> {
  const result = await pool.query(
    `
      DELETE FROM customer_suppressions
      WHERE workspace_id = $1
        AND customer_id = $2
    `,
    [workspaceId, customerId],
  );

  return (result.rowCount ?? 0) > 0;
}
