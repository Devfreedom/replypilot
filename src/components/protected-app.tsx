"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./auth-provider";

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
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div role="status" className="text-center">
          <div
            aria-hidden="true"
            className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"
          />
          <p className="text-sm text-slate-500">Checking your session…</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <p role="status" className="text-sm text-slate-500">
          Redirecting to sign in…
        </p>
      </main>
    );
  }

  if (workspaceError || !workspace) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div role="alert" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="text-lg font-bold text-slate-900">
            Unable to open your workspace
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {workspaceError ?? "The workspace could not be loaded."}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={refreshWorkspace}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
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
