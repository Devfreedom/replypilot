# Milestone 11B — Unified WhatsApp Inbox

Status: implemented. Inbound-only. No outbound WhatsApp sending, AI replies,
reply approvals, media storage, or catalogue management is included.

## What the inbox does

- Lists workspace conversations from `GET /api/conversations`.
- Filters by `open`, `closed`, `archived`, or all statuses.
- Shows the customer display name, phone number or provider contact ID, latest
  message preview, latest timestamp, status, and lead link when present.
- Loads the newest message page first and older pages on demand using the
  message cursor contract in `docs/milestone-11b-message-pagination.md`.
- Renders inbound and outbound messages differently. Only message types already
  stored by the webhook are shown; unsupported types are labelled instead of
  invented.
- Uses a two-panel desktop layout and a list/thread mobile layout with a back
  control.

## API changes

`GET /api/conversations` and `GET /api/conversations/:id` now include two
additive summary fields:

- `customer.providerContactId` — the provider identifier for customers without a
  normalized phone number (for example a BSUID). It is never treated as a phone.
- `leadId` — the linked lead, when the conversation was matched by an exact
  WhatsApp number.

No existing fields were removed or renamed.

`GET /api/conversations/:id/messages` adds opt-in cursor mode
(`cursor`/`direction`) and preserves the legacy offset mode when neither is
supplied. See the pagination document for the full contract.

## Security

- Workspace access is derived only from the authenticated session. The client
  never sends a workspace ID.
- The route resolves the conversation summary within the authenticated
  workspace before reading messages. A conversation in another workspace
  returns `404`, not `403`.
- Every message query is parameterized and scoped by `workspace_id` and
  `conversation_id`.
- Cursor tokens are validated and must point at a real message in the requested
  conversation.
- `401` responses show a session-expired state with a sign-in action.
- Conversation selection is keyed, so a late response for a previously selected
  conversation cannot overwrite the current thread.

## Data-model limitations

- **No unread state.** The schema has no per-conversation read/unread or unread
  count columns, so the inbox does not invent badges or counts.
- **No outbound delivery status.** Outbound messages are stored with a
  processing status only; there is no sent/delivered/read receipt field, so the
  UI does not show check marks or delivery claims.
- **No media.** The schema stores a message type and text content. Images,
  audio, documents, and other media are not downloaded or displayed; they are
  labelled as unsupported when stored.
- **No customer merge.** Phone-only and provider-ID-only customer records are
  kept separate. The inbox displays whichever identity exists.
- **No live push.** The inbox does not poll or subscribe. The user can refresh
  the list and the selected thread.
- **Conversation list pagination is offset-based.** The message thread is
  cursor-based; the conversation list uses the existing offset API and a "Load
  more conversations" control.

## Testing

- API tests cover cursor pagination, equal timestamps, new messages between
  pages, malformed/foreign cursors, status filters, summary identity fields,
  unauthenticated requests, and cross-workspace access.
- `npm run test:web` covers the frontend data helpers: display-name and
  provider-ID fallbacks, previews, deduplication/order preservation, day keys,
  and response parsing.
- No DOM test runner is configured in this repository, so React rendering and
  browser interaction are verified manually rather than with a component test
  library. Adding one would require a new dependency and is outside this
  milestone.
