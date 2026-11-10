/**
 * Server-side configuration for Meta WhatsApp Embedded Signup v4.
 *
 * The onboarding flow needs a Facebook Login for Business configuration that
 * was created with the WhatsApp Embedded Signup variation. Only the App ID and
 * Configuration ID are public; the app secret is used server-side to exchange
 * the authorization code and must never reach the browser.
 *
 * Configuration is optional. When none of the required variables are set,
 * onboarding is reported as "not configured" instead of falling back to a mock
 * success. When a partial configuration is present the server refuses to start
 * rather than silently disabling or guessing values.
 */

import { z } from "zod";
import { loadGraphApiVersion } from "../outbound/meta-config.js";
import {
  normalizeOrigin,
  resolveOnboardingOriginPolicy,
  type OnboardingOriginPolicy,
} from "./onboarding-origin.js";

export const EMBEDDED_SIGNUP_REQUIRED_ENV_KEYS = [
  "META_APP_ID",
  "META_APP_SECRET",
  "META_EMBEDDED_SIGNUP_CONFIG_ID",
] as const;

export const EMBEDDED_SIGNUP_ENV_KEYS = [
  ...EMBEDDED_SIGNUP_REQUIRED_ENV_KEYS,
  "META_GRAPH_API_VERSION",
  "META_ONBOARDING_ALLOWED_ORIGIN",
] as const;

export type EmbeddedSignupConfig = Readonly<{
  /** Public Meta App ID used by the JavaScript SDK. */
  appId: string;
  /** Server-only app secret. Never return or log this value. */
  appSecret: string;
  /** Facebook Login for Business configuration ID for Embedded Signup v4. */
  configId: string;
  /** Explicit Graph API version, for example "v27.0". */
  graphApiVersion: string;
  /** Optional public application origin allowed to run onboarding. */
  allowedOrigin: string | null;
  /** Server-side origin policy enforced on state-changing onboarding routes. */
  originPolicy: OnboardingOriginPolicy;
}>;

export type EmbeddedSignupPublicConfig = Readonly<{
  configured: boolean;
  appId: string | null;
  configId: string | null;
  graphApiVersion: string | null;
  allowedOrigin: string | null;
}>;

const numericMetaIdSchema = z
  .string()
  .trim()
  .regex(/^\d{5,32}$/, "must be a numeric Meta identifier");

const appSecretSchema = z
  .string()
  .trim()
  .min(16, "must contain at least 16 characters")
  .max(256, "must be 256 characters or fewer");

function isValidOrigin(value: string): boolean {
  const normalized = normalizeOrigin(value);
  return normalized !== null;
}

/**
 * Loads Embedded Signup configuration. Returns null only when every required
 * variable is absent. Throws on a partial or malformed configuration, or when
 * the two app-secret variables disagree, so a misconfigured deployment fails
 * closed instead of offering a broken connect button.
 */
export function loadEmbeddedSignupConfig(
  environment: NodeJS.ProcessEnv = process.env,
): EmbeddedSignupConfig | null {
  const populated = EMBEDDED_SIGNUP_REQUIRED_ENV_KEYS.filter((key) =>
    Boolean(environment[key]?.trim()),
  );

  if (populated.length === 0) {
    return null;
  }

  const missing = EMBEDDED_SIGNUP_REQUIRED_ENV_KEYS.filter(
    (key) => !environment[key]?.trim(),
  );

  if (missing.length > 0) {
    throw new Error(
      `Invalid Meta Embedded Signup configuration: ${missing.join(", ")} must be set together with META_APP_ID, META_APP_SECRET, and META_EMBEDDED_SIGNUP_CONFIG_ID.`,
    );
  }

  const appId = numericMetaIdSchema.safeParse(environment.META_APP_ID);
  const appSecret = appSecretSchema.safeParse(environment.META_APP_SECRET);
  const configId = numericMetaIdSchema.safeParse(
    environment.META_EMBEDDED_SIGNUP_CONFIG_ID,
  );

  const issues: string[] = [];

  if (!appId.success) {
    issues.push("META_APP_ID must be a numeric Meta App ID");
  }

  if (!appSecret.success) {
    issues.push(
      "META_APP_SECRET must contain at least 16 characters and at most 256",
    );
  }

  if (!configId.success) {
    issues.push(
      "META_EMBEDDED_SIGNUP_CONFIG_ID must be a numeric Facebook Login for Business configuration ID",
    );
  }

  if (issues.length > 0) {
    throw new Error(
      `Invalid Meta Embedded Signup configuration: ${issues.join("; ")}.`,
    );
  }

  // The webhook signature secret and the OAuth token-exchange secret are the
  // same Meta app secret. Silently accepting two different values would make
  // one of the two integrations fail in confusing ways.
  const whatsappAppSecret = environment.WHATSAPP_APP_SECRET?.trim();

  if (
    whatsappAppSecret &&
    appSecret.success &&
    whatsappAppSecret !== appSecret.data
  ) {
    throw new Error(
      "Invalid Meta Embedded Signup configuration: META_APP_SECRET must match WHATSAPP_APP_SECRET because both refer to the same Meta app.",
    );
  }

  const allowedOriginRaw =
    environment.META_ONBOARDING_ALLOWED_ORIGIN?.trim() || null;

  if (allowedOriginRaw && !isValidOrigin(allowedOriginRaw)) {
    throw new Error(
      "Invalid Meta Embedded Signup configuration: META_ONBOARDING_ALLOWED_ORIGIN must be an http(s) origin without a path, query, or fragment.",
    );
  }

  if (
    allowedOriginRaw &&
    environment.NODE_ENV === "production" &&
    new URL(allowedOriginRaw).protocol !== "https:"
  ) {
    throw new Error(
      "Invalid Meta Embedded Signup configuration: META_ONBOARDING_ALLOWED_ORIGIN must use https in production.",
    );
  }

  return {
    appId: appId.success ? appId.data : "",
    appSecret: appSecret.success ? appSecret.data : "",
    configId: configId.success ? configId.data : "",
    graphApiVersion: loadGraphApiVersion(environment),
    allowedOrigin: allowedOriginRaw,
    originPolicy: resolveOnboardingOriginPolicy(environment),
  };
}

/**
 * The subset safe to return to the browser. The app secret is deliberately
 * absent, and the shape is stable even when onboarding is not configured.
 */
export function toPublicEmbeddedSignupConfig(
  config: EmbeddedSignupConfig | null,
): EmbeddedSignupPublicConfig {
  if (!config) {
    return {
      configured: false,
      appId: null,
      configId: null,
      graphApiVersion: null,
      allowedOrigin: null,
    };
  }

  return {
    configured: true,
    appId: config.appId,
    configId: config.configId,
    graphApiVersion: config.graphApiVersion,
    allowedOrigin: config.allowedOrigin,
  };
}
