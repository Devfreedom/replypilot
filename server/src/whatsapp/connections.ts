/**
 * Workspace-scoped WhatsApp connection persistence.
 *
 * A connection is the link between one Meta phone-number ID and exactly one
 * ReplyPilot workspace. The database owns that ownership: webhook routing and
 * outbound sending resolve it here and never trust a workspace identifier from
 * a browser or a webhook payload.
 *
 * Credentials are encrypted before insertion and are never selected into a
 * public summary. Only server-side provider code loads and decrypts them.
 */

import type { Pool, PoolClient } from "pg";
import {
  encryptWhatsAppToken,
  type EncryptedWhatsAppToken,
} from "./credentials.js";

export const WHATSAPP_CONNECTION_STATUSES = [
  "pending",
  "active",
  "disconnected",
  "error",
] as const;

export type WhatsAppConnectionStatus =
  (typeof WHATSAPP_CONNECTION_STATUSES)[number];

export type WhatsAppConnectionSummary = Readonly<{
  id: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  label: string | null;
  wabaId: string | null;
  status: WhatsAppConnectionStatus;
  credentialsConfigured: boolean;
  tokenExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  disconnectedAt: string | null;
  lastVerifiedAt: string | null;
  webhookSubscribedAt: string | null;
  lastError: string | null;
}>;

type ConnectionRow = Readonly<{
  id: string;
  phone_number_id: string;
  display_phone_number: string | null;
  label: string | null;
  waba_id: string | null;
  status: WhatsAppConnectionStatus;
  access_token_ciphertext: string | null;
  token_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  activated_at: Date | null;
  disconnected_at: Date | null;
  last_verified_at: Date | null;
  webhook_subscribed_at: Date | null;
  last_error: string | null;
}>;

const CONNECTION_SUMMARY_COLUMNS = `
  id,
  phone_number_id,
  display_phone_number,
  label,
  waba_id,
  status,
  access_token_ciphertext,
  token_expires_at,
  created_at,
  updated_at,
  activated_at,
  disconnected_at,
  last_verified_at,
  webhook_subscribed_at,
  last_error
`;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function mapConnectionSummary(
  row: ConnectionRow,
): WhatsAppConnectionSummary {
  return {
    id: row.id,
    phoneNumberId: row.phone_number_id,
    displayPhoneNumber: row.display_phone_number,
    label: row.label,
    wabaId: row.waba_id,
    status: row.status,
    credentialsConfigured: row.access_token_ciphertext !== null,
    tokenExpiresAt: iso(row.token_expires_at),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    activatedAt: iso(row.activated_at),
    disconnectedAt: iso(row.disconnected_at),
    lastVerifiedAt: iso(row.last_verified_at),
    webhookSubscribedAt: iso(row.webhook_subscribed_at),
    lastError: row.last_error,
  };
}

export async function listWhatsAppConnections(
  pool: Pool,
  workspaceId: string,
): Promise<WhatsAppConnectionSummary[]> {
  const result = await pool.query<ConnectionRow>(
    `
      SELECT ${CONNECTION_SUMMARY_COLUMNS}
      FROM whatsapp_connections
      WHERE workspace_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [workspaceId],
  );

  return result.rows.map(mapConnectionSummary);
}

export async function getWhatsAppConnection(
  pool: Pool,
  workspaceId: string,
  connectionId: string,
): Promise<WhatsAppConnectionSummary | null> {
  const result = await pool.query<ConnectionRow>(
    `
      SELECT ${CONNECTION_SUMMARY_COLUMNS}
      FROM whatsapp_connections
      WHERE workspace_id = $1
        AND id = $2
      LIMIT 1
    `,
    [workspaceId, connectionId],
  );

  const row = result.rows[0];
  return row ? mapConnectionSummary(row) : null;
}

/**
 * Disconnects a connection owned by the workspace. Credentials are retained as
 * ciphertext for audit/rotation, but the status makes them unusable for both
 * inbound routing and outbound sending. Returns null when the connection does
 * not belong to the workspace so callers return a consistent 404.
 */
export async function disconnectWhatsAppConnection(
  pool: Pool,
  workspaceId: string,
  connectionId: string,
): Promise<WhatsAppConnectionSummary | null> {
  const result = await pool.query<ConnectionRow>(
    `
      UPDATE whatsapp_connections
      SET status = 'disconnected',
          disconnected_at = COALESCE(disconnected_at, now()),
          updated_at = now()
      WHERE workspace_id = $1
        AND id = $2
      RETURNING ${CONNECTION_SUMMARY_COLUMNS}
    `,
    [workspaceId, connectionId],
  );

  const row = result.rows[0];
  return row ? mapConnectionSummary(row) : null;
}

export type ActiveConnectionOwner = Readonly<{
  connectionId: string;
  workspaceId: string;
}>;

/**
 * Resolves a Meta phone-number ID for inbound routing. Only active
 * connections may receive events. Unknown or disconnected IDs return null and
 * must never be assigned automatically.
 */
export async function resolveActiveConnectionByPhoneNumberId(
  pool: Pool,
  phoneNumberId: string,
): Promise<ActiveConnectionOwner | null> {
  const result = await pool.query<{ id: string; workspace_id: string }>(
    `
      SELECT id, workspace_id
      FROM whatsapp_connections
      WHERE phone_number_id = $1
        AND status = 'active'
      LIMIT 1
    `,
    [phoneNumberId],
  );

  const row = result.rows[0];

  return row ? { connectionId: row.id, workspaceId: row.workspace_id } : null;
}

export type ConversationConnection = Readonly<{
  connectionId: string;
  workspaceId: string;
  phoneNumberId: string;
  wabaId: string | null;
  status: WhatsAppConnectionStatus;
  tokenExpiresAt: Date | null;
  encryptedToken: EncryptedWhatsAppToken | null;
}>;

/**
 * Loads the connection attached to a conversation, scoped to the conversation's
 * workspace. Callers must still verify status and expiry before sending.
 */
export async function resolveConversationConnection(
  pool: Pool,
  workspaceId: string,
  conversationId: string,
): Promise<ConversationConnection | null> {
  const result = await pool.query<{
    id: string;
    workspace_id: string;
    phone_number_id: string;
    waba_id: string | null;
    status: WhatsAppConnectionStatus;
    token_expires_at: Date | null;
    access_token_ciphertext: string | null;
    access_token_iv: string | null;
    access_token_auth_tag: string | null;
    credential_key_version: string | null;
  }>(
    `
      SELECT
        connection.id,
        connection.workspace_id,
        connection.phone_number_id,
        connection.waba_id,
        connection.status,
        connection.token_expires_at,
        connection.access_token_ciphertext,
        connection.access_token_iv,
        connection.access_token_auth_tag,
        connection.credential_key_version
      FROM whatsapp_conversations AS conversation
      JOIN whatsapp_connections AS connection
        ON connection.id = conversation.whatsapp_connection_id
       AND connection.workspace_id = conversation.workspace_id
      WHERE conversation.workspace_id = $1
        AND conversation.id = $2
      LIMIT 1
    `,
    [workspaceId, conversationId],
  );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  const encryptedToken =
    row.access_token_ciphertext &&
    row.access_token_iv &&
    row.access_token_auth_tag &&
    row.credential_key_version
      ? {
          ciphertext: row.access_token_ciphertext,
          iv: row.access_token_iv,
          authTag: row.access_token_auth_tag,
          keyVersion: row.credential_key_version,
        }
      : null;

  return {
    connectionId: row.id,
    workspaceId: row.workspace_id,
    phoneNumberId: row.phone_number_id,
    wabaId: row.waba_id,
    status: row.status,
    tokenExpiresAt: row.token_expires_at,
    encryptedToken,
  };
}

export type ConnectionProviderHint = Readonly<{
  hasConnection: boolean;
  hasCredentials: boolean;
}>;

/**
 * Describes the connection attached to a conversation for provider selection.
 * A credential-bearing connection always selects the WhatsApp provider, even
 * when it is disconnected or expired, so the worker fails the send instead of
 * silently substituting the mock provider.
 */
export async function getConversationProviderHint(
  queryable: Pool | PoolClient,
  workspaceId: string,
  conversationId: string,
): Promise<ConnectionProviderHint> {
  const result = await queryable.query<{
    has_credentials: boolean;
  }>(
    `
      SELECT
        (
          connection.access_token_ciphertext IS NOT NULL
          AND connection.access_token_iv IS NOT NULL
          AND connection.access_token_auth_tag IS NOT NULL
          AND connection.credential_key_version IS NOT NULL
        ) AS has_credentials
      FROM whatsapp_conversations AS conversation
      JOIN whatsapp_connections AS connection
        ON connection.id = conversation.whatsapp_connection_id
       AND connection.workspace_id = conversation.workspace_id
      WHERE conversation.workspace_id = $1
        AND conversation.id = $2
      LIMIT 1
    `,
    [workspaceId, conversationId],
  );

  const row = result.rows[0];

  if (!row) {
    return { hasConnection: false, hasCredentials: false };
  }

  return { hasConnection: true, hasCredentials: row.has_credentials };
}

export async function workspaceHasCredentialConnection(
  queryable: Pool | PoolClient,
  workspaceId: string,
): Promise<boolean> {
  const result = await queryable.query(
    `
      SELECT 1
      FROM whatsapp_connections
      WHERE workspace_id = $1
        AND access_token_ciphertext IS NOT NULL
      LIMIT 1
    `,
    [workspaceId],
  );

  return result.rows.length > 0;
}

export type ConnectionCapabilities = Readonly<{
  total: number;
  active: number;
  withCredentials: number;
}>;

export async function getConnectionCapabilities(
  pool: Pool,
  workspaceId: string,
): Promise<ConnectionCapabilities> {
  const result = await pool.query<{
    total: number;
    active: number;
    with_credentials: number;
  }>(
    `
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE status = 'active')::int AS active,
        count(*) FILTER (
          WHERE access_token_ciphertext IS NOT NULL
        )::int AS with_credentials
      FROM whatsapp_connections
      WHERE workspace_id = $1
    `,
    [workspaceId],
  );

  const row = result.rows[0];

  return {
    total: row?.total ?? 0,
    active: row?.active ?? 0,
    withCredentials: row?.with_credentials ?? 0,
  };
}

export type RegisterWhatsAppConnectionInput = Readonly<{
  workspaceId: string;
  phoneNumberId: string;
  displayPhoneNumber?: string | null;
  label?: string | null;
  wabaId?: string | null;
  status?: WhatsAppConnectionStatus;
  accessToken?: string | null;
  tokenExpiresAt?: Date | null;
}>;

/**
 * Trusted server-side onboarding entry point. This is intentionally not
 * exposed as an HTTP endpoint and does not accept a browser-supplied
 * workspace. M14B will call it from the verified Embedded Signup flow.
 */
export async function registerWhatsAppConnection(
  pool: Pool,
  input: RegisterWhatsAppConnectionInput,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<WhatsAppConnectionSummary> {
  const encryptedToken = input.accessToken
    ? encryptWhatsAppToken(input.accessToken, environment)
    : null;
  const status = input.status ?? "pending";
  const activatedAt = status === "active" ? new Date() : null;

  const result = await pool.query<ConnectionRow>(
    `
      INSERT INTO whatsapp_connections (
        workspace_id,
        phone_number_id,
        display_phone_number,
        label,
        waba_id,
        status,
        access_token_ciphertext,
        access_token_iv,
        access_token_auth_tag,
        token_expires_at,
        credential_key_version,
        activated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING ${CONNECTION_SUMMARY_COLUMNS}
    `,
    [
      input.workspaceId,
      input.phoneNumberId,
      input.displayPhoneNumber ?? null,
      input.label ?? null,
      input.wabaId ?? null,
      status,
      encryptedToken?.ciphertext ?? null,
      encryptedToken?.iv ?? null,
      encryptedToken?.authTag ?? null,
      input.tokenExpiresAt ?? null,
      encryptedToken?.keyVersion ?? null,
      activatedAt,
    ],
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error("WhatsApp connection insert did not return a row.");
  }

  return mapConnectionSummary(row);
}

/**
 * Activates a pending connection after its credentials have been verified.
 * Existing active connections are returned unchanged. A disconnected
 * connection is never silently reactivated.
 */
export async function activateWhatsAppConnection(
  pool: Pool,
  workspaceId: string,
  connectionId: string,
): Promise<WhatsAppConnectionSummary | null> {
  const result = await pool.query<ConnectionRow>(
    `
      UPDATE whatsapp_connections
      SET status = 'active',
          activated_at = COALESCE(activated_at, now()),
          disconnected_at = NULL,
          updated_at = now()
      WHERE workspace_id = $1
        AND id = $2
        AND status = 'pending'
      RETURNING ${CONNECTION_SUMMARY_COLUMNS}
    `,
    [workspaceId, connectionId],
  );

  const updated = result.rows[0];

  if (updated) {
    return mapConnectionSummary(updated);
  }

  return getWhatsAppConnection(pool, workspaceId, connectionId);
}

/**
 * Raised when a Meta phone-number ID already belongs to another workspace.
 * Callers must not disclose which workspace owns it.
 */
export class WhatsAppConnectionConflictError extends Error {
  constructor() {
    super(
      "This WhatsApp phone number is already connected to another workspace.",
    );
    this.name = "WhatsAppConnectionConflictError";
  }
}

export type WhatsAppConnectionForVerification = Readonly<{
  id: string;
  workspaceId: string;
  phoneNumberId: string;
  wabaId: string | null;
  status: WhatsAppConnectionStatus;
  tokenExpiresAt: Date | null;
  encryptedToken: EncryptedWhatsAppToken | null;
}>;

/**
 * Loads a connection and its encrypted credentials for server-side
 * re-verification. The ciphertext never leaves server provider code.
 */
export async function loadWhatsAppConnectionForVerification(
  queryable: Pool | PoolClient,
  workspaceId: string,
  connectionId: string,
): Promise<WhatsAppConnectionForVerification | null> {
  const result = await queryable.query<{
    id: string;
    workspace_id: string;
    phone_number_id: string;
    waba_id: string | null;
    status: WhatsAppConnectionStatus;
    token_expires_at: Date | null;
    access_token_ciphertext: string | null;
    access_token_iv: string | null;
    access_token_auth_tag: string | null;
    credential_key_version: string | null;
  }>(
    `
      SELECT
        id,
        workspace_id,
        phone_number_id,
        waba_id,
        status,
        token_expires_at,
        access_token_ciphertext,
        access_token_iv,
        access_token_auth_tag,
        credential_key_version
      FROM whatsapp_connections
      WHERE workspace_id = $1
        AND id = $2
      LIMIT 1
    `,
    [workspaceId, connectionId],
  );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  const encryptedToken =
    row.access_token_ciphertext &&
    row.access_token_iv &&
    row.access_token_auth_tag &&
    row.credential_key_version
      ? {
          ciphertext: row.access_token_ciphertext,
          iv: row.access_token_iv,
          authTag: row.access_token_auth_tag,
          keyVersion: row.credential_key_version,
        }
      : null;

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    phoneNumberId: row.phone_number_id,
    wabaId: row.waba_id,
    status: row.status,
    tokenExpiresAt: row.token_expires_at,
    encryptedToken,
  };
}

export type VerifiedConnectionStatus = "active" | "pending" | "error";

export type UpsertVerifiedWhatsAppConnectionInput = Readonly<{
  workspaceId: string;
  phoneNumberId: string;
  displayPhoneNumber?: string | null;
  label?: string | null;
  wabaId: string;
  status: VerifiedConnectionStatus;
  accessToken: string;
  tokenExpiresAt?: Date | null;
  lastError?: string | null;
  webhookSubscribed: boolean;
  verifiedAt?: Date;
}>;

/**
 * Creates or updates exactly one connection for a verified Meta phone-number
 * ID. The global phone-number index is checked first so a second workspace can
 * never be assigned another workspace's number. Re-onboarding an existing
 * connection in the same workspace replaces its encrypted credentials and
 * verification metadata rather than inserting a duplicate row.
 */
export async function upsertVerifiedWhatsAppConnection(
  queryable: Pool | PoolClient,
  input: UpsertVerifiedWhatsAppConnectionInput,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<WhatsAppConnectionSummary> {
  const encryptedToken = encryptWhatsAppToken(
    input.accessToken,
    environment,
  );
  const verifiedAt = input.verifiedAt ?? new Date();
  const existing = await queryable.query<{ id: string; workspace_id: string }>(
    `
      SELECT id, workspace_id
      FROM whatsapp_connections
      WHERE phone_number_id = $1
      LIMIT 1
    `,
    [input.phoneNumberId],
  );
  const existingRow = existing.rows[0];

  if (existingRow && existingRow.workspace_id !== input.workspaceId) {
    throw new WhatsAppConnectionConflictError();
  }

  if (existingRow) {
    const result = await queryable.query<ConnectionRow>(
      `
        UPDATE whatsapp_connections
        SET display_phone_number = $2,
            label = COALESCE($3, label),
            waba_id = $4,
            status = $5,
            access_token_ciphertext = $6,
            access_token_iv = $7,
            access_token_auth_tag = $8,
            token_expires_at = $9,
            credential_key_version = $10,
            last_verified_at = $11,
            webhook_subscribed_at = CASE WHEN $12 THEN $11 ELSE NULL END,
            last_error = $13,
            activated_at = CASE
              WHEN $5 = 'active' THEN COALESCE(activated_at, $11)
              ELSE activated_at
            END,
            disconnected_at = CASE
              WHEN $5 = 'active' THEN NULL
              ELSE disconnected_at
            END,
            updated_at = $11
        WHERE id = $14
          AND workspace_id = $15
        RETURNING ${CONNECTION_SUMMARY_COLUMNS}
      `,
      [
        existingRow.id,
        input.displayPhoneNumber ?? null,
        input.label ?? null,
        input.wabaId,
        input.status,
        encryptedToken.ciphertext,
        encryptedToken.iv,
        encryptedToken.authTag,
        input.tokenExpiresAt ?? null,
        encryptedToken.keyVersion,
        verifiedAt,
        input.webhookSubscribed,
        input.lastError ?? null,
        existingRow.id,
        input.workspaceId,
      ],
    );

    const row = result.rows[0];

    if (!row) {
      throw new Error(
        "WhatsApp connection update did not return a row for this workspace.",
      );
    }

    return mapConnectionSummary(row);
  }

  const result = await queryable.query<ConnectionRow>(
    `
      INSERT INTO whatsapp_connections (
        workspace_id,
        phone_number_id,
        display_phone_number,
        label,
        waba_id,
        status,
        access_token_ciphertext,
        access_token_iv,
        access_token_auth_tag,
        token_expires_at,
        credential_key_version,
        activated_at,
        last_verified_at,
        webhook_subscribed_at,
        last_error
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        CASE WHEN $6 = 'active' THEN $12 ELSE NULL END,
        $12,
        CASE WHEN $13 THEN $12 ELSE NULL END,
        $14
      )
      RETURNING ${CONNECTION_SUMMARY_COLUMNS}
    `,
    [
      input.workspaceId,
      input.phoneNumberId,
      input.displayPhoneNumber ?? null,
      input.label ?? null,
      input.wabaId,
      input.status,
      encryptedToken.ciphertext,
      encryptedToken.iv,
      encryptedToken.authTag,
      input.tokenExpiresAt ?? null,
      encryptedToken.keyVersion,
      verifiedAt,
      input.webhookSubscribed,
      input.lastError ?? null,
    ],
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error("WhatsApp connection insert did not return a row.");
  }

  return mapConnectionSummary(row);
}

export type ConnectionVerificationStateInput = Readonly<{
  workspaceId: string;
  connectionId: string;
  status: VerifiedConnectionStatus;
  lastError: string | null;
  webhookSubscribed: boolean;
  verifiedAt?: Date;
}>;

/**
 * Records the outcome of a re-verification attempt without touching the
 * encrypted token. Only "active" clears the disconnected marker.
 */
export async function setWhatsAppConnectionVerificationState(
  queryable: Pool | PoolClient,
  input: ConnectionVerificationStateInput,
): Promise<WhatsAppConnectionSummary | null> {
  const verifiedAt = input.verifiedAt ?? new Date();
  const result = await queryable.query<ConnectionRow>(
    `
      UPDATE whatsapp_connections
      SET status = $3,
          last_verified_at = $4,
          webhook_subscribed_at = CASE WHEN $5 THEN $4 ELSE NULL END,
          last_error = $6,
          activated_at = CASE
            WHEN $3 = 'active' THEN COALESCE(activated_at, $4)
            ELSE activated_at
          END,
          disconnected_at = CASE
            WHEN $3 = 'active' THEN NULL
            ELSE disconnected_at
          END,
          updated_at = $4
      WHERE workspace_id = $1
        AND id = $2
      RETURNING ${CONNECTION_SUMMARY_COLUMNS}
    `,
    [
      input.workspaceId,
      input.connectionId,
      input.status,
      verifiedAt,
      input.webhookSubscribed,
      input.lastError,
    ],
  );

  const row = result.rows[0];
  return row ? mapConnectionSummary(row) : null;
}
