import { z } from "zod";
import { replyDraftSourcesSchema } from "../business/provenance.js";
import { APPROVAL_SEND_POLICIES } from "../messaging/types.js";
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
    sendPolicy: z.enum(APPROVAL_SEND_POLICIES).nullable().optional(),
    conversationId: z.uuid().optional(),
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

    if (value.sendPolicy !== undefined && value.status !== "approved") {
      context.addIssue({
        code: "custom",
        path: ["sendPolicy"],
        message: "A send policy can only be supplied when approving a draft",
      });
    }

    if (value.conversationId !== undefined && value.status !== "approved") {
      context.addIssue({
        code: "custom",
        path: ["conversationId"],
        message: "A conversation can only be supplied when approving a draft",
      });
    }
  });

export const sendReplyDraftSchema = z
  .object({
    conversationId: z.uuid().optional(),
  })
  .strict();
