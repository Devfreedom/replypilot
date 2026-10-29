"use client";

import { useEffect, useRef, useState } from "react";
import {
  parseReplyDraftsResponse,
  parseSavedReplyDraftResponse,
  type Lead,
  type ReplyDraftSource,
  type ReplyDraft,
  type SavedReplyDraft,
} from "@/lib/leads";

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorMessage(data: unknown, fallback: string): string {
  if (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    typeof data.error === "string"
  ) {
    return data.error;
  }

  return fallback;
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
  const requestIdRef = useRef(0);
  const loadedLeadIdRef = useRef<string | null>(null);
  const [drafts, setDrafts] = useState<SavedReplyDraft[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [editedReply, setEditedReply] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "save" | "approve" | "unapprove" | "regenerate" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const selectedDraft =
    drafts.find((draft) => draft.id === selectedDraftId) ?? null;
  const hasUnsavedChanges = selectedDraft
    ? editedReply !== selectedDraft.draftReply
    : false;
  const isBusy = pendingAction !== null;

  function replaceDraft(nextDraft: SavedReplyDraft) {
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
    setSelectedDraftId(draft.id);
    setEditedReply(draft.draftReply);
    setActionError(null);
    setValidationError(null);
    setNotice(null);
    setCopyMessage(null);
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

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) return;

    if (lead) {
      if (!dialog.open) {
        dialog.showModal();
      }

      if (loadedLeadIdRef.current !== lead.id) {
        loadedLeadIdRef.current = lead.id;
        void loadDrafts(lead);
      }
    } else {
      requestIdRef.current += 1;
      loadedLeadIdRef.current = null;

      if (dialog.open) {
        dialog.close();
      }
    }
  }, [lead]);

  async function saveReply() {
    if (!lead || !selectedDraft) return;

    if (!editedReply.trim()) {
      setValidationError("Reply text cannot be empty.");
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

    setPendingAction(status === "approved" ? "approve" : "unapprove");
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
          body: JSON.stringify({ status }),
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

      const updatedDraft = parseSavedReplyDraftResponse(data);

      if (!updatedDraft) {
        throw new Error("The draft service returned an unexpected response.");
      }

      replaceDraft(updatedDraft);
      setNotice(
        status === "approved"
          ? "Draft marked approved for review. This is a review status only; no customer message has been sent."
          : "Draft returned to draft status. Review the text and approve it when ready.",
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

  async function regenerateDraft() {
    if (!lead || !selectedDraft) return;

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

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={handleBackdropClick}
      aria-labelledby="draft-reply-title"
      aria-describedby="draft-reply-demo"
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-2xl bg-raised p-6 text-ink shadow-2xl sm:p-8"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            id="draft-reply-title"
            className="text-xl font-bold text-ink"
          >
            Draft reply
          </h2>
          {lead ? (
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              For {lead.name} · {lead.service}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close draft reply"
          className="rounded-lg px-3 py-1 text-2xl leading-none text-ink-faint hover:bg-hushed hover:text-ink"
        >
          &times;
        </button>
      </div>

      <p
        id="draft-reply-demo"
        className="mt-5 rounded-xl border border-[color-mix(in_oklab,var(--rp-warning)_25%,transparent)] bg-warning-soft px-4 py-3 text-sm leading-6 text-warning-ink"
      >
        Demonstration output from ReplyPilot&apos;s mock provider. No live AI
        model was used. Review before sending manually; approval here does not
        send a message.
      </p>

      {isLoading ? (
        <div role="status" className="py-12 text-center text-sm text-ink-soft">
          Loading saved drafts and preparing demonstration content…
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
              className="btn btn-quiet mt-4"
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : selectedDraft ? (
        <div className="mt-6 space-y-6" aria-busy={isBusy}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StatusBadge status={selectedDraft.status} />
            {selectedDraft.approvedAt ? (
              <p className="text-xs text-ink-soft">
                Approved {formatDraftTime(selectedDraft.approvedAt)}
              </p>
            ) : null}
          </div>

          {/* Lead and enquiry context */}
          <section
            aria-labelledby="draft-enquiry-title"
            className="rounded-xl border border-line bg-hushed p-4"
          >
            <h3
              id="draft-enquiry-title"
              className="text-xs font-semibold uppercase tracking-wide text-ink-faint"
            >
              Lead and enquiry context
            </h3>
            <p className="mt-2 text-sm leading-6 text-ink">
              {selectedDraft.summary}
            </p>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-ink-soft">Intent</dt>
                <dd className="font-medium text-ink">
                  {intentLabels[selectedDraft.intent]}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-ink-soft">Provider</dt>
                <dd className="font-medium text-ink">Mock demonstration</dd>
              </div>
            </dl>
            <div className="mt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
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
                  No additional information identified.
                </p>
              )}
            </div>
            <div className="mt-3">
              <BusinessInformationUsed draft={selectedDraft} />
            </div>
          </section>

          {/* Generated, editable reply */}
          <section aria-labelledby="draft-reply-editor-title">
            <div className="flex items-center justify-between gap-3">
              <h3
                id="draft-reply-editor-title"
                className="text-sm font-semibold text-ink"
              >
                Suggested reply
              </h3>
              <span className="text-xs text-ink-faint">
                {editedReply.length}/2000
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
              rows={8}
              maxLength={2000}
              aria-invalid={validationError ? true : undefined}
              aria-describedby="draft-reply-edit-warning"
              className="textarea mt-2"
            />
            <p
              id="draft-reply-edit-warning"
              className="help-text mt-2"
            >
              {hasUnsavedChanges
                ? "You have edited this reply. Your changes may no longer be supported by the original business facts and require your own review."
                : "Editing this reply may make parts of it unsupported by the original business facts. Saving changes returns the draft to draft status."}
            </p>
            {validationError ? (
              <p role="alert" className="mt-1 text-xs font-medium text-danger-ink">
                {validationError}
              </p>
            ) : null}
          </section>

          {actionError ? (
            <p
              role="alert"
              className="rounded-xl border border-[color-mix(in_oklab,var(--rp-danger)_25%,transparent)] bg-danger-soft px-4 py-3 text-sm text-danger-ink"
            >
              {actionError}
            </p>
          ) : null}

          <p
            aria-live="polite"
            className={`text-sm ${notice || copyMessage ? "text-ink" : ""}`}
          >
            {notice ?? copyMessage ?? ""}
          </p>

          <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:flex-wrap sm:justify-end">
            <button
              type="button"
              onClick={() => void regenerateDraft()}
              disabled={isBusy}
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
            ) : (
              <button
                type="button"
                onClick={() => void updateStatus("approved")}
                disabled={isBusy || hasUnsavedChanges}
                className="btn btn-primary"
              >
                {pendingAction === "approve" ? "Approving…" : "Approve draft"}
              </button>
            )}
          </div>

          {hasUnsavedChanges ? (
            <p className="-mt-3 text-right text-xs text-ink-soft">
              Save your edits before approving them. Saving returns the draft
              to draft status for a separate review.
            </p>
          ) : null}

          {/* Draft history */}
          <section aria-labelledby="draft-history-title">
            <h3
              id="draft-history-title"
              className="text-sm font-semibold text-ink"
            >
              Previously saved drafts
            </h3>
            <p className="help-text mt-1">
              Select a saved draft to restore its text, business facts, and
              review status. Switching drafts discards unsaved edits.
            </p>
            <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
              {drafts.map((draft) => {
                const selected = draft.id === selectedDraftId;

                return (
                  <li key={draft.id}>
                    <button
                      type="button"
                      onClick={() => selectDraft(draft)}
                      disabled={isBusy}
                      aria-current={selected ? "true" : undefined}
                      className={`flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:flex-row sm:items-center sm:justify-between ${
                        selected ? "bg-accent-soft" : "hover:bg-hushed"
                      }`}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={draft.status} />
                        <span className="text-xs text-ink-soft">
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
              className="btn btn-quiet mt-4"
            >
              Try again
            </button>
          ) : null}
        </div>
      )}
    </dialog>
  );
}
