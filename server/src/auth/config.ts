import { randomUUID } from "node:crypto";
import { BlockList, isIP } from "node:net";
import { betterAuth } from "better-auth";
import type { Pool } from "pg";
import { ensureWorkspaceForUser } from "../workspaces/repository.js";

/**
 * Validates that an entry is a syntactically valid IPv4/IPv6 address or CIDR
 * block (`ip/prefix` with `0..32` for IPv4 or `0..128` for IPv6).
 */
export function isValidProxyIpOrCidr(entry: string): boolean {
  if (!entry) {
    return false;
  }

  const slashIndex = entry.indexOf("/");

  if (slashIndex === -1) {
    return isIP(entry) === 4 || isIP(entry) === 6;
  }

  const parts = entry.split("/");

  if (parts.length !== 2) {
    return false;
  }

  const [ip, prefixText] = parts;

  if (!ip || !prefixText || !/^(?:0|[1-9][0-9]*)$/.test(prefixText)) {
    return false;
  }

  const family = isIP(ip);

  if (family === 0) {
    return false;
  }

  const prefix = Number(prefixText);

  if (family === 4) {
    return prefix >= 0 && prefix <= 32;
  }

  return prefix >= 0 && prefix <= 128;
}

/**
 * Normalizes an IPv4, IPv6, or IPv4-mapped IPv6 (`::ffff:a.b.c.d`) address.
 * Returns null if the input is empty or not a valid IP address.
 */
export function normalizeIpAddress(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed || isIP(trimmed) === 0) {
    return null;
  }

  if (trimmed.toLowerCase().startsWith("::ffff:")) {
    const ipv4 = trimmed.slice(7);
    if (isIP(ipv4) === 4) {
      return ipv4;
    }
  }

  return trimmed.toLowerCase();
}

/**
 * Compiles validated IP/CIDR entries into an IP-matching predicate backed by
 * Node's `net.BlockList`. Fails closed on any malformed entry.
 */
export function createTrustedProxyMatcher(
  entries: readonly string[],
): (ip: string) => boolean {
  const blockList = new BlockList();

  for (const rawEntry of entries) {
    const entry = rawEntry.trim();

    if (!entry) {
      continue;
    }

    if (!isValidProxyIpOrCidr(entry)) {
      throw new Error(
        `Invalid trusted proxy IP or CIDR in auth config: ${entry}`,
      );
    }

    const slashIndex = entry.indexOf("/");

    if (slashIndex === -1) {
      const normalized = normalizeIpAddress(entry);
      if (!normalized) {
        throw new Error(
          `Invalid trusted proxy IP or CIDR in auth config: ${entry}`,
        );
      }
      const family = isIP(normalized) === 4 ? "ipv4" : "ipv6";
      blockList.addAddress(normalized, family);
      continue;
    }

    const ip = entry.slice(0, slashIndex);
    const prefix = Number(entry.slice(slashIndex + 1));
    const normalized = normalizeIpAddress(ip);

    if (!normalized) {
      throw new Error(
        `Invalid trusted proxy IP or CIDR in auth config: ${entry}`,
      );
    }

    const family = isIP(normalized) === 4 ? "ipv4" : "ipv6";
    // If an IPv4-mapped CIDR was normalized to IPv4, only valid IPv4 prefixes apply;
    // isValidProxyIpOrCidr already validated prefix against the raw address family.
    if (isIP(ip) === 6 && family === "ipv4") {
      blockList.addAddress(normalized, "ipv4");
    } else {
      blockList.addSubnet(normalized, prefix, family);
    }
  }

  return (ip: string): boolean => {
    const normalized = normalizeIpAddress(ip);

    if (!normalized) {
      return false;
    }

    const family = isIP(normalized) === 4 ? "ipv4" : "ipv6";
    return blockList.check(normalized, family);
  };
}

export type AuthRateLimitOptions = Readonly<{
  enabled?: boolean;
  window?: number;
  max?: number;
}>;

export const AUTH_MIN_PASSWORD_LENGTH = 8;
export const AUTH_MAX_PASSWORD_LENGTH = 128;
export const AUTH_RESET_TOKEN_EXPIRES_IN_SECONDS = 900;

export type PasswordResetEmailPayload = Readonly<{
  user: Readonly<{ id: string; email: string; name: string }>;
  url: string;
  token: string;
}>;

export type SendResetPasswordEmailHook = (
  data: PasswordResetEmailPayload,
) => Promise<void> | void;

export type SendResetPasswordEmail = SendResetPasswordEmailHook;

export type CreateAuthOptions = Readonly<{
  pool: Pool;
  secret: string;
  baseURL?: string;
  trustedOrigins: string[];
  rateLimit?: AuthRateLimitOptions;
  nodeEnv?: "development" | "test" | "production";
  sendResetPasswordEmail?: SendResetPasswordEmailHook;
  /**
   * CIDR ranges of proxies that are allowed to set the client IP header.
   *
   * Better Auth resolves the client IP itself, and it can only do so when the
   * forwarded header carries exactly one address, or when the proxies that may
   * append to it are known. Without this list every client shares one
   * rate-limit bucket per path behind a proxy.
   */
  trustedProxyCidrs?: string[];
  /**
   * Set by `createApp` when the Express client-IP normalization middleware has
   * already verified `trustedProxyCidrs` and rewritten `X-Forwarded-For` to a
   * single resolved client IP (including normalized socket-IP fallbacks).
   */
  clientIpNormalizedByApp?: boolean;
}>;

export function createAuth({
  pool,
  secret,
  baseURL,
  trustedOrigins,
  rateLimit,
  nodeEnv = "development",
  sendResetPasswordEmail,
  trustedProxyCidrs,
  clientIpNormalizedByApp = false,
}: CreateAuthOptions) {
  const trustedProxies = [
    ...new Set((trustedProxyCidrs ?? []).map((entry) => entry.trim())),
  ].filter(Boolean);

  for (const entry of trustedProxies) {
    if (!isValidProxyIpOrCidr(entry)) {
      throw new Error(
        `Invalid trusted proxy IP or CIDR in auth config: ${entry}`,
      );
    }
  }

  return betterAuth({
    appName: "ReplyPilot",
    secret,
    ...(baseURL ? { baseURL } : {}),
    trustedOrigins,
    database: pool,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: AUTH_MIN_PASSWORD_LENGTH,
      maxPasswordLength: AUTH_MAX_PASSWORD_LENGTH,
      requireEmailVerification: false,
      resetPasswordTokenExpiresIn: AUTH_RESET_TOKEN_EXPIRES_IN_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url, token }) => {
        if (sendResetPasswordEmail) {
          await sendResetPasswordEmail({
            user: { id: user.id, email: user.email, name: user.name },
            url,
            token,
          });
          return;
        }

        // Never log tokens, reset links, or user emails in production or test logs.
        if (nodeEnv === "development") {
          console.info(
            `[dev-only] Password reset link (expires in ${AUTH_RESET_TOKEN_EXPIRES_IN_SECONDS / 60}m): ${url}`,
          );
          return;
        }

        if (nodeEnv === "production") {
          console.warn(
            "Password reset requested, but no production email delivery provider is configured.",
          );
        }
      },
    },
    rateLimit: {
      enabled: rateLimit?.enabled ?? true,
      window: rateLimit?.window ?? 60,
      max: rateLimit?.max ?? 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 3 },
        "/reset-password": { window: 60, max: 5 },
      },
    },
    advanced: {
      // The Secure attribute is left to Better Auth, which derives it from the
      // base URL protocol and falls back to NODE_ENV when there is no base URL.
      // Overriding it with a NODE_ENV check would strip Secure from HTTPS
      // deployments that do not set NODE_ENV=production.
      ...(!clientIpNormalizedByApp && trustedProxies.length > 0
        ? { ipAddress: { trustedProxies } }
        : {}),
      database: {
        generateId: () => randomUUID(),
      },
    },
    user: {
      modelName: "auth_users",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    session: {
      modelName: "auth_sessions",
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        userId: "user_id",
      },
    },
    account: {
      modelName: "auth_accounts",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "auth_verifications",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            try {
              await ensureWorkspaceForUser(pool, {
                id: user.id,
                name: user.name,
                email: user.email,
              });
            } catch {
              // A user can still sign in if workspace initialization failed.
              // The first authenticated private request attempts recovery.
              console.error(
                "Failed to initialize a workspace for a newly registered account.",
              );
            }
          },
        },
      },
    },
  });
}

export type AuthInstance = ReturnType<typeof createAuth>;
