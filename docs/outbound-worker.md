# Outbound worker (mock provider)

The outbound worker is a standalone Node process. It claims queued
`outbound_messages` rows from PostgreSQL and passes the stored content snapshot
to the mock provider. It does not run inside the Express API, and it never
contacts WhatsApp or any other external service.

## What it does

- Polls PostgreSQL on a configurable interval.
- Recovers stale `sending` claims older than the configured threshold.
- Cancels queued work when the draft is no longer approved or the linked
  conversation is no longer `open`/`closed`.
- Claims a bounded batch with `FOR UPDATE SKIP LOCKED`, so multiple worker
  processes cannot claim the same row.
- Re-checks authorization after the claim and before the provider call.
- Marks provider acceptance as `sent`. `sent` is not delivery; `delivered`
  remains a separate status and the mock provider never sets it.
- Retries provider failures up to `max_attempts` (3 by default), then marks the
  row `failed`. A failed row can be requeued explicitly from the outbound
  history page; the original content snapshot is preserved.

## Run in development

From the repository root:

```bash
npm run worker:outbound
```

The command loads `.env` when present, uses the same `DATABASE_URL` as the API,
and logs one JSON object per line.

Optional environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `OUTBOUND_WORKER_POLL_MS` | `2000` | Delay between worker ticks. |
| `OUTBOUND_WORKER_BATCH_SIZE` | `10` | Maximum claims per tick. |
| `OUTBOUND_WORKER_STALE_MS` | `300000` | Age after which a `sending` claim is recovered. |

## Run a compiled build

```bash
npm run build:api
npm run start:worker
```

`start:worker` runs `server/dist/outbound/worker-cli.js` and expects the API
build output to exist.

## Stop

Send `SIGINT` (Ctrl+C) or `SIGTERM`. The worker stops after the current tick,
closes the PostgreSQL pool, and logs `outbound_worker_stopped`. In-flight
provider calls are not aborted; if a process is killed hard, a later worker
recovers the stale `sending` row after `OUTBOUND_WORKER_STALE_MS`.

## Scope and limitations

- The provider is a deterministic mock. No live AI, Meta connection, real
  WhatsApp send, or delivery webhook is implemented in this milestone.
- Queueing is durable in PostgreSQL. Redis and other infrastructure are not
  required.
- This worker does not process inbound WhatsApp messages; those continue through
  the existing webhook path.
