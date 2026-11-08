"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DELIVERY_EVENT_OUTCOMES,
  SUPPRESSION_REASONS,
  SUPPRESSION_REASON_LABELS,
  parseDeliveryEventsResponse,
  parseProviderProtection,
  parseSuppressionResponse,
  parseSuppressionsResponse,
  parseWorkerStatus,
  protectedCustomerName,
  type CustomerSuppressionItem,
  type DeliveryEvent,
  type DeliveryEventOutcome,
  type ProviderProtection,
  type SuppressionReason,
  type WorkerStatus,
} from "@/lib/delivery";
import {
  OUTBOUND_MESSAGE_STATUSES,
  OUTBOUND_STATUS_LABELS,
} from "@/lib/messaging";
import {
  conversationDisplayName,
  parseConversationsResponse,
  type WhatsAppConversation,
} from "@/lib/whatsapp";
import { useAuth } from "./auth-provider";
import { Alert, CardSection, PageHeading, SectionState, Spinner } from "./ui";

const PAGE_SIZE = 20;
const WORKER_POLL_MS = 5_000;

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

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function outcomeBadgeClass(outcome: DeliveryEventOutcome): string {
  if (outcome === "processed") return "badge badge-approved";
  if (outcome === "failed") return "badge bg-danger-soft text-danger-ink";
  if (outcome === "ignored") return "badge badge-neutral";
  return "badge bg-warning-soft text-warning-ink";
}

function outcomeLabel(outcome: DeliveryEventOutcome): string {
  switch (outcome) {
    case "processed":
      return "Processed";
    case "ignored":
      return "Ignored";
    case "failed":
      return "Processing failed";
    case "processing":
      return "Processing";
  }
}

export function DeliveryProtection() {
  const { role } = useAuth();
  const canManage = role === "owner";

  const [protection, setProtection] = useState<ProviderProtection | null>(null);
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus | null>(null);
  const [suppressions, setSuppressions] = useState<CustomerSuppressionItem[]>([]);
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [events, setEvents] = useState<DeliveryEvent[]>([]);
  const [eventsOffset, setEventsOffset] = useState(0);
  const [eventsHasMore, setEventsHasMore] = useState(false);
  const [outcomeFilter, setOutcomeFilter] = useState<DeliveryEventOutcome | "all">(
    "all",
  );

  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyCustomerId, setBusyCustomerId] = useState<string | null>(null);

  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [suppressReason, setSuppressReason] =
    useState<SuppressionReason>("opt_out");
  const [suppressNotes, setSuppressNotes] = useState("");
  const [suppressing, setSuppressing] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDashboard() {
      setLoading(true);
      setError(null);

      try {
        const [
          protectionResponse,
          workerResponse,
          suppressionsResponse,
          conversationsResponse,
        ] = await Promise.all([
          fetch("/api/whatsapp/protection", {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch("/api/outbound-messages/worker-status", {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch("/api/whatsapp/suppressions", {
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch("/api/conversations?limit=100&status=all", {
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);

        const [
          protectionData,
          workerData,
          suppressionsData,
          conversationsData,
        ] = await Promise.all([
          readJson(protectionResponse),
          readJson(workerResponse),
          readJson(suppressionsResponse),
          readJson(conversationsResponse),
        ]);

        if (!protectionResponse.ok) {
          throw new Error(
            apiError(protectionData, "Unable to load protection settings."),
          );
        }

        if (!workerResponse.ok) {
          throw new Error(
            apiError(workerData, "Unable to load worker status."),
          );
        }

        if (!suppressionsResponse.ok) {
          throw new Error(
            apiError(suppressionsData, "Unable to load customer suppressions."),
          );
        }

        if (!conversationsResponse.ok) {
          throw new Error(
            apiError(conversationsData, "Unable to load conversations."),
          );
        }

        const parsedProtection = parseProviderProtection(protectionData);
        const parsedWorker = parseWorkerStatus(workerData);
        const parsedSuppressions = parseSuppressionsResponse(suppressionsData);
        const parsedConversations =
          parseConversationsResponse(conversationsData);

        if (
          !parsedProtection ||
          !parsedWorker ||
          !parsedSuppressions ||
          !parsedConversations
        ) {
          throw new Error(
            "The delivery service returned an unexpected response.",
          );
        }

        if (controller.signal.aborted) return;

        setProtection(parsedProtection);
        setWorkerStatus(parsedWorker);
        setSuppressions(parsedSuppressions);
        setConversations(parsedConversations.conversations);
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }

        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load delivery and protection data.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadDashboard();
    return () => controller.abort();
  }, [reloadToken]);

  useEffect(() => {
    const controller = new AbortController();

    async function pollWorker() {
      try {
        const response = await fetch("/api/outbound-messages/worker-status", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await readJson(response);

        if (!response.ok) return;
        const parsed = parseWorkerStatus(data);
        if (parsed) setWorkerStatus(parsed);
      } catch {
        // Polling is best-effort; the manual refresh surfaces real errors.
      }
    }

    const timer = setInterval(() => void pollWorker(), WORKER_POLL_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadEvents() {
      setEventsLoading(true);
      setEventsError(null);

      try {
        const query = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(eventsOffset),
        });

        if (outcomeFilter !== "all") {
          query.set("outcome", outcomeFilter);
        }

        const response = await fetch(
          `/api/whatsapp/delivery-events?${query.toString()}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = await readJson(response);

        if (!response.ok) {
          throw new Error(
            apiError(data, "Unable to load delivery events."),
          );
        }

        const parsed = parseDeliveryEventsResponse(data);

        if (!parsed) {
          throw new Error(
            "The delivery event service returned an unexpected response.",
          );
        }

        if (controller.signal.aborted) return;
        setEvents(parsed.events);
        setEventsHasMore(parsed.pagination.hasMore);
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === "AbortError") {
          return;
        }

        setEventsError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load delivery events.",
        );
      } finally {
        if (!controller.signal.aborted) setEventsLoading(false);
      }
    }

    void loadEvents();
    return () => controller.abort();
  }, [eventsOffset, outcomeFilter, reloadToken]);

  const candidates = useMemo(() => {
    const byCustomer = new Map<
      string,
      { id: string; label: string; conversationId: string }
    >();
    const suppressed = new Set(suppressions.map((item) => item.customer.id));

    for (const conversation of conversations) {
      const customer = conversation.customer;

      if (suppressed.has(customer.id) || byCustomer.has(customer.id)) {
        continue;
      }

      const name = customer.displayName?.trim();
      const phone = customer.phoneE164?.trim();
      const providerId = customer.providerContactId?.trim();
      const label =
        name ||
        phone ||
        providerId ||
        `Customer ${customer.id.slice(0, 8)}`;

      byCustomer.set(customer.id, {
        id: customer.id,
        label: `${label} · ${conversationDisplayName(conversation)}`,
        conversationId: conversation.id,
      });
    }

    return [...byCustomer.values()];
  }, [conversations, suppressions]);

  async function suppressCustomer() {
    if (!selectedCustomerId) return;

    setSuppressing(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/whatsapp/customers/${selectedCustomerId}/suppression`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: suppressReason,
            notes: suppressNotes.trim() || undefined,
          }),
        },
      );
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(
          apiError(data, "Unable to suppress this customer."),
        );
      }

      const parsed = parseSuppressionResponse(data);

      if (!parsed) {
        throw new Error(
          "The suppression service returned an unexpected response.",
        );
      }

      setSelectedCustomerId("");
      setSuppressNotes("");
      setNotice(
        "Customer suppressed. Queued outbound messages will be cancelled and no new sends are permitted.",
      );
      setReloadToken((value) => value + 1);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to suppress this customer.",
      );
    } finally {
      setSuppressing(false);
    }
  }

  async function removeSuppression(customerId: string) {
    setBusyCustomerId(customerId);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/whatsapp/customers/${customerId}/suppression`,
        { method: "DELETE" },
      );
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(
          apiError(data, "Unable to remove this suppression."),
        );
      }

      setNotice(
        "Suppression removed. Future sends still require an approved draft, an open service window, and provider policy checks.",
      );
      setReloadToken((value) => value + 1);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to remove this suppression.",
      );
    } finally {
      setBusyCustomerId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeading
        title="Delivery and protection"
        description="Inspect delivery-status webhooks, customer suppressions, the 24-hour service window, and live worker activity. Outbound records remain distinct from provider acceptance and confirmed delivery."
      >
        <button
          type="button"
          onClick={() => setReloadToken((value) => value + 1)}
          className="btn btn-secondary"
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </PageHeading>

      <div className="mt-4 space-y-3">
        <Alert tone="info">
          <span className="font-semibold">Test environment.</span>{" "}
          The mock provider never contacts WhatsApp. Delivery events shown here
          come from signed local webhook fixtures. Meta sending is restricted to
          the configured test workspace, sender, and recipient allowlist, and is
          rejected in production.
        </Alert>

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
      </div>

      {loading && !protection ? (
        <div className="flex items-center justify-center gap-3 py-16 text-sm text-ink-soft">
          <Spinner />
          Loading delivery and protection data…
        </div>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <CardSection
            title="Provider and production protection"
            description="Resolved server-side for this workspace. No credentials or token values are returned to the browser."
          >
            {protection ? (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium text-ink-soft">
                    Outbound provider
                  </dt>
                  <dd className="mt-0.5 font-semibold text-ink">
                    {protection.providerForWorkspace === "whatsapp"
                      ? "Meta WhatsApp Cloud API"
                      : "Mock provider (no real delivery)"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-ink-soft">
                    Runtime
                  </dt>
                  <dd className="mt-0.5 font-semibold text-ink">
                    {protection.runtime}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-ink-soft">
                    Meta sending enabled
                  </dt>
                  <dd className="mt-0.5 text-ink">
                    {protection.meta.enabled ? "Yes" : "No"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-ink-soft">
                    Recipient allowlist
                  </dt>
                  <dd className="mt-0.5 text-ink">
                    {protection.meta.enabled
                      ? `${protection.meta.recipientAllowlistCount} number(s)`
                      : "Not active"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-ink-soft">
                    Sender phone-number ID
                  </dt>
                  <dd className="mt-0.5 break-all text-ink">
                    {protection.meta.senderPhoneNumberId ?? "Not configured"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-ink-soft">
                    Test workspace match
                  </dt>
                  <dd className="mt-0.5 text-ink">
                    {protection.meta.enabled
                      ? protection.meta.workspaceAllowlistedForMeta
                        ? "This workspace"
                        : "Different workspace"
                      : "Not applicable"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-ink-soft">
                    Inbound webhook
                  </dt>
                  <dd className="mt-0.5 text-ink">
                    {protection.inboundWebhook.configured
                      ? protection.inboundWebhook.workspaceMatches
                        ? "Configured for this workspace"
                        : "Configured for another workspace"
                      : "Not configured"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-ink-soft">
                    Default approval
                  </dt>
                  <dd className="mt-0.5 text-ink">
                    {protection.defaultApprovalSendPolicy === "approve_and_send"
                      ? "Approve and queue"
                      : "Approve only"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium text-ink-soft">
                    Protection status
                  </dt>
                  <dd className="mt-0.5 text-xs leading-5 text-ink-soft">
                    {protection.meta.productionProtection}
                  </dd>
                </div>
              </dl>
            ) : null}
          </CardSection>

          <CardSection
            title="Worker activity"
            description="The standalone outbound worker writes a heartbeat on every poll. Queue counts come from persisted outbound records."
          >
            {workerStatus ? (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {OUTBOUND_MESSAGE_STATUSES.map((status) => (
                    <div
                      key={status}
                      className="rounded-lg bg-hushed px-3 py-2 text-center"
                    >
                      <p className="text-[11px] font-medium text-ink-soft">
                        {OUTBOUND_STATUS_LABELS[status]}
                      </p>
                      <p className="text-lg font-bold text-ink">
                        {workerStatus.queue.counts[status] ?? 0}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-ink-soft">
                  Oldest queued record:{" "}
                  {formatDate(workerStatus.queue.oldestQueuedAt)}
                </p>
                <ul className="mt-4 space-y-2">
                  {workerStatus.workers.length === 0 ? (
                    <li className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-ink">
                      No worker heartbeat recorded. Start{" "}
                      <code>npm run worker:outbound</code>.
                    </li>
                  ) : (
                    workerStatus.workers.map((worker) => (
                      <li
                        key={worker.provider}
                        className="rounded-lg border border-line px-3 py-2 text-xs"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink">
                            {worker.provider}
                          </span>
                          <span
                            className={
                              worker.stale
                                ? "badge bg-danger-soft text-danger-ink"
                                : "badge badge-approved"
                            }
                          >
                            {worker.stale ? "Stale" : "Live"}
                          </span>
                          <span className="text-ink-faint">
                            {worker.workerId}
                          </span>
                        </div>
                        <p className="mt-1 text-ink-soft">
                          Last seen {formatDate(worker.lastSeenAt)} · started{" "}
                          {formatDate(worker.workerStartedAt)}
                        </p>
                        <p className="mt-1 break-words text-ink-faint">
                          Last tick:{" "}
                          {JSON.stringify(worker.lastTick)}
                        </p>
                      </li>
                    ))
                  )}
                </ul>
              </>
            ) : null}
          </CardSection>

          <CardSection
            title="Customer suppression"
            description="A suppressed customer never receives an outbound message, regardless of approval or the service window. Inbound STOP messages create opt-out records automatically."
            className="lg:col-span-2"
          >
            {!canManage ? (
              <Alert tone="warning" role="status">
                Only the workspace owner can suppress or restore customers.
              </Alert>
            ) : (
              <div className="grid gap-3 border-b border-line pb-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_minmax(0,1fr)_auto] sm:items-end">
                <label className="field-label">
                  Customer
                  <select
                    value={selectedCustomerId}
                    onChange={(event) =>
                      setSelectedCustomerId(event.target.value)
                    }
                    className="input mt-1"
                    disabled={suppressing || candidates.length === 0}
                  >
                    <option value="">
                      {candidates.length === 0
                        ? "No unsuppressed customers with conversations"
                        : "Choose a customer"}
                    </option>
                    {candidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  Reason
                  <select
                    value={suppressReason}
                    onChange={(event) =>
                      setSuppressReason(event.target.value as SuppressionReason)
                    }
                    className="input mt-1"
                    disabled={suppressing}
                  >
                    {SUPPRESSION_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {SUPPRESSION_REASON_LABELS[reason]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  Notes (optional)
                  <input
                    value={suppressNotes}
                    onChange={(event) => setSuppressNotes(event.target.value)}
                    maxLength={500}
                    className="input mt-1"
                    placeholder="Fictional demo note"
                    disabled={suppressing}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void suppressCustomer()}
                  disabled={
                    suppressing || selectedCustomerId.length === 0
                  }
                  className="btn btn-secondary"
                >
                  {suppressing ? "Suppressing…" : "Suppress customer"}
                </button>
              </div>
            )}

            {suppressions.length === 0 ? (
              <SectionState icon="◌" title="No suppressed customers">
                <p>
                  Nothing is suppressed in this workspace. An inbound
                  &ldquo;STOP&rdquo; message or the control above creates a
                  workspace-scoped suppression.
                </p>
              </SectionState>
            ) : (
              <ul className="mt-4 space-y-2">
                {suppressions.map((item) => (
                  <li
                    key={item.suppression.id}
                    className="rounded-xl border border-line px-4 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">
                          {protectedCustomerName(item.customer)}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-soft">
                          {item.customer.phoneE164 ??
                            item.customer.providerContactId ??
                            "No contact identifier"}
                          {" · "}
                          {SUPPRESSION_REASON_LABELS[item.suppression.reason]}
                          {" · "}
                          {item.conversationCount} conversation(s)
                        </p>
                        {item.suppression.notes ? (
                          <p className="mt-1 text-xs text-ink-soft">
                            {item.suppression.notes}
                          </p>
                        ) : null}
                        <p className="mt-1 text-[11px] text-ink-faint">
                          Suppressed {formatDate(item.suppression.suppressedAt)}
                        </p>
                      </div>
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() =>
                            void removeSuppression(item.customer.id)
                          }
                          disabled={busyCustomerId === item.customer.id}
                          className="btn btn-secondary shrink-0"
                        >
                          {busyCustomerId === item.customer.id
                            ? "Restoring…"
                            : "Remove suppression"}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardSection>

          <CardSection
            title="Delivery-status webhook events"
            description="Every signed delivery event is stored with its deduplication key, provider timestamp, duplicate count, processing outcome, and failure details. Older or regressive events are audited as ignored."
            className="lg:col-span-2"
          >
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <label className="field-label min-w-48">
                Processing outcome
                <select
                  value={outcomeFilter}
                  onChange={(event) => {
                    setEventsOffset(0);
                    setOutcomeFilter(
                      event.target.value as DeliveryEventOutcome | "all",
                    );
                  }}
                  className="input mt-1"
                >
                  <option value="all">All outcomes</option>
                  {DELIVERY_EVENT_OUTCOMES.map((outcome) => (
                    <option key={outcome} value={outcome}>
                      {outcomeLabel(outcome)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-ink-soft">
                {events.length} event(s) on this page
              </p>
            </div>

            {eventsLoading ? (
              <div className="flex items-center justify-center gap-3 py-10 text-sm text-ink-soft">
                <Spinner />
                Loading delivery events…
              </div>
            ) : eventsError ? (
              <Alert tone="danger">{eventsError}</Alert>
            ) : events.length === 0 ? (
              <SectionState icon="◌" title="No delivery events">
                <p>
                  Send a signed delivery-status fixture to
                  <code className="mx-1">/api/webhooks/whatsapp</code>
                  after a mock outbound message has been accepted.
                </p>
              </SectionState>
            ) : (
              <ul className="space-y-2">
                {events.map((event) => (
                  <li
                    key={event.id}
                    className="rounded-xl border border-line px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={outcomeBadgeClass(event.processingOutcome)}>
                        {outcomeLabel(event.processingOutcome)}
                      </span>
                      <span className="text-sm font-semibold text-ink">
                        {event.providerStatus}
                      </span>
                      {event.outboundStatus ? (
                        <span className="badge badge-neutral">
                          Message:{" "}
                          {
                            OUTBOUND_STATUS_LABELS[
                              event.outboundStatus as keyof typeof OUTBOUND_STATUS_LABELS
                            ]
                          }
                        </span>
                      ) : null}
                      {event.duplicateCount > 0 ? (
                        <span className="badge bg-warning-soft text-warning-ink">
                          {event.duplicateCount} duplicate delivery(ies)
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 break-all text-xs text-ink-soft">
                      wamid: {event.providerMessageId}
                    </p>
                    {event.outboundContent ? (
                      <p className="mt-1 line-clamp-2 text-xs text-ink">
                        {event.outboundContent}
                      </p>
                    ) : null}
                    <dl className="mt-2 grid gap-2 text-[11px] text-ink-faint sm:grid-cols-3">
                      <div>
                        <dt className="font-medium">Provider time</dt>
                        <dd>{formatDate(event.providerTimestamp)}</dd>
                      </div>
                      <div>
                        <dt className="font-medium">Received</dt>
                        <dd>{formatDate(event.receivedAt)}</dd>
                      </div>
                      <div>
                        <dt className="font-medium">Last duplicate</dt>
                        <dd>{formatDate(event.lastReceivedAt)}</dd>
                      </div>
                    </dl>
                    {event.processingReason ? (
                      <p className="mt-2 text-xs text-ink-soft">
                        {event.processingReason}
                      </p>
                    ) : null}
                    {event.failureReason ? (
                      <p className="mt-1 text-xs text-danger-ink">
                        Failure: {event.failureReason}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {!eventsLoading && (eventsOffset > 0 || eventsHasMore) ? (
              <div className="mt-4 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setEventsOffset(Math.max(0, eventsOffset - PAGE_SIZE))
                  }
                  disabled={eventsOffset === 0}
                  className="btn btn-secondary"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setEventsOffset(eventsOffset + PAGE_SIZE)}
                  disabled={!eventsHasMore}
                  className="btn btn-secondary"
                >
                  Next
                </button>
              </div>
            ) : null}
          </CardSection>
        </div>
      )}
    </div>
  );
}
