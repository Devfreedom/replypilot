import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONVERSATION_FILTERS,
  conversationDisplayName,
  conversationIdentity,
  conversationInitials,
  conversationPreview,
  mergeConversations,
  mergeMessages,
  messageDayKey,
  parseConversationMessagesResponse,
  parseConversationsResponse,
  type WhatsAppConversation,
  type WhatsAppMessage,
} from "./whatsapp.js";

const BASE_CONVERSATION: WhatsAppConversation = {
  id: "11111111-1111-4111-8111-111111111111",
  customer: {
    id: "22222222-2222-4222-8222-222222222222",
    displayName: "Sheena Nelson",
    phoneE164: "+16505551234",
    providerContactId: null,
  },
  whatsappConnectionId: "33333333-3333-4333-8333-333333333333",
  phoneNumberId: "1234567890",
  channel: "whatsapp",
  status: "open",
  leadId: null,
  lastMessageAt: "2026-10-01T10:00:00.000Z",
  lastMessagePreview: "Hello there",
  lastMessageType: "text",
  lastMessageStatus: "stored",
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
};

function conversation(
  overrides: Partial<WhatsAppConversation> = {},
): WhatsAppConversation {
  return {
    ...BASE_CONVERSATION,
    ...overrides,
    customer: {
      ...BASE_CONVERSATION.customer,
      ...(overrides.customer ?? {}),
    },
  };
}

const BASE_MESSAGE: WhatsAppMessage = {
  id: "44444444-4444-4444-8444-444444444444",
  conversationId: BASE_CONVERSATION.id,
  direction: "inbound",
  messageType: "text",
  text: "Hello",
  providerTimestamp: "2026-10-01T10:00:00.000Z",
  processingStatus: "stored",
  createdAt: "2026-10-01T10:00:00.000Z",
};

function message(
  overrides: Partial<WhatsAppMessage> = {},
): WhatsAppMessage {
  return { ...BASE_MESSAGE, ...overrides };
}

test("conversation identity falls back from name to phone to provider ID", () => {
  assert.equal(conversationDisplayName(conversation()), "Sheena Nelson");

  const phoneOnly = conversation({
    customer: {
      id: BASE_CONVERSATION.customer.id,
      displayName: null,
      phoneE164: "+2348031234567",
      providerContactId: null,
    },
  });
  assert.equal(conversationDisplayName(phoneOnly), "+2348031234567");
  assert.deepEqual(conversationIdentity(phoneOnly), {
    label: "Phone",
    value: "+2348031234567",
  });

  const providerOnly = conversation({
    customer: {
      id: BASE_CONVERSATION.customer.id,
      displayName: null,
      phoneE164: null,
      providerContactId: "US.13491208655302741918",
    },
  });
  assert.equal(
    conversationDisplayName(providerOnly),
    "US.13491208655302741918",
  );
  assert.equal(
    conversationDisplayName(providerOnly).startsWith("+"),
    false,
  );
  assert.deepEqual(conversationIdentity(providerOnly), {
    label: "WhatsApp contact ID",
    value: "US.13491208655302741918",
  });

  const anonymous = conversation({
    customer: {
      id: BASE_CONVERSATION.customer.id,
      displayName: null,
      phoneE164: null,
      providerContactId: null,
    },
  });
  assert.equal(conversationDisplayName(anonymous), "Customer 22222222");
  assert.deepEqual(conversationIdentity(anonymous), {
    label: "Customer",
    value: BASE_CONVERSATION.customer.id,
  });

  assert.equal(conversationInitials(conversation()), "SN");
  assert.equal(conversationInitials(phoneOnly), "67");
  assert.equal(conversationInitials(providerOnly), "US");
  assert.equal(
    conversationInitials(
      conversation({
        customer: {
          id: BASE_CONVERSATION.customer.id,
          displayName: "张伟",
          phoneE164: null,
          providerContactId: null,
        },
      }),
    ),
    "张伟",
  );
});

test("conversation preview handles text, empty, and unsupported messages", () => {
  assert.equal(conversationPreview(conversation()), "Hello there");

  assert.equal(
    conversationPreview(
      conversation({
        lastMessageType: null,
        lastMessagePreview: null,
        lastMessageStatus: null,
      }),
    ),
    "No messages yet",
  );

  assert.equal(
    conversationPreview(
      conversation({
        lastMessageType: "image",
        lastMessagePreview: null,
        lastMessageStatus: "unsupported",
      }),
    ),
    "Unsupported image message",
  );

  assert.equal(
    conversationPreview(
      conversation({
        lastMessageType: "text",
        lastMessagePreview: "   ",
        lastMessageStatus: "stored",
      }),
    ),
    "Message content unavailable",
  );
});

test("mergeConversations deduplicates by ID and preserves order", () => {
  const first = conversation();
  const second = conversation({
    id: "55555555-5555-4555-8555-555555555555",
  });
  const third = conversation({
    id: "66666666-6666-4666-8666-666666666666",
  });

  assert.deepEqual(
    mergeConversations([first, second], [second, third]).map(
      (item) => item.id,
    ),
    [first.id, second.id, third.id],
  );
});

test("mergeMessages prepends older pages and deduplicates anchor rows", () => {
  const first = message({ id: "10000000-0000-4000-8000-000000000001" });
  const second = message({ id: "10000000-0000-4000-8000-000000000002" });
  const third = message({ id: "10000000-0000-4000-8000-000000000003" });
  const fourth = message({ id: "10000000-0000-4000-8000-000000000004" });

  assert.deepEqual(
    mergeMessages([second, third], [first, second], "older").map(
      (item) => item.id,
    ),
    [first.id, second.id, third.id],
  );

  assert.deepEqual(
    mergeMessages([second, third], [third, fourth], "newer").map(
      (item) => item.id,
    ),
    [second.id, third.id, fourth.id],
  );

  const tieA = message({
    id: "10000000-0000-4000-8000-00000000000a",
    providerTimestamp: "2026-10-01T10:00:00.000Z",
  });
  const tieB = message({
    id: "10000000-0000-4000-8000-00000000000b",
    providerTimestamp: "2026-10-01T10:00:00.000Z",
  });
  assert.deepEqual(
    mergeMessages([], [tieA, tieB], "older").map((item) => item.id),
    [tieA.id, tieB.id],
  );
});

test("messageDayKey groups messages by local calendar day", () => {
  const sameDay = messageDayKey("2026-10-01T08:00:00.000Z");
  assert.equal(messageDayKey("2026-10-01T09:00:00.000Z"), sameDay);
  assert.notEqual(messageDayKey("2026-10-02T08:00:00.000Z"), sameDay);
});

test("response parsers accept summary and cursor payloads", () => {
  const conversations = parseConversationsResponse({
    conversations: [conversation()],
    pagination: {
      limit: 30,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    },
  });
  assert.ok(conversations);
  assert.equal(conversations.conversations.length, 1);
  assert.equal(conversations.pagination?.hasMore, false);

  const messages = parseConversationMessagesResponse({
    conversation: conversation(),
    messages: [message()],
    pagination: {
      limit: 30,
      hasMore: true,
      nextCursor: "next",
      prevCursor: "prev",
      direction: "before",
    },
  });
  assert.ok(messages);
  assert.equal(messages.messages.length, 1);
  assert.equal(messages.pagination?.prevCursor, "prev");
  assert.equal(messages.pagination?.direction, "before");

  assert.equal(
    parseConversationsResponse({
      conversations: [
        {
          ...conversation(),
          customer: {
            id: BASE_CONVERSATION.customer.id,
            displayName: null,
            phoneE164: null,
          },
        },
      ],
    }),
    null,
  );

  assert.equal(
    parseConversationMessagesResponse({
      conversation: conversation(),
      messages: [message()],
      pagination: { limit: 30, hasMore: false, direction: "sideways" },
    }),
    null,
  );
});

test("status filter options cover every supported view", () => {
  assert.deepEqual(
    CONVERSATION_FILTERS.map((filter) => filter.value),
    ["open", "closed", "archived", "all"],
  );
  assert.deepEqual(
    CONVERSATION_FILTERS.map((filter) => filter.label),
    ["Open", "Closed", "Archived", "All"],
  );
});
