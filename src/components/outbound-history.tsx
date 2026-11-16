"use client";

import { useEffect, useState } from "react";
import {
  OUTBOUND_MESSAGE_STATUSES,
  OUTBOUND_STATUS_DESCRIPTIONS,
  OUTBOUND_STATUS_LABELS,
  canRetryOutboundForRole,
  parseOutboundMessagesResponse,
  parseSendOutboundMessageResponse,
  retryBlockDescription,
  type OutboundHistoryItem,
  type OutboundMessageStatus,
} from "@/lib/messaging";
import { formatWhatsAppTimestamp } from "@/lib/whatsapp";
import { useAuth } from "./auth-provider";
import { Alert, PageHeading, SectionState, Spinner } from "./ui";

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

  if (status === "manual_review") {
    return "badge bg-warning-soft text-warning-ink";
  }

  if (status === "sent" || status === "delivered") {
    return "badge badge-approved";
  }

  return "badge badge-neutral";
}

export function OutboundHistory() {
  const { role } = useAuth();
  const [items, setItems] = useState<OutboundHistoryItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
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

        const response = await fetch(`/api/outbound-messages?${query}`, {
          signal: controller.signal,
        });
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

        if (!controller.signal.aborted) {
          setItems(parsed.messages);
          setHasMore(parsed.pagination.hasMore);
        }
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to load outbound messages.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      controller.abort();
    };
  }, [offset, statusFilter, reloadToken]);

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

      const updated = parseSendOutboundMessageResponse(data);

      if (!updated) {
        throw new Error(
          "The outbound message service returned an unexpected response.",
        );
      }

      setNotice(
        "The message was returned to the queue with its original content. The worker will retry it.",
      );
      setLoading(true);
      setReloadToken((value) => value + 1);
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

  const pageStart = items.length > 0 ? offset + 1 : 0;
  const pageEnd = offset + items.length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeading
        title="Outbound messages"
        description="Track queued replies, sending progress, and WhatsApp delivery confirmations. Messages only enter this queue after your approval."
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="field-label min-w-44">
            Status
            <select
              value={statusFilter}
              onChange={(event) => {
                setLoading(true);
                setError(null);
                setStatusFilter(event.target.value as StatusFilter);
                setOffset(0);
              }}
              className="select mt-1"
            >
              <option value="all">All statuses</option>
              {OUTBOUND_MESSAGE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {OUTBOUND_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setError(null);
              setReloadToken((value) => value + 1);
            }}
            disabled={loading}
            className="btn btn-secondary"
          >
            Refresh
          </button>
        </div>
      </PageHeading>

      <div className="mt-5 space-y-4">
        {error ? (
          <Alert tone="danger">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => {
                  setLoading(true);
                  setError(null);
                  setReloadToken((value) => value + 1);
                }}
                className="btn btn-secondary text-xs"
              >
                Try again
              </button>
            </div>
          </Alert>
        ) : null}

        {notice ? (
          <Alert tone="success" role="status">
            {notice}
          </Alert>
        ) : null}
      </div>

      {loading ? (
        <div
          role="status"
          aria-live="polite"
          className="mt-6 flex items-center justify-center gap-3 py-16 text-sm text-ink-soft"
        >
          <Spinner />
          Loading outbound messages…
        </div>
      ) : items.length === 0 ? (
        <div className="card mt-6">
          {statusFilter === "all" ? (
            <SectionState icon="◌" title="No outbound messages yet">
              <p>
                Approve a drafted reply from a lead to add it to the send queue.
                Queued and delivered messages appear here.
              </p>
            </SectionState>
          ) : (
            <SectionState
              icon="◌"
              title={`No ${OUTBOUND_STATUS_LABELS[statusFilter].toLowerCase()} messages`}
              action={
                <button
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    setError(null);
                    setStatusFilter("all");
                    setOffset(0);
                  }}
                  className="btn btn-secondary"
                >
                  Show all statuses
                </button>
              }
            >
              <p>No messages in this workspace currently match this filter.</p>
            </SectionState>
          )}
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {items.map((item) => (
            <li key={item.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={statusBadgeClass(item.status)}>
                      {OUTBOUND_STATUS_LABELS[item.status]}
                    </span>
                    <span className="break-words text-sm font-semibold text-ink">
                      {customerName(item)}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-ink">
                    {item.content}
                  </p>
                </div>
                {canRetryOutboundForRole(role, item.canRetry) ? (
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
                  <dd className="numeric-tabular mt-0.5 text-ink">
                    {formatWhatsAppTimestamp(item.queuedAt)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-ink-soft">Attempt started</dt>
                  <dd className="numeric-tabular mt-0.5 text-ink">
                    {item.startedAt
                      ? formatWhatsAppTimestamp(item.startedAt)
                      : "Not claimed"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-ink-soft">
                    Provider accepted
                  </dt>
                  <dd className="numeric-tabular mt-0.5 text-ink">
                    {item.sentAt
                      ? formatWhatsAppTimestamp(item.sentAt)
                      : "Not accepted"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-ink-soft">Delivered</dt>
                  <dd className="numeric-tabular mt-0.5 text-ink">
                    {item.deliveredAt
                      ? formatWhatsAppTimestamp(item.deliveredAt)
                      : "Not reported"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-ink-soft">Attempts</dt>
                  <dd className="numeric-tabular mt-0.5 text-ink">
                    {item.attempts} of {item.maxAttempts}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-ink-soft">Provider</dt>
                  <dd className="mt-0.5 break-all text-ink sm:break-words">
                    {item.provider === "mock"
                      ? "Mock provider (test preview only)"
                      : item.provider === "meta"
                        ? "WhatsApp Cloud"
                        : item.provider}
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
              {item.status === "failed" && item.retryBlockReason ? (
                <p className="mt-2 text-xs leading-5 text-warning-ink">
                  Retry unavailable:{" "}
                  {retryBlockDescription(item.retryBlockReason)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {!loading && (offset > 0 || hasMore) ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="numeric-tabular text-xs text-ink-soft">
            Showing {pageStart}–{pageEnd}
            {hasMore ? " (more available)" : ""}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setError(null);
                setOffset(Math.max(0, offset - PAGE_SIZE));
              }}
              disabled={offset === 0}
              className="btn btn-secondary"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setError(null);
                setOffset(offset + PAGE_SIZE);
              }}
              disabled={!hasMore}
              className="btn btn-secondary"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
