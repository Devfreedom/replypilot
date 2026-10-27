import { z } from "zod";

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

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    DATABASE_URL: z.string().refine(isPostgresConnectionString, {
      message:
        "must be a valid postgres:// or postgresql:// connection URL with a host",
    }),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32, "must contain at least 32 characters"),
    BETTER_AUTH_URL: z
      .string()
      .refine(isHttpUrl, {
        message: "must be a valid http:// or https:// URL",
      })
      .optional(),
    BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),
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
  });

export type ServerConfig = Readonly<{
  nodeEnv: "development" | "test" | "production";
  port: number;
  databaseUrl: string;
  betterAuthSecret: string;
  betterAuthUrl: string;
  trustedOrigins: string[];
}>;

function parseTrustedOrigins(
  value: string | undefined,
  fallback: string,
): string[] {
  const configured = (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  for (const origin of configured) {
    if (!isHttpUrl(origin)) {
      throw new Error(
        `BETTER_AUTH_TRUSTED_ORIGINS contains an invalid origin: ${origin}`,
      );
    }
  }

  return [...new Set([fallback, ...configured])];
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    const details = result.error.issues
      .map(
        (issue) =>
          `${issue.path.join(".") || "environment"}: ${issue.message}`,
      )
      .join("; ");

    throw new Error(`Invalid server environment: ${details}`);
  }

  const betterAuthUrl =
    result.data.BETTER_AUTH_URL ??
    (result.data.NODE_ENV === "production"
      ? ""
      : "http://localhost:3000");
  const trustedOrigins = parseTrustedOrigins(
    result.data.BETTER_AUTH_TRUSTED_ORIGINS,
    betterAuthUrl,
  );

  if (result.data.NODE_ENV !== "production") {
    trustedOrigins.push(
      "http://127.0.0.1:3000",
      "http://localhost:3000",
    );
  }

  return {
    nodeEnv: result.data.NODE_ENV,
    port: result.data.PORT,
    databaseUrl: result.data.DATABASE_URL,
    betterAuthSecret: result.data.BETTER_AUTH_SECRET,
    betterAuthUrl,
    trustedOrigins: [...new Set(trustedOrigins)],
  };
}
