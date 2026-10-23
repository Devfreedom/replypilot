import { Router, type Response } from "express";
import type { Pool } from "pg";
import type { ZodError } from "zod";
import {
  createLead,
  listLeads,
  updateLeadStatus,
} from "./repository.js";
import {
  createLeadSchema,
  leadIdSchema,
  updateLeadStatusSchema,
} from "./schemas.js";

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

export function createLeadsRouter(pool: Pool): Router {
  const router = Router();

  router.get("/", async (_request, response) => {
    const leads = await listLeads(pool);
    response.status(200).json({ leads });
  });

  router.post("/", async (request, response) => {
    const parsed = createLeadSchema.safeParse(request.body);

    if (!parsed.success) {
      sendValidationError(response, parsed.error, "body");
      return;
    }

    const lead = await createLead(pool, parsed.data);
    response.status(201).json({ lead });
  });

  router.patch("/:id", async (request, response) => {
    const id = leadIdSchema.safeParse(request.params.id);

    if (!id.success) {
      sendValidationError(response, id.error, "id");
      return;
    }

    const parsed = updateLeadStatusSchema.safeParse(request.body);

    if (!parsed.success) {
      sendValidationError(response, parsed.error, "body");
      return;
    }

    const lead = await updateLeadStatus(pool, id.data, parsed.data.status);

    if (!lead) {
      response.status(404).json({ error: "Lead not found" });
      return;
    }

    response.status(200).json({ lead });
  });

  return router;
}
