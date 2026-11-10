import { createHash } from "node:crypto";

export type OutboundProviderSendInput = Readonly<{
  conversationId: string;
  content: string;
  idempotencyKey: string;
  /**
   * E.164-normalized recipient phone number resolved from the outbound row's
   * conversation customer. Null when the customer is identified only by a
   * provider contact ID (e.g. a BSUID) and has no phone number. Providers
   * that require a phone number (e.g. Meta Cloud API) must reject null here.
   */
  recipientPhone: string | null;
  /**
   * The workspace that owns this send request. Providers that restrict real
   * sending to a configured test workspace validate this before calling the
   * upstream API.
   */
  workspaceId: string;
}>;

export type OutboundProviderSendResult = Readonly<{
  providerMessageId: string;
  status: "sent";
}>;

/**
 * Name of the provider that simulates delivery without contacting Meta.
 *
 * The name is the routing key persisted on `outbound_messages.provider` and
 * used to claim rows, so it is the single place that identifies a simulated
 * delivery. A simulated provider cannot observe the WhatsApp connection, so a
 * simulated success must never be recorded once the connection stopped being
 * usable.
 */
export const MOCK_OUTBOUND_PROVIDER_NAME = "mock";

export interface OutboundMessageProvider {
  readonly name: string;
  readonly idempotency: "guaranteed" | "unsupported";

  send(
    input: OutboundProviderSendInput,
  ): Promise<OutboundProviderSendResult>;
}

export class OutboundProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundProviderError";
  }
}

export class OutboundProviderAmbiguousError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundProviderAmbiguousError";
  }
}

export type MockOutboundMessageProviderOptions = Readonly<{
  /**
   * Number of controlled failures per idempotency key before the next attempt
   * succeeds. Tests can use this to exercise retries without a real provider.
   */
  failures?: Readonly<Record<string, number>> | ReadonlyMap<string, number>;
  /**
   * Number of controlled ambiguous outcomes per idempotency key. An ambiguous
   * outcome means the provider may or may not have accepted the message; the
   * worker must never treat it as a definite rejection.
   */
  ambiguous?: Readonly<Record<string, number>> | ReadonlyMap<string, number>;
  /** Fail every attempt. Useful for bounded-retry and permanent-failure tests. */
  failAll?: boolean;
}>;

/**
 * Deterministic development provider. It never contacts WhatsApp or any other
 * external service. The same idempotency key always produces the same provider
 * message ID, so retries and stale-claim recovery are safe.
 */
function positiveCountEntries(
  values:
    | Readonly<Record<string, number>>
    | ReadonlyMap<string, number>
    | undefined,
): Array<[string, number]> {
  if (!values) {
    return [];
  }

  const entries =
    values instanceof Map ? values.entries() : Object.entries(values);

  return [...entries].filter(
    ([key, count]) =>
      key.trim().length > 0 && Number.isInteger(count) && count > 0,
  );
}

export class MockOutboundMessageProvider implements OutboundMessageProvider {
  readonly name = MOCK_OUTBOUND_PROVIDER_NAME;
  readonly idempotency = "guaranteed" as const;
  private readonly failures = new Map<string, number>();
  private readonly ambiguous = new Map<string, number>();
  private readonly failAll: boolean;

  constructor(options: MockOutboundMessageProviderOptions = {}) {
    this.failAll = options.failAll ?? false;

    for (const [key, count] of positiveCountEntries(options.failures)) {
      this.failures.set(key, count);
    }

    for (const [key, count] of positiveCountEntries(options.ambiguous)) {
      this.ambiguous.set(key, count);
    }
  }

  async send(
    input: OutboundProviderSendInput,
  ): Promise<OutboundProviderSendResult> {
    const ambiguousRemaining = this.ambiguous.get(input.idempotencyKey) ?? 0;

    if (ambiguousRemaining > 0) {
      this.ambiguous.set(input.idempotencyKey, ambiguousRemaining - 1);

      throw new OutboundProviderAmbiguousError(
        "Mock delivery provider simulated an ambiguous outcome for testing.",
      );
    }

    const remaining = this.failures.get(input.idempotencyKey) ?? 0;

    if (this.failAll || remaining > 0) {
      if (remaining > 0) {
        this.failures.set(input.idempotencyKey, remaining - 1);
      }

      throw new OutboundProviderError(
        "Mock delivery provider rejected the message for testing.",
      );
    }

    const digest = createHash("sha256")
      .update(input.idempotencyKey)
      .digest("hex")
      .slice(0, 24);

    return {
      providerMessageId: `mock-${digest}`,
      status: "sent",
    } as const;
  }
}
