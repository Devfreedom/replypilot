"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import {
  mapAuthServerError,
  validateAuthEmail,
  type AuthErrorInput,
} from "@/lib/auth-validation";
import { AuthShell } from "./auth-shell";
import { Alert, FormField } from "./ui";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleBlur() {
    setEmailError(validateAuthEmail(email));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setFormError(null);

    const validationError = validateAuthEmail(email);

    if (validationError) {
      setEmailError(validationError);
      document.getElementById("forgot-email")?.focus();
      return;
    }

    setEmailError(undefined);
    setIsSubmitting(true);

    const trimmedEmail = email.trim();

    try {
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/reset-password`
          : "/reset-password";

      const result = await authClient.requestPasswordReset({
        email: trimmedEmail,
        redirectTo,
      });

      if (result.error) {
        const mapped = mapAuthServerError(
          result.error as AuthErrorInput,
          "forgot-password",
        );
        setEmailError(mapped.fieldErrors.email);
        setFormError(mapped.formError);
        return;
      }

      setSubmittedEmail(trimmedEmail);
    } catch {
      setFormError(
        "Unable to send reset instructions right now. Check your connection and try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      description="Enter the email address for your workspace account. If an account matches, we will issue a single-use reset link."
      footer={
        <>
          Remembered your password?{" "}
          <Link
            href="/sign-in"
            className="font-semibold text-accent-ink hover:underline"
          >
            Back to sign in
          </Link>
        </>
      }
    >
      {submittedEmail ? (
        <div className="mt-6 space-y-5">
          <Alert tone="success" role="status">
            If an account matches <strong>{submittedEmail}</strong>, reset
            instructions have been sent. Reset links expire after 15 minutes
            and can only be used once.
          </Alert>
          <p className="text-xs leading-5 text-ink-soft">
            In local development without an email provider configured, inspect
            your API server console for the temporary reset link.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/sign-in" className="btn btn-primary flex-1">
              Return to sign in
            </Link>
            <button
              type="button"
              onClick={() => {
                setSubmittedEmail(null);
                setFormError(null);
              }}
              className="btn btn-secondary flex-1"
            >
              Try another email
            </button>
          </div>
        </div>
      ) : (
        <form
          noValidate
          className="mt-6 space-y-5"
          onSubmit={(event) => void submit(event)}
        >
          <FormField
            id="forgot-email"
            label="Email address"
            error={emailError}
            hint="You will receive the same confirmation message whether or not an account exists."
          >
            {(props) => (
              <input
                {...props}
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setFormError(null);
                  if (emailError) {
                    setEmailError(undefined);
                  }
                }}
                onBlur={handleBlur}
                disabled={isSubmitting}
                placeholder="owner@studio.ng"
                className="input"
              />
            )}
          </FormField>

          {formError ? (
            <Alert tone="danger" role="alert">
              {formError}
            </Alert>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn btn-primary w-full"
          >
            {isSubmitting ? "Sending reset link…" : "Send reset link"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
