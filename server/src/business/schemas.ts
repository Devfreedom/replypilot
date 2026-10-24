import { z } from "zod";
import { KNOWLEDGE_ENTRY_TYPES } from "./types.js";

/**
 * Prices are stored and transported as integer minor units. The API uses
 * JavaScript numbers, so amounts must stay within the safe integer range.
 */
export const MAX_SAFE_PRICE_MINOR = Number.MAX_SAFE_INTEGER;

/**
 * Current ISO 4217 currency codes known to the runtime's ICU data. This is a
 * maintained, dependency-free list of active currencies; it intentionally
 * excludes historical, fund, and non-currency codes such as XXX. Matching is
 * case-sensitive, so only uppercase three-letter codes are accepted.
 */
const SUPPORTED_CURRENCY_CODES = new Set(
  Intl.supportedValuesOf("currency"),
);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .optional();

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour time)");

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export const openingHoursSchema = z
  .array(
    z
      .object({
        day: z.enum(DAYS),
        opensAt: timeSchema,
        closesAt: timeSchema,
      })
      .strict(),
  )
  .max(7)
  .superRefine((entries, context) => {
    const days = new Set<string>();

    entries.forEach((entry, index) => {
      if (days.has(entry.day)) {
        context.addIssue({
          code: "custom",
          path: [index, "day"],
          message: "Each day can appear only once",
        });
      }

      days.add(entry.day);

      if (entry.opensAt >= entry.closesAt) {
        context.addIssue({
          code: "custom",
          path: [index, "closesAt"],
          message: "Closing time must be after opening time",
        });
      }
    });
  });

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Use a valid IANA timezone");

export const businessProfileSchema = z
  .object({
    businessName: z
      .string()
      .trim()
      .min(1, "Business name is required")
      .max(160),
    businessDescription: z.string().trim().max(2000).default(""),
    contactEmail: optionalText(254).refine(
      (value) => value === null || z.email().safeParse(value).success,
      "Use a valid email address",
    ),
    contactPhone: optionalText(60),
    businessAddress: optionalText(500),
    timezone: timezoneSchema.default("Africa/Lagos"),
    openingHours: openingHoursSchema.default([]),
  })
  .strict();

export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;

const currencyCodeSchema = z
  .string()
  .refine(
    (value) => SUPPORTED_CURRENCY_CODES.has(value),
    "Use a current ISO 4217 currency code in uppercase (for example NGN or USD)",
  );

const priceMinorSchema = z
  .number()
  .int("Price must be an integer number of minor units")
  .min(0, "Price cannot be negative")
  .max(
    MAX_SAFE_PRICE_MINOR,
    `Price must be at most ${MAX_SAFE_PRICE_MINOR} minor units`,
  )
  .nullable()
  .optional();

export const catalogueEntrySchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(160),
    description: z.string().trim().max(2000).default(""),
    priceMinor: priceMinorSchema,
    currencyCode: currencyCodeSchema.default("NGN"),
    availabilityNotes: optionalText(1000),
    isActive: z.boolean().optional(),
  })
  .strict();

export type CatalogueEntryInput = z.infer<typeof catalogueEntrySchema>;

export const knowledgeEntrySchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(240),
    answer: z.string().trim().min(1, "Answer is required").max(4000),
    entryType: z.enum(KNOWLEDGE_ENTRY_TYPES),
    isActive: z.boolean().optional(),
  })
  .strict();

export type KnowledgeEntryInput = z.infer<typeof knowledgeEntrySchema>;

export const resourceIdSchema = z.uuid();
