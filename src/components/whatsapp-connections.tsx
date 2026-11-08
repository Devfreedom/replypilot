"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./auth-provider";
import { Alert } from "./ui";

type WhatsAppConnectionSummary = Readonly<{
  id: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  label: string | null;
  wabaId: string | null;
  status: "pending" | "active" | "disconnected";
  credentialsConfigured: boolean;
  tokenExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  disconnectedAt: string | null;
}>;

const STATUS_LABELS: Record<WhatsAppConnectionSummary["status"], string> = {
  pending: "Pending activation",
  active: "Active",
  disconnected: "Disconnected",
};

function isConnection(value: unknown): value is WhatsAppConnectionSummary {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { phoneNumberId?: unknown }).phoneNumberId === "string" &&
    ["pending", "active", "disconnected"].includes(
      String((value as { status?: unknown }).status),
    )
  );
}

function parseConnections(data: unknown): WhatsAppConnectionSummary[] | null {
  if (
    typeof data !== "object" ||
    data === null ||
    !Array.isArray((data as { connections?: unknown }).connections)
  ) {
    return null;
  }

  const connections = (data as { connections: unknown[] }).connections;

  return connections.every(isConnection) ? connections : null;
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

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function WhatsAppConnections() {
  const { role } = useAuth();
  const canManage = role === "owner";
  const [connections, setConnections] = useState<WhatsAppConnectionSummary[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/whatsapp/connections");
        const data = await readJson(response);

        if (!response.ok) {
          throw new Error(apiError(data, "Unable to load WhatsApp connections."));
        }

        const parsed = parseConnections(data);

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

  async function disconnect(connectionId: string) {
    if (!canManage) {
      return;
    }

    setPendingId(connectionId);
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

      const updated = (data as { connection?: unknown } | null)?.connection;

      if (!isConnection(updated)) {
        throw new Error(
          "The WhatsApp connections service returned an unexpected response.",
        );
      }

      setConnections((current) =>
        current.map((connection) =>
          connection.id === updated.id ? updated : connection,
        ),
      );
      setNotice("WhatsApp connection disconnected. It cannot send or receive messages.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to disconnect this number.",
      );
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="card mt-6 p-5 sm:p-6" aria-labelledby="whatsapp-connections">
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
          Only the workspace owner can disconnect a WhatsApp number.
        </Alert>
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
          No WhatsApp numbers are connected to this workspace yet. Onboarding is
          handled by the trusted connection process; this page does not claim a
          number from the browser.
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
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`badge ${
                      connection.status === "active"
                        ? "badge-booked"
                        : "badge-neutral"
                    }`}
                  >
                    {STATUS_LABELS[connection.status]}
                  </span>
                  {canManage && connection.status !== "disconnected" ? (
                    <button
                      type="button"
                      onClick={() => void disconnect(connection.id)}
                      disabled={pendingId === connection.id}
                      className="btn btn-secondary px-3 py-1.5 text-xs"
                    >
                      {pendingId === connection.id
                        ? "Disconnecting…"
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
