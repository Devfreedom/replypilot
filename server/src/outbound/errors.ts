/**
 * Stable, shared outbound API errors.
 *
 * The WhatsApp connection rejection is produced by two different routes (the
 * manual send route and the approve-and-send route), so the error code and the
 * user-facing message live here exactly once. Both routes must emit the same
 * body, otherwise a client cannot distinguish "the connection is disconnected"
 * from any other 409 by code.
 *
 * Every connection state the worker refuses to deliver on has its own stable
 * code here. The API refuses exactly the states the worker refuses, so a
 * request that is accepted is a request the worker can act on.
 */

import type { WhatsAppConnectionStatus } from "../whatsapp/connections.js";

/** Stable machine-readable code for a disconnected WhatsApp connection. */
export const WHATSAPP_CONNECTION_DISCONNECTED_CODE =
  "WHATSAPP_CONNECTION_DISCONNECTED";

/** User-facing message paired with {@link WHATSAPP_CONNECTION_DISCONNECTED_CODE}. */
export const WHATSAPP_CONNECTION_DISCONNECTED_MESSAGE =
  "This WhatsApp connection is disconnected. Reconnect it before sending.";

/** Stable machine-readable code for a WhatsApp connection that is not active yet. */
export const WHATSAPP_CONNECTION_PENDING_CODE = "WHATSAPP_CONNECTION_PENDING";

/** User-facing message paired with {@link WHATSAPP_CONNECTION_PENDING_CODE}. */
export const WHATSAPP_CONNECTION_PENDING_MESSAGE =
  "This WhatsApp connection is not active yet. Activate it before sending.";

/** Stable machine-readable code for a WhatsApp connection that needs attention. */
export const WHATSAPP_CONNECTION_ERROR_CODE = "WHATSAPP_CONNECTION_ERROR";

/** User-facing message paired with {@link WHATSAPP_CONNECTION_ERROR_CODE}. */
export const WHATSAPP_CONNECTION_ERROR_MESSAGE =
  "This WhatsApp connection needs attention. Verify it before sending.";

/** Stable machine-readable code for a conversation without a WhatsApp connection. */
export const WHATSAPP_CONNECTION_MISSING_CODE =
  "WHATSAPP_CONNECTION_MISSING";

/** User-facing message paired with {@link WHATSAPP_CONNECTION_MISSING_CODE}. */
export const WHATSAPP_CONNECTION_MISSING_MESSAGE =
  "This conversation has no WhatsApp connection in this workspace.";

/**
 * The connection states that must not be queued for delivery.
 *
 * "active" is excluded on purpose: it is the only state the worker will
 * deliver on, so it is the only state the API may queue.
 */
export type UnusableWhatsAppConnectionStatus =
  | Exclude<WhatsAppConnectionStatus, "active">
  | null;

/** A stable, client-visible rejection of an outbound send. */
export type OutboundConnectionRejection = Readonly<{
  code: string;
  message: string;
}>;

/**
 * Maps a connection state that cannot deliver onto its stable API rejection.
 *
 * The mapping is exhaustive on purpose. A new connection state must be
 * classified here, otherwise the API and the worker could disagree about what
 * may be queued.
 */
export function describeConnectionRejection(
  status: UnusableWhatsAppConnectionStatus,
): OutboundConnectionRejection {
  if (status === "disconnected") {
    return {
      code: WHATSAPP_CONNECTION_DISCONNECTED_CODE,
      message: WHATSAPP_CONNECTION_DISCONNECTED_MESSAGE,
    };
  }

  if (status === "pending") {
    return {
      code: WHATSAPP_CONNECTION_PENDING_CODE,
      message: WHATSAPP_CONNECTION_PENDING_MESSAGE,
    };
  }

  if (status === "error") {
    return {
      code: WHATSAPP_CONNECTION_ERROR_CODE,
      message: WHATSAPP_CONNECTION_ERROR_MESSAGE,
    };
  }

  return {
    code: WHATSAPP_CONNECTION_MISSING_CODE,
    message: WHATSAPP_CONNECTION_MISSING_MESSAGE,
  };
}
