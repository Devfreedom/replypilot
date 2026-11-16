export type AuthWorkspace = Readonly<{
  id: string;
  name: string;
}>;

export type ReplyDraftProviderKind = "mock" | "gemini";

export type ParsedWorkspaceResponse = Readonly<{
  workspace: AuthWorkspace;
  role: "owner" | "member";
  replyDraftProvider: ReplyDraftProviderKind;
}>;

export function parseWorkspaceResponse(
  value: unknown,
): ParsedWorkspaceResponse | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const workspace = "workspace" in value ? value.workspace : null;
  const role = "role" in value ? value.role : null;
  const rawProvider =
    "replyDraftProvider" in value ? value.replyDraftProvider : undefined;

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

  if (
    rawProvider !== undefined &&
    rawProvider !== "mock" &&
    rawProvider !== "gemini"
  ) {
    return null;
  }

  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
    },
    role,
    replyDraftProvider: rawProvider ?? "mock",
  };
}

export function assistantProviderBadgeLabel(
  provider: ReplyDraftProviderKind | null | undefined,
): string {
  return provider === "gemini"
    ? "Gemini AI · grounded drafts"
    : "Mock provider · no live AI";
}
