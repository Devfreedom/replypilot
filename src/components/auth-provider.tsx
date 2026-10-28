"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { authClient } from "@/lib/auth-client";

export type AuthUser = Readonly<{
  id: string;
  name: string;
  email: string;
}>;

export type AuthWorkspace = Readonly<{
  id: string;
  name: string;
}>;

type AuthContextValue = Readonly<{
  user: AuthUser | null;
  workspace: AuthWorkspace | null;
  role: "owner" | "member" | null;
  isLoading: boolean;
  workspaceError: string | null;
  refreshWorkspace: () => void;
  signOut: () => Promise<void>;
}>;

type WorkspaceState = Readonly<{
  userId: string | null;
  value: AuthWorkspace | null;
  role: "owner" | "member" | null;
  error: string | null;
  loaded: boolean;
}>;

const AuthContext = createContext<AuthContextValue | null>(null);

function parseWorkspaceResponse(
  value: unknown,
): { workspace: AuthWorkspace; role: "owner" | "member" } | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const workspace = "workspace" in value ? value.workspace : null;
  const role = "role" in value ? value.role : null;

  if (
    typeof workspace !== "object" ||
    workspace === null ||
    !("id" in workspace) ||
    !("name" in workspace) ||
    typeof workspace.id !== "string" ||
    typeof workspace.name !== "string" ||
    (role !== "owner" && role !== "member")
  ) {
    return null;
  }

  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
    },
    role,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data, isPending, refetch } = authClient.useSession();
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>({
    userId: null,
    value: null,
    role: null,
    error: null,
    loaded: false,
  });
  const [workspaceAttempt, setWorkspaceAttempt] = useState(0);
  const userId = data?.user.id ?? null;

  useEffect(() => {
    if (!userId) return;

    const controller = new AbortController();

    async function loadWorkspace() {
      try {
        const response = await fetch("/api/workspace", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload: unknown = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            response.status === 401
              ? "Your session has expired. Please sign in again."
              : "Unable to establish your workspace.",
          );
        }

        const parsed = parseWorkspaceResponse(payload);

        if (!parsed) {
          throw new Error(
            "The workspace service returned an unexpected response.",
          );
        }

        if (controller.signal.aborted) return;

        setWorkspaceState({
          userId,
          value: parsed.workspace,
          role: parsed.role,
          error: null,
          loaded: true,
        });
      } catch (error) {
        if (controller.signal.aborted) return;

        setWorkspaceState({
          userId,
          value: null,
          role: null,
          error:
            error instanceof Error
              ? error.message
              : "Unable to establish your workspace.",
          loaded: true,
        });
      }
    }

    void loadWorkspace();

    return () => controller.abort();
  }, [userId, workspaceAttempt]);

  const refreshWorkspace = useCallback(() => {
    setWorkspaceAttempt((attempt) => attempt + 1);
  }, []);

  const signOut = useCallback(async () => {
    await authClient.signOut();
    await refetch();
    router.replace("/sign-in");
  }, [refetch, router]);

  const activeWorkspaceState =
    userId && workspaceState.userId === userId ? workspaceState : null;
  const user = data?.user
    ? {
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
      }
    : null;
  const value: AuthContextValue = {
    user,
    workspace: activeWorkspaceState?.value ?? null,
    role: activeWorkspaceState?.role ?? null,
    isLoading:
      isPending ||
      (Boolean(userId) &&
        !activeWorkspaceState?.loaded &&
        !activeWorkspaceState?.error),
    workspaceError: activeWorkspaceState?.error ?? null,
    refreshWorkspace,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}
