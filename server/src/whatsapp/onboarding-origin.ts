/**
 * Request-origin policy for the WhatsApp onboarding endpoints.
 *
 * Onboarding creates a credential-bearing connection, so the requests that
 * start or complete it are restricted to the application origin that the
 * deployment declares. The policy is server-side and fail-closed:
 *
 *  - A configured `META_ONBOARDING_ALLOWED_ORIGIN` is the only accepted
 *    origin. Anything else, including a missing `Origin` header, is rejected.
 *  - In production an origin must be configured. Without one, every onboarding
 *    request is rejected instead of falling back to a permissive default.
 *  - Outside production the loopback application origin is accepted so local
 *    development keeps working without weakening the production check.
 *
 * The value is compared after normalisation, so `https://App.Example.com` and
 * `https://app.example.com` are the same origin, while a different scheme,
 * host, or port is not.
 */

export const DEVELOPMENT_ONBOARDING_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
] as const;

export type OnboardingOriginPolicy = Readonly<{
  /** The single configured application origin, when one is set. */
  allowedOrigin: string | null;
  /** True when the deployment must configure an explicit origin. */
  requireExplicitOrigin: boolean;
  /** Origins accepted when no explicit origin is configured. */
  developmentFallbackOrigins: readonly string[];
}>;

/**
 * Normalises an origin to `scheme://host[:port]`. Returns null for anything
 * that is not a plain HTTP(S) origin, including the opaque "null" origin.
 */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  if (url.pathname !== "/" && url.pathname !== "") {
    return null;
  }

  if (url.search || url.hash || url.username || url.password) {
    return null;
  }

  // The URL parser removes a default port, so `https://x:443` and `http://x:80`
  // normalise to the same value as their port-less form.
  const port = url.port ? `:${url.port}` : "";
  return `${url.protocol}//${url.hostname.toLowerCase()}${port}`;
}

export function resolveOnboardingOriginPolicy(
  environment: NodeJS.ProcessEnv = process.env,
): OnboardingOriginPolicy {
  const allowedOrigin =
    environment.META_ONBOARDING_ALLOWED_ORIGIN?.trim() || null;

  const fallback = environment.BETTER_AUTH_URL?.trim();

  const developmentFallbackOrigins = fallback
    ? [fallback, ...DEVELOPMENT_ONBOARDING_ORIGINS]
    : [...DEVELOPMENT_ONBOARDING_ORIGINS];

  return {
    allowedOrigin,
    requireExplicitOrigin: environment.NODE_ENV === "production",
    developmentFallbackOrigins: [...new Set(developmentFallbackOrigins)],
  };
}

/**
 * Decides whether a request origin may perform an onboarding action.
 * A missing or malformed origin is always rejected.
 */
export function isOnboardingOriginAllowed(
  policy: OnboardingOriginPolicy,
  origin: string | null | undefined,
): boolean {
  const normalized = normalizeOrigin(origin);

  if (!normalized) {
    return false;
  }

  if (policy.allowedOrigin) {
    const allowed = normalizeOrigin(policy.allowedOrigin);
    return allowed !== null && allowed === normalized;
  }

  if (policy.requireExplicitOrigin) {
    return false;
  }

  return policy.developmentFallbackOrigins.some(
    (candidate) => normalizeOrigin(candidate) === normalized,
  );
}

/**
 * Explains why an origin was rejected. The message never echoes a value the
 * caller supplied.
 */
export function describeOnboardingOriginRejection(
  policy: OnboardingOriginPolicy,
): string {
  if (!policy.allowedOrigin && policy.requireExplicitOrigin) {
    return "WhatsApp onboarding is disabled because this server has no configured application origin. Set META_ONBOARDING_ALLOWED_ORIGIN and restart the API.";
  }

  return "This request did not come from the configured application origin.";
}
