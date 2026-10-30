"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./auth-provider";
import { Spinner } from "./ui";

export function ProtectedApp({ children }: { children: ReactNode }) {
  const { user, workspace, isLoading, workspaceError, refreshWorkspace, signOut } =
    useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (isLoading || user) return;

    const next = pathname && pathname.startsWith("/") ? pathname : "/";
    router.replace(`/sign-in?next=${encodeURIComponent(next)}`);
  }, [isLoading, pathname, router, user]);

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
        <div role="status" className="text-center">
          <Spinner className="mx-auto mb-4 h-9 w-9" />
          <p className="text-sm text-ink-soft">Checking your session…</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
        <p role="status" className="text-sm text-ink-soft">
          Redirecting to sign in…
        </p>
      </main>
    );
  }

  if (workspaceError || !workspace) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
        <div role="alert" className="card w-full max-w-md p-6">
          <h1 className="text-lg font-bold text-ink">
            Unable to open your workspace
          </h1>
          <p className="mt-2 text-sm leading-6 text-ink-soft">
            {workspaceError ?? "The workspace could not be loaded."}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={refreshWorkspace}
              className="btn btn-primary"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="btn btn-secondary"
            >
              Sign out
            </button>
          </div>
        </div>
      </main>
    );
  }

  return children;
}
