import type { Pool } from "pg";
import { REPLY_DRAFT_COLUMNS } from "../reply-drafts/repository.js";
import type { ReplyDraftRow } from "../reply-drafts/types.js";
import {
  getOutboundMessageForDraft,
  insertQueuedOutboundMessage,
  resetFailedOutboundForRetry,
  resolveConversationForLead,
} from "./repository.js";
import type { OutboundMessageRecord } from "./types.js";

export type QueueManualSendInput = Readonly<{
  workspaceId: string;
  draftId: string;
  conversationId?: string;
}>;

export type QueueManualSendResult =
  | Readonly<{ kind: "ok"; outboundMessage: OutboundMessageRecord }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "not-approved" }>
  | Readonly<{ kind: "not-retryable" }>
  | Readonly<{ kind: "content-changed" }>
  | Readonly<{ kind: "conversation-required" }>
  | Readonly<{ kind: "conversation-ambiguous" }>
  | Readonly<{ kind: "conversation-not-found" }>;

/**
 * Explicit owner-initiated send. This only queues a record; it never calls the
 * provider from the HTTP request. The content snapshot is always the existing
 * outbound content or the approved draft content, never a browser payload.
 *
 * Future WhatsApp compliance checks belong here (or in the shared insert
 * helper) so both approval-triggered and manual sends use the same gate.
 */
export async function queueManualSend(
  pool: Pool,
  input: QueueManualSendInput,
): Promise<QueueManualSendResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const draftResult = await client.query<ReplyDraftRow>(
      `
        SELECT ${REPLY_DRAFT_COLUMNS}
        FROM reply_drafts
        WHERE workspace_id = $1
          AND id = $2
        FOR UPDATE
      `,
      [input.workspaceId, input.draftId],
    );

    const draft = draftResult.rows[0];

    if (!draft) {
      await client.query("ROLLBACK");
      return { kind: "not-found" };
    }

    if (draft.status !== "approved") {
      await client.query("ROLLBACK");
      return { kind: "not-approved" };
    }

    const existingOutbound = await getOutboundMessageForDraft(
      client,
      input.workspaceId,
      input.draftId,
    );

    // Never retry a historical snapshot against different approved text. The
    // one-outbound-per-draft constraint means the owner must start a new draft
    // for revised content rather than silently sending stale content.
    if (
      existingOutbound &&
      existingOutbound.content !== draft.draft_reply
    ) {
      await client.query("ROLLBACK");
      return { kind: "content-changed" };
    }

    const conversation = await resolveConversationForLead(client, {
      workspaceId: input.workspaceId,
      leadId: draft.lead_id,
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

    let outboundMessage = await insertQueuedOutboundMessage(client, {
      workspaceId: input.workspaceId,
      conversationId: conversation.conversationId,
      replyDraftId: input.draftId,
      content: draft.draft_reply,
      idempotencyKey: `reply-draft:${input.draftId}`,
    });

    if (!outboundMessage) {
      outboundMessage = await getOutboundMessageForDraft(
        client,
        input.workspaceId,
        input.draftId,
      );
    }

    if (!outboundMessage) {
      throw new Error("Outbound queue insert did not return a record.");
    }

    if (outboundMessage.status === "failed") {
      outboundMessage =
        (await resetFailedOutboundForRetry(
          client,
          input.workspaceId,
          outboundMessage.id,
        )) ?? outboundMessage;
    } else if (outboundMessage.status === "cancelled") {
      await client.query("ROLLBACK");
      return { kind: "not-retryable" };
    }

    await client.query("COMMIT");
    return { kind: "ok", outboundMessage };
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
