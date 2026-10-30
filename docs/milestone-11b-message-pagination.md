# Milestone 11B — Message History Cursor Pagination Design

Status: design note only. The corrective patch for 11A deliberately keeps the
existing offset pagination; this document defines the cursor contract that 11B
should implement.

## Why a cursor is needed

Message history is currently read with `LIMIT`/`OFFSET` and the stable ordering
tuple:

```sql
ORDER BY provider_timestamp ASC, created_at ASC, id ASC
```

Offset pagination is deterministic for equal timestamps (the `id` tiebreaker is
unique), but it is not stable while messages are being written. If a new message
arrives between page 1 and page 2, the offset shifts and a client can see a
duplicate message or skip one. A chat thread that loads while messages arrive
needs a cursor that is anchored to the last row the client actually received.

## Ordering tuple

The cursor is the full ordering key, not just a timestamp:

```text
(provider_timestamp, created_at, id)
```

All three columns are `NOT NULL`, so the comparison is a plain lexicographic
tuple comparison with no NULL ordering rules. The existing index

```sql
whatsapp_messages_conversation_timestamp_idx
  ON whatsapp_messages (workspace_id, conversation_id, provider_timestamp ASC, created_at ASC, id)
```

supports both the forward scan and the tuple filter.

Important detail: messages inserted in one webhook transaction share the same
`created_at` because PostgreSQL `now()` is the transaction start time. For those
batches the `id` column is the real tiebreaker. The cursor must therefore carry
all three values; a timestamp-only cursor would skip or repeat equal-timestamp
messages.

## Cursor encoding

Encode the tuple as an opaque, URL-safe token:

```text
base64url(JSON.stringify({
  providerTimestamp: "<ISO-8601 UTC string>",
  createdAt: "<ISO-8601 UTC string>",
  id: "<UUID>"
}))
```

Rules:

- Treat the cursor as opaque on the client. Do not document the JSON shape as a
  stable public contract; it may change as long as old cursors remain readable
  for a reasonable window.
- Validate the decoded value with Zod: ISO timestamps that parse to a valid
  date, and a UUID for `id`. Reject malformed cursors with `400`.
- The cursor is scoped by the route's authenticated workspace and the
  conversation ID in the path. A cursor from another conversation or workspace
  is not a security boundary by itself, but the query must still include
  `workspace_id` and `conversation_id` in the `WHERE` clause.
- Never interpolate the decoded values into SQL. Use parameter placeholders in a
  row-value comparison:

```sql
WHERE workspace_id = $1
  AND conversation_id = $2
  AND (provider_timestamp, created_at, id) > ($3, $4, $5)
ORDER BY provider_timestamp ASC, created_at ASC, id ASC
LIMIT $6
```

## Endpoint shape

Keep the existing `GET /api/conversations/:id/messages` route and add cursor
parameters rather than introducing a second route:

- `limit` — unchanged, 1..100, default 25.
- `cursor` — optional opaque token. Omitted means "start at the beginning" for
  the initial load.
- `direction` — optional, `after` (default) or `before`.
  - `after` uses `>` and ascending order: load newer messages, typically for a
    live tail.
  - `before` uses `<` and descending order: load older history for an
    infinite-scroll-up chat view. Reverse the returned page before rendering so
    the client still displays ascending order.

Response:

```json
{
  "messages": [],
  "pagination": {
    "limit": 25,
    "hasMore": true,
    "nextCursor": "<opaque or null>",
    "prevCursor": "<opaque or null>"
  }
}
```

`hasMore` is derived the same way as today: fetch `limit + 1` rows, return
`limit`, and set `hasMore` when the extra row exists. `nextCursor` is the tuple
of the last returned row; `prevCursor` is the tuple of the first returned row.
Return `null` when the corresponding direction has no more rows.

## Compatibility and migration

- The 11A offset parameters (`offset`) can remain temporarily for existing
  clients. If both `cursor` and `offset` are supplied, reject the request with
  `400` rather than guessing.
- Once the frontend chat view uses cursors, remove the offset path in a later
  change. Do not silently change the meaning of `offset`.
- The conversation list (`GET /api/conversations`) has the same offset
  instability. It can be migrated to a cursor on
  `(last_activity, id)` in a follow-up; that is a separate ordering key from
  message history and should not reuse the message cursor token.

## Test plan for 11B

- Equal-timestamp messages: page through with cursors and assert every message
  appears exactly once, in the same order as the database tuple.
- Insert a new message between pages and assert the second page does not repeat
  or skip rows.
- Reject malformed, truncated, and wrong-conversation cursors with `400`/`404`.
- Verify `before` returns older rows in descending order and the client-side
  reversal produces ascending display order.
- Verify the query plan uses
  `whatsapp_messages_conversation_timestamp_idx` for a large conversation.
