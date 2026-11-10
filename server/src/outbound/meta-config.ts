/**
 * Meta WhatsApp Cloud API outbound configuration.
 *
 * Real sending is disabled by default and must be explicitly enabled with a
 * complete, validated configuration. All restrictions are enforced server-side
 * and cannot be overridden by frontend input.
 *
 * When enabled, sending is restricted to:
 *  - One configured test workspace.
 *  - One configured sender phone-number ID.
 *  - An explicit allowlist of recipient phone numbers.
 *
 * If any required value is missing, malformed, or the allowlist is empty,
 * real sending remains unavailable (fail closed).
 */

import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import {
  getConversationProviderHint,
  workspaceHasCredentialConnection,
} from "../whatsapp/connections.js";
import { normalizeWhatsAppPhoneE164 } from "../whatsapp/phone.js";

/**
 * Graph API version must be an explicit "vNN.N" string. Accepting a bare
 * version number or a URL fragment would allow misconfigured callers to
 * reach an unintended endpoint.
 */
const GRAPH_API_VERSION_PATTERN = /^v\d{1,3}\.\d{1,3}$/;

/**
 * Phone-number IDs from Meta are numeric strings of 5–32 digits.
 */
const PHONE_NUMBER_ID_PATTERN = /^\d{5,32}$/;

/**
 * Maximum number of allowlisted recipients. Prevents accidental large-scale
 * sending during the test period.
 */
const MAX_ALLOWLIST_SIZE = 50;

export const META_OUTBOUND_ENV_KEYS = [
  "META_ACCESS_TOKEN",
  "META_GRAPH_API_VERSION",
  "WHATSAPP_SENDER_PHONE_NUMBER_ID",
  "META_OUTBOUND_ENABLED",
  "META_OUTBOUND_TEST_WORKSPACE_ID",
  "META_TEST_RECIPIENT_PHONE_NUMBERS",
] as const;

export type MetaOutboundConfig = Readonly<{
  /**
   * Meta access token. Never exposed in logs, responses, or URLs.
   * Treat this as a secret at all call sites.
   */
  accessToken: string;
  graphApiVersion: string;
  /** Numeric Meta phone-number ID for the configured sender. */
  senderPhoneNumberId: string;
  /** The one workspace that may use real Meta sending. */
  testWorkspaceId: string;
  /**
   * E.164-normalized phone numbers that are explicitly permitted as
   * recipients. Any number not in this set is rejected before any HTTP
   * request is made to Meta.
   */
  allowedRecipients: ReadonlySet<string>;
}>;

/**
 * Loads and validates Meta outbound configuration from the environment.
 *
 * Returns null when real sending is not enabled. Throws when
 * META_OUTBOUND_ENABLED=true but the runtime is production or required
 * variables are missing, malformed, or the allowlist is empty or invalid.
 * This fails closed: a partial configuration never silently falls back to
 * disabled.
 */
export function loadMetaOutboundConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MetaOutboundConfig | null {
  const enabledRaw = environment["META_OUTBOUND_ENABLED"]?.trim().toLowerCase();

  if (enabledRaw !== "true") {
    return null;
  }

  if (environment["NODE_ENV"] === "production") {
    throw new Error(
      "Meta outbound sending is disabled in production. Set META_OUTBOUND_ENABLED=false before starting the application.",
    );
  }

  const accessToken = environment["META_ACCESS_TOKEN"]?.trim() ?? "";
  const graphApiVersion = environment["META_GRAPH_API_VERSION"]?.trim() ?? "";
  const senderPhoneNumberId =
    environment["WHATSAPP_SENDER_PHONE_NUMBER_ID"]?.trim() ?? "";
  const testWorkspaceIdRaw =
    environment["META_OUTBOUND_TEST_WORKSPACE_ID"]?.trim() ?? "";
  const recipientsRaw =
    environment["META_TEST_RECIPIENT_PHONE_NUMBERS"]?.trim() ?? "";

  const errors: string[] = [];

  if (!accessToken) {
    errors.push("META_ACCESS_TOKEN must not be empty");
  } else if (accessToken.length < 20) {
    errors.push("META_ACCESS_TOKEN appears too short to be a valid token");
  }

  if (!GRAPH_API_VERSION_PATTERN.test(graphApiVersion)) {
    errors.push(
      'META_GRAPH_API_VERSION must match the pattern "vNN.N" (e.g. "v21.0")',
    );
  }

  if (!PHONE_NUMBER_ID_PATTERN.test(senderPhoneNumberId)) {
    errors.push(
      "WHATSAPP_SENDER_PHONE_NUMBER_ID must be a numeric Meta phone-number ID",
    );
  }

  const testWorkspaceResult = z
    .string()
    .uuid()
    .safeParse(testWorkspaceIdRaw);

  if (!testWorkspaceResult.success) {
    errors.push(
      "META_OUTBOUND_TEST_WORKSPACE_ID must be the UUID of the ReplyPilot test workspace",
    );
  }

  // Allowlist validation: must be non-empty and every entry must be a valid
  // E.164-normalizable phone number. A single invalid entry fails the whole
  // configuration rather than silently dropping it.
  const allowedRecipients = new Set<string>();

  if (!recipientsRaw) {
    errors.push(
      "META_TEST_RECIPIENT_PHONE_NUMBERS must contain at least one phone number",
    );
  } else {
    const entries = recipientsRaw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (entries.length === 0) {
      errors.push(
        "META_TEST_RECIPIENT_PHONE_NUMBERS must contain at least one phone number",
      );
    } else if (entries.length > MAX_ALLOWLIST_SIZE) {
      errors.push(
        `META_TEST_RECIPIENT_PHONE_NUMBERS must contain at most ${MAX_ALLOWLIST_SIZE} entries`,
      );
    } else {
      for (const entry of entries) {
        const normalized = normalizeWhatsAppPhoneE164(entry);

        if (!normalized) {
          errors.push(
            `META_TEST_RECIPIENT_PHONE_NUMBERS contains an invalid phone number (not normalized to E.164); entry will not be named in this error`,
          );
          break;
        }

        allowedRecipients.add(normalized);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Meta outbound is enabled (META_OUTBOUND_ENABLED=true) but configuration is invalid:\n  ${errors.join("\n  ")}\n\nSet META_OUTBOUND_ENABLED=false or fix all issues before starting.`,
    );
  }

  return {
    accessToken,
    graphApiVersion,
    senderPhoneNumberId,
    testWorkspaceId: testWorkspaceResult.success ? testWorkspaceResult.data : "",
    allowedRecipients,
  };
}

/**
 * Checks whether the given workspace is allowed to use real Meta sending.
 * This is always a server-side check and cannot be bypassed by frontend input.
 */
export function isWorkspaceAllowedForMetaSending(
  config: MetaOutboundConfig,
  workspaceId: string,
): boolean {
  return config.testWorkspaceId === workspaceId;
}

export function getOutboundProviderNameForWorkspace(
  workspaceId: string,
  environment: NodeJS.ProcessEnv = process.env,
): "mock" | "whatsapp" {
  const config = loadMetaOutboundConfig(environment);

  return config && isWorkspaceAllowedForMetaSending(config, workspaceId)
    ? "whatsapp"
    : "mock";
}

/**
 * Resolves the provider for a queue record using both the workspace's
 * credential-bearing connections and the legacy single-test-workspace
 * configuration.
 *
 * A connection with encrypted credentials always selects the WhatsApp provider,
 * even when it is disconnected or expired. That makes the worker reject the
 * send instead of silently substituting the mock provider for a real customer
 * message.
 *
 * A conversation whose connection exists but is disconnected also selects the
 * WhatsApp provider, even when that connection has no credentials. The mock
 * provider cannot observe the connection at all, so routing a disconnected
 * conversation to it would record a false "sent" for a number that cannot
 * deliver. The WhatsApp provider rejects the send with the connection's own
 * reason instead.
 */
export async function resolveOutboundProviderName(
  queryable: Pool | PoolClient,
  workspaceId: string,
  conversationId?: string | null,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<"mock" | "whatsapp"> {
  if (conversationId) {
    const hint = await getConversationProviderHint(
      queryable,
      workspaceId,
      conversationId,
    );

    if (hint.hasCredentials) {
      return "whatsapp";
    }

    if (hint.hasConnection && hint.status === "disconnected") {
      return "whatsapp";
    }
  } else if (await workspaceHasCredentialConnection(queryable, workspaceId)) {
    return "whatsapp";
  }

  return getOutboundProviderNameForWorkspace(workspaceId, environment);
}

/**
 * Returns a validated Graph API version for connection-backed sending. The
 * legacy configuration takes precedence, then META_GRAPH_API_VERSION, then a
 * conservative default. The value is always server-controlled.
 */
export function loadGraphApiVersion(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const raw = environment["META_GRAPH_API_VERSION"]?.trim() || "v21.0";

  if (!GRAPH_API_VERSION_PATTERN.test(raw)) {
    throw new Error(
      'META_GRAPH_API_VERSION must match the pattern "vNN.N" (e.g. "v21.0")',
    );
  }

  return raw;
}

/**
 * Checks whether the given E.164 phone number is in the configured recipient
 * allowlist. The allowlist is normalized at load time; the caller must also
 * normalize the candidate before comparing.
 */
export function isRecipientAllowlisted(
  config: MetaOutboundConfig,
  normalizedE164: string,
): boolean {
  return config.allowedRecipients.has(normalizedE164);
}
