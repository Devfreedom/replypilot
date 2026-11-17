/**
 * Server-side encryption for WhatsApp connection access tokens.
 *
 * Tokens are encrypted with AES-256-GCM before they touch PostgreSQL. The
 * 32-byte key and its version come from server-only environment variables:
 *
 *  - WHATSAPP_CREDENTIAL_ENCRYPTION_KEY: base64-encoded 32-byte key
 *  - WHATSAPP_CREDENTIAL_KEY_VERSION: short version label (default "v1")
 *
 * Never log or return plaintext tokens, the encryption key, or ciphertext.
 * Authentication on decrypt fails closed if the ciphertext, IV, tag, or key
 * version does not match.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const CREDENTIAL_ENCRYPTION_KEY_ENV =
  "WHATSAPP_CREDENTIAL_ENCRYPTION_KEY";
export const CREDENTIAL_KEY_VERSION_ENV = "WHATSAPP_CREDENTIAL_KEY_VERSION";
export const DEFAULT_CREDENTIAL_KEY_VERSION = "v1";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MAX_TOKEN_LENGTH = 4096;
const MAX_KEY_VERSION_LENGTH = 32;

export type EncryptedWhatsAppToken = Readonly<{
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
}>;

export class WhatsAppCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppCredentialError";
  }
}

function readKeyVersion(environment: NodeJS.ProcessEnv): string {
  const version =
    environment[CREDENTIAL_KEY_VERSION_ENV]?.trim() ||
    DEFAULT_CREDENTIAL_KEY_VERSION;

  if (
    version.length === 0 ||
    version.length > MAX_KEY_VERSION_LENGTH ||
    !/^[A-Za-z0-9._-]+$/.test(version)
  ) {
    throw new WhatsAppCredentialError(
      `${CREDENTIAL_KEY_VERSION_ENV} must be 1-${MAX_KEY_VERSION_LENGTH} letters, digits, dots, underscores, or hyphens.`,
    );
  }

  return version;
}

function readEncryptionKey(environment: NodeJS.ProcessEnv): Buffer {
  const raw = environment[CREDENTIAL_ENCRYPTION_KEY_ENV]?.trim();

  if (!raw) {
    throw new WhatsAppCredentialError(
      `${CREDENTIAL_ENCRYPTION_KEY_ENV} is not configured. WhatsApp connection credentials cannot be encrypted or decrypted.`,
    );
  }

  let key: Buffer;

  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new WhatsAppCredentialError(
      `${CREDENTIAL_ENCRYPTION_KEY_ENV} must be a base64-encoded ${KEY_BYTES}-byte key.`,
    );
  }

  if (key.length !== KEY_BYTES) {
    throw new WhatsAppCredentialError(
      `${CREDENTIAL_ENCRYPTION_KEY_ENV} must decode to exactly ${KEY_BYTES} bytes.`,
    );
  }

  return key;
}

/**
 * Returns true when a key is present and has the expected decoded length.
 * Callers use this to decide whether a credential-bearing connection can be
 * processed without leaking why decryption is unavailable.
 */
export function isCredentialEncryptionConfigured(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    readEncryptionKey(environment);
    return true;
  } catch {
    return false;
  }
}

export function encryptWhatsAppToken(
  token: string,
  environment: NodeJS.ProcessEnv = process.env,
): EncryptedWhatsAppToken {
  const value = token.trim();

  if (!value) {
    throw new WhatsAppCredentialError("WhatsApp access token must not be empty.");
  }

  if (value.length > MAX_TOKEN_LENGTH) {
    throw new WhatsAppCredentialError(
      `WhatsApp access token must be ${MAX_TOKEN_LENGTH} characters or fewer.`,
    );
  }

  const key = readEncryptionKey(environment);
  const keyVersion = readKeyVersion(environment);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyVersion,
  };
}

/**
 * Decrypts a stored token. The caller must pass the exact record loaded from
 * the database. A mismatch in key version, IV length, tag length, or GCM
 * authentication fails closed.
 */
export function decryptWhatsAppToken(
  record: Readonly<{
    ciphertext: string;
    iv: string;
    authTag: string;
    keyVersion: string;
  }>,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const key = readEncryptionKey(environment);
  const expectedVersion = readKeyVersion(environment);

  const recordVersion = Buffer.from(record.keyVersion);
  const currentVersion = Buffer.from(expectedVersion);

  if (
    recordVersion.length !== currentVersion.length ||
    !timingSafeEqual(recordVersion, currentVersion)
  ) {
    throw new WhatsAppCredentialError(
      "WhatsApp credential key version does not match the configured key.",
    );
  }

  const iv = Buffer.from(record.iv, "base64");
  const authTag = Buffer.from(record.authTag, "base64");
  const ciphertext = Buffer.from(record.ciphertext, "base64");

  if (iv.length !== IV_BYTES) {
    throw new WhatsAppCredentialError("WhatsApp credential IV is invalid.");
  }

  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new WhatsAppCredentialError(
      "WhatsApp credential authentication tag is invalid.",
    );
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");

    if (!plaintext) {
      throw new WhatsAppCredentialError(
        "WhatsApp credential decrypted to an empty token.",
      );
    }

    return plaintext;
  } catch (error) {
    if (error instanceof WhatsAppCredentialError) {
      throw error;
    }

    throw new WhatsAppCredentialError(
      "WhatsApp credential could not be authenticated with the configured key.",
    );
  }
}
