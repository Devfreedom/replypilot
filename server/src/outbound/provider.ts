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
  /** Fail every attempt. Useful for bounded-retry and permanent-failure tests. */
  failAll?: boolean;
}>;

/**
 * Deterministic development provider. It never contacts WhatsApp or any other
 * external service. The same idempotency key always produces the same provider
 * message ID, so retries and stale-claim recovery are safe.
 */
export class MockOutboundMessageProvider implements OutboundMessageProvider {
  readonly name = "mock";
  readonly idempotency = "guaranteed" as const;
  private readonly failures = new Map<string, number>();
  private readonly failAll: boolean;

  constructor(options: MockOutboundMessageProviderOptions = {}) {
    this.failAll = options.failAll ?? false;

    if (options.failures) {
      const entries =
        options.failures instanceof Map
          ? options.failures.entries()
          : Object.entries(options.failures);

      for (const [key, count] of entries) {
        if (Number.isInteger(count) && count > 0) {
          this.failures.set(key, count);
        }
      }
    }
  }

  async send(
    input: OutboundProviderSendInput,
  ): Promise<OutboundProviderSendResult> {
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
