This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## API, authentication, and local PostgreSQL

> **Not production-ready warning:** email/password authentication and workspace isolation are implemented, but this application still needs HTTPS, production origin and cookie review, email verification, password recovery, deployment hardening, operational monitoring, and a complete security review before production use. Reply generation remains mock-only and there is no WhatsApp integration. Do not use real customer or business data yet.

The Express API is a separate development service. It binds to `127.0.0.1` and must not be exposed publicly. The browser dashboard is a separate Next.js app; it proxies `/api/*` requests to `API_ORIGIN`, which defaults to `http://127.0.0.1:4000`. This keeps Better Auth and business API requests same-origin from the browser, so session cookies flow through the rewrite.

### Authentication architecture

Authentication uses [Better Auth](https://www.better-auth.com/) `1.7.14` with its official email/password and PostgreSQL integration. Better Auth owns user records, password hashing, session tokens, session expiry, session invalidation, origin checks, and rate limiting. The repository does not implement its own password hashing, session tokens, or JWTs.

- The Better Auth handler is mounted in Express at `/api/auth/*splat` **before** `express.json()`, so Better Auth receives the raw request body.
- Browser requests reach it through the existing Next.js `/api/:path*` rewrite.
- Sessions are HTTP-only, `SameSite=Lax` cookies. Better Auth uses `Secure` cookies when `BETTER_AUTH_URL` is HTTPS.
- Auth POST requests must come from a trusted origin. Local development trusts `http://localhost:3000` and `http://127.0.0.1:3000`; configure production origins explicitly.
- Better Auth applies its built-in sign-in/sign-up rate limits. The production app leaves rate limiting enabled.
- Signing out invalidates the server-side session; the browser session cookie alone cannot be reused.

Registration creates one personal workspace and an owner membership through a Better Auth database hook. If that hook is interrupted, the first authenticated private request runs a recoverable workspace initialization path. The server never accepts a workspace ID from the browser as proof of ownership.

The browser uses `src/lib/auth-client.ts`, an authenticated workspace context, and a protected app wrapper. These provide redirects and a clear loading/unauthenticated state. They are user-experience controls only; every private API request is authorized again on the server.

### Start the database

PostgreSQL runs in Docker and stores data in the named volume declared as `replypilot_postgres_data` (Compose prefixes it with the project name). The host port defaults to `5433` in `.env.example` to avoid clashing with an existing PostgreSQL on `5432`. Do not run `docker compose down -v` unless you intend to delete the database data.

```bash
cp .env.example .env
# Replace the placeholder password in .env, then:
docker compose up -d
docker compose ps
```

Apply migrations and optionally load the five fictional sample leads:

```bash
npm run db:migrate
npm run db:seed
```

The migrations create the `leads` table plus the business-profile, catalogue, knowledge-base, and saved-draft tables. Migration `003_limit_catalogue_price.sql` adds the safe-integer price constraint without changing existing leads. Migration `004_add_profile_phone_country_currency.sql` adds nullable profile phone-country and currency columns without defaults or backfills, so existing profiles remain unconfigured until the owner saves a choice. Migration `005_create_reply_drafts.sql` adds the `reply_drafts` table for saved drafts and their server-generated business-fact snapshots.

Migration `006_create_auth_and_workspaces.sql` adds the Better Auth tables (`auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`), `workspaces`, and `workspace_memberships` with UUID keys, owner/member roles, foreign keys, indexes, and a partial unique index that permits exactly one default workspace per user.

Migration `007_scope_business_data_to_workspaces.sql` is the non-destructive tenant migration. It creates the explicit legacy workspace `00000000-0000-4000-8000-000000000001` (`Legacy development workspace`), adds `workspace_id` to leads, profiles, catalogue, knowledge, and reply drafts, backfills existing rows to that workspace, then adds non-null constraints, foreign keys, and indexes. Drafts receive a composite `(lead_id, workspace_id)` foreign key so a draft cannot reference a lead from another workspace. Existing IDs, values, follow-up dates, approval status, and source snapshots are preserved. The old single-profile `singleton` column is replaced by a unique profile per workspace.

Running migrations again through `npm run db:migrate` is a no-op; existing data is preserved. The seed is idempotent and requires the explicit workspace supplied by its CLI. It uses fixed UUIDs and `ON CONFLICT DO NOTHING`, so existing records are not overwritten.

Environment variables are loaded by Node.js `--env-file-if-exists=.env` in the API scripts. Values already set in the environment take precedence, and no dotenv dependency is needed. The API validates `DATABASE_URL`, `PORT`, `NODE_ENV`, and `BETTER_AUTH_SECRET` (32+ characters) at startup. Production also requires an HTTPS `BETTER_AUTH_URL`. Generate a secret without printing it into source control:

```bash
openssl rand -base64 32
```

Put the generated value only in your local `.env` (or your deployment's secret store), then set `BETTER_AUTH_URL` to the public frontend origin. Add any additional production frontend origins to `BETTER_AUTH_TRUSTED_ORIGINS`; do not add wildcard or attacker-controlled origins.

### Run the API

```bash
npm run dev:api
curl http://127.0.0.1:4000/api/health
```

In a second terminal, start the Next.js app. With the default `API_ORIGIN`, its dashboard can then use the local API through same-origin `/api/*` requests:

```bash
npm run dev
```

Set `PORT` inline to use a different API port:

```bash
PORT=4100 npm run dev:api
```

Do not put `PORT` in `.env`: Next.js loads the same file and would also try to use that port.

Build, start, type-check, and test the API independently of the Next.js app:

```bash
npm run build:api
npm run start:api
npm run typecheck:api
npm run test:api
```

### API test database

Integration tests require a dedicated PostgreSQL database and will refuse to run against the development database. Both `DATABASE_URL` and `TEST_DATABASE_URL` must be set; the scripts load them from `.env`.

Create the test database once (it is not deleted by any script):

```bash
docker compose exec db createdb -U replypilot replypilot_test
```

Run this only once; skip it if the database already exists.

The test suite runs migrations against `TEST_DATABASE_URL` and truncates its auth, workspace, and business tables before each test. It then registers a real Better Auth account through `/api/auth/sign-up/email` and uses the returned HTTP-only session cookie for authenticated API calls; there is no authentication bypass. The shared test app disables rate limiting to avoid tripping sign-up limits between unrelated tests, while a dedicated app instance verifies the real Better Auth limit. Tests cover session creation, sign-in/sign-out, expiry, origin checks, workspace creation, bootstrap guards, migration backfill, cross-workspace reads/writes/deletes/approvals/regeneration, source snapshots, database constraints, and member read-only behavior.

The suite fails with a clear error if `TEST_DATABASE_URL` is missing, points at the same database as `DATABASE_URL`, or points at a maintenance database. Tests are never silently skipped.

### Legacy development workspace bootstrap

Existing development data is not automatically attached to the first person who registers. It stays in the explicit legacy workspace until a local operator assigns it to a chosen, already-registered account with the guarded CLI. There is no public HTTP endpoint for this operation.

1. Back up the development database if the data matters.
2. Apply migrations with `npm run db:migrate`.
3. Start the API and Next.js app, then create the intended account through `/sign-up`.
4. Find the account ID if needed: `SELECT id, email FROM auth_users WHERE email = 'owner@example.test';`
5. Run exactly one of the following with the real account ID or email:

```bash
npm run db:bootstrap-legacy -- --user-id <uuid> --confirm
npm run db:bootstrap-legacy -- --user-email owner@example.test --confirm
```

The command refuses to run without `--confirm`, refuses both selectors at once, refuses an unknown account, and refuses if the legacy workspace already has any member. It makes the legacy workspace the selected account's default and requires a deliberately one-time decision. Re-running it never reassigns ownership. This is a local-development procedure only; production account administration is not implemented.

### Endpoints

All business endpoints below require a valid Better Auth session and workspace membership. Unauthenticated requests return `401 {"error":"Authentication required"}`. Authenticated members can read business data, but writes require the `owner` role and return `403 {"error":"Forbidden"}` otherwise. The server derives the workspace from the session and rejects request bodies that include a `workspaceId` or other unknown fields.

| Method | Path | Behaviour |
| --- | --- | --- |
| `POST` | `/api/auth/sign-up/email` | Better Auth email/password registration with `email`, `password`, and `name`. Creates a session cookie and, through the database hook, an owner workspace. Returns `422` for an existing email and `400` for invalid input. |
| `POST` | `/api/auth/sign-in/email` | Better Auth email/password sign-in. Returns a session cookie, `401` for invalid credentials, `403` for an untrusted/missing origin, and `429` when rate-limited. |
| `POST` | `/api/auth/sign-out` | Invalidates the server-side session and clears the session cookie. |
| `GET` | `/api/auth/get-session` | Returns the current Better Auth session and user, or no session when unauthenticated. |
| `GET` | `/api/workspace` | Requires a session. Returns the authenticated user, the resolved default workspace, and the member's `owner`/`member` role. |
| `GET` | `/api/health` | `200 {"status":"ok"}` when PostgreSQL responds; `503 {"status":"unavailable"}` otherwise. Public. |
| `GET` | `/api/leads` | `200 {"leads":[...]}` for the session workspace, ordered newest first. |
| `POST` | `/api/leads` | Accepts `name`, `service`, and `lastMessage`; optional `channel`, `status`, and `nextFollowUpAt`. Returns `201 {"lead":{...}}`. Defaults: `Manual`, `New`. |
| `PATCH` | `/api/leads/:id` | Accepts `{ "status": "New" \| "Contacted" \| "Quoted" \| "Booked" }`. Returns the updated lead, `400` for malformed input, or `404` for an unknown valid UUID. |
| `POST` | `/api/leads/:id/draft-reply` | Returns a non-persistent mock demonstration analysis and suggested reply for an existing lead. Kept for compatibility; the response omits the saved-draft fields and sources. Returns `400` for a malformed ID or `404` for an unknown valid UUID. |
| `POST` | `/api/leads/:id/reply-drafts` | Generates and saves a mock draft with a server-generated business-fact snapshot. Returns `201 {"draft":{...}}`. Optional body `{"draftId":"..."}` regenerates that saved draft in place and returns `200`; it must belong to the lead. |
| `GET` | `/api/leads/:id/reply-drafts` | `200 {"drafts":[...]}` for that lead, newest first. Returns `404` for an unknown lead. |
| `PATCH` | `/api/leads/:leadId/reply-drafts/:draftId` | Accepts `{"draftReply":"..."}` to save edited text, or `{"status":"approved"\|"draft"}` to change review status. Text edits return the draft to `draft`; approving records `approvedAt`. Returns `200 {"draft":{...}}`, `400`, or `404`. |
| `GET` | `/api/business/profile` | `200 {"profile":{...}}`, or `200 {"profile":null}` when no profile has been created. |
| `POST` | `/api/business/profile` | Creates the single business profile for the session workspace. Returns `201 {"profile":{...}}`, `400` for invalid data, or `409` if that workspace already has a profile. |
| `PATCH` | `/api/business/profile` | Replaces the profile's editable fields using the same body shape as creation. Returns the updated profile, `400`, or `404` when no profile exists. |
| `GET` | `/api/business/catalogue` | `200 {"entries":[...]}` including active and inactive entries, newest first. |
| `POST` | `/api/business/catalogue` | Creates a catalogue entry. Returns `201 {"entry":{...}}` or `400`. |
| `PATCH` | `/api/business/catalogue/:id` | Replaces the entry's editable fields. Returns the updated entry, `400`, or `404`. |
| `DELETE` | `/api/business/catalogue/:id` | Deactivates the entry rather than deleting it. Returns `200 {"entry":{...}}` with `isActive:false`, or `404`. |
| `GET` | `/api/business/knowledge` | `200 {"entries":[...]}` including active and inactive entries, newest first. |
| `POST` | `/api/business/knowledge` | Creates an FAQ or policy entry. Returns `201 {"entry":{...}}` or `400`. |
| `PATCH` | `/api/business/knowledge/:id` | Replaces the entry's editable fields. Returns the updated entry, `400`, or `404`. |
| `DELETE` | `/api/business/knowledge/:id` | Deactivates the entry rather than deleting it. Returns `200 {"entry":{...}}` with `isActive:false`, or `404`. |

Each lead response field is: `id`, `name`, `service`, `channel`, `status`, `lastMessage`, `nextFollowUpAt`, `createdAt`, and `updatedAt`. `nextFollowUpAt` is an ISO 8601 timestamp with an explicit offset or `null`.

Database errors are not returned to clients. Validation responses contain field-level messages without echoing submitted values. Malformed IDs and bodies return `400`.

### Business profile and knowledge base

The `/settings` page in the dashboard manages one development business profile, its product/service catalogue, and its approved FAQs and policies. Every displayed action uses the API; no sample business details are inserted automatically.

#### Business profile

The profile stores `businessName`, `businessDescription`, optional `contactEmail`, `contactPhone`, and `contactPhoneCountry`, an optional `businessAddress`, an IANA `timezone` (default `Africa/Lagos`), `openingHours`, and an optional profile-level `currencyCode`. Create it with:

```http
POST /api/business/profile
Content-Type: application/json
```

```json
{
  "businessName": "Lagos Light Studio",
  "businessDescription": "Wedding and portrait photography.",
  "contactEmail": "hello@example.com",
  "contactPhone": "+2348031234567",
  "contactPhoneCountry": "NG",
  "businessAddress": "12 Example Road, Lagos",
  "timezone": "Africa/Lagos",
  "openingHours": [
    { "day": "monday", "opensAt": "09:00", "closesAt": "17:00" }
  ],
  "currencyCode": "NGN"
}
```

A successful response wraps the stored record:

```json
{
  "profile": {
    "id": "500291a5-edb5-4a27-b9f5-06e41b3fc2ee",
    "businessName": "Lagos Light Studio",
    "businessDescription": "Wedding and portrait photography.",
    "contactEmail": "hello@example.com",
    "contactPhone": "+2348031234567",
    "contactPhoneCountry": "NG",
    "businessAddress": "12 Example Road, Lagos",
    "timezone": "Africa/Lagos",
    "openingHours": [
      { "day": "monday", "opensAt": "09:00", "closesAt": "17:00" }
    ],
    "currencyCode": "NGN",
    "createdAt": "2026-01-01T08:00:00.000Z",
    "updatedAt": "2026-01-01T08:00:00.000Z"
  }
}
```

`openingHours` is a JSON array in PostgreSQL. Each entry has a lowercase `day` (`monday` through `sunday`), `opensAt`, and `closesAt` in 24-hour `HH:MM` format. Each weekday may appear only once, closing time must be after opening time, and a maximum of seven entries is allowed. The current limitation is **one same-day interval per weekday**: overnight spans and split shifts are not represented. An empty array means no published hours.

The `/settings` page edits this same array through a Monday–Sunday visual schedule with Open/Closed toggles and native time inputs. Closed days are omitted from the saved payload; their times remain in the form only while the current edit session is open. A new profile starts with every day closed and no assumed hours. The optional **Copy Monday to weekdays** action updates Tuesday through Friday locally and does not save by itself. Duplicate saved days are shown explicitly and preserved until you choose to replace them; malformed or overnight saved times are flagged for correction rather than silently replaced.

The contact-phone control offers exactly 50 curated countries. Calling codes come from `libphonenumber-js` metadata, and the user enters only the national number; the dashboard parses and normalizes it before saving the E.164 value in `contactPhone`. The selected ISO alpha-2 code is stored separately in `contactPhoneCountry` so shared calling codes such as `+1` can be restored reliably. A blank phone remains valid. Existing international numbers are parsed when reliable; unreadable or mismatched saved values stay visible with a warning and must be confirmed or replaced before the profile can be saved. The API validates and normalizes phone numbers too, rejects invalid values, and rejects a phone-country code that does not match the number.

The timezone field is a searchable, grouped combobox populated from `Intl.supportedValuesOf("timeZone")` plus `UTC`, with a small fallback list and any valid saved alias. Search matches region and city text. The dashboard does not infer a timezone from the device, locale, phone country, or estimated location; a new profile requires an explicit selection. The API still accepts the existing `Africa/Lagos` default when `timezone` is omitted for backward compatibility.

The profile-level `currencyCode` is nullable. Migration `004` adds it without a default or backfill, so existing profiles show an honest **Not configured** state. The dashboard builds one selectable option per supported ISO 4217 code from the runtime currency list, with readable names and country search using `country-to-currency`; it does not guess a currency from locale, phone country, or location. Changing the business currency never rewrites existing catalogue prices or currencies. New catalogue entries start with the profile currency as their default; when the profile has no currency configured, the catalogue's existing `NGN` API fallback remains.

Timezones must be valid IANA identifiers. Invalid timezones, invalid phone numbers, invalid phone countries, invalid currency codes, duplicate weekdays, malformed times, and closing times before opening times are rejected with `400`.

#### Products and services

```http
POST /api/business/catalogue
Content-Type: application/json
```

```json
{
  "name": "Wedding photography",
  "description": "Full-day wedding coverage.",
  "priceMinor": 150000,
  "currencyCode": "NGN",
  "availabilityNotes": "Weekends by arrangement.",
  "isActive": true
}
```

```json
{
  "entry": {
    "id": "4a687f75-061f-4c30-aa66-ef4534a5c133",
    "name": "Wedding photography",
    "description": "Full-day wedding coverage.",
    "priceMinor": 150000,
    "currencyCode": "NGN",
    "isActive": true,
    "availabilityNotes": "Weekends by arrangement.",
    "createdAt": "2026-01-01T08:00:00.000Z",
    "updatedAt": "2026-01-01T08:00:00.000Z"
  }
}
```

Price rules:

- `priceMinor` is an optional integer in minor currency units, stored as PostgreSQL `BIGINT`. It is never a floating-point value and no floating-point money arithmetic is used.
- Because the API transports prices as JSON numbers, values must be safe integers. The accepted range is `0` through `9007199254740991` (`Number.MAX_SAFE_INTEGER`); larger, negative, fractional, or non-numeric values are rejected with `400`. The database also enforces the safe limit. If a database created by an earlier build already contains a larger price, migration `003` refuses to apply rather than deleting or rounding it; correct that row manually first.
- Omit `priceMinor` or send `null` when the price is not fixed. The API returns `null` and the dashboard displays “Price on request”; no price is invented.
- `currencyCode` defaults to `NGN` in the API. The dashboard pre-fills new catalogue entries with the profile-level business currency when one is configured, otherwise with `NGN`; existing entries keep their saved currency. It must be an **uppercase ISO 4217 currency code** present in the runtime's ICU currency list (for example `NGN`, `USD`, `GBP`, `KES`, `JPY`). The list is maintained with Node.js ICU data rather than a hand-written regex; it excludes non-currency codes such as `ZZZ`, `XXX`, and `XTS`, though it may still include a recently replaced currency until the ICU data is updated. Lowercase and malformed values are rejected. The same validation applies to create and update.

#### FAQs and policies

```http
POST /api/business/knowledge
Content-Type: application/json
```

```json
{
  "title": "Do you travel for weddings?",
  "answer": "Travel within the city is included.",
  "entryType": "faq",
  "isActive": true
}
```

`entryType` is `faq` or `policy`. Answers are approved business text and are limited to 4,000 characters. Deactivating an entry keeps it for review but removes it from future reply context. Editing an inactive entry with `isActive: true` reactivates it.

### Reply drafts, provenance, and owner approval

Draft generation uses a local deterministic mock provider only. It does not call a live AI service, require credentials, or send a customer message. The legacy `POST /api/leads/:id/draft-reply` endpoint keeps its original non-persistent response contract and shares the same generation logic.

The saved-draft endpoints persist reviewable drafts:

- `POST /api/leads/:id/reply-drafts` generates and saves a new draft, or regenerates an existing one when the optional body is `{"draftId":"<uuid>"}`.
- `GET /api/leads/:id/reply-drafts` lists that lead's saved drafts, newest first.
- `PATCH /api/leads/:leadId/reply-drafts/:draftId` saves edited text or changes the review status.

A saved draft response is wrapped as `{"draft":{...}}`:

```json
{
  "draft": {
    "id": "d0000000-0000-4000-8000-000000000001",
    "leadId": "10000000-0000-4000-8000-000000000001",
    "intent": "pricing",
    "summary": "Enquiry from Sarah Musa about Wedding photography: How much is wedding photography?",
    "missingInformation": ["Event date", "Event location", "What the customer needs"],
    "draftReply": "Hi Sarah Musa, ...",
    "provider": "mock",
    "isDemo": true,
    "status": "draft",
    "sources": [
      {
        "id": "c0000000-0000-4000-8000-000000000001",
        "type": "catalogue",
        "title": "Wedding photography",
        "content": "Full-day wedding coverage.\nPrice: NGN 1,500.00\nAvailability: Weekends by arrangement.",
        "reason": "Keyword match on \"wedding\" and \"photography\". Keyword matching only, not semantic retrieval; verify that this fact is relevant.",
        "priceMinor": 150000,
        "currencyCode": "NGN"
      }
    ],
    "approvedAt": null,
    "createdAt": "2026-03-01T09:00:00.000Z",
    "updatedAt": "2026-03-01T09:00:00.000Z"
  }
}
```

`source.type` is `catalogue`, `faq`, or `policy`. The `sources` snapshot is generated server-side from the active approved facts selected for that generation. Draft creation and regeneration requests do not accept source facts from the browser; any extra body keys are rejected. The provider reports which context facts it used, but the API replaces provider-supplied titles, text, prices, and reasons with canonical values from the server-side context. A provider cannot claim a fact from outside the selected context.

Draft status starts as `draft` with `approvedAt: null`. Approval with `{"status":"approved"}` records the timestamp. Saving edited text returns the draft to `draft` and clears approval. Regeneration updates the same draft in place, refreshes the business-fact snapshot, and resets approval because the content changed. `{"status":"draft"}` explicitly returns an approved draft to draft status. Editing and approving in the same request is rejected; save the edited text first, then approve it as a separate review action.

Approval is a review status only. It is not a legal signature, does not prove that edited text is factually correct, and does not send a WhatsApp, email, Instagram, or other customer message. The owner must still copy and send any message manually.

#### How business facts are selected and snapshotted

Before drafting, `server/src/business/context.ts` loads the business profile, only **active** catalogue entries, and only **active** FAQ/policy entries. It builds enquiry text from the lead's `service` and `lastMessage` and keeps entries whose name/description or title/answer share a word of at least three characters, after ignoring common stop words. The selection is deterministic keyword matching, **not semantic AI retrieval**: different wording can miss a relevant entry, and shared wording can produce a false match. Reasons in `sources` describe that keyword match; they do not prove that a claim is supported.

The mock provider includes matched approved catalogue facts and FAQ/policy answers in the suggested reply and reports only the facts actually appended to that reply. It never invents a price, availability, opening hours, refund right, booking term, or other policy: if a matching entry has no price, it says the price needs confirmation; if no approved policy is supplied, it asks for the missing detail or adds it to `missingInformation`.

The saved `sources` snapshot preserves the original approved values even if a catalogue or knowledge entry is later edited or deactivated. It is evidence of what was used at generation time, not a claim that those facts are still current. The dashboard labels it accordingly. Snapshots do not contain API credentials or unnecessary customer information.

The Draft Reply dialog shows the enquiry summary, missing information, **Business information used**, editable text, demo labeling, review status, save/regenerate/copy/approve actions, and previously saved drafts for the lead. Reopening it restores the latest saved text, snapshot, and status; if the lead has no saved draft, it generates and saves one. Editing warns that changes may no longer be supported by the original facts.

### Manual authentication and isolation checks

These checks verify the browser flow and the server boundary. Use fictional data.

1. Configure `.env` from `.env.example` with a unique `BETTER_AUTH_SECRET`, then start PostgreSQL, the API, and Next.js as described above.
2. Visit `http://localhost:3000` in a private window. The dashboard must redirect to `/sign-in`; the private API endpoints must return `401` when called without a session cookie.
3. Create an account through `/sign-up`. You should land on an owner workspace with no leads and no business profile. The sidebar must show the account email, workspace name, `Workspace owner`, and a working sign-out control.
4. Add a lead and some business details, then open a saved draft. Confirm the draft uses only facts you saved and that approval remains a manual review action.
5. Sign out. The old page must no longer load private data, and signing back in must restore the same workspace.
6. Create a second account in a separate private window. Confirm it has a different workspace UUID and cannot see the first account's leads, profile, catalogue, knowledge entries, or drafts. Direct requests using the first account's record IDs must return `404` or `403`, not another workspace's data.
7. If you need the legacy development records, follow the guarded bootstrap procedure above and confirm they appear in the selected account's workspace without ID or value changes.

### Limitations and production work still required

- Email verification and password recovery are not configured. Better Auth's password reset flow needs an email provider and deliberate templates before it can be enabled.
- Workspace membership administration is deliberately minimal. Registration creates one owner workspace, the owner/member roles are enforced server-side, and members are read-only in this milestone. There is no invitation, member-management, role-change, or account-deletion UI/API.
- The legacy workspace is assigned only by the guarded local CLI. There is no public bootstrap endpoint, first-user claim, or production admin console.
- Production requires HTTPS, `BETTER_AUTH_URL` with an HTTPS origin, a secret from a deployment secret store, explicit trusted origins, secure reverse-proxy/header handling, backups, and a security review. The API currently binds to `127.0.0.1` for local development.
- Better Auth's default rate-limit storage and the Express process model need review before horizontal scaling. Use a shared, reviewed rate-limit store if multiple API instances are deployed.
- Reply generation is still a deterministic mock. There is no live AI provider, WhatsApp integration, webhook processing, scheduling, or customer-message sending. Approval never sends a message.
- There is no audit log for business-record changes, no account recovery support workflow, and no automated backup/restore verification. Do not treat passing tests as evidence that the application is production-ready.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
