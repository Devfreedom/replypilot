import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CustomerMessageQuote,
  DraftAbstentionBanner,
  DraftApproveButton,
  DraftCopyReplyButton,
} from "../components/draft-reply-guardrails.js";
import {
  dashboardViewHref,
  isDraftApprovalBlockedByAbstention,
  parseDashboardView,
  parseLeadCreationError,
  parseReplyDraftResponse,
  parseSavedReplyDraftResponse,
  resolveDraftAbstentionNotice,
  resolveDraftReplyBanner,
  shouldShowCustomerMessageToggle,
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

test("resolveDraftReplyBanner separates workspace provider from persisted draft provenance", () => {
  const geminiDraft = { provider: "gemini", isDemo: false } as const;
  const mockDraft = { provider: "mock", isDemo: true } as const;

  // Loading, error, and unloaded states render no banner regardless of provider.
  assert.equal(
    resolveDraftReplyBanner({
      isLoading: true,
      error: null,
      selectedDraft: null,
      replyDraftProvider: "mock",
    }),
    null,
  );
  assert.equal(
    resolveDraftReplyBanner({
      isLoading: true,
      error: null,
      selectedDraft: mockDraft,
      replyDraftProvider: "gemini",
    }),
    null,
  );
  assert.equal(
    resolveDraftReplyBanner({
      isLoading: false,
      error: "AI provider timed out. Please try again.",
      selectedDraft: null,
      replyDraftProvider: "mock",
    }),
    null,
  );
  assert.equal(
    resolveDraftReplyBanner({
      isLoading: false,
      error: null,
      selectedDraft: null,
      replyDraftProvider: "gemini",
    }),
    null,
  );

  // Live Gemini drafts always show the grounded neutral banner.
  for (const provider of ["gemini", "mock", null, undefined] as const) {
    assert.deepEqual(
      resolveDraftReplyBanner({
        isLoading: false,
        error: null,
        selectedDraft: geminiDraft,
        replyDraftProvider: provider,
        brandName: "ReplyPilot",
      }),
      {
        tone: "neutral",
        text: "AI-suggested reply grounded in your saved business profile and catalogue. Review and edit before approving; nothing is sent without your approval.",
      },
    );
  }

  // Historical mock draft while workspace runs Gemini references "Regenerate draft".
  const geminiWorkspaceHistoricalMock = resolveDraftReplyBanner({
    isLoading: false,
    error: null,
    selectedDraft: mockDraft,
    replyDraftProvider: "gemini",
    brandName: "ReplyPilot",
  });
  assert.equal(geminiWorkspaceHistoricalMock?.tone, "warning");
  assert.match(geminiWorkspaceHistoricalMock?.text ?? "", /Regenerate draft/);
  assert.doesNotMatch(
    geminiWorkspaceHistoricalMock?.text ?? "",
    /no live AI model is enabled/i,
  );

  // Mock draft when workspace is confirmed to use the mock provider.
  const mockWorkspaceBanner = resolveDraftReplyBanner({
    isLoading: false,
    error: null,
    selectedDraft: mockDraft,
    replyDraftProvider: "mock",
    brandName: "ReplyPilot",
  });
  assert.deepEqual(mockWorkspaceBanner, {
    tone: "warning",
    text: "Demonstration output from ReplyPilot's mock provider (no live AI model is enabled). Approval records your review; nothing sends automatically without your explicit action.",
  });

  // Mock draft before /api/workspace resolves replyDraftProvider makes no claim
  // about whether a live AI model is enabled or disabled.
  for (const unresolvedProvider of [null, undefined] as const) {
    const unresolvedBanner = resolveDraftReplyBanner({
      isLoading: false,
      error: null,
      selectedDraft: mockDraft,
      replyDraftProvider: unresolvedProvider,
      brandName: "ReplyPilot",
    });
    assert.equal(unresolvedBanner?.tone, "warning");
    assert.match(unresolvedBanner?.text ?? "", /mock provider/i);
    assert.doesNotMatch(
      unresolvedBanner?.text ?? "",
      /no live AI model is enabled/i,
    );
  }
});

test("Step 2 parses draft decisions, customer message toggle heuristic, and abstention approval lock", () => {
  const savedBase = {
    id: "11111111-1111-4111-8111-111111111111",
    leadId: "22222222-2222-4222-8222-222222222222",
    intent: "general-enquiry",
    summary: "Out-of-domain enquiry.",
    missingInformation: ["Human review required"],
    draftReply:
      "Manual review required: this enquiry falls outside approved business information.",
    provider: "gemini",
    isDemo: false,
    status: "draft",
    sources: [],
    approvedAt: null,
    approvedBy: null,
    sendPolicyOverride: null,
    approvalSendPolicy: null,
    createdAt: "2026-11-16T04:00:00.000Z",
    updatedAt: "2026-11-16T04:00:00.000Z",
  };

  // Explicit decisions parse cleanly and omitted legacy decision defaults to 'reply'
  const abstained = parseSavedReplyDraftResponse({
    draft: { ...savedBase, decision: "abstain" },
  });
  assert.equal(abstained?.decision, "abstain");
  assert.equal(isDraftApprovalBlockedByAbstention(abstained), true);
  assert.match(resolveDraftAbstentionNotice(abstained) ?? "", /AI abstained/i);

  const clarifying = parseSavedReplyDraftResponse({
    draft: { ...savedBase, decision: "clarify" },
  });
  assert.equal(clarifying?.decision, "clarify");
  assert.equal(isDraftApprovalBlockedByAbstention(clarifying), false);
  assert.equal(resolveDraftAbstentionNotice(clarifying), null);

  const legacyOmitted = parseSavedReplyDraftResponse({ draft: savedBase });
  assert.equal(legacyOmitted?.decision, "reply");
  assert.equal(isDraftApprovalBlockedByAbstention(legacyOmitted), false);

  assert.equal(
    parseSavedReplyDraftResponse({
      draft: { ...savedBase, decision: "unknown" },
    }),
    null,
  );

  // Customer message clamp toggle heuristic
  assert.equal(shouldShowCustomerMessageToggle(""), false);
  assert.equal(shouldShowCustomerMessageToggle("   "), false);
  assert.equal(
    shouldShowCustomerMessageToggle("Hi, are rooms available next Friday?"),
    false,
  );
  assert.equal(
    shouldShowCustomerMessageToggle("Line one\nLine two"),
    true,
  );
  assert.equal(shouldShowCustomerMessageToggle("A".repeat(141)), true);
});

test("Step 2 renders Compose customer message quote with clamp toggle and abstain disabled approve state", () => {
  // Short message renders read-only quote without toggle
  const shortMarkup = renderToStaticMarkup(
    createElement(CustomerMessageQuote, {
      message: "Are suites available next Friday?",
      expanded: false,
      onToggle: () => undefined,
    }),
  );
  assert.match(shortMarkup, /Customer message/);
  assert.match(shortMarkup, /Are suites available next Friday\?/);
  assert.match(shortMarkup, /line-clamp-2/);
  assert.doesNotMatch(shortMarkup, /Show more/);

  // Long message renders clamped quote with Show more, then unclamped with Show less
  const longMessage = `${"We would like to book three rooms for our team retreat next month. ".repeat(4)}`;
  const collapsedMarkup = renderToStaticMarkup(
    createElement(CustomerMessageQuote, {
      message: longMessage,
      expanded: false,
      onToggle: () => undefined,
    }),
  );
  assert.match(collapsedMarkup, /Show more/);
  assert.match(collapsedMarkup, /aria-expanded="false"/);
  assert.match(collapsedMarkup, /line-clamp-2/);

  const expandedMarkup = renderToStaticMarkup(
    createElement(CustomerMessageQuote, {
      message: longMessage,
      expanded: true,
      onToggle: () => undefined,
    }),
  );
  assert.match(expandedMarkup, /Show less/);
  assert.match(expandedMarkup, /aria-expanded="true"/);
  assert.doesNotMatch(expandedMarkup, /line-clamp-2/);

  // Abstention warning banner + disabled Approve / Approve & queue buttons
  const bannerMarkup = renderToStaticMarkup(
    createElement(DraftAbstentionBanner, {
      notice: resolveDraftAbstentionNotice({ decision: "abstain" }),
    }),
  );
  assert.match(bannerMarkup, /role="alert"/);
  assert.match(bannerMarkup, /AI abstained/);

  const disabledApproveSend = renderToStaticMarkup(
    createElement(DraftApproveButton, {
      draft: { decision: "abstain" },
      isBusy: false,
      hasUnsavedChanges: false,
      pendingApprove: false,
      effectiveSendPolicy: "approve_and_send",
      onApprove: () => undefined,
    }),
  );
  assert.match(disabledApproveSend, /disabled=""/);
  assert.match(disabledApproveSend, /Approve and queue/);

  const enabledApproveSend = renderToStaticMarkup(
    createElement(DraftApproveButton, {
      draft: { decision: "reply" },
      isBusy: false,
      hasUnsavedChanges: false,
      pendingApprove: false,
      effectiveSendPolicy: "approve_and_send",
      onApprove: () => undefined,
    }),
  );
  assert.doesNotMatch(enabledApproveSend, /disabled=""/);

  // Copy reply button is disabled and ignores clicks when decision === "abstain"
  let copyCalls = 0;
  const abstainedCopyElement = DraftCopyReplyButton({
    draft: { decision: "abstain" },
    editedReply:
      "Manual review required: this enquiry falls outside approved business information.",
    isBusy: false,
    onCopy: () => {
      copyCalls += 1;
    },
  });
  const disabledCopyMarkup = renderToStaticMarkup(abstainedCopyElement);
  assert.match(disabledCopyMarkup, /disabled=""/);
  assert.match(disabledCopyMarkup, /Copy reply/);
  abstainedCopyElement.props.onClick();
  assert.equal(copyCalls, 0);

  const enabledCopyElement = DraftCopyReplyButton({
    draft: { decision: "reply" },
    editedReply: "Hi Ada, our Deluxe Suite is GBP 180.00 per night.",
    isBusy: false,
    onCopy: () => {
      copyCalls += 1;
    },
  });
  const enabledCopyMarkup = renderToStaticMarkup(enabledCopyElement);
  assert.doesNotMatch(enabledCopyMarkup, /disabled=""/);
  enabledCopyElement.props.onClick();
  assert.equal(copyCalls, 1);
});
