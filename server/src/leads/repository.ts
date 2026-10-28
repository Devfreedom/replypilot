import type { Pool, QueryResult } from "pg";
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
    super("A lead with this WhatsApp number already exists.");
    this.name = "DuplicateLeadWhatsAppNumberError";
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
  let result: QueryResult<LeadRow>;

  try {
    result = await pool.query<LeadRow>(
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
  } catch (error) {
    if (isDuplicateWhatsAppNumberError(error)) {
      throw new DuplicateLeadWhatsAppNumberError();
    }

    throw error;
  }

  const row = result.rows[0];

  if (!row) {
    throw new Error("Lead insert did not return a row.");
  }

  return mapLeadRow(row);
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
