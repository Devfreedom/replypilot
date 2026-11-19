"use client";

import {
  shouldShowCustomerMessageToggle,
  type SavedReplyDraft,
} from "../lib/leads";
import type { ApprovalSendPolicy } from "../lib/messaging";

export function CustomerMessageQuote({
  message,
  expanded,
  onToggle,
}: Readonly<{
  message: string;
  expanded: boolean;
  onToggle: () => void;
}>) {
  const trimmed = message.trim();

  if (!trimmed) {
    return null;
  }

  const showToggle = shouldShowCustomerMessageToggle(trimmed);

  return (
    <section
      aria-labelledby="draft-customer-message-label"
      className="rounded-xl border border-line bg-hushed/70 px-4 py-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3
          id="draft-customer-message-label"
          className="text-xs font-semibold uppercase tracking-wide text-ink-soft"
        >
          Customer message
        </h3>
        {showToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="cursor-pointer text-xs font-semibold text-accent-ink hover:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        ) : null}
      </div>
      <blockquote
        className={`mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-ink ${
          expanded ? "" : "line-clamp-2"
        }`}
      >
        {trimmed}
      </blockquote>
    </section>
  );
}

export function DraftAbstentionBanner({
  notice,
}: Readonly<{ notice: string | null }>) {
  if (!notice) {
    return null;
  }

  return (
    <div
      role="alert"
      className="rounded-xl border border-[color-mix(in_oklab,var(--rp-warning)_45%,transparent)] bg-warning-soft px-4 py-3 text-xs leading-5 text-warning-ink sm:text-sm"
    >
      <p className="font-semibold">AI abstained — manual reply required</p>
      <p className="mt-1">{notice}</p>
    </div>
  );
}

export function DraftApproveButton({
  draft,
  isBusy,
  hasUnsavedChanges,
  pendingApprove,
  effectiveSendPolicy,
  onApprove,
}: Readonly<{
  draft: Pick<SavedReplyDraft, "decision">;
  isBusy: boolean;
  hasUnsavedChanges: boolean;
  pendingApprove: boolean;
  effectiveSendPolicy: ApprovalSendPolicy;
  onApprove: () => void;
}>) {
  const isAbstained = draft.decision === "abstain";

  return (
    <button
      type="button"
      onClick={onApprove}
      disabled={isBusy || hasUnsavedChanges || isAbstained}
      className="btn btn-primary"
    >
      {pendingApprove
        ? effectiveSendPolicy === "approve_and_send"
          ? "Approving and queueing…"
          : "Approving…"
        : effectiveSendPolicy === "approve_and_send"
          ? "Approve and queue"
          : "Approve draft"}
    </button>
  );
}
