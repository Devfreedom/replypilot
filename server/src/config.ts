import { z } from "zod";
import {
  DEFAULT_GEMINI_FALLBACK_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_TIMEOUT_MS,
} from "./ai/reply-draft.js";
import { isValidProxyIpOrCidr } from "./auth/config.js";
import {
  loadGraphApiVersion,
  loadMetaOutboundConfig,
} from "./outbound/meta-config.js";
import { loadWhatsAppConfig } from "./whatsapp/config.js";
import {
  loadEmbeddedSignupConfig,
  type EmbeddedSignupConfig,
} from "./whatsapp/embedded-signup-config.js";
import {
  loadOnboardingRateLimitConfig,
  type OnboardingRateLimitConfig,
} from "./whatsapp/onboarding-rate-limit.js";
import type { WhatsAppIntegrationConfig } from "./whatsapp/types.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function isPostgresConnectionString(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}

function normalizeHttpOrigin(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed || /[?#]/.test(trimmed)) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.hostname.length === 0
  ) {
    return null;
  }

  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }

  return url.origin;
}

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    HOST: z.string().trim().min(1).default("127.0.0.1"),
    DATABASE_URL: z.string().refine(isPostgresConnectionString, {
      message:
        "must be a valid postgres:// or postgresql:// connection URL with a host",
    }),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, "must contain at least 32 characters"),
    BETTER_AUTH_URL: z
      .string()
      .trim()
      .refine((value) => normalizeHttpOrigin(value) !== null, {
        message:
          "must be a valid http:// or https:// origin without a path, query, or fragment",
      })
      .optional(),
    BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),
    BETTER_AUTH_TRUSTED_PROXY_CIDRS: z.string().optional(),
    GEMINI_API_KEY: z.string().trim().min(1).optional(),
    GEMINI_MODEL: z.string().trim().min(1).optional(),
    GEMINI_FALLBACK_MODEL: z.string().trim().optional(),
    GEMINI_TIMEOUT_MS: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z.coerce.number().int().min(1_000).max(300_000).optional(),
    ),
    RESEND_API_KEY: z.string().trim().min(1).optional(),
    AUTH_EMAIL_FROM: z.string().trim().min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === "production" && !value.BETTER_AUTH_URL) {
      context.addIssue({
        code: "custom",
        path: ["BETTER_AUTH_URL"],
        message: "is required in production",
      });
    }

    if (
      value.NODE_ENV === "production" &&
      value.BETTER_AUTH_URL &&
      new URL(value.BETTER_AUTH_URL).protocol !== "https:"
    ) {
      context.addIssue({
        code: "custom",
        path: ["BETTER_AUTH_URL"],
        message: "must use https in production",
      });
    }

    const hasResendKey = Boolean(value.RESEND_API_KEY);
    const hasEmailFrom = Boolean(value.AUTH_EMAIL_FROM);

    if (hasResendKey && !hasEmailFrom) {
      context.addIssue({
        code: "custom",
        path: ["AUTH_EMAIL_FROM"],
        message: "is required when RESEND_API_KEY is configured",
      });
    }

    if (hasEmailFrom && !hasResendKey) {
      context.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: "is required when AUTH_EMAIL_FROM is configured",
      });
    }

    if (value.NODE_ENV === "production" && !hasResendKey) {
      context.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: "is required in production",
      });
    }

    if (value.NODE_ENV === "production" && !hasEmailFrom) {
      context.addIssue({
        code: "custom",
        path: ["AUTH_EMAIL_FROM"],
        message: "is required in production",
      });
    }
  });

export type ServerConfig = Readonly<{
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  databaseUrl: string;
  betterAuthSecret: string;
  betterAuthUrl: string;
  trustedOrigins: string[];
  trustedProxyCidrs: string[];
  whatsapp: WhatsAppIntegrationConfig | null;
  embeddedSignup: EmbeddedSignupConfig | null;
  onboardingRateLimit: OnboardingRateLimitConfig;
  gemini: Readonly<{
    apiKey: string;
    model?: string;
    fallbackModel?: string;
    timeoutMs: number;
  }> | null;
  email: Readonly<{
    apiKey: string;
    from: string;
  }> | null;
}>;

function parseTrustedOrigins(
  value: string | undefined,
  fallback: string,
  nodeEnv: "development" | "test" | "production",
): string[] {
  const configured = (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const normalizedOrigins: string[] = [];

  for (const origin of configured) {
    const normalized = normalizeHttpOrigin(origin);

    if (!normalized) {
      throw new ConfigError(
        `Invalid server environment: BETTER_AUTH_TRUSTED_ORIGINS contains an invalid origin: ${origin}`,
      );
    }

    if (
      nodeEnv === "production" &&
      new URL(normalized).protocol !== "https:"
    ) {
      throw new ConfigError(
        `Invalid server environment: BETTER_AUTH_TRUSTED_ORIGINS must use https in production: ${origin}`,
      );
    }

    normalizedOrigins.push(normalized);
  }

  const normalizedFallback = normalizeHttpOrigin(fallback);

  if (!normalizedFallback) {
    throw new ConfigError(
      `Invalid server environment: BETTER_AUTH_URL is not a valid origin.`,
    );
  }

  return [...new Set([normalizedFallback, ...normalizedOrigins])];
}

/**
 * Parses and strictly validates the reverse proxies that are allowed to set the
 * client IP header.
 *
 * Better Auth resolves the client IP from the forwarded header itself. A proxy
 * that appends to the header produces a chain, and the chain can only be
 * resolved when the trusted proxies are known. Failing closed on malformed
 * entries avoids Better Auth silently discarding invalid proxy entries.
 */
function parseTrustedProxyCidrs(value: string | undefined): string[] {
  const configured = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of configured) {
    if (!isValidProxyIpOrCidr(entry)) {
      throw new ConfigError(
        `Invalid server environment: BETTER_AUTH_TRUSTED_PROXY_CIDRS contains an invalid IP or CIDR: ${entry}`,
      );
    }
  }

  return [...new Set(configured)];
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  try {
    loadGraphApiVersion(environment);
  } catch (error) {
    throw new ConfigError(
      `Invalid server environment: ${
        error instanceof Error ? error.message : "META_GRAPH_API_VERSION is invalid"
      }`,
    );
  }

  loadMetaOutboundConfig(environment);

  const embeddedSignup = loadEmbeddedSignupConfig(environment);
  const onboardingRateLimit = loadOnboardingRateLimitConfig(environment);

  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    const details = result.error.issues
      .map(
        (issue) =>
          `${issue.path.join(".") || "environment"}: ${issue.message}`,
      )
      .join("; ");

    throw new ConfigError(`Invalid server environment: ${details}`);
  }

  const rawBetterAuthUrl =
    result.data.BETTER_AUTH_URL ??
    (result.data.NODE_ENV === "production"
      ? ""
      : "http://localhost:3000");
  const betterAuthUrl = normalizeHttpOrigin(rawBetterAuthUrl);

  if (!betterAuthUrl) {
    throw new ConfigError(
      "Invalid server environment: BETTER_AUTH_URL must be a valid origin.",
    );
  }

  const trustedOrigins = parseTrustedOrigins(
    result.data.BETTER_AUTH_TRUSTED_ORIGINS,
    betterAuthUrl,
    result.data.NODE_ENV,
  );

  if (result.data.NODE_ENV !== "production") {
    trustedOrigins.push(
      "http://127.0.0.1:3000",
      "http://localhost:3000",
    );
  }

  const primaryGeminiModel = result.data.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const rawGeminiFallback = result.data.GEMINI_FALLBACK_MODEL;
  const geminiFallbackModel =
    rawGeminiFallback === undefined
      ? primaryGeminiModel !== DEFAULT_GEMINI_FALLBACK_MODEL
        ? DEFAULT_GEMINI_FALLBACK_MODEL
        : undefined
      : rawGeminiFallback.length > 0 && rawGeminiFallback !== primaryGeminiModel
        ? rawGeminiFallback
        : undefined;

  return {
    nodeEnv: result.data.NODE_ENV,
    port: result.data.PORT,
    host: result.data.HOST,
    databaseUrl: result.data.DATABASE_URL,
    betterAuthSecret: result.data.BETTER_AUTH_SECRET,
    betterAuthUrl,
    trustedOrigins: [...new Set(trustedOrigins)],
    trustedProxyCidrs: parseTrustedProxyCidrs(
      result.data.BETTER_AUTH_TRUSTED_PROXY_CIDRS,
    ),
    whatsapp: loadWhatsAppConfig(environment),
    embeddedSignup,
    onboardingRateLimit,
    gemini: result.data.GEMINI_API_KEY
      ? {
        apiKey: result.data.GEMINI_API_KEY,
        ...(result.data.GEMINI_MODEL
          ? { model: result.data.GEMINI_MODEL }
          : {}),
        ...(geminiFallbackModel ? { fallbackModel: geminiFallbackModel } : {}),
        timeoutMs: result.data.GEMINI_TIMEOUT_MS ?? DEFAULT_GEMINI_TIMEOUT_MS,
      }
      : null,
    email:
      result.data.RESEND_API_KEY && result.data.AUTH_EMAIL_FROM
        ? {
            apiKey: result.data.RESEND_API_KEY,
            from: result.data.AUTH_EMAIL_FROM,
          }
        : null,
  };
}
