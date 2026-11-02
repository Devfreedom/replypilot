# Outbound worker (mock provider)

The outbound worker is a standalone Node process. It claims queued
`outbound_messages` rows from PostgreSQL and passes the stored content snapshot
to the mock provider. It does not run inside the Express API, and it never
contacts WhatsApp or any other external service.

## What it does

- Polls PostgreSQL on a configurable interval.
- Recovers stale `sending` claims older than the configured threshold only for
  the configured provider adapter. It retries only when that adapter declares
  guaranteed idempotency; otherwise, or after the attempt limit, the row moves
  to `manual_review`.
- Cancels queued work when the draft is no longer approved or the linked
  conversation is no longer `open`/`closed`.
- Claims a bounded batch with `FOR UPDATE SKIP LOCKED`, so multiple worker
  processes cannot claim the same row.
- Re-checks authorization after the claim and before the provider call. Draft
  edits, regeneration, and approval revocation are rejected while the record is
  `sending`, then can proceed after its provider outcome is recorded.
- Marks provider acceptance as `sent`. `sent` is not delivery; `delivered`
  remains a separate status and the mock provider never sets it.
- Retries definite provider failures up to `max_attempts` (3 by default), then
  marks the row `failed`. A failed row can be requeued explicitly from the
  outbound history page; the original content snapshot and logical idempotency
  key are preserved.
- Treats timeouts and unclassified exceptions as ambiguous outcomes. If the
  provider does not guarantee idempotency for the supplied key, the row moves
  to `manual_review`; it is not automatically sent again. An owner/operator
  must reconcile the provider outcome before any further send.
- Only sends when the outbound snapshot still exactly matches the approved
  draft content. Editing or returning a draft cancels queued work immediately.
  A `sending` claim is a short-lived authorization reservation: mutations that
  race with it receive `409` until the provider outcome is recorded.

## Delivery and idempotency guarantees

- Database claim generations prevent stale workers from overwriting newer
  database state; they do **not** prevent duplicate external side effects.
- The worker passes the same stored idempotency key on every attempt for one
  outbound record. An adapter may declare `idempotency: "guaranteed"` only
  when the provider contract guarantees deduplication for that key across the
  entire retry/reconciliation window and the key is scoped to the same
  provider/account.
- Providers without that guarantee are never automatically retried after an
  ambiguous timeout or stale claim. Such records become `manual_review`.
- The final database authorization check and the provider call cannot be one
  atomic operation because provider calls remain outside database
  transactions. The `sending` reservation prevents draft mutation after the
  worker crosses that boundary, but a crash can still leave an unknown provider
  outcome. Idempotency or provider-side reconciliation is required; this
  system does not claim exactly-once delivery.

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
provider calls are not aborted. If a process is killed hard, a later worker
retries a stale row only when the configured adapter and row provider match
and provider idempotency is guaranteed; otherwise the row enters
`manual_review`.

## Scope and limitations

- The provider is a deterministic mock. No live AI, Meta outbound connection,
  real WhatsApp send, or delivery webhook is implemented in this milestone.
- Queueing is durable in PostgreSQL. Redis and other infrastructure are not
  required.
- There is one outbound record per reply draft. A draft edited after a previous
  outbound record was created needs a new draft to send revised content. The
  draft dialog includes a **New draft** action for this case.
- This worker does not process inbound WhatsApp messages; those continue through
  the existing webhook path.
