import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { after, before, beforeEach, test } from "node:test";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import {
  AUTH_RESET_TOKEN_EXPIRES_IN_SECONDS,
  type PasswordResetEmailPayload,
} from "../src/auth/config.js";
import { createPool } from "../src/db/pool.js";
import {
  getTestDatabaseUrl,
  prepareTestDatabase,
  resetTestData,
} from "./test-database.js";

const TEST_AUTH_ORIGIN = "http://localhost:3000";
const TEST_AUTH_SECRET =
  "replypilot-test-secret-with-at-least-32-characters";

async function startAuthTestServer(
  pool: Pool,
  options: Readonly<{
    nodeEnv?: "development" | "test" | "production";
    rateLimit?: { enabled: boolean; window?: number; max?: number };
    sendResetPasswordEmail?: (
      data: PasswordResetEmailPayload,
    ) => Promise<void> | void;
  }> = {},
): Promise<{ server: Server; baseUrl: string }> {
  const appServer = createApp({
    pool,
    auth: {
      secret: TEST_AUTH_SECRET,
      baseURL: TEST_AUTH_ORIGIN,
      trustedOrigins: [TEST_AUTH_ORIGIN],
      rateLimit: options.rateLimit ?? { enabled: false },
      nodeEnv: options.nodeEnv ?? "test",
      sendResetPasswordEmail: options.sendResetPasswordEmail,
    },
  }).listen(0, "127.0.0.1");
  await once(appServer, "listening");

  const address = appServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected TCP listener address.");
  }

  return {
    server: appServer,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function signUpUser(
  baseUrl: string,
  email: string,
  password = "initial-password-123",
): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: TEST_AUTH_ORIGIN,
    },
    body: JSON.stringify({
      email,
      password,
      name: "Studio Owner",
    }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  assert.ok(cookie.length > 0);
  return cookie;
}

let pool: Pool;

before(async () => {
  pool = createPool(getTestDatabaseUrl());
  await prepareTestDatabase(pool);
});

beforeEach(async () => {
  await resetTestData(pool);
});

after(async () => {
  await pool.end();
});

test("request-password-reset returns identical non-enumerating response whether email exists or not", async () => {
  const captured: PasswordResetEmailPayload[] = [];
  const { server, baseUrl } = await startAuthTestServer(pool, {
    sendResetPasswordEmail: (payload) => {
      captured.push(payload);
    },
  });

  try {
    const existingEmail = `owner-${randomUUID()}@example.test`;
    const missingEmail = `missing-${randomUUID()}@example.test`;
    await signUpUser(baseUrl, existingEmail);

    const existingResponse = await fetch(
      `${baseUrl}/api/auth/request-password-reset`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: TEST_AUTH_ORIGIN,
        },
        body: JSON.stringify({
          email: existingEmail,
          redirectTo: `${TEST_AUTH_ORIGIN}/reset-password`,
        }),
      },
    );
    const missingResponse = await fetch(
      `${baseUrl}/api/auth/request-password-reset`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: TEST_AUTH_ORIGIN,
        },
        body: JSON.stringify({
          email: missingEmail,
          redirectTo: `${TEST_AUTH_ORIGIN}/reset-password`,
        }),
      },
    );

    assert.equal(existingResponse.status, 200);
    assert.equal(missingResponse.status, 200);

    const existingBody = (await existingResponse.json()) as unknown;
    const missingBody = (await missingResponse.json()) as unknown;
    assert.deepEqual(existingBody, missingBody);
    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.user.email, existingEmail);
  } finally {
    await stopServer(server);
  }
});

test("request-password-reset rejects untrusted redirectTo origins and invalid email syntax", async () => {
  const { server, baseUrl } = await startAuthTestServer(pool);

  try {
    const untrusted = await fetch(
      `${baseUrl}/api/auth/request-password-reset`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: TEST_AUTH_ORIGIN,
        },
        body: JSON.stringify({
          email: "owner@example.test",
          redirectTo: "https://evil.example/reset",
        }),
      },
    );
    assert.equal(untrusted.status, 403);

    const malformed = await fetch(
      `${baseUrl}/api/auth/request-password-reset`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: TEST_AUTH_ORIGIN,
        },
        body: JSON.stringify({
          email: "not-an-email",
          redirectTo: "/reset-password",
        }),
      },
    );
    assert.equal(malformed.status, 400);
  } finally {
    await stopServer(server);
  }
});

test("production mode never logs reset tokens, URLs, or user emails", async () => {
  const { server, baseUrl } = await startAuthTestServer(pool, {
    nodeEnv: "production",
  });

  const loggedMessages: string[] = [];
  const origInfo = console.info;
  const origWarn = console.warn;
  const origError = console.error;
  console.info = (...args: unknown[]) => loggedMessages.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => loggedMessages.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => loggedMessages.push(args.map(String).join(" "));

  try {
    const email = `prod-${randomUUID()}@example.test`;
    await signUpUser(baseUrl, email);

    const response = await fetch(`${baseUrl}/api/auth/request-password-reset`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_AUTH_ORIGIN,
      },
      body: JSON.stringify({
        email,
        redirectTo: "/reset-password",
      }),
    });
    assert.equal(response.status, 200);

    const combinedLogs = loggedMessages.join("\n");
    assert.ok(!combinedLogs.includes(email));
    assert.ok(!combinedLogs.includes("/reset-password/"));
    assert.ok(!combinedLogs.includes("token="));
  } finally {
    console.info = origInfo;
    console.warn = origWarn;
    console.error = origError;
    await stopServer(server);
  }
});

test("password reset tokens expire quickly, are single-use, validate password length, and revoke active sessions", async () => {
  const captured: PasswordResetEmailPayload[] = [];
  const { server, baseUrl } = await startAuthTestServer(pool, {
    sendResetPasswordEmail: (payload) => {
      captured.push(payload);
    },
  });

  try {
    const email = `reset-flow-${randomUUID()}@example.test`;
    const oldPassword = "old-password-123";
    const newPassword = "new-password-456";
    const sessionCookie = await signUpUser(baseUrl, email, oldPassword);

    // Existing session works prior to reset.
    const beforeResetWorkspace = await fetch(`${baseUrl}/api/workspace`, {
      headers: { cookie: sessionCookie },
    });
    assert.equal(beforeResetWorkspace.status, 200);

    const requestRes = await fetch(
      `${baseUrl}/api/auth/request-password-reset`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: TEST_AUTH_ORIGIN,
        },
        body: JSON.stringify({
          email,
          redirectTo: "/reset-password",
        }),
      },
    );
    assert.equal(requestRes.status, 200);
    assert.equal(captured.length, 1);

    const token = captured[0].token;
    const verificationRow = await pool.query<{ expires_at: Date }>(
      "SELECT expires_at FROM auth_verifications WHERE identifier = $1",
      [`reset-password:${token}`],
    );
    assert.equal(verificationRow.rowCount, 1);
    const remainingSeconds =
      (verificationRow.rows[0].expires_at.getTime() - Date.now()) / 1000;
    assert.ok(
      remainingSeconds > 0 &&
        remainingSeconds <= AUTH_RESET_TOKEN_EXPIRES_IN_SECONDS + 10,
    );

    // Too-short new password is rejected without consuming the token.
    const shortRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_AUTH_ORIGIN,
      },
      body: JSON.stringify({
        token,
        newPassword: "short",
      }),
    });
    assert.equal(shortRes.status, 400);
    const shortPayload = (await shortRes.json()) as { code?: string };
    assert.equal(shortPayload.code, "PASSWORD_TOO_SHORT");

    // Valid reset succeeds.
    const resetRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_AUTH_ORIGIN,
      },
      body: JSON.stringify({
        token,
        newPassword,
      }),
    });
    assert.equal(resetRes.status, 200);

    // Reusing the same token fails (single-use).
    const replayRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_AUTH_ORIGIN,
      },
      body: JSON.stringify({
        token,
        newPassword: "another-password-789",
      }),
    });
    assert.equal(replayRes.status, 400);

    // Earlier session was revoked upon reset.
    const afterResetWorkspace = await fetch(`${baseUrl}/api/workspace`, {
      headers: { cookie: sessionCookie },
    });
    assert.equal(afterResetWorkspace.status, 401);

    // Old password rejected, new password accepted.
    const oldLogin = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_AUTH_ORIGIN,
      },
      body: JSON.stringify({ email, password: oldPassword }),
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_AUTH_ORIGIN,
      },
      body: JSON.stringify({ email, password: newPassword }),
    });
    assert.equal(newLogin.status, 200);
  } finally {
    await stopServer(server);
  }
});

test("expired password reset token is rejected cleanly by callback and reset endpoint", async () => {
  const captured: PasswordResetEmailPayload[] = [];
  const { server, baseUrl } = await startAuthTestServer(pool, {
    sendResetPasswordEmail: (payload) => {
      captured.push(payload);
    },
  });

  try {
    const email = `expired-${randomUUID()}@example.test`;
    await signUpUser(baseUrl, email);

    await fetch(`${baseUrl}/api/auth/request-password-reset`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_AUTH_ORIGIN,
      },
      body: JSON.stringify({ email, redirectTo: "/reset-password" }),
    });
    const token = captured[0].token;

    await pool.query(
      "UPDATE auth_verifications SET expires_at = now() - interval '1 minute' WHERE identifier = $1",
      [`reset-password:${token}`],
    );

    const callbackRes = await fetch(
      `${baseUrl}/api/auth/reset-password/${token}?callbackURL=/reset-password`,
      { redirect: "manual" },
    );
    assert.equal(callbackRes.status, 302);
    assert.match(
      callbackRes.headers.get("location") ?? "",
      /error=INVALID_TOKEN/,
    );

    const expiredReset = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_AUTH_ORIGIN,
      },
      body: JSON.stringify({
        token,
        newPassword: "new-password-456",
      }),
    });
    assert.equal(expiredReset.status, 400);
  } finally {
    await stopServer(server);
  }
});

test("password reset endpoints enforce rate limits", async () => {
  const { server, baseUrl } = await startAuthTestServer(pool, {
    rateLimit: { enabled: true, window: 60, max: 100 },
  });

  try {
    const requestStatuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await fetch(`${baseUrl}/api/auth/request-password-reset`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: TEST_AUTH_ORIGIN,
          "x-forwarded-for": "198.51.100.88",
        },
        body: JSON.stringify({
          email: `ratelimit-${i}@example.test`,
          redirectTo: "/reset-password",
        }),
      });
      requestStatuses.push(res.status);
    }
    assert.deepEqual(requestStatuses.slice(0, 3), [200, 200, 200]);
    assert.equal(requestStatuses[3], 429);

    const resetStatuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await fetch(`${baseUrl}/api/auth/reset-password`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: TEST_AUTH_ORIGIN,
          "x-forwarded-for": "198.51.100.89",
        },
        body: JSON.stringify({
          token: `invalid-token-${i}`,
          newPassword: "valid-password-123",
        }),
      });
      resetStatuses.push(res.status);
    }
    assert.deepEqual(resetStatuses.slice(0, 5), [400, 400, 400, 400, 400]);
    assert.equal(resetStatuses[5], 429);
  } finally {
    await stopServer(server);
  }
});
