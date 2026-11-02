/**
 * Meta WhatsApp Cloud API provider adapter.
 *
 * Implements OutboundMessageProvider by calling the Meta Graph API to send
 * free-form text messages within the 24-hour customer service window.
 *
 * Security constraints:
 *  - Access token is never logged, put in URL query parameters, or returned
 *    to the frontend.
 *  - The provider name is "whatsapp" and must match the value stored in
 *    outbound_messages.provider for the worker to claim and process rows.
 *  - Idempotency is declared "unsupported" because Meta's free-form text
 *    endpoint does not guarantee deduplication by any caller-supplied key.
 *    Stale sending rows therefore go to manual_review rather than auto-retry.
 *  - Workspace, sender, and recipient restrictions are enforced before the
 *    HTTP request is made.
 *  - The service window and suppression checks happen in the caller (worker)
 *    before the provider is invoked.
 *
 * Response mapping:
 *  - HTTP 200 with a valid wamid → success
 *  - HTTP 4xx → OutboundProviderError (definite failure, safe to record)
 *  - HTTP 5xx / network error / timeout → OutboundProviderAmbiguousError
 *    (outcome unknown; worker routes to manual_review)
 */

import type { Pool } from "pg";
import type { MetaOutboundConfig } from "./meta-config.js";
import {
  isRecipientAllowlisted,
  isWorkspaceAllowedForMetaSending,
} from "./meta-config.js";
import {
  OutboundProviderAmbiguousError,
  OutboundProviderError,
  type OutboundMessageProvider,
  type OutboundProviderSendInput,
  type OutboundProviderSendResult,
} from "./provider.js";
import { checkServiceWindow } from "../whatsapp/service-window.js";
import { isCustomerSuppressed } from "../whatsapp/suppression.js";

/** HTTP timeout for a single Meta API request (10 seconds). */
const META_API_TIMEOUT_MS = 10_000;

/** Max character length for bounded failure-reason strings. */
const MAX_PROVIDER_ERROR_LENGTH = 500;

/**
 * Truncates a string to at most `max` Unicode code points. Used to bound
 * error messages before storing them.
 */
function truncateToCodePoints(value: string, max: number): string {
  let codePointLength = 0;
  let characterLength = 0;

  for (const character of value) {
    if (codePointLength === max) break;
    codePointLength += 1;
    characterLength += character.length;
  }

  return value.slice(0, characterLength);
}

/**
 * Extracts an internal failure description from a Meta API error response.
 * Only includes the top-level error code and type to avoid logging sensitive
 * provider data. Never includes user data or message content.
 */
function describeMetaError(data: unknown): string {
  if (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    typeof (data as Record<string, unknown>).error === "object"
  ) {
    const error = (data as Record<string, unknown>).error as Record<
      string,
      unknown
    >;
    const code = typeof error.code === "number" ? String(error.code) : null;
    const type = typeof error.type === "string" ? error.type : null;
    const subcode =
      typeof error.error_subcode === "number"
        ? String(error.error_subcode)
        : null;

    const parts = [
      code ? `code=${code}` : null,
      subcode ? `subcode=${subcode}` : null,
      type ? `type=${type}` : null,
    ].filter(Boolean);

    return parts.length > 0
      ? `Meta API error: ${parts.join(", ")}`
      : "Meta API returned an error response";
  }

  return "Meta API returned an unrecognised error response";
}

type CustomerInfo = Readonly<{
  customerId: string;
  phoneE164: string | null;
}>;

/**
 * Resolves the customer for the conversation. Returns null if the conversation
 * does not belong to the workspace or does not exist.
 */
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

  if (!row) {
    return null;
  }

  return { customerId: row.customer_id, phoneE164: row.phone_e164 };
}

export class MetaWhatsAppCloudProvider implements OutboundMessageProvider {
  readonly name = "whatsapp";
  /**
   * Meta's free-form text endpoint does not provide a caller-supplied
   * idempotency key guarantee, so we declare unsupported. The worker will
   * route ambiguous (stale-recovery) outcomes to manual_review rather than
   * retrying automatically.
   */
  readonly idempotency = "unsupported" as const;

  readonly #config: MetaOutboundConfig;
  readonly #pool: Pool;

  constructor(config: MetaOutboundConfig, pool: Pool) {
    this.#config = config;
    this.#pool = pool;
  }

  async send(
    input: OutboundProviderSendInput,
  ): Promise<OutboundProviderSendResult> {
    const { workspaceId, conversationId, content, recipientPhone } = input;

    // 1. Workspace restriction — always server-side, never from frontend input.
    if (!isWorkspaceAllowedForMetaSending(this.#config, workspaceId)) {
      throw new OutboundProviderError(
        "Outbound send rejected: workspace is not authorised for real Meta sending.",
      );
    }

    // 2. Resolve recipient phone from input or conversation customer.
    //    recipientPhone is populated by claimQueuedOutboundMessages; if it is
    //    null we do a fallback lookup (defensive; normally it should be set).
    let resolvedPhone = recipientPhone;

    if (!resolvedPhone) {
      const customer = await resolveConversationCustomer(
        this.#pool,
        workspaceId,
        conversationId,
      );

      if (!customer) {
        throw new OutboundProviderError(
          "Outbound send rejected: conversation not found in workspace.",
        );
      }

      resolvedPhone = customer.phoneE164;
    }

    if (!resolvedPhone) {
      throw new OutboundProviderError(
        "Outbound send rejected: customer has no phone number. Only phone-number customers can receive free-form text messages.",
      );
    }

    // 3. Recipient allowlist — reject before any HTTP request to Meta.
    if (!isRecipientAllowlisted(this.#config, resolvedPhone)) {
      throw new OutboundProviderError(
        "Outbound send rejected: recipient phone number is not in the configured test allowlist.",
      );
    }

    // 4. Customer suppression check.
    //    Resolve customerId if not already available.
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

    if (await isCustomerSuppressed(this.#pool, workspaceId, customer.customerId)) {
      throw new OutboundProviderError(
        "Outbound send rejected: customer is suppressed.",
      );
    }

    // 5. Service window check — revalidated immediately before provider request.
    const windowResult = await checkServiceWindow(
      this.#pool,
      workspaceId,
      customer.customerId,
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

    // 6. Strip leading '+' for Meta's `to` field (Meta accepts E.164 with or
    //    without '+', but we normalise to digits-only for consistency).
    const toNumber = resolvedPhone.startsWith("+")
      ? resolvedPhone.slice(1)
      : resolvedPhone;

    // 7. Call Meta Graph API.
    const url = `https://graph.facebook.com/${this.#config.graphApiVersion}/${this.#config.senderPhoneNumberId}/messages`;

    const body = JSON.stringify({
      messaging_product: "whatsapp",
      to: toNumber,
      type: "text",
      text: { body: content },
    });

    let response: Response;

    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          // Token in Authorization header only — never in the URL or body.
          "Authorization": `Bearer ${this.#config.accessToken}`,
          "Content-Type": "application/json",
        },
        body,
        signal: AbortSignal.timeout(META_API_TIMEOUT_MS),
      });
    } catch (error) {
      // Network error, DNS failure, or timeout. The outcome is unknown.
      const reason =
        error instanceof Error ? error.message : "Network error calling Meta API";
      throw new OutboundProviderAmbiguousError(
        truncateToCodePoints(
          `Meta API request failed (outcome unknown): ${reason}`,
          MAX_PROVIDER_ERROR_LENGTH,
        ),
      );
    }

    // 8. Parse the response.
    let data: unknown;

    try {
      data = await response.json() as unknown;
    } catch {
      if (response.ok) {
        // 2xx with unparseable body — treat as ambiguous.
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
        // 5xx — Meta-side failure. Outcome unknown.
        throw new OutboundProviderAmbiguousError(
          `Meta API server error HTTP ${response.status}: ${description}`,
        );
      }

      // 4xx — definite rejection.
      throw new OutboundProviderError(
        `Meta API rejected the request HTTP ${response.status}: ${description}`,
      );
    }

    // 9. Extract the wamid from the success response.
    const wamid = extractWamid(data);

    if (!wamid) {
      // 200 OK but no valid wamid — treat as ambiguous; we can't confirm the
      // message was queued.
      throw new OutboundProviderAmbiguousError(
        "Meta API returned HTTP 200 but the response did not contain a valid message ID (wamid). Outcome is unknown.",
      );
    }

    return { providerMessageId: wamid, status: "sent" };
  }
}

/**
 * Extracts the wamid from a Meta Cloud API success response.
 * The wamid is the provider message ID used for delivery-status webhook matching.
 *
 * Expected structure:
 * { messages: [{ id: "wamid.xxx" }] }
 */
function extractWamid(data: unknown): string | null {
  if (
    typeof data !== "object" ||
    data === null ||
    !("messages" in data) ||
    !Array.isArray((data as Record<string, unknown>).messages)
  ) {
    return null;
  }

  const messages = (data as Record<string, unknown>).messages as unknown[];
  const first = messages[0];

  if (
    typeof first !== "object" ||
    first === null ||
    typeof (first as Record<string, unknown>).id !== "string"
  ) {
    return null;
  }

  const id = ((first as Record<string, unknown>).id as string).trim();

  // wamid format: "wamid...." with at least 10 characters total.
  if (id.length < 10 || id.length > 512) {
    return null;
  }

  return id;
}
