# Outbound worker

The outbound worker is a standalone Node process. It claims queued
`outbound_messages` rows from PostgreSQL and passes the stored content snapshot
to the configured provider. It does not run inside the Express API. Mock is
the default. Meta is available only when explicitly enabled with a complete
server-side test configuration, and is rejected in a production runtime.

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
- Checks workspace-scoped customer suppression before claim/send; the Meta
  adapter rechecks suppression and the 24-hour service window immediately
  before its HTTP request. Explicit inbound opt-out requests block later sends.
- Marks provider acceptance as `sent`. `sent` is not delivery; `delivered`
  remains a separate status and the mock provider never sets it.
- Retries definite provider failures up to `max_attempts` (3 by default), then
  marks the row `failed`. A failed row can be requeued explicitly from the
  outbound history page; the original content snapshot and logical idempotency
  key are preserved.
- Treats timeouts and unclassified exceptions as ambiguous outcomes. If the
  provider does not guarantee idempotency for the supplied key, the row moves
  to `manual_review`; it is not automatically sent again. An owner/operator
  must check the provider's own records before any further send. ReplyPilot
  does not currently reconcile provider records automatically or offer an
  action to mark an uncertain message as sent or delivered.
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
- Thread history uses `sent_at` for outbound provider acceptance time and falls
  back to `queued_at` until acceptance. Signed delivery webhooks durably record
  statuses and provider timestamps; older events cannot regress newer states.
  Inbound provider timestamps and inbound message records are retained.

## Run in development

From the repository root:

```bash
npm run worker:outbound
```

The command loads `.env` when present, uses the same `DATABASE_URL` as the API,
and logs one JSON object per line.

When `META_OUTBOUND_ENABLED` is false or absent, the worker only claims `mock`
records. To enable the restricted test adapter, configure the complete
server-side Meta variables in `.env` as documented in the
[README WhatsApp test integration](../README.md#whatsapp-cloud-api-test-integration).
The provider is selected by the server for the configured test workspace;
other workspaces continue using mock. The Meta token is never logged and must
not be placed in a URL or frontend configuration. The API and worker both
refuse enabled Meta configuration under `NODE_ENV=production`.

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

- The mock provider is deterministic and remains available with Meta disabled.
  Meta sends are limited to one configured test workspace, sender, and
  allowlisted recipients. Production sending, templates, bulk messaging, and
  proactive campaigns are not supported.
- Meta delivery-status webhooks require the configured webhook URL, app secret,
  signature verification, and the relevant WhatsApp webhook subscription.
  Events are deduplicated and audited in PostgreSQL; the route does not retain
  raw webhook bodies.
- Clear opt-out messages are processed deterministically and suppression is
  not automatically removed. There is no full consent-management system.
- The provider sends free-form text only within the authoritative 24-hour
  customer-service window. Missing or invalid inbound provider timestamps
  close the window and prevent sending.
- Ambiguous Meta outcomes require manual reconciliation against provider
  records. ReplyPilot does not automatically determine whether Meta accepted a
  timed-out request.
- Queueing is durable in PostgreSQL. Redis and other infrastructure are not
  required.
- There is one outbound record per reply draft. A draft edited after a previous
  outbound record was created needs a new draft to send revised content. The
  draft dialog includes a **New draft** action for this case.
- This worker does not process inbound WhatsApp messages; those continue through
  the existing webhook path.
