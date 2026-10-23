import { z } from "zod";
import { LEAD_CHANNELS, LEAD_STATUSES } from "./types.js";

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
    channel: z.enum(LEAD_CHANNELS).default("Manual"),
    status: z.enum(LEAD_STATUSES).default("New"),
    nextFollowUpAt: z.iso
      .datetime({ offset: true })
      .nullable()
      .optional(),
  })
  .strict();

export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadStatusSchema = z
  .object({
    status: z.enum(LEAD_STATUSES),
  })
  .strict();

export const leadIdSchema = z.uuid();
