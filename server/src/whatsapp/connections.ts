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
  whatsappCredentialAad,
  type EncryptedWhatsAppToken,
} from "./credentials.js";
import { WhatsAppPhoneNumberOwnedByAnotherWorkspaceError } from "./repository.js";

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

export type ConnectionPhoneOwner = Readonly<{
  connectionId: string;
  workspaceId: string;
  status: WhatsAppConnectionStatus;
}>;

/**
 * Atomically inspects `whatsapp_connections` for a `phoneNumberId` in a single
 * statement so inbound routing can distinguish an active owner, an existing
 * non-active record (which blocks legacy reactivation), and an unclaimed number.
 */
export async function resolveConnectionStateByPhoneNumberId(
  queryable: Pool | PoolClient,
  phoneNumberId: string,
): Promise<ConnectionPhoneOwner | null> {
  const result = await queryable.query<{
    id: string;
    workspace_id: string;
    status: WhatsAppConnectionStatus;
  }>(
    `
      SELECT id, workspace_id, status
      FROM whatsapp_connections
      WHERE phone_number_id = $1
      ORDER BY
        CASE status
          WHEN 'active' THEN 0
          WHEN 'pending' THEN 1
          WHEN 'error' THEN 2
          ELSE 3
        END ASC,
        created_at DESC,
        id DESC
      LIMIT 1
    `,
    [phoneNumberId],
  );

  const row = result.rows[0];

  return row
    ? {
        connectionId: row.id,
        workspaceId: row.workspace_id,
        status: row.status,
      }
    : null;
}

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

/**
 * Returns true if any connection row (active, pending, error, or disconnected)
 * already exists for `phoneNumberId`. Used to keep legacy env routing from
 * claiming or reactivating a previously registered or disconnected number.
 */
export async function hasAnyConnectionForPhoneNumberId(
  queryable: Pool | PoolClient,
  phoneNumberId: string,
): Promise<boolean> {
  const result = await queryable.query<{ exists: number }>(
    `
      SELECT 1 AS exists
      FROM whatsapp_connections
      WHERE phone_number_id = $1
      LIMIT 1
    `,
    [phoneNumberId],
  );

  return result.rows.length > 0;
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
  /** Status of the connection attached to the conversation, null when absent. */
  status: WhatsAppConnectionStatus | null;
}>;

/**
 * Describes the connection attached to a conversation for provider selection.
 * A credential-bearing connection always selects the WhatsApp provider, even
 * when it is disconnected or expired, so the worker fails the send instead of
 * silently substituting the mock provider.
 *
 * A connection that is not usable for sending is reported through `status` so
 * the caller can refuse the work rather than routing it to a provider that
 * cannot honour the connection state.
 */
export async function getConversationProviderHint(
  queryable: Pool | PoolClient,
  workspaceId: string,
  conversationId: string,
): Promise<ConnectionProviderHint> {
  const result = await queryable.query<{
    has_credentials: boolean;
    status: WhatsAppConnectionStatus;
  }>(
    `
      SELECT
        (
          connection.access_token_ciphertext IS NOT NULL
          AND connection.access_token_iv IS NOT NULL
          AND connection.access_token_auth_tag IS NOT NULL
          AND connection.credential_key_version IS NOT NULL
        ) AS has_credentials,
        connection.status
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
    return { hasConnection: false, hasCredentials: false, status: null };
  }

  return {
    hasConnection: true,
    hasCredentials: row.has_credentials,
    status: row.status,
  };
}

/**
 * Reads the status of the connection attached to a conversation. Callers use it
 * to refuse outbound work for a connection that cannot deliver, without
 * loading any credential material.
 */
export async function getConversationConnectionStatus(
  queryable: Pool | PoolClient,
  workspaceId: string,
  conversationId: string,
): Promise<WhatsAppConnectionStatus | null> {
  const result = await queryable.query<{ status: WhatsAppConnectionStatus }>(
    `
      SELECT connection.status
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

  return result.rows[0]?.status ?? null;
}

/**
 * Explains why a connection cannot deliver an outbound message right now.
 * The wording is shared by the provider and by the worker so a failed send
 * reports the same reason regardless of which layer refused it.
 */
export function describeConnectionSendFailure(
  status: WhatsAppConnectionStatus | null,
): string {
  if (status === null) {
    return "conversation has no WhatsApp connection in this workspace.";
  }

  if (status === "pending") {
    return "WhatsApp connection has not been activated.";
  }

  if (status === "disconnected") {
    return "WhatsApp connection is disconnected.";
  }

  if (status === "error") {
    return "WhatsApp connection needs attention; verify it again before sending.";
  }

  return "WhatsApp connection is not usable.";
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
    ? encryptWhatsAppToken(
        input.accessToken,
        environment,
        whatsappCredentialAad(input.workspaceId, input.phoneNumberId),
      )
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
export class WhatsAppConnectionConflictError extends WhatsAppPhoneNumberOwnedByAnotherWorkspaceError {
  constructor() {
    super(
      "This WhatsApp phone number is already connected to another workspace.",
    );
    this.name = "WhatsAppConnectionConflictError";
  }
}

export function isPhoneNumberOwnershipConflictError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; constraint?: unknown };
  return (
    candidate.code === "23505" &&
    candidate.constraint === "whatsapp_connections_phone_number_id_uidx"
  );
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
    whatsappCredentialAad(input.workspaceId, input.phoneNumberId),
  );
  const verifiedAt = input.verifiedAt ?? new Date();
  const ownedByOther = await queryable.query<{
    id: string;
    workspace_id: string;
  }>(
    `
      SELECT id, workspace_id
      FROM whatsapp_connections
      WHERE phone_number_id = $1
        AND status <> 'disconnected'
        AND workspace_id <> $2
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `,
    [input.phoneNumberId, input.workspaceId],
  );

  if (ownedByOther.rows[0]) {
    throw new WhatsAppConnectionConflictError();
  }

  try {
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
          last_error,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          CASE WHEN $6 = 'active' THEN $12::timestamptz ELSE NULL END,
          $12::timestamptz,
          CASE WHEN $13::boolean THEN $12::timestamptz ELSE NULL END,
          $14,
          $12::timestamptz
        )
        ON CONFLICT (workspace_id, phone_number_id)
        DO UPDATE SET
          display_phone_number = EXCLUDED.display_phone_number,
          label = COALESCE(EXCLUDED.label, whatsapp_connections.label),
          waba_id = EXCLUDED.waba_id,
          status = EXCLUDED.status,
          access_token_ciphertext = EXCLUDED.access_token_ciphertext,
          access_token_iv = EXCLUDED.access_token_iv,
          access_token_auth_tag = EXCLUDED.access_token_auth_tag,
          token_expires_at = EXCLUDED.token_expires_at,
          credential_key_version = EXCLUDED.credential_key_version,
          last_verified_at = EXCLUDED.last_verified_at,
          webhook_subscribed_at = EXCLUDED.webhook_subscribed_at,
          last_error = EXCLUDED.last_error,
          activated_at = CASE
            WHEN EXCLUDED.status = 'active'
              THEN COALESCE(whatsapp_connections.activated_at, EXCLUDED.activated_at)
            ELSE whatsapp_connections.activated_at
          END,
          disconnected_at = CASE
            WHEN EXCLUDED.status = 'active' THEN NULL
            ELSE whatsapp_connections.disconnected_at
          END,
          updated_at = EXCLUDED.updated_at
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
      throw new Error("WhatsApp connection upsert did not return a row.");
    }

    return mapConnectionSummary(row);
  } catch (error) {
    if (isPhoneNumberOwnershipConflictError(error)) {
      throw new WhatsAppConnectionConflictError();
    }

    throw error;
  }
}

export type ConnectionVerificationStateInput = Readonly<{
  workspaceId: string;
  connectionId: string;
  status: VerifiedConnectionStatus;
  lastError: string | null;
  webhookSubscribed: boolean;
  verifiedAt?: Date;
  /**
   * Snapshot of the encrypted credential columns captured at the start of
   * verification. When provided (including `null` for credential-less rows),
   * the update only succeeds if all four credential columns still match,
   * preventing a slow verification from overwriting a concurrent re-onboarding.
   */
  expectedEncryptedToken?: EncryptedWhatsAppToken | null;
}>;

/**
 * Records the outcome of a re-verification attempt without touching the
 * encrypted token. Only "active" clears the disconnected marker, a
 * disconnected connection is never updated by verification, and when
 * `expectedEncryptedToken` is supplied a connection whose credentials were
 * replaced concurrently is left untouched (`null` is returned).
 */
export async function setWhatsAppConnectionVerificationState(
  queryable: Pool | PoolClient,
  input: ConnectionVerificationStateInput,
): Promise<WhatsAppConnectionSummary | null> {
  const verifiedAt = input.verifiedAt ?? new Date();
  const checkCredentials = input.expectedEncryptedToken !== undefined;
  const expectedToken = input.expectedEncryptedToken ?? null;
  const result = await queryable.query<ConnectionRow>(
    `
      UPDATE whatsapp_connections
      SET status = $3,
          last_verified_at = $4::timestamptz,
          webhook_subscribed_at = CASE
            WHEN $5::boolean THEN $4::timestamptz
            ELSE NULL
          END,
          last_error = $6,
          activated_at = CASE
            WHEN $3 = 'active' THEN COALESCE(activated_at, $4::timestamptz)
            ELSE activated_at
          END,
          disconnected_at = CASE
            WHEN $3 = 'active' THEN NULL
            ELSE disconnected_at
          END,
          updated_at = $4
      WHERE workspace_id = $1
        AND id = $2
        AND status <> 'disconnected'
        AND (
          NOT $7::boolean
          OR (
            access_token_ciphertext IS NOT DISTINCT FROM $8::text
            AND access_token_iv IS NOT DISTINCT FROM $9::text
            AND access_token_auth_tag IS NOT DISTINCT FROM $10::text
            AND credential_key_version IS NOT DISTINCT FROM $11::text
          )
        )
      RETURNING ${CONNECTION_SUMMARY_COLUMNS}
    `,
    [
      input.workspaceId,
      input.connectionId,
      input.status,
      verifiedAt,
      input.webhookSubscribed,
      input.lastError,
      checkCredentials,
      expectedToken?.ciphertext ?? null,
      expectedToken?.iv ?? null,
      expectedToken?.authTag ?? null,
      expectedToken?.keyVersion ?? null,
    ],
  );

  const row = result.rows[0];
  return row ? mapConnectionSummary(row) : null;
}
