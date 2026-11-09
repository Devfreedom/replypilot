"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./auth-provider";
import { Alert } from "./ui";
import {
  CONNECTION_STATUS_LABELS,
  canStartEmbeddedSignup,
  handleEmbeddedSignupMessage,
  parseCompleteOnboardingResponse,
  parseConnectionResponse,
  parseConnectionsResponse,
  parseEmbeddedSignupConfigResponse,
  parseOnboardingSessionResponse,
  parseWhatsAppConnection,
  type CompleteOnboardingResponse,
  type EmbeddedSignupPublicConfig,
  type WhatsAppConnectionSummary,
} from "@/lib/embedded-signup";
import { initializeMetaSdk } from "@/lib/meta-sdk";

type ConnectOutcome =
  | Readonly<{ kind: "success"; result: CompleteOnboardingResponse }>
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "error"; message: string }>;

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

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function statusBadgeClass(status: WhatsAppConnectionSummary["status"]): string {
  if (status === "active") {
    return "badge-booked";
  }

  if (status === "error") {
    return "badge-draft";
  }

  return "badge-neutral";
}

export function WhatsAppConnections() {
  const { role } = useAuth();
  const canManage = role === "owner";
  const [connections, setConnections] = useState<WhatsAppConnectionSummary[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [config, setConfig] = useState<EmbeddedSignupPublicConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/whatsapp/connections", {
          cache: "no-store",
        });
        const data = await readJson(response);

        if (!response.ok) {
          throw new Error(apiError(data, "Unable to load WhatsApp connections."));
        }

        const parsed = parseConnectionsResponse(data);

        if (!parsed) {
          throw new Error(
            "The WhatsApp connections service returned an unexpected response.",
          );
        }

        if (active) {
          setConnections(parsed);
        }
      } catch (requestError) {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to load WhatsApp connections.",
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [reloadToken]);

  useEffect(() => {
    if (!canManage) {
      setConfig(null);
      setConfigError(null);
      return;
    }

    let active = true;
    setConfigLoading(true);
    setConfigError(null);

    async function loadConfig() {
      try {
        const response = await fetch("/api/whatsapp/onboarding/config", {
          cache: "no-store",
        });
        const data = await readJson(response);

        if (!response.ok) {
          throw new Error(
            apiError(
              data,
              "Unable to check whether WhatsApp onboarding is configured.",
            ),
          );
        }

        const parsed = parseEmbeddedSignupConfigResponse(data);

        if (!parsed) {
          throw new Error(
            "The WhatsApp onboarding service returned an unexpected response.",
          );
        }

        if (active) {
          setConfig(parsed);
        }
      } catch (requestError) {
        if (active) {
          setConfig(null);
          setConfigError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to check whether WhatsApp onboarding is configured.",
          );
        }
      } finally {
        if (active) {
          setConfigLoading(false);
        }
      }
    }

    void loadConfig();

    return () => {
      active = false;
    };
  }, [canManage, configAttempt]);

  function mergeConnection(connection: WhatsAppConnectionSummary) {
    setConnections((current) => {
      const exists = current.some((entry) => entry.id === connection.id);

      return exists
        ? current.map((entry) =>
            entry.id === connection.id ? connection : entry,
          )
        : [...current, connection];
    });
  }

  async function connectWhatsApp() {
    if (
      !canManage ||
      !config ||
      !canStartEmbeddedSignup({
        role,
        configured: config.configured,
        configLoading,
        connecting,
      })
    ) {
      return;
    }

    if (!config.appId || !config.configId || !config.graphApiVersion) {
      setError("WhatsApp onboarding is not fully configured on this server.");
      return;
    }

    setConnecting(true);
    setError(null);
    setNotice(null);

    let removeMessageListener: (() => void) | null = null;
    let timeout: number | null = null;

    try {
      const sessionResponse = await fetch("/api/whatsapp/onboarding/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const sessionData = await readJson(sessionResponse);

      if (!sessionResponse.ok) {
        throw new Error(
          apiError(sessionData, "Unable to start WhatsApp onboarding."),
        );
      }

      const session = parseOnboardingSessionResponse(sessionData);

      if (!session) {
        throw new Error(
          "The WhatsApp onboarding service returned an unexpected response.",
        );
      }

      const sdk = await initializeMetaSdk({
        appId: config.appId,
        version: config.graphApiVersion,
      });

      let authCode: string | null = null;
      let signup: Readonly<{ phoneNumberId: string; wabaId: string }> | null =
        null;
      let submitted = false;
      let settled = false;
      let resolveOutcome: ((outcome: ConnectOutcome) => void) | null = null;

      const finish = (outcome: ConnectOutcome) => {
        if (settled) {
          return;
        }

        settled = true;
        resolveOutcome?.(outcome);
      };

      const outcomePromise = new Promise<ConnectOutcome>((resolve) => {
        resolveOutcome = resolve;
      });

      const submitIfReady = async () => {
        if (submitted || !authCode || !signup) {
          return;
        }

        submitted = true;

        if (timeout !== null) {
          window.clearTimeout(timeout);
          timeout = null;
        }

        try {
          const response = await fetch("/api/whatsapp/onboarding/complete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              state: session.state,
              code: authCode,
              wabaId: signup.wabaId,
              phoneNumberId: signup.phoneNumberId,
            }),
          });
          const data = await readJson(response);

          if (!response.ok) {
            throw new Error(
              apiError(
                data,
                "Meta verification failed. Please try connecting again.",
              ),
            );
          }

          const parsed = parseCompleteOnboardingResponse(data);

          if (!parsed) {
            throw new Error(
              "The WhatsApp onboarding service returned an unexpected response.",
            );
          }

          finish({ kind: "success", result: parsed });
        } catch (requestError) {
          finish({
            kind: "error",
            message:
              requestError instanceof Error
                ? requestError.message
                : "WhatsApp verification failed. Please try again.",
          });
        }
      };

      const messageHandler = (messageEvent: MessageEvent) => {
        handleEmbeddedSignupMessage(
          { origin: messageEvent.origin, data: messageEvent.data },
          (signupEvent) => {
            if (signupEvent.kind === "success") {
              signup = {
                phoneNumberId: signupEvent.phoneNumberId,
                wabaId: signupEvent.wabaId,
              };
              void submitIfReady();
              return;
            }

            if (submitted) {
              // The backend is already verifying; its result is authoritative.
              return;
            }

            if (signupEvent.kind === "cancelled") {
              finish({ kind: "cancelled" });
            } else if (signupEvent.kind === "error") {
              finish({
                kind: "error",
                message:
                  signupEvent.message ??
                  "Meta reported an error during WhatsApp signup.",
              });
            } else if (signupEvent.kind === "incomplete") {
              finish({
                kind: "error",
                message:
                  "Meta did not return both a phone number and a Messaging account. Please try again.",
              });
            }
          },
        );
      };

      window.addEventListener("message", messageHandler);
      removeMessageListener = () =>
        window.removeEventListener("message", messageHandler);

      timeout = window.setTimeout(() => {
        finish({
          kind: "error",
          message: "WhatsApp signup timed out. Please try again.",
        });
      }, 120_000);

      const loginResponse = await sdk.login({ configId: config.configId });

      if (!settled && !submitted) {
        if (loginResponse.status === "connected" && loginResponse.code) {
          authCode = loginResponse.code;
          void submitIfReady();
        } else {
          finish({
            kind: "cancelled",
          });
        }
      }

      const outcome = await outcomePromise;

      if (outcome.kind === "success") {
        mergeConnection(outcome.result.connection);
        setReloadToken((value) => value + 1);

        if (outcome.result.verification === "active") {
          setNotice(
            "WhatsApp number connected and verified. It can now receive messages.",
          );
        } else {
          setNotice(
            "WhatsApp number saved, but the webhook subscription is not confirmed yet. Use Verify to retry.",
          );
        }
      } else if (outcome.kind === "cancelled") {
        setNotice("WhatsApp connection was cancelled. No changes were made.");
      } else {
        setError(outcome.message);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to complete WhatsApp onboarding.",
      );
    } finally {
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }

      removeMessageListener?.();
      setConnecting(false);
    }
  }

  async function verifyConnection(connectionId: string) {
    if (!canManage) {
      return;
    }

    setBusyId(connectionId);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/whatsapp/connections/${connectionId}/verify`,
        { method: "POST" },
      );
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(apiError(data, "Unable to verify this number."));
      }

      const record =
        typeof data === "object" && data !== null
          ? (data as { connection?: unknown; verification?: unknown; error?: unknown })
          : null;
      const updated = record
        ? parseWhatsAppConnection(record.connection)
        : null;

      if (!updated) {
        throw new Error(
          "The WhatsApp connections service returned an unexpected response.",
        );
      }

      mergeConnection(updated);

      if (record?.verification === "active") {
        setNotice("WhatsApp connection verified and active.");
      } else if (record?.verification === "pending") {
        setNotice(
          typeof record.error === "string"
            ? record.error
            : "The webhook subscription is still pending.",
        );
      } else {
        setError(
          typeof record?.error === "string"
            ? record.error
            : "WhatsApp verification failed.",
        );
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to verify this number.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function disconnect(connectionId: string) {
    if (!canManage) {
      return;
    }

    setBusyId(connectionId);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        `/api/whatsapp/connections/${connectionId}/disconnect`,
        { method: "POST" },
      );
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(apiError(data, "Unable to disconnect this number."));
      }

      const updated = parseConnectionResponse(data);

      if (!updated) {
        throw new Error(
          "The WhatsApp connections service returned an unexpected response.",
        );
      }

      mergeConnection(updated);
      setNotice(
        "WhatsApp connection disconnected. It cannot send or receive messages.",
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to disconnect this number.",
      );
    } finally {
      setBusyId(null);
    }
  }

  const connectEnabled = canStartEmbeddedSignup({
    role,
    configured: config?.configured === true,
    configLoading,
    connecting,
  });

  return (
    <section
      className="card mt-6 p-5 sm:p-6"
      aria-labelledby="whatsapp-connections"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="whatsapp-connections" className="text-lg font-bold text-ink">
            WhatsApp connections
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-soft">
            Each phone number belongs to exactly one workspace. Access tokens are
            stored encrypted on the server and are never shown here.
          </p>
        </div>
        <span className="badge badge-neutral">Workspace-scoped</span>
      </div>

      {!canManage ? (
        <Alert tone="warning" role="status">
          Only the workspace owner can connect or disconnect a WhatsApp number.
        </Alert>
      ) : null}

      {canManage && configLoading && !config ? (
        <p role="status" className="py-3 text-sm text-ink-soft">
          Checking WhatsApp onboarding configuration…
        </p>
      ) : null}

      {canManage && configError ? (
        <Alert tone="danger">
          {configError}{" "}
          <button
            type="button"
            onClick={() => setConfigAttempt((value) => value + 1)}
            className="ml-2 font-semibold underline"
          >
            Try again
          </button>
        </Alert>
      ) : null}

      {canManage && config && !config.configured ? (
        <Alert tone="warning" role="status">
          WhatsApp onboarding is not configured on this server. Set{" "}
          <code>META_APP_ID</code>, <code>META_APP_SECRET</code>, and{" "}
          <code>META_EMBEDDED_SIGNUP_CONFIG_ID</code> on the API, then restart
          it. Connecting is disabled until then.
        </Alert>
      ) : null}

      {canManage && config?.configured ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void connectWhatsApp()}
            disabled={!connectEnabled}
            className="btn btn-primary px-4 py-2 text-sm"
          >
            {connecting ? "Opening Meta…" : "Connect WhatsApp"}
          </button>
          <p className="text-xs leading-5 text-ink-soft">
            Meta collects the business phone number and authorizes this
            workspace. ReplyPilot then verifies the number with Meta.
          </p>
        </div>
      ) : null}

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
        <p role="status" className="py-6 text-sm text-ink-soft">
          Loading WhatsApp connections…
        </p>
      ) : connections.length === 0 ? (
        <p className="py-6 text-sm text-ink-soft">
          No WhatsApp numbers are connected to this workspace yet.
          {canManage && config?.configured
            ? " Use Connect WhatsApp to add one through Meta."
            : ""}
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {connections.map((connection) => (
            <li
              key={connection.id}
              className="rounded-xl border border-line bg-raised px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {connection.displayPhoneNumber
                      ? `+${connection.displayPhoneNumber.replace(/^\+/, "")}`
                      : `Phone-number ID ${connection.phoneNumberId}`}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {connection.label ?? "WhatsApp business number"} · ID{" "}
                    {connection.phoneNumberId}
                  </p>
                  {connection.tokenExpiresAt ? (
                    <p className="mt-0.5 text-xs text-ink-soft">
                      Token expires{" "}
                      {new Date(connection.tokenExpiresAt).toLocaleString()}
                    </p>
                  ) : null}
                  {connection.lastVerifiedAt ? (
                    <p className="mt-0.5 text-xs text-ink-soft">
                      Last verified{" "}
                      {new Date(connection.lastVerifiedAt).toLocaleString()}
                    </p>
                  ) : null}
                  {connection.lastError ? (
                    <p className="mt-1 max-w-xl text-xs leading-5 text-ink-soft">
                      {connection.lastError}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`badge ${statusBadgeClass(connection.status)}`}
                  >
                    {CONNECTION_STATUS_LABELS[connection.status]}
                  </span>
                  {canManage &&
                  connection.credentialsConfigured &&
                  (connection.status === "pending" ||
                    connection.status === "error") ? (
                    <button
                      type="button"
                      onClick={() => void verifyConnection(connection.id)}
                      disabled={busyId === connection.id}
                      className="btn btn-secondary px-3 py-1.5 text-xs"
                    >
                      {busyId === connection.id ? "Verifying…" : "Verify"}
                    </button>
                  ) : null}
                  {canManage && connection.status !== "disconnected" ? (
                    <button
                      type="button"
                      onClick={() => void disconnect(connection.id)}
                      disabled={busyId === connection.id}
                      className="btn btn-secondary px-3 py-1.5 text-xs"
                    >
                      {busyId === connection.id
                        ? "Working…"
                        : "Disconnect"}
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
