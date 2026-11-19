import type { Pool } from "pg";
import type { ApprovalSendPolicy } from "../messaging/types.js";
import { resolveOutboundProviderName } from "../outbound/meta-config.js";
import {
  getOutboundMessageForDraft,
  insertQueuedOutboundMessage,
  isConversationCustomerSuppressed,
  requeueUnattemptedCancelledOutbound,
  resolveConversationForLead,
} from "../outbound/repository.js";
import { getConversationConnectionStatus } from "../whatsapp/connections.js";
import { describeConnectionRejection } from "../outbound/errors.js";
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
  | Readonly<{ kind: "draft-abstained" }>
  | Readonly<{ kind: "conversation-required" }>
  | Readonly<{ kind: "conversation-ambiguous" }>
  | Readonly<{ kind: "conversation-not-found" }>
  | Readonly<{ kind: "customer-suppressed" }>
  | Readonly<{
      kind: "connection-unusable";
      code: string;
      message: string;
    }>
  | Readonly<{
      kind: "outbound-conflict";
      message: string;
    }>;

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

    if (current.decision === "abstain") {
      await client.query("ROLLBACK");
      return { kind: "draft-abstained" };
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

      // A connection that cannot deliver must not be queued. The worker refuses
      // every state that is not "active", so the API refuses the same states.
      // The draft is not approved and no outbound row is created.
      const connectionStatus = await getConversationConnectionStatus(
        client,
        input.workspaceId,
        conversation.conversationId,
      );

      if (connectionStatus !== "active") {
        await client.query("ROLLBACK");
        return {
          kind: "connection-unusable",
          ...describeConnectionRejection(connectionStatus),
        };
      }

      if (
        await isConversationCustomerSuppressed(
          client,
          input.workspaceId,
          conversation.conversationId,
        )
      ) {
        await client.query("ROLLBACK");
        return { kind: "customer-suppressed" };
      }

      const resolvedProvider = await resolveOutboundProviderName(
        client,
        input.workspaceId,
        conversation.conversationId,
      );

      outboundMessage = await insertQueuedOutboundMessage(client, {
        workspaceId: input.workspaceId,
        conversationId: conversation.conversationId,
        replyDraftId: input.draftId,
        content: current.draft_reply,
        idempotencyKey: `reply-draft:${input.draftId}`,
        provider: resolvedProvider,
      });

      if (!outboundMessage) {
        const existingOutbound = await getOutboundMessageForDraft(
          client,
          input.workspaceId,
          input.draftId,
        );

        if (
          existingOutbound?.status === "cancelled" &&
          existingOutbound.attempts === 0
        ) {
          outboundMessage = await requeueUnattemptedCancelledOutbound(client, {
            workspaceId: input.workspaceId,
            outboundMessageId: existingOutbound.id,
            conversationId: conversation.conversationId,
            content: current.draft_reply,
            provider: resolvedProvider,
          });
        }

        if (
          !outboundMessage &&
          (!existingOutbound ||
            existingOutbound.status !== "queued" ||
            existingOutbound.content !== current.draft_reply ||
            existingOutbound.conversationId !== conversation.conversationId)
        ) {
          await client.query("ROLLBACK");
          return {
            kind: "outbound-conflict",
            message:
              existingOutbound?.status === "cancelled"
                ? "This draft's previous outbound send was cancelled after delivery attempts started. Create a new draft to send revised content."
                : existingOutbound &&
                    existingOutbound.conversationId !==
                      conversation.conversationId
                  ? "This draft already has an outbound message tied to a different conversation. Create a new draft to send to this conversation."
                  : "This draft already has an outbound message for an earlier snapshot. Create a new draft to send revised content.",
          };
        }

        outboundMessage = outboundMessage ?? existingOutbound;
      }
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
