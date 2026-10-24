"use client";

import { useEffect, useRef, useState } from "react";
import {
  parseReplyDraftResponse,
  type Lead,
  type ReplyDraft,
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

const intentLabels: Record<ReplyDraft["intent"], string> = {
  availability: "Availability",
  pricing: "Pricing",
  "service-details": "Service details",
  booking: "Booking",
  "general-enquiry": "General enquiry",
};

export function DraftReplyDialog({
  lead,
  onClose,
}: {
  lead: Lead | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestIdRef = useRef(0);
  const [draft, setDraft] = useState<ReplyDraft | null>(null);
  const [editedReply, setEditedReply] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  async function generateDraft(selectedLead: Lead) {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    setCopyMessage(null);

    try {
      const response = await fetch(`/api/leads/${selectedLead.id}/draft-reply`, {
        method: "POST",
      });
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(errorMessage(data, "Unable to generate a draft reply."));
      }

      const nextDraft = parseReplyDraftResponse(data);

      if (!nextDraft) {
        throw new Error("The draft service returned an unexpected response.");
      }

      if (requestId !== requestIdRef.current) return;

      setDraft(nextDraft);
      setEditedReply(nextDraft.draftReply);
    } catch (requestError) {
      if (requestId !== requestIdRef.current) return;

      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to generate a draft reply.",
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

    if (lead && !dialog.open) {
      setDraft(null);
      setEditedReply("");
      setError(null);
      setCopyMessage(null);
      dialog.showModal();
      void generateDraft(lead);
    } else if (!lead && dialog.open) {
      requestIdRef.current += 1;
      dialog.close();
    }
  }, [lead]);

  async function copyReply() {
    if (!editedReply.trim()) return;

    setCopyMessage(null);

    try {
      await navigator.clipboard.writeText(editedReply);
      setCopyMessage("Reply copied to your clipboard.");
    } catch {
      setCopyMessage("Unable to copy the reply. Please select and copy it manually.");
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
      className="m-auto w-[calc(100%-2rem)] max-w-2xl rounded-2xl bg-white p-6 text-slate-900 shadow-2xl backdrop:bg-slate-950/40 sm:p-8"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="draft-reply-title" className="text-xl font-bold text-slate-950">
            Draft reply
          </h2>
          {lead ? (
            <p className="mt-2 text-sm leading-6 text-slate-500">
              For {lead.name} · {lead.service}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close draft reply"
          className="rounded-lg px-3 py-1 text-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          &times;
        </button>
      </div>

      <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
        Demonstration output from ReplyPilot&apos;s mock provider. No live AI model was used; review before sending manually.
      </p>

      {isLoading ? (
        <div role="status" className="py-12 text-center text-sm text-slate-500">
          Preparing demonstration draft…
        </div>
      ) : error ? (
        <div role="alert" className="py-10 text-center">
          <h3 className="font-semibold text-slate-900">Unable to prepare a draft</h3>
          <p className="mt-1 text-sm text-slate-500">{error}</p>
          {lead ? (
            <button
              type="button"
              onClick={() => void generateDraft(lead)}
              className="mt-4 rounded-lg text-sm font-semibold text-blue-700 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : draft ? (
        <div className="mt-6 space-y-5">
          <dl className="grid gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Intent</dt>
              <dd className="mt-1 text-sm font-medium text-slate-800">
                {intentLabels[draft.intent]}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Provider</dt>
              <dd className="mt-1 text-sm font-medium text-slate-800">Mock demonstration</dd>
            </div>
          </dl>

          <div>
            <h3 className="text-sm font-semibold text-slate-800">Enquiry summary</h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">{draft.summary}</p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-800">Information to confirm</h3>
            {draft.missingInformation.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600">
                {draft.missingInformation.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-slate-500">No additional information identified.</p>
            )}
          </div>

          <div>
            <label htmlFor="draft-reply" className="text-sm font-semibold text-slate-800">
              Suggested reply
            </label>
            <textarea
              id="draft-reply"
              value={editedReply}
              onChange={(event) => setEditedReply(event.target.value)}
              rows={6}
              className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm leading-6 text-slate-700 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            />
          </div>

          {copyMessage ? (
            <p role="status" className="text-sm text-slate-600">{copyMessage}</p>
          ) : null}

          <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => lead && void generateDraft(lead)}
              disabled={isLoading}
              className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Regenerate demo draft
            </button>
            <button
              type="button"
              onClick={() => void copyReply()}
              disabled={!editedReply.trim()}
              className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Copy reply
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
