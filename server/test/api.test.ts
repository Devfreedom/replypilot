import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { after, before, beforeEach, test } from "node:test";
import { Pool } from "pg";
import type { ReplyDraftProvider } from "../src/ai/reply-draft.js";
import { createApp } from "../src/app.js";
import { createPool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrate.js";
import { seedLeads } from "../src/db/seed.js";
import {
  getTestDatabaseUrl,
  prepareTestDatabase,
  resetTestLeads,
} from "./test-database.js";

type Lead = {
  id: string;
  name: string;
  service: string;
  channel: string;
  status: string;
  lastMessage: string;
  nextFollowUpAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type LeadPayload = { lead: Lead };
type LeadsPayload = { leads: Lead[] };
type ErrorPayload = { error: string; details?: unknown[] };

const testDatabaseUrl = getTestDatabaseUrl();

let pool: Pool;
let server: Server;
let baseUrl: string;

async function startServer(
  poolToUse: Pool,
  replyDraftProvider?: ReplyDraftProvider,
): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const appServer = createApp({
    pool: poolToUse,
    replyDraftProvider,
  }).listen(0, "127.0.0.1");
  await once(appServer, "listening");

  const address = appServer.address();

  if (address === null || typeof address === "string") {
    throw new Error("Expected the test server to listen on a TCP port.");
  }

  return {
    server: appServer,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(serverToStop: Server): Promise<void> {
  serverToStop.closeAllConnections();

  await new Promise<void>((resolve, reject) => {
    serverToStop.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function postLead(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/leads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchLead(id: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/leads/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function draftReply(id: string): Promise<Response> {
  return fetch(`${baseUrl}/api/leads/${id}/draft-reply`, { method: "POST" });
}

before(async () => {
  pool = createPool(testDatabaseUrl);
  await prepareTestDatabase(pool);
  ({ server, baseUrl } = await startServer(pool));
});

beforeEach(async () => {
  if (!pool) {
    return;
  }

  await resetTestLeads(pool);
});

after(async () => {
  if (server) {
    await stopServer(server);
  }

  if (pool) {
    await pool.end();
  }
});

test("migrations are repeatable and already-applied files are skipped", async () => {
  const applied = await runMigrations(pool);
  assert.deepEqual(applied, []);
});

test("GET /api/health returns 200 when PostgreSQL is reachable", async () => {
  const response = await fetch(`${baseUrl}/api/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await readJson(response), { status: "ok" });
});

test("GET /api/health returns 503 when PostgreSQL is unreachable", async () => {
  const unavailablePool = new Pool({
    connectionString:
      "postgresql://replypilot:invalid@127.0.0.1:1/replypilot_unavailable",
    connectionTimeoutMillis: 300,
    query_timeout: 300,
  });
  unavailablePool.on("error", () => {
    // The health check is expected to surface this failure as a 503.
  });

  const unavailable = await startServer(unavailablePool);

  try {
    const response = await fetch(`${unavailable.baseUrl}/api/health`);

    assert.equal(response.status, 503);
    assert.deepEqual(await readJson(response), { status: "unavailable" });
  } finally {
    await stopServer(unavailable.server);
    await unavailablePool.end();
  }
});

test("lead route database failures return a generic 500", async () => {
  const unavailablePool = new Pool({
    connectionString:
      "postgresql://replypilot:invalid@127.0.0.1:1/replypilot_unavailable",
    connectionTimeoutMillis: 300,
    query_timeout: 300,
  });
  unavailablePool.on("error", () => {
    // The route is expected to surface this failure as a generic 500.
  });

  const unavailable = await startServer(unavailablePool);

  try {
    const response = await fetch(`${unavailable.baseUrl}/api/leads`);

    assert.equal(response.status, 500);
    assert.deepEqual(await readJson(response), {
      error: "Internal server error",
    });
  } finally {
    await stopServer(unavailable.server);
    await unavailablePool.end();
  }
});

test("GET /api/leads returns an empty list", async () => {
  const response = await fetch(`${baseUrl}/api/leads`);

  assert.equal(response.status, 200);
  assert.deepEqual(await readJson(response), { leads: [] });
});

test("POST /api/leads creates a lead with defaults and persists it", async () => {
  const response = await postLead({
    name: "Test Customer",
    service: "Wedding photography",
    lastMessage: "Are you available next month?",
  });

  assert.equal(response.status, 201);

  const { lead } = await readJson<LeadPayload>(response);

  assert.match(
    lead.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  assert.equal(lead.name, "Test Customer");
  assert.equal(lead.channel, "Manual");
  assert.equal(lead.status, "New");
  assert.equal(lead.nextFollowUpAt, null);

  const stored = await pool.query<{
    name: string;
    last_message: string;
    channel: string;
    status: string;
  }>(
    "SELECT name, last_message, channel, status FROM leads WHERE id = $1",
    [lead.id],
  );

  assert.equal(stored.rowCount, 1);
  assert.deepEqual(stored.rows[0], {
    name: "Test Customer",
    last_message: "Are you available next month?",
    channel: "Manual",
    status: "New",
  });

  const listResponse = await fetch(`${baseUrl}/api/leads`);
  const list = await readJson<LeadsPayload>(listResponse);
  assert.equal(list.leads.length, 1);
  assert.equal(list.leads[0]?.id, lead.id);
});

test("POST /api/leads accepts channel, status, and nextFollowUpAt", async () => {
  const response = await postLead({
    name: "Amina Yakubu",
    service: "Portrait photography",
    lastMessage: "I would like a portrait session next week.",
    channel: "WhatsApp",
    status: "Contacted",
    nextFollowUpAt: "2030-01-01T10:00:00.000Z",
  });

  assert.equal(response.status, 201);

  const { lead } = await readJson<LeadPayload>(response);
  assert.equal(lead.channel, "WhatsApp");
  assert.equal(lead.status, "Contacted");
  assert.equal(lead.nextFollowUpAt, "2030-01-01T10:00:00.000Z");
});

test("POST /api/leads rejects invalid input", async () => {
  const invalidBodies = [
    { service: "Wedding photography", lastMessage: "Missing name" },
    {
      name: "Test",
      service: "Wedding photography",
      lastMessage: "Bad channel",
      channel: "Email",
    },
    {
      name: "Test",
      service: "Wedding photography",
      lastMessage: "Bad status",
      status: "Unknown",
    },
    {
      name: "Test",
      service: "Wedding photography",
      lastMessage: "Bad date",
      nextFollowUpAt: "tomorrow",
    },
    {
      name: "Test",
      service: "Wedding photography",
      lastMessage: "Unknown field",
      unexpected: true,
    },
  ];

  for (const body of invalidBodies) {
    const response = await postLead(body);
    assert.equal(response.status, 400);

    const payload = await readJson<ErrorPayload>(response);
    assert.equal(payload.error, "Invalid request");
    assert.ok(Array.isArray(payload.details));
  }
});

test("PATCH /api/leads/:id updates status", async () => {
  const createResponse = await postLead({
    name: "Peter Sunday",
    service: "Wedding photography",
    lastMessage: "I would like to confirm my package.",
  });
  const created = await readJson<LeadPayload>(createResponse);

  const response = await patchLead(created.lead.id, { status: "Booked" });

  assert.equal(response.status, 200);

  const { lead } = await readJson<LeadPayload>(response);
  assert.equal(lead.id, created.lead.id);
  assert.equal(lead.status, "Booked");
  assert.ok(
    new Date(lead.updatedAt).getTime() >=
      new Date(created.lead.updatedAt).getTime(),
  );

  const stored = await pool.query<{ status: string }>(
    "SELECT status FROM leads WHERE id = $1",
    [created.lead.id],
  );
  assert.equal(stored.rows[0]?.status, "Booked");
});

test("PATCH /api/leads/:id rejects invalid input", async () => {
  const createResponse = await postLead({
    name: "Grace John",
    service: "Event decoration",
    lastMessage: "Please send details.",
  });
  const created = await readJson<LeadPayload>(createResponse);

  const invalidStatus = await patchLead(created.lead.id, {
    status: "Cancelled",
  });
  assert.equal(invalidStatus.status, 400);

  const missingStatus = await patchLead(created.lead.id, {});
  assert.equal(missingStatus.status, 400);

  const malformedId = await patchLead("not-a-uuid", { status: "Booked" });
  assert.equal(malformedId.status, 400);

  const malformedPayload = await readJson<ErrorPayload>(malformedId);
  const details = malformedPayload.details as
    | Array<{ field?: string; message?: string }>
    | undefined;
  assert.equal(details?.[0]?.field, "id");
});

test("PATCH /api/leads/:id returns 404 for a valid unknown UUID", async () => {
  const response = await patchLead(randomUUID(), { status: "Booked" });

  assert.equal(response.status, 404);
  assert.deepEqual(await readJson(response), { error: "Lead not found" });
});

test("POST /api/leads/:id/draft-reply returns a mock draft without persisting it", async () => {
  const createResponse = await postLead({
    name: "Sarah Musa",
    service: "Wedding photography",
    lastMessage: "Are you available for a wedding in Jos this December?",
  });
  const created = await readJson<LeadPayload>(createResponse);

  const response = await draftReply(created.lead.id);

  assert.equal(response.status, 200);
  assert.deepEqual(await readJson(response), {
    intent: "availability",
    summary:
      "Enquiry from Sarah Musa about Wedding photography: Are you available for a wedding in Jos this December?",
    missingInformation: ["Preferred date and time", "Event location"],
    draftReply:
      "Hi Sarah Musa, thanks for reaching out about Wedding photography. Could you please share your preferred date, time, and location so we can understand your enquiry better?",
    provider: "mock",
    isDemo: true,
  });

  const stored = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM leads",
  );
  assert.equal(stored.rows[0]?.count, 1);
});

test("POST /api/leads/:id/draft-reply returns 404 for an unknown lead", async () => {
  const response = await draftReply(randomUUID());

  assert.equal(response.status, 404);
  assert.deepEqual(await readJson(response), { error: "Lead not found" });
});

test("POST /api/leads/:id/draft-reply rejects an invalid lead ID", async () => {
  const response = await draftReply("not-a-uuid");

  assert.equal(response.status, 400);
  const payload = await readJson<ErrorPayload>(response);
  assert.equal(payload.error, "Invalid request");
  assert.deepEqual(payload.details?.[0], {
    field: "id",
    message: "Invalid UUID",
  });
});

test("drafting passes the stored lead to the configured provider", async () => {
  const created = await readJson<LeadPayload>(
    await postLead({
      name: "Amina Yakubu",
      service: "Portrait photography",
      lastMessage: "I would like a portrait session next week.",
    }),
  );
  let receivedLead: Lead | null = null;
  const provider: ReplyDraftProvider = {
    async draftReply(lead) {
      receivedLead = lead;
      return {
        intent: "general-enquiry",
        summary: "A neutral summary.",
        missingInformation: [],
        draftReply: "A safe reply.",
        provider: "mock",
        isDemo: true,
      };
    },
  };
  const configured = await startServer(pool, provider);

  try {
    const response = await fetch(
      `${configured.baseUrl}/api/leads/${created.lead.id}/draft-reply`,
      { method: "POST" },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(receivedLead, created.lead);
  } finally {
    await stopServer(configured.server);
  }
});

test("drafting safely handles invalid provider output and provider failures", async () => {
  const created = await readJson<LeadPayload>(
    await postLead({
      name: "Grace John",
      service: "Event decoration",
      lastMessage: "Please send details.",
    }),
  );
  const invalidProvider: ReplyDraftProvider = {
    async draftReply() {
      return { intent: "not-an-intent" };
    },
  };
  const failingProvider: ReplyDraftProvider = {
    async draftReply() {
      throw new Error("Provider unavailable");
    },
  };

  for (const provider of [invalidProvider, failingProvider]) {
    const configured = await startServer(pool, provider);

    try {
      const response = await fetch(
        `${configured.baseUrl}/api/leads/${created.lead.id}/draft-reply`,
        { method: "POST" },
      );

      assert.equal(response.status, 500);
      assert.deepEqual(await readJson(response), {
        error: "Internal server error",
      });
    } finally {
      await stopServer(configured.server);
    }
  }
});

test("SQL-injection-shaped input is stored literally", async () => {
  const name = "Robert'); DROP TABLE leads;--";
  const lastMessage = "'); DELETE FROM leads; --";

  const response = await postLead({
    name,
    service: "Portrait photography",
    lastMessage,
  });

  assert.equal(response.status, 201);

  const table = await pool.query<{ table: string | null }>(
    "SELECT to_regclass('public.leads') AS table",
  );
  assert.ok(table.rows[0]?.table);

  const list = await readJson<LeadsPayload>(await fetch(`${baseUrl}/api/leads`));
  assert.ok(
    list.leads.some(
      (lead) => lead.name === name && lead.lastMessage === lastMessage,
    ),
  );
});

test("GET /api/leads orders leads by creation time, newest first", async () => {
  const olderId = "20000000-0000-4000-8000-000000000001";
  const newerId = "20000000-0000-4000-8000-000000000002";

  await pool.query(
    `
      INSERT INTO leads (
        id, name, service, channel, status, last_message, created_at, updated_at
      )
      VALUES
        ($1, 'Older Lead', 'Portrait photography', 'Manual', 'New',
          'Older message', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
        ($2, 'Newer Lead', 'Portrait photography', 'Manual', 'New',
          'Newer message', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')
    `,
    [olderId, newerId],
  );

  const response = await fetch(`${baseUrl}/api/leads`);
  const { leads } = await readJson<LeadsPayload>(response);

  assert.deepEqual(
    leads.map((lead) => lead.id),
    [newerId, olderId],
  );
});

test("seed data is idempotent", async () => {
  const first = await seedLeads(pool);
  const second = await seedLeads(pool);

  assert.equal(first, 5);
  assert.equal(second, 0);

  const count = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM leads",
  );
  assert.equal(count.rows[0]?.count, 5);
});

test("malformed JSON returns a safe 400 response", async () => {
  const response = await fetch(`${baseUrl}/api/leads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await readJson(response), { error: "Invalid JSON body" });
});

test("unknown routes return a JSON 404", async () => {
  const response = await fetch(`${baseUrl}/api/does-not-exist`);

  assert.equal(response.status, 404);
  assert.deepEqual(await readJson(response), { error: "Not found" });
});
