import type { Pool, PoolClient } from "pg";
import { normalizeWhatsAppPhoneE164 } from "./phone.js";
import type {
  ConversationStatus,
  ConversationSummary,
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

type ConversationSummaryRow = Readonly<{
  id: string;
  customer_id: string;
  customer_display_name: string | null;
  customer_phone_e164: string | null;
  whatsapp_connection_id: string;
  phone_number_id: string;
  channel: "whatsapp";
  status: ConversationStatus;
  last_message_at: Date | null;
  last_message_preview: string | null;
  last_message_type: string | null;
  last_message_status: WhatsAppMessageProcessingStatus | null;
  created_at: Date;
  updated_at: Date;
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

const CONVERSATION_SUMMARY_SELECT = `
  SELECT
    conversation.id,
    conversation.customer_id,
    COALESCE(customer.display_name, conversation.contact_name) AS customer_display_name,
    customer.phone_e164 AS customer_phone_e164,
    conversation.whatsapp_connection_id,
    conversation.phone_number_id,
    conversation.channel,
    conversation.status,
    latest.provider_timestamp AS last_message_at,
    left(latest.text_content, 160) AS last_message_preview,
    latest.message_type AS last_message_type,
    latest.processing_status AS last_message_status,
    conversation.created_at,
    conversation.updated_at
  FROM whatsapp_conversations AS conversation
  JOIN customers AS customer
    ON customer.id = conversation.customer_id
   AND customer.workspace_id = conversation.workspace_id
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

function mapConversationSummaryRow(
  row: ConversationSummaryRow,
): ConversationSummary {
  return {
    id: row.id,
    customer: {
      id: row.customer_id,
      displayName: row.customer_display_name,
      phoneE164: row.customer_phone_e164,
    },
    whatsappConnectionId: row.whatsapp_connection_id,
    phoneNumberId: row.phone_number_id,
    channel: row.channel,
    status: row.status,
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

export class WhatsAppWorkspaceNotFoundError extends Error {
  constructor() {
    super("The configured WhatsApp workspace does not exist.");
    this.name = "WhatsAppWorkspaceNotFoundError";
  }
}

/**
 * Resolves the provider phone-number ID to a connection row for this
 * workspace, creating it on first use. The unique key makes concurrent webhook
 * deliveries converge on one connection.
 */
async function ensureWhatsAppConnection(
  client: PoolClient,
  workspaceId: string,
  phoneNumberId: string,
): Promise<string> {
  const created = await client.query<{ id: string }>(
    `
      INSERT INTO whatsapp_connections (workspace_id, phone_number_id)
      VALUES ($1, $2)
      ON CONFLICT (workspace_id, phone_number_id)
      DO NOTHING
      RETURNING id
    `,
    [workspaceId, phoneNumberId],
  );

  if (created.rows[0]) {
    return created.rows[0].id;
  }

  const existing = await client.query<{ id: string }>(
    `
      SELECT id
      FROM whatsapp_connections
      WHERE workspace_id = $1
        AND phone_number_id = $2
    `,
    [workspaceId, phoneNumberId],
  );

  const row = existing.rows[0];

  if (!row) {
    throw new Error("WhatsApp connection insert did not return a row.");
  }

  return row.id;
}

/**
 * Finds or creates the workspace-scoped customer for a sender. Identity is the
 * normalized E.164 phone number when available, otherwise the original
 * provider identifier. Both unique indexes are the concurrency guard; the
 * application never merges two existing customers.
 */
async function findOrCreateCustomer(
  client: PoolClient,
  input: Readonly<{
    workspaceId: string;
    phoneE164: string | null;
    providerContactId: string | null;
    displayName: string | null;
    seenAt: Date;
  }>,
): Promise<string> {
  const created = await client.query<{ id: string }>(
    `
      INSERT INTO customers (
        workspace_id,
        phone_e164,
        provider_contact_id,
        display_name,
        first_seen_at,
        last_seen_at
      )
      VALUES ($1, $2, $3, $4, $5, $5)
      ON CONFLICT DO NOTHING
      RETURNING id
    `,
    [
      input.workspaceId,
      input.phoneE164,
      input.providerContactId,
      input.displayName,
      input.seenAt,
    ],
  );

  if (created.rows[0]) {
    return created.rows[0].id;
  }

  const existing = await client.query<{ id: string }>(
    `
      SELECT id
      FROM customers
      WHERE workspace_id = $1
        AND (
          ($2::text IS NOT NULL AND phone_e164 = $2::text)
          OR ($3::text IS NOT NULL AND provider_contact_id = $3::text)
        )
      ORDER BY (phone_e164 = $2::text) DESC NULLS LAST, created_at ASC, id ASC
      LIMIT 1
    `,
    [input.workspaceId, input.phoneE164, input.providerContactId],
  );

  const row = existing.rows[0];

  if (!row) {
    throw new Error("Customer insert did not return a row.");
  }

  return row.id;
}

/**
 * Deterministic inbound conversation policy: reuse the most recently active
 * open or closed conversation for this customer and connection. A closed
 * conversation is reopened when its message is stored. Archived conversations
 * are never reopened; a new open conversation is created instead.
 *
 * The partial unique index on active conversations makes concurrent webhook
 * deliveries converge on one row even when both observe "no conversation yet".
 */
async function findOrCreateConversation(
  client: PoolClient,
  input: Readonly<{
    workspaceId: string;
    phoneNumberId: string;
    connectionId: string;
    customerId: string;
    customerWaId: string;
    contactName: string | null;
  }>,
): Promise<Readonly<{ id: string; leadId: string | null; status: ConversationStatus }>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await client.query<{
      id: string;
      lead_id: string | null;
      status: ConversationStatus;
    }>(
      `
        SELECT id, lead_id, status
        FROM whatsapp_conversations
        WHERE workspace_id = $1
          AND customer_id = $2
          AND whatsapp_connection_id = $3
          AND status IN ('open', 'closed')
        ORDER BY last_message_at DESC NULLS LAST, created_at DESC, id DESC
        LIMIT 1
      `,
      [input.workspaceId, input.customerId, input.connectionId],
    );

    const found = existing.rows[0];

    if (found) {
      return { id: found.id, leadId: found.lead_id, status: found.status };
    }

    const created = await client.query<{
      id: string;
      lead_id: string | null;
      status: ConversationStatus;
    }>(
      `
        INSERT INTO whatsapp_conversations (
          workspace_id,
          phone_number_id,
          customer_wa_id,
          contact_name,
          customer_id,
          whatsapp_connection_id,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'open')
        ON CONFLICT DO NOTHING
        RETURNING id, lead_id, status
      `,
      [
        input.workspaceId,
        input.phoneNumberId,
        input.customerWaId,
        input.contactName,
        input.customerId,
        input.connectionId,
      ],
    );

    const inserted = created.rows[0];

    if (inserted) {
      return { id: inserted.id, leadId: inserted.lead_id, status: inserted.status };
    }
  }

  throw new Error("WhatsApp conversation insert did not return a row.");
}

async function insertInboundMessage(
  client: PoolClient,
  input: Readonly<{
    workspaceId: string;
    conversationId: string;
    customerId: string;
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
        customer_id,
        provider_message_id,
        direction,
        message_type,
        text_content,
        provider_timestamp,
        processing_status
      )
      VALUES ($1, $2, $3, $4, 'inbound', $5, $6, $7, $8)
      ON CONFLICT (workspace_id, provider_message_id)
      DO NOTHING
      RETURNING id
    `,
    [
      input.workspaceId,
      input.conversationId,
      input.customerId,
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
          status = CASE WHEN status = 'closed' THEN 'open' ELSE status END,
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

async function updateCustomerAfterMessage(
  client: PoolClient,
  input: Readonly<{
    workspaceId: string;
    customerId: string;
    displayName: string | null;
    providerTimestamp: Date;
  }>,
): Promise<void> {
  await client.query(
    `
      UPDATE customers
      SET display_name = COALESCE($3, display_name),
          first_seen_at = LEAST(first_seen_at, $4),
          last_seen_at = GREATEST(last_seen_at, $4),
          updated_at = now()
      WHERE workspace_id = $1
        AND id = $2
    `,
    [
      input.workspaceId,
      input.customerId,
      input.displayName,
      input.providerTimestamp,
    ],
  );
}

/**
 * Stores every inbound message exactly once. A single transaction keeps
 * connection resolution, customer creation, conversation creation/reopening,
 * message insertion, lead association, and activity updates consistent.
 * Duplicate provider message IDs are acknowledged by the caller but do not
 * create records or update activity.
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
      // Skip before any create/reopen work so a duplicate delivery cannot
      // create a customer or conversation, or bump activity timestamps.
      const duplicate = await client.query<{ id: string }>(
        `
          SELECT id
          FROM whatsapp_messages
          WHERE workspace_id = $1
            AND provider_message_id = $2
        `,
        [workspaceId, message.providerMessageId],
      );

      if (duplicate.rows[0]) {
        duplicates += 1;
        continue;
      }

      const connectionId = await ensureWhatsAppConnection(
        client,
        workspaceId,
        message.phoneNumberId,
      );

      // Only an actual sender phone number may become a customer's E.164
      // identity. `senderWaId` can be a business-scoped user ID (BSUID) or
      // another provider identifier; feeding it to the phone normalizer would
      // risk fabricating a phone number from an identifier.
      const phoneE164 = normalizeWhatsAppPhoneE164(message.senderPhoneNumber);
      // Keep the original provider identifier when it is not just the phone
      // number (for example a business-scoped WhatsApp user ID).
      const providerContactId =
        phoneE164 !== null && message.senderWaId === message.senderPhoneNumber
          ? null
          : message.senderWaId;

      const customerId = await findOrCreateCustomer(client, {
        workspaceId,
        phoneE164,
        providerContactId,
        displayName: message.contactName,
        seenAt: message.providerTimestamp,
      });

      const conversation = await findOrCreateConversation(client, {
        workspaceId,
        phoneNumberId: message.phoneNumberId,
        connectionId,
        customerId,
        customerWaId: message.senderWaId,
        contactName: message.contactName,
      });
      const messageId = await insertInboundMessage(client, {
        workspaceId,
        conversationId: conversation.id,
        customerId,
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
      await updateCustomerAfterMessage(client, {
        workspaceId,
        customerId,
        displayName: message.contactName,
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

export type ListConversationSummariesOptions = Readonly<{
  limit: number;
  offset: number;
  status?: ConversationStatus;
}>;

export async function listConversationSummaries(
  pool: Pool,
  workspaceId: string,
  options: ListConversationSummariesOptions,
): Promise<
  Readonly<{ conversations: ConversationSummary[]; hasMore: boolean }>
> {
  const parameters: unknown[] = [workspaceId];
  let statusFilter = "";

  if (options.status) {
    parameters.push(options.status);
    statusFilter = `AND conversation.status = $${parameters.length}`;
  }

  parameters.push(options.limit + 1, options.offset);

  const result = await pool.query<ConversationSummaryRow>(
    `
      ${CONVERSATION_SUMMARY_SELECT}
      WHERE conversation.workspace_id = $1
        ${statusFilter}
      ORDER BY
        COALESCE(latest.provider_timestamp, conversation.created_at) DESC,
        conversation.id ASC
      LIMIT $${parameters.length - 1}
      OFFSET $${parameters.length}
    `,
    parameters,
  );

  const hasMore = result.rows.length > options.limit;

  return {
    conversations: result.rows
      .slice(0, options.limit)
      .map(mapConversationSummaryRow),
    hasMore,
  };
}

export async function getConversationSummary(
  pool: Pool,
  workspaceId: string,
  conversationId: string,
): Promise<ConversationSummary | null> {
  const result = await pool.query<ConversationSummaryRow>(
    `
      ${CONVERSATION_SUMMARY_SELECT}
      WHERE conversation.workspace_id = $1
        AND conversation.id = $2
    `,
    [workspaceId, conversationId],
  );

  const row = result.rows[0];
  return row ? mapConversationSummaryRow(row) : null;
}

export async function listMessagesForConversationPage(
  pool: Pool,
  workspaceId: string,
  conversationId: string,
  options: Readonly<{ limit: number; offset: number }>,
): Promise<Readonly<{ messages: WhatsAppMessage[]; hasMore: boolean }>> {
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
      LIMIT $3
      OFFSET $4
    `,
    [workspaceId, conversationId, options.limit + 1, options.offset],
  );

  return {
    messages: result.rows.slice(0, options.limit).map(mapMessageRow),
    hasMore: result.rows.length > options.limit,
  };
}
