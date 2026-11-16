import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
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

export type AuthRateLimitOptions = Readonly<{
  enabled?: boolean;
  window?: number;
  max?: number;
}>;

export type CreateAuthOptions = Readonly<{
  pool: Pool;
  secret: string;
  baseURL?: string;
  trustedOrigins: string[];
  rateLimit?: AuthRateLimitOptions;
  /**
   * CIDR ranges of proxies that are allowed to set the client IP header.
   *
   * Better Auth resolves the client IP itself, and it can only do so when the
   * forwarded header carries exactly one address, or when the proxies that may
   * append to it are known. Without this list every client shares one
   * rate-limit bucket per path behind a proxy.
   */
  trustedProxyCidrs?: string[];
}>;

export function createAuth({
  pool,
  secret,
  baseURL,
  trustedOrigins,
  rateLimit,
  trustedProxyCidrs,
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
      minPasswordLength: 8,
      maxPasswordLength: 128,
      requireEmailVerification: false,
    },
    rateLimit: {
      enabled: rateLimit?.enabled ?? true,
      window: rateLimit?.window ?? 60,
      max: rateLimit?.max ?? 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    advanced: {
      // The Secure attribute is left to Better Auth, which derives it from the
      // base URL protocol and falls back to NODE_ENV when there is no base URL.
      // Overriding it with a NODE_ENV check would strip Secure from HTTPS
      // deployments that do not set NODE_ENV=production.
      ...(trustedProxies.length > 0
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
