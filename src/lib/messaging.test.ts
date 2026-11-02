import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APPROVAL_SEND_POLICIES,
  APPROVAL_SEND_POLICY_LABELS,
  OUTBOUND_MESSAGE_STATUSES,
  OUTBOUND_STATUS_DESCRIPTIONS,
  OUTBOUND_STATUS_LABELS,
  parseMessagingSettingsResponse,
  parseOutboundMessage,
  parseOutboundMessagesResponse,
} from "./messaging.js";

const outboundMessage = {
  id: "11111111-1111-4111-8111-111111111111",
  conversationId: "22222222-2222-4222-8222-222222222222",
  replyDraftId: "33333333-3333-4333-8333-333333333333",
  provider: "mock",
  providerMessageId: "mock-abc123",
  content: "Thanks for reaching out.",
  status: "sent",
  failureReason: null,
  attempts: 1,
  maxAttempts: 3,
  queuedAt: "2026-10-01T10:00:00.000Z",
  startedAt: "2026-10-01T10:00:01.000Z",
  sentAt: "2026-10-01T10:00:02.000Z",
  deliveredAt: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:02.000Z",
};

test("messaging settings parser accepts the safe policy enum", () => {
  assert.deepEqual(
    parseMessagingSettingsResponse({
      settings: { defaultApprovalSendPolicy: "approve_only" },
    }),
    { defaultApprovalSendPolicy: "approve_only" },
  );
  assert.deepEqual(
    parseMessagingSettingsResponse({
      settings: { defaultApprovalSendPolicy: "approve_and_send" },
    }),
    { defaultApprovalSendPolicy: "approve_and_send" },
  );
  assert.equal(
    parseMessagingSettingsResponse({
      settings: { defaultApprovalSendPolicy: "send_immediately" },
    }),
    null,
  );
});

test("outbound history parser preserves provider acceptance and retry eligibility", () => {
  const parsed = parseOutboundMessagesResponse({
    messages: [
      {
        ...outboundMessage,
        conversation: {
          id: outboundMessage.conversationId,
          customer: {
            id: "44444444-4444-4444-8444-444444444444",
            displayName: "Sheena Nelson",
            phoneE164: "+16505551234",
            providerContactId: null,
          },
          status: "open",
        },
        canRetry: false,
      },
    ],
    pagination: {
      limit: 20,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    },
  });

  assert.ok(parsed);
  assert.equal(parsed.messages[0]?.status, "sent");
  assert.equal(parsed.messages[0]?.sentAt, "2026-10-01T10:00:02.000Z");
  assert.equal(parsed.messages[0]?.deliveredAt, null);
  assert.equal(parsed.messages[0]?.canRetry, false);
});

test("outbound message parser rejects an unknown status", () => {
  assert.ok(parseOutboundMessage(outboundMessage));
  assert.equal(
    parseOutboundMessage({ ...outboundMessage, status: "accepted" }),
    null,
  );
});

test("status labels keep provider acceptance distinct from delivery", () => {
  assert.deepEqual(OUTBOUND_MESSAGE_STATUSES, [
    "queued",
    "sending",
    "sent",
    "delivered",
    "failed",
    "cancelled",
  ]);
  assert.equal(OUTBOUND_STATUS_LABELS.sent, "Sent");
  assert.equal(OUTBOUND_STATUS_LABELS.delivered, "Delivered");
  assert.match(OUTBOUND_STATUS_DESCRIPTIONS.sent, /not confirmed/i);
  assert.match(OUTBOUND_STATUS_DESCRIPTIONS.delivered, /reported delivery/i);
});

test("approval policy labels cover every supported choice", () => {
  assert.deepEqual(APPROVAL_SEND_POLICIES, [
    "approve_only",
    "approve_and_send",
  ]);
  assert.equal(APPROVAL_SEND_POLICY_LABELS.approve_only, "Approve only");
  assert.equal(
    APPROVAL_SEND_POLICY_LABELS.approve_and_send,
    "Approve and queue for sending",
  );
});
