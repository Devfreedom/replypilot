import { Router, type Response } from "express";
import type { Pool } from "pg";
import type { ZodError } from "zod";
import type { AuthInstance } from "../auth/config.js";
import {
  createRequireWorkspace,
  getAuthContext,
} from "../auth/middleware.js";
import {
  businessProfileSchema,
  catalogueEntrySchema,
  knowledgeEntrySchema,
  resourceIdSchema,
} from "./schemas.js";
import {
  createBusinessProfile,
  createCatalogueEntry,
  createKnowledgeEntry,
  deactivateCatalogueEntry,
  deactivateKnowledgeEntry,
  getBusinessProfile,
  listCatalogue,
  listKnowledge,
  updateBusinessProfile,
  updateCatalogueEntry,
  updateKnowledgeEntry,
} from "./repository.js";

function validationError(
  response: Response,
  error: ZodError,
  prefix = "",
): void {
  response.status(400).json({
    error: "Invalid request",
    details: error.issues.map((issue) => ({
      field:
        [prefix, ...issue.path.map(String)].filter(Boolean).join(".") ||
        "body",
      message: issue.message,
    })),
  });
}

function parseId(value: unknown, response: Response): string | null {
  const parsed = resourceIdSchema.safeParse(value);

  if (!parsed.success) {
    validationError(response, parsed.error, "id");
    return null;
  }

  return parsed.data;
}

export function createBusinessRouter({
  pool,
  auth,
}: {
  pool: Pool;
  auth: AuthInstance;
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

  router.get("/profile", requireMember, async (_request, response) => {
    const { workspace } = getAuthContext(response);
    response
      .status(200)
      .json({ profile: await getBusinessProfile(pool, workspace.id) });
  });

  router.post("/profile", requireOwner, async (request, response) => {
    const parsed = businessProfileSchema.safeParse(request.body);

    if (!parsed.success) {
      validationError(response, parsed.error, "body");
      return;
    }

    const { workspace } = getAuthContext(response);
    const profile = await createBusinessProfile(
      pool,
      workspace.id,
      parsed.data,
    );

    if (!profile) {
      response.status(409).json({ error: "Business profile already exists" });
      return;
    }

    response.status(201).json({ profile });
  });

  router.patch("/profile", requireOwner, async (request, response) => {
    const parsed = businessProfileSchema.safeParse(request.body);

    if (!parsed.success) {
      validationError(response, parsed.error, "body");
      return;
    }

    const { workspace } = getAuthContext(response);
    const profile = await updateBusinessProfile(
      pool,
      workspace.id,
      parsed.data,
    );

    if (!profile) {
      response.status(404).json({ error: "Business profile not found" });
      return;
    }

    response.status(200).json({ profile });
  });

  router.get("/catalogue", requireMember, async (_request, response) => {
    const { workspace } = getAuthContext(response);
    response
      .status(200)
      .json({ entries: await listCatalogue(pool, workspace.id) });
  });

  router.post("/catalogue", requireOwner, async (request, response) => {
    const parsed = catalogueEntrySchema.safeParse(request.body);

    if (!parsed.success) {
      validationError(response, parsed.error, "body");
      return;
    }

    const { workspace } = getAuthContext(response);
    response.status(201).json({
      entry: await createCatalogueEntry(pool, workspace.id, parsed.data),
    });
  });

  router.patch(
    "/catalogue/:id",
    requireOwner,
    async (request, response) => {
      const id = parseId(request.params.id, response);

      if (!id) {
        return;
      }

      const parsed = catalogueEntrySchema.safeParse(request.body);

      if (!parsed.success) {
        validationError(response, parsed.error, "body");
        return;
      }

      const { workspace } = getAuthContext(response);
      const entry = await updateCatalogueEntry(
        pool,
        workspace.id,
        id,
        parsed.data,
      );

      if (!entry) {
        response.status(404).json({ error: "Catalogue entry not found" });
        return;
      }

      response.status(200).json({ entry });
    },
  );

  router.delete(
    "/catalogue/:id",
    requireOwner,
    async (request, response) => {
      const id = parseId(request.params.id, response);

      if (!id) {
        return;
      }

      const { workspace } = getAuthContext(response);
      const entry = await deactivateCatalogueEntry(pool, workspace.id, id);

      if (!entry) {
        response.status(404).json({ error: "Catalogue entry not found" });
        return;
      }

      response.status(200).json({ entry });
    },
  );

  router.get("/knowledge", requireMember, async (_request, response) => {
    const { workspace } = getAuthContext(response);
    response
      .status(200)
      .json({ entries: await listKnowledge(pool, workspace.id) });
  });

  router.post("/knowledge", requireOwner, async (request, response) => {
    const parsed = knowledgeEntrySchema.safeParse(request.body);

    if (!parsed.success) {
      validationError(response, parsed.error, "body");
      return;
    }

    const { workspace } = getAuthContext(response);
    response.status(201).json({
      entry: await createKnowledgeEntry(pool, workspace.id, parsed.data),
    });
  });

  router.patch(
    "/knowledge/:id",
    requireOwner,
    async (request, response) => {
      const id = parseId(request.params.id, response);

      if (!id) {
        return;
      }

      const parsed = knowledgeEntrySchema.safeParse(request.body);

      if (!parsed.success) {
        validationError(response, parsed.error, "body");
        return;
      }

      const { workspace } = getAuthContext(response);
      const entry = await updateKnowledgeEntry(
        pool,
        workspace.id,
        id,
        parsed.data,
      );

      if (!entry) {
        response.status(404).json({ error: "Knowledge entry not found" });
        return;
      }

      response.status(200).json({ entry });
    },
  );

  router.delete(
    "/knowledge/:id",
    requireOwner,
    async (request, response) => {
      const id = parseId(request.params.id, response);

      if (!id) {
        return;
      }

      const { workspace } = getAuthContext(response);
      const entry = await deactivateKnowledgeEntry(pool, workspace.id, id);

      if (!entry) {
        response.status(404).json({ error: "Knowledge entry not found" });
        return;
      }

      response.status(200).json({ entry });
    },
  );

  return router;
}
