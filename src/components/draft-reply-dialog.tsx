"use client";

import {
  Activity,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { BRAND } from "@/lib/brand";
import {
  REPLY_DRAFT_MAX_LENGTH,
  validateDraftReplyText,
} from "@/lib/lead-validation";
import {
  parseReplyDraftApprovalResponse,
  parseReplyDraftsResponse,
  parseSavedReplyDraftResponse,
  parseSendReplyDraftResponse,
  type Lead,
  type ReplyDraftSource,
  type ReplyDraft,
  type SavedReplyDraft,
} from "@/lib/leads";
import {
  APPROVAL_SEND_POLICIES,
  APPROVAL_SEND_POLICY_LABELS,
  OUTBOUND_STATUS_DESCRIPTIONS,
  OUTBOUND_STATUS_LABELS,
  isRetryableConversationStatus,
  parseMessagingSettingsResponse,
  parseOutboundMessageLookupResponse,
  preferredConversationIdForDraft,
  sendPolicyChoiceForDraftSelection,
  shouldClearOutboundOnDraftUpdate,
  type ApprovalSendPolicy,
  type OutboundMessage,
} from "@/lib/messaging";
import {
  conversationOptionLabel,
  parseConversationsResponse,
  type WhatsAppConversation,
} from "@/lib/whatsapp";
import { useAuth } from "./auth-provider";
import {
  apiErrorMessage,
  isConversationLinkable,
  linkableConversationLabel,
  parseLinkableConversations,
  type LinkableConversation,
} from "@/lib/conversation-linking";

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorMessage(data: unknown, fallback: string): string {
  // The shared helper prefers the server's own message and falls back to the
  // guidance for the stable code, so a coded body never shows a generic
  // sentence.
  return apiErrorMessage(data, fallback);
}

function formatDraftTime(timestamp: string): string {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const intentLabels: Record<ReplyDraft["intent"], string> = {
  availability: "Availability",
  pricing: "Pricing",
  "service-details": "Service details",
  booking: "Booking",
  "general-enquiry": "General enquiry",
};

const sourceTypeLabels: Record<ReplyDraftSource["type"], string> = {
  catalogue: "Catalogue",
  faq: "FAQ",
  policy: "Policy",
};

type SendPolicyChoice = "default" | ApprovalSendPolicy;

const inputClass = "input mt-1";
const labelClass = "field-label";

function StatusBadge({ status }: { status: SavedReplyDraft["status"] }) {
  const approved = status === "approved";

  return (
    <span className={`badge ${approved ? "badge-approved" : "badge-draft"}`}>
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          approved ? "bg-success" : "bg-warning"
        }`}
      />
      {approved ? "Approved for review" : "Draft"}
    </span>
  );
}

function BusinessInformationUsed({
  draft,
}: {
  draft: SavedReplyDraft;
}) {
  return (
    <section aria-labelledby="business-information-used">
      <h3
        id="business-information-used"
        className="text-sm font-semibold text-ink"
      >
        Business information used
      </h3>

      {draft.sources.length === 0 ? (
        <p className="mt-2 rounded-xl border border-line bg-hushed px-4 py-3 text-sm leading-6 text-ink-soft">
          No matching approved business facts were found for this enquiry. The
          draft asks for missing information instead of inventing details.
        </p>
      ) : (
        <ul className="mt-2 space-y-3">
          {draft.sources.map((source) => (
            <li
              key={`${source.type}:${source.id}`}
              className="rounded-xl border border-line bg-hushed px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="badge badge-neutral rounded-md uppercase tracking-wide">
                  {sourceTypeLabels[source.type]}
                </span>
                <span className="text-sm font-semibold text-ink">
                  {source.title}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-ink-soft">
                {source.content}
              </p>
              <p className="mt-2 text-xs leading-5 text-ink-soft">
                {source.reason}
              </p>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-xs leading-5 text-ink-soft">
        This is the approved information captured when the draft was generated
        on {formatDraftTime(draft.createdAt)}. Business records may have changed
        since then, so review the facts before relying on them.
      </p>
    </section>
  );
}

export function DraftReplyDialog({
  lead,
  onClose,
}: {
  lead: Lead | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { role } = useAuth();
  // Linking a conversation changes workspace data, so it is an owner action,
  // the same as approving and sending.
  const canLinkConversation = role === "owner";
  const requestIdRef = useRef(0);
  const approvalContextRequestIdRef = useRef(0);
  const outboundRequestIdRef = useRef(0);
  const linkableConversationsRequestIdRef = useRef(0);
  const conversationsRequestIdRef = useRef(0);
  const loadedLeadIdRef = useRef<string | null>(null);
  const inFlightGenerationRef = useRef(false);
  const conversationsRef = useRef<WhatsAppConversation[]>([]);
  const outboundMessageRef = useRef<{
    leadId: string;
    message: OutboundMessage;
  } | null>(null);
  const [drafts, setDrafts] = useState<SavedReplyDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [editedReply, setEditedReply] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "save" | "approve" | "unapprove" | "regenerate" | "new" | "send" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [defaultApprovalSendPolicy, setDefaultApprovalSendPolicy] =
    useState<ApprovalSendPolicy>("approve_only");
  const [sendPolicyChoice, setSendPolicyChoice] =
    useState<SendPolicyChoice>("default");
  const [conversations, setConversations] = useState<WhatsAppConversation[]>(
    [],
  );
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [approvalContextError, setApprovalContextError] = useState<
    string | null
  >(null);
  const [approvalContextLoading, setApprovalContextLoading] = useState(false);
  const [outboundMessageState, setOutboundMessageState] = useState<{
    leadId: string;
    message: OutboundMessage;
  } | null>(null);
  const [outboundLoading, setOutboundLoading] = useState(false);
  const [outboundLoadError, setOutboundLoadError] = useState<string | null>(
    null,
  );
  const [linkableConversations, setLinkableConversations] = useState<
    LinkableConversation[]
  >([]);
  const [linkableLoading, setLinkableLoading] = useState(false);
  const [linkingConversationId, setLinkingConversationId] = useState<
    string | null
  >(null);
  const [selectedLinkableConversationId, setSelectedLinkableConversationId] =
    useState("");
  const [linkingError, setLinkingError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"compose" | "context" | "history">(
    "compose",
  );

  const selectedDraft =
    drafts.find((draft) => draft.id === selectedDraftId) ?? null;
  const outboundMessage =
    lead &&
    selectedDraft &&
    outboundMessageState?.leadId === lead.id &&
    outboundMessageState.message.replyDraftId === selectedDraft.id
      ? outboundMessageState.message
      : null;
  const hasUnsavedChanges = selectedDraft
    ? editedReply !== selectedDraft.draftReply
    : false;
  const isBusy = pendingAction !== null;
  const effectiveSendPolicy: ApprovalSendPolicy =
    sendPolicyChoice === "default"
      ? defaultApprovalSendPolicy
      : sendPolicyChoice;
  const eligibleConversations = lead
    ? conversations.filter(
        (conversation) =>
          conversation.leadId === lead.id &&
          isRetryableConversationStatus(conversation.status),
      )
    : [];
  const outboundConversation = outboundMessage
    ? conversations.find(
        (conversation) =>
          conversation.id === outboundMessage.conversationId,
      ) ?? null
    : null;
  const outboundConversationIsEligible =
    outboundMessage !== null &&
    eligibleConversations.some(
      (conversation) => conversation.id === outboundMessage.conversationId,
    );
  const retryBlockedByContentChange =
    outboundMessage?.status === "failed" &&
    selectedDraft !== null &&
    outboundMessage.content !== selectedDraft.draftReply;
  const retryBlockedByInactiveConversation =
    outboundMessage?.status === "failed" && !outboundConversationIsEligible;
  const outboundAlreadyHandled =
    outboundMessage !== null && outboundMessage.status !== "failed";

  const setConversationsForLead = useCallback(
    (leadId: string, nextConversations: WhatsAppConversation[]) => {
      conversationsRef.current = nextConversations;
      setConversations(nextConversations);
      setSelectedConversationId(
        preferredConversationIdForDraft(
          outboundMessageRef.current?.leadId === leadId
            ? outboundMessageRef.current.message.conversationId
            : null,
          nextConversations.filter(
            (conversation) =>
              conversation.leadId === leadId &&
              isRetryableConversationStatus(conversation.status),
          ),
        ),
      );
    },
    [],
  );

  const setOutboundForLead = useCallback(
    (leadId: string, nextOutboundMessage: OutboundMessage | null) => {
      const scoped = nextOutboundMessage
        ? { leadId, message: nextOutboundMessage }
        : null;
      outboundMessageRef.current = scoped;
      setOutboundMessageState(scoped);
      setSelectedConversationId(
        preferredConversationIdForDraft(
          nextOutboundMessage?.conversationId ?? null,
          conversationsRef.current.filter(
            (conversation) =>
              conversation.leadId === leadId &&
              isRetryableConversationStatus(conversation.status),
          ),
        ),
      );
    },
    [],
  );

  function replaceDraft(nextDraft: SavedReplyDraft) {
    if (shouldClearOutboundOnDraftUpdate(selectedDraftId, nextDraft)) {
      outboundRequestIdRef.current += 1;
      setOutboundForLead(lead?.id ?? "", null);
      setOutboundLoadError(null);
      setOutboundLoading(false);
    }

    setSendPolicyChoice((choice) =>
      sendPolicyChoiceForDraftSelection(
        selectedDraftId,
        nextDraft.id,
        choice,
      ),
    );
    setDrafts((current) => {
      const exists = current.some((draft) => draft.id === nextDraft.id);

      if (!exists) {
        return [nextDraft, ...current];
      }

      return current.map((draft) =>
        draft.id === nextDraft.id ? nextDraft : draft,
      );
    });
    setSelectedDraftId(nextDraft.id);
    setEditedReply(nextDraft.draftReply);
  }

  function selectDraft(draft: SavedReplyDraft) {
    outboundRequestIdRef.current += 1;
    setSendPolicyChoice((choice) =>
      sendPolicyChoiceForDraftSelection(
        selectedDraftId,
        draft.id,
        choice,
      ),
    );
    setSelectedDraftId(draft.id);
    setEditedReply(draft.draftReply);
    setActionError(null);
    setValidationError(null);
    setNotice(null);
    setCopyMessage(null);
    setActiveTab("compose");
    setOutboundForLead(lead?.id ?? "", null);
    setOutboundLoadError(null);
    if (lead) {
      void loadOutboundMessage(draft.id, lead.id);
    }
  }

  const loadOutboundMessage = useCallback(
    async (draftId: string, leadId: string) => {
      const requestId = ++outboundRequestIdRef.current;
      const conversationsRequestId = ++conversationsRequestIdRef.current;
      setOutboundLoading(true);
      setOutboundLoadError(null);

      try {
        const [response, conversationsResponse] = await Promise.all([
          fetch(`/api/outbound-messages/by-draft/${draftId}`),
          fetch(`/api/conversations/by-lead/${leadId}`),
        ]);
        const [data, conversationsData] = await Promise.all([
          readJson(response),
          readJson(conversationsResponse),
        ]);

        if (!response.ok) {
          throw new Error(
            errorMessage(data, "Unable to load this draft's outbound status."),
          );
        }

        if (!conversationsResponse.ok) {
          throw new Error(
            errorMessage(
              conversationsData,
              "Unable to refresh WhatsApp conversation status.",
            ),
          );
        }

        const result = parseOutboundMessageLookupResponse(data);

        if (!result) {
          throw new Error(
            "The outbound message service returned an unexpected response.",
          );
        }

        const conversationResult =
          parseConversationsResponse(conversationsData);

        if (!conversationResult) {
          throw new Error(
            "The conversation service returned an unexpected response.",
          );
        }

        if (
          requestId === outboundRequestIdRef.current &&
          conversationsRequestId === conversationsRequestIdRef.current
        ) {
          setConversationsForLead(leadId, conversationResult.conversations);
          setOutboundForLead(leadId, result.outboundMessage);
        }
      } catch (requestError) {
        if (
          requestId === outboundRequestIdRef.current &&
          conversationsRequestId === conversationsRequestIdRef.current
        ) {
          setOutboundLoadError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to load this draft's outbound status.",
          );
        }
      } finally {
        if (requestId === outboundRequestIdRef.current) {
          setOutboundLoading(false);
        }
      }
    },
    [setConversationsForLead, setOutboundForLead],
  );

  async function loadApprovalContext(selectedLead: Lead) {
      const requestId = ++approvalContextRequestIdRef.current;
      const conversationsRequestId = ++conversationsRequestIdRef.current;
      setApprovalContextLoading(true);
      setApprovalContextError(null);
      setConversationsForLead(selectedLead.id, []);
      setSelectedConversationId("");

      try {
        const [settingsResponse, conversationsResponse] = await Promise.all([
          fetch("/api/settings/messaging"),
          fetch(`/api/conversations/by-lead/${selectedLead.id}`),
        ]);
        const [settingsData, conversationsData] = await Promise.all([
          readJson(settingsResponse),
          readJson(conversationsResponse),
        ]);

        if (requestId !== approvalContextRequestIdRef.current) return;

        if (!settingsResponse.ok) {
          setApprovalContextError(
            errorMessage(
              settingsData,
              "Unable to load workspace messaging settings.",
            ),
          );
          return;
        }

        const settings = parseMessagingSettingsResponse(settingsData);

        if (!settings) {
          setApprovalContextError(
            "The messaging settings service returned an unexpected response.",
          );
          return;
        }

        setDefaultApprovalSendPolicy(settings.defaultApprovalSendPolicy);

        if (!conversationsResponse.ok) {
          setApprovalContextError(
            errorMessage(
              conversationsData,
              "Unable to load WhatsApp conversations for this lead.",
            ),
          );
          return;
        }

        const result = parseConversationsResponse(conversationsData);

        if (!result) {
          setApprovalContextError(
            "The conversation service returned an unexpected response.",
          );
          return;
        }

        if (
          conversationsRequestId === conversationsRequestIdRef.current
        ) {
          setConversationsForLead(selectedLead.id, result.conversations);
        }
      } catch {
        if (requestId === approvalContextRequestIdRef.current) {
          setApprovalContextError(
            "Unable to load approval settings and conversations.",
          );
        }
      } finally {
        if (requestId === approvalContextRequestIdRef.current) {
          setApprovalContextLoading(false);
        }
      }
  }

  async function loadLinkableConversations(selectedLead: Lead) {
    // Linking a conversation changes workspace data, so it is an owner action.
    // A member never sees the list, so the request is never made.
    if (!canLinkConversation) {
      setLinkableConversations([]);
      return;
    }

    const requestId = ++linkableConversationsRequestIdRef.current;

    setLinkableLoading(true);
    setLinkingError(null);

    try {
      const response = await fetch(
        `/api/leads/${selectedLead.id}/whatsapp-conversations?limit=100`,
      );
      const data = await readJson(response);

      if (requestId !== linkableConversationsRequestIdRef.current) return;

      if (!response.ok) {
        setLinkingError(
          apiErrorMessage(data, "Unable to load WhatsApp conversations."),
        );
        return;
      }

      const page = parseLinkableConversations(data);

      if (!page) {
        setLinkingError(
          "The conversation service returned an unexpected response.",
        );
        return;
      }

      setLinkableConversations(page.conversations);
    } catch {
      if (requestId !== linkableConversationsRequestIdRef.current) return;

      setLinkingError("Unable to load WhatsApp conversations.");
    } finally {
      if (requestId === linkableConversationsRequestIdRef.current) {
        setLinkableLoading(false);
      }
    }
  }

  async function linkConversation(conversationId: string) {
    if (!lead || !conversationId) {
      return;
    }

    setLinkingConversationId(conversationId);
    setLinkingError(null);
    setActionError(null);

    try {
      const response = await fetch(
        `/api/leads/${lead.id}/whatsapp-conversations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId }),
        },
      );
      const data = await readJson(response);

      if (!response.ok) {
        setLinkingError(
          apiErrorMessage(data, "Unable to link this WhatsApp conversation."),
        );
        return;
      }

      setSelectedLinkableConversationId("");
      setNotice(
        "WhatsApp conversation linked to this lead. You can now queue a reply.",
      );

      await Promise.all([
        loadLinkableConversations(lead),
        loadApprovalContext(lead),
      ]);
    } catch {
      setLinkingError("Unable to link this WhatsApp conversation.");
    } finally {
      setLinkingConversationId(null);
    }
  }

  async function loadDrafts(selectedLead: Lead) {
      const requestId = ++requestIdRef.current;
      setIsLoading(true);
      setError(null);
      setActionError(null);
      setValidationError(null);
      setNotice(null);
      setCopyMessage(null);
      setDrafts([]);
      setSelectedDraftId(null);
      setEditedReply("");
      setSendPolicyChoice("default");
      setLinkableConversations([]);
      setSelectedLinkableConversationId("");
      setLinkingError(null);
      setActiveTab("compose");
      setOutboundForLead(selectedLead.id, null);
      setOutboundLoadError(null);
      setOutboundLoading(false);
      outboundRequestIdRef.current += 1;

      try {
        const response = await fetch(
          `/api/leads/${selectedLead.id}/reply-drafts`,
        );
        const data = await readJson(response);

        if (!response.ok) {
          throw new Error(
            errorMessage(data, "Unable to load saved reply drafts."),
          );
        }

        const savedDrafts = parseReplyDraftsResponse(data);

        if (!savedDrafts) {
          throw new Error("The draft service returned an unexpected response.");
        }

        if (requestId !== requestIdRef.current) return;

        if (savedDrafts.length > 0) {
          setDrafts(savedDrafts);
          setSelectedDraftId(savedDrafts[0].id);
          setEditedReply(savedDrafts[0].draftReply);
          void loadOutboundMessage(savedDrafts[0].id, selectedLead.id);
          return;
        }

        const createResponse = await fetch(
          `/api/leads/${selectedLead.id}/reply-drafts`,
          { method: "POST" },
        );
        const createData = await readJson(createResponse);

        if (!createResponse.ok) {
          throw new Error(
            errorMessage(createData, "Unable to generate a draft reply."),
          );
        }

        const createdDraft = parseSavedReplyDraftResponse(createData);

        if (!createdDraft) {
          throw new Error("The draft service returned an unexpected response.");
        }

        if (requestId !== requestIdRef.current) return;

        setDrafts([createdDraft]);
        setSelectedDraftId(createdDraft.id);
        setEditedReply(createdDraft.draftReply);
      } catch (requestError) {
        if (requestId !== requestIdRef.current) return;

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load saved reply drafts.",
        );
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
  }

  const invalidateLeadRequests = useCallback(() => {
    requestIdRef.current += 1;
    approvalContextRequestIdRef.current += 1;
    outboundRequestIdRef.current += 1;
    conversationsRequestIdRef.current += 1;
    linkableConversationsRequestIdRef.current += 1;
    conversationsRef.current = [];
    outboundMessageRef.current = null;
  }, []);

  const resetDialogState = useCallback(() => {
    invalidateLeadRequests();
    setDrafts([]);
    setSelectedDraftId(null);
    setEditedReply("");
    setIsLoading(false);
    setError(null);
    setActionError(null);
    setValidationError(null);
    setNotice(null);
    setCopyMessage(null);
    setSendPolicyChoice("default");
    setConversations([]);
    setSelectedConversationId("");
    setApprovalContextError(null);
    setApprovalContextLoading(false);
    setOutboundMessageState(null);
    setOutboundLoading(false);
    setOutboundLoadError(null);
    setLinkableConversations([]);
    setLinkableLoading(false);
    setLinkingConversationId(null);
    setSelectedLinkableConversationId("");
    setLinkingError(null);
    setActiveTab("compose");
  }, [invalidateLeadRequests]);

  function handleDialogClose() {
    loadedLeadIdRef.current = null;
    resetDialogState();
    onClose();
  }

  const loadApprovalContextForEffect = useEffectEvent(loadApprovalContext);
  const loadDraftsForEffect = useEffectEvent(loadDrafts);
  const loadLinkableConversationsForEffect = useEffectEvent(
    loadLinkableConversations,
  );

  useLayoutEffect(() => {
    const dialog = dialogRef.current;

    return () => {
      if (dialog?.open) {
        dialog.close();
      }
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) return;

    if (lead) {
      if (!dialog.open) {
        dialog.showModal();
      }

      if (loadedLeadIdRef.current !== lead.id) {
        loadedLeadIdRef.current = lead.id;
        invalidateLeadRequests();
        void loadDraftsForEffect(lead);
        void loadApprovalContextForEffect(lead);
        void loadLinkableConversationsForEffect(lead);
      }
    } else {
      loadedLeadIdRef.current = null;
      invalidateLeadRequests();

      if (dialog.open) {
        dialog.close();
      }
    }
  }, [lead, invalidateLeadRequests]);

  async function saveReply() {
    if (!lead || !selectedDraft) return;

    const replyError = validateDraftReplyText(editedReply);

    if (replyError) {
      setValidationError(replyError);
      document.getElementById("draft-reply")?.focus();
      return;
    }

    setPendingAction("save");
    setActionError(null);
    setValidationError(null);
    setNotice(null);
    setCopyMessage(null);

    try {
      const response = await fetch(
        `/api/leads/${lead.id}/reply-drafts/${selectedDraft.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftReply: editedReply }),
        },
      );
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(errorMessage(data, "Unable to save the draft reply."));
      }

      const savedDraft = parseSavedReplyDraftResponse(data);

      if (!savedDraft) {
        throw new Error("The draft service returned an unexpected response.");
      }

      replaceDraft(savedDraft);
      setNotice(
        "Draft saved. Your edits may no longer be supported by the original business facts, so review and approve them explicitly.",
      );
    } catch (requestError) {
      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to save the draft reply.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function updateStatus(status: "draft" | "approved") {
    if (!lead || !selectedDraft) return;

    if (status === "approved" && effectiveSendPolicy === "approve_and_send") {
      if (approvalContextLoading || approvalContextError) {
        setActionError(
          approvalContextError ??
            "Wait for approval settings and conversations to finish loading.",
        );
        return;
      }

      if (eligibleConversations.length === 0) {
        setActionError(
          "This lead has no WhatsApp conversation yet. Link an existing conversation to this lead, or wait until the customer messages the business number.",
        );
        return;
      }

      if (
        eligibleConversations.length > 1 &&
        selectedConversationId === ""
      ) {
        setValidationError(
          "Choose which WhatsApp conversation should receive this reply.",
        );
        return;
      }
    }

    setPendingAction(status === "approved" ? "approve" : "unapprove");
    setActionError(null);
    setValidationError(null);
    setNotice(null);
    setCopyMessage(null);

    try {
      const body: {
        status: "draft" | "approved";
        sendPolicy?: ApprovalSendPolicy;
        conversationId?: string;
      } = { status };

      if (status === "approved") {
        if (sendPolicyChoice !== "default") {
          body.sendPolicy = sendPolicyChoice;
        }

        if (selectedConversationId) {
          body.conversationId = selectedConversationId;
        }
      }

      const response = await fetch(
        `/api/leads/${lead.id}/reply-drafts/${selectedDraft.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(
          errorMessage(
            data,
            status === "approved"
              ? "Unable to approve the draft reply."
              : "Unable to return the draft to review.",
          ),
        );
      }

      if (status === "approved") {
        const result = parseReplyDraftApprovalResponse(data);

        if (!result) {
          throw new Error(
            "The draft service returned an unexpected response.",
          );
        }

        replaceDraft(result.draft);
        setOutboundForLead(lead.id, result.outboundMessage);
        setNotice(
          result.outboundMessage
            ? `Draft approved and ${OUTBOUND_STATUS_LABELS[result.outboundMessage.status].toLowerCase()} for the mock worker. Provider acceptance is not delivery.`
            : "Draft marked approved for review. No customer message has been sent.",
        );
        return;
      }

      const updatedDraft = parseSavedReplyDraftResponse(data);

      if (!updatedDraft) {
        throw new Error("The draft service returned an unexpected response.");
      }

      replaceDraft(updatedDraft);
      setOutboundForLead(lead.id, null);
      setNotice(
        "Draft returned to draft status. Review the text and approve it when ready.",
      );
    } catch (requestError) {
      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to update the draft status.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function queueApprovedSend() {
    if (!lead || !selectedDraft) return;

    if (outboundLoading || outboundLoadError) {
      setActionError(
        outboundLoadError ??
          "Wait for the existing outbound status to finish loading.",
      );
      return;
    }

    if (approvalContextLoading || approvalContextError) {
      setActionError(
        approvalContextError ??
          "Wait for eligible conversations to finish loading.",
      );
      return;
    }

    if (hasUnsavedChanges) {
      setActionError("Save your changes before queueing this approved reply.");
      return;
    }

    if (retryBlockedByContentChange) {
      setActionError(
        "This failed message contains an earlier content snapshot. Create a new draft to send the revised reply.",
      );
      return;
    }

    if (retryBlockedByInactiveConversation) {
      setActionError(
        "The original conversation is no longer active. This message cannot be retargeted; create a new draft for an active conversation.",
      );
      return;
    }

    if (
      outboundMessage?.status === "failed" &&
      selectedConversationId !== outboundMessage.conversationId
    ) {
      setActionError(
        "A failed message can only be retried to its original conversation.",
      );
      return;
    }

    if (eligibleConversations.length === 0) {
      setActionError(
        "This lead has no WhatsApp conversation yet. Link an existing conversation to this lead, or wait until the customer messages the business number.",
      );
      return;
    }

    if (eligibleConversations.length > 1 && selectedConversationId === "") {
      setValidationError(
        "Choose which WhatsApp conversation should receive this reply.",
      );
      return;
    }

    setPendingAction("send");
    setActionError(null);
    setValidationError(null);
    setNotice(null);
    setCopyMessage(null);

    try {
      const body: { conversationId?: string } = {};

      if (selectedConversationId) {
        body.conversationId = selectedConversationId;
      }

      const response = await fetch(
        `/api/reply-drafts/${selectedDraft.id}/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(
          errorMessage(data, "Unable to queue the approved reply."),
        );
      }

      const queued = parseSendReplyDraftResponse(data);

      if (!queued) {
        throw new Error("The draft service returned an unexpected response.");
      }

      setOutboundForLead(lead.id, queued);
      setNotice(
        `Approved reply ${OUTBOUND_STATUS_LABELS[queued.status].toLowerCase()} for the mock worker. Provider acceptance is not delivery.`,
      );
    } catch (requestError) {
      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to queue the approved reply.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function createNewDraft() {
    if (!lead || isLoading || pendingAction !== null || inFlightGenerationRef.current) {
      return;
    }

    inFlightGenerationRef.current = true;
    setPendingAction("new");
    setActionError(null);
    setValidationError(null);
    setNotice(null);
    setCopyMessage(null);

    try {
      const response = await fetch(`/api/leads/${lead.id}/reply-drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(
          errorMessage(data, "Unable to create a new draft reply."),
        );
      }

      const newDraft = parseSavedReplyDraftResponse(data);

      if (!newDraft) {
        throw new Error("The draft service returned an unexpected response.");
      }

      replaceDraft(newDraft);
      setOutboundForLead(lead.id, null);
      setNotice(
        "New draft created from the current approved business facts. Review and edit it before approval.",
      );
    } catch (requestError) {
      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to create a new draft reply.",
      );
    } finally {
      inFlightGenerationRef.current = false;
      setPendingAction(null);
    }
  }

  async function regenerateDraft() {
    if (
      !lead ||
      !selectedDraft ||
      isLoading ||
      pendingAction !== null ||
      inFlightGenerationRef.current
    ) {
      return;
    }

    inFlightGenerationRef.current = true;
    setPendingAction("regenerate");
    setActionError(null);
    setValidationError(null);
    setNotice(null);
    setCopyMessage(null);

    try {
      const response = await fetch(
        `/api/leads/${lead.id}/reply-drafts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftId: selectedDraft.id }),
        },
      );
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(
          errorMessage(data, "Unable to regenerate the draft reply."),
        );
      }

      const regeneratedDraft = parseSavedReplyDraftResponse(data);

      if (!regeneratedDraft) {
        throw new Error("The draft service returned an unexpected response.");
      }

      replaceDraft(regeneratedDraft);
      setNotice(
        "Draft regenerated from the current approved business facts. Approval was reset because the content changed.",
      );
    } catch (requestError) {
      setActionError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to regenerate the draft reply.",
      );
    } finally {
      inFlightGenerationRef.current = false;
      setPendingAction(null);
    }
  }

  async function copyReply() {
    if (!editedReply.trim()) return;

    setNotice(null);
    setActionError(null);
    setCopyMessage(null);

    try {
      await navigator.clipboard.writeText(editedReply);
      setCopyMessage("Current reply text copied to your clipboard.");
    } catch {
      setCopyMessage(
        "Unable to copy the reply. Please select and copy it manually.",
      );
    }
  }

  function handleBackdropClick(event: React.MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) {
      dialogRef.current?.close();
    }
  }

  const linkableChoices = lead
    ? linkableConversations.filter((conversation) =>
        isConversationLinkable(conversation, lead.id),
      )
    : [];

  return (
    <dialog
      ref={dialogRef}
      onClose={handleDialogClose}
      onClick={handleBackdropClick}
      aria-labelledby="draft-reply-title"
      aria-describedby="draft-reply-demo"
      className="m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-3xl overflow-y-auto rounded-2xl border border-line bg-surface p-5 text-ink shadow-2xl sm:p-7"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
        <div className="min-w-0">
          <h2
            id="draft-reply-title"
            className="text-xl font-bold text-ink"
          >
            Draft reply
          </h2>
          {lead ? (
            <p className="mt-1 truncate text-sm leading-6 text-ink-soft">
              {lead.name} ({lead.service})
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close draft reply"
          className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-2xl leading-none text-ink-soft hover:bg-hushed hover:text-ink"
        >
          &times;
        </button>
      </div>

      {selectedDraft && !selectedDraft.isDemo ? (
        <p
          id="draft-reply-demo"
          className="mt-4 rounded-xl border border-line bg-hushed/80 px-4 py-3 text-xs leading-5 text-ink-soft sm:text-sm sm:leading-6"
        >
          AI-suggested reply grounded in your saved business profile and
          catalogue. Review and edit before approving; nothing is sent without
          your approval.
        </p>
      ) : (
        <p
          id="draft-reply-demo"
          className="mt-4 rounded-xl border border-[color-mix(in_oklab,var(--rp-warning)_32%,transparent)] bg-warning-soft px-4 py-3 text-xs leading-5 text-warning-ink sm:text-sm sm:leading-6"
        >
          Demonstration output from {BRAND.name}&apos;s mock provider (no live
          AI model is enabled). Approval records your review; nothing sends
          automatically without your explicit action.
        </p>
      )}

      {isLoading ? (
        <div role="status" className="py-12 text-center text-sm text-ink-soft">
          Preparing reply draft from your business details…
        </div>
      ) : error ? (
        <div role="alert" className="py-10 text-center">
          <h3 className="font-semibold text-ink">
            Unable to prepare a draft
          </h3>
          <p className="mt-1 text-sm text-ink-soft">{error}</p>
          {lead ? (
            <button
              type="button"
              onClick={() => void loadDrafts(lead)}
              className="btn btn-secondary mt-4"
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : selectedDraft ? (
        <div className="mt-5 space-y-5" aria-busy={isBusy}>
          {/* Status + section navigation tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={selectedDraft.status} />
              <span className="badge badge-neutral">
                {intentLabels[selectedDraft.intent]}
              </span>
              {selectedDraft.approvedAt ? (
                <span className="numeric-tabular text-xs text-ink-soft">
                  Approved {formatDraftTime(selectedDraft.approvedAt)}
                </span>
              ) : null}
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Draft workspace sections"
            className="grid grid-cols-3 gap-1.5 rounded-xl border border-line bg-hushed p-1"
          >
            <button
              id="draft-tab-compose"
              type="button"
              role="tab"
              aria-selected={activeTab === "compose"}
              aria-controls="draft-panel-compose"
              onClick={() => setActiveTab("compose")}
              className={`min-h-10 cursor-pointer rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors sm:text-sm ${
                activeTab === "compose"
                  ? "bg-surface text-ink shadow-xs"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              Compose
            </button>
            <button
              id="draft-tab-context"
              type="button"
              role="tab"
              aria-selected={activeTab === "context"}
              aria-controls="draft-panel-context"
              onClick={() => setActiveTab("context")}
              className={`min-h-10 cursor-pointer rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors sm:text-sm ${
                activeTab === "context"
                  ? "bg-surface text-ink shadow-xs"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              Facts ({selectedDraft.sources.length})
            </button>
            <button
              id="draft-tab-history"
              type="button"
              role="tab"
              aria-selected={activeTab === "history"}
              aria-controls="draft-panel-history"
              onClick={() => setActiveTab("history")}
              className={`min-h-10 cursor-pointer rounded-lg px-2.5 py-2 text-xs font-semibold transition-colors sm:text-sm ${
                activeTab === "history"
                  ? "bg-surface text-ink shadow-xs"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              History ({drafts.length})
            </button>
          </div>

          <Activity mode={activeTab === "compose" ? "visible" : "hidden"}>
            <div
              id="draft-panel-compose"
              role="tabpanel"
              aria-labelledby="draft-tab-compose"
              className="space-y-5"
            >
              {selectedDraft.missingInformation.length > 0 ? (
                <div className="rounded-xl border border-[color-mix(in_oklab,var(--rp-warning)_32%,transparent)] bg-warning-soft px-4 py-3 text-xs leading-5 text-warning-ink sm:text-sm">
                  <p className="font-semibold">
                    Confirm before sending ({selectedDraft.missingInformation.length} item
                    {selectedDraft.missingInformation.length === 1 ? "" : "s"}):
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {selectedDraft.missingInformation.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Editable suggested reply */}
              <section aria-labelledby="draft-reply-editor-title">
                <div className="flex items-center justify-between gap-3">
                  <label
                    id="draft-reply-editor-title"
                    htmlFor="draft-reply"
                    className="field-label"
                  >
                    Suggested reply
                  </label>
                  <span className="numeric-tabular text-xs text-ink-faint">
                    {editedReply.length}/{REPLY_DRAFT_MAX_LENGTH}
                  </span>
                </div>
                <textarea
                  id="draft-reply"
                  value={editedReply}
                  onChange={(event) => {
                    setEditedReply(event.target.value);
                    setValidationError(null);
                    setActionError(null);
                    setNotice(null);
                    setCopyMessage(null);
                  }}
                  onBlur={() => {
                    setValidationError(
                      validateDraftReplyText(editedReply) ?? null,
                    );
                  }}
                  rows={7}
                  maxLength={REPLY_DRAFT_MAX_LENGTH}
                  aria-invalid={validationError ? true : undefined}
                  aria-describedby={
                    validationError
                      ? "draft-reply-validation-error draft-reply-edit-warning"
                      : "draft-reply-edit-warning"
                  }
                  className="textarea mt-1.5"
                />
                {validationError ? (
                  <p
                    id="draft-reply-validation-error"
                    role="alert"
                    className="mt-1.5 text-xs font-medium text-danger-ink"
                  >
                    {validationError}
                  </p>
                ) : null}
                <p id="draft-reply-edit-warning" className="help-text">
                  {hasUnsavedChanges
                    ? "You edited this draft. Save changes first so your updated wording can be reviewed before approval."
                    : "Editing a draft returns it to unapproved status so changed details are reviewed explicitly."}
                </p>
              </section>

              {actionError ? (
                <p
                  role="alert"
                  className="rounded-xl border border-[color-mix(in_oklab,var(--rp-danger)_35%,transparent)] bg-danger-soft px-4 py-3 text-sm text-danger-ink"
                >
                  {actionError}
                </p>
              ) : null}

              {notice || copyMessage ? (
                <p
                  role="status"
                  aria-live="polite"
                  className="rounded-xl border border-line bg-hushed px-4 py-2.5 text-sm text-ink"
                >
                  {notice ?? copyMessage}
                </p>
              ) : null}

              <div className="flex flex-col-reverse gap-2.5 border-t border-line pt-4 sm:flex-row sm:flex-wrap sm:justify-end">
                <button
                  type="button"
                  onClick={() => void createNewDraft()}
                  disabled={isBusy || isLoading}
                  className="btn btn-secondary"
                >
                  {pendingAction === "new" ? "Creating…" : "New draft"}
                </button>
                <button
                  type="button"
                  onClick={() => void regenerateDraft()}
                  disabled={isBusy || isLoading}
                  className="btn btn-secondary"
                >
                  {pendingAction === "regenerate"
                    ? "Regenerating…"
                    : "Regenerate draft"}
                </button>
                <button
                  type="button"
                  onClick={() => void copyReply()}
                  disabled={!editedReply.trim() || isBusy}
                  className="btn btn-secondary"
                >
                  Copy reply
                </button>
                <button
                  type="button"
                  onClick={() => void saveReply()}
                  disabled={
                    isBusy || !hasUnsavedChanges || !editedReply.trim()
                  }
                  className="btn btn-secondary"
                >
                  {pendingAction === "save" ? "Saving…" : "Save changes"}
                </button>
                {selectedDraft.status === "approved" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void queueApprovedSend()}
                      disabled={
                        isBusy ||
                        outboundLoading ||
                        approvalContextLoading ||
                        Boolean(outboundLoadError) ||
                        Boolean(approvalContextError) ||
                        outboundAlreadyHandled ||
                        hasUnsavedChanges ||
                        retryBlockedByContentChange ||
                        retryBlockedByInactiveConversation
                      }
                      className="btn btn-primary"
                    >
                      {pendingAction === "send"
                        ? "Queueing…"
                        : outboundMessage?.status === "failed"
                          ? retryBlockedByContentChange ||
                            retryBlockedByInactiveConversation
                            ? "Retry unavailable"
                            : "Retry queued send"
                          : outboundMessage?.status === "queued"
                            ? "Already queued"
                            : outboundMessage?.status === "sending"
                              ? "Sending"
                              : outboundMessage?.status === "sent"
                                ? "Already sent"
                                : outboundMessage?.status === "delivered"
                                  ? "Delivered"
                                  : outboundMessage?.status === "manual_review"
                                    ? "Needs manual review"
                                    : outboundMessage?.status === "cancelled"
                                      ? "Cannot queue cancelled message"
                                      : "Queue approved reply"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void updateStatus("draft")}
                      disabled={isBusy}
                      className="btn btn-secondary"
                    >
                      {pendingAction === "unapprove"
                        ? "Returning…"
                        : "Return to draft"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => void updateStatus("approved")}
                    disabled={isBusy || hasUnsavedChanges}
                    className="btn btn-primary"
                  >
                    {pendingAction === "approve"
                      ? effectiveSendPolicy === "approve_and_send"
                        ? "Approving and queueing…"
                        : "Approving…"
                      : effectiveSendPolicy === "approve_and_send"
                        ? "Approve and queue"
                        : "Approve draft"}
                  </button>
                )}
              </div>

              {hasUnsavedChanges ? (
                <p className="text-right text-xs text-ink-soft">
                  Save your edits before approving this draft.
                </p>
              ) : null}

              {/* Approval settings & WhatsApp target */}
              {selectedDraft.status === "draft" ? (
                <section
                  aria-labelledby="approval-behaviour-title"
                  className="rounded-xl border border-line bg-hushed/70 p-4"
                >
                  <h3
                    id="approval-behaviour-title"
                    className="text-sm font-semibold text-ink"
                  >
                    Approval settings
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-ink-soft">
                    Workspace default:{" "}
                    <strong className="text-ink">
                      {APPROVAL_SEND_POLICY_LABELS[defaultApprovalSendPolicy]}
                    </strong>
                    . Approving records your review; approve and queue also adds
                    this reply to your outbound WhatsApp queue.
                  </p>
                  <label className={`${labelClass} mt-3`}>
                    When approved
                    <select
                      value={sendPolicyChoice}
                      onChange={(event) =>
                        setSendPolicyChoice(
                          event.target.value as SendPolicyChoice,
                        )
                      }
                      disabled={isBusy}
                      className={inputClass}
                    >
                      <option value="default">
                        Use workspace default (
                        {APPROVAL_SEND_POLICY_LABELS[defaultApprovalSendPolicy]}
                        )
                      </option>
                      {APPROVAL_SEND_POLICIES.map((policy) => (
                        <option key={policy} value={policy}>
                          {APPROVAL_SEND_POLICY_LABELS[policy]}
                        </option>
                      ))}
                    </select>
                  </label>

                  {effectiveSendPolicy === "approve_and_send" ? (
                    eligibleConversations.length === 0 ? (
                      <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-xs leading-5 text-warning-ink">
                        No active WhatsApp chat is linked to this customer yet.
                        Link a chat below or wait until the customer messages
                        your business number.
                      </p>
                    ) : eligibleConversations.length === 1 ? (
                      <p className="mt-3 text-xs leading-5 text-ink-soft">
                        Target chat:{" "}
                        <strong className="text-ink">
                          {conversationOptionLabel(eligibleConversations[0])}
                        </strong>
                      </p>
                    ) : (
                      <label className={`${labelClass} mt-3`}>
                        WhatsApp conversation
                        <select
                          value={selectedConversationId}
                          onChange={(event) =>
                            setSelectedConversationId(event.target.value)
                          }
                          disabled={isBusy || approvalContextLoading}
                          required
                          className={inputClass}
                        >
                          <option value="">Choose a conversation</option>
                          {eligibleConversations.map((conversation) => (
                            <option
                              key={conversation.id}
                              value={conversation.id}
                            >
                              {conversationOptionLabel(conversation)} (
                              {conversation.status})
                            </option>
                          ))}
                        </select>
                        <span className="help-text">
                          Multiple WhatsApp chats match this customer. Choose
                          which chat should receive the reply.
                        </span>
                      </label>
                    )
                  ) : null}

                  {approvalContextError ? (
                    <p
                      role="alert"
                      className="mt-3 text-xs font-medium text-danger-ink"
                    >
                      {approvalContextError}
                    </p>
                  ) : null}
                </section>
              ) : (
                <section className="rounded-xl border border-line bg-hushed/70 p-4">
                  <h3 className="text-sm font-semibold text-ink">
                    Approval snapshot
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-ink-soft">
                    Approval rule:{" "}
                    <strong className="text-ink">
                      {selectedDraft.approvalSendPolicy
                        ? APPROVAL_SEND_POLICY_LABELS[
                            selectedDraft.approvalSendPolicy
                          ]
                        : "Not recorded"}
                    </strong>
                    {selectedDraft.sendPolicyOverride
                      ? ` (custom choice: ${
                          APPROVAL_SEND_POLICY_LABELS[
                            selectedDraft.sendPolicyOverride
                          ]
                        })`
                      : " (workspace default)"}
                    . Sending uses the exact text snapshot captured on
                    approval.
                  </p>
                </section>
              )}

              {selectedDraft.status === "approved" ? (
                <section
                  aria-labelledby="outbound-conversation-title"
                  className="rounded-xl border border-line bg-hushed/70 p-4"
                >
                  <h3
                    id="outbound-conversation-title"
                    className="text-sm font-semibold text-ink"
                  >
                    WhatsApp conversation
                  </h3>
                  {approvalContextLoading ? (
                    <p role="status" className="mt-2 text-xs text-ink-soft">
                      Loading conversations…
                    </p>
                  ) : approvalContextError ? (
                    <p
                      role="alert"
                      className="mt-2 text-xs font-medium text-danger-ink"
                    >
                      {approvalContextError}
                    </p>
                  ) : eligibleConversations.length === 0 ? (
                    <p className="mt-2 text-xs leading-5 text-warning-ink">
                      {retryBlockedByInactiveConversation
                        ? "This conversation is archived. Reopen it before retrying; failed messages cannot be moved to a different chat."
                        : "No active WhatsApp conversation is linked to this lead."}
                    </p>
                  ) : eligibleConversations.length === 1 &&
                    (!outboundMessage || outboundConversationIsEligible) ? (
                    <p className="mt-2 text-xs leading-5 text-ink-soft">
                      Queues to{" "}
                      <strong className="text-ink">
                        {conversationOptionLabel(eligibleConversations[0])}
                      </strong>
                    </p>
                  ) : eligibleConversations.length > 1 ? (
                    <label className={`${labelClass} mt-2`}>
                      Conversation
                      <select
                        value={selectedConversationId}
                        onChange={(event) =>
                          setSelectedConversationId(event.target.value)
                        }
                        disabled={isBusy || outboundMessage !== null}
                        required
                        className={inputClass}
                      >
                        <option value="">Choose a conversation</option>
                        {eligibleConversations.map((conversation) => (
                          <option key={conversation.id} value={conversation.id}>
                            {conversationOptionLabel(conversation)} (
                            {conversation.status})
                          </option>
                        ))}
                        {outboundMessage &&
                        !outboundConversationIsEligible &&
                        outboundConversation ? (
                          <option
                            value={outboundMessage.conversationId}
                            disabled
                          >
                            {conversationOptionLabel(outboundConversation)}{" "}
                            (inactive original chat)
                          </option>
                        ) : null}
                      </select>
                      <span className="help-text">
                        {outboundMessage
                          ? "An existing outbound message stays tied to its original chat."
                          : "Choose the customer thread that should receive this reply."}
                      </span>
                    </label>
                  ) : outboundMessage ? (
                    <p className="mt-2 text-xs leading-5 text-warning-ink">
                      This outbound attempt stays tied to its original
                      conversation.
                    </p>
                  ) : null}
                  {outboundLoading ? (
                    <p role="status" className="mt-2 text-xs text-ink-soft">
                      Loading outbound status…
                    </p>
                  ) : null}
                  {outboundLoadError ? (
                    <p
                      role="alert"
                      className="mt-2 text-xs font-medium text-danger-ink"
                    >
                      {outboundLoadError}
                    </p>
                  ) : null}
                </section>
              ) : null}

              {eligibleConversations.length === 0 &&
              !retryBlockedByInactiveConversation &&
              canLinkConversation ? (
                <section
                  aria-labelledby="link-conversation-title"
                  className="rounded-xl border border-line bg-hushed/70 p-4"
                >
                  <h3
                    id="link-conversation-title"
                    className="text-sm font-semibold text-ink"
                  >
                    Link a WhatsApp chat
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-ink-soft">
                    Chats link automatically when a customer messages from the
                    same phone number, or you can link an existing chat below.
                  </p>

                  {linkableLoading ? (
                    <p role="status" className="mt-2 text-xs text-ink-soft">
                      Loading WhatsApp chats…
                    </p>
                  ) : null}

                  {linkableChoices.length > 0 ? (
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                      <label className={`${labelClass} min-w-0 flex-1`}>
                        Unlinked WhatsApp chat
                        <select
                          value={selectedLinkableConversationId}
                          onChange={(event) =>
                            setSelectedLinkableConversationId(
                              event.target.value,
                            )
                          }
                          disabled={isBusy}
                          className={inputClass}
                        >
                          <option value="">Choose a chat</option>
                          {linkableChoices.map((conversation) => (
                            <option
                              key={conversation.id}
                              value={conversation.id}
                            >
                              {linkableConversationLabel(conversation)} (
                              {conversation.status})
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={
                          isBusy ||
                          !selectedLinkableConversationId ||
                          linkingConversationId !== null
                        }
                        onClick={() =>
                          void linkConversation(selectedLinkableConversationId)
                        }
                      >
                        {linkingConversationId
                          ? "Linking…"
                          : "Link conversation"}
                      </button>
                    </div>
                  ) : linkableLoading ? null : (
                    <p className="mt-3 text-xs leading-5 text-ink-soft">
                      No unlinked chats are available yet. A chat appears here
                      after a customer messages your WhatsApp business number.
                    </p>
                  )}

                  {linkingError ? (
                    <p
                      role="alert"
                      className="mt-3 text-xs font-medium text-danger-ink"
                    >
                      {linkingError}
                    </p>
                  ) : null}
                </section>
              ) : null}

              {outboundMessage ? (
                <section
                  aria-labelledby="outbound-message-title"
                  className="rounded-xl border border-line bg-surface p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3
                      id="outbound-message-title"
                      className="text-sm font-semibold text-ink"
                    >
                      Delivery status
                    </h3>
                    <span className="badge badge-neutral">
                      {OUTBOUND_STATUS_LABELS[outboundMessage.status]}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-ink-soft">
                    {OUTBOUND_STATUS_DESCRIPTIONS[outboundMessage.status]}{" "}
                    <span className="numeric-tabular">
                      Attempts: {outboundMessage.attempts} of{" "}
                      {outboundMessage.maxAttempts}.
                    </span>
                  </p>
                  {outboundMessage.providerMessageId ? (
                    <p className="mt-1 break-all text-xs text-ink-faint">
                      Message reference: {outboundMessage.providerMessageId}
                    </p>
                  ) : null}
                  {outboundMessage.failureReason ? (
                    <p className="mt-1 text-xs font-medium text-danger-ink">
                      {outboundMessage.failureReason}
                    </p>
                  ) : null}
                  {outboundMessage.status === "manual_review" ? (
                    <p className="mt-2 text-xs leading-5 text-warning-ink">
                      Check your WhatsApp Business delivery status before
                      retrying so the customer never receives a duplicate message.
                    </p>
                  ) : null}
                  {outboundMessage.status === "failed" &&
                  retryBlockedByContentChange ? (
                    <p className="mt-2 text-xs leading-5 text-warning-ink">
                      This failed attempt used earlier wording. Create a new
                      draft to send the updated text.
                    </p>
                  ) : null}
                  {outboundMessage.status === "failed" &&
                  retryBlockedByInactiveConversation ? (
                    <p className="mt-2 text-xs leading-5 text-warning-ink">
                      This conversation is archived. Reopen it before retrying.
                    </p>
                  ) : null}
                </section>
              ) : null}
            </div>
          </Activity>

          <Activity mode={activeTab === "context" ? "visible" : "hidden"}>
            <div
              id="draft-panel-context"
              role="tabpanel"
              aria-labelledby="draft-tab-context"
              className="space-y-5"
            >
              <section
                aria-labelledby="draft-enquiry-title"
                className="rounded-xl border border-line bg-hushed/70 p-4"
              >
                <h3
                  id="draft-enquiry-title"
                  className="text-sm font-semibold text-ink"
                >
                  Enquiry summary
                </h3>
                <p className="mt-2 text-sm leading-6 text-ink">
                  {selectedDraft.summary}
                </p>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium text-ink-soft">
                      Customer need
                    </dt>
                    <dd className="font-semibold text-ink">
                      {intentLabels[selectedDraft.intent]}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-ink-soft">
                      Draft source
                    </dt>
                    <dd className="font-semibold text-ink">
                      {selectedDraft.provider === "gemini" &&
                      !selectedDraft.isDemo
                        ? "Gemini AI (live)"
                        : "Mock demonstration"}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4">
                  <h4 className="text-xs font-semibold text-ink-soft">
                    Information to confirm
                  </h4>
                  {selectedDraft.missingInformation.length > 0 ? (
                    <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-6 text-ink">
                      {selectedDraft.missingInformation.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-sm text-ink-soft">
                      No additional information flagged for confirmation.
                    </p>
                  )}
                </div>
              </section>

              <BusinessInformationUsed draft={selectedDraft} />
            </div>
          </Activity>

          <Activity mode={activeTab === "history" ? "visible" : "hidden"}>
            <div
              id="draft-panel-history"
              role="tabpanel"
              aria-labelledby="draft-tab-history"
            >
              <section aria-labelledby="draft-history-title">
                <h3
                  id="draft-history-title"
                  className="text-sm font-semibold text-ink"
                >
                  Saved draft history
                </h3>
                <p className="help-text">
                  Select a saved draft to load its text, sources, and approval
                  status into the editor.
                </p>
                <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface">
                  {drafts.map((draft) => {
                    const selected = draft.id === selectedDraftId;

                    return (
                      <li key={draft.id}>
                        <button
                          type="button"
                          onClick={() => selectDraft(draft)}
                          disabled={isBusy}
                          aria-current={selected ? "true" : undefined}
                          className={`flex min-h-12 w-full cursor-pointer flex-col gap-1.5 px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:flex-row sm:items-center sm:justify-between ${
                            selected ? "bg-accent-soft" : "hover:bg-hushed"
                          }`}
                        >
                          <span className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={draft.status} />
                            <span className="numeric-tabular text-xs text-ink-soft">
                              {intentLabels[draft.intent]} ·{" "}
                              {formatDraftTime(draft.updatedAt)}
                            </span>
                          </span>
                          <span className="max-w-full truncate text-xs text-ink-soft sm:max-w-xs">
                            {draft.draftReply}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          </Activity>
        </div>
      ) : (
        <div className="py-10 text-center">
          <h3 className="font-semibold text-ink">No saved draft</h3>
          <p className="mt-1 text-sm text-ink-soft">
            There is no saved draft to review for this lead yet.
          </p>
          {lead ? (
            <button
              type="button"
              onClick={() => void loadDrafts(lead)}
              className="btn btn-secondary mt-4"
            >
              Try again
            </button>
          ) : null}
        </div>
      )}
    </dialog>
  );
}
