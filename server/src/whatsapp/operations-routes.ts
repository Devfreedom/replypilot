import { Router, type Response } from "express";
import type { Pool } from "pg";
import { z, type ZodError } from "zod";
import type { AuthInstance } from "../auth/config.js";
import {
  createRequireWorkspace,
  getAuthContext,
} from "../auth/middleware.js";
import {
  isWorkspaceAllowedForMetaSending,
  loadMetaOutboundConfig,
  resolveOutboundProviderName,
} from "../outbound/meta-config.js";
import { getConnectionCapabilities } from "./connections.js";
import { getWorkspaceMessagingSettings } from "../settings/messaging-repository.js";
import {
  getConversationProtection,
  getProtectedCustomer,
  listCustomerSuppressions,
  listDeliveryEvents,
} from "./operations-repository.js";
import {
  suppressCustomer,
  unsuppressCustomer,
  type SuppressionReason,
} from "./suppression.js";
import type { WhatsAppIntegrationConfig } from "./types.js";

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;
const MAX_OFFSET = 1_000_000;
const SUPPRESSION_REASONS = ["opt_out", "blocked", "admin"] as const;

const customerIdSchema = z.uuid();
const conversationIdSchema = z.uuid();

const deliveryEventsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    offset: z.coerce.number().int().min(0).max(MAX_OFFSET).default(0),
    outcome: z.enum(["processing", "processed", "ignored", "failed"]).optional(),
    outboundMessageId: z.uuid().optional(),
  })
  .strict();

const suppressCustomerSchema = z
  .object({
    reason: z.enum(SUPPRESSION_REASONS).default("admin"),
    notes: z
      .string()
      .trim()
      .max(500, "notes must be 500 characters or fewer")
      .optional(),
  })
  .strict();

function sendValidationError(
  response: Response,
  error: ZodError,
  fieldPrefix = "",
): void {
  response.status(400).json({
    error: "Invalid request",
    details: error.issues.map((issue) => ({
      field:
        [fieldPrefix, ...issue.path.map(String)].filter(Boolean).join(".") ||
        "body",
      message: issue.message,
    })),
  });
}

function pagination(limit: number, offset: number, hasMore: boolean, count: number) {
  return {
    limit,
    offset,
    hasMore,
    nextOffset: hasMore ? offset + count : null,
  };
}

/**
 * Read and owner-controlled protection APIs for the delivery dashboard.
 *
 * Every query is scoped to the authenticated workspace. Provider credentials
 * are never returned: the summary contains only booleans, counts, and
 * non-secret Meta identifiers already documented as safe to display.
 */
export function createWhatsAppOperationsRouter({
  pool,
  auth,
  whatsapp = null,
}: {
  pool: Pool;
  auth: AuthInstance;
  whatsapp?: WhatsAppIntegrationConfig | null;
}): Router {
  const router = Router();
  const requireMember = createRequireWorkspace({
    auth,
    pool,
    roles: ["owner", "member"],
  });
  const requireOwner = createRequireWorkspace({
    auth,
    pool,
    roles: ["owner"],
  });

  router.get("/suppressions", requireMember, async (_request, response) => {
    const { workspace } = getAuthContext(response);
    const suppressions = await listCustomerSuppressions(pool, workspace.id);
    response.status(200).json({
      suppressions,
      total: suppressions.length,
    });
  });

  router.put(
    "/customers/:customerId/suppression",
    requireOwner,
    async (request, response) => {
      const customerId = customerIdSchema.safeParse(
        request.params.customerId,
      );

      if (!customerId.success) {
        sendValidationError(response, customerId.error, "customerId");
        return;
      }

      const parsed = suppressCustomerSchema.safeParse(request.body ?? {});

      if (!parsed.success) {
        sendValidationError(response, parsed.error);
        return;
      }

      const { workspace, user } = getAuthContext(response);
      const customer = await getProtectedCustomer(
        pool,
        workspace.id,
        customerId.data,
      );

      if (!customer) {
        response.status(404).json({ error: "Customer not found" });
        return;
      }

      const suppression = await suppressCustomer(pool, {
        workspaceId: workspace.id,
        customerId: customer.id,
        reason: parsed.data.reason as SuppressionReason,
        notes: parsed.data.notes ?? null,
        suppressedBy: user.id,
      });

      response.status(200).json({ suppression, customer });
    },
  );

  router.delete(
    "/customers/:customerId/suppression",
    requireOwner,
    async (request, response) => {
      const customerId = customerIdSchema.safeParse(
        request.params.customerId,
      );

      if (!customerId.success) {
        sendValidationError(response, customerId.error, "customerId");
        return;
      }

      const { workspace } = getAuthContext(response);
      const customer = await getProtectedCustomer(
        pool,
        workspace.id,
        customerId.data,
      );

      if (!customer) {
        response.status(404).json({ error: "Customer not found" });
        return;
      }

      const removed = await unsuppressCustomer(
        pool,
        workspace.id,
        customer.id,
      );

      response.status(200).json({ removed, customer });
    },
  );

  router.get("/delivery-events", requireMember, async (request, response) => {
    const parsed = deliveryEventsQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      sendValidationError(response, parsed.error);
      return;
    }

    const { workspace } = getAuthContext(response);
    const { limit, offset, outcome, outboundMessageId } = parsed.data;
    const result = await listDeliveryEvents(pool, workspace.id, {
      limit,
      offset,
      outcome,
      outboundMessageId,
    });

    response.status(200).json({
      events: result.events,
      pagination: pagination(
        limit,
        offset,
        result.hasMore,
        result.events.length,
      ),
    });
  });

  router.get("/protection", requireMember, async (_request, response) => {
    const { workspace } = getAuthContext(response);
    const [settings, suppressions, metaConfig, connections, providerForWorkspace] =
      await Promise.all([
        getWorkspaceMessagingSettings(pool, workspace.id),
        listCustomerSuppressions(pool, workspace.id),
        Promise.resolve(loadMetaOutboundConfig()),
        getConnectionCapabilities(pool, workspace.id),
        resolveOutboundProviderName(pool, workspace.id),
      ]);

    const runtime = process.env.NODE_ENV ?? "development";

    response.status(200).json({
      runtime,
      providerForWorkspace,
      defaultApprovalSendPolicy: settings.defaultApprovalSendPolicy,
      connections,
      meta: {
        enabled: metaConfig !== null,
        senderConfigured: metaConfig !== null,
        senderPhoneNumberId: metaConfig?.senderPhoneNumberId ?? null,
        recipientAllowlistCount: metaConfig?.allowedRecipients.size ?? 0,
        testWorkspaceConfigured: metaConfig !== null,
        workspaceAllowlistedForMeta:
          metaConfig !== null &&
          isWorkspaceAllowedForMetaSending(metaConfig, workspace.id),
        productionBlocked: runtime === "production",
        productionProtection:
          runtime === "production"
            ? "Meta sending is rejected because the API is running in production."
            : metaConfig === null
              ? "Meta sending is disabled. The mock provider handles outbound records."
              : "Meta sending is limited to the configured test workspace, sender, and recipient allowlist.",
      },
      inboundWebhook: {
        configured: whatsapp !== null,
        phoneNumberId: whatsapp?.phoneNumberId ?? null,
        workspaceMatches:
          whatsapp !== null &&
          whatsapp.workspaceId !== undefined &&
          whatsapp.workspaceId === workspace.id,
      },
      suppressions: {
        count: suppressions.length,
      },
    });
  });

  router.get(
    "/conversations/:conversationId/protection",
    requireMember,
    async (request, response) => {
      const conversationId = conversationIdSchema.safeParse(
        request.params.conversationId,
      );

      if (!conversationId.success) {
        sendValidationError(response, conversationId.error, "conversationId");
        return;
      }

      const { workspace } = getAuthContext(response);
      const protection = await getConversationProtection(
        pool,
        workspace.id,
        conversationId.data,
      );

      if (!protection) {
        response.status(404).json({ error: "Conversation not found" });
        return;
      }

      response.status(200).json({ protection });
    },
  );

  return router;
}
