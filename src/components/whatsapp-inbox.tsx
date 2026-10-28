"use client";

import Link from "next/link";
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
import { useAuth } from "./auth-provider";

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
  const { user, workspace, signOut } = useAuth();
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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="min-w-0">
            <Link
              href="/"
              className="text-xs font-medium text-blue-700 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              ← Back to dashboard
            </Link>
            <p className="mt-1 truncate text-xs text-slate-500">
              {workspace?.name ?? "Workspace"} / WhatsApp test inbox
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold">{user?.name ?? "Account"}</p>
              <p className="truncate text-xs text-slate-500">{user?.email}</p>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-950">
              WhatsApp test inbox
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Inbound messages from the one configured Meta test number and
              workspace. This inbox has no reply controls and does not send
              WhatsApp messages.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRefreshToken((token) => token + 1)}
            className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            Refresh
          </button>
        </div>

        <p className="mb-6 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-800">
          Single-business test integration. Messages appear only after Meta
          delivers a signed webhook to this workspace. Automatic replies,
          templates, and outbound sending are not implemented.
        </p>

        <div className="grid gap-5 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
          <section
            aria-labelledby="conversation-list-title"
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2
                  id="conversation-list-title"
                  className="font-bold text-slate-900"
                >
                  Conversations
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {conversations.length} in this workspace
                </p>
              </div>
            </div>

            {conversationsLoading ? (
              <p
                role="status"
                className="px-5 py-14 text-center text-sm text-slate-500"
              >
                Loading conversations…
              </p>
            ) : conversationsError ? (
              <div role="alert" className="px-5 py-14 text-center">
                <p className="font-semibold text-slate-900">
                  Unable to load conversations
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {conversationsError}
                </p>
                <button
                  type="button"
                  onClick={() => setRefreshToken((token) => token + 1)}
                  className="mt-4 rounded-lg text-sm font-semibold text-blue-700 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                >
                  Try again
                </button>
              </div>
            ) : conversations.length === 0 ? (
              <div className="px-5 py-14 text-center">
                <div aria-hidden="true" className="text-3xl text-slate-300">
                  ◌
                </div>
                <p className="mt-3 font-semibold text-slate-900">
                  No WhatsApp conversations yet
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Send a message to the configured Meta test number, then
                  refresh. Unsupported message types will also appear here.
                </p>
              </div>
            ) : (
              <ul className="max-h-[34rem] divide-y divide-slate-100 overflow-y-auto">
                {conversations.map((conversation) => {
                  const selected = conversation.id === selectedConversationId;

                  return (
                    <li key={conversation.id}>
                      <button
                        type="button"
                        onClick={() => selectConversation(conversation.id)}
                        aria-pressed={selected}
                        className={`w-full px-5 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600 ${
                          selected ? "bg-blue-50/80" : "hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {conversationDisplayName(conversation)}
                          </p>
                          <time
                            dateTime={conversation.lastMessageAt ?? undefined}
                            className="shrink-0 text-[11px] text-slate-400"
                          >
                            {formatWhatsAppTimestamp(
                              conversation.lastMessageAt,
                            )}
                          </time>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                          {conversationPreview(conversation)}
                        </p>
                        {conversation.leadId ? (
                          <span className="mt-2 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
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
            className="flex min-h-[30rem] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            {selectedConversation ? (
              <>
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2
                    id="message-thread-title"
                    className="truncate font-bold text-slate-900"
                  >
                    {conversationDisplayName(selectedConversation)}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    WhatsApp ID: {selectedConversation.customerWaId}
                    {selectedConversation.leadId ? " · Linked to a lead" : ""}
                  </p>
                </div>

                <div className="flex-1 bg-slate-50/60 px-4 py-5 sm:px-6">
                  {messagesLoading ? (
                    <p
                      role="status"
                      className="py-16 text-center text-sm text-slate-500"
                    >
                      Loading messages…
                    </p>
                  ) : messagesError ? (
                    <div role="alert" className="py-16 text-center">
                      <p className="font-semibold text-slate-900">
                        Unable to load this conversation
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {messagesError}
                      </p>
                      <button
                        type="button"
                        onClick={() => setRefreshToken((token) => token + 1)}
                        className="mt-4 rounded-lg text-sm font-semibold text-blue-700 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                      >
                        Try again
                      </button>
                    </div>
                  ) : messages.length === 0 ? (
                    <p className="py-16 text-center text-sm text-slate-500">
                      No messages in this conversation.
                    </p>
                  ) : (
                    <ol className="space-y-3" aria-label="Inbound WhatsApp messages">
                      {messages.map((message) => (
                        <li key={message.id} className="flex justify-start">
                          <article
                            className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ring-1 ${
                              message.processingStatus === "unsupported"
                                ? "bg-amber-50 ring-amber-100"
                                : "bg-white ring-slate-200"
                            }`}
                          >
                            <span className="sr-only">Inbound message: </span>
                            {message.processingStatus === "unsupported" ? (
                              <p className="text-sm font-medium text-amber-900">
                                Unsupported {message.messageType} message
                              </p>
                            ) : (
                              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">
                                {message.text}
                              </p>
                            )}
                            <time
                              dateTime={message.providerTimestamp}
                              className="mt-2 block text-right text-[11px] text-slate-400"
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

                <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
                  Inbound-only test view. Reply drafting and WhatsApp sending are
                  not connected to this inbox.
                </p>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center px-6 py-16 text-center">
                <div>
                  <div aria-hidden="true" className="text-3xl text-slate-300">
                    ◌
                  </div>
                  <h2 className="mt-3 font-semibold text-slate-900">
                    Select a conversation
                  </h2>
                  <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">
                    Incoming text and unsupported message types from the
                    configured test number will be shown here.
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
