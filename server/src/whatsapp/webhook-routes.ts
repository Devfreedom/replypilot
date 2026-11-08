import express, { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import {
  InvalidWhatsAppPayloadError,
  parseWhatsAppDeliveryStatuses,
  parseWhatsAppWebhook,
} from "./parser.js";
import {
  persistInboundMessages,
  WhatsAppWorkspaceNotFoundError,
} from "./repository.js";
import { resolveActiveConnectionByPhoneNumberId } from "./connections.js";
import { processDeliveryStatusEvents } from "./delivery-webhook.js";
import { isValidMetaSignature, safeEqualString } from "./signature.js";
import type {
  DeliveryStatusEvent,
  InboundWhatsAppMessage,
  WhatsAppIntegrationConfig,
} from "./types.js";

const WEBHOOK_BODY_LIMIT = "3mb";
const CHALLENGE_MAX_LENGTH = 2_048;

function queryString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function createWhatsAppWebhookRouter({
  pool,
  config,
}: {
  pool: Pool;
  config: WhatsAppIntegrationConfig | null;
}): Router {
  const router = Router();

  if (!config) {
    router.all("/", (_request: Request, response: Response) => {
      response
        .status(503)
        .json({ error: "WhatsApp webhook is not configured" });
    });
    return router;
  }

  router.get("/", (request: Request, response: Response) => {
    const mode = queryString(request.query["hub.mode"]);
    const verifyToken = queryString(request.query["hub.verify_token"]);
    const challenge = queryString(request.query["hub.challenge"]);

    if (!mode || !verifyToken || !challenge) {
      response.status(400).json({
        error: "Missing webhook verification parameters",
      });
      return;
    }

    if (mode !== "subscribe" || challenge.length > CHALLENGE_MAX_LENGTH) {
      response.status(400).json({ error: "Invalid webhook verification request" });
      return;
    }

    if (!safeEqualString(verifyToken, config.verifyToken)) {
      response.status(403).json({ error: "Webhook verification failed" });
      return;
    }

    response.status(200).type("text/plain").send(challenge);
  });

  router.post(
    "/",
    express.raw({ type: "application/json", limit: WEBHOOK_BODY_LIMIT }),
    async (request: Request, response: Response, next: NextFunction) => {
      const rawBody = request.body;

      if (
        !Buffer.isBuffer(rawBody) ||
        !isValidMetaSignature(
          rawBody,
          request.get("x-hub-signature-256"),
          config.appSecret,
        )
      ) {
        response.status(401).json({ error: "Invalid webhook signature" });
        return;
      }

      let payload: unknown;

      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        response.status(400).json({ error: "Invalid webhook payload" });
        return;
      }

      // Parse every registered phone-number change first; routing happens below
      // from the database-owned connection, never from payload workspace data.
      let messages: InboundWhatsAppMessage[];
      let deliveryEvents: DeliveryStatusEvent[];

      try {
        messages = parseWhatsAppWebhook(payload);
        deliveryEvents = parseWhatsAppDeliveryStatuses(payload);
      } catch (error) {
        if (error instanceof InvalidWhatsAppPayloadError) {
          response.status(400).json({ error: "Invalid webhook payload" });
          return;
        }

        next(error);
        return;
      }

      const hasInbound = messages.length > 0;
      const hasDelivery = deliveryEvents.length > 0;

      if (!hasInbound && !hasDelivery) {
        response.status(200).json({ status: "ignored" });
        return;
      }

      const legacyPhoneNumberId = config.phoneNumberId?.trim() || null;
      const legacyWorkspaceId = config.workspaceId?.trim() || null;
      const workspaceByPhoneNumberId = new Map<string, string | null>();

      async function workspaceForPhoneNumberId(
        phoneNumberId: string,
      ): Promise<string | null> {
        const cached = workspaceByPhoneNumberId.get(phoneNumberId);

        if (cached !== undefined) {
          return cached;
        }

        const connection = await resolveActiveConnectionByPhoneNumberId(
          pool,
          phoneNumberId,
        );
        const resolved =
          connection?.workspaceId ??
          (legacyPhoneNumberId &&
          legacyWorkspaceId &&
          phoneNumberId === legacyPhoneNumberId
            ? legacyWorkspaceId
            : null);

        workspaceByPhoneNumberId.set(phoneNumberId, resolved);
        return resolved;
      }

      const inboundGroups = new Map<string, InboundWhatsAppMessage[]>();
      let ignoredMessages = 0;

      for (const message of messages) {
        const workspaceId = await workspaceForPhoneNumberId(
          message.phoneNumberId,
        );

        if (!workspaceId) {
          ignoredMessages += 1;
          continue;
        }

        const group = inboundGroups.get(workspaceId);

        if (group) {
          group.push(message);
        } else {
          inboundGroups.set(workspaceId, [message]);
        }
      }

      const deliveryGroups = new Map<string, DeliveryStatusEvent[]>();
      let ignoredDeliveryEvents = 0;

      for (const event of deliveryEvents) {
        const workspaceId = await workspaceForPhoneNumberId(
          event.phoneNumberId,
        );

        if (!workspaceId) {
          ignoredDeliveryEvents += 1;
          continue;
        }

        const group = deliveryGroups.get(workspaceId);

        if (group) {
          group.push(event);
        } else {
          deliveryGroups.set(workspaceId, [event]);
        }
      }

      if (inboundGroups.size === 0 && deliveryGroups.size === 0) {
        // Unknown numbers are acknowledged so Meta stops retrying, but they
        // are never assigned to a workspace. Log counts only, never payloads.
        console.warn(
          "WhatsApp webhook ignored events from unregistered phone-number IDs.",
          {
            messages: ignoredMessages,
            deliveryEvents: ignoredDeliveryEvents,
          },
        );
        response.status(200).json({ status: "ignored" });
        return;
      }

      try {
        let stored = 0;
        let duplicates = 0;
        let deliveryProcessed = 0;
        let deliveryIgnored = 0;

        for (const [workspaceId, group] of inboundGroups) {
          const inboundResult = await persistInboundMessages(
            pool,
            workspaceId,
            group,
          );
          stored += inboundResult.stored;
          duplicates += inboundResult.duplicates;
        }

        for (const [workspaceId, group] of deliveryGroups) {
          const deliveryResult = await processDeliveryStatusEvents(
            pool,
            workspaceId,
            group,
          );
          deliveryProcessed += deliveryResult.processed;
          deliveryIgnored += deliveryResult.ignored;
        }

        response.status(200).json({
          status: "ok",
          stored,
          duplicates,
          deliveryProcessed,
          deliveryIgnored,
          ...(ignoredMessages > 0 ? { ignoredMessages } : {}),
          ...(ignoredDeliveryEvents > 0 ? { ignoredDeliveryEvents } : {}),
        });
      } catch (error) {
        if (error instanceof WhatsAppWorkspaceNotFoundError) {
          console.error(
            "WhatsApp webhook rejected: a configured workspace does not exist.",
          );
          response
            .status(503)
            .json({ error: "WhatsApp integration is unavailable" });
          return;
        }

        next(error);
      }
    },
  );

  return router;
}
