/**
 * WhatsApp Embedded Signup v4 onboarding and connection verification.
 *
 * Security properties:
 *  - A session is created server-side for the authenticated workspace owner.
 *  - The browser receives a 32-byte CSPRNG state value; only its SHA-256 hash
 *    is stored. Sessions expire and are consumed atomically before any Meta
 *    request, so a callback cannot be replayed to create another connection.
 *  - The authorization code is exchanged server-side. Tokens are encrypted by
 *    the existing M14A credential layer and never returned or logged.
 *  - Meta-reported assets are treated as untrusted until the token, granted
 *    permissions, WABA access, and phone-number association are verified.
 *  - A connection becomes active only after those checks and a confirmed
 *    webhook subscription. Subscription failures persist a pending state with
 *    a safe retry path.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { EmbeddedSignupConfig } from "./embedded-signup-config.js";
import {
  getWhatsAppConnection,
  loadWhatsAppConnectionForVerification,
  setWhatsAppConnectionVerificationState,
  upsertVerifiedWhatsAppConnection,
  WhatsAppConnectionConflictError,
  type WhatsAppConnectionSummary,
} from "./connections.js";
import { decryptWhatsAppToken } from "./credentials.js";
import {
  createMetaGraphClient,
  MetaGraphError,
  type MetaGraphClient,
  type MetaPhoneNumber,
  type MetaTokenInspection,
} from "./meta-graph.js";

const STATE_BYTES = 32;
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_REPLAY_WINDOW_MS = 10 * 60 * 1_000;
const REQUIRED_PERMISSIONS = [
  "whatsapp_business_management",
  "whatsapp_business_messaging",
] as const;

const SUBSCRIPTION_PENDING_MESSAGE =
  "The phone number was verified, but Meta did not confirm the webhook subscription. Retry verification after checking the app configuration.";

export type OnboardingErrorCode =
  | "not_configured"
  | "invalid_state"
  | "expired_state"
  | "state_reused"
  | "invalid_code"
  | "token_exchange_failed"
  | "invalid_token"
  | "missing_permissions"
  | "waba_not_accessible"
  | "phone_not_in_waba"
  | "duplicate_phone"
  | "meta_unavailable"
  | "verification_failed"
  | "credentials_unavailable"
  | "connection_not_found";

const ERROR_STATUS: Record<OnboardingErrorCode, number> = {
  not_configured: 503,
  invalid_state: 400,
  expired_state: 400,
  state_reused: 409,
  invalid_code: 400,
  token_exchange_failed: 502,
  invalid_token: 401,
  missing_permissions: 403,
  waba_not_accessible: 403,
  phone_not_in_waba: 422,
  duplicate_phone: 409,
  meta_unavailable: 502,
  verification_failed: 422,
  credentials_unavailable: 409,
  connection_not_found: 404,
};

export class OnboardingError extends Error {
  readonly code: OnboardingErrorCode;
  readonly httpStatus: number;

  constructor(code: OnboardingErrorCode, message: string) {
    super(message);
    this.name = "OnboardingError";
    this.code = code;
    this.httpStatus = ERROR_STATUS[code];
  }
}

type OnboardingSessionRow = Readonly<{
  id: string;
  workspace_id: string;
  user_id: string;
  expires_at: Date;
  consumed_at: Date | null;
  completed_at: Date | null;
  connection_id: string | null;
}>;

export function hashOnboardingState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

export type CreatedOnboardingSession = Readonly<{
  state: string;
  expiresAt: Date;
}>;

/**
 * Creates a short-lived onboarding session bound to the authenticated user and
 * workspace. The raw state is returned once and never persisted.
 */
export async function createOnboardingSession(
  pool: Pool,
  input: Readonly<{
    workspaceId: string;
    userId: string;
    ttlMs?: number;
    now?: Date;
  }>,
): Promise<CreatedOnboardingSession> {
  const state = randomBytes(STATE_BYTES).toString("base64url");
  const stateHash = hashOnboardingState(state);
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  const expiresAt = new Date(now.getTime() + ttlMs);

  await pool.query(
    `
      INSERT INTO whatsapp_onboarding_sessions (
        workspace_id,
        user_id,
        state_hash,
        expires_at
      )
      VALUES ($1, $2, $3, $4)
    `,
    [input.workspaceId, input.userId, stateHash, expiresAt],
  );

  return { state, expiresAt };
}

type ConsumedOnboardingSession =
  | Readonly<{
      kind: "consumed";
      sessionId: string;
      replayed: false;
    }>
  | Readonly<{
      kind: "replay";
      sessionId: string;
      connectionId: string;
      replayed: true;
    }>;

/**
 * Atomically consumes a state value. A recently completed callback may be
 * replayed idempotently so a duplicate browser submission returns the same
 * connection. Any other reuse is rejected.
 */
export async function consumeOnboardingSession(
  queryable: Pool | PoolClient,
  input: Readonly<{
    workspaceId: string;
    userId: string;
    state: string;
    now?: Date;
    replayWindowMs?: number;
  }>,
): Promise<ConsumedOnboardingSession> {
  const now = input.now ?? new Date();
  const replayWindowMs = input.replayWindowMs ?? DEFAULT_REPLAY_WINDOW_MS;
  const stateHash = hashOnboardingState(input.state);
  const result = await queryable.query<OnboardingSessionRow>(
    `
      SELECT
        id,
        workspace_id,
        user_id,
        expires_at,
        consumed_at,
        completed_at,
        connection_id
      FROM whatsapp_onboarding_sessions
      WHERE state_hash = $1
      LIMIT 1
    `,
    [stateHash],
  );
  const row = result.rows[0];

  if (!row) {
    throw new OnboardingError(
      "invalid_state",
      "The WhatsApp onboarding session is invalid. Start the connection again.",
    );
  }

  // Do not disclose whether the state exists in another workspace.
  if (row.workspace_id !== input.workspaceId || row.user_id !== input.userId) {
    throw new OnboardingError(
      "invalid_state",
      "The WhatsApp onboarding session is invalid. Start the connection again.",
    );
  }

  if (row.consumed_at) {
    const withinReplayWindow =
      now.getTime() - row.consumed_at.getTime() <= replayWindowMs;

    if (row.completed_at && row.connection_id && withinReplayWindow) {
      return {
        kind: "replay",
        sessionId: row.id,
        connectionId: row.connection_id,
        replayed: true,
      };
    }

    throw new OnboardingError(
      "state_reused",
      "This WhatsApp onboarding session has already been used. Start the connection again.",
    );
  }

  if (row.expires_at.getTime() <= now.getTime()) {
    throw new OnboardingError(
      "expired_state",
      "The WhatsApp onboarding session has expired. Start the connection again.",
    );
  }

  const consumed = await queryable.query<{ id: string }>(
    `
      UPDATE whatsapp_onboarding_sessions
      SET consumed_at = now(),
          updated_at = now()
      WHERE id = $1
        AND consumed_at IS NULL
        AND expires_at > now()
      RETURNING id
    `,
    [row.id],
  );

  if (!consumed.rows[0]) {
    throw new OnboardingError(
      "state_reused",
      "This WhatsApp onboarding session has already been used. Start the connection again.",
    );
  }

  return { kind: "consumed", sessionId: row.id, replayed: false };
}

export async function markOnboardingFailure(
  queryable: Pool | PoolClient,
  sessionId: string,
  failureCode: OnboardingErrorCode,
): Promise<void> {
  await queryable.query(
    `
      UPDATE whatsapp_onboarding_sessions
      SET failure_code = $2,
          updated_at = now()
      WHERE id = $1
        AND completed_at IS NULL
    `,
    [sessionId, failureCode],
  );
}

async function markOnboardingComplete(
  queryable: Pool | PoolClient,
  sessionId: string,
  connectionId: string,
  failureCode: OnboardingErrorCode | null,
): Promise<void> {
  await queryable.query(
    `
      UPDATE whatsapp_onboarding_sessions
      SET completed_at = now(),
          connection_id = $2,
          failure_code = $3,
          updated_at = now()
      WHERE id = $1
    `,
    [sessionId, connectionId, failureCode],
  );
}

type VerifiedAssets = Readonly<{
  displayPhoneNumber: string | null;
  verifiedName: string | null;
}>;

function metaFailure(error: unknown): OnboardingError {
  if (error instanceof OnboardingError) {
    return error;
  }

  if (error instanceof MetaGraphError) {
    return new OnboardingError(
      "meta_unavailable",
      "Meta could not be reached or returned an unexpected response. Check the connection and retry.",
    );
  }

  return new OnboardingError(
    "verification_failed",
    "WhatsApp verification could not be completed safely. Start the connection again.",
  );
}

/**
 * Validates the token, its permissions, the WABA, and the phone-number
 * association using Meta's documented Graph API endpoints.
 */
async function inspectTokenAndAssets(
  client: MetaGraphClient,
  config: EmbeddedSignupConfig,
  input: Readonly<{
    accessToken: string;
    wabaId: string;
    phoneNumberId: string;
    now: Date;
  }>,
): Promise<VerifiedAssets> {
  let inspection: MetaTokenInspection;

  try {
    inspection = await client.debugToken(input.accessToken);
  } catch (error) {
    if (error instanceof MetaGraphError && error.kind !== "rejected") {
      throw new OnboardingError(
        "meta_unavailable",
        "Meta could not be reached while inspecting the access token. Retry the connection.",
      );
    }

    throw new OnboardingError(
      "invalid_token",
      "Meta rejected the access token. Start the connection again.",
    );
  }

  if (!inspection.isValid) {
    throw new OnboardingError(
      "invalid_token",
      "Meta reported that the access token is not valid. Start the connection again.",
    );
  }

  if (inspection.appId !== config.appId) {
    throw new OnboardingError(
      "invalid_token",
      "The access token was issued to a different Meta app. Start the connection again.",
    );
  }

  if (
    inspection.expiresAt &&
    inspection.expiresAt.getTime() <= input.now.getTime()
  ) {
    throw new OnboardingError(
      "invalid_token",
      "The access token has expired. Start the connection again.",
    );
  }

  const missingPermissions = REQUIRED_PERMISSIONS.filter(
    (permission) => !inspection.scopes.includes(permission),
  );

  if (missingPermissions.length > 0) {
    throw new OnboardingError(
      "missing_permissions",
      `The authorization is missing required WhatsApp permissions: ${missingPermissions.join(", ")}.`,
    );
  }

  for (const permission of REQUIRED_PERMISSIONS) {
    const targets = inspection.granularTargetIds[permission];

    if (targets && targets.length > 0 && !targets.includes(input.wabaId)) {
      throw new OnboardingError(
        "waba_not_accessible",
        "The authorization was not granted for the selected WhatsApp business account.",
      );
    }
  }

  try {
    await client.getWaba(input.accessToken, input.wabaId);
  } catch (error) {
    if (error instanceof MetaGraphError && error.kind !== "rejected") {
      throw new OnboardingError(
        "meta_unavailable",
        "Meta could not be reached while reading the WhatsApp business account. Retry the connection.",
      );
    }

    throw new OnboardingError(
      "waba_not_accessible",
      "The WhatsApp business account is not accessible with the granted authorization.",
    );
  }

  let phones: MetaPhoneNumber[];

  try {
    phones = await client.listPhoneNumbers(input.accessToken, input.wabaId);
  } catch (error) {
    if (error instanceof MetaGraphError && error.kind !== "rejected") {
      throw new OnboardingError(
        "meta_unavailable",
        "Meta could not be reached while reading the WhatsApp phone numbers. Retry the connection.",
      );
    }

    throw new OnboardingError(
      "waba_not_accessible",
      "The phone numbers for the WhatsApp business account could not be read with the granted authorization.",
    );
  }

  const phone = phones.find((entry) => entry.id === input.phoneNumberId);

  if (!phone) {
    throw new OnboardingError(
      "phone_not_in_waba",
      "The selected phone number does not belong to the authorized WhatsApp business account.",
    );
  }

  return {
    displayPhoneNumber: phone.displayPhoneNumber ?? phone.verifiedName ?? null,
    verifiedName: phone.verifiedName,
  };
}

async function ensureWebhookSubscription(
  client: MetaGraphClient,
  config: EmbeddedSignupConfig,
  accessToken: string,
  wabaId: string,
): Promise<Readonly<{ subscribed: boolean; error: string | null }>> {
  try {
    await client.subscribeApp(accessToken, wabaId);
  } catch {
    return { subscribed: false, error: SUBSCRIPTION_PENDING_MESSAGE };
  }

  try {
    const appIds = await client.listSubscribedAppIds(accessToken, wabaId);

    if (!appIds.includes(config.appId)) {
      return { subscribed: false, error: SUBSCRIPTION_PENDING_MESSAGE };
    }
  } catch {
    return { subscribed: false, error: SUBSCRIPTION_PENDING_MESSAGE };
  }

  return { subscribed: true, error: null };
}

export type CompleteOnboardingInput = Readonly<{
  pool: Pool;
  config: EmbeddedSignupConfig;
  workspaceId: string;
  userId: string;
  state: string;
  code: string;
  wabaId: string;
  phoneNumberId: string;
  metaClient?: MetaGraphClient;
  now?: Date;
}>;

export type CompleteOnboardingResult = Readonly<{
  connection: WhatsAppConnectionSummary;
  verification: "active" | "pending";
  replayed: boolean;
}>;

/**
 * Consumes the onboarding session and verifies the Meta callback. The
 * authorization is consumed before any network request, so concurrent or
 * repeated callbacks cannot exchange the same code twice.
 */
export async function completeWhatsAppOnboarding(
  input: CompleteOnboardingInput,
): Promise<CompleteOnboardingResult> {
  const now = input.now ?? new Date();
  const session = await consumeOnboardingSession(input.pool, {
    workspaceId: input.workspaceId,
    userId: input.userId,
    state: input.state,
    now,
  });

  if (session.kind === "replay") {
    const connection = await getWhatsAppConnection(
      input.pool,
      input.workspaceId,
      session.connectionId,
    );

    if (!connection) {
      throw new OnboardingError(
        "invalid_state",
        "The WhatsApp onboarding session is invalid. Start the connection again.",
      );
    }

    return {
      connection,
      verification: connection.status === "active" ? "active" : "pending",
      replayed: true,
    };
  }

  const client =
    input.metaClient ??
    createMetaGraphClient(
      input.config,
      undefined,
      {},
    );

  try {
    let token;

    try {
      token = await client.exchangeCode(input.code);
    } catch (error) {
      if (error instanceof MetaGraphError && error.kind === "rejected") {
        throw new OnboardingError(
          "invalid_code",
          "Meta rejected the authorization code, or it has already been used. Start the connection again.",
        );
      }

      throw new OnboardingError(
        "token_exchange_failed",
        "Meta could not exchange the authorization code. Start the connection again.",
      );
    }

    const assets = await inspectTokenAndAssets(client, input.config, {
      accessToken: token.accessToken,
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      now,
    });

    const existing = await input.pool.query<{
      workspace_id: string;
    }>(
      `
        SELECT workspace_id
        FROM whatsapp_connections
        WHERE phone_number_id = $1
        LIMIT 1
      `,
      [input.phoneNumberId],
    );
    const existingRow = existing.rows[0];

    if (existingRow && existingRow.workspace_id !== input.workspaceId) {
      throw new OnboardingError(
        "duplicate_phone",
        "This WhatsApp phone number is already connected to another workspace.",
      );
    }

    const subscription = await ensureWebhookSubscription(
      client,
      input.config,
      token.accessToken,
      input.wabaId,
    );
    const status = subscription.subscribed ? "active" : "pending";
    const expectedDisplay = assets.displayPhoneNumber;
    const db = await input.pool.connect();

    try {
      await db.query("BEGIN");

      const connection = await upsertVerifiedWhatsAppConnection(db, {
        workspaceId: input.workspaceId,
        phoneNumberId: input.phoneNumberId,
        displayPhoneNumber: expectedDisplay,
        label: assets.verifiedName,
        wabaId: input.wabaId,
        status,
        accessToken: token.accessToken,
        tokenExpiresAt: token.expiresAt,
        lastError: subscription.error,
        webhookSubscribed: subscription.subscribed,
        verifiedAt: now,
      });

      await markOnboardingComplete(
        db,
        session.sessionId,
        connection.id,
        subscription.subscribed ? null : "verification_failed",
      );
      await db.query("COMMIT");

      return {
        connection,
        verification: status,
        replayed: false,
      };
    } catch (error) {
      await db.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      db.release();
    }
  } catch (error) {
    const onboardingError =
      error instanceof WhatsAppConnectionConflictError
        ? new OnboardingError(
            "duplicate_phone",
            "This WhatsApp phone number is already connected to another workspace.",
          )
        : metaFailure(error);

    await markOnboardingFailure(
      input.pool,
      session.sessionId,
      onboardingError.code,
    ).catch(() => undefined);

    throw onboardingError;
  }
}

export type VerifyConnectionInput = Readonly<{
  pool: Pool;
  config: EmbeddedSignupConfig;
  workspaceId: string;
  connectionId: string;
  metaClient?: MetaGraphClient;
  now?: Date;
}>;

export type VerifyConnectionResult = Readonly<{
  connection: WhatsAppConnectionSummary;
  verification: "active" | "pending" | "error";
  error: string | null;
}>;

/**
 * Re-runs token, permission, asset, and webhook-subscription checks for a
 * stored connection. Failures are persisted as an accurate pending/error state
 * rather than being reported as success.
 */
export async function verifyWhatsAppConnection(
  input: VerifyConnectionInput,
): Promise<VerifyConnectionResult> {
  const now = input.now ?? new Date();
  const stored = await loadWhatsAppConnectionForVerification(
    input.pool,
    input.workspaceId,
    input.connectionId,
  );

  if (!stored) {
    throw new OnboardingError(
      "connection_not_found",
      "Connection not found.",
    );
  }

  const current = await getWhatsAppConnection(
    input.pool,
    input.workspaceId,
    input.connectionId,
  );

  if (!current) {
    throw new OnboardingError(
      "connection_not_found",
      "Connection not found.",
    );
  }

  async function recordFailure(
    message: string,
    status: "pending" | "error",
  ): Promise<VerifyConnectionResult> {
    const updated = await setWhatsAppConnectionVerificationState(input.pool, {
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      status,
      lastError: message,
      webhookSubscribed: false,
      verifiedAt: now,
    });

    return {
      connection: updated ?? current,
      verification: status,
      error: message,
    };
  }

  if (!stored.encryptedToken || !stored.wabaId) {
    return recordFailure(
      "This connection has no stored credentials or Messaging account to verify. Connect the number again.",
      "error",
    );
  }

  let accessToken: string;

  try {
    accessToken = decryptWhatsAppToken(stored.encryptedToken);
  } catch {
    return recordFailure(
      "Stored credentials could not be decrypted. Connect the number again.",
      "error",
    );
  }

  const client =
    input.metaClient ??
    createMetaGraphClient(input.config, undefined, {});

  try {
    await inspectTokenAndAssets(client, input.config, {
      accessToken,
      wabaId: stored.wabaId,
      phoneNumberId: stored.phoneNumberId,
      now,
    });
  } catch (error) {
    const message =
      error instanceof OnboardingError
        ? error.message
        : "WhatsApp verification failed. Retry after checking the Meta app configuration.";
    return recordFailure(message, "error");
  }

  const subscription = await ensureWebhookSubscription(
    client,
    input.config,
    accessToken,
    stored.wabaId,
  );

  if (!subscription.subscribed) {
    return recordFailure(
      subscription.error ?? SUBSCRIPTION_PENDING_MESSAGE,
      "pending",
    );
  }

  const updated = await setWhatsAppConnectionVerificationState(input.pool, {
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    status: "active",
    lastError: null,
    webhookSubscribed: true,
    verifiedAt: now,
  });

  if (!updated) {
    throw new OnboardingError(
      "connection_not_found",
      "Connection not found.",
    );
  }

  return {
    connection: updated,
    verification: "active",
    error: null,
  };
}
