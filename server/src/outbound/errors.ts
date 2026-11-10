/**
 * Stable, shared outbound API errors.
 *
 * The WhatsApp connection rejection is produced by two different routes (the
 * manual send route and the approve-and-send route), so the error code and the
 * user-facing message live here exactly once. Both routes must emit the same
 * body, otherwise a client cannot distinguish "the connection is disconnected"
 * from any other 409 by code.
 */

/** Stable machine-readable code for a disconnected WhatsApp connection. */
export const WHATSAPP_CONNECTION_DISCONNECTED_CODE =
  "WHATSAPP_CONNECTION_DISCONNECTED";

/** User-facing message paired with {@link WHATSAPP_CONNECTION_DISCONNECTED_CODE}. */
export const WHATSAPP_CONNECTION_DISCONNECTED_MESSAGE =
  "This WhatsApp connection is disconnected. Reconnect it before sending.";
