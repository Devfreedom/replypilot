"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import {
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  mapAuthServerError,
  validateConfirmPassword,
  validateNewPassword,
  validateResetPasswordFields,
  type AuthErrorInput,
  type AuthFieldErrors,
} from "@/lib/auth-validation";
import { AuthShell } from "./auth-shell";
import { PasswordInput } from "./password-input";
import { Alert } from "./ui";

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const urlError = searchParams.get("error")?.trim() ?? "";
  const hasInvalidTokenFromUrl = Boolean(urlError) || token.length === 0;

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);

  function clearField(field: "password" | "confirmPassword") {
    setFormError(null);
    setFieldErrors((current) =>
      current[field] ? { ...current, [field]: undefined } : current,
    );
  }

  function handleBlur(field: "password" | "confirmPassword") {
    if (field === "password") {
      const nextPasswordError = validateNewPassword(password);
      const nextConfirmError =
        confirmPassword.length > 0
          ? validateConfirmPassword(password, confirmPassword)
          : undefined;
      setFieldErrors((current) => ({
        ...current,
        password: nextPasswordError,
        ...(confirmPassword.length > 0
          ? { confirmPassword: nextConfirmError }
          : {}),
      }));
      return;
    }

    setFieldErrors((current) => ({
      ...current,
      confirmPassword: validateConfirmPassword(password, confirmPassword),
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || hasInvalidTokenFromUrl) return;

    setFormError(null);

    const nextFieldErrors = validateResetPasswordFields({
      password,
      confirmPassword,
    });

    if (Object.values(nextFieldErrors).some(Boolean)) {
      setFieldErrors(nextFieldErrors);
      const firstId = nextFieldErrors.password
        ? "reset-password"
        : "reset-confirm-password";
      document.getElementById(firstId)?.focus();
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const result = await authClient.resetPassword({
        newPassword: password,
        token,
      });

      if (result.error) {
        const mapped = mapAuthServerError(
          result.error as AuthErrorInput,
          "reset-password",
        );
        setFieldErrors(mapped.fieldErrors);
        setFormError(mapped.formError);
        if (mapped.fieldErrors.password) {
          document.getElementById("reset-password")?.focus();
        }
        return;
      }

      setResetComplete(true);
    } catch {
      setFormError(
        "Unable to update your password right now. Check your connection and try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Choose a new password"
      description={
        resetComplete
          ? "Your password has been updated and previous active sessions have been signed out."
          : "Enter a new password for your workspace account."
      }
      footer={
        <>
          Need a fresh link?{" "}
          <Link
            href="/forgot-password"
            className="font-semibold text-accent-ink hover:underline"
          >
            Request password reset
          </Link>
        </>
      }
    >
      {resetComplete ? (
        <div className="mt-6 space-y-5">
          <Alert tone="success" role="status">
            Password updated. All earlier sessions on other devices have been
            signed out for your security.
          </Alert>
          <Link href="/sign-in" className="btn btn-primary w-full">
            Sign in with new password
          </Link>
        </div>
      ) : hasInvalidTokenFromUrl ? (
        <div className="mt-6 space-y-5">
          <Alert tone="danger" role="alert">
            This password reset link is missing, expired, or has already been
            used. Request a new link to continue.
          </Alert>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/forgot-password" className="btn btn-primary flex-1">
              Request new link
            </Link>
            <Link href="/sign-in" className="btn btn-secondary flex-1">
              Back to sign in
            </Link>
          </div>
        </div>
      ) : (
        <form
          noValidate
          className="mt-6 space-y-5"
          onSubmit={(event) => void submit(event)}
        >
          <PasswordInput
            id="reset-password"
            name="newPassword"
            label="New password"
            autoComplete="new-password"
            required
            minLength={AUTH_PASSWORD_MIN_LENGTH}
            maxLength={AUTH_PASSWORD_MAX_LENGTH}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              clearField("password");
            }}
            onBlur={() => handleBlur("password")}
            disabled={isSubmitting}
            hint={`Use ${AUTH_PASSWORD_MIN_LENGTH} to ${AUTH_PASSWORD_MAX_LENGTH} characters.`}
            error={fieldErrors.password}
          />

          <PasswordInput
            id="reset-confirm-password"
            name="confirmPassword"
            label="Confirm new password"
            autoComplete="new-password"
            required
            minLength={AUTH_PASSWORD_MIN_LENGTH}
            maxLength={AUTH_PASSWORD_MAX_LENGTH}
            value={confirmPassword}
            onChange={(event) => {
              setConfirmPassword(event.target.value);
              clearField("confirmPassword");
            }}
            onBlur={() => handleBlur("confirmPassword")}
            disabled={isSubmitting}
            error={fieldErrors.confirmPassword}
          />

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
            {isSubmitting ? "Updating password…" : "Update password"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
