/**
 * Rate limiting for the WhatsApp onboarding endpoints.
 *
 * Session creation, completion, and verification are the only routes that can
 * spend Meta API calls or create credentials, so they share one fixed-window
 * budget per authenticated user and workspace. The limiter is deliberately
 * small and dependency-free, matching the project's existing approach of
 * validating configuration at start-up and failing closed.
 *
 * The counters live in the API process. That is consistent with the current
 * single-process deployment, but a shared store is required before running
 * several API instances. See the README limitations.
 */

import type { RequestHandler, Response } from "express";

export const ONBOARDING_RATE_LIMIT_ENV_KEYS = [
  "WHATSAPP_ONBOARDING_RATE_LIMIT_WINDOW_SECONDS",
  "WHATSAPP_ONBOARDING_RATE_LIMIT_MAX",
] as const;

export const DEFAULT_ONBOARDING_RATE_LIMIT_WINDOW_SECONDS = 60;
export const DEFAULT_ONBOARDING_RATE_LIMIT_MAX = 20;

const MAX_WINDOW_SECONDS = 3_600;
const MAX_REQUESTS = 1_000;

export type OnboardingRateLimitConfig = Readonly<{
  windowMs: number;
  max: number;
}>;

/**
 * Loads and validates the onboarding rate-limit configuration. Invalid values
 * stop the server instead of silently disabling the limit.
 */
export function loadOnboardingRateLimitConfig(
  environment: NodeJS.ProcessEnv = process.env,
): OnboardingRateLimitConfig {
  const windowRaw =
    environment.WHATSAPP_ONBOARDING_RATE_LIMIT_WINDOW_SECONDS?.trim();
  const maxRaw = environment.WHATSAPP_ONBOARDING_RATE_LIMIT_MAX?.trim();

  const windowSeconds = windowRaw
    ? Number(windowRaw)
    : DEFAULT_ONBOARDING_RATE_LIMIT_WINDOW_SECONDS;
  const max = maxRaw ? Number(maxRaw) : DEFAULT_ONBOARDING_RATE_LIMIT_MAX;

  if (
    !Number.isInteger(windowSeconds) ||
    windowSeconds < 1 ||
    windowSeconds > MAX_WINDOW_SECONDS
  ) {
    throw new Error(
      `WHATSAPP_ONBOARDING_RATE_LIMIT_WINDOW_SECONDS must be an integer between 1 and ${MAX_WINDOW_SECONDS}.`,
    );
  }

  if (!Number.isInteger(max) || max < 1 || max > MAX_REQUESTS) {
    throw new Error(
      `WHATSAPP_ONBOARDING_RATE_LIMIT_MAX must be an integer between 1 and ${MAX_REQUESTS}.`,
    );
  }

  return { windowMs: windowSeconds * 1_000, max };
}

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export type OnboardingRateLimiter = Readonly<{
  middleware: RequestHandler;
  reset(): void;
}>;

/**
 * Creates a fixed-window limiter. One limiter instance belongs to one router,
 * so counters never leak between API instances or between tests.
 */
export function createOnboardingRateLimiter(
  options: Readonly<{
    config: OnboardingRateLimitConfig;
    now?: () => number;
  }>,
): OnboardingRateLimiter {
  const { config } = options;
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, RateLimitEntry>();

  function prune(currentTime: number): void {
    for (const [key, entry] of entries) {
      if (entry.resetAt <= currentTime) {
        entries.delete(key);
      }
    }
  }

  function keyFor(request: Parameters<RequestHandler>[0], response: Response): string {
    const auth = response.locals.auth as
      | { user?: { id?: string }; workspace?: { id?: string } }
      | undefined;
    const workspaceId = auth?.workspace?.id ?? "unknown";
    const userId = auth?.user?.id ?? request.ip ?? "unknown";
    return `${workspaceId}:${userId}`;
  }

  const middleware: RequestHandler = (request, response, next) => {
    const currentTime = now();
    const key = keyFor(request, response);
    const entry = entries.get(key);

    if (!entry || entry.resetAt <= currentTime) {
      if (entries.size > 1_000) {
        prune(currentTime);
      }

      entries.set(key, { count: 1, resetAt: currentTime + config.windowMs });
      next();
      return;
    }

    if (entry.count >= config.max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((entry.resetAt - currentTime) / 1_000),
      );
      response.setHeader("Retry-After", String(retryAfterSeconds));
      response.status(429).json({
        error:
          "Too many WhatsApp onboarding requests. Wait a moment before trying again.",
        code: "rate_limited",
      });
      return;
    }

    entry.count += 1;
    next();
  };

  return {
    middleware,
    reset() {
      entries.clear();
    },
  };
}
