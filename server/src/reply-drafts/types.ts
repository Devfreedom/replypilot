import type { ReplyDraft } from "../ai/reply-draft.js";
import type { ApprovalSendPolicy } from "../messaging/types.js";

export const REPLY_DRAFT_REVIEW_STATUSES = ["draft", "approved"] as const;
export type ReplyDraftReviewStatus =
  (typeof REPLY_DRAFT_REVIEW_STATUSES)[number];

export type SavedReplyDraft = Readonly<
  ReplyDraft & {
    id: string;
    leadId: string;
    status: ReplyDraftReviewStatus;
    approvedAt: string | null;
    approvedBy: string | null;
    sendPolicyOverride: ApprovalSendPolicy | null;
    approvalSendPolicy: ApprovalSendPolicy | null;
    createdAt: string;
    updatedAt: string;
  }
>;

export type ReplyDraftRow = Readonly<{
  id: string;
  lead_id: string;
  intent: ReplyDraft["intent"];
  summary: string;
  missing_information: unknown;
  draft_reply: string;
  provider: string;
  is_demo: boolean;
  status: ReplyDraftReviewStatus;
  sources: unknown;
  approved_at: Date | null;
  approved_by: string | null;
  send_policy_override: ApprovalSendPolicy | null;
  approval_send_policy: ApprovalSendPolicy | null;
  created_at: Date;
  updated_at: Date;
}>;
