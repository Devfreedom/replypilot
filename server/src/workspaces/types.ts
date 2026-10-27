export const WORKSPACE_ROLES = ["owner", "member"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export type Workspace = Readonly<{
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}>;

export type WorkspaceMembership = Readonly<{
  id: string;
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type WorkspaceContext = Readonly<{
  workspace: Workspace;
  membership: WorkspaceMembership;
}>;

export type WorkspaceUser = Readonly<{
  id: string;
  name: string;
  email: string;
}>;
