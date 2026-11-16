import type { Pool, PoolClient, QueryResult } from "pg";
import { findLeadNumberConflicts } from "./duplicates.js";
import {
  WHATSAPP_LEAD_DUPLICATE_NUMBER_MESSAGE,
  WHATSAPP_LEAD_NUMBER_UNRESOLVED_MESSAGE,
} from "./errors.js";
import type { CreateLeadInput } from "./schemas.js";
import {
  mapLeadRow,
  type Lead,
  type LeadRow,
  type LeadStatus,
} from "./types.js";

const LEAD_COLUMNS = `
  id,
  name,
  service,
  channel,
  status,
  last_message,
  whatsapp_number,
  next_follow_up_at,
  created_at,
  updated_at
`;

export class DuplicateLeadWhatsAppNumberError extends Error {
  constructor() {
    super(WHATSAPP_LEAD_DUPLICATE_NUMBER_MESSAGE);
    this.name = "DuplicateLeadWhatsAppNumberError";
  }
}

/**
 * Raised when another lead may already hold the same WhatsApp number, but
 * that lead stores the number in a national format whose country is not
 * recorded, so the two leads cannot be told apart.
 *
 * The owner can resolve this explicitly by confirming that the number belongs
 * to a different customer. The API never guesses the missing country.
 */
export class UnresolvedLeadWhatsAppNumberError extends Error {
  readonly conflictingLeadId: string;

  constructor(conflictingLeadId: string) {
    super(WHATSAPP_LEAD_NUMBER_UNRESOLVED_MESSAGE);
    this.name = "UnresolvedLeadWhatsAppNumberError";
    this.conflictingLeadId = conflictingLeadId;
  }
}

function isDuplicateWhatsAppNumberError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "leads_workspace_whatsapp_number_uidx"
  );
}

/**
 * Rolls back a transaction without replacing the error that caused it.
 *
 * A rollback can itself fail, for example when the connection already left the
 * transaction. The original failure is the one worth reporting, so the rollback
 * error is swallowed.
 */
async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The original error is more useful than a rollback failure.
  }
}

export async function listLeads(
  pool: Pool,
  workspaceId: string,
): Promise<Lead[]> {
  const result = await pool.query<LeadRow>(
    `
      SELECT ${LEAD_COLUMNS}
      FROM leads
      WHERE workspace_id = $1
      ORDER BY created_at DESC, id ASC
    `,
    [workspaceId],
  );

  return result.rows.map(mapLeadRow);
}

export async function getLeadById(
  pool: Pool,
  workspaceId: string,
  id: string,
): Promise<Lead | null> {
  const result = await pool.query<LeadRow>(
    `
      SELECT ${LEAD_COLUMNS}
      FROM leads
      WHERE workspace_id = $1 AND id = $2
    `,
    [workspaceId, id],
  );

  const row = result.rows[0];
  return row ? mapLeadRow(row) : null;
}

export async function createLead(
  pool: Pool,
  workspaceId: string,
  input: CreateLeadInput,
): Promise<Lead> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (input.whatsappNumber) {
      // Two concurrent requests for the same number must not both pass the
      // duplicate check. The lock is held for the transaction, so the second
      // request observes the row the first one committed.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`lead-number:${workspaceId}:${input.whatsappNumber.replace(/^\+/, "")}`],
      );

      const conflicts = await findLeadNumberConflicts(
        client,
        workspaceId,
        input.whatsappNumber,
      );

      const confirmed = conflicts.find(
        (conflict) => conflict.kind === "confirmed",
      );

      if (confirmed) {
        throw new DuplicateLeadWhatsAppNumberError();
      }

      const unresolved = conflicts.find(
        (conflict) => conflict.kind === "unresolved",
      );

      // An unresolved conflict is only a possible duplicate. The API refuses
      // it by default, and the owner can confirm explicitly that the number
      // belongs to a different customer.
      if (unresolved && !input.confirmUnresolvedNumber) {
        throw new UnresolvedLeadWhatsAppNumberError(unresolved.leadId);
      }
    }

    const result: QueryResult<LeadRow> = await client.query<LeadRow>(
      `
        INSERT INTO leads (
          workspace_id,
          name,
          service,
          channel,
          status,
          last_message,
          whatsapp_number,
          next_follow_up_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING ${LEAD_COLUMNS}
      `,
      [
        workspaceId,
        input.name,
        input.service,
        input.channel,
        input.status,
        input.lastMessage,
        input.whatsappNumber,
        input.nextFollowUpAt ?? null,
      ],
    );

    const row = result.rows[0];

    if (!row) {
      throw new Error("Lead insert did not return a row.");
    }

    await client.query("COMMIT");

    return mapLeadRow(row);
  } catch (error) {
    await rollbackQuietly(client);

    if (isDuplicateWhatsAppNumberError(error)) {
      throw new DuplicateLeadWhatsAppNumberError();
    }

    throw error;
  } finally {
    client.release();
  }
}

export async function updateLeadStatus(
  pool: Pool,
  workspaceId: string,
  id: string,
  status: LeadStatus,
): Promise<Lead | null> {
  const result = await pool.query<LeadRow>(
    `
      UPDATE leads
      SET status = $3, updated_at = now()
      WHERE workspace_id = $1 AND id = $2
      RETURNING ${LEAD_COLUMNS}
    `,
    [workspaceId, id, status],
  );

  const row = result.rows[0];
  return row ? mapLeadRow(row) : null;
}
