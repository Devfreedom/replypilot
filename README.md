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

The Express API is a separate development service. It binds to `127.0.0.1` and must not be exposed publicly. It has no authentication, AI, WhatsApp integration, or frontend integration yet.

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

The seed is idempotent: running `npm run db:seed` again does not create duplicates. It uses fixed UUIDs and `ON CONFLICT DO NOTHING`, so existing records are not overwritten.

Environment variables are loaded by Node.js `--env-file-if-exists=.env` in the API scripts. Values already set in the environment take precedence, and no dotenv dependency is needed. The API validates `DATABASE_URL`, `PORT`, and `NODE_ENV` at startup.

### Run the API

```bash
npm run dev:api
curl http://127.0.0.1:4000/api/health
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

The test suite runs migrations against `TEST_DATABASE_URL` and truncates only its `leads` table between tests. It fails with a clear error if `TEST_DATABASE_URL` is missing, points at the same database as `DATABASE_URL`, or points at a maintenance database. Tests are never silently skipped.

### Endpoints

| Method | Path | Behaviour |
| --- | --- | --- |
| `GET` | `/api/health` | `200 {"status":"ok"}` when PostgreSQL responds; `503 {"status":"unavailable"}` otherwise. |
| `GET` | `/api/leads` | `200 {"leads":[...]}` ordered newest first. |
| `POST` | `/api/leads` | Accepts `name`, `service`, and `lastMessage`; optional `channel`, `status`, and `nextFollowUpAt`. Returns `201 {"lead":{...}}`. Defaults: `Manual`, `New`. |
| `PATCH` | `/api/leads/:id` | Accepts `{ "status": "New" \| "Contacted" \| "Quoted" \| "Booked" }`. Returns the updated lead, `400` for malformed input, or `404` for an unknown valid UUID. |

Each lead response field is: `id`, `name`, `service`, `channel`, `status`, `lastMessage`, `nextFollowUpAt`, `createdAt`, and `updatedAt`. `nextFollowUpAt` is an ISO 8601 timestamp with an explicit offset or `null`.

Database errors are not returned to clients. Validation responses contain field-level messages without echoing submitted values.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
