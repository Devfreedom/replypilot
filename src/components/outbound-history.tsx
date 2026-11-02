"use client";

import { useCallback, useEffect, useState } from "react";
import {
  OUTBOUND_MESSAGE_STATUSES,
  OUTBOUND_STATUS_DESCRIPTIONS,
  OUTBOUND_STATUS_LABELS,
  parseOutboundMessage,
  parseOutboundMessagesResponse,
  type OutboundHistoryItem,
  type OutboundMessageStatus,
} from "@/lib/messaging";
import { formatWhatsAppTimestamp } from "@/lib/whatsapp";
import { Alert, Spinner } from "./ui";

const PAGE_SIZE = 20;

type StatusFilter = OutboundMessageStatus | "all";

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function apiError(data: unknown, fallback: string): string {
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

function customerName(item: OutboundHistoryItem): string {
  const displayName = item.conversation.customer.displayName?.trim();

  if (displayName) {
    return displayName;
  }

  const phone = item.conversation.customer.phoneE164?.trim();

  if (phone) {
    return phone;
  }

  const providerId = item.conversation.customer.providerContactId?.trim();

  if (providerId) {
    return providerId;
  }

  return `Customer ${item.conversation.customer.id.slice(0, 8)}`;
}

function statusBadgeClass(status: OutboundMessageStatus): string {
  if (status === "failed") {
    return "badge bg-danger-soft text-danger-ink";
  }

  if (status === "cancelled") {
    return "badge bg-warning-soft text-warning-ink";
  }

  if (status === "sent" || status === "delivered") {
    return "badge badge-approved";
  }

  return "badge badge-neutral";
}

export function OutboundHistory() {
  const [items, setItems] = useState<OutboundHistoryItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const query = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });

      if (statusFilter !== "all") {
        query.set("status", statusFilter);
      }

      const response = await fetch(`/api/outbound-messages?${query}`);
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(
          apiError(data, "Unable to load outbound messages."),
        );
      }

      const parsed = parseOutboundMessagesResponse(data);

      if (!parsed) {
        throw new Error(
          "The outbound message service returned an unexpected response.",
        );
      }

      setItems(parsed.messages);
      setHasMore(parsed.pagination.hasMore);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load outbound messages.",
      );
    } finally {
      setLoading(false);
    }
  }, [offset, statusFilter]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  async function retry(item: OutboundHistoryItem) {
    setRetryingId(item.id);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/reply-drafts/${item.replyDraftId}/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: item.conversation.id }),
        },
      );
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(
          apiError(data, "Unable to queue this message for retry."),
        );
      }

      const updated = parseOutboundMessage(data);

      if (!updated) {
        throw new Error(
          "The outbound message service returned an unexpected response.",
        );
      }

      setItems((current) =>
        current.map((currentItem) =>
          currentItem.id === updated.id
            ? {
                ...currentItem,
                ...updated,
                canRetry: updated.status === "failed",
              }
            : currentItem,
        ),
      );
      setNotice(
        "The message was returned to the queue with its original content. The worker will retry it.",
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to queue this message for retry.",
      );
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Outbound messages
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft">
            Queued and attempted replies for this workspace. Provider acceptance
            is shown separately from delivery. This page uses the mock provider;
            no message is sent to WhatsApp.
          </p>
        </div>
        <label className="field-label min-w-44">
          Status
          <select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as StatusFilter);
              setOffset(0);
            }}
            className="input mt-1"
          >
            <option value="all">All statuses</option>
            {OUTBOUND_MESSAGE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {OUTBOUND_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <Alert tone="danger">
          {error}{" "}
          <button
            type="button"
            onClick={() => setReloadToken((value) => value + 1)}
            className="ml-2 font-semibold underline"
          >
            Try again
          </button>
        </Alert>
      ) : null}

      {notice ? (
        <Alert tone="success" role="status">
          {notice}
        </Alert>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-16 text-sm text-ink-soft">
          <Spinner />
          Loading outbound messages…
        </div>
      ) : items.length === 0 ? (
        <div className="card p-8 text-center">
          <h2 className="font-semibold text-ink">No outbound messages yet</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-ink-soft">
            Approve a reply with the approve-and-send policy, or send an approved
            draft explicitly. Queued messages appear here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={statusBadgeClass(item.status)}>
                      {OUTBOUND_STATUS_LABELS[item.status]}
                    </span>
                    <span className="text-sm font-semibold text-ink">
                      {customerName(item)}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-ink">
                    {item.content}
                  </p>
                </div>
                {item.canRetry ? (
                  <button
                    type="button"
                    onClick={() => void retry(item)}
                    disabled={retryingId === item.id}
                    className="btn btn-secondary shrink-0"
                  >
                    {retryingId === item.id ? "Queueing…" : "Retry send"}
                  </button>
                ) : null}
              </div>

              <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
                <div>
                  <dt className="font-medium text-ink-soft">Queued</dt>
                  <dd className="mt-0.5 text-ink">
                    {formatWhatsAppTimestamp(item.queuedAt)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-ink-soft">Attempts</dt>
                  <dd className="mt-0.5 text-ink">
                    {item.attempts} of {item.maxAttempts}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-ink-soft">Provider</dt>
                  <dd className="mt-0.5 text-ink">
                    {item.provider === "mock" ? "Mock provider" : item.provider}
                    {item.providerMessageId
                      ? ` · ${item.providerMessageId}`
                      : ""}
                  </dd>
                </div>
              </dl>

              <p className="mt-3 text-xs leading-5 text-ink-soft">
                {OUTBOUND_STATUS_DESCRIPTIONS[item.status]}
                {item.failureReason ? ` ${item.failureReason}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      {!loading && (offset > 0 || hasMore) ? (
        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="btn btn-secondary"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={!hasMore}
            className="btn btn-secondary"
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
