import express, { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import { InvalidWhatsAppPayloadError, parseWhatsAppWebhook } from "./parser.js";
import {
  persistInboundMessages,
  WhatsAppWorkspaceNotFoundError,
} from "./repository.js";
import { isValidMetaSignature, safeEqualString } from "./signature.js";
import type { WhatsAppIntegrationConfig } from "./types.js";

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

      let messages;

      try {
        messages = parseWhatsAppWebhook(payload, config.phoneNumberId);
      } catch (error) {
        if (error instanceof InvalidWhatsAppPayloadError) {
          response.status(400).json({ error: "Invalid webhook payload" });
          return;
        }

        next(error);
        return;
      }

      if (messages.length === 0) {
        response.status(200).json({ status: "ignored" });
        return;
      }

      try {
        const result = await persistInboundMessages(
          pool,
          config.workspaceId,
          messages,
        );
        response.status(200).json({
          status: "ok",
          stored: result.stored,
          duplicates: result.duplicates,
        });
      } catch (error) {
        if (error instanceof WhatsAppWorkspaceNotFoundError) {
          console.error(
            "WhatsApp webhook rejected: the configured workspace does not exist.",
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
