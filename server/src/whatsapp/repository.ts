import type { Pool, PoolClient } from "pg";
import type {
  InboundWhatsAppMessage,
  PersistInboundResult,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppMessageProcessingStatus,
} from "./types.js";

type ConversationRow = Readonly<{
  id: string;
  phone_number_id: string;
  customer_wa_id: string;
  contact_name: string | null;
  lead_id: string | null;
  last_message_at: Date | null;
  last_message_preview: string | null;
  last_message_type: string | null;
  last_message_status: WhatsAppMessageProcessingStatus | null;
  created_at: Date;
  updated_at: Date;
}>;

type MessageRow = Readonly<{
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  message_type: string;
  text_content: string | null;
  provider_timestamp: Date;
  processing_status: WhatsAppMessageProcessingStatus;
  created_at: Date;
}>;

const CONVERSATION_SELECT = `
  SELECT
    conversation.id,
    conversation.phone_number_id,
    conversation.customer_wa_id,
    conversation.contact_name,
    conversation.lead_id,
    latest.provider_timestamp AS last_message_at,
    left(latest.text_content, 160) AS last_message_preview,
    latest.message_type AS last_message_type,
    latest.processing_status AS last_message_status,
    conversation.created_at,
    conversation.updated_at
  FROM whatsapp_conversations AS conversation
  LEFT JOIN LATERAL (
    SELECT
      message.provider_timestamp,
      message.text_content,
      message.message_type,
      message.processing_status
    FROM whatsapp_messages AS message
    WHERE message.workspace_id = conversation.workspace_id
      AND message.conversation_id = conversation.id
    ORDER BY message.provider_timestamp DESC, message.created_at DESC, message.id DESC
    LIMIT 1
  ) AS latest ON true
`;

function mapConversationRow(row: ConversationRow): WhatsAppConversation {
  return {
    id: row.id,
    phoneNumberId: row.phone_number_id,
    customerWaId: row.customer_wa_id,
    contactName: row.contact_name,
    leadId: row.lead_id,
    lastMessageAt: row.last_message_at
      ? row.last_message_at.toISOString()
      : null,
    lastMessagePreview: row.last_message_preview,
    lastMessageType: row.last_message_type,
    lastMessageStatus: row.last_message_status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapMessageRow(row: MessageRow): WhatsAppMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction,
    messageType: row.message_type,
    text: row.text_content,
    providerTimestamp: row.provider_timestamp.toISOString(),
    processingStatus: row.processing_status,
    createdAt: row.created_at.toISOString(),
  };
}

export class WhatsAppWorkspaceNotFoundError extends Error {
  constructor() {
    super("The configured WhatsApp workspace does not exist.");
    this.name = "WhatsAppWorkspaceNotFoundError";
  }
}

async function findOrCreateConversation(
  client: PoolClient,
  input: Readonly<{
    workspaceId: string;
    phoneNumberId: string;
    customerWaId: string;
    contactName: string | null;
  }>,
): Promise<Readonly<{ id: string; leadId: string | null }>> {
  const created = await client.query<{ id: string; lead_id: string | null }>(
    `
      INSERT INTO whatsapp_conversations (
        workspace_id,
        phone_number_id,
        customer_wa_id,
        contact_name
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (workspace_id, phone_number_id, customer_wa_id)
      DO NOTHING
      RETURNING id, lead_id
    `,
    [
      input.workspaceId,
      input.phoneNumberId,
      input.customerWaId,
      input.contactName,
    ],
  );

  const inserted = created.rows[0];

  if (inserted) {
    return { id: inserted.id, leadId: inserted.lead_id };
  }

  const existing = await client.query<{
    id: string;
    lead_id: string | null;
  }>(
    `
      SELECT id, lead_id
      FROM whatsapp_conversations
      WHERE workspace_id = $1
        AND phone_number_id = $2
        AND customer_wa_id = $3
    `,
    [input.workspaceId, input.phoneNumberId, input.customerWaId],
  );

  const row = existing.rows[0];

  if (!row) {
    throw new Error("WhatsApp conversation insert did not return a row.");
  }

  return { id: row.id, leadId: row.lead_id };
}

async function insertInboundMessage(
  client: PoolClient,
  input: Readonly<{
    workspaceId: string;
    conversationId: string;
    message: InboundWhatsAppMessage;
  }>,
): Promise<string | null> {
  const processingStatus: WhatsAppMessageProcessingStatus =
    input.message.messageType === "text" && input.message.text !== null
      ? "stored"
      : "unsupported";

  const result = await client.query<{ id: string }>(
    `
      INSERT INTO whatsapp_messages (
        workspace_id,
        conversation_id,
        provider_message_id,
        direction,
        message_type,
        text_content,
        provider_timestamp,
        processing_status
      )
      VALUES ($1, $2, $3, 'inbound', $4, $5, $6, $7)
      ON CONFLICT (workspace_id, provider_message_id)
      DO NOTHING
      RETURNING id
    `,
    [
      input.workspaceId,
      input.conversationId,
      input.message.providerMessageId,
      input.message.messageType,
      processingStatus === "stored" ? input.message.text : null,
      input.message.providerTimestamp,
      processingStatus,
    ],
  );

  return result.rows[0]?.id ?? null;
}

async function findLeadIdForSender(
  client: PoolClient,
  workspaceId: string,
  senderPhoneNumber: string,
): Promise<string | null> {
  // The leads unique index makes this an exact, reliable identifier match.
  // Name similarities and business-scoped user IDs are deliberately not used.
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM leads
      WHERE workspace_id = $1
        AND whatsapp_number = $2
      LIMIT 1
    `,
    [workspaceId, senderPhoneNumber],
  );

  return result.rows[0]?.id ?? null;
}

async function updateConversationAfterMessage(
  client: PoolClient,
  input: Readonly<{
    workspaceId: string;
    conversationId: string;
    contactName: string | null;
    leadId: string | null;
    providerTimestamp: Date;
  }>,
): Promise<void> {
  await client.query(
    `
      UPDATE whatsapp_conversations
      SET last_message_at = CASE
            WHEN last_message_at IS NULL OR last_message_at < $3
              THEN $3
            ELSE last_message_at
          END,
          contact_name = COALESCE($4, contact_name),
          lead_id = COALESCE(lead_id, $5),
          updated_at = now()
      WHERE workspace_id = $1
        AND id = $2
    `,
    [
      input.workspaceId,
      input.conversationId,
      input.providerTimestamp,
      input.contactName,
      input.leadId,
    ],
  );
}

/**
 * Stores every inbound message exactly once. A single transaction keeps
 * conversation creation, message insertion, lead association, and last-message
 * updates consistent. Duplicate provider message IDs are acknowledged by the
 * caller but do not update conversation activity.
 */
export async function persistInboundMessages(
  pool: Pool,
  workspaceId: string,
  messages: readonly InboundWhatsAppMessage[],
): Promise<PersistInboundResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const workspace = await client.query<{ id: string }>(
      "SELECT id FROM workspaces WHERE id = $1",
      [workspaceId],
    );

    if (!workspace.rows[0]) {
      throw new WhatsAppWorkspaceNotFoundError();
    }

    let stored = 0;
    let duplicates = 0;

    for (const message of messages) {
      const conversation = await findOrCreateConversation(client, {
        workspaceId,
        phoneNumberId: message.phoneNumberId,
        customerWaId: message.senderWaId,
        contactName: message.contactName,
      });
      const messageId = await insertInboundMessage(client, {
        workspaceId,
        conversationId: conversation.id,
        message,
      });

      if (!messageId) {
        duplicates += 1;
        continue;
      }

      const leadId =
        conversation.leadId ??
        (message.senderPhoneNumber
          ? await findLeadIdForSender(
              client,
              workspaceId,
              message.senderPhoneNumber,
            )
          : null);

      await updateConversationAfterMessage(client, {
        workspaceId,
        conversationId: conversation.id,
        contactName: message.contactName,
        leadId,
        providerTimestamp: message.providerTimestamp,
      });
      stored += 1;
    }

    await client.query("COMMIT");
    return { stored, duplicates };
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

export async function listConversations(
  pool: Pool,
  workspaceId: string,
): Promise<WhatsAppConversation[]> {
  const result = await pool.query<ConversationRow>(
    `
      ${CONVERSATION_SELECT}
      WHERE conversation.workspace_id = $1
      ORDER BY
        COALESCE(conversation.last_message_at, conversation.created_at) DESC,
        conversation.id ASC
    `,
    [workspaceId],
  );

  return result.rows.map(mapConversationRow);
}

export async function getConversation(
  pool: Pool,
  workspaceId: string,
  conversationId: string,
): Promise<WhatsAppConversation | null> {
  const result = await pool.query<ConversationRow>(
    `
      ${CONVERSATION_SELECT}
      WHERE conversation.workspace_id = $1
        AND conversation.id = $2
    `,
    [workspaceId, conversationId],
  );

  const row = result.rows[0];
  return row ? mapConversationRow(row) : null;
}

export async function listMessagesForConversation(
  pool: Pool,
  workspaceId: string,
  conversationId: string,
): Promise<WhatsAppMessage[]> {
  const result = await pool.query<MessageRow>(
    `
      SELECT
        id,
        conversation_id,
        direction,
        message_type,
        text_content,
        provider_timestamp,
        processing_status,
        created_at
      FROM whatsapp_messages
      WHERE workspace_id = $1
        AND conversation_id = $2
      ORDER BY provider_timestamp ASC, created_at ASC, id ASC
    `,
    [workspaceId, conversationId],
  );

  return result.rows.map(mapMessageRow);
}
