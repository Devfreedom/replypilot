"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "./auth-provider";
import { Alert, PageHeading, SectionState, Spinner } from "./ui";
import {
  CONVERSATION_FILTERS,
  CONVERSATION_STATUS_LABELS,
  conversationDisplayName,
  conversationIdentity,
  conversationInitials,
  conversationPreview,
  formatConversationTimestamp,
  formatMessageDay,
  formatMessageTime,
  formatMessageTitle,
  mergeConversations,
  mergeMessages,
  messageDayKey,
  parseConversationMessagesResponse,
  parseConversationsResponse,
  type ConversationFilter,
  type ConversationStatus,
  type WhatsAppConversation,
  type WhatsAppMessage,
} from "@/lib/whatsapp";

const CONVERSATION_PAGE_SIZE = 30;
const MESSAGE_PAGE_SIZE = 30;

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

class ApiError extends Error {
  readonly unauthorized: boolean;

  constructor(message: string, unauthorized = false) {
    super(message);
    this.name = "ApiError";
    this.unauthorized = unauthorized;
  }
}

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

function toApiError(
  data: unknown,
  response: Response,
  fallback: string,
): ApiError {
  if (response.status === 401) {
    return new ApiError(
      "Your session has expired. Sign in again to continue.",
      true,
    );
  }

  return new ApiError(errorMessage(data, fallback));
}

function messageForError(error: unknown, fallback: string): ApiError {
  return error instanceof ApiError ? error : new ApiError(fallback);
}

const STATUS_BADGE_CLASSES: Record<ConversationStatus, string> = {
  open: "badge-booked",
  closed: "badge-neutral",
  archived: "badge-quoted",
};

const STATUS_DOT_CLASSES: Record<ConversationStatus, string> = {
  open: "bg-success",
  closed: "bg-ink-faint",
  archived: "bg-warning",
};

function StatusBadge({ status }: { status: ConversationStatus }) {
  return (
    <span className={`badge ${STATUS_BADGE_CLASSES[status]}`}>
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASSES[status]}`}
      />
      {CONVERSATION_STATUS_LABELS[status]}
    </span>
  );
}

function ConversationAvatar({
  conversation,
  className = "h-10 w-10 text-xs",
}: {
  conversation: WhatsAppConversation;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-bold text-accent-ink ${className}`}
    >
      {conversationInitials(conversation)}
    </span>
  );
}

function DayDivider({ value }: { value: string }) {
  return (
    <div className="my-3 flex items-center gap-3">
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
      <span className="text-[11px] font-medium text-ink-faint">
        {formatMessageDay(value)}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-line" />
    </div>
  );
}

function MessageBubble({ message }: { message: WhatsAppMessage }) {
  const outbound = message.direction === "outbound";
  const unsupported = message.processingStatus === "unsupported";

  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <article
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm ring-1 sm:max-w-[75%] ${
          unsupported
            ? "bg-warning-soft text-warning-ink ring-[color-mix(in_oklab,var(--rp-warning)_25%,transparent)]"
            : outbound
              ? "bg-accent text-on-accent ring-transparent"
              : "bg-raised text-ink ring-line"
        }`}
      >
        <span className="sr-only">
          {outbound ? "Outbound" : "Inbound"} message:{" "}
        </span>
        {unsupported ? (
          <div>
            <p className="text-sm font-semibold">
              Unsupported {message.messageType} message
            </p>
            <p className="mt-1 text-xs leading-5 opacity-90">
              This message type is stored but cannot be displayed yet.
            </p>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm leading-6">
            {message.text ?? "Message content unavailable"}
          </p>
        )}
        <time
          dateTime={message.providerTimestamp}
          title={formatMessageTitle(message.providerTimestamp)}
          className={`mt-1 block text-right text-[11px] ${
            outbound ? "opacity-80" : "text-ink-faint"
          }`}
        >
          {formatMessageTime(message.providerTimestamp)}
        </time>
      </article>
    </div>
  );
}

function ConversationListSkeleton() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading conversations…</span>
      <ul aria-hidden="true" className="divide-y divide-line">
        {Array.from({ length: 5 }, (_, index) => (
          <li key={index} className="flex gap-3 px-4 py-3">
            <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-hushed" />
            <span className="min-w-0 flex-1 space-y-2">
              <span className="block h-3 w-1/2 animate-pulse rounded bg-hushed" />
              <span className="block h-3 w-3/4 animate-pulse rounded bg-hushed" />
              <span className="block h-2.5 w-1/3 animate-pulse rounded bg-hushed" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MessagesLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-3 text-sm text-ink-soft"
    >
      <Spinner className="h-6 w-6" />
      Loading messages…
    </div>
  );
}

function emptyListCopy(filter: ConversationFilter): {
  title: string;
  body: string;
} {
  if (filter === "all") {
    return {
      title: "No WhatsApp conversations yet",
      body: "Inbound messages appear here after they are delivered to the connected WhatsApp number.",
    };
  }

  return {
    title: `No ${CONVERSATION_STATUS_LABELS[filter].toLowerCase()} conversations`,
    body: "Try another status filter or refresh the inbox.",
  };
}

/**
 * The thread is keyed by conversation and refresh token. Remounting gives each
 * conversation a clean message/cursor state and guarantees that a response for
 * a previously selected conversation cannot overwrite the current thread.
 */
function ConversationThread({
  conversation,
  onBack,
  onRefresh,
}: {
  conversation: WhatsAppConversation;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const { signOut } = useAuth();
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [messagesError, setMessagesError] = useState<ApiError | null>(null);
  const [olderError, setOlderError] = useState<ApiError | null>(null);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const prependAnchorRef = useRef<{
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);
  const scrollToBottomRef = useRef(true);
  const olderAbortRef = useRef<AbortController | null>(null);
  const loadingOlderRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const params = new URLSearchParams({
          limit: String(MESSAGE_PAGE_SIZE),
          direction: "before",
        });
        const response = await fetch(
          `/api/conversations/${conversation.id}/messages?${params.toString()}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = await readJson(response);

        if (!response.ok) {
          throw toApiError(data, response, "Could not load messages.");
        }

        const parsed = parseConversationMessagesResponse(data);

        if (!parsed) {
          throw new ApiError("The inbox returned an unexpected response.");
        }

        if (controller.signal.aborted) {
          return;
        }

        setMessages(parsed.messages);
        setOlderCursor(parsed.pagination?.prevCursor ?? null);
        setHasOlder(parsed.pagination?.hasMore ?? false);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setMessagesError(messageForError(error, "Could not load messages."));
      } finally {
        if (!controller.signal.aborted) {
          setMessagesLoading(false);
        }
      }
    }

    void load();

    return () => {
      controller.abort();
      olderAbortRef.current?.abort();
      olderAbortRef.current = null;
    };
  }, [conversation.id]);

  useIsomorphicLayoutEffect(() => {
    const container = scrollRef.current;

    if (!container || messages.length === 0) {
      return;
    }

    const anchor = prependAnchorRef.current;

    if (anchor) {
      container.scrollTop =
        container.scrollHeight - anchor.scrollHeight + anchor.scrollTop;
      prependAnchorRef.current = null;
      return;
    }

    if (scrollToBottomRef.current) {
      container.scrollTop = container.scrollHeight;
      scrollToBottomRef.current = false;
    }
  }, [messages]);

  const loadOlder = useCallback(async () => {
    if (!olderCursor || loadingOlderRef.current) {
      return;
    }

    const container = scrollRef.current;

    if (container) {
      prependAnchorRef.current = {
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
      };
    }

    const controller = new AbortController();
    olderAbortRef.current?.abort();
    olderAbortRef.current = controller;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setOlderError(null);

    try {
      const params = new URLSearchParams({
        limit: String(MESSAGE_PAGE_SIZE),
        direction: "before",
        cursor: olderCursor,
      });
      const response = await fetch(
        `/api/conversations/${conversation.id}/messages?${params.toString()}`,
        { cache: "no-store", signal: controller.signal },
      );
      const data = await readJson(response);

      if (!response.ok) {
        throw toApiError(data, response, "Could not load older messages.");
      }

      const parsed = parseConversationMessagesResponse(data);

      if (!parsed) {
        throw new ApiError("The inbox returned an unexpected response.");
      }

      if (controller.signal.aborted) {
        return;
      }

      setMessages((current) =>
        mergeMessages(current, parsed.messages, "older"),
      );
      setOlderCursor(parsed.pagination?.prevCursor ?? null);
      setHasOlder(parsed.pagination?.hasMore ?? false);

      if (parsed.messages.length === 0) {
        prependAnchorRef.current = null;
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      prependAnchorRef.current = null;
      setOlderError(
        messageForError(error, "Could not load older messages."),
      );
    } finally {
      loadingOlderRef.current = false;

      if (!controller.signal.aborted) {
        setLoadingOlder(false);
      }
    }
  }, [conversation.id, olderCursor]);

  const identity = conversationIdentity(conversation);
  const sessionExpired =
    messagesError?.unauthorized === true || olderError?.unauthorized === true;

  return (
    <>
      <div className="flex items-start gap-3 border-b border-line px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="mt-0.5 rounded-lg px-2 py-1 text-lg leading-none text-ink-soft hover:bg-hushed hover:text-ink lg:hidden"
        >
          ←
        </button>
        <ConversationAvatar
          conversation={conversation}
          className="hidden h-11 w-11 text-sm sm:flex"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-bold text-ink">
              {conversationDisplayName(conversation)}
            </h2>
            <StatusBadge status={conversation.status} />
            {conversation.leadId ? (
              <span className="badge badge-neutral">Linked lead</span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-ink-soft">
            <span className="font-medium">{identity.label}:</span>{" "}
            {identity.value}
          </p>
        </div>
      </div>

      {sessionExpired ? (
        <div
          role="alert"
          className="border-b border-[color-mix(in_oklab,var(--rp-danger)_25%,transparent)] bg-danger-soft px-4 py-3 text-sm leading-6 text-danger-ink sm:px-5"
        >
          <p className="font-semibold">Your session has expired.</p>
          <p>Sign in again to continue reading messages.</p>
          <button
            type="button"
            onClick={() => void signOut()}
            className="btn btn-secondary mt-3"
          >
            Sign in again
          </button>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto bg-hushed/40 px-4 py-4 sm:px-6"
      >
        {messagesLoading ? (
          <MessagesLoading />
        ) : messagesError ? (
          <SectionState
            icon="!"
            title="Could not load messages"
            action={
              <button
                type="button"
                onClick={onRefresh}
                className="btn btn-secondary"
              >
                Try again
              </button>
            }
          >
            <p>{messagesError.message}</p>
          </SectionState>
        ) : messages.length === 0 ? (
          <SectionState icon="◌" title="No messages in this conversation">
            <p>
              Messages appear here after they are delivered to the connected
              WhatsApp number.
            </p>
          </SectionState>
        ) : (
          <>
            {hasOlder ? (
              <div className="mb-4 text-center">
                <button
                  type="button"
                  onClick={() => void loadOlder()}
                  disabled={loadingOlder}
                  className="btn btn-secondary text-xs"
                >
                  {loadingOlder ? (
                    <>
                      <Spinner className="h-3.5 w-3.5" />
                      Loading older messages…
                    </>
                  ) : (
                    "Load older messages"
                  )}
                </button>
                {olderError ? (
                  <p role="alert" className="mt-2 text-xs text-danger-ink">
                    {olderError.message}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mb-4 text-center text-[11px] text-ink-faint">
                Beginning of this conversation
              </p>
            )}

            <ol
              aria-label="Message history"
              aria-busy={loadingOlder}
              className="space-y-2"
            >
              {messages.map((message, index) => {
                const previous = messages[index - 1];
                const showDay =
                  !previous ||
                  messageDayKey(previous.providerTimestamp) !==
                    messageDayKey(message.providerTimestamp);

                return (
                  <li key={message.id}>
                    {showDay ? (
                      <DayDivider value={message.providerTimestamp} />
                    ) : null}
                    <MessageBubble message={message} />
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>

      <p className="border-t border-line px-4 py-2.5 text-[11px] text-ink-faint sm:px-5">
        Inbound-only view. Reply drafting and WhatsApp sending are not connected
        to this inbox.
      </p>
    </>
  );
}

export function WhatsAppInbox() {
  const { signOut } = useAuth();

  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [filter, setFilter] = useState<ConversationFilter>("open");
  const [listOffset, setListOffset] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [loadingMoreConversations, setLoadingMoreConversations] =
    useState(false);
  const [conversationsError, setConversationsError] =
    useState<ApiError | null>(null);
  const [listHasMore, setListHasMore] = useState(false);
  const [listNextOffset, setListNextOffset] = useState<number | null>(null);
  const [mobilePane, setMobilePane] = useState<"list" | "thread">("list");

  useEffect(() => {
    const controller = new AbortController();
    const replacing = listOffset === 0;

    async function load() {
      if (replacing) {
        setConversationsLoading(true);
      } else {
        setLoadingMoreConversations(true);
      }

      setConversationsError(null);

      try {
        const params = new URLSearchParams({
          limit: String(CONVERSATION_PAGE_SIZE),
          offset: String(listOffset),
        });

        if (filter !== "all") {
          params.set("status", filter);
        }

        const response = await fetch(
          `/api/conversations?${params.toString()}`,
          { cache: "no-store", signal: controller.signal },
        );
        const data = await readJson(response);

        if (!response.ok) {
          throw toApiError(data, response, "Could not load conversations.");
        }

        const parsed = parseConversationsResponse(data);

        if (!parsed) {
          throw new ApiError("The inbox returned an unexpected response.");
        }

        if (controller.signal.aborted) {
          return;
        }

        setConversations((current) =>
          replacing
            ? parsed.conversations
            : mergeConversations(current, parsed.conversations),
        );
        setListHasMore(parsed.pagination?.hasMore ?? false);
        setListNextOffset(parsed.pagination?.nextOffset ?? null);

        if (replacing) {
          setSelectedConversationId((current) => {
            if (
              current &&
              parsed.conversations.some(
                (conversation) => conversation.id === current,
              )
            ) {
              return current;
            }

            return parsed.conversations[0]?.id ?? null;
          });

          if (parsed.conversations.length === 0) {
            setMobilePane("list");
          }
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setConversationsError(
          messageForError(error, "Could not load conversations."),
        );
      } finally {
        if (!controller.signal.aborted) {
          setConversationsLoading(false);
          setLoadingMoreConversations(false);
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [filter, listOffset, refreshToken]);

  const selectedConversation = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.id === selectedConversationId,
      ) ?? null,
    [conversations, selectedConversationId],
  );

  function changeFilter(next: ConversationFilter) {
    if (next === filter) {
      return;
    }

    setFilter(next);
    setListOffset(0);
    setConversations([]);
    setConversationsError(null);
    setListHasMore(false);
    setListNextOffset(null);
    setSelectedConversationId(null);
    setMobilePane("list");
  }

  function selectConversation(conversationId: string) {
    if (conversationId === selectedConversationId) {
      setMobilePane("thread");
      return;
    }

    setSelectedConversationId(conversationId);
    setMobilePane("thread");
  }

  function refresh() {
    setRefreshToken((token) => token + 1);
    setListOffset(0);
  }

  function loadMoreConversations() {
    if (listNextOffset === null || loadingMoreConversations) {
      return;
    }

    setListOffset(listNextOffset);
  }

  const listCopy = emptyListCopy(filter);
  const sessionExpired = conversationsError?.unauthorized === true;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeading
        title="Unified WhatsApp inbox"
        description="Read and triage inbound WhatsApp conversations. Every conversation is scoped to your workspace."
      >
        <button
          type="button"
          onClick={refresh}
          className="btn btn-secondary"
          disabled={conversationsLoading}
        >
          Refresh
        </button>
      </PageHeading>

      <div className="mt-4 space-y-3">
        <Alert tone="info">
          <span className="font-semibold">Inbound-only inbox.</span> Messages
          delivered to your connected WhatsApp number appear here. Outbound
          replies, templates, and AI drafting are not connected yet.
        </Alert>

        {sessionExpired ? (
          <div
            role="alert"
            className="rounded-xl border border-[color-mix(in_oklab,var(--rp-danger)_25%,transparent)] bg-danger-soft px-4 py-3 text-sm leading-6 text-danger-ink"
          >
            <p className="font-semibold">Your session has expired.</p>
            <p>Sign in again to continue reading conversations.</p>
            <button
              type="button"
              onClick={() => void signOut()}
              className="btn btn-secondary mt-3"
            >
              Sign in again
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)] lg:items-stretch">
        <section
          aria-label="Conversations"
          className={`card h-[calc(100dvh-11rem)] min-h-[30rem] flex-col overflow-hidden lg:flex lg:h-[calc(100dvh-13rem)] ${
            mobilePane === "thread" ? "hidden" : "flex"
          }`}
        >
          <div className="border-b border-line px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-ink">Conversations</h2>
                <p className="text-xs text-ink-soft">
                  {listHasMore
                    ? `${conversations.length}+ shown`
                    : `${conversations.length} shown`}
                </p>
              </div>
              {conversationsLoading ? (
                <span role="status" aria-live="polite">
                  <Spinner className="h-4 w-4" />
                  <span className="sr-only">Loading conversations…</span>
                </span>
              ) : null}
            </div>

            <div
              role="group"
              aria-label="Filter conversations by status"
              className="mt-3 flex flex-wrap gap-1.5"
            >
              {CONVERSATION_FILTERS.map((option) => {
                const selected = filter === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => changeFilter(option.value)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                      selected
                        ? "bg-accent text-on-accent"
                        : "bg-hushed text-ink-soft hover:bg-line hover:text-ink"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {conversationsLoading ? (
              <ConversationListSkeleton />
            ) : conversationsError ? (
              <SectionState
                icon="!"
                title="Could not load conversations"
                action={
                  <button
                    type="button"
                    onClick={refresh}
                    className="btn btn-secondary"
                  >
                    Try again
                  </button>
                }
              >
                <p>{conversationsError.message}</p>
              </SectionState>
            ) : conversations.length === 0 ? (
              <SectionState
                icon="◌"
                title={listCopy.title}
                action={
                  <button
                    type="button"
                    onClick={refresh}
                    className="btn btn-secondary"
                  >
                    Refresh
                  </button>
                }
              >
                <p>{listCopy.body}</p>
              </SectionState>
            ) : (
              <ul aria-label="Conversation list" className="divide-y divide-line">
                {conversations.map((conversation) => {
                  const selected =
                    conversation.id === selectedConversationId;
                  const displayName = conversationDisplayName(conversation);
                  const identity = conversationIdentity(conversation);

                  return (
                    <li key={conversation.id}>
                      <button
                        type="button"
                        onClick={() => selectConversation(conversation.id)}
                        aria-current={selected ? "true" : undefined}
                        className={`flex w-full gap-3 border-l-2 px-4 py-3 text-left transition-colors ${
                          selected
                            ? "border-accent bg-accent-soft"
                            : "border-transparent hover:bg-hushed"
                        }`}
                      >
                        <ConversationAvatar conversation={conversation} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span
                              className={`truncate text-sm font-semibold ${
                                selected ? "text-accent-ink" : "text-ink"
                              }`}
                            >
                              {displayName}
                            </span>
                            {conversation.lastMessageAt ? (
                              <time
                                dateTime={conversation.lastMessageAt}
                                className="shrink-0 text-[11px] text-ink-faint"
                              >
                                {formatConversationTimestamp(
                                  conversation.lastMessageAt,
                                )}
                              </time>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-ink-soft">
                            {conversationPreview(conversation)}
                          </span>
                          <span className="mt-2 flex flex-wrap items-center gap-1.5">
                            <StatusBadge status={conversation.status} />
                            {conversation.leadId ? (
                              <span className="badge badge-neutral">
                                Linked lead
                              </span>
                            ) : null}
                            {identity.value !== displayName ? (
                              <span className="max-w-full truncate text-[11px] text-ink-faint">
                                {identity.value}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {listHasMore && !conversationsLoading ? (
              <div className="border-t border-line p-3">
                <button
                  type="button"
                  onClick={loadMoreConversations}
                  disabled={loadingMoreConversations}
                  className="btn btn-secondary w-full"
                >
                  {loadingMoreConversations ? (
                    <>
                      <Spinner className="h-4 w-4" />
                      Loading conversations…
                    </>
                  ) : (
                    "Load more conversations"
                  )}
                </button>
              </div>
            ) : null}
          </div>
        </section>

        <section
          aria-label="Conversation messages"
          className={`card h-[calc(100dvh-11rem)] min-h-[30rem] flex-col overflow-hidden lg:flex lg:h-[calc(100dvh-13rem)] ${
            mobilePane === "list" ? "hidden" : "flex"
          }`}
        >
          {selectedConversation ? (
            <ConversationThread
              key={`${selectedConversation.id}:${refreshToken}`}
              conversation={selectedConversation}
              onBack={() => setMobilePane("list")}
              onRefresh={refresh}
            />
          ) : (
            <SectionState
              icon="◌"
              title="Select a conversation"
              action={
                <button
                  type="button"
                  onClick={() => setMobilePane("list")}
                  className="btn btn-secondary lg:hidden"
                >
                  Back to conversations
                </button>
              }
            >
              <p>
                Choose a conversation from the list to read its message history.
              </p>
            </SectionState>
          )}
        </section>
      </div>
    </div>
  );
}
