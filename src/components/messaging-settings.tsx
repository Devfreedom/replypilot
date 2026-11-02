"use client";

import { useEffect, useState } from "react";
import {
  APPROVAL_SEND_POLICIES,
  APPROVAL_SEND_POLICY_DESCRIPTIONS,
  APPROVAL_SEND_POLICY_LABELS,
  parseMessagingSettingsResponse,
  type ApprovalSendPolicy,
} from "@/lib/messaging";
import { useAuth } from "./auth-provider";
import { Alert } from "./ui";

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

export function MessagingSettings() {
  const { role } = useAuth();
  const canManage = role === "owner";
  const [policy, setPolicy] = useState<ApprovalSendPolicy>("approve_only");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/settings/messaging");
        const data = await readJson(response);

        if (!response.ok) {
          throw new Error(
            apiError(data, "Unable to load messaging settings."),
          );
        }

        const settings = parseMessagingSettingsResponse(data);

        if (!settings) {
          throw new Error(
            "The messaging settings service returned an unexpected response.",
          );
        }

        if (active) {
          setPolicy(settings.defaultApprovalSendPolicy);
        }
      } catch (requestError) {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to load messaging settings.",
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

  async function savePolicy(nextPolicy: ApprovalSendPolicy) {
    if (!canManage || nextPolicy === policy) {
      return;
    }

    const previous = policy;
    setPolicy(nextPolicy);
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/settings/messaging", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultApprovalSendPolicy: nextPolicy }),
      });
      const data = await readJson(response);

      if (!response.ok) {
        throw new Error(
          apiError(data, "Unable to save messaging settings."),
        );
      }

      const settings = parseMessagingSettingsResponse(data);

      if (!settings) {
        throw new Error(
          "The messaging settings service returned an unexpected response.",
        );
      }

      setPolicy(settings.defaultApprovalSendPolicy);
      setNotice("Messaging preference saved.");
    } catch (requestError) {
      setPolicy(previous);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to save messaging settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="card mx-auto max-w-5xl p-5 sm:p-6"
      aria-labelledby="messaging-settings"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="messaging-settings"
            className="text-lg font-bold text-ink"
          >
            Messaging and approval
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-soft">
            Choose what approval does by default. The safe default is approve
            only. The server selects the outbound provider. Meta delivery is
            limited to configured test workspaces and recipients, and is
            unavailable in production.
          </p>
        </div>
        <span className="badge badge-neutral">Server-selected provider</span>
      </div>

      {!canManage ? (
        <Alert tone="warning" role="status">
          Only the workspace owner can change messaging preferences.
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
          Loading messaging settings…
        </p>
      ) : (
        <fieldset
          disabled={!canManage || saving}
          className="mt-5 space-y-3 border-0 p-0"
        >
          <legend className="sr-only">Default approval behaviour</legend>
          {APPROVAL_SEND_POLICIES.map((option) => {
            const selected = policy === option;
            const inputId = `approval-policy-${option}`;

            return (
              <label
                key={option}
                htmlFor={inputId}
                className={`flex cursor-pointer gap-3 rounded-xl border px-4 py-3 transition-colors ${
                  selected
                    ? "border-accent bg-accent-soft"
                    : "border-line bg-raised hover:bg-hushed"
                } ${!canManage ? "cursor-not-allowed opacity-70" : ""}`}
              >
                <input
                  id={inputId}
                  type="radio"
                  name="default-approval-send-policy"
                  value={option}
                  checked={selected}
                  onChange={() => void savePolicy(option)}
                  className="mt-1 h-4 w-4 shrink-0"
                />
                <span>
                  <span className="block text-sm font-semibold text-ink">
                    {APPROVAL_SEND_POLICY_LABELS[option]}
                  </span>
                  <span className="mt-0.5 block text-sm leading-6 text-ink-soft">
                    {APPROVAL_SEND_POLICY_DESCRIPTIONS[option]}
                  </span>
                </span>
              </label>
            );
          })}
          {saving ? (
            <p role="status" className="text-xs text-ink-soft">
              Saving preference…
            </p>
          ) : null}
        </fieldset>
      )}
    </section>
  );
}
