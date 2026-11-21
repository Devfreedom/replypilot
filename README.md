# ReplyPilot

ReplyPilot is an AI-assisted WhatsApp lead-management desk for small service businesses (hospitality, events, courses, retail, and local services). It helps business owners record enquiries, track follow-ups, draft replies grounded strictly in approved business services, prices, FAQs, and policies, and keep a human in control before any customer-facing message is approved or sent.

> **Pre-production notice:** Email/password authentication, workspace tenant isolation, Resend password recovery, Next.js security headers/CSP, and server-side draft guardrails are implemented, but this repository still requires HTTPS deployment, production origin/cookie review, email verification, operational monitoring, and a full security review before production use. Reply draft generation uses `GeminiReplyDraftProvider` when `GEMINI_API_KEY` is configured and falls back to the deterministic `MockReplyDraftProvider` otherwise. Meta outbound sending is a restricted test integration, disabled by default (`META_OUTBOUND_ENABLED=false`) and rejected when `NODE_ENV=production`.

## Architecture at a glance

- **Frontend (`src/`)**: Next.js 16 (App Router, React 19, TypeScript, Tailwind CSS v4) with security headers & CSP (`next.config.ts`) and `/api/:path*` rewrites to `API_ORIGIN` (default `http://127.0.0.1:4000`) so Better Auth cookies stay same-origin.
- **Backend API (`server/src/`)**: Express 5 + TypeScript + PostgreSQL (`pg`) + Zod validation. Binds to `127.0.0.1` by default.
- **Outbound Worker (`server/src/outbound/`)**: Standalone queue worker (`npm run worker:outbound`) with bounded retries, idempotency keys, `manual_review` handling for ambiguous outcomes, and workspace-scoped customer suppression checks.
- **AI Drafts (`server/src/ai/reply-draft.ts`)**: Structured `reply` / `clarify` / `abstain` decisions, server-verified `sources` snapshots, domain-neutral clarifying prompts, and single-hop HTTP `503` model fallback (`gemini-3.8-flash` → `gemini-3.1-flash-lite`).

## Quick start (local development)

### 1. Start PostgreSQL

PostgreSQL runs in Docker and persists data in the `replypilot_postgres_data` volume (host port defaults to `5433` in `.env.example` to avoid clashing with a local PostgreSQL on `5432`). Do not run `docker compose down -v` unless you intend to delete database data.

```bash
cp .env.example .env
# Replace POSTGRES_PASSWORD and set BETTER_AUTH_SECRET (see below), then:
docker compose up -d
docker compose ps
```

Generate a 32+ character `BETTER_AUTH_SECRET` without printing it into source control:

```bash
openssl rand -base64 32
```

### 2. Run migrations (and optional sample seed)

```bash
npm run db:migrate
npm run db:seed
```

### 3. Start the API, Next.js app, and outbound worker

Run each in its own terminal:

```bash
# Terminal 1 — Express API (http://127.0.0.1:4000)
npm run dev:api

# Terminal 2 — Next.js dashboard (http://localhost:3000)
npm run dev

# Terminal 3 — Optional outbound queue worker
npm run worker:outbound
```

Verify the API health check:

```bash
curl http://127.0.0.1:4000/api/health
```

Set `PORT` inline if you need a different API port (do **not** put `PORT` in `.env`, because Next.js also reads `.env` and uses `PORT`):

```bash
PORT=4100 npm run dev:api
```

Open [http://localhost:3000](http://localhost:3000) and create an account at `/sign-up`.

## Scripts, checks, and tests

```bash
# Frontend & shared checks
npm run lint           # ESLint
npx tsc --noEmit       # Next.js / frontend TypeScript check
npm run test:web       # Frontend unit & guardrail tests (src/lib/*.test.ts)
npm run build          # Next.js production build

# Backend API & worker checks
npm run typecheck:api  # Backend TypeScript check (server/tsconfig.test.json)
npm run test:api       # API & PostgreSQL integration suite (requires TEST_DATABASE_URL)
npm run build:api      # Compile server/src -> server/dist
npm run start:migrate  # Run migrations from compiled server/dist
npm run start:api      # Start compiled API
npm run start:worker   # Start compiled outbound worker
```

### API test database

Integration tests require a dedicated PostgreSQL database (`TEST_DATABASE_URL`) and refuse to run against `DATABASE_URL` or a maintenance database. Create it once:

```bash
docker compose exec db createdb -U replypilot replypilot_test
```

`npm run test:api` runs all migrations against `TEST_DATABASE_URL`, truncates tables before each test, registers real Better Auth sessions through `/api/auth/sign-up/email`, and runs without making live external API calls (Gemini, Meta, and Resend are mocked or tested via signed fixtures).

## Environment variables

API scripts load `.env` via Node.js `--env-file-if-exists=.env` (existing environment variables take precedence). See [`.env.example`](.env.example) for full documentation.

| Group | Key variables | Notes |
| --- | --- | --- |
| **Database** | `DATABASE_URL`, `TEST_DATABASE_URL` | Required for API and tests; `TEST_DATABASE_URL` must be a separate DB. |
| **Auth** | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `BETTER_AUTH_TRUSTED_PROXY_CIDRS` | Secret must be 32+ chars. `BETTER_AUTH_URL` must be `https://` in production. |
| **Password reset email** | `RESEND_API_KEY`, `AUTH_EMAIL_FROM` | Required together in production (Resend HTTP API). Omit both in local dev to log reset tokens to console. |
| **Gemini AI drafts** | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GEMINI_TIMEOUT_MS` | Optional. Omit `GEMINI_API_KEY` to use deterministic `MockReplyDraftProvider`. |
| **WhatsApp encryption** | `WHATSAPP_CREDENTIAL_ENCRYPTION_KEY`, `WHATSAPP_CREDENTIAL_KEY_VERSION` | 32-byte base64 AES-256-GCM key for encrypting stored Meta connection tokens. |
| **WhatsApp webhooks** | `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_TEST_PHONE_NUMBER_ID`, `WHATSAPP_TEST_WORKSPACE_ID` | Leave all empty to disable webhooks. Legacy pair is optional alongside multi-workspace connections. |
| **Embedded Signup v4** | `META_APP_ID`, `META_APP_SECRET`, `META_EMBEDDED_SIGNUP_CONFIG_ID`, `META_GRAPH_API_VERSION`, `META_ONBOARDING_ALLOWED_ORIGIN` | `META_APP_SECRET` must match `WHATSAPP_APP_SECRET`. Origin enforced on onboarding POST routes. |
| **Meta outbound test** | `META_OUTBOUND_ENABLED`, `META_ACCESS_TOKEN`, `WHATSAPP_SENDER_PHONE_NUMBER_ID`, `META_OUTBOUND_TEST_WORKSPACE_ID`, `META_TEST_RECIPIENT_PHONE_NUMBERS` | Restricted test-only integration. Rejected in `NODE_ENV=production`. |
| **Local failure sim** | `OUTBOUND_MOCK_FAIL_KEYS`, `OUTBOUND_MOCK_AMBIGUOUS_KEYS` | Dev-only mock worker controls; rejected in `NODE_ENV=production`. |

## Authentication, workspaces, and security

Authentication uses [Better Auth](https://www.better-auth.com/) `1.7.14` with email/password and PostgreSQL:

- Mounted in Express at `/api/auth/*splat` **before** `express.json()`.
- Sessions use HTTP-only, `SameSite=Lax` cookies (`Secure` when `BETTER_AUTH_URL` is HTTPS).
- Registration creates one personal workspace and an `owner` membership via a Better Auth database hook (with a recoverable server-side initialization fallback on the first authenticated request).
- Every business query and mutation derives `workspaceId` from the authenticated session; client-supplied `workspaceId` fields are rejected. Workspace `member` accounts have read-only access; `owner` is required for writes.
- Password reset (`/forgot-password` and `/reset-password`) issues single-use, 15-minute tokens delivered via Resend in production (or logged locally in dev) and scrubs the reset token from the browser URL after reading it.
- Reverse-proxy IP resolution uses `BETTER_AUTH_TRUSTED_PROXY_CIDRS` so Better Auth rate limits are keyed accurately per client IP.

### Legacy development workspace bootstrap

Existing pre-auth development data stays in `Legacy development workspace` (`00000000-0000-4000-8000-000000000001`) until explicitly assigned via the guarded local CLI:

```bash
npm run db:bootstrap-legacy -- --user-email owner@example.test --confirm
# or:
npm run db:bootstrap-legacy -- --user-id <uuid> --confirm
```

The CLI refuses to run without `--confirm`, refuses unknown accounts, and refuses if the legacy workspace already has a member.

## Database migrations (`001`–`021`)

All migrations live in `server/src/db/migrations/` and are idempotent via `npm run db:migrate`:

- `001`–`005`: `leads`, `business_profiles`, `catalogue_entries` (safe-integer `BIGINT` minor currency units), `knowledge_entries`, nullable profile `currency_code` / phone country, and `reply_drafts` with `sources` snapshots.
- `006`–`007`: Better Auth tables, `workspaces`, `workspace_memberships`, and non-destructive `workspace_id` tenant scoping with composite foreign keys.
- `008`–`010`: WhatsApp inbox (`whatsapp_conversations`, `whatsapp_messages`), `customers`, and first-seen timestamps.
- `011`–`016`: Outbound messaging queue, `manual_review` state, send-time thread ordering, Meta outbound support, delivery-event audit logs, customer opt-out suppressions, and worker heartbeats.
- `017`–`019`: Multi-workspace `whatsapp_connections` (AES-256-GCM encrypted credentials), `whatsapp_onboarding_sessions` (SHA-256 nonce hashes), and global partial unique ownership per active `phone_number_id`.
- `020`–`021`: Normalized E.164 lead numbers + manual/auto conversation linking, and persisted `reply_drafts.decision` (`'reply' | 'clarify' | 'abstain'`).

*(If upgrading a pre-Milestone 14A database where the same `phone_number_id` existed in multiple workspaces, migration `019` fails safely with diagnostics. Review and run `server/src/db/remediation/demote_duplicate_whatsapp_connections.sql` before re-running `npm run db:migrate`.)*

## Reply drafts, grounding, and guardrails

Reply draft generation uses `GeminiReplyDraftProvider` when `GEMINI_API_KEY` is set and falls back to `MockReplyDraftProvider` otherwise. Neither provider ever sends a customer message automatically.

1. **Deterministic business fact selection (`server/src/business/context.ts`)**: Loads the workspace profile plus **active** catalogue and FAQ/policy entries using keyword matching (not semantic retrieval).
2. **Grounding & prompt rules (`server/src/ai/reply-draft.ts`)**:
   - Only facts inside `<approved_business_facts>` may be quoted; billing units (e.g., `per night`, `per hour`) are preserved verbatim.
   - When date/time availability is unverified, pricing uses neutral phrasing (`is priced at` / `costs`) instead of `is available at`, and replies stay scoped to what the customer asked.
   - Missing details use domain-neutral labels (`Preferred date or schedule`, `Preferred time or availability window`, `Specific booking, order, or service details`) and clarifying drafts ask **one** direct question rather than guessing.
3. **Persisted `decision` & server-side abstention gate**:
   - `'reply'`: Fully grounded with no unresolved mandatory missing information.
   - `'clarify'`: Missing customer or business details remain (`mergeMandatoryMissingInfo` deterministically enforces this when required prices/policies or actionable booking/pricing/availability details are unverified).
   - `'abstain'`: Out-of-domain enquiry with zero grounded facts. The draft stores a manual-review handoff note, and **Approve / Approve & queue / Manual send** are blocked in both the UI and API (`409 draft_abstained`) until a human edits and saves the reply text.
4. **Server-verified snapshots & approval lifecycle**:
   - The server replaces provider-cited fact IDs with canonical values from the workspace's active facts and snapshots them onto the draft.
   - Editing draft text resets status to `draft` and clears `approvedAt`. Sent or in-flight drafts are protected from overwrite.

## WhatsApp integration, inbox, and outbound queue

### Inbound webhooks & inbox (`/whatsapp`)

- **`GET /api/webhooks/whatsapp`**: Meta verification challenge using constant-time comparison against `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
- **`POST /api/webhooks/whatsapp`**: Pre-buffer `X-Hub-Signature-256` format validation + HMAC-SHA256 verification over exact raw bytes (`3mb` body limit, `1,000`-item array bounds, numeric `phone_number_id` check). Supports phone-number and BSUID senders, deduplicates by `(workspace_id, provider_message_id)`, prevents concurrent duplicate lead-to-conversation linking (`FOR UPDATE` row locking), and processes delivery-status updates idempotently without allowing older timestamps to regress newer states.
- **Customer suppression**: Explicit opt-outs persist workspace-scoped rows in `customer_suppressions`, immediately cancel `queued` outbound rows, and return `409 customer_suppressed` if a user attempts to approve-and-queue or manually send to a suppressed customer.

### Multi-workspace Embedded Signup v4 (`/settings`)

Workspace owners can connect a Meta WhatsApp Business account via **Business settings → WhatsApp & approval** (`GET /api/whatsapp/onboarding/config`, `POST /api/whatsapp/onboarding/sessions`, `POST /api/whatsapp/onboarding/complete`, `POST /api/whatsapp/connections/:connectionId/verify`). State-changing onboarding routes enforce `META_ONBOARDING_ALLOWED_ORIGIN` and per-user/workspace rate limits.

### Outbound queue & delivery dashboard (`/outbound`, `/delivery`)

- Approved drafts follow the workspace send policy (`approve_only` or `approve_and_send`) with optional per-draft overrides.
- The standalone worker (`npm run worker:outbound`) claims queued rows, enforces the 24-hour customer-service window and suppression checks, preserves stable idempotency keys across retries, and moves ambiguous provider outcomes to `manual_review`.
- `/delivery` surfaces provider configuration status (without secrets), worker heartbeats, queue counts, customer suppressions, and audited delivery webhook events.

### Local signed webhook testing

You can test inbound messages and delivery-status updates locally without contacting Meta:

```bash
set -a; . ./.env; set +a

# 1. Verify webhook challenge
curl -i "http://127.0.0.1:4000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${WHATSAPP_WEBHOOK_VERIFY_TOKEN}&hub.challenge=local-challenge"

# 2. Send a signed inbound text fixture
BODY='{"object":"whatsapp_business_account","entry":[{"id":"waba-local-test","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"15550783881","phone_number_id":"'"${WHATSAPP_TEST_PHONE_NUMBER_ID}"'"},"contacts":[{"wa_id":"16505551234","profile":{"name":"Local Test Customer"}}],"messages":[{"from":"16505551234","id":"wamid.local.'"$(date +%s)"'","timestamp":"'"$(date +%s)"'","type":"text","text":{"body":"Hello from a signed local fixture"}}]}}]}]}'
SIGNATURE=$(BODY="$BODY" node -e 'const { createHmac } = require("node:crypto"); process.stdout.write("sha256=" + createHmac("sha256", process.env.WHATSAPP_APP_SECRET).update(process.env.BODY, "utf8").digest("hex"));')

curl -i -X POST "http://127.0.0.1:4000/api/webhooks/whatsapp" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: ${SIGNATURE}" \
  --data-binary "$BODY"
```

## Current limitations

- **Email verification & team admin**: Email verification, team member invitations, role management, and account deletion UI/API are not implemented (`member` accounts are read-only).
- **WhatsApp production scope**: Embedded Signup v4 is covered by mocked tests but has not been verified end-to-end against a live Meta Tech Provider / App Review setup. Template messaging, media downloads/transcription, and automated replies without human approval are not implemented.
- **Retrieval**: Business fact selection uses deterministic keyword matching, not semantic search or embeddings.
- **Scaling**: Onboarding rate-limit counters live in-process; multi-instance deployments require a shared store and trusted proxy CIDRs.
