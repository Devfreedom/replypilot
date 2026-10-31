# Milestone 11B — Message History Cursor Pagination

Status: implemented in Milestone 11B.

## Why a cursor is needed

Message history was previously read with `LIMIT`/`OFFSET` and the stable
ordering tuple:

```sql
ORDER BY provider_timestamp ASC, created_at ASC, id ASC
```

Offset pagination is deterministic for equal timestamps because `id` is unique,
but it is not stable while messages are being written. If a new message arrives
between page 1 and page 2, the offset shifts and a client can see a duplicate
message or skip one. A chat thread that loads while messages arrive needs a
cursor anchored to a row the client actually received.

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

Messages inserted in one webhook transaction share the same `created_at`
because PostgreSQL `now()` is the transaction start time. For those batches the
`id` column is the real tiebreaker. The cursor therefore carries all three
values; a timestamp-only cursor would skip or repeat equal-timestamp messages.

## Cursor encoding

The cursor is an opaque, URL-safe token:

```text
base64url(JSON.stringify({
  providerTimestampUs: "<signed epoch microseconds as a decimal string>",
  createdAtUs: "<signed epoch microseconds as a decimal string>",
  id: "<UUID>"
}))
```

PostgreSQL timestamps keep microsecond precision, while a JavaScript `Date` and
`toISOString()` keep only milliseconds. Encoding epoch microseconds as decimal
strings preserves the exact database value. The values are signed so timestamps
before the Unix epoch are represented correctly. The API still returns
human-readable ISO timestamps with millisecond precision for display; the cursor
is built from separate `extract(epoch ...) * 1000000` values in the SQL query.

Rules:

- Treat the cursor as opaque on the client.
- Validate the decoded value with Zod: signed decimal epoch-microsecond strings
  (at most 18 digits, keeping every value inside PostgreSQL's `bigint` range) and
  a UUID. Reject malformed cursors with `400`.
- A cursor is accepted only when it points at a real message in the requested
  conversation. This rejects cursors from another conversation or a deleted
  anchor row without revealing whether the message exists elsewhere.
- Every query includes `workspace_id` and `conversation_id` in the `WHERE`
  clause. The route first resolves the conversation summary for the
  authenticated workspace and returns `404` when it is not found.
- Never interpolate decoded values into SQL. Use parameter placeholders and
  exact epoch-microsecond timestamps:

```sql
WHERE workspace_id = $1
  AND conversation_id = $2
  AND (provider_timestamp, created_at, id) < (
    TIMESTAMPTZ 'epoch' + $3::bigint * INTERVAL '1 microsecond',
    TIMESTAMPTZ 'epoch' + $4::bigint * INTERVAL '1 microsecond',
    $5::uuid
  )
ORDER BY provider_timestamp DESC, created_at DESC, id DESC
LIMIT $6
```

## Endpoint contract

The existing route is extended rather than duplicated:

```text
GET /api/conversations/:conversationId/messages
```

Query parameters:

- `limit` — 1..100, default 25.
- `offset` — optional legacy offset. When neither `cursor` nor `direction` is
  supplied, the route keeps the original oldest-first offset contract.
- `cursor` — optional opaque token.
- `direction` — optional, `before` or `after`. Supplying `direction` (with or
  without a cursor) enables cursor mode.

Cursor mode behavior:

| Request | Result |
| --- | --- |
| `direction=before` (no cursor) | Newest page, ascending display order |
| `direction=after` (no cursor) | Oldest page, ascending display order |
| `direction=before&cursor=...` | Older page, ascending display order |
| `direction=after&cursor=...` | Newer page, ascending display order |

The frontend initial load uses `direction=before` with no cursor, so the first
paint shows the newest messages. "Load older messages" then uses
`direction=before&cursor=<prevCursor>`.

Cursor-mode response:

```json
{
  "conversation": {},
  "messages": [],
  "pagination": {
    "limit": 25,
    "hasMore": true,
    "nextCursor": "<opaque or null>",
    "prevCursor": "<opaque or null>",
    "direction": "before"
  }
}
```

`hasMore` is derived by fetching `limit + 1` rows, returning `limit`, and setting
`hasMore` when the extra row exists. `hasMore` always refers to the requested
direction.

- `prevCursor` loads older messages. It is `null` when the page has reached the
  beginning of the conversation.
- `nextCursor` loads newer messages. It is `null` when the page has reached the
  newest message available at request time.
- An empty `before` page has `prevCursor: null` and repeats the request cursor as
  `nextCursor`. An empty `after` page has `nextCursor: null` and repeats the
  request cursor as `prevCursor`. This lets a client return to the page it
  already loaded instead of losing the only cursor that pointed back to it.
- Pages are always returned in ascending chronological order for display,
  including `before` pages that were fetched with a descending scan.

## Compatibility

- The original offset contract is preserved exactly when neither `cursor` nor
  `direction` is supplied. Existing tests and clients continue to receive
  `{ limit, offset, hasMore, nextOffset }` and oldest-first rows.
- Supplying both `cursor` and `offset` is rejected with `400`. Supplying
  `direction` and `offset` is also rejected rather than guessing which mode the
  client intended.
- The legacy `/api/whatsapp/conversations` routes are unchanged.
- The conversation list (`GET /api/conversations`) still uses offset pagination.
  It has the same theoretical instability, but it is a separate ordering key
  (`last activity`, `id`) and is not part of this milestone's message cursor.

## Database changes

No migration was required. The existing `whatsapp_messages` table already has
`provider_timestamp`, `created_at`, and `id`; the existing
`whatsapp_messages_conversation_timestamp_idx` supports the keyset query and
the tuple membership check.

## Test coverage

The API suite covers:

- Newest-first initial page and older pages via `prevCursor`.
- Forward pagination via `nextCursor` / `direction=after`.
- Equal-timestamp messages with no duplicates and database-consistent order.
- A new message arriving between pages without shifting or skipping older rows.
- Empty `before` and `after` pages retaining the request cursor in the opposite
  direction.
- Timestamps before the Unix epoch using signed epoch-microsecond cursors.
- Malformed, empty, conflicting, and wrong-conversation cursors returning `400`.
- Unauthenticated requests returning `401`.
- Cross-workspace conversation access returning `404`.
- Summary identity fields for phone and provider-ID customers, plus lead links.
