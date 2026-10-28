"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { useAuth } from "./auth-provider";

type AuthMode = "sign-in" | "sign-up";

type AuthError = {
  code?: string;
  status?: number;
  message?: string;
};

function destination(): string {
  if (typeof window === "undefined") return "/";

  const next = new URLSearchParams(window.location.search).get("next");

  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function friendlyAuthError(
  error: AuthError | null,
  mode: AuthMode,
): string {
  const code = error?.code ?? "";

  if (
    code.includes("USER_ALREADY_EXISTS") ||
    code.includes("EMAIL_ALREADY_EXISTS")
  ) {
    return "An account with this email already exists. Sign in instead.";
  }

  if (error?.status === 429 || code.includes("RATE_LIMIT")) {
    return "Too many attempts. Wait a little, then try again.";
  }

  if (
    code.includes("INVALID_EMAIL_OR_PASSWORD") ||
    code.includes("INVALID_PASSWORD") ||
    error?.status === 401
  ) {
    return "Email or password is incorrect.";
  }

  if (code.includes("PASSWORD_TOO_SHORT")) {
    return "Password must be at least 8 characters.";
  }

  if (code.includes("PASSWORD_TOO_LONG")) {
    return "Password is too long.";
  }

  if (code.includes("INVALID_EMAIL")) {
    return "Enter a valid email address.";
  }

  return mode === "sign-up"
    ? "Unable to create your account. Check your details and try again."
    : "Unable to sign in. Check your details and try again.";
}

export function AuthForm({ mode }: { mode: AuthMode }) {
  const { user, isLoading } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSignUp = mode === "sign-up";

  useEffect(() => {
    if (!isLoading && user) {
      window.location.assign(destination());
    }
  }, [isLoading, user]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    const trimmedName = name.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    if (isSignUp && !trimmedName) {
      setError("Enter your name.");
      return;
    }

    if (isSignUp && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (!password) {
      setError("Enter your password.");
      return;
    }

    setIsSubmitting(true);

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
        setError(friendlyAuthError(result.error as AuthError, mode));
        return;
      }

      window.location.assign(destination());
    } catch {
      setError(
        isSignUp
          ? "Unable to create your account. Please try again."
          : "Unable to sign in. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isLoading && user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <p role="status" className="text-sm text-slate-500">
          Opening your workspace…
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-lg font-bold text-white">
            R
          </div>
          <div>
            <p className="text-xl font-bold tracking-tight text-slate-950">
              ReplyPilot
            </p>
            <p className="text-xs text-slate-500">Customer workflow</p>
          </div>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">
            {isSignUp ? "Create your account" : "Sign in to ReplyPilot"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {isSignUp
              ? "Create a business workspace for your leads, service details, and reply drafts."
              : "Access the leads and business details in your workspace."}
          </p>

          <form className="mt-6 space-y-4" onSubmit={(event) => void submit(event)}>
            {isSignUp ? (
              <label className="block text-sm font-medium text-slate-700">
                Your name
                <input
                  type="text"
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={isSubmitting}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60"
                />
              </label>
            ) : null}

            <label className="block text-sm font-medium text-slate-700">
              Email address
              <input
                type="email"
                name="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={isSubmitting}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60"
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Password
              <input
                type="password"
                name="password"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                required
                minLength={isSignUp ? 8 : undefined}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isSubmitting}
                aria-describedby={isSignUp ? "password-help" : undefined}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60"
              />
            </label>

            {isSignUp ? (
              <p id="password-help" className="text-xs leading-5 text-slate-500">
                Use at least 8 characters. Email verification and password
                recovery are not configured in this development build.
              </p>
            ) : null}

            {error ? (
              <p
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
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

          <p className="mt-6 border-t border-slate-100 pt-5 text-center text-sm text-slate-500">
            {isSignUp ? "Already have an account?" : "New to ReplyPilot?"}{" "}
            <Link
              href={isSignUp ? "/sign-in" : "/sign-up"}
              className="font-semibold text-blue-700 hover:text-blue-800"
            >
              {isSignUp ? "Sign in" : "Create an account"}
            </Link>
          </p>
        </section>

        <p className="mt-5 text-center text-xs leading-5 text-slate-400">
          Sessions are stored in HTTP-only cookies. Reply generation remains a
          mock demonstration and never sends customer messages.
        </p>
      </div>
    </main>
  );
}
