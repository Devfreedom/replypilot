import type { DeliveryStatusEvent, InboundWhatsAppMessage } from "./types.js";

export const PHONE_NUMBER_ID_PATTERN = /^\d{5,32}$/;
export const MAX_WEBHOOK_ENTRIES = 1_000;
export const MAX_WEBHOOK_CHANGES_PER_ENTRY = 1_000;
export const MAX_WEBHOOK_MESSAGES_PER_PAYLOAD = 1_000;
export const MAX_WEBHOOK_STATUSES_PER_PAYLOAD = 1_000;
export const MAX_WEBHOOK_CONTACTS_PER_CHANGE = 1_000;

const WA_ID_PATTERN = PHONE_NUMBER_ID_PATTERN;
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

function assertWebhookArrayBound(
  count: number,
  max: number,
  kind: string,
  errorMessage: string,
): void {
  if (count <= max) {
    return;
  }

  // Log only numeric counts; never log customer PII, bodies, or tokens.
  console.warn(`WhatsApp webhook payload exceeded ${kind} limit.`, {
    kind,
    count,
    max,
  });
  throw new InvalidWhatsAppPayloadError(errorMessage);
}

function readPhoneNumberId(metadata: unknown, contextLabel = ""): string {
  if (!isRecord(metadata) || typeof metadata.phone_number_id !== "string") {
    throw new InvalidWhatsAppPayloadError(
      `Missing receiving phone-number ID${contextLabel}`,
    );
  }

  if (!PHONE_NUMBER_ID_PATTERN.test(metadata.phone_number_id)) {
    throw new InvalidWhatsAppPayloadError(
      `Invalid receiving phone-number ID${contextLabel}`,
    );
  }

  return metadata.phone_number_id;
}

function* iterWhatsAppMessageChanges(
  payload: unknown,
): Generator<Record<string, unknown>> {
  if (!isRecord(payload) || typeof payload.object !== "string") {
    throw new InvalidWhatsAppPayloadError("Missing webhook object");
  }

  if (payload.object !== "whatsapp_business_account") {
    return;
  }

  if (!Array.isArray(payload.entry)) {
    throw new InvalidWhatsAppPayloadError("Missing webhook entries");
  }

  assertWebhookArrayBound(
    payload.entry.length,
    MAX_WEBHOOK_ENTRIES,
    "entries",
    "Too many webhook entries",
  );

  for (const entry of payload.entry) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) {
      throw new InvalidWhatsAppPayloadError("Invalid webhook entry");
    }

    assertWebhookArrayBound(
      entry.changes.length,
      MAX_WEBHOOK_CHANGES_PER_ENTRY,
      "changes",
      "Too many changes in webhook entry",
    );

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

      yield value;
    }
  }
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
 * Extracts inbound messages from a Meta webhook payload.
 *
 * When `configuredPhoneNumberId` is supplied, only that legacy single-business
 * number is returned. Omitting it returns messages for every phone-number ID so
 * the webhook can route each event through its registered connection and
 * ignore unknown numbers explicitly.
 *
 * Status-only, template, and other unrelated changes are ignored. Structurally
 * invalid message payloads throw so the caller can return a non-200 response
 * and Meta can retry.
 */
export function parseWhatsAppWebhook(
  payload: unknown,
  configuredPhoneNumberId?: string | null,
): InboundWhatsAppMessage[] {
  const messages: InboundWhatsAppMessage[] = [];
  let totalMessages = 0;

  for (const value of iterWhatsAppMessageChanges(payload)) {
    if (Array.isArray(value.contacts)) {
      assertWebhookArrayBound(
        value.contacts.length,
        MAX_WEBHOOK_CONTACTS_PER_CHANGE,
        "contacts",
        "Too many contacts in webhook change",
      );
    }

    if (!("messages" in value)) {
      // Delivery/read status changes also use field=messages but carry a
      // statuses array instead of inbound messages.
      continue;
    }

    if (!Array.isArray(value.messages)) {
      throw new InvalidWhatsAppPayloadError("Invalid messages array");
    }

    totalMessages += value.messages.length;
    assertWebhookArrayBound(
      totalMessages,
      MAX_WEBHOOK_MESSAGES_PER_PAYLOAD,
      "messages",
      "Too many messages in webhook payload",
    );

    if (value.messages.length === 0) {
      continue;
    }

    const phoneNumberId = readPhoneNumberId(value.metadata);

    if (
      configuredPhoneNumberId &&
      phoneNumberId !== configuredPhoneNumberId
    ) {
      continue;
    }

    const names = contactNames(value.contacts);

    for (const message of value.messages) {
      messages.push(parseMessage(message, phoneNumberId, names));
    }
  }

  return messages;
}

const WAMID_PATTERN = /^wamid\.[A-Za-z0-9+/=_-]{5,500}$/;
const DELIVERY_STATUS_MAX_LENGTH = 64;

function parseDeliveryTimestamp(value: unknown): Date {
  // Delivery-status timestamps use the same Unix-seconds format as message
  // timestamps. Reject non-string and non-numeric-string values.
  if (typeof value !== "string" || !/^\d{1,12}$/.test(value)) {
    throw new InvalidWhatsAppPayloadError(
      "Invalid delivery-status event timestamp",
    );
  }

  const seconds = Number(value);
  const timestamp = new Date(seconds * 1_000);

  if (!Number.isSafeInteger(seconds) || Number.isNaN(timestamp.getTime())) {
    throw new InvalidWhatsAppPayloadError(
      "Invalid delivery-status event timestamp",
    );
  }

  return timestamp;
}

function parseDeliveryErrorDescription(error: unknown): string | null {
  if (!isRecord(error)) {
    return null;
  }

  const code = typeof error.code === "number" ? `code=${error.code}` : null;
  const type = typeof error.type === "string" ? `type=${error.type}` : null;
  const subcode =
    typeof error.error_subcode === "number"
      ? `subcode=${error.error_subcode}`
      : null;

  const parts = [code, subcode, type].filter(Boolean);
  const description = parts.length > 0 ? parts.join(", ") : "unknown error";

  // Bound to 200 characters; never include user data.
  return description.slice(0, 200);
}

function parseDeliveryStatus(
  value: unknown,
  phoneNumberId: string,
): DeliveryStatusEvent {
  if (!isRecord(value)) {
    throw new InvalidWhatsAppPayloadError(
      "Invalid delivery-status object in statuses array",
    );
  }

  const wamid =
    typeof value.id === "string" &&
    WAMID_PATTERN.test(value.id.trim()) &&
    value.id.trim().length <= PROVIDER_MESSAGE_ID_MAX_LENGTH
      ? value.id.trim()
      : null;

  if (!wamid) {
    throw new InvalidWhatsAppPayloadError(
      "Delivery-status event is missing a valid wamid",
    );
  }

  const status =
    typeof value.status === "string" &&
    value.status.trim().length <= DELIVERY_STATUS_MAX_LENGTH
      ? value.status.trim()
      : null;

  if (!status) {
    throw new InvalidWhatsAppPayloadError(
      "Delivery-status event is missing a valid status value",
    );
  }

  const providerTimestamp = parseDeliveryTimestamp(value.timestamp);
  const firstError =
    Array.isArray(value.errors) ? value.errors[0] : null;
  const errorDescription =
    status === "failed"
      ? parseDeliveryErrorDescription(firstError ?? null)
      : null;

  return {
    providerMessageId: wamid,
    phoneNumberId,
    status,
    providerTimestamp,
    errorDescription,
  };
}

/**
 * Extracts delivery-status events from the Meta webhook payload.
 *
 * Each change in the `messages` field may carry either an inbound `messages`
 * array (handled by parseWhatsAppWebhook) or a `statuses` array for delivery
 * events, or both. This function handles only the statuses array.
 *
 * When `configuredPhoneNumberId` is supplied, only events for that legacy
 * business number are returned. Omitting it returns events for every
 * phone-number ID so the webhook can route them by connection.
 *
 * Structurally invalid entries throw so the caller can return a non-200
 * response and Meta can retry.
 */
export function parseWhatsAppDeliveryStatuses(
  payload: unknown,
  configuredPhoneNumberId?: string | null,
): DeliveryStatusEvent[] {
  const events: DeliveryStatusEvent[] = [];
  let totalStatuses = 0;

  for (const changeValue of iterWhatsAppMessageChanges(payload)) {
    if (!("statuses" in changeValue)) {
      continue;
    }

    if (!Array.isArray(changeValue.statuses)) {
      throw new InvalidWhatsAppPayloadError("Invalid statuses array");
    }

    totalStatuses += changeValue.statuses.length;
    assertWebhookArrayBound(
      totalStatuses,
      MAX_WEBHOOK_STATUSES_PER_PAYLOAD,
      "statuses",
      "Too many statuses in webhook payload",
    );

    if (changeValue.statuses.length === 0) {
      continue;
    }

    const phoneNumberId = readPhoneNumberId(
      changeValue.metadata,
      " in delivery-status change",
    );

    if (
      configuredPhoneNumberId &&
      phoneNumberId !== configuredPhoneNumberId
    ) {
      continue;
    }

    for (const statusEntry of changeValue.statuses) {
      events.push(parseDeliveryStatus(statusEntry, phoneNumberId));
    }
  }

  return events;
}
