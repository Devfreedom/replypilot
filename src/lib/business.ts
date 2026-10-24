import { z } from "zod";
import { WEEKDAYS } from "./opening-hours";

export type { OpeningHoursEntry } from "./opening-hours";

export const KNOWLEDGE_ENTRY_TYPES = ["faq", "policy"] as const;

/**
 * The API transports prices as JavaScript numbers, so the frontend mirrors the
 * server's safe integer limit before submitting a form.
 */
export const MAX_SAFE_PRICE_MINOR = Number.MAX_SAFE_INTEGER;

const openingHoursSchema = z.array(
  z.object({
    day: z.enum(WEEKDAYS),
    opensAt: z.string(),
    closesAt: z.string(),
  }),
);

const profileSchema = z.object({
  id: z.uuid(),
  businessName: z.string(),
  businessDescription: z.string(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactPhoneCountry: z.string().nullable().default(null),
  businessAddress: z.string().nullable(),
  timezone: z.string(),
  openingHours: openingHoursSchema,
  currencyCode: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const catalogueEntrySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  priceMinor: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_SAFE_PRICE_MINOR)
    .nullable(),
  currencyCode: z.string(),
  isActive: z.boolean(),
  availabilityNotes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const knowledgeEntrySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  answer: z.string(),
  entryType: z.enum(KNOWLEDGE_ENTRY_TYPES),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type BusinessProfile = z.infer<typeof profileSchema>;
export type CatalogueEntry = z.infer<typeof catalogueEntrySchema>;
export type KnowledgeEntry = z.infer<typeof knowledgeEntrySchema>;

export function parseProfileResponse(value: unknown): BusinessProfile | null {
  const parsed = z.object({ profile: profileSchema.nullable() }).safeParse(value);
  return parsed.success ? parsed.data.profile : null;
}

export function parseCatalogueResponse(
  value: unknown,
): CatalogueEntry[] | null {
  const parsed = z
    .object({ entries: z.array(catalogueEntrySchema) })
    .safeParse(value);
  return parsed.success ? parsed.data.entries : null;
}

export function parseKnowledgeResponse(
  value: unknown,
): KnowledgeEntry[] | null {
  const parsed = z
    .object({ entries: z.array(knowledgeEntrySchema) })
    .safeParse(value);
  return parsed.success ? parsed.data.entries : null;
}

export function parseCatalogueEntryResponse(
  value: unknown,
): CatalogueEntry | null {
  const parsed = z.object({ entry: catalogueEntrySchema }).safeParse(value);
  return parsed.success ? parsed.data.entry : null;
}

export function parseKnowledgeEntryResponse(
  value: unknown,
): KnowledgeEntry | null {
  const parsed = z.object({ entry: knowledgeEntrySchema }).safeParse(value);
  return parsed.success ? parsed.data.entry : null;
}
