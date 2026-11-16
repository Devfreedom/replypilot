import { z } from "zod";
import { LEAD_CHANNELS, LEAD_STATUSES } from "./types.js";
import { normalizeLeadPhoneNumber } from "./phone.js";

/**
 * The WhatsApp number of a lead.
 *
 * The number is stored in E.164 so it can be compared with a customer number
 * and with an inbound sender number. The country is explicit: a national
 * number is only accepted together with the country it belongs to, so no
 * country code is ever guessed from the digits.
 *
 * A number written with a leading "+" is the explicit international form and
 * may be sent without a country. Every other number is a national number and
 * needs its country.
 */
export const createLeadSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(120, "Name must be 120 characters or fewer"),
    service: z
      .string()
      .trim()
      .min(1, "Service is required")
      .max(160, "Service must be 160 characters or fewer"),
    lastMessage: z
      .string()
      .trim()
      .min(1, "Last message is required")
      .max(2000, "Last message must be 2000 characters or fewer"),
    whatsappNumber: z
      .string()
      .trim()
      .max(32, "WhatsApp number must be 32 characters or fewer")
      .nullable()
      .optional(),
    whatsappCountryCode: z
      .string()
      .trim()
      .toUpperCase()
      .length(2, "WhatsApp country must be a two-letter country code")
      .nullable()
      .optional(),
    /**
     * Confirms that the number belongs to a different customer when another
     * lead may already hold it in a national format whose country is not
     * recorded. A confirmed duplicate is never overridden by this flag.
     */
    confirmUnresolvedNumber: z.boolean().optional().default(false),
    channel: z.enum(LEAD_CHANNELS).default("Manual"),
    status: z.enum(LEAD_STATUSES).default("New"),
    nextFollowUpAt: z
      .iso
      .datetime({ offset: true })
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const normalized = normalizeLeadPhoneNumber(
      value.whatsappNumber ?? null,
      value.whatsappCountryCode ?? null,
    );

    if (!normalized.ok) {
      ctx.addIssue({
        code: "custom",
        path: ["whatsappNumber"],
        message: normalized.message,
      });
    }
  })
  .transform(({ whatsappCountryCode, ...value }) => {
    const normalized = normalizeLeadPhoneNumber(
      value.whatsappNumber ?? null,
      whatsappCountryCode ?? null,
    );

    return {
      ...value,
      whatsappNumber: normalized.ok ? normalized.e164 : null,
    };
  });

export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadStatusSchema = z
  .object({
    status: z.enum(LEAD_STATUSES),
  })
  .strict();

export const leadIdSchema = z.uuid();

export const linkConversationSchema = z
  .object({
    conversationId: z.uuid(),
  })
  .strict();
