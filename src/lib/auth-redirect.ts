/**
 * Sanitizes the post-authentication `next` redirect parameter so browsers can
 * only navigate to relative paths on the application's own origin.
 */
export function sanitizeAuthRedirectPath(
  next: string | null | undefined,
  baseOrigin: string,
): string {
  if (!next) {
    return "/";
  }

  const trimmed = next.trim();

  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    return "/";
  }

  try {
    const resolved = new URL(trimmed, baseOrigin);

    if (resolved.origin !== baseOrigin) {
      return "/";
    }

    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return "/";
  }
}
