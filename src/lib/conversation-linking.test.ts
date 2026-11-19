import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apiErrorMessage,
  isConversationLinkable,
  linkableConversationLabel,
  OUTBOUND_IN_PROGRESS_CODE,
  parseApiError,
  parseLinkableConversations,
  REPLY_DRAFT_ABSTAINED_CODE,
  WHATSAPP_CONVERSATION_ALREADY_LINKED_CODE,
  WHATSAPP_CONVERSATION_LEAD_ALREADY_LINKED_CODE,
  WHATSAPP_CONVERSATION_LEAD_NUMBER_UNKNOWN_CODE,
  WHATSAPP_CONVERSATION_NOT_LINKABLE_CODE,
  WHATSAPP_CONVERSATION_PHONE_MISMATCH_CODE,
  WHATSAPP_CONVERSATION_REQUIRED_CODE,
  WHATSAPP_CONNECTION_DISCONNECTED_CODE,
  WHATSAPP_CUSTOMER_SUPPRESSED_CODE,
  type LinkableConversation,
} from "./conversation-linking.js";

function conversation(
  overrides: Partial<LinkableConversation> = {},
): LinkableConversation {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    customerDisplayName: "A Customer",
    customerPhoneE164: "+2348031234567",
    status: "open",
    linkedLeadId: null,
    ...overrides,
  };
}

function page(conversations: LinkableConversation[] = [conversation()]) {
  return {
    conversations,
    pagination: {
      limit: 100,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    },
  };
}

test("an API error body keeps its stable code", () => {
  const parsed = parseApiError({
    error: "Something went wrong",
    code: WHATSAPP_CONVERSATION_REQUIRED_CODE,
  });

  assert.equal(parsed?.code, WHATSAPP_CONVERSATION_REQUIRED_CODE);
  assert.equal(parsed?.error, "Something went wrong");
});

test("an API error body without a code still parses", () => {
  const parsed = parseApiError({ error: "Something went wrong" });

  assert.equal(parsed?.error, "Something went wrong");
  assert.equal(parsed?.code, undefined);
});

test("a body that is not an error payload does not parse", () => {
  assert.equal(parseApiError({ unexpected: true }), null);
  assert.equal(parseApiError(null), null);
});

test("the server message wins over the shared guidance", () => {
  assert.equal(
    apiErrorMessage(
      {
        error: "A specific message",
        code: WHATSAPP_CONNECTION_DISCONNECTED_CODE,
      },
      "fallback",
    ),
    "A specific message",
  );
});

test("the shared guidance is used when the body carries only a code", () => {
  const message = apiErrorMessage(
    { error: "", code: WHATSAPP_CONNECTION_DISCONNECTED_CODE },
    "fallback",
  );

  assert.match(message, /disconnected/i);
  assert.notEqual(message, "fallback");
});

test("the fallback is used when there is neither a message nor a known code", () => {
  assert.equal(
    apiErrorMessage({ error: "", code: "SOMETHING_ELSE" }, "fallback"),
    "fallback",
  );
  assert.equal(apiErrorMessage(null, "fallback"), "fallback");
});

test("draft_abstained, customer_suppressed, and outbound_in_progress render human-readable messages", () => {
  for (const [code, pattern] of [
    [REPLY_DRAFT_ABSTAINED_CODE, /abstained/i],
    [WHATSAPP_CUSTOMER_SUPPRESSED_CODE, /suppressed/i],
    [OUTBOUND_IN_PROGRESS_CODE, /cannot be edited/i],
  ] as const) {
    // Server human-readable error wins
    assert.equal(
      apiErrorMessage({ error: `Server detail for ${code}`, code }, "fallback"),
      `Server detail for ${code}`,
    );

    // Code-only fallback guidance is also human-readable
    const fallbackGuided = apiErrorMessage({ error: "", code }, "fallback");
    assert.match(fallbackGuided, pattern);
    assert.notEqual(fallbackGuided, "fallback");
  }
});

test("each linkage situation has its own guidance", () => {
  const required = apiErrorMessage(
    { error: "", code: WHATSAPP_CONVERSATION_REQUIRED_CODE },
    "fallback",
  );
  const mismatch = apiErrorMessage(
    { error: "", code: WHATSAPP_CONVERSATION_PHONE_MISMATCH_CODE },
    "fallback",
  );
  const alreadyLinked = apiErrorMessage(
    { error: "", code: WHATSAPP_CONVERSATION_ALREADY_LINKED_CODE },
    "fallback",
  );
  const notLinkable = apiErrorMessage(
    { error: "", code: WHATSAPP_CONVERSATION_NOT_LINKABLE_CODE },
    "fallback",
  );
  const numberUnknown = apiErrorMessage(
    { error: "", code: WHATSAPP_CONVERSATION_LEAD_NUMBER_UNKNOWN_CODE },
    "fallback",
  );
  const leadAlreadyLinked = apiErrorMessage(
    { error: "", code: WHATSAPP_CONVERSATION_LEAD_ALREADY_LINKED_CODE },
    "fallback",
  );

  assert.match(required, /no WhatsApp conversation yet/i);
  assert.match(mismatch, /different phone number/i);
  assert.match(alreadyLinked, /already linked to another lead/i);
  assert.match(notLinkable, /active WhatsApp conversation/i);
  assert.match(numberUnknown, /not in international format/i);
  assert.match(leadAlreadyLinked, /already has an active WhatsApp conversation/i);

  const messages = [
    required,
    mismatch,
    alreadyLinked,
    notLinkable,
    numberUnknown,
    leadAlreadyLinked,
  ];
  assert.equal(new Set(messages).size, messages.length);
});

test("the linkable conversation page parses", () => {
  const parsed = parseLinkableConversations(page());

  assert.equal(parsed?.conversations.length, 1);
  assert.equal(
    parsed?.conversations[0]?.id,
    "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(parsed?.pagination.hasMore, false);
  assert.equal(parsed?.pagination.nextOffset, null);
});

test("a linkable conversation page that does not match the shape is rejected", () => {
  assert.equal(parseLinkableConversations({ conversations: "nope" }), null);
  assert.equal(parseLinkableConversations({}), null);
  assert.equal(
    parseLinkableConversations({
      conversations: [],
      pagination: { limit: 0, offset: 0, hasMore: false, nextOffset: null },
    }),
    null,
  );
});

test("only an active conversation that is not linked elsewhere can be linked", () => {
  const leadId = "22222222-2222-4222-8222-222222222222";
  const otherLeadId = "33333333-3333-4333-8333-333333333333";

  assert.equal(isConversationLinkable(conversation(), leadId), true);
  assert.equal(
    isConversationLinkable(conversation({ status: "closed" }), leadId),
    true,
  );
  assert.equal(
    isConversationLinkable(conversation({ status: "archived" }), leadId),
    false,
  );
  assert.equal(
    isConversationLinkable(conversation({ linkedLeadId: leadId }), leadId),
    true,
    "A conversation already linked to this lead stays available",
  );
  assert.equal(
    isConversationLinkable(conversation({ linkedLeadId: otherLeadId }), leadId),
    false,
    "A conversation linked to another lead is never offered",
  );
});

test("a linkable conversation label names the customer and the number", () => {
  assert.equal(
    linkableConversationLabel(conversation()),
    "A Customer · +2348031234567",
  );
  assert.equal(
    linkableConversationLabel(
      conversation({ customerDisplayName: null, customerPhoneE164: null }),
    ),
    "Unknown contact",
  );
});
