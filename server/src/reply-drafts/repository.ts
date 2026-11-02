import type { Pool, PoolClient, QueryResult } from "pg";
import type { ReplyDraft } from "../ai/reply-draft.js";
import {
  missingInformationSchema,
  savedReplyDraftSourcesSchema,
} from "./schemas.js";
import type {
  ReplyDraftRow,
  SavedReplyDraft,
} from "./types.js";

export type ReplyDraftMutationResult =
  | Readonly<{ kind: "updated"; draft: SavedReplyDraft }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "send-in-progress" }>;

export const REPLY_DRAFT_COLUMNS = `
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
  approved_by,
  send_policy_override,
  approval_send_policy,
  created_at,
  updated_at
`;

export function mapReplyDraftRow(row: ReplyDraftRow): SavedReplyDraft {
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
    approvedBy: row.approved_by,
    sendPolicyOverride: row.send_policy_override,
    approvalSendPolicy: row.approval_send_policy,
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
        approved_at,
        approved_by,
        send_policy_override,
        approval_send_policy
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, NULL, NULL, NULL, NULL)
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
): Promise<ReplyDraftMutationResult> {
  return mutateReplyDraft(pool, workspaceId, leadId, draftId, async (client) =>
    client.query<ReplyDraftRow>(
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
            approved_by = NULL,
            send_policy_override = NULL,
            approval_send_policy = NULL,
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
    ),
  );
}

export async function updateReplyDraftText(
  pool: Pool,
  workspaceId: string,
  leadId: string,
  draftId: string,
  draftReply: string,
): Promise<ReplyDraftMutationResult> {
  return mutateReplyDraft(pool, workspaceId, leadId, draftId, (client) =>
    client.query<ReplyDraftRow>(
      `
        UPDATE reply_drafts
        SET draft_reply = $4,
            status = 'draft',
            approved_at = NULL,
            approved_by = NULL,
            send_policy_override = NULL,
            approval_send_policy = NULL,
            updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND lead_id = $3
        RETURNING ${REPLY_DRAFT_COLUMNS}
      `,
      [workspaceId, draftId, leadId, draftReply],
    ),
  );
}

export async function returnReplyDraftToDraft(
  pool: Pool,
  workspaceId: string,
  leadId: string,
  draftId: string,
): Promise<ReplyDraftMutationResult> {
  return mutateReplyDraft(pool, workspaceId, leadId, draftId, (client) =>
    client.query<ReplyDraftRow>(
      `
        UPDATE reply_drafts
        SET status = 'draft',
            approved_at = NULL,
            approved_by = NULL,
            send_policy_override = NULL,
            approval_send_policy = NULL,
            updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND lead_id = $3
        RETURNING ${REPLY_DRAFT_COLUMNS}
      `,
      [workspaceId, draftId, leadId],
    ),
  );
}

async function mutateReplyDraft(
  pool: Pool,
  workspaceId: string,
  leadId: string,
  draftId: string,
  mutation: (
    client: PoolClient,
  ) => Promise<QueryResult<ReplyDraftRow>>,
): Promise<ReplyDraftMutationResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const draftLock = await client.query(
      `
        SELECT id
        FROM reply_drafts
        WHERE workspace_id = $1 AND lead_id = $2 AND id = $3
        FOR UPDATE
      `,
      [workspaceId, leadId, draftId],
    );

    if (draftLock.rows.length === 0) {
      await client.query("ROLLBACK");
      return { kind: "not-found" };
    }

    const sendingLock = await client.query(
      `
        SELECT id
        FROM outbound_messages
        WHERE workspace_id = $1
          AND reply_draft_id = $2
          AND status = 'sending'
        FOR UPDATE
      `,
      [workspaceId, draftId],
    );

    if (sendingLock.rows.length > 0) {
      await client.query("ROLLBACK");
      return { kind: "send-in-progress" };
    }

    const updated = await mutation(client);
    const row = updated.rows[0];

    if (!row) {
      await client.query("ROLLBACK");
      return { kind: "not-found" };
    }

    await client.query(
      `
        UPDATE outbound_messages
        SET status = 'cancelled',
            failure_reason =
              'Draft content or approval changed before the message was sent.',
            next_attempt_at = NULL,
            updated_at = now()
        WHERE workspace_id = $1
          AND reply_draft_id = $2
          AND status = 'queued'
      `,
      [workspaceId, draftId],
    );

    await client.query("COMMIT");
    return { kind: "updated", draft: mapReplyDraftRow(row) };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    client.release();
  }
}
