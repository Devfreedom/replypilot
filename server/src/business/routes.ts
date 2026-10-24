import { Router, type Response } from "express";
import type { Pool } from "pg";
import type { ZodError } from "zod";
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

function validationError(response: Response, error: ZodError, prefix = ""): void {
  response.status(400).json({ error: "Invalid request", details: error.issues.map((issue) => ({ field: [prefix, ...issue.path.map(String)].filter(Boolean).join(".") || "body", message: issue.message })) });
}

function parseId(value: string, response: Response): string | null {
  const parsed = resourceIdSchema.safeParse(value);
  if (!parsed.success) { validationError(response, parsed.error, "id"); return null; }
  return parsed.data;
}

export function createBusinessRouter({ pool }: { pool: Pool }): Router {
  const router = Router();

  router.get("/profile", async (_request, response) => response.status(200).json({ profile: await getBusinessProfile(pool) }));
  router.post("/profile", async (request, response) => {
    const parsed = businessProfileSchema.safeParse(request.body);
    if (!parsed.success) { validationError(response, parsed.error, "body"); return; }
    const profile = await createBusinessProfile(pool, parsed.data);
    if (!profile) { response.status(409).json({ error: "Business profile already exists" }); return; }
    response.status(201).json({ profile });
  });
  router.patch("/profile", async (request, response) => {
    const parsed = businessProfileSchema.safeParse(request.body);
    if (!parsed.success) { validationError(response, parsed.error, "body"); return; }
    const profile = await updateBusinessProfile(pool, parsed.data);
    if (!profile) { response.status(404).json({ error: "Business profile not found" }); return; }
    response.status(200).json({ profile });
  });

  router.get("/catalogue", async (_request, response) => response.status(200).json({ entries: await listCatalogue(pool) }));
  router.post("/catalogue", async (request, response) => {
    const parsed = catalogueEntrySchema.safeParse(request.body);
    if (!parsed.success) { validationError(response, parsed.error, "body"); return; }
    response.status(201).json({ entry: await createCatalogueEntry(pool, parsed.data) });
  });
  router.patch("/catalogue/:id", async (request, response) => {
    const id = parseId(request.params.id, response); if (!id) return;
    const parsed = catalogueEntrySchema.safeParse(request.body);
    if (!parsed.success) { validationError(response, parsed.error, "body"); return; }
    const entry = await updateCatalogueEntry(pool, id, parsed.data);
    if (!entry) { response.status(404).json({ error: "Catalogue entry not found" }); return; }
    response.status(200).json({ entry });
  });
  router.delete("/catalogue/:id", async (request, response) => {
    const id = parseId(request.params.id, response); if (!id) return;
    const entry = await deactivateCatalogueEntry(pool, id);
    if (!entry) { response.status(404).json({ error: "Catalogue entry not found" }); return; }
    response.status(200).json({ entry });
  });

  router.get("/knowledge", async (_request, response) => response.status(200).json({ entries: await listKnowledge(pool) }));
  router.post("/knowledge", async (request, response) => {
    const parsed = knowledgeEntrySchema.safeParse(request.body);
    if (!parsed.success) { validationError(response, parsed.error, "body"); return; }
    response.status(201).json({ entry: await createKnowledgeEntry(pool, parsed.data) });
  });
  router.patch("/knowledge/:id", async (request, response) => {
    const id = parseId(request.params.id, response); if (!id) return;
    const parsed = knowledgeEntrySchema.safeParse(request.body);
    if (!parsed.success) { validationError(response, parsed.error, "body"); return; }
    const entry = await updateKnowledgeEntry(pool, id, parsed.data);
    if (!entry) { response.status(404).json({ error: "Knowledge entry not found" }); return; }
    response.status(200).json({ entry });
  });
  router.delete("/knowledge/:id", async (request, response) => {
    const id = parseId(request.params.id, response); if (!id) return;
    const entry = await deactivateKnowledgeEntry(pool, id);
    if (!entry) { response.status(404).json({ error: "Knowledge entry not found" }); return; }
    response.status(200).json({ entry });
  });

  return router;
}
