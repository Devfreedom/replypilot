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
  leadId: string,
): Promise<SavedReplyDraft[]> {
  const result = await pool.query<ReplyDraftRow>(
    `
      SELECT ${REPLY_DRAFT_COLUMNS}
      FROM reply_drafts
      WHERE lead_id = $1
      ORDER BY created_at DESC, id ASC
    `,
    [leadId],
  );

  return result.rows.map(mapReplyDraftRow);
}

export async function getReplyDraftForLead(
  pool: Pool,
  leadId: string,
  draftId: string,
): Promise<SavedReplyDraft | null> {
  const result = await pool.query<ReplyDraftRow>(
    `
      SELECT ${REPLY_DRAFT_COLUMNS}
      FROM reply_drafts
      WHERE id = $1 AND lead_id = $2
    `,
    [draftId, leadId],
  );

  const row = result.rows[0];
  return row ? mapReplyDraftRow(row) : null;
}

export async function createReplyDraft(
  pool: Pool,
  leadId: string,
  draft: ReplyDraft,
): Promise<SavedReplyDraft> {
  const result = await pool.query<ReplyDraftRow>(
    `
      INSERT INTO reply_drafts (
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
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8, NULL)
      RETURNING ${REPLY_DRAFT_COLUMNS}
    `,
    [
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
  leadId: string,
  draftId: string,
  draft: ReplyDraft,
): Promise<SavedReplyDraft | null> {
  const result = await pool.query<ReplyDraftRow>(
    `
      UPDATE reply_drafts
      SET intent = $3,
          summary = $4,
          missing_information = $5,
          draft_reply = $6,
          provider = $7,
          is_demo = $8,
          status = 'draft',
          sources = $9,
          approved_at = NULL,
          updated_at = now()
      WHERE id = $1 AND lead_id = $2
      RETURNING ${REPLY_DRAFT_COLUMNS}
    `,
    [
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
  leadId: string,
  draftId: string,
  draftReply: string,
): Promise<SavedReplyDraft | null> {
  const result = await pool.query<ReplyDraftRow>(
    `
      UPDATE reply_drafts
      SET draft_reply = $3,
          status = 'draft',
          approved_at = NULL,
          updated_at = now()
      WHERE id = $1 AND lead_id = $2
      RETURNING ${REPLY_DRAFT_COLUMNS}
    `,
    [draftId, leadId, draftReply],
  );

  const row = result.rows[0];
  return row ? mapReplyDraftRow(row) : null;
}

export async function updateReplyDraftStatus(
  pool: Pool,
  leadId: string,
  draftId: string,
  status: ReplyDraftReviewStatus,
): Promise<SavedReplyDraft | null> {
  const result = await pool.query<ReplyDraftRow>(
    `
      UPDATE reply_drafts
      SET status = $3,
          approved_at = CASE
            WHEN $3 = 'approved' THEN now()
            ELSE NULL
          END,
          updated_at = now()
      WHERE id = $1 AND lead_id = $2
      RETURNING ${REPLY_DRAFT_COLUMNS}
    `,
    [draftId, leadId, status],
  );

  const row = result.rows[0];
  return row ? mapReplyDraftRow(row) : null;
}
