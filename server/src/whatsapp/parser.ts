import type { InboundWhatsAppMessage } from "./types.js";

const WA_ID_PATTERN = /^\d{5,32}$/;
const WHATSAPP_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{4,255}$/;
const PROVIDER_MESSAGE_ID_MAX_LENGTH = 512;
const MESSAGE_TYPE_MAX_LENGTH = 64;
const TEXT_MAX_LENGTH = 10_000;
const CONTACT_NAME_MAX_LENGTH = 200;

export class InvalidWhatsAppPayloadError extends Error {
  constructor(message = "Invalid WhatsApp webhook payload") {
    super(message);
    this.name = "InvalidWhatsAppPayloadError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new InvalidWhatsAppPayloadError(`Missing ${field}`);
  }

  const trimmed = value.trim();

  if (!trimmed || trimmed.length > maxLength) {
    throw new InvalidWhatsAppPayloadError(`Invalid ${field}`);
  }

  return trimmed;
}

function parseProviderTimestamp(value: unknown): Date {
  if (typeof value !== "string" || !/^\d{1,12}$/.test(value)) {
    throw new InvalidWhatsAppPayloadError("Invalid message timestamp");
  }

  const seconds = Number(value);
  const timestamp = new Date(seconds * 1_000);

  if (!Number.isSafeInteger(seconds) || Number.isNaN(timestamp.getTime())) {
    throw new InvalidWhatsAppPayloadError("Invalid message timestamp");
  }

  return timestamp;
}

function contactNames(value: unknown): Map<string, string> {
  const names = new Map<string, string>();

  if (!Array.isArray(value)) {
    return names;
  }

  for (const contact of value) {
    if (!isRecord(contact)) {
      continue;
    }

    const identifiers = [contact.wa_id, contact.user_id];
    const profile = contact.profile;

    if (!isRecord(profile) || typeof profile.name !== "string") {
      continue;
    }

    const name = profile.name.trim().slice(0, CONTACT_NAME_MAX_LENGTH);

    if (!name) {
      continue;
    }

    for (const identifier of identifiers) {
      if (
        typeof identifier === "string" &&
        (WA_ID_PATTERN.test(identifier) ||
          WHATSAPP_IDENTIFIER_PATTERN.test(identifier))
      ) {
        names.set(identifier, name);
      }
    }
  }

  return names;
}

function parseText(
  type: string,
  value: unknown,
): string | null {
  if (type !== "text" || !isRecord(value) || typeof value.body !== "string") {
    return null;
  }

  if (value.body.length > TEXT_MAX_LENGTH) {
    throw new InvalidWhatsAppPayloadError("Text message is too long");
  }

  return value.body;
}

function parseMessage(
  value: unknown,
  phoneNumberId: string,
  namesByWaId: Map<string, string>,
): InboundWhatsAppMessage {
  if (!isRecord(value)) {
    throw new InvalidWhatsAppPayloadError("Invalid message object");
  }

  const phoneNumber =
    typeof value.from === "string" && WA_ID_PATTERN.test(value.from.trim())
      ? value.from.trim()
      : null;
  const businessScopedUserId =
    typeof value.from_user_id === "string" &&
    WHATSAPP_IDENTIFIER_PATTERN.test(value.from_user_id.trim())
      ? value.from_user_id.trim()
      : null;
  const senderWaId = businessScopedUserId ?? phoneNumber;

  if (!senderWaId) {
    throw new InvalidWhatsAppPayloadError("Missing or invalid sender");
  }

  const providerMessageId = readRequiredString(
    value.id,
    "provider message ID",
    PROVIDER_MESSAGE_ID_MAX_LENGTH,
  );
  const messageType = readRequiredString(
    value.type,
    "message type",
    MESSAGE_TYPE_MAX_LENGTH,
  );
  const text = parseText(messageType, value.text);

  return {
    providerMessageId,
    phoneNumberId,
    senderWaId,
    senderPhoneNumber: phoneNumber,
    contactName:
      namesByWaId.get(senderWaId) ??
      (phoneNumber ? namesByWaId.get(phoneNumber) : null) ??
      null,
    messageType,
    text,
    providerTimestamp: parseProviderTimestamp(value.timestamp),
  };
}

/**
 * Extracts inbound messages for the one configured business phone number.
 * Status-only, template, and other unrelated changes are ignored. Structurally
 * invalid message payloads throw so the caller can return a non-200 response
 * and Meta can retry.
 */
export function parseWhatsAppWebhook(
  payload: unknown,
  configuredPhoneNumberId: string,
): InboundWhatsAppMessage[] {
  if (!isRecord(payload) || typeof payload.object !== "string") {
    throw new InvalidWhatsAppPayloadError("Missing webhook object");
  }

  if (payload.object !== "whatsapp_business_account") {
    return [];
  }

  if (!Array.isArray(payload.entry)) {
    throw new InvalidWhatsAppPayloadError("Missing webhook entries");
  }

  const messages: InboundWhatsAppMessage[] = [];

  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) {
      throw new InvalidWhatsAppPayloadError("Invalid webhook entry");
    }

    for (const change of entry.changes) {
      if (!isRecord(change)) {
        throw new InvalidWhatsAppPayloadError("Invalid webhook change");
      }

      if (change.field !== "messages") {
        continue;
      }

      const value = change.value;

      if (!isRecord(value)) {
        throw new InvalidWhatsAppPayloadError("Missing change value");
      }

      if (
        typeof value.messaging_product === "string" &&
        value.messaging_product !== "whatsapp"
      ) {
        continue;
      }

      if (!("messages" in value)) {
        // Delivery/read status changes also use field=messages but carry a
        // statuses array instead of inbound messages.
        continue;
      }

      if (!Array.isArray(value.messages)) {
        throw new InvalidWhatsAppPayloadError("Invalid messages array");
      }

      if (value.messages.length === 0) {
        continue;
      }

      const metadata = value.metadata;

      if (
        !isRecord(metadata) ||
        typeof metadata.phone_number_id !== "string"
      ) {
        throw new InvalidWhatsAppPayloadError(
          "Missing receiving phone-number ID",
        );
      }

      if (metadata.phone_number_id !== configuredPhoneNumberId) {
        continue;
      }

      const names = contactNames(value.contacts);

      for (const message of value.messages) {
        messages.push(
          parseMessage(message, metadata.phone_number_id, names),
        );
      }
    }
  }

  return messages;
}
