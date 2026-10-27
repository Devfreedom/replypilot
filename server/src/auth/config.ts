import { betterAuth } from "better-auth";
import type { Pool } from "pg";
import { ensureWorkspaceForUser } from "../workspaces/repository.js";

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
}>;

export type AuthInstance = ReturnType<typeof createAuth>;

export function createAuth({
  pool,
  secret,
  baseURL,
  trustedOrigins,
  rateLimit,
}: CreateAuthOptions): AuthInstance {
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
    },
    advanced: {
      database: {
        generateId: "uuid",
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
