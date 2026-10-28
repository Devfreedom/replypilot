import type { Pool, PoolClient } from "pg";
import type {
  WorkspaceContext,
  WorkspaceMembership,
  WorkspaceRole,
  WorkspaceUser,
} from "./types.js";

export const LEGACY_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
export const LEGACY_WORKSPACE_NAME = "Legacy development workspace";

type ContextRow = {
  workspace_id: string;
  workspace_name: string;
  workspace_created_at: Date;
  workspace_updated_at: Date;
  membership_id: string;
  membership_user_id: string;
  membership_workspace_id: string;
  membership_role: WorkspaceRole;
  membership_is_default: boolean;
  membership_created_at: Date;
  membership_updated_at: Date;
};

const CONTEXT_SELECT = `
  SELECT
    workspace.id AS workspace_id,
    workspace.name AS workspace_name,
    workspace.created_at AS workspace_created_at,
    workspace.updated_at AS workspace_updated_at,
    membership.id AS membership_id,
    membership.user_id AS membership_user_id,
    membership.workspace_id AS membership_workspace_id,
    membership.role AS membership_role,
    membership.is_default AS membership_is_default,
    membership.created_at AS membership_created_at,
    membership.updated_at AS membership_updated_at
  FROM workspace_memberships AS membership
  JOIN workspaces AS workspace ON workspace.id = membership.workspace_id
`;

function mapContextRow(row: ContextRow): WorkspaceContext {
  return {
    workspace: {
      id: row.workspace_id,
      name: row.workspace_name,
      createdAt: row.workspace_created_at.toISOString(),
      updatedAt: row.workspace_updated_at.toISOString(),
    },
    membership: {
      id: row.membership_id,
      userId: row.membership_user_id,
      workspaceId: row.membership_workspace_id,
      role: row.membership_role,
      isDefault: row.membership_is_default,
      createdAt: row.membership_created_at.toISOString(),
      updatedAt: row.membership_updated_at.toISOString(),
    },
  };
}

async function selectDefaultMembership(
  client: PoolClient,
  userId: string,
): Promise<WorkspaceContext | null> {
  const result = await client.query<ContextRow>(
    `
      ${CONTEXT_SELECT}
      WHERE membership.user_id = $1
        AND membership.is_default = true
      LIMIT 1
    `,
    [userId],
  );

  const row = result.rows[0];
  return row ? mapContextRow(row) : null;
}

function defaultWorkspaceName(user: WorkspaceUser): string {
  const base = user.name.trim().slice(0, 140) || "My";
  return `${base}'s workspace`;
}

/**
 * Returns the user's selected workspace, creating a personal workspace and
 * owner membership when none exists. A transaction-level advisory lock and the
 * partial unique index on default memberships keep concurrent requests from
 * creating duplicate defaults.
 */
export async function ensureWorkspaceForUser(
  pool: Pool,
  user: WorkspaceUser,
): Promise<WorkspaceContext> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [user.id],
    );

    const existing = await selectDefaultMembership(client, user.id);

    if (existing) {
      await client.query("COMMIT");
      return existing;
    }

    const fallback = await client.query<{ id: string }>(
      `
        SELECT id
        FROM workspace_memberships
        WHERE user_id = $1
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `,
      [user.id],
    );

    if (fallback.rows[0]) {
      await client.query(
        `
          UPDATE workspace_memberships
          SET is_default = true, updated_at = now()
          WHERE id = $1
        `,
        [fallback.rows[0].id],
      );

      const selected = await selectDefaultMembership(client, user.id);

      if (!selected) {
        throw new Error("Failed to select an existing workspace membership.");
      }

      await client.query("COMMIT");
      return selected;
    }

    const workspaceResult = await client.query<{ id: string }>(
      `
        INSERT INTO workspaces (name)
        VALUES ($1)
        RETURNING id
      `,
      [defaultWorkspaceName(user)],
    );
    const workspaceId = workspaceResult.rows[0]?.id;

    if (!workspaceId) {
      throw new Error("Workspace insert did not return a row.");
    }

    await client.query(
      `
        INSERT INTO workspace_memberships (
          user_id,
          workspace_id,
          role,
          is_default
        )
        VALUES ($1, $2, 'owner', true)
      `,
      [user.id, workspaceId],
    );

    const created = await selectDefaultMembership(client, user.id);

    if (!created) {
      throw new Error("Failed to read a newly created workspace membership.");
    }

    await client.query("COMMIT");
    return created;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

export type BootstrapLegacyWorkspaceInput = Readonly<{
  userId?: string;
  userEmail?: string;
  confirm: boolean;
}>;

/**
 * One-time local-development operation. It deliberately refuses to run if the
 * legacy workspace already has any member, so a second caller cannot take it
 * over. This function is only exposed through the guarded CLI.
 */
export async function bootstrapLegacyWorkspace(
  pool: Pool,
  input: BootstrapLegacyWorkspaceInput,
): Promise<WorkspaceContext> {
  if (!input.confirm) {
    throw new Error(
      "Refusing to assign the legacy workspace without explicit --confirm.",
    );
  }

  const hasUserId = Boolean(input.userId?.trim());
  const hasUserEmail = Boolean(input.userEmail?.trim());

  if (hasUserId === hasUserEmail) {
    throw new Error(
      "Provide exactly one of --user-id or --user-email to select the account.",
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const workspaceResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM workspaces
        WHERE id = $1
        FOR UPDATE
      `,
      [LEGACY_WORKSPACE_ID],
    );

    if (!workspaceResult.rows[0]) {
      throw new Error(
        `The legacy workspace ${LEGACY_WORKSPACE_ID} does not exist. Run migrations first.`,
      );
    }

    const existingMembership = await client.query<{ id: string }>(
      `
        SELECT id
        FROM workspace_memberships
        WHERE workspace_id = $1
        LIMIT 1
      `,
      [LEGACY_WORKSPACE_ID],
    );

    if (existingMembership.rows[0]) {
      throw new Error(
        "The legacy workspace already has a member. Reassignment is refused.",
      );
    }

    const userResult = hasUserId
      ? await client.query<{ id: string; email: string }>(
          `
            SELECT id, email
            FROM auth_users
            WHERE id::text = $1
          `,
          [input.userId?.trim()],
        )
      : await client.query<{ id: string; email: string }>(
          `
            SELECT id, email
            FROM auth_users
            WHERE lower(email) = lower($1)
          `,
          [input.userEmail?.trim()],
        );

    if (userResult.rows.length === 0) {
      throw new Error("No registered account matched the supplied selector.");
    }

    if (userResult.rows.length > 1) {
      throw new Error(
        "More than one registered account matched the supplied selector.",
      );
    }

    const target = userResult.rows[0];

    if (!target) {
      throw new Error("No registered account matched the supplied selector.");
    }

    await client.query(
      `
        UPDATE workspace_memberships
        SET is_default = false, updated_at = now()
        WHERE user_id = $1
          AND is_default = true
      `,
      [target.id],
    );

    await client.query(
      `
        INSERT INTO workspace_memberships (
          user_id,
          workspace_id,
          role,
          is_default
        )
        VALUES ($1, $2, 'owner', true)
      `,
      [target.id, LEGACY_WORKSPACE_ID],
    );

    const selected = await selectDefaultMembership(client, target.id);

    if (!selected) {
      throw new Error("Failed to read the bootstrapped legacy workspace.");
    }

    await client.query("COMMIT");
    return selected;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function listMembershipsForUser(
  pool: Pool,
  userId: string,
): Promise<WorkspaceMembership[]> {
  const result = await pool.query<{
    id: string;
    user_id: string;
    workspace_id: string;
    role: WorkspaceRole;
    is_default: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `
      SELECT id, user_id, workspace_id, role, is_default, created_at, updated_at
      FROM workspace_memberships
      WHERE user_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [userId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    role: row.role,
    isDefault: row.is_default,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}
