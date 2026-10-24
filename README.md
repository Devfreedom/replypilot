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

## API and local PostgreSQL

> **Development-only warning:** the API has no authentication or tenant isolation. The business-profile, catalogue, and knowledge-base endpoints expose and accept business data without access control. Do not expose this application publicly or use it with real customer or business data until authentication and tenant isolation are implemented.

The Express API is a separate development service. It binds to `127.0.0.1` and must not be exposed publicly. It has no authentication or WhatsApp integration. The browser dashboard is a separate Next.js app; it proxies `/api/*` requests to `API_ORIGIN`, which defaults to `http://127.0.0.1:4000`.

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

The migrations create the `leads` table plus the business-profile, catalogue, and knowledge-base tables. Migration `003_limit_catalogue_price.sql` adds the safe-integer price constraint without changing existing leads. Running migrations again is a no-op; existing data is preserved. The seed is idempotent: running `npm run db:seed` again does not create duplicates. It uses fixed UUIDs and `ON CONFLICT DO NOTHING`, so existing records are not overwritten.

Environment variables are loaded by Node.js `--env-file-if-exists=.env` in the API scripts. Values already set in the environment take precedence, and no dotenv dependency is needed. The API validates `DATABASE_URL`, `PORT`, and `NODE_ENV` at startup.

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

The test suite runs migrations against `TEST_DATABASE_URL` and truncates its `leads`, `business_profiles`, `catalogue_entries`, and `knowledge_entries` tables before each test. It fails with a clear error if `TEST_DATABASE_URL` is missing, points at the same database as `DATABASE_URL`, or points at a maintenance database. Tests are never silently skipped.

### Endpoints

| Method | Path | Behaviour |
| --- | --- | --- |
| `GET` | `/api/health` | `200 {"status":"ok"}` when PostgreSQL responds; `503 {"status":"unavailable"}` otherwise. |
| `GET` | `/api/leads` | `200 {"leads":[...]}` ordered newest first. |
| `POST` | `/api/leads` | Accepts `name`, `service`, and `lastMessage`; optional `channel`, `status`, and `nextFollowUpAt`. Returns `201 {"lead":{...}}`. Defaults: `Manual`, `New`. |
| `PATCH` | `/api/leads/:id` | Accepts `{ "status": "New" \| "Contacted" \| "Quoted" \| "Booked" }`. Returns the updated lead, `400` for malformed input, or `404` for an unknown valid UUID. |
| `POST` | `/api/leads/:id/draft-reply` | Returns a non-persistent mock demonstration analysis and suggested reply for an existing lead. Returns `400` for a malformed ID or `404` for an unknown valid UUID. |
| `GET` | `/api/business/profile` | `200 {"profile":{...}}`, or `200 {"profile":null}` when no profile has been created. |
| `POST` | `/api/business/profile` | Creates the single development business profile. Returns `201 {"profile":{...}}`, `400` for invalid data, or `409` if a profile already exists. |
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

The profile stores `businessName`, `businessDescription`, optional `contactEmail`, `contactPhone`, and `businessAddress`, an IANA `timezone` (default `Africa/Lagos`), and `openingHours`. Create it with:

```http
POST /api/business/profile
Content-Type: application/json
```

```json
{
  "businessName": "Lagos Light Studio",
  "businessDescription": "Wedding and portrait photography.",
  "contactEmail": "hello@example.com",
  "contactPhone": "+234 800 000 0000",
  "businessAddress": "12 Example Road, Lagos",
  "timezone": "Africa/Lagos",
  "openingHours": [
    { "day": "monday", "opensAt": "09:00", "closesAt": "17:00" }
  ]
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
    "contactPhone": "+234 800 000 0000",
    "businessAddress": "12 Example Road, Lagos",
    "timezone": "Africa/Lagos",
    "openingHours": [
      { "day": "monday", "opensAt": "09:00", "closesAt": "17:00" }
    ],
    "createdAt": "2026-01-01T08:00:00.000Z",
    "updatedAt": "2026-01-01T08:00:00.000Z"
  }
}
```

`openingHours` is a JSON array in PostgreSQL. Each entry has a lowercase `day` (`monday` through `sunday`), `opensAt`, and `closesAt` in 24-hour `HH:MM` format. Each weekday may appear only once, closing time must be after opening time, and a maximum of seven entries is allowed. The current limitation is **one same-day interval per weekday**: overnight spans and split shifts are not represented. An empty array means no published hours.

The `/settings` page edits this same array through a Monday–Sunday visual schedule with Open/Closed toggles and native time inputs. Closed days are omitted from the saved payload; their times remain in the form only while the current edit session is open. A new profile starts with every day closed and no assumed hours. The optional “Copy Monday to weekdays” action updates Tuesday through Friday locally and does not save by itself. Duplicate days or other saved values that the editor cannot represent are shown explicitly and preserved rather than silently discarded.

Timezones must be valid IANA identifiers. Invalid timezones, duplicate weekdays, malformed times, and closing times before opening times are rejected with `400`.

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
- `currencyCode` defaults to `NGN`. It must be an **uppercase ISO 4217 currency code** present in the runtime's ICU currency list (for example `NGN`, `USD`, `GBP`, `KES`, `JPY`). The list is maintained with Node.js ICU data rather than a hand-written regex; it excludes non-currency codes such as `ZZZ`, `XXX`, and `XTS`, though it may still include a recently replaced currency until the ICU data is updated. Lowercase and malformed values are rejected. The same validation applies to create and update.

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

### Reply draft demonstration

`POST /api/leads/:id/draft-reply` uses a local deterministic mock provider only. It does not call an AI service, require credentials, or store the draft. Its response is:

```json
{
  "intent": "availability",
  "summary": "...",
  "missingInformation": ["Preferred date and time", "Event location"],
  "draftReply": "...",
  "provider": "mock",
  "isDemo": true
}
```

Allowed `intent` values are `availability`, `pricing`, `service-details`, `booking`, and `general-enquiry`. The dashboard labels all drafts as mock demonstration output; copying is manual and never sends a customer message.

#### How business facts are selected

Before drafting, `server/src/business/context.ts` loads the business profile, only **active** catalogue entries, and only **active** FAQ/policy entries. It builds the enquiry text from the lead's `service` and `lastMessage` and keeps entries whose name/description or title/answer share a word of at least three characters, after ignoring common stop words. The selection is deterministic keyword matching, **not semantic AI retrieval**: different wording can miss a relevant entry, and shared wording can produce a false match.

The mock provider includes matched approved catalogue facts and FAQ/policy answers in the suggested reply. It never invents a price, availability, opening hours, refund right, booking term, or other policy: if a matching entry has no price, it says the price needs confirmation; if no approved policy is supplied, it asks for the missing detail or adds it to `missingInformation`. This remains demonstration behavior, not a live AI integration.


## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
