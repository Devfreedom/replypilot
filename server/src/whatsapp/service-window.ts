/**
 * WhatsApp 24-hour customer service window enforcement.
 *
 * The service window allows free-form text messages to a customer only while
 * the customer has sent a message within the last 24 hours. The authoritative
 * timestamp is the original provider timestamp preserved when the inbound
 * message was stored — never the database insertion time, webhook receipt time,
 * or any frontend timestamp.
 *
 * This is not permission for unrelated or marketing messages. It is solely
 * a compliance gate for conversational reply messages within the service window.
 */

import type { Pool } from "pg";

export const SERVICE_WINDOW_HOURS = 24;
const SERVICE_WINDOW_MS = SERVICE_WINDOW_HOURS * 60 * 60 * 1_000;

export type ServiceWindowResult =
  | Readonly<{ kind: "open"; lastInboundAt: Date; expiresAt: Date }>
  | Readonly<{ kind: "expired"; lastInboundAt: Date; expiresAt: Date }>
  | Readonly<{ kind: "no-inbound-message" }>
  | Readonly<{ kind: "invalid-timestamp" }>;

/**
 * Checks the 24-hour customer service window for a specific customer in a
 * specific workspace. Uses the most recent inbound provider timestamp from
 * `whatsapp_messages`, which is sourced directly from Meta's webhook payload
 * (the Unix integer in the `timestamp` field of each message object).
 *
 * Fails closed: missing, null, or future timestamps return `invalid-timestamp`
 * rather than allowing a send.
 *
 * Call this immediately before invoking the Meta provider to minimize the
 * window between check and send.
 */
export async function checkServiceWindow(
  pool: Pool,
  workspaceId: string,
  customerId: string,
  now: Date = new Date(),
): Promise<ServiceWindowResult> {
  const result = await pool.query<{ provider_timestamp: Date }>(
    `
      SELECT message.provider_timestamp
      FROM whatsapp_messages AS message
      JOIN whatsapp_conversations AS conversation
        ON conversation.id = message.conversation_id
       AND conversation.workspace_id = message.workspace_id
      WHERE message.workspace_id = $1
        AND conversation.customer_id = $2
        AND message.direction = 'inbound'
        AND message.provider_timestamp IS NOT NULL
      ORDER BY message.provider_timestamp DESC, message.created_at DESC, message.id DESC
      LIMIT 1
    `,
    [workspaceId, customerId],
  );

  const row = result.rows[0];

  if (!row) {
    return { kind: "no-inbound-message" };
  }

  const ts = row.provider_timestamp;

  if (!(ts instanceof Date) || Number.isNaN(ts.getTime())) {
    return { kind: "invalid-timestamp" };
  }

  // Reject timestamps from the future. A future timestamp would extend the
  // window beyond what the customer's actual message permits.
  if (ts.getTime() > now.getTime()) {
    return { kind: "invalid-timestamp" };
  }

  const expiresAt = new Date(ts.getTime() + SERVICE_WINDOW_MS);

  if (now.getTime() > expiresAt.getTime()) {
    return { kind: "expired", lastInboundAt: ts, expiresAt };
  }

  return { kind: "open", lastInboundAt: ts, expiresAt };
}

/**
 * Returns true when the service window is open.
 * Use `checkServiceWindow` when you need the full result for logging or errors.
 */
export function isServiceWindowOpen(result: ServiceWindowResult): boolean {
  return result.kind === "open";
}
