import type { Pool } from "pg";
import type { ReplyDraft } from "../ai/reply-draft.js";
import {
  missingInformationSchema,
  savedReplyDraftSourcesSchema,
} from "./schemas.js";
import type {
  ReplyDraftReviewStatus,
  ReplyDraftRow,
  SavedReplyDraft,
} from "./types.js";

const REPLY_DRAFT_COLUMNS = `
  id,
  lead_id,
  intent,
  summary,
  missing_information,
  draft_reply,
  provider,
  is_demo,
  status,
  sources,
  approved_at,
  created_at,
  updated_at
`;

function mapReplyDraftRow(row: ReplyDraftRow): SavedReplyDraft {
  const missingInformation = missingInformationSchema.safeParse(
    row.missing_information,
  );
  const sources = savedReplyDraftSourcesSchema.safeParse(row.sources);

  if (!missingInformation.success || !sources.success) {
    throw new Error("Stored reply draft contains invalid snapshot data.");
  }

  if (row.provider !== "mock" || !row.is_demo) {
    throw new Error("Stored reply draft has unsupported provider metadata.");
  }

  return {
    id: row.id,
    leadId: row.lead_id,
    intent: row.intent,
    summary: row.summary,
    missingInformation: missingInformation.data,
    draftReply: row.draft_reply,
    provider: "mock",
    isDemo: true,
    status: row.status,
    sources: sources.data,
    approvedAt: row.approved_at ? row.approved_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listReplyDraftsForLead(
  pool: Pool,
  workspaceId: string,
  leadId: string,
): Promise<SavedReplyDraft[]> {
  const result = await pool.query<ReplyDraftRow>(
    `
      SELECT ${REPLY_DRAFT_COLUMNS}
      FROM reply_drafts
      WHERE workspace_id = $1 AND lead_id = $2
      ORDER BY created_at DESC, id ASC
    `,
    [workspaceId, leadId],
  );

  return result.rows.map(mapReplyDraftRow);
}

export async function getReplyDraftForLead(
  pool: Pool,
  workspaceId: string,
  leadId: string,
  draftId: string,
): Promise<SavedReplyDraft | null> {
  const result = await pool.query<ReplyDraftRow>(
    `
      SELECT ${REPLY_DRAFT_COLUMNS}
      FROM reply_drafts
      WHERE workspace_id = $1 AND id = $2 AND lead_id = $3
    `,
    [workspaceId, draftId, leadId],
  );

  const row = result.rows[0];
  return row ? mapReplyDraftRow(row) : null;
}

export async function createReplyDraft(
  pool: Pool,
  workspaceId: string,
  leadId: string,
  draft: ReplyDraft,
): Promise<SavedReplyDraft> {
  const result = await pool.query<ReplyDraftRow>(
    `
      INSERT INTO reply_drafts (
        workspace_id,
        lead_id,
        intent,
        summary,
        missing_information,
        draft_reply,
        provider,
        is_demo,
        status,
        sources,
        approved_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, NULL)
      RETURNING ${REPLY_DRAFT_COLUMNS}
    `,
    [
      workspaceId,
      leadId,
      draft.intent,
      draft.summary,
      JSON.stringify(draft.missingInformation),
      draft.draftReply,
      draft.provider,
      draft.isDemo,
      JSON.stringify(draft.sources),
    ],
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error("Reply draft insert did not return a row.");
  }

  return mapReplyDraftRow(row);
}

export async function replaceGeneratedReplyDraft(
  pool: Pool,
  workspaceId: string,
  leadId: string,
  draftId: string,
  draft: ReplyDraft,
): Promise<SavedReplyDraft | null> {
  const result = await pool.query<ReplyDraftRow>(
    `
      UPDATE reply_drafts
      SET intent = $4,
          summary = $5,
          missing_information = $6,
          draft_reply = $7,
          provider = $8,
          is_demo = $9,
          status = 'draft',
          sources = $10,
          approved_at = NULL,
          updated_at = now()
      WHERE workspace_id = $1 AND id = $2 AND lead_id = $3
      RETURNING ${REPLY_DRAFT_COLUMNS}
    `,
    [
      workspaceId,
      draftId,
      leadId,
      draft.intent,
      draft.summary,
      JSON.stringify(draft.missingInformation),
      draft.draftReply,
      draft.provider,
      draft.isDemo,
      JSON.stringify(draft.sources),
    ],
  );

  const row = result.rows[0];
  return row ? mapReplyDraftRow(row) : null;
}

export async function updateReplyDraftText(
  pool: Pool,
  workspaceId: string,
  leadId: string,
  draftId: string,
  draftReply: string,
): Promise<SavedReplyDraft | null> {
  const result = await pool.query<ReplyDraftRow>(
    `
      UPDATE reply_drafts
      SET draft_reply = $4,
          status = 'draft',
          approved_at = NULL,
          updated_at = now()
      WHERE workspace_id = $1 AND id = $2 AND lead_id = $3
      RETURNING ${REPLY_DRAFT_COLUMNS}
    `,
    [workspaceId, draftId, leadId, draftReply],
  );

  const row = result.rows[0];
  return row ? mapReplyDraftRow(row) : null;
}

export async function updateReplyDraftStatus(
  pool: Pool,
  workspaceId: string,
  leadId: string,
  draftId: string,
  status: ReplyDraftReviewStatus,
): Promise<SavedReplyDraft | null> {
  const result = await pool.query<ReplyDraftRow>(
    `
      UPDATE reply_drafts
      SET status = $4,
          approved_at = CASE
            WHEN $4 = 'approved' THEN now()
            ELSE NULL
          END,
          updated_at = now()
      WHERE workspace_id = $1 AND id = $2 AND lead_id = $3
      RETURNING ${REPLY_DRAFT_COLUMNS}
    `,
    [workspaceId, draftId, leadId, status],
  );

  const row = result.rows[0];
  return row ? mapReplyDraftRow(row) : null;
}
