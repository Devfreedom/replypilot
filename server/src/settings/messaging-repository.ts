import type { Pool, PoolClient } from "pg";
import type { ApprovalSendPolicy } from "../messaging/types.js";

export type WorkspaceMessagingSettings = Readonly<{
  defaultApprovalSendPolicy: ApprovalSendPolicy;
}>;

type SettingsRow = Readonly<{
  default_approval_send_policy: ApprovalSendPolicy;
}>;

const DEFAULT_APPROVAL_SEND_POLICY: ApprovalSendPolicy = "approve_only";

export async function getWorkspaceMessagingSettings(
  pool: Pool,
  workspaceId: string,
): Promise<WorkspaceMessagingSettings> {
  const result = await pool.query<SettingsRow>(
    `
      SELECT default_approval_send_policy
      FROM workspace_messaging_settings
      WHERE workspace_id = $1
    `,
    [workspaceId],
  );

  return {
    defaultApprovalSendPolicy:
      result.rows[0]?.default_approval_send_policy ??
      DEFAULT_APPROVAL_SEND_POLICY,
  };
}

/**
 * Used inside approval transactions. A missing settings row falls back to the
 * safe default rather than making approval fail.
 */
export async function getWorkspaceDefaultApprovalPolicy(
  client: Pool | PoolClient,
  workspaceId: string,
): Promise<ApprovalSendPolicy> {
  const result = await client.query<SettingsRow>(
    `
      SELECT default_approval_send_policy
      FROM workspace_messaging_settings
      WHERE workspace_id = $1
    `,
    [workspaceId],
  );

  return (
    result.rows[0]?.default_approval_send_policy ??
    DEFAULT_APPROVAL_SEND_POLICY
  );
}

export async function updateWorkspaceMessagingSettings(
  pool: Pool,
  workspaceId: string,
  defaultApprovalSendPolicy: ApprovalSendPolicy,
): Promise<WorkspaceMessagingSettings> {
  const result = await pool.query<SettingsRow>(
    `
      INSERT INTO workspace_messaging_settings (
        workspace_id,
        default_approval_send_policy
      )
      VALUES ($1, $2)
      ON CONFLICT (workspace_id) DO UPDATE
      SET default_approval_send_policy = EXCLUDED.default_approval_send_policy,
          updated_at = now()
      RETURNING default_approval_send_policy
    `,
    [workspaceId, defaultApprovalSendPolicy],
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error("Messaging settings update did not return a row.");
  }

  return { defaultApprovalSendPolicy: row.default_approval_send_policy };
}
