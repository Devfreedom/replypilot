import type { Pool } from "pg";
import type { ApprovalSendPolicy } from "../messaging/types.js";
import { resolveOutboundProviderName } from "../outbound/meta-config.js";
import {
  getOutboundMessageForDraft,
  insertQueuedOutboundMessage,
  resolveConversationForLead,
} from "../outbound/repository.js";
import { getConversationConnectionStatus } from "../whatsapp/connections.js";
import type { OutboundMessageRecord } from "../outbound/types.js";
import { getWorkspaceDefaultApprovalPolicy } from "../settings/messaging-repository.js";
import {
  mapReplyDraftRow,
  REPLY_DRAFT_COLUMNS,
} from "./repository.js";
import type { ReplyDraftRow, SavedReplyDraft } from "./types.js";

export type ApproveReplyDraftInput = Readonly<{
  workspaceId: string;
  userId: string;
  leadId: string;
  draftId: string;
  sendPolicy?: ApprovalSendPolicy | null;
  conversationId?: string;
}>;

export type ApproveReplyDraftResult =
  | Readonly<{
      kind: "ok";
      draft: SavedReplyDraft;
      outboundMessage: OutboundMessageRecord | null;
    }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "conversation-required" }>
  | Readonly<{ kind: "conversation-ambiguous" }>
  | Readonly<{ kind: "conversation-not-found" }>
  | Readonly<{ kind: "connection-disconnected" }>;

/**
 * Approval and queue creation are one transaction. The draft row lock makes
 * concurrent approvals converge on one approved state and one outbound record.
 * A provider is never called here; delivery happens in the worker.
 */
export async function approveReplyDraft(
  pool: Pool,
  input: ApproveReplyDraftInput,
): Promise<ApproveReplyDraftResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const draftResult = await client.query<ReplyDraftRow>(
      `
        SELECT ${REPLY_DRAFT_COLUMNS}
        FROM reply_drafts
        WHERE workspace_id = $1
          AND lead_id = $2
          AND id = $3
        FOR UPDATE
      `,
      [input.workspaceId, input.leadId, input.draftId],
    );

    const current = draftResult.rows[0];

    if (!current) {
      await client.query("ROLLBACK");
      return { kind: "not-found" };
    }

    // Repeated approval is idempotent. It never changes the previous approval
    // snapshot or creates another outbound record.
    if (current.status === "approved") {
      const outboundMessage = await getOutboundMessageForDraft(
        client,
        input.workspaceId,
        input.draftId,
      );
      await client.query("COMMIT");
      return {
        kind: "ok",
        draft: mapReplyDraftRow(current),
        outboundMessage,
      };
    }

    const effectivePolicy =
      input.sendPolicy ??
      (await getWorkspaceDefaultApprovalPolicy(client, input.workspaceId));

    let outboundMessage: OutboundMessageRecord | null = null;

    if (effectivePolicy === "approve_and_send") {
      const conversation = await resolveConversationForLead(client, {
        workspaceId: input.workspaceId,
        leadId: input.leadId,
        conversationId: input.conversationId,
      });

      if (conversation.kind !== "ok") {
        await client.query("ROLLBACK");

        if (conversation.kind === "none") {
          return { kind: "conversation-required" };
        }

        if (conversation.kind === "ambiguous") {
          return { kind: "conversation-ambiguous" };
        }

        return { kind: "conversation-not-found" };
      }

      // A disconnected connection cannot deliver. Refuse before queueing so the
      // owner learns immediately instead of seeing a row that later fails.
      const connectionStatus = await getConversationConnectionStatus(
        client,
        input.workspaceId,
        conversation.conversationId,
      );

      if (connectionStatus === "disconnected") {
        await client.query("ROLLBACK");
        return { kind: "connection-disconnected" };
      }

      outboundMessage = await insertQueuedOutboundMessage(client, {
        workspaceId: input.workspaceId,
        conversationId: conversation.conversationId,
        replyDraftId: input.draftId,
        content: current.draft_reply,
        idempotencyKey: `reply-draft:${input.draftId}`,
        provider: await resolveOutboundProviderName(
          client,
          input.workspaceId,
          conversation.conversationId,
        ),
      });
    }

    const updated = await client.query<ReplyDraftRow>(
      `
        UPDATE reply_drafts
        SET status = 'approved',
            approved_at = now(),
            approved_by = $4,
            send_policy_override = $5,
            approval_send_policy = $6,
            updated_at = now()
        WHERE workspace_id = $1
          AND lead_id = $2
          AND id = $3
        RETURNING ${REPLY_DRAFT_COLUMNS}
      `,
      [
        input.workspaceId,
        input.leadId,
        input.draftId,
        input.userId,
        input.sendPolicy ?? null,
        effectivePolicy,
      ],
    );

    const updatedRow = updated.rows[0];

    if (!updatedRow) {
      throw new Error("Reply draft approval did not return a row.");
    }

    // A draft edited after a previous send may already have an outbound row.
    // Reuse it; never create a second record or rewrite its content snapshot.
    outboundMessage ??= await getOutboundMessageForDraft(
      client,
      input.workspaceId,
      input.draftId,
    );

    await client.query("COMMIT");

    return {
      kind: "ok",
      draft: mapReplyDraftRow(updatedRow),
      outboundMessage,
    };
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
