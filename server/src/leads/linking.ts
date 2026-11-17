/**
 * Linking an existing WhatsApp conversation to a lead.
 *
 * Until now a conversation was only ever linked to a lead as a side effect of
 * an inbound message. That left an owner with no way to connect a lead they
 * already know to a conversation that already exists.
 *
 * Linking is deliberately narrow:
 *
 * - It is workspace scoped. The lead and the conversation must both belong to
 *   the caller's workspace, and a conversation that already belongs to another
 *   lead is never moved.
 * - It preserves the conversation. Only the lead reference and the audit
 *   columns change; the messages and the customer are untouched.
 * - It checks the phone number. A conversation is with one customer, so a lead
 *   whose number belongs to a different customer cannot be linked to it. A
 *   lead whose subscriber identity is not established is refused outright
 *   rather than linked on a guess.
 * - It keeps one active conversation per lead, so a lead never becomes
 *   ambiguous for the outbound path.
 * - It never creates a conversation. A lead with a phone number does not get a
 *   conversation out of thin air.
 */

import type { Pool, PoolClient } from "pg";
import {
  WHATSAPP_CONVERSATION_PHONE_MISMATCH_CODE,
  WHATSAPP_CONVERSATION_PHONE_MISMATCH_MESSAGE,
} from "./errors.js";
import { describeLeadNumber, normalizeComparableNumber } from "./phone.js";

/** A conversation that may be linked to a lead, with the details a client needs. */
export type LinkableConversation = Readonly<{
  id: string;
  customerDisplayName: string | null;
  customerPhoneE164: string | null;
  status: string;
  linkedLeadId: string | null;
}>;

/** A page of linkable conversations. */
export type LinkableConversationPage = Readonly<{
  conversations: LinkableConversation[];
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
    nextOffset: number | null;
  };
}>;

export type LinkConversationResult =
  | Readonly<{ kind: "ok"; conversationId: string }>
  | Readonly<{ kind: "lead-not-found" }>
  | Readonly<{ kind: "conversation-not-found" }>
  | Readonly<{ kind: "already-linked" }>
  | Readonly<{ kind: "not-linkable" }>
  | Readonly<{ kind: "lead-already-linked" }>
  | Readonly<{ kind: "lead-number-unknown" }>
  | Readonly<{
      kind: "phone-mismatch";
      code: string;
      message: string;
    }>;

type LinkableRow = Readonly<{
  id: string;
  customer_display_name: string | null;
  customer_phone_e164: string | null;
  status: string;
  lead_id: string | null;
}>;

const LINKABLE_SELECT = `
  SELECT
    conversation.id,
    customer.display_name AS customer_display_name,
    customer.phone_e164 AS customer_phone_e164,
    conversation.status,
    conversation.lead_id
  FROM whatsapp_conversations AS conversation
  JOIN customers AS customer
    ON customer.id = conversation.customer_id
   AND customer.workspace_id = conversation.workspace_id
  WHERE conversation.workspace_id = $1
`;

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

/**
 * Lists the workspace's conversations that can be linked to a lead.
 *
 * Only conversations that are eligible for linking are returned: an active
 * conversation that does not already belong to a different lead. The list is
 * paginated like the other conversation listings so a large workspace cannot
 * pull every thread into one response.
 */
export async function listLinkableConversations(
  pool: Pool,
  workspaceId: string,
  leadId: string,
  options: Readonly<{ limit: number; offset: number }>,
): Promise<LinkableConversationPage> {
  const result = await pool.query<LinkableRow>(
    `
      ${LINKABLE_SELECT}
        AND conversation.status IN ('open', 'closed')
        AND (conversation.lead_id IS NULL OR conversation.lead_id = $2)
      ORDER BY
        COALESCE(customer.display_name, '') ASC,
        conversation.created_at DESC,
        conversation.id ASC
      LIMIT $3
      OFFSET $4
    `,
    [workspaceId, leadId, options.limit + 1, options.offset],
  );

  const hasMore = result.rows.length > options.limit;
  const conversations = result.rows.slice(0, options.limit).map((row) => ({
    id: row.id,
    customerDisplayName: row.customer_display_name,
    customerPhoneE164: row.customer_phone_e164,
    status: row.status,
    linkedLeadId: row.lead_id,
  }));

  return {
    conversations,
    pagination: {
      limit: options.limit,
      offset: options.offset,
      hasMore,
      nextOffset: hasMore ? options.offset + options.limit : null,
    },
  };
}

/**
 * Links a conversation to a lead.
 *
 * The conversation's messages and customer are never touched, so linking
 * preserves the whole thread history.
 */
export async function linkConversationToLead(
  pool: Pool,
  input: Readonly<{
    workspaceId: string;
    userId: string;
    leadId: string;
    conversationId: string;
  }>,
): Promise<LinkConversationResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // The lead row is locked first. Two requests that link conversations to
    // the same lead are serialized here, so the "one active conversation per
    // lead" rule cannot be broken by a race.
    const lead = await client.query<{
      id: string;
      whatsapp_number: string | null;
    }>(
      `
        SELECT id, whatsapp_number
        FROM leads
        WHERE workspace_id = $1
          AND id = $2
        FOR UPDATE
      `,
      [input.workspaceId, input.leadId],
    );

    const leadRow = lead.rows[0];

    if (!leadRow) {
      await rollbackQuietly(client);
      return { kind: "lead-not-found" };
    }

    const conversation = await client.query<LinkableRow>(
      `
        ${LINKABLE_SELECT}
          AND conversation.id = $2
        FOR UPDATE OF conversation
      `,
      [input.workspaceId, input.conversationId],
    );

    const conversationRow = conversation.rows[0];

    if (!conversationRow) {
      await rollbackQuietly(client);
      return { kind: "conversation-not-found" };
    }

    if (conversationRow.lead_id && conversationRow.lead_id !== input.leadId) {
      await rollbackQuietly(client);
      return { kind: "already-linked" };
    }

    if (conversationRow.status !== "open" && conversationRow.status !== "closed") {
      await rollbackQuietly(client);
      return { kind: "not-linkable" };
    }

    // A lead keeps at most one active conversation. The outbound path cannot
    // choose between two conversations on its own, so a second link would
    // leave the lead permanently ambiguous.
    const existing = await client.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM whatsapp_conversations
        WHERE workspace_id = $1
          AND lead_id = $2
          AND status IN ('open', 'closed')
          AND id <> $3
      `,
      [input.workspaceId, input.leadId, input.conversationId],
    );

    if ((existing.rows[0]?.count ?? 0) > 0) {
      await rollbackQuietly(client);
      return { kind: "lead-already-linked" };
    }

    // The lead's subscriber identity has to be established before it can be
    // compared with the customer. A national number without a country cannot
    // be resolved, and linking it would be a guess.
    const leadIdentity = describeLeadNumber(leadRow.whatsapp_number);

    if (!leadIdentity.resolved || !leadIdentity.e164) {
      await rollbackQuietly(client);
      return { kind: "lead-number-unknown" };
    }

    const customerNumber = normalizeComparableNumber(
      conversationRow.customer_phone_e164,
    );

    // A customer reached through a provider contact id rather than a phone
    // number cannot contradict the lead, so the link is allowed. When both
    // sides have a number they must be the same subscriber.
    if (customerNumber && leadIdentity.e164 !== customerNumber) {
      await rollbackQuietly(client);
      return {
        kind: "phone-mismatch",
        code: WHATSAPP_CONVERSATION_PHONE_MISMATCH_CODE,
        message: WHATSAPP_CONVERSATION_PHONE_MISMATCH_MESSAGE,
      };
    }

    const updated = await client.query(
      `
        UPDATE whatsapp_conversations
        SET lead_id = $3,
            lead_linked_by = $4,
            lead_linked_at = now(),
            updated_at = now()
        WHERE workspace_id = $1
          AND id = $2
        RETURNING id
      `,
      [
        input.workspaceId,
        input.conversationId,
        input.leadId,
        input.userId,
      ],
    );

    if (updated.rowCount === 0) {
      await rollbackQuietly(client);
      return { kind: "conversation-not-found" };
    }

    await client.query("COMMIT");

    return { kind: "ok", conversationId: input.conversationId };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}
