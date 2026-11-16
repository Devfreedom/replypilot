import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dashboardViewHref,
  parseDashboardView,
  parseLeadCreationError,
  parseReplyDraftResponse,
  parseSavedReplyDraftResponse,
  LeadApiError,
  WHATSAPP_LEAD_DUPLICATE_NUMBER_CODE,
  WHATSAPP_LEAD_NUMBER_UNRESOLVED_CODE,
} from "./leads.js";

test("dashboard view query parsing defaults to overview and accepts known views", () => {
  assert.equal(parseDashboardView(null), "overview");
  assert.equal(parseDashboardView(""), "overview");
  assert.equal(parseDashboardView("overview"), "overview");
  assert.equal(parseDashboardView("leads"), "leads");
  assert.equal(parseDashboardView("follow-ups"), "follow-ups");
  assert.equal(parseDashboardView("unknown"), "overview");
});

test("dashboard view links use the view query parameter", () => {
  assert.equal(dashboardViewHref("overview"), "/?view=overview");
  assert.equal(dashboardViewHref("leads"), "/?view=leads");
  assert.equal(dashboardViewHref("follow-ups"), "/?view=follow-ups");
});

test("a confirmed duplicate and an unresolved possible duplicate carry different codes", () => {
  const confirmed = parseLeadCreationError({
    error: "A lead with this WhatsApp number already exists.",
    code: WHATSAPP_LEAD_DUPLICATE_NUMBER_CODE,
  });
  assert.equal(confirmed?.code, WHATSAPP_LEAD_DUPLICATE_NUMBER_CODE);

  const unresolved = parseLeadCreationError({
    error: "Another lead in this workspace may already hold this WhatsApp number…",
    code: WHATSAPP_LEAD_NUMBER_UNRESOLVED_CODE,
    conflictingLeadId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(unresolved?.code, WHATSAPP_LEAD_NUMBER_UNRESOLVED_CODE);
  assert.equal(
    unresolved?.conflictingLeadId,
    "11111111-1111-4111-8111-111111111111",
  );

  assert.notEqual(
    WHATSAPP_LEAD_DUPLICATE_NUMBER_CODE,
    WHATSAPP_LEAD_NUMBER_UNRESOLVED_CODE,
  );
});

test("a body that is not a lead error payload does not parse", () => {
  assert.equal(parseLeadCreationError({ unexpected: true }), null);
  assert.equal(parseLeadCreationError(null), null);
  assert.equal(parseLeadCreationError("nope"), null);
});

test("a lead API error carries its stable code and validation details to the caller", () => {
  const error = new LeadApiError("Invalid request", {
    code: WHATSAPP_LEAD_NUMBER_UNRESOLVED_CODE,
    conflictingLeadId: "22222222-2222-4222-8222-222222222222",
    details: [
      {
        field: "body.whatsappNumber",
        message: "Enter a valid WhatsApp number for NG.",
      },
    ],
  });

  assert.ok(error instanceof Error);
  assert.equal(error.message, "Invalid request");
  assert.equal(error.code, WHATSAPP_LEAD_NUMBER_UNRESOLVED_CODE);
  assert.equal(
    error.conflictingLeadId,
    "22222222-2222-4222-8222-222222222222",
  );
  assert.equal(error.details?.[0]?.field, "body.whatsappNumber");

  const parsed = parseLeadCreationError({
    error: "Invalid request",
    details: [{ field: "body.name", message: "Name is required" }],
  });
  assert.equal(parsed?.details?.[0]?.field, "body.name");

  const plain = new LeadApiError("Something went wrong");
  assert.equal(plain.code, undefined);
  assert.equal(plain.conflictingLeadId, undefined);
  assert.equal(plain.details, undefined);
});

test("reply draft parsers accept valid mock and gemini metadata and reject mismatched demo flags", () => {
  const baseDraft = {
    intent: "pricing",
    summary: "Customer asked about wedding photography pricing.",
    missingInformation: ["Event date"],
    draftReply: "Thanks for reaching out! Could you share your event date?",
  };

  assert.equal(
    parseReplyDraftResponse({ ...baseDraft, provider: "gemini", isDemo: false })
      ?.provider,
    "gemini",
  );
  assert.equal(
    parseReplyDraftResponse({ ...baseDraft, provider: "mock", isDemo: true })
      ?.isDemo,
    true,
  );
  assert.equal(
    parseReplyDraftResponse({ ...baseDraft, provider: "gemini", isDemo: true }),
    null,
  );
  assert.equal(
    parseReplyDraftResponse({ ...baseDraft, provider: "mock", isDemo: false }),
    null,
  );

  const savedBase = {
    ...baseDraft,
    id: "11111111-1111-4111-8111-111111111111",
    leadId: "22222222-2222-4222-8222-222222222222",
    status: "draft",
    sources: [],
    approvedAt: null,
    approvedBy: null,
    sendPolicyOverride: null,
    approvalSendPolicy: null,
    createdAt: "2026-11-16T04:00:00.000Z",
    updatedAt: "2026-11-16T04:00:00.000Z",
  };

  const parsedSavedGemini = parseSavedReplyDraftResponse({
    draft: { ...savedBase, provider: "gemini", isDemo: false },
  });
  assert.equal(parsedSavedGemini?.provider, "gemini");
  assert.equal(parsedSavedGemini?.isDemo, false);

  assert.equal(
    parseSavedReplyDraftResponse({
      draft: { ...savedBase, provider: "gemini", isDemo: true },
    }),
    null,
  );
  assert.equal(
    parseSavedReplyDraftResponse({
      draft: { ...savedBase, provider: "mock", isDemo: false },
    }),
    null,
  );
});
