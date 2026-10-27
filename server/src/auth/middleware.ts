import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Pool } from "pg";
import {
  ensureWorkspaceForUser,
  type WorkspaceContext,
} from "../workspaces/repository.js";
import type { WorkspaceRole } from "../workspaces/types.js";
import type { AuthInstance } from "./config.js";

export type AuthenticatedWorkspaceContext = Readonly<{
  user: Readonly<{
    id: string;
    name: string;
    email: string;
  }>;
  sessionId: string;
  workspace: WorkspaceContext["workspace"];
  membership: WorkspaceContext["membership"];
}>;

export function createRequireWorkspace({
  auth,
  pool,
  roles,
}: {
  auth: AuthInstance;
  pool: Pool;
  roles: readonly WorkspaceRole[];
}): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });

      if (!session) {
        response.status(401).json({ error: "Authentication required" });
        return;
      }

      const workspaceContext = await ensureWorkspaceForUser(pool, {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
      });

      if (!roles.includes(workspaceContext.membership.role)) {
        response.status(403).json({ error: "Forbidden" });
        return;
      }

      const context: AuthenticatedWorkspaceContext = {
        user: {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
        },
        sessionId: session.session.id,
        workspace: workspaceContext.workspace,
        membership: workspaceContext.membership,
      };

      response.locals.auth = context;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function getAuthContext(
  response: Response,
): AuthenticatedWorkspaceContext {
  const context = response.locals.auth as
    | AuthenticatedWorkspaceContext
    | undefined;

  if (!context) {
    throw new Error("Authenticated workspace context is missing.");
  }

  return context;
}
