import type { Pool } from "pg";
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
  next_follow_up_at,
  created_at,
  updated_at
`;

export async function listLeads(pool: Pool): Promise<Lead[]> {
  const result = await pool.query<LeadRow>(`
    SELECT ${LEAD_COLUMNS}
    FROM leads
    ORDER BY created_at DESC, id ASC
  `);

  return result.rows.map(mapLeadRow);
}

export async function getLeadById(
  pool: Pool,
  id: string,
): Promise<Lead | null> {
  const result = await pool.query<LeadRow>(
    `
      SELECT ${LEAD_COLUMNS}
      FROM leads
      WHERE id = $1
    `,
    [id],
  );

  const row = result.rows[0];
  return row ? mapLeadRow(row) : null;
}

export async function createLead(
  pool: Pool,
  input: CreateLeadInput,
): Promise<Lead> {
  const result = await pool.query<LeadRow>(
    `
      INSERT INTO leads (
        name,
        service,
        channel,
        status,
        last_message,
        next_follow_up_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING ${LEAD_COLUMNS}
    `,
    [
      input.name,
      input.service,
      input.channel,
      input.status,
      input.lastMessage,
      input.nextFollowUpAt ?? null,
    ],
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error("Lead insert did not return a row.");
  }

  return mapLeadRow(row);
}

export async function updateLeadStatus(
  pool: Pool,
  id: string,
  status: LeadStatus,
): Promise<Lead | null> {
  const result = await pool.query<LeadRow>(
    `
      UPDATE leads
      SET status = $2, updated_at = now()
      WHERE id = $1
      RETURNING ${LEAD_COLUMNS}
    `,
    [id, status],
  );

  const row = result.rows[0];
  return row ? mapLeadRow(row) : null;
}
