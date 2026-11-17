"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { sanitizeAuthRedirectPath } from "@/lib/auth-redirect";
import {
  AUTH_NAME_MAX_LENGTH,
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  mapAuthServerError,
  validateAuthEmail,
  validateAuthFormFields,
  validateAuthName,
  validateNewPassword,
  validateSignInPassword,
  type AuthErrorInput,
  type AuthFieldErrors,
  type AuthFieldName,
} from "@/lib/auth-validation";
import { BRAND } from "@/lib/brand";
import { useAuth } from "./auth-provider";
import { AuthShell } from "./auth-shell";
import { PasswordInput } from "./password-input";
import { Alert, FormField } from "./ui";

type AuthMode = "sign-in" | "sign-up";

function destination(): string {
  if (typeof window === "undefined") return "/";

  const next = new URLSearchParams(window.location.search).get("next");

  return sanitizeAuthRedirectPath(next, window.location.origin);
}

function focusFirstAuthError(errors: AuthFieldErrors, order: AuthFieldName[]) {
  for (const field of order) {
    if (errors[field]) {
      const element = document.getElementById(`auth-${field}`);
      element?.focus();
      return;
    }
  }
}

export function AuthForm({ mode }: { mode: AuthMode }) {
  const { user, isLoading } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const isSignUp = mode === "sign-up";

  useEffect(() => {
    if (!isLoading && user) {
      window.location.assign(destination());
    }
  }, [isLoading, user]);

  function clearFieldError(field: AuthFieldName) {
    setFormError(null);
    setFieldErrors((current) =>
      current[field] ? { ...current, [field]: undefined } : current,
    );
  }

  function handleBlur(field: "name" | "email" | "password") {
    let message: string | undefined;

    if (field === "name" && isSignUp) {
      message = validateAuthName(name);
    } else if (field === "email") {
      message = validateAuthEmail(email);
    } else if (field === "password") {
      message = isSignUp
        ? validateNewPassword(password)
        : validateSignInPassword(password);
    }

    setFieldErrors((current) => ({ ...current, [field]: message }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setFormError(null);

    const nextFieldErrors = validateAuthFormFields(mode, {
      name,
      email,
      password,
    });

    if (Object.values(nextFieldErrors).some(Boolean)) {
      setFieldErrors(nextFieldErrors);
      focusFirstAuthError(
        nextFieldErrors,
        isSignUp ? ["name", "email", "password"] : ["email", "password"],
      );
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    const trimmedEmail = email.trim();
    const trimmedName = name.trim();

    try {
      const result = isSignUp
        ? await authClient.signUp.email({
            email: trimmedEmail,
            password,
            name: trimmedName,
          })
        : await authClient.signIn.email({
            email: trimmedEmail,
            password,
            rememberMe: true,
          });

      if (result.error) {
        const mapped = mapAuthServerError(
          result.error as AuthErrorInput,
          mode,
        );
        setFieldErrors(mapped.fieldErrors);
        setFormError(mapped.formError);
        focusFirstAuthError(
          mapped.fieldErrors,
          isSignUp ? ["name", "email", "password"] : ["email", "password"],
        );
        return;
      }

      window.location.assign(destination());
    } catch {
      setFormError(
        isSignUp
          ? "Unable to create your account. Check your connection and try again."
          : "Unable to sign in. Check your connection and try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isLoading && user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
        <p role="status" className="text-sm text-ink-soft">
          Opening your workspace…
        </p>
      </main>
    );
  }

  return (
    <AuthShell
      title={isSignUp ? "Create your workspace account" : `Sign in to ${BRAND.name}`}
      description={
        isSignUp
          ? "Set up a workspace for your leads, pricing, and WhatsApp reply drafts."
          : "Access customer enquiries, follow-ups, and approved reply drafts."
      }
      footer={
        <>
          {isSignUp ? "Already have an account?" : `New to ${BRAND.name}?`}{" "}
          <Link
            href={isSignUp ? "/sign-in" : "/sign-up"}
            className="font-semibold text-accent-ink hover:underline"
          >
            {isSignUp ? "Sign in" : "Create an account"}
          </Link>
        </>
      }
    >
      <form
        noValidate
        className="mt-6 space-y-5"
        onSubmit={(event) => void submit(event)}
      >
        {isSignUp ? (
          <FormField id="auth-name" label="Your name" error={fieldErrors.name}>
            {(props) => (
              <input
                {...props}
                type="text"
                name="name"
                autoComplete="name"
                required
                maxLength={AUTH_NAME_MAX_LENGTH}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  clearFieldError("name");
                }}
                onBlur={() => handleBlur("name")}
                disabled={isSubmitting}
                placeholder="e.g. Tunde Adebayo"
                className="input"
              />
            )}
          </FormField>
        ) : null}

        <FormField
          id="auth-email"
          label="Email address"
          error={fieldErrors.email}
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
                clearFieldError("email");
              }}
              onBlur={() => handleBlur("email")}
              disabled={isSubmitting}
              placeholder="owner@studio.ng"
              className="input"
            />
          )}
        </FormField>

        <PasswordInput
          id="auth-password"
          name="password"
          label="Password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          required
          minLength={isSignUp ? AUTH_PASSWORD_MIN_LENGTH : undefined}
          maxLength={AUTH_PASSWORD_MAX_LENGTH}
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            clearFieldError("password");
          }}
          onBlur={() => handleBlur("password")}
          disabled={isSubmitting}
          hint={
            isSignUp
              ? `Use ${AUTH_PASSWORD_MIN_LENGTH} to ${AUTH_PASSWORD_MAX_LENGTH} characters unique to your business account.`
              : undefined
          }
          error={fieldErrors.password}
          labelAside={
            !isSignUp ? (
              <Link
                href="/forgot-password"
                className="text-xs font-semibold text-accent-ink hover:underline"
              >
                Forgot password?
              </Link>
            ) : undefined
          }
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
          {isSubmitting
            ? isSignUp
              ? "Creating account…"
              : "Signing in…"
            : isSignUp
              ? "Create account"
              : "Sign in"}
        </button>
      </form>
    </AuthShell>
  );
}
