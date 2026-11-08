import { z } from "zod";
import type { WhatsAppIntegrationConfig } from "./types.js";

export const WHATSAPP_ENVIRONMENT_KEYS = [
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_TEST_PHONE_NUMBER_ID",
  "WHATSAPP_TEST_WORKSPACE_ID",
] as const;

const whatsAppEnvironmentSchema = z
  .object({
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: z
      .string()
      .trim()
      .min(1, "must not be empty")
      .max(256, "must be 256 characters or fewer"),
    WHATSAPP_APP_SECRET: z
      .string()
      .trim()
      .min(16, "must contain at least 16 characters")
      .max(256, "must be 256 characters or fewer"),
    WHATSAPP_TEST_PHONE_NUMBER_ID: z
      .string()
      .trim()
      .regex(/^\d{5,32}$/, "must be a numeric Meta phone-number ID")
      .optional(),
    WHATSAPP_TEST_WORKSPACE_ID: z
      .uuid("must be the UUID of an existing ReplyPilot workspace")
      .optional(),
  })
  .superRefine((value, context) => {
    const hasPhone = Boolean(value.WHATSAPP_TEST_PHONE_NUMBER_ID);
    const hasWorkspace = Boolean(value.WHATSAPP_TEST_WORKSPACE_ID);

    if (hasPhone !== hasWorkspace) {
      context.addIssue({
        code: "custom",
        path: [
          hasPhone
            ? "WHATSAPP_TEST_WORKSPACE_ID"
            : "WHATSAPP_TEST_PHONE_NUMBER_ID",
        ],
        message:
          "the legacy single-workspace phone-number ID and workspace ID must be set together",
      });
    }
  });

/**
 * The inbound WhatsApp integration is optional so existing deployments and
 * tests can run without Meta credentials. If any WhatsApp variable is set, the
 * webhook verification token and app secret must be valid. The legacy
 * single-workspace phone-number ID/workspace pair is optional; new
 * installations resolve each event through the registered connection.
 *
 * Error messages name variables but never include their values.
 */
export function loadWhatsAppConfig(
  environment: NodeJS.ProcessEnv,
): WhatsAppIntegrationConfig | null {
  const populated = WHATSAPP_ENVIRONMENT_KEYS.filter(
    (key) => Boolean(environment[key]?.trim()),
  );

  if (populated.length === 0) {
    return null;
  }

  const result = whatsAppEnvironmentSchema.safeParse(environment);

  if (!result.success) {
    const details = [
      ...new Set(
        result.error.issues.map(
          (issue) => issue.path.join(".") || "environment",
        ),
      ),
    ].join(", ");

    throw new Error(
      `Invalid WhatsApp environment configuration: ${details}. Set the webhook verification token and app secret, plus the legacy phone-number/workspace pair if used.`,
    );
  }

  const config: WhatsAppIntegrationConfig = {
    verifyToken: result.data.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    appSecret: result.data.WHATSAPP_APP_SECRET,
  };

  if (
    result.data.WHATSAPP_TEST_PHONE_NUMBER_ID &&
    result.data.WHATSAPP_TEST_WORKSPACE_ID
  ) {
    return {
      ...config,
      phoneNumberId: result.data.WHATSAPP_TEST_PHONE_NUMBER_ID,
      workspaceId: result.data.WHATSAPP_TEST_WORKSPACE_ID,
    };
  }

  return config;
}
