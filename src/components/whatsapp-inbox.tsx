"use client";

import { useEffect, useState } from "react";
import {
  conversationDisplayName,
  conversationPreview,
  formatWhatsAppTimestamp,
  parseConversationMessagesResponse,
  parseConversationsResponse,
  type WhatsAppConversation,
  type WhatsAppMessage,
} from "@/lib/whatsapp";
import { Alert, SectionState } from "@/components/ui";

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

export function WhatsAppInbox() {
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [conversationsError, setConversationsError] = useState<string | null>(
    null,
  );
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadConversations() {
      setConversationsLoading(true);
      setConversationsError(null);

      try {
        const response = await fetch("/api/whatsapp/conversations", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await readJson(response);

        if (!response.ok) {
          throw new Error(
            errorMessage(data, "Unable to load WhatsApp conversations."),
          );
        }

        const parsed = parseConversationsResponse(data);

        if (!parsed) {
          throw new Error(
            "The WhatsApp inbox returned an unexpected response.",
          );
        }

        if (controller.signal.aborted) return;

        setConversations(parsed);
        if (parsed.length === 0) {
          setSelectedConversationId(null);
          setMessages([]);
          setMessagesError(null);
          setMessagesLoading(false);
        } else {
          setSelectedConversationId((current) => {
            if (current && parsed.some((item) => item.id === current)) {
              return current;
            }

            return parsed[0]?.id ?? null;
          });
        }
      } catch (error) {
        if (controller.signal.aborted) return;

        setConversationsError(
          error instanceof Error
            ? error.message
            : "Unable to load WhatsApp conversations.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setConversationsLoading(false);
        }
      }
    }

    void loadConversations();
    return () => controller.abort();
  }, [refreshToken]);

  useEffect(() => {
    if (!selectedConversationId) {
      return;
    }

    const controller = new AbortController();

    async function loadMessages() {
      setMessagesLoading(true);
      setMessagesError(null);

      try {
        const response = await fetch(
          `/api/whatsapp/conversations/${selectedConversationId}/messages`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const data = await readJson(response);

        if (!response.ok) {
          throw new Error(
            errorMessage(data, "Unable to load this WhatsApp conversation."),
          );
        }

        const parsed = parseConversationMessagesResponse(data);

        if (!parsed) {
          throw new Error(
            "The WhatsApp inbox returned an unexpected conversation.",
          );
        }

        if (controller.signal.aborted) return;

        setMessages(parsed.messages);
      } catch (error) {
        if (controller.signal.aborted) return;

        setMessagesError(
          error instanceof Error
            ? error.message
            : "Unable to load this WhatsApp conversation.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setMessagesLoading(false);
        }
      }
    }

    void loadMessages();
    return () => controller.abort();
  }, [selectedConversationId, refreshToken]);

  const selectedConversation =
    conversations.find((item) => item.id === selectedConversationId) ?? null;

  function selectConversation(conversationId: string) {
    setSelectedConversationId(conversationId);
    setMessages([]);
    setMessagesError(null);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            WhatsApp test inbox
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-soft">
            Inbound messages from the one configured Meta test number and
            workspace. This inbox has no reply controls and does not send
            WhatsApp messages.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRefreshToken((token) => token + 1)}
          className="btn btn-secondary shrink-0"
        >
          Refresh
        </button>
      </div>

      <div className="mb-6">
        <Alert tone="info">
          Single-business test integration. Messages appear only after Meta
          delivers a signed webhook to this workspace. Automatic replies,
          templates, and outbound sending are not implemented.
        </Alert>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <section
          aria-labelledby="conversation-list-title"
          className="card overflow-hidden"
        >
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div>
              <h2
                id="conversation-list-title"
                className="font-bold text-ink"
              >
                Conversations
              </h2>
              <p className="mt-0.5 text-xs text-ink-soft">
                {conversations.length} in this workspace
              </p>
            </div>
          </div>

          {conversationsLoading ? (
            <p
              role="status"
              className="px-5 py-14 text-center text-sm text-ink-soft"
            >
              Loading conversations…
            </p>
          ) : conversationsError ? (
            <div role="alert">
              <SectionState
                title="Unable to load conversations"
                action={
                  <button
                    type="button"
                    onClick={() => setRefreshToken((token) => token + 1)}
                    className="btn btn-quiet"
                  >
                    Try again
                  </button>
                }
              >
                <p>{conversationsError}</p>
              </SectionState>
            </div>
          ) : conversations.length === 0 ? (
            <SectionState icon="◌" title="No WhatsApp conversations yet">
              <p>
                Send a message to the configured Meta test number, then
                refresh. Unsupported message types will also appear here.
              </p>
            </SectionState>
          ) : (
            <ul
              className="max-h-[34rem] divide-y divide-line overflow-y-auto"
              aria-label="Conversation list"
            >
              {conversations.map((conversation) => {
                const selected = conversation.id === selectedConversationId;

                return (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      onClick={() => selectConversation(conversation.id)}
                      aria-current={selected ? "true" : undefined}
                      className={`w-full px-5 py-4 text-left transition-colors ${
                        selected
                          ? "bg-accent-soft"
                          : "hover:bg-hushed"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p
                          className={`min-w-0 truncate text-sm font-semibold ${
                            selected ? "text-accent-ink" : "text-ink"
                          }`}
                        >
                          {conversationDisplayName(conversation)}
                        </p>
                        <time
                          dateTime={conversation.lastMessageAt ?? undefined}
                          className="shrink-0 text-[11px] text-ink-faint"
                        >
                          {formatWhatsAppTimestamp(
                            conversation.lastMessageAt,
                          )}
                        </time>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-soft">
                        {conversationPreview(conversation)}
                      </p>
                      {conversation.leadId ? (
                        <span className="badge badge-booked mt-2 rounded-full">
                          Linked to lead
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="message-thread-title"
          className="card flex min-h-[16rem] flex-col overflow-hidden lg:min-h-[30rem]"
        >
          {selectedConversation ? (
            <>
              <div className="border-b border-line px-5 py-4">
                <h2
                  id="message-thread-title"
                  className="truncate font-bold text-ink"
                >
                  {conversationDisplayName(selectedConversation)}
                </h2>
                <p className="mt-0.5 text-xs text-ink-soft">
                  WhatsApp ID: {selectedConversation.customerWaId}
                  {selectedConversation.leadId ? " · Linked to a lead" : ""}
                </p>
              </div>

              <div className="flex-1 bg-hushed/50 px-4 py-5 sm:px-6">
                {messagesLoading ? (
                  <p
                    role="status"
                    className="py-16 text-center text-sm text-ink-soft"
                  >
                    Loading messages…
                  </p>
                ) : messagesError ? (
                  <div role="alert" className="py-16">
                    <SectionState
                      title="Unable to load this conversation"
                      action={
                        <button
                          type="button"
                          onClick={() => setRefreshToken((token) => token + 1)}
                          className="btn btn-quiet"
                        >
                          Try again
                        </button>
                      }
                    >
                      <p>{messagesError}</p>
                    </SectionState>
                  </div>
                ) : messages.length === 0 ? (
                  <SectionState title="No messages in this conversation">
                    <p>
                      Messages appear here as Meta delivers them to the
                      configured webhook. Use the Refresh button to check for
                      new messages.
                    </p>
                  </SectionState>
                ) : (
                  <ol className="space-y-3" aria-label="Inbound WhatsApp messages">
                    {messages.map((message) => (
                      <li key={message.id} className="flex justify-start">
                        <article
                          className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ring-1 ${
                            message.processingStatus === "unsupported"
                              ? "border border-[color-mix(in_oklab,var(--rp-warning)_25%,transparent)] bg-warning-soft ring-0"
                              : "border-0 bg-raised ring-line"
                          }`}
                        >
                          <span className="sr-only">Inbound message: </span>
                          {message.processingStatus === "unsupported" ? (
                            <p className="text-sm font-medium text-warning-ink">
                              Unsupported {message.messageType} message
                            </p>
                          ) : (
                            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink">
                              {message.text}
                            </p>
                          )}
                          <time
                            dateTime={message.providerTimestamp}
                            className="mt-2 block text-right text-[11px] text-ink-faint"
                          >
                            {formatWhatsAppTimestamp(
                              message.providerTimestamp,
                            )}
                          </time>
                        </article>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <p className="border-t border-line px-5 py-3 text-xs text-ink-faint">
                Inbound-only test view. Reply drafting and WhatsApp sending are
                not connected to this inbox.
              </p>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 py-16 text-center">
              <SectionState icon="◌" title="Select a conversation">
                <p className="mx-auto max-w-sm">
                  Incoming text and unsupported message types from the
                  configured test number will be shown here.
                </p>
              </SectionState>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
