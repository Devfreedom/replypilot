import { z } from "zod";

/**
 * Opaque keyset cursor for message history.
 *
 * PostgreSQL timestamps keep microsecond precision, while a JavaScript `Date`
 * (and `toISOString()`) only keeps milliseconds. Encoding epoch microseconds
 * as decimal strings keeps the cursor exact, so a cursor can never re-select
 * its own anchor row or skip a row that shares the same millisecond.
 *
 * The cursor is the full ordering tuple:
 *   (provider_timestamp, created_at, id)
 */
const MAX_CURSOR_LENGTH = 512;
// PostgreSQL timestamps can precede the Unix epoch. Keep the magnitude within
// 18 digits so every accepted value remains inside PostgreSQL's bigint range.
const EPOCH_MICROSECONDS = /^-?\d{1,18}$/;

const messageCursorSchema = z
  .object({
    providerTimestampUs: z.string().regex(EPOCH_MICROSECONDS),
    createdAtUs: z.string().regex(EPOCH_MICROSECONDS),
    id: z.uuid(),
  })
  .strict();

export type MessageCursor = z.infer<typeof messageCursorSchema>;

export const MAX_MESSAGE_CURSOR_LENGTH = MAX_CURSOR_LENGTH;

export function encodeMessageCursor(cursor: MessageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeMessageCursor(value: string): MessageCursor | null {
  if (
    value.length === 0 ||
    value.length > MAX_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return null;
  }

  let decoded: unknown;

  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const parsed = messageCursorSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}
