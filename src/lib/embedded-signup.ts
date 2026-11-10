/**
 * Pure helpers for Meta WhatsApp Embedded Signup v4.
 *
 * This module deliberately contains no React, DOM, or network code so the
 * origin check, event parsing, and API-response validation can be tested with
 * Node's test runner. Browser SDK loading lives in `meta-sdk.ts`.
 */

export const WHATSAPP_CONNECTION_STATUSES = [
  "pending",
  "active",
  "disconnected",
  "error",
] as const;

export type WhatsAppConnectionStatus =
  (typeof WHATSAPP_CONNECTION_STATUSES)[number];

export type WhatsAppConnectionSummary = Readonly<{
  id: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  label: string | null;
  wabaId: string | null;
  status: WhatsAppConnectionStatus;
  credentialsConfigured: boolean;
  tokenExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  disconnectedAt: string | null;
  lastVerifiedAt: string | null;
  webhookSubscribedAt: string | null;
  lastError: string | null;
}>;

export const CONNECTION_STATUS_LABELS: Record<WhatsAppConnectionStatus, string> =
  {
    pending: "Pending activation",
    active: "Active",
    disconnected: "Disconnected",
    error: "Needs attention",
  };

export type EmbeddedSignupPublicConfig = Readonly<{
  configured: boolean;
  appId: string | null;
  configId: string | null;
  graphApiVersion: string | null;
  allowedOrigin: string | null;
}>;

export type EmbeddedSignupEvent =
  | Readonly<{
      kind: "success";
      phoneNumberId: string;
      wabaId: string;
      businessId: string | null;
    }>
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "error"; message: string | null }>
  | Readonly<{ kind: "incomplete"; event: string }>
  | Readonly<{ kind: "ignored" }>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isStatus(value: unknown): value is WhatsAppConnectionStatus {
  return (
    typeof value === "string" &&
    (WHATSAPP_CONNECTION_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Parses one connection record. New verification fields are optional so a
 * response from an older API cannot break the settings page; the required
 * ownership/status fields are strict.
 */
export function parseWhatsAppConnection(
  value: unknown,
): WhatsAppConnectionSummary | null {
  const record = asRecord(value);

  if (
    !record ||
    typeof record.id !== "string" ||
    typeof record.phoneNumberId !== "string" ||
    !isStatus(record.status)
  ) {
    return null;
  }

  return {
    id: record.id,
    phoneNumberId: record.phoneNumberId,
    displayPhoneNumber: stringOrNull(record.displayPhoneNumber),
    label: stringOrNull(record.label),
    wabaId: stringOrNull(record.wabaId),
    status: record.status,
    credentialsConfigured: record.credentialsConfigured === true,
    tokenExpiresAt: stringOrNull(record.tokenExpiresAt),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
    activatedAt: stringOrNull(record.activatedAt),
    disconnectedAt: stringOrNull(record.disconnectedAt),
    lastVerifiedAt: stringOrNull(record.lastVerifiedAt),
    webhookSubscribedAt: stringOrNull(record.webhookSubscribedAt),
    lastError: stringOrNull(record.lastError),
  };
}

export function parseConnectionsResponse(
  value: unknown,
): WhatsAppConnectionSummary[] | null {
  const record = asRecord(value);

  if (!record || !Array.isArray(record.connections)) {
    return null;
  }

  const connections: WhatsAppConnectionSummary[] = [];

  for (const entry of record.connections) {
    const parsed = parseWhatsAppConnection(entry);

    if (!parsed) {
      return null;
    }

    connections.push(parsed);
  }

  return connections;
}

export function parseConnectionResponse(
  value: unknown,
): WhatsAppConnectionSummary | null {
  const record = asRecord(value);
  return record ? parseWhatsAppConnection(record.connection) : null;
}

export function parseEmbeddedSignupConfigResponse(
  value: unknown,
): EmbeddedSignupPublicConfig | null {
  const record = asRecord(value);
  const config = record ? asRecord(record.config) : null;

  if (!config || typeof config.configured !== "boolean") {
    return null;
  }

  return {
    configured: config.configured,
    appId: stringOrNull(config.appId),
    configId: stringOrNull(config.configId),
    graphApiVersion: stringOrNull(config.graphApiVersion),
    allowedOrigin: stringOrNull(config.allowedOrigin),
  };
}

export function parseOnboardingSessionResponse(
  value: unknown,
): Readonly<{ state: string; expiresAt: string }> | null {
  const record = asRecord(value);

  if (
    !record ||
    typeof record.state !== "string" ||
    record.state.length < 20 ||
    typeof record.expiresAt !== "string"
  ) {
    return null;
  }

  return { state: record.state, expiresAt: record.expiresAt };
}

export type CompleteOnboardingResponse = Readonly<{
  connection: WhatsAppConnectionSummary;
  verification: "active" | "pending";
  replayed: boolean;
}>;

export function parseCompleteOnboardingResponse(
  value: unknown,
): CompleteOnboardingResponse | null {
  const record = asRecord(value);
  const connection = record
    ? parseWhatsAppConnection(record.connection)
    : null;
  const verification = record?.verification;

  if (
    !record ||
    !connection ||
    (verification !== "active" && verification !== "pending")
  ) {
    return null;
  }

  return {
    connection,
    verification,
    replayed: record.replayed === true,
  };
}

/**
 * Accepts only HTTPS facebook.com or a subdomain of it. Using URL.hostname
 * avoids the suffix bug in `origin.endsWith("facebook.com")`, which would
 * accept `https://facebook.com.example.test`.
 */
export function isAllowedMetaOrigin(origin: string): boolean {
  let url: URL;

  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") {
    return false;
  }

  // Meta posts the event from the standard HTTPS origin only.
  if (url.port !== "" && url.port !== "443") {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  return hostname === "facebook.com" || hostname.endsWith(".facebook.com");
}

/**
 * Parses the Embedded Signup session-logging message. Only a FINISH event with
 * both a phone-number ID and a Messaging account ID is actionable; WABA-only
 * and app-only finishes are reported as incomplete rather than successful.
 */
export function parseEmbeddedSignupEventData(
  data: unknown,
): EmbeddedSignupEvent {
  const record = asRecord(data);

  if (!record || record.type !== "WA_EMBEDDED_SIGNUP") {
    return { kind: "ignored" };
  }

  const event = typeof record.event === "string" ? record.event : "";
  const payload = asRecord(record.data);

  if (event === "CANCEL") {
    return { kind: "cancelled" };
  }

  if (event === "ERROR") {
    const message = payload
      ? stringOrNull(payload.error_message) ?? stringOrNull(payload.message)
      : null;
    return { kind: "error", message };
  }

  if (event === "FINISH") {
    const phoneNumberId = payload
      ? stringOrNull(payload.phone_number_id)
      : null;
    const wabaId = payload ? stringOrNull(payload.waba_id) : null;

    if (phoneNumberId && wabaId) {
      return {
        kind: "success",
        phoneNumberId,
        wabaId,
        businessId: payload ? stringOrNull(payload.business_id) : null,
      };
    }

    return { kind: "incomplete", event };
  }

  if (event.startsWith("FINISH")) {
    return { kind: "incomplete", event };
  }

  return { kind: "ignored" };
}

/**
 * Validates a browser message event and forwards only recognized Meta
 * Embedded Signup events. Returns true when the event was recognized.
 */
export function handleEmbeddedSignupMessage(
  message: Readonly<{ origin: string; data: unknown }>,
  onEvent: (event: EmbeddedSignupEvent) => void,
): boolean {
  if (!isAllowedMetaOrigin(message.origin)) {
    return false;
  }

  const event = parseEmbeddedSignupEventData(message.data);

  if (event.kind === "ignored") {
    return false;
  }

  onEvent(event);
  return true;
}

/**
 * Guards the Connect button: only owners, only with server configuration, and
 * never while another signup is already in progress.
 */
export function canStartEmbeddedSignup(
  input: Readonly<{
    role: "owner" | "member" | null;
    configured: boolean;
    configLoading: boolean;
    connecting: boolean;
  }>,
): boolean {
  return (
    input.role === "owner" &&
    input.configured &&
    !input.configLoading &&
    !input.connecting
  );
}
