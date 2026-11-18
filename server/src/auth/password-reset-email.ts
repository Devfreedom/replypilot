import {
  AUTH_RESET_TOKEN_EXPIRES_IN_SECONDS,
  type SendResetPasswordEmailHook,
} from "./config.js";

export type SendResetPasswordEmail = SendResetPasswordEmailHook;

const RESEND_EMAILS_URL = "https://api.resend.com/emails";
const DEFAULT_EMAIL_TIMEOUT_MS = 10_000;

export type ResendPasswordResetEmailOptions = Readonly<{
  apiKey: string;
  from: string;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
}>;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Zero-dependency Resend HTTP adapter for single-use password-reset emails.
 * Logs only non-sensitive delivery failure metadata and never logs reset URLs,
 * tokens, recipient addresses, or the Resend API key.
 */
export function createResendPasswordResetEmailSender({
  apiKey,
  from,
  fetchImplementation = globalThis.fetch,
  timeoutMs = DEFAULT_EMAIL_TIMEOUT_MS,
}: ResendPasswordResetEmailOptions): SendResetPasswordEmail {
  const trimmedKey = apiKey.trim();
  const trimmedFrom = from.trim();

  if (!trimmedKey) {
    throw new Error("Resend API key must not be empty.");
  }

  if (!trimmedFrom) {
    throw new Error("Auth email from address must not be empty.");
  }

  const expiresInMinutes = Math.max(
    1,
    Math.round(AUTH_RESET_TOKEN_EXPIRES_IN_SECONDS / 60),
  );

  return async ({ user, url }) => {
    const subject = "Reset your ReplyPilot password";
    const text = [
      "We received a request to reset your ReplyPilot password.",
      "",
      `Reset your password using this single-use link (valid for ${expiresInMinutes} minutes):`,
      url,
      "",
      "If you did not request a password reset, you can safely ignore this email.",
    ].join("\n");
    const escapedUrl = escapeHtml(url);
    const html = [
      "<p>We received a request to reset your ReplyPilot password.</p>",
      `<p><a href="${escapedUrl}">Reset your password</a></p>`,
      `<p>This single-use link expires in ${expiresInMinutes} minutes. If the link button does not open, copy and paste this URL into your browser:</p>`,
      `<p>${escapedUrl}</p>`,
      "<p>If you did not request a password reset, you can safely ignore this email.</p>",
    ].join("");

    let response: Response;

    try {
      response = await fetchImplementation(RESEND_EMAILS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${trimmedKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: trimmedFrom,
          to: [user.email],
          subject,
          text,
          html,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      console.error("Failed to send password reset email.", {
        status: null,
      });
      throw new Error("Password reset email delivery failed.");
    }

    if (!response.ok) {
      console.error("Failed to send password reset email.", {
        status: response.status,
      });
      throw new Error(
        `Password reset email delivery failed with status ${response.status}.`,
      );
    }
  };
}
