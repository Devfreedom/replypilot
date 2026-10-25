import { z } from "zod";
import { replyDraftSourcesSchema } from "../business/provenance.js";
import { REPLY_DRAFT_REVIEW_STATUSES } from "./types.js";

export const missingInformationSchema = z
  .array(z.string().min(1).max(200))
  .max(10);

export const savedReplyDraftSourcesSchema = replyDraftSourcesSchema;

export const replyDraftIdSchema = z.uuid();

export const createReplyDraftSchema = z
  .object({
    draftId: z.uuid().optional(),
  })
  .strict();

export const updateReplyDraftSchema = z
  .object({
    draftReply: z
      .string()
      .trim()
      .min(1, "Reply text is required")
      .max(2000, "Reply text must be 2000 characters or fewer")
      .optional(),
    status: z.enum(REPLY_DRAFT_REVIEW_STATUSES).optional(),
  })
  .strict()
  .refine(
    (value) => value.draftReply !== undefined || value.status !== undefined,
    "Provide draftReply or status",
  )
  .superRefine((value, context) => {
    if (value.draftReply !== undefined && value.status === "approved") {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Save the edited reply before approving it",
      });
    }
  });

export type CreateReplyDraftInput = z.infer<typeof createReplyDraftSchema>;
export type UpdateReplyDraftInput = z.infer<typeof updateReplyDraftSchema>;
