import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/i;

/**
 * Compares two strings without leaking their contents through comparison
 * timing. Length is checked first because timingSafeEqual throws when the
 * buffers differ in length.
 */
export function safeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

/**
 * Meta signs the exact request body bytes with the app secret. The header is
 * expected to contain `sha256=` followed by a 64-character hexadecimal digest.
 */
export function isValidMetaSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader) {
    return false;
  }

  const match = SIGNATURE_PATTERN.exec(signatureHeader);

  if (!match?.[1]) {
    return false;
  }

  const provided = Buffer.from(match[1], "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();

  return (
    provided.length === expected.length &&
    timingSafeEqual(provided, expected)
  );
}
