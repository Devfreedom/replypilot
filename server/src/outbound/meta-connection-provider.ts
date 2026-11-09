/**
 * Connection-aware Meta WhatsApp Cloud API provider.
 *
 * Unlike the legacy single-workspace adapter, this provider resolves the
 * WhatsApp connection attached to the conversation being sent. That means the
 * sender phone-number ID and access token always come from the same
 * workspace-owned connection; a queued record can never borrow another
 * workspace's credentials.
 *
 * Safety properties:
 *  - The connection is looked up by conversation and workspace in PostgreSQL.
 *  - Disconnected, pending, expired, or undecryptable credentials fail closed.
 *  - The legacy single-test-workspace configuration is used only for its
 *    configured workspace and sender phone-number ID, preserving the existing
 *    test integration during migration.
 *  - Customer suppression and the 24-hour service window are rechecked
 *    immediately before the HTTP request.
 *  - Tokens are only sent in the Authorization header. They are never logged,
 *    placed in URLs, or returned to callers.
 *  - Ambiguous network/5xx outcomes use the existing manual_review path.
 */

import type { Pool } from "pg";
import type { MetaOutboundConfig } from "./meta-config.js";
import {
  isRecipientAllowlisted,
  loadGraphApiVersion,
} from "./meta-config.js";
import {
  describeMetaError,
  extractWamid,
  truncateToCodePoints,
} from "./meta-provider.js";
import {
  OutboundProviderAmbiguousError,
  OutboundProviderError,
  type OutboundMessageProvider,
  type OutboundProviderSendInput,
  type OutboundProviderSendResult,
} from "./provider.js";
import {
  resolveConversationConnection,
  type ConversationConnection,
} from "../whatsapp/connections.js";
import { decryptWhatsAppToken } from "../whatsapp/credentials.js";
import { checkServiceWindow } from "../whatsapp/service-window.js";
import { isCustomerSuppressed } from "../whatsapp/suppression.js";

const META_API_TIMEOUT_MS = 10_000;
const MAX_PROVIDER_ERROR_LENGTH = 500;

type CustomerInfo = Readonly<{
  customerId: string;
  phoneE164: string | null;
}>;

async function resolveConversationCustomer(
  pool: Pool,
  workspaceId: string,
  conversationId: string,
): Promise<CustomerInfo | null> {
  const result = await pool.query<{
    customer_id: string;
    phone_e164: string | null;
  }>(
    `
      SELECT
        conversation.customer_id,
        customer.phone_e164
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
  return row ? { customerId: row.customer_id, phoneE164: row.phone_e164 } : null;
}

function connectionFailureReason(connection: ConversationConnection): string {
  if (connection.status === "pending") {
    return "WhatsApp connection has not been activated.";
  }

  if (connection.status === "disconnected") {
    return "WhatsApp connection is disconnected.";
  }

  if (connection.status === "error") {
    return "WhatsApp connection needs attention; verify it again before sending.";
  }

  return "WhatsApp connection is not usable.";
}

export type ConnectionAwareMetaProviderOptions = Readonly<{
  /** Legacy single-workspace configuration; used only during migration. */
  legacyConfig?: MetaOutboundConfig | null;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
}>;

export class ConnectionAwareMetaProvider implements OutboundMessageProvider {
  readonly name = "whatsapp";
  readonly idempotency = "unsupported" as const;

  readonly #pool: Pool;
  readonly #legacyConfig: MetaOutboundConfig | null;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #now: () => Date;

  constructor(pool: Pool, options: ConnectionAwareMetaProviderOptions = {}) {
    this.#pool = pool;
    this.#legacyConfig = options.legacyConfig ?? null;
    this.#fetch = options.fetchImplementation ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? META_API_TIMEOUT_MS;
    this.#environment = options.environment ?? process.env;
    this.#now = options.now ?? (() => new Date());
  }

  async send(
    input: OutboundProviderSendInput,
  ): Promise<OutboundProviderSendResult> {
    const { workspaceId, conversationId, content, recipientPhone } = input;

    const connection = await resolveConversationConnection(
      this.#pool,
      workspaceId,
      conversationId,
    );

    if (!connection) {
      throw new OutboundProviderError(
        "Outbound send rejected: conversation has no WhatsApp connection in this workspace.",
      );
    }

    if (connection.workspaceId !== workspaceId) {
      throw new OutboundProviderError(
        "Outbound send rejected: conversation connection belongs to another workspace.",
      );
    }

    const credentials = this.#resolveCredentials(connection, workspaceId);

    const customer = await resolveConversationCustomer(
      this.#pool,
      workspaceId,
      conversationId,
    );

    if (!customer) {
      throw new OutboundProviderError(
        "Outbound send rejected: conversation customer cannot be resolved.",
      );
    }

    const resolvedPhone = recipientPhone ?? customer.phoneE164;

    if (!resolvedPhone) {
      throw new OutboundProviderError(
        "Outbound send rejected: customer has no phone number. Only phone-number customers can receive free-form text messages.",
      );
    }

    if (credentials.enforceRecipientAllowlist) {
      if (
        !credentials.legacyConfig ||
        !isRecipientAllowlisted(credentials.legacyConfig, resolvedPhone)
      ) {
        throw new OutboundProviderError(
          "Outbound send rejected: recipient phone number is not in the configured test allowlist.",
        );
      }
    }

    if (
      await isCustomerSuppressed(
        this.#pool,
        workspaceId,
        customer.customerId,
      )
    ) {
      throw new OutboundProviderError(
        "Outbound send rejected: customer is suppressed.",
      );
    }

    const windowResult = await checkServiceWindow(
      this.#pool,
      workspaceId,
      customer.customerId,
      this.#now(),
    );

    if (windowResult.kind !== "open") {
      const reason =
        windowResult.kind === "expired"
          ? `24-hour customer service window expired at ${windowResult.expiresAt.toISOString()}`
          : windowResult.kind === "no-inbound-message"
            ? "No inbound message found for this customer; the 24-hour service window cannot be determined"
            : "Customer service window timestamp is invalid or missing";

      throw new OutboundProviderError(
        `Outbound send rejected: ${reason}. Do not send free-form messages outside the service window.`,
      );
    }

    const toNumber = resolvedPhone.startsWith("+")
      ? resolvedPhone.slice(1)
      : resolvedPhone;
    const url = `https://graph.facebook.com/${credentials.graphApiVersion}/${connection.phoneNumberId}/messages`;
    const body = JSON.stringify({
      messaging_product: "whatsapp",
      to: toNumber,
      type: "text",
      text: { body: content },
    });

    let response: Response;

    try {
      response = await this.#fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Network error calling Meta API";
      throw new OutboundProviderAmbiguousError(
        truncateToCodePoints(
          `Meta API request failed (outcome unknown): ${reason}`,
          MAX_PROVIDER_ERROR_LENGTH,
        ),
      );
    }

    let data: unknown;

    try {
      data = (await response.json()) as unknown;
    } catch {
      if (response.ok) {
        throw new OutboundProviderAmbiguousError(
          "Meta API returned a non-JSON body with a success status (outcome unknown).",
        );
      }

      throw new OutboundProviderError(
        `Meta API returned HTTP ${response.status} with a non-JSON body.`,
      );
    }

    if (!response.ok) {
      const description = truncateToCodePoints(
        describeMetaError(data),
        MAX_PROVIDER_ERROR_LENGTH,
      );

      if (response.status >= 500) {
        throw new OutboundProviderAmbiguousError(
          `Meta API server error HTTP ${response.status}: ${description}`,
        );
      }

      throw new OutboundProviderError(
        `Meta API rejected the request HTTP ${response.status}: ${description}`,
      );
    }

    const wamid = extractWamid(data);

    if (!wamid) {
      throw new OutboundProviderAmbiguousError(
        "Meta API returned HTTP 200 but the response did not contain a valid message ID (wamid). Outcome is unknown.",
      );
    }

    return { providerMessageId: wamid, status: "sent" };
  }

  #resolveCredentials(
    connection: ConversationConnection,
    workspaceId: string,
  ): Readonly<{
    accessToken: string;
    graphApiVersion: string;
    enforceRecipientAllowlist: boolean;
    legacyConfig: MetaOutboundConfig | null;
  }> {
    if (!connection.encryptedToken && connection.status !== "active") {
      throw new OutboundProviderError(
        `Outbound send rejected: ${connectionFailureReason(connection)}`,
      );
    }

    if (connection.encryptedToken) {
      if (connection.status !== "active") {
        throw new OutboundProviderError(
          `Outbound send rejected: ${connectionFailureReason(connection)}`,
        );
      }

      if (
        connection.tokenExpiresAt &&
        connection.tokenExpiresAt.getTime() <= this.#now().getTime()
      ) {
        throw new OutboundProviderError(
          "Outbound send rejected: WhatsApp connection access token has expired.",
        );
      }

      let accessToken: string;

      try {
        accessToken = decryptWhatsAppToken(
          connection.encryptedToken,
          this.#environment,
        );
      } catch {
        // Never include the underlying encryption error: it may name
        // environment variables or key details.
        throw new OutboundProviderError(
          "Outbound send rejected: WhatsApp connection credentials could not be decrypted.",
        );
      }

      const legacyConfig =
        this.#legacyConfig &&
        this.#legacyConfig.testWorkspaceId === workspaceId
          ? this.#legacyConfig
          : null;

      return {
        accessToken,
        graphApiVersion:
          legacyConfig?.graphApiVersion ??
          loadGraphApiVersion(this.#environment),
        enforceRecipientAllowlist: legacyConfig !== null,
        legacyConfig,
      };
    }

    const legacyConfig = this.#legacyConfig;

    if (!legacyConfig || legacyConfig.testWorkspaceId !== workspaceId) {
      throw new OutboundProviderError(
        "Outbound send rejected: WhatsApp connection has no active credentials.",
      );
    }

    if (legacyConfig.senderPhoneNumberId !== connection.phoneNumberId) {
      throw new OutboundProviderError(
        "Outbound send rejected: the legacy Meta sender is not the conversation's connection.",
      );
    }

    return {
      accessToken: legacyConfig.accessToken,
      graphApiVersion: legacyConfig.graphApiVersion,
      enforceRecipientAllowlist: true,
      legacyConfig,
    };
  }
}
