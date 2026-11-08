import type { Pool } from "pg";
import { checkServiceWindow, type ServiceWindowResult } from "./service-window.js";
import type { SuppressionReason, SuppressionRecord } from "./suppression.js";

export type ProtectedCustomerSummary = Readonly<{
  id: string;
  displayName: string | null;
  phoneE164: string | null;
  providerContactId: string | null;
}>;

export type CustomerSuppressionItem = Readonly<{
  suppression: SuppressionRecord;
  customer: ProtectedCustomerSummary;
  conversationCount: number;
}>;

type SuppressionListRow = Readonly<{
  id: string;
  workspace_id: string;
  customer_id: string;
  reason: SuppressionReason;
  notes: string | null;
  suppressed_at: Date;
  suppressed_by: string | null;
  display_name: string | null;
  phone_e164: string | null;
  provider_contact_id: string | null;
  conversation_count: number;
}>;

export async function listCustomerSuppressions(
  pool: Pool,
  workspaceId: string,
): Promise<CustomerSuppressionItem[]> {
  const result = await pool.query<SuppressionListRow>(
    `
      SELECT
        suppression.id,
        suppression.workspace_id,
        suppression.customer_id,
        suppression.reason,
        suppression.notes,
        suppression.suppressed_at,
        suppression.suppressed_by,
        customer.display_name,
        customer.phone_e164,
        customer.provider_contact_id,
        (
          SELECT count(*)::int
          FROM whatsapp_conversations AS conversation
          WHERE conversation.workspace_id = suppression.workspace_id
            AND conversation.customer_id = suppression.customer_id
        ) AS conversation_count
      FROM customer_suppressions AS suppression
      JOIN customers AS customer
        ON customer.id = suppression.customer_id
       AND customer.workspace_id = suppression.workspace_id
      WHERE suppression.workspace_id = $1
      ORDER BY suppression.suppressed_at DESC, suppression.id DESC
    `,
    [workspaceId],
  );

  return result.rows.map((row) => ({
    suppression: {
      id: row.id,
      workspaceId: row.workspace_id,
      customerId: row.customer_id,
      reason: row.reason,
      notes: row.notes,
      suppressedAt: row.suppressed_at.toISOString(),
      suppressedBy: row.suppressed_by,
    },
    customer: {
      id: row.customer_id,
      displayName: row.display_name,
      phoneE164: row.phone_e164,
      providerContactId: row.provider_contact_id,
    },
    conversationCount: row.conversation_count,
  }));
}

type CustomerRow = Readonly<{
  id: string;
  display_name: string | null;
  phone_e164: string | null;
  provider_contact_id: string | null;
}>;

export async function getProtectedCustomer(
  pool: Pool,
  workspaceId: string,
  customerId: string,
): Promise<ProtectedCustomerSummary | null> {
  const result = await pool.query<CustomerRow>(
    `
      SELECT id, display_name, phone_e164, provider_contact_id
      FROM customers
      WHERE workspace_id = $1
        AND id = $2
      LIMIT 1
    `,
    [workspaceId, customerId],
  );

  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        displayName: row.display_name,
        phoneE164: row.phone_e164,
        providerContactId: row.provider_contact_id,
      }
    : null;
}

export type DeliveryEventItem = Readonly<{
  id: string;
  outboundMessageId: string | null;
  providerMessageId: string;
  phoneNumberId: string;
  providerStatus: string;
  providerTimestamp: string;
  receivedAt: string;
  lastReceivedAt: string;
  duplicateCount: number;
  processingOutcome: "processing" | "processed" | "ignored" | "failed";
  processingReason: string | null;
  failureReason: string | null;
  outboundStatus: string | null;
  outboundContent: string | null;
}>;

type DeliveryEventRow = Readonly<{
  id: string;
  outbound_message_id: string | null;
  provider_message_id: string;
  phone_number_id: string;
  provider_status: string;
  provider_timestamp: Date;
  received_at: Date;
  last_received_at: Date;
  duplicate_count: number;
  processing_outcome: "processing" | "processed" | "ignored" | "failed";
  processing_reason: string | null;
  failure_reason: string | null;
  outbound_status: string | null;
  outbound_content: string | null;
}>;

export type ListDeliveryEventsOptions = Readonly<{
  limit: number;
  offset: number;
  outcome?: "processing" | "processed" | "ignored" | "failed";
  outboundMessageId?: string;
}>;

export async function listDeliveryEvents(
  pool: Pool,
  workspaceId: string,
  options: ListDeliveryEventsOptions,
): Promise<Readonly<{ events: DeliveryEventItem[]; hasMore: boolean }>> {
  const parameters: unknown[] = [workspaceId];
  const filters: string[] = [];

  if (options.outcome) {
    parameters.push(options.outcome);
    filters.push(`AND event.processing_outcome = $${parameters.length}`);
  }

  if (options.outboundMessageId) {
    parameters.push(options.outboundMessageId);
    filters.push(`AND event.outbound_message_id = $${parameters.length}`);
  }

  parameters.push(options.limit + 1, options.offset);

  const result = await pool.query<DeliveryEventRow>(
    `
      SELECT
        event.id,
        event.outbound_message_id,
        event.provider_message_id,
        event.phone_number_id,
        event.provider_status,
        event.provider_timestamp,
        event.received_at,
        event.last_received_at,
        event.duplicate_count,
        event.processing_outcome,
        event.processing_reason,
        event.failure_reason,
        message.status AS outbound_status,
        left(message.content, 160) AS outbound_content
      FROM whatsapp_delivery_events AS event
      LEFT JOIN outbound_messages AS message
        ON message.id = event.outbound_message_id
       AND message.workspace_id = event.workspace_id
      WHERE event.workspace_id = $1
        ${filters.join("\n        ")}
      ORDER BY event.received_at DESC, event.id DESC
      LIMIT $${parameters.length - 1}
      OFFSET $${parameters.length}
    `,
    parameters,
  );

  const hasMore = result.rows.length > options.limit;

  return {
    hasMore,
    events: result.rows.slice(0, options.limit).map((row) => ({
      id: row.id,
      outboundMessageId: row.outbound_message_id,
      providerMessageId: row.provider_message_id,
      phoneNumberId: row.phone_number_id,
      providerStatus: row.provider_status,
      providerTimestamp: row.provider_timestamp.toISOString(),
      receivedAt: row.received_at.toISOString(),
      lastReceivedAt: row.last_received_at.toISOString(),
      duplicateCount: row.duplicate_count,
      processingOutcome: row.processing_outcome,
      processingReason: row.processing_reason,
      failureReason: row.failure_reason,
      outboundStatus: row.outbound_status,
      outboundContent: row.outbound_content,
    })),
  };
}

export type ConversationProtection = Readonly<{
  customer: ProtectedCustomerSummary;
  serviceWindow: ServiceWindowResult;
  suppression: SuppressionRecord | null;
}>;

type ConversationCustomerRow = Readonly<{
  customer_id: string;
  display_name: string | null;
  phone_e164: string | null;
  provider_contact_id: string | null;
}>;

export async function getConversationProtection(
  pool: Pool,
  workspaceId: string,
  conversationId: string,
  now: Date = new Date(),
): Promise<ConversationProtection | null> {
  const result = await pool.query<ConversationCustomerRow>(
    `
      SELECT
        conversation.customer_id,
        COALESCE(customer.display_name, conversation.contact_name) AS display_name,
        customer.phone_e164,
        customer.provider_contact_id
      FROM whatsapp_conversations AS conversation
      JOIN customers AS customer
        ON customer.id = conversation.customer_id
       AND customer.workspace_id = conversation.workspace_id
      WHERE conversation.workspace_id = $1
        AND conversation.id = $2
      LIMIT 1
    `,
    [workspaceId, conversationId],
  );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  const [serviceWindow, suppression] = await Promise.all([
    checkServiceWindow(pool, workspaceId, row.customer_id, now),
    pool.query<{
      id: string;
      workspace_id: string;
      customer_id: string;
      reason: SuppressionReason;
      notes: string | null;
      suppressed_at: Date;
      suppressed_by: string | null;
    }>(
      `
        SELECT id, workspace_id, customer_id, reason, notes, suppressed_at, suppressed_by
        FROM customer_suppressions
        WHERE workspace_id = $1
          AND customer_id = $2
        LIMIT 1
      `,
      [workspaceId, row.customer_id],
    ),
  ]);

  const suppressionRow = suppression.rows[0];

  return {
    customer: {
      id: row.customer_id,
      displayName: row.display_name,
      phoneE164: row.phone_e164,
      providerContactId: row.provider_contact_id,
    },
    serviceWindow,
    suppression: suppressionRow
      ? {
          id: suppressionRow.id,
          workspaceId: suppressionRow.workspace_id,
          customerId: suppressionRow.customer_id,
          reason: suppressionRow.reason,
          notes: suppressionRow.notes,
          suppressedAt: suppressionRow.suppressed_at.toISOString(),
          suppressedBy: suppressionRow.suppressed_by,
        }
      : null,
  };
}
