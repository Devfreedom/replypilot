import { Router } from "express";
import type { Pool } from "pg";
import type { AuthInstance } from "../auth/config.js";
import {
  createRequireWorkspace,
  getAuthContext,
} from "../auth/middleware.js";

export function createWorkspaceRouter({
  pool,
  auth,
}: {
  pool: Pool;
  auth: AuthInstance;
}): Router {
  const router = Router();
  const requireMember = createRequireWorkspace({
    auth,
    pool,
    roles: ["owner", "member"],
  });

  router.get("/", requireMember, (_request, response) => {
    const { user, workspace, membership } = getAuthContext(response);

    response.status(200).json({
      user,
      workspace,
      role: membership.role,
    });
  });

  return router;
}
