/**
 * Minimal Meta Graph API client for Embedded Signup onboarding.
 *
 * Only the calls needed to validate an onboarding result are implemented:
 * authorization-code exchange, token inspection, WABA/phone-number access
 * checks, and webhook subscription. Access tokens travel in the Authorization
 * header (never a URL), responses are parsed defensively, and error messages
 * are redacted before they can reach logs or API responses.
 */

const DEFAULT_BASE_URL = "https://graph.facebook.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_DESCRIPTION_LENGTH = 300;

export type MetaGraphErrorKind =
  | "rejected"
  | "unavailable"
  | "invalid_response";

export class MetaGraphError extends Error {
  readonly kind: MetaGraphErrorKind;
  readonly status: number | null;

  constructor(
    message: string,
    kind: MetaGraphErrorKind,
    status: number | null = null,
  ) {
    super(message);
    this.name = "MetaGraphError";
    this.kind = kind;
    this.status = status;
  }
}

export type MetaGraphClientOptions = Readonly<{
  appId: string;
  appSecret: string;
  graphApiVersion: string;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
}>;

export type MetaTokenInspection = Readonly<{
  isValid: boolean;
  appId: string | null;
  scopes: readonly string[];
  granularTargetIds: Readonly<Record<string, readonly string[]>>;
  expiresAt: Date | null;
}>;

export type MetaWaba = Readonly<{
  id: string;
  name: string | null;
}>;

export type MetaPhoneNumber = Readonly<{
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
}>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((entry) => asString(entry))
        .filter((entry): entry is string => entry !== null)
    : [];
}

function truncate(value: string): string {
  return value.length <= MAX_DESCRIPTION_LENGTH
    ? value
    : `${value.slice(0, MAX_DESCRIPTION_LENGTH)}…`;
}

/**
 * Builds a human-readable Meta error description without request URLs,
 * tokens, or codes. Any configured secret that somehow appears in Meta's
 * response is replaced before the text leaves this module.
 */
function describeMetaError(data: unknown, secrets: readonly string[]): string {
  const record = asRecord(data);
  const error = record ? asRecord(record.error) : null;
  const message = error ? asString(error.message) : null;
  const code = error ? error.code : null;
  const codeText =
    typeof code === "number" || typeof code === "string"
      ? ` (code ${String(code)})`
      : "";

  let description = message
    ? `Meta API error${codeText}: ${message}`
    : `Meta API error${codeText}`;

  for (const secret of secrets) {
    if (secret) {
      description = description.split(secret).join("[redacted]");
    }
  }

  return truncate(description);
}

export class MetaGraphClient {
  readonly #appId: string;
  readonly #appSecret: string;
  readonly #graphApiVersion: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #baseUrl: string;

  constructor(options: MetaGraphClientOptions) {
    this.#appId = options.appId;
    this.#appSecret = options.appSecret;
    this.#graphApiVersion = options.graphApiVersion;
    this.#fetch = options.fetchImplementation ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  async exchangeCode(
    code: string,
  ): Promise<Readonly<{ accessToken: string; expiresAt: Date | null }>> {
    const data = await this.#requestJson("oauth/access_token", {
      query: {
        client_id: this.#appId,
        client_secret: this.#appSecret,
        code,
      },
    });
    const record = asRecord(data);
    const accessToken = record ? asString(record.access_token) : null;

    if (!accessToken) {
      throw new MetaGraphError(
        "Meta returned an authorization-code response without an access token.",
        "invalid_response",
      );
    }

    const expiresIn = record?.expires_in;
    const expiresAt =
      typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1_000)
        : null;

    return { accessToken, expiresAt };
  }

  async debugToken(accessToken: string): Promise<MetaTokenInspection> {
    const data = await this.#requestJson("debug_token", {
      accessToken: `${this.#appId}|${this.#appSecret}`,
      query: { input_token: accessToken },
    });
    const record = asRecord(data);
    const token = record ? asRecord(record.data) : null;

    if (!token || typeof token.is_valid !== "boolean") {
      throw new MetaGraphError(
        "Meta returned an unexpected token-inspection response.",
        "invalid_response",
      );
    }

    const granularTargetIds: Record<string, string[]> = {};

    if (Array.isArray(token.granular_scopes)) {
      for (const entry of token.granular_scopes) {
        const scope = asRecord(entry);
        const name = scope ? asString(scope.scope) : null;

        if (name) {
          granularTargetIds[name] = asStringArray(scope?.target_ids);
        }
      }
    }

    const expiresAtRaw = token.expires_at;
    const expiresAt =
      typeof expiresAtRaw === "number" &&
      Number.isFinite(expiresAtRaw) &&
      expiresAtRaw > 0
        ? new Date(expiresAtRaw * 1_000)
        : null;

    return {
      isValid: token.is_valid,
      appId: asString(token.app_id),
      scopes: asStringArray(token.scopes),
      granularTargetIds,
      expiresAt,
    };
  }

  async getWaba(accessToken: string, wabaId: string): Promise<MetaWaba> {
    const data = await this.#requestJson(wabaId, {
      accessToken,
      query: { fields: "id,name" },
    });
    const record = asRecord(data);
    const id = record ? asString(record.id) : null;

    if (!id || id !== wabaId) {
      throw new MetaGraphError(
        "Meta returned an unexpected Messaging account response.",
        "invalid_response",
      );
    }

    return { id, name: record ? asString(record.name) : null };
  }

  async listPhoneNumbers(
    accessToken: string,
    wabaId: string,
  ): Promise<MetaPhoneNumber[]> {
    const data = await this.#requestJson(`${wabaId}/phone_numbers`, {
      accessToken,
      query: { fields: "id,display_phone_number,verified_name" },
    });
    const record = asRecord(data);
    const entries = record && Array.isArray(record.data) ? record.data : null;

    if (!entries) {
      throw new MetaGraphError(
        "Meta returned an unexpected phone-number list response.",
        "invalid_response",
      );
    }

    return entries.flatMap((entry) => {
      const phone = asRecord(entry);
      const id = phone ? asString(phone.id) : null;

      return id
        ? [
            {
              id,
              displayPhoneNumber: asString(phone?.display_phone_number),
              verifiedName: asString(phone?.verified_name),
            },
          ]
        : [];
    });
  }

  async subscribeApp(accessToken: string, wabaId: string): Promise<void> {
    await this.#requestJson(`${wabaId}/subscribed_apps`, {
      method: "POST",
      accessToken,
    });
  }

  async listSubscribedAppIds(
    accessToken: string,
    wabaId: string,
  ): Promise<string[]> {
    const data = await this.#requestJson(`${wabaId}/subscribed_apps`, {
      accessToken,
    });
    const record = asRecord(data);
    const entries = record && Array.isArray(record.data) ? record.data : null;

    if (!entries) {
      throw new MetaGraphError(
        "Meta returned an unexpected subscribed-apps response.",
        "invalid_response",
      );
    }

    return entries.flatMap((entry) => {
      const item = asRecord(entry);
      const apiData = item ? asRecord(item.whatsapp_business_api_data) : null;
      const id = asString(apiData?.id) ?? (item ? asString(item.id) : null);
      return id ? [id] : [];
    });
  }

  async #requestJson(
    path: string,
    options: Readonly<{
      method?: "GET" | "POST";
      accessToken?: string;
      query?: Record<string, string>;
    }> = {},
  ): Promise<unknown> {
    const url = new URL(
      `${this.#baseUrl}/${this.#graphApiVersion}/${path.replace(/^\/+/, "")}`,
    );

    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const headers = new Headers({ accept: "application/json" });

    if (options.accessToken) {
      headers.set("authorization", `Bearer ${options.accessToken}`);
    }

    let response: Response;

    try {
      response = await this.#fetch(url.toString(), {
        method: options.method ?? "GET",
        headers,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw new MetaGraphError(
        "Meta Graph API could not be reached. Check the network and Meta service status, then retry.",
        "unavailable",
      );
    }

    let data: unknown;

    try {
      data = (await response.json()) as unknown;
    } catch {
      throw new MetaGraphError(
        `Meta Graph API returned a non-JSON response (HTTP ${response.status}).`,
        response.ok ? "invalid_response" : "rejected",
        response.status,
      );
    }

    if (!response.ok) {
      throw new MetaGraphError(
        describeMetaError(data, [this.#appSecret]),
        "rejected",
        response.status,
      );
    }

    return data;
  }
}

export function createMetaGraphClient(
  config: Readonly<{
    appId: string;
    appSecret: string;
    graphApiVersion: string;
  }>,
  fetchImplementation?: typeof fetch,
  options: Readonly<{ timeoutMs?: number; baseUrl?: string }> = {},
): MetaGraphClient {
  return new MetaGraphClient({
    appId: config.appId,
    appSecret: config.appSecret,
    graphApiVersion: config.graphApiVersion,
    fetchImplementation,
    timeoutMs: options.timeoutMs,
    baseUrl: options.baseUrl,
  });
}
