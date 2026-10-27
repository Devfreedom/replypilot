"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Same-origin client for the Better Auth handler. Browser requests go through
 * the Next.js /api rewrite to the Express API, so the session cookie is shared
 * without exposing the API origin to the client.
 */
export const authClient = createAuthClient();
