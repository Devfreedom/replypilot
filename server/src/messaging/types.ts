export const APPROVAL_SEND_POLICIES = [
  "approve_only",
  "approve_and_send",
] as const;

export type ApprovalSendPolicy = (typeof APPROVAL_SEND_POLICIES)[number];

export const OUTBOUND_MESSAGE_STATUSES = [
  "queued",
  "sending",
  "sent",
  "delivered",
  "failed",
  "cancelled",
] as const;

export type OutboundMessageStatus =
  (typeof OUTBOUND_MESSAGE_STATUSES)[number];

export const DEFAULT_OUTBOUND_MAX_ATTEMPTS = 3;

export function isApprovalSendPolicy(
  value: unknown,
): value is ApprovalSendPolicy {
  return (
    typeof value === "string" &&
    (APPROVAL_SEND_POLICIES as readonly string[]).includes(value)
  );
}
