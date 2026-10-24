import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { after, before, beforeEach, test } from "node:test";
import { Pool } from "pg";
import {
  MockReplyDraftProvider,
  formatMinorUnits,
  type ReplyDraftProvider,
} from "../src/ai/reply-draft.js";
import { createApp } from "../src/app.js";
import { buildReplyContext } from "../src/business/context.js";
import type {
  CatalogueEntry,
  KnowledgeEntry,
  ReplyContext,
} from "../src/business/types.js";
import { createPool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrate.js";
import { seedLeads } from "../src/db/seed.js";
import {
  openingHoursFromSchedule,
  scheduleFromOpeningHours,
  setDayOpen,
} from "../../src/lib/opening-hours.js";
import {
  getTestDatabaseUrl,
  prepareTestDatabase,
  resetTestData,
} from "./test-database.js";

type Lead = {
  id: string;
  name: string;
  service: string;
  channel: "WhatsApp" | "Manual";
  status: "New" | "Contacted" | "Quoted" | "Booked";
  lastMessage: string;
  nextFollowUpAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type LeadPayload = { lead: Lead };
type LeadsPayload = { leads: Lead[] };
type ErrorPayload = { error: string; details?: unknown[] };

type BusinessProfile = {
  id: string;
  businessName: string;
  businessDescription: string;
  contactEmail: string | null;
  contactPhone: string | null;
  businessAddress: string | null;
  timezone: string;
  openingHours: Array<{
    day: string;
    opensAt: string;
    closesAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

type CatalogueItem = {
  id: string;
  name: string;
  description: string;
  priceMinor: number | null;
  currencyCode: string;
  isActive: boolean;
  availabilityNotes: string | null;
  createdAt: string;
  updatedAt: string;
};

type KnowledgeItem = {
  id: string;
  title: string;
  answer: string;
  entryType: "faq" | "policy";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type ProfilePayload = { profile: BusinessProfile | null };
type CataloguePayload = { entry: CatalogueItem };
type CatalogueListPayload = { entries: CatalogueItem[] };
type KnowledgePayload = { entry: KnowledgeItem };
type KnowledgeListPayload = { entries: KnowledgeItem[] };


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

function jsonRequest(
  path: string,
  method: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const validProfileBody = {
  businessName: "Lagos Light Studio",
  businessDescription: "Wedding and portrait photography.",
  contactEmail: "hello@example.test",
  contactPhone: "+234 800 000 0000",
  businessAddress: "12 Example Road, Lagos",
  timezone: "Africa/Lagos",
  openingHours: [{ day: "monday", opensAt: "09:00", closesAt: "17:00" }],
};

async function createProfile(
  overrides: Record<string, unknown> = {},
): Promise<BusinessProfile> {
  const response = await jsonRequest("/api/business/profile", "POST", {
    ...validProfileBody,
    ...overrides,
  });
  assert.equal(response.status, 201);
  const payload = await readJson<ProfilePayload>(response);
  assert.ok(payload.profile);
  return payload.profile;
}

async function createCatalogue(
  body: Record<string, unknown>,
): Promise<CatalogueItem> {
  const response = await jsonRequest("/api/business/catalogue", "POST", body);
  assert.equal(response.status, 201);
  const payload = await readJson<CataloguePayload>(response);
  return payload.entry;
}

async function createKnowledge(
  body: Record<string, unknown>,
): Promise<KnowledgeItem> {
  const response = await jsonRequest("/api/business/knowledge", "POST", body);
  assert.equal(response.status, 201);
  const payload = await readJson<KnowledgePayload>(response);
  return payload.entry;
}

async function createBusinessFixture() {
  const profile = await createProfile();
  const activeCatalogue = await createCatalogue({
    name: "Wedding photography",
    description: "Full-day wedding coverage.",
    priceMinor: 150_000,
    currencyCode: "NGN",
    availabilityNotes: "Weekends by arrangement.",
  });
  const inactiveCatalogue = await createCatalogue({
    name: "Wedding album",
    description: "Printed wedding album.",
    priceMinor: 99_900,
    currencyCode: "NGN",
    isActive: false,
  });
  const activeFaq = await createKnowledge({
    title: "Travel for weddings",
    answer: "Travel within the city is included.",
    entryType: "faq",
  });
  const inactivePolicy = await createKnowledge({
    title: "Wedding cancellation policy",
    answer: "Cancellations are accepted up to 14 days before the event.",
    entryType: "policy",
    isActive: false,
  });
  const unrelatedFaq = await createKnowledge({
    title: "Payment methods",
    answer: "You can pay by bank transfer.",
    entryType: "faq",
  });

  return {
    profile,
    activeCatalogue,
    inactiveCatalogue,
    activeFaq,
    inactivePolicy,
    unrelatedFaq,
  };
}

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: randomUUID(),
    name: "Sarah Musa",
    service: "Wedding photography",
    channel: "Manual",
    status: "New",
    lastMessage: "Do you travel for a wedding?",
    nextFollowUpAt: null,
    createdAt: "2026-01-01T08:00:00.000Z",
    updatedAt: "2026-01-01T08:00:00.000Z",
    ...overrides,
  };
}

function makeCatalogueEntry(
  overrides: Partial<CatalogueEntry> = {},
): CatalogueEntry {
  return {
    id: randomUUID(),
    name: "Wedding photography",
    description: "Full-day wedding coverage.",
    priceMinor: 150_000,
    currencyCode: "NGN",
    isActive: true,
    availabilityNotes: null,
    createdAt: "2026-01-01T08:00:00.000Z",
    updatedAt: "2026-01-01T08:00:00.000Z",
    ...overrides,
  };
}

function makeKnowledgeEntry(
  overrides: Partial<KnowledgeEntry> = {},
): KnowledgeEntry {
  return {
    id: randomUUID(),
    title: "Travel for weddings",
    answer: "Travel within the city is included.",
    entryType: "faq",
    isActive: true,
    createdAt: "2026-01-01T08:00:00.000Z",
    updatedAt: "2026-01-01T08:00:00.000Z",
    ...overrides,
  };
}

function makeContext(overrides: Partial<ReplyContext> = {}): ReplyContext {
  return {
    profile: null,
    catalogue: [],
    knowledge: [],
    ...overrides,
  };
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

  await resetTestData(pool);
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

test("business profile handles absence, creation, retrieval, and update", async () => {
  const emptyResponse = await fetch(`${baseUrl}/api/business/profile`);
  assert.equal(emptyResponse.status, 200);
  assert.deepEqual(await readJson(emptyResponse), { profile: null });

  const profile = await createProfile();

  assert.match(
    profile.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  assert.equal(profile.businessName, validProfileBody.businessName);
  assert.equal(
    profile.businessDescription,
    validProfileBody.businessDescription,
  );
  assert.equal(profile.contactEmail, validProfileBody.contactEmail);
  assert.equal(profile.contactPhone, validProfileBody.contactPhone);
  assert.equal(profile.businessAddress, validProfileBody.businessAddress);
  assert.equal(profile.timezone, validProfileBody.timezone);
  assert.deepEqual(profile.openingHours, validProfileBody.openingHours);
  assert.ok(Number.isFinite(Date.parse(profile.createdAt)));
  assert.ok(Number.isFinite(Date.parse(profile.updatedAt)));

  const getResponse = await fetch(`${baseUrl}/api/business/profile`);
  assert.equal(getResponse.status, 200);
  assert.deepEqual(await readJson<ProfilePayload>(getResponse), { profile });

  const updateBody = {
    ...validProfileBody,
    businessName: "Lagos Light Studio Updated",
    businessDescription: "Documentary wedding photography.",
    contactEmail: null,
    openingHours: [
      { day: "monday", opensAt: "10:00", closesAt: "18:00" },
      { day: "saturday", opensAt: "09:00", closesAt: "15:00" },
    ],
  };
  const updateResponse = await jsonRequest(
    "/api/business/profile",
    "PATCH",
    updateBody,
  );
  assert.equal(updateResponse.status, 200);
  const updated = await readJson<ProfilePayload>(updateResponse);

  assert.ok(updated.profile);
  assert.equal(updated.profile.id, profile.id);
  assert.equal(updated.profile.businessName, updateBody.businessName);
  assert.equal(
    updated.profile.businessDescription,
    updateBody.businessDescription,
  );
  assert.equal(updated.profile.contactEmail, null);
  assert.deepEqual(updated.profile.openingHours, updateBody.openingHours);
  assert.ok(
    Date.parse(updated.profile.updatedAt) >= Date.parse(profile.updatedAt),
  );
});

test("creating a second business profile returns a conflict", async () => {
  await createProfile();

  const response = await jsonRequest(
    "/api/business/profile",
    "POST",
    validProfileBody,
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await readJson(response), {
    error: "Business profile already exists",
  });
});

test("business profile rejects invalid bodies and opening hours", async () => {
  const cases: Array<{ body: unknown; field: string | null }> = [
    {
      body: { timezone: "Africa/Lagos", openingHours: [] },
      field: "body.businessName",
    },
    {
      body: { ...validProfileBody, businessName: "" },
      field: "body.businessName",
    },
    {
      body: { ...validProfileBody, timezone: "Not/AZone" },
      field: "body.timezone",
    },
    {
      body: {
        ...validProfileBody,
        openingHours: [
          { day: "monday", opensAt: "17:00", closesAt: "09:00" },
        ],
      },
      field: "body.openingHours.0.closesAt",
    },
    {
      body: {
        ...validProfileBody,
        openingHours: [
          { day: "monday", opensAt: "09:00", closesAt: "17:00" },
          { day: "monday", opensAt: "10:00", closesAt: "18:00" },
        ],
      },
      field: "body.openingHours.1.day",
    },
    {
      body: {
        ...validProfileBody,
        openingHours: [
          { day: "monday", opensAt: "9:00", closesAt: "17:00" },
        ],
      },
      field: "body.openingHours.0.opensAt",
    },
    {
      body: { ...validProfileBody, openingHours: "not-an-array" },
      field: "body.openingHours",
    },
    {
      body: { ...validProfileBody, contactEmail: "not-an-email" },
      field: "body.contactEmail",
    },
    {
      body: { ...validProfileBody, unexpected: true },
      field: null,
    },
  ];

  for (const { body, field } of cases) {
    const response = await jsonRequest("/api/business/profile", "POST", body);
    assert.equal(response.status, 400);

    const payload = await readJson<ErrorPayload>(response);
    assert.equal(payload.error, "Invalid request");
    assert.ok(Array.isArray(payload.details));
    assert.ok(payload.details.length > 0);

    if (field) {
      const details = payload.details as Array<{ field?: string }>;
      assert.ok(details.some((detail) => detail.field === field));
    }
  }
});

test("updating a missing business profile returns 404", async () => {
  const response = await jsonRequest(
    "/api/business/profile",
    "PATCH",
    validProfileBody,
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await readJson(response), {
    error: "Business profile not found",
  });
});

test("catalogue entries support create, list, update, and deactivate", async () => {
  const priced = await createCatalogue({
    name: "Wedding photography",
    description: "Full-day wedding coverage.",
    priceMinor: 150_000,
    currencyCode: "NGN",
    availabilityNotes: "Weekends by arrangement.",
  });

  assert.match(
    priced.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  assert.equal(priced.name, "Wedding photography");
  assert.equal(priced.priceMinor, 150_000);
  assert.equal(priced.currencyCode, "NGN");
  assert.equal(priced.isActive, true);
  assert.equal(priced.availabilityNotes, "Weekends by arrangement.");

  const optional = await createCatalogue({
    name: "Custom album",
    description: "Quoted after a consultation.",
    currencyCode: "USD",
  });
  assert.equal(optional.priceMinor, null);

  const explicitNull = await createCatalogue({
    name: "Portrait session",
    priceMinor: null,
    currencyCode: "NGN",
  });
  assert.equal(explicitNull.priceMinor, null);

  const listResponse = await fetch(`${baseUrl}/api/business/catalogue`);
  assert.equal(listResponse.status, 200);
  const list = await readJson<CatalogueListPayload>(listResponse);
  assert.equal(list.entries.length, 3);
  assert.ok(list.entries.some((entry) => entry.id === priced.id));
  assert.ok(list.entries.some((entry) => entry.id === optional.id));
  assert.ok(list.entries.some((entry) => entry.id === explicitNull.id));

  const updateResponse = await jsonRequest(
    `/api/business/catalogue/${priced.id}`,
    "PATCH",
    {
      name: "Wedding photography package",
      description: "Updated full-day coverage.",
      priceMinor: 250_000,
      currencyCode: "USD",
      availabilityNotes: "By request.",
      isActive: true,
    },
  );
  assert.equal(updateResponse.status, 200);
  const updated = await readJson<CataloguePayload>(updateResponse);

  assert.equal(updated.entry.id, priced.id);
  assert.equal(updated.entry.name, "Wedding photography package");
  assert.equal(updated.entry.priceMinor, 250_000);
  assert.equal(updated.entry.currencyCode, "USD");
  assert.equal(updated.entry.availabilityNotes, "By request.");

  const deactivateResponse = await jsonRequest(
    `/api/business/catalogue/${priced.id}`,
    "DELETE",
  );
  assert.equal(deactivateResponse.status, 200);
  const deactivated = await readJson<CataloguePayload>(deactivateResponse);

  assert.equal(deactivated.entry.id, priced.id);
  assert.equal(deactivated.entry.isActive, false);

  const afterDeactivate = await readJson<CatalogueListPayload>(
    await fetch(`${baseUrl}/api/business/catalogue`),
  );
  assert.equal(
    afterDeactivate.entries.find((entry) => entry.id === priced.id)?.isActive,
    false,
  );
});

test("catalogue validates prices, currencies, IDs, and request bodies", async () => {
  const invalidBodies: Array<{
    body: unknown;
    field: string | null;
  }> = [
    {
      body: { name: "Negative", priceMinor: -1, currencyCode: "NGN" },
      field: "body.priceMinor",
    },
    {
      body: { name: "Fractional", priceMinor: 1.5, currencyCode: "NGN" },
      field: "body.priceMinor",
    },
    {
      body: {
        name: "Unsafe",
        priceMinor: Number.MAX_SAFE_INTEGER + 1,
        currencyCode: "NGN",
      },
      field: "body.priceMinor",
    },
    {
      body: { name: "String price", priceMinor: "1000", currencyCode: "NGN" },
      field: "body.priceMinor",
    },
    {
      body: { name: "", priceMinor: 1000, currencyCode: "NGN" },
      field: "body.name",
    },
    {
      body: { name: "Unknown currency", currencyCode: "ZZZ" },
      field: "body.currencyCode",
    },
    {
      body: { name: "Lowercase currency", currencyCode: "usd" },
      field: "body.currencyCode",
    },
    {
      body: { name: "Short currency", currencyCode: "US" },
      field: "body.currencyCode",
    },
    {
      body: { name: "Long currency", currencyCode: "USDD" },
      field: "body.currencyCode",
    },
    {
      body: { name: "Unknown field", currencyCode: "NGN", unexpected: true },
      field: null,
    },
  ];

  for (const { body, field } of invalidBodies) {
    const response = await jsonRequest(
      "/api/business/catalogue",
      "POST",
      body,
    );
    assert.equal(response.status, 400);

    const payload = await readJson<ErrorPayload>(response);
    assert.equal(payload.error, "Invalid request");
    assert.ok(payload.details?.length);

    if (field) {
      const details = payload.details as Array<{ field?: string }>;
      assert.ok(details.some((detail) => detail.field === field));
    }
  }

  const validEntry = await createCatalogue({
    name: "Wedding photography",
    currencyCode: "NGN",
    priceMinor: 1000,
  });
  const invalidUpdateBodies = [
    {
      body: {
        name: "Wedding photography",
        currencyCode: "ZZZ",
        priceMinor: 1000,
      },
      field: "body.currencyCode",
    },
    {
      body: {
        name: "Wedding photography",
        currencyCode: "NGN",
        priceMinor: Number.MAX_SAFE_INTEGER + 1,
      },
      field: "body.priceMinor",
    },
  ];

  for (const { body, field } of invalidUpdateBodies) {
    const response = await jsonRequest(
      `/api/business/catalogue/${validEntry.id}`,
      "PATCH",
      body,
    );
    assert.equal(response.status, 400);
    const payload = await readJson<ErrorPayload>(response);
    const details = payload.details as Array<{ field?: string }>;
    assert.ok(details.some((detail) => detail.field === field));
  }

  for (const method of ["PATCH", "DELETE"]) {
    const malformed = await jsonRequest(
      "/api/business/catalogue/not-a-uuid",
      method,
      method === "PATCH"
        ? { name: "Test", currencyCode: "NGN" }
        : undefined,
    );
    assert.equal(malformed.status, 400);
    const payload = await readJson<ErrorPayload>(malformed);
    const details = payload.details as Array<{ field?: string }>;
    assert.ok(details.some((detail) => detail.field === "id"));

    const unknown = await jsonRequest(
      `/api/business/catalogue/${randomUUID()}`,
      method,
      method === "PATCH"
        ? { name: "Test", currencyCode: "NGN" }
        : undefined,
    );
    assert.equal(unknown.status, 404);
  }
});

test("catalogue accepts zero and the maximum safe price", async () => {
  const zero = await createCatalogue({
    name: "Free consultation",
    priceMinor: 0,
    currencyCode: "NGN",
  });
  assert.equal(zero.priceMinor, 0);

  const maximum = await createCatalogue({
    name: "Maximum price",
    priceMinor: Number.MAX_SAFE_INTEGER,
    currencyCode: "USD",
  });
  assert.equal(maximum.priceMinor, Number.MAX_SAFE_INTEGER);
});

test("the database rejects prices above the safe integer limit", async () => {
  await assert.rejects(
    pool.query(
      `
        INSERT INTO catalogue_entries (name, price_minor, currency_code)
        VALUES ('Unsafe direct insert', 9007199254740992, 'NGN')
      `,
    ),
    /catalogue_entries_price_minor_safe|check constraint/i,
  );
});

test("knowledge entries support create, list, update, and deactivate", async () => {
  const faq = await createKnowledge({
    title: "Do you travel for weddings?",
    answer: "Travel within the city is included.",
    entryType: "faq",
  });

  assert.match(
    faq.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  assert.equal(faq.entryType, "faq");
  assert.equal(faq.isActive, true);

  const policy = await createKnowledge({
    title: "Cancellation policy",
    answer: "Cancellations are accepted up to 14 days before the event.",
    entryType: "policy",
  });
  assert.equal(policy.entryType, "policy");

  const listResponse = await fetch(`${baseUrl}/api/business/knowledge`);
  assert.equal(listResponse.status, 200);
  const list = await readJson<KnowledgeListPayload>(listResponse);
  assert.equal(list.entries.length, 2);
  assert.ok(list.entries.some((entry) => entry.id === faq.id));
  assert.ok(list.entries.some((entry) => entry.id === policy.id));

  const updateResponse = await jsonRequest(
    `/api/business/knowledge/${faq.id}`,
    "PATCH",
    {
      title: "Do you travel?",
      answer: "Travel outside the city is quoted separately.",
      entryType: "policy",
      isActive: true,
    },
  );
  assert.equal(updateResponse.status, 200);
  const updated = await readJson<KnowledgePayload>(updateResponse);

  assert.equal(updated.entry.title, "Do you travel?");
  assert.equal(updated.entry.answer, "Travel outside the city is quoted separately.");
  assert.equal(updated.entry.entryType, "policy");

  const deactivateResponse = await jsonRequest(
    `/api/business/knowledge/${policy.id}`,
    "DELETE",
  );
  assert.equal(deactivateResponse.status, 200);
  const deactivated = await readJson<KnowledgePayload>(deactivateResponse);

  assert.equal(deactivated.entry.id, policy.id);
  assert.equal(deactivated.entry.isActive, false);
});

test("knowledge entries reject invalid bodies, types, and IDs", async () => {
  const invalidBodies: Array<{ body: unknown; field: string | null }> = [
    {
      body: { title: "Missing answer", entryType: "faq" },
      field: "body.answer",
    },
    {
      body: { answer: "Missing title", entryType: "faq" },
      field: "body.title",
    },
    {
      body: { title: "Invalid type", answer: "Text", entryType: "other" },
      field: "body.entryType",
    },
    {
      body: {
        title: "Unknown field",
        answer: "Text",
        entryType: "faq",
        unexpected: true,
      },
      field: null,
    },
  ];

  for (const { body, field } of invalidBodies) {
    const response = await jsonRequest(
      "/api/business/knowledge",
      "POST",
      body,
    );
    assert.equal(response.status, 400);
    const payload = await readJson<ErrorPayload>(response);
    assert.equal(payload.error, "Invalid request");
    assert.ok(payload.details?.length);

    if (field) {
      const details = payload.details as Array<{ field?: string }>;
      assert.ok(details.some((detail) => detail.field === field));
    }
  }

  for (const method of ["PATCH", "DELETE"]) {
    const malformed = await jsonRequest(
      "/api/business/knowledge/not-a-uuid",
      method,
      method === "PATCH"
        ? { title: "Test", answer: "Text", entryType: "faq" }
        : undefined,
    );
    assert.equal(malformed.status, 400);
    const payload = await readJson<ErrorPayload>(malformed);
    const details = payload.details as Array<{ field?: string }>;
    assert.ok(details.some((detail) => detail.field === "id"));

    const unknown = await jsonRequest(
      `/api/business/knowledge/${randomUUID()}`,
      method,
      method === "PATCH"
        ? { title: "Test", answer: "Text", entryType: "faq" }
        : undefined,
    );
    assert.equal(unknown.status, 404);
  }
});

test("reply context selects only active relevant business facts", async () => {
  const fixture = await createBusinessFixture();
  const context = await buildReplyContext(pool, makeLead());

  assert.ok(context.profile);
  assert.equal(context.profile.id, fixture.profile.id);
  assert.deepEqual(
    context.catalogue.map((entry) => entry.id),
    [fixture.activeCatalogue.id],
  );
  assert.deepEqual(
    context.knowledge.map((entry) => entry.id),
    [fixture.activeFaq.id],
  );
  assert.ok(
    !context.catalogue.some((entry) => entry.id === fixture.inactiveCatalogue.id),
  );
  assert.ok(
    !context.knowledge.some((entry) => entry.id === fixture.inactivePolicy.id),
  );
  assert.ok(
    !context.knowledge.some((entry) => entry.id === fixture.unrelatedFaq.id),
  );

  await jsonRequest(
    `/api/business/catalogue/${fixture.activeCatalogue.id}`,
    "DELETE",
  );
  await jsonRequest(
    `/api/business/knowledge/${fixture.activeFaq.id}`,
    "DELETE",
  );

  const afterDeactivation = await buildReplyContext(pool, makeLead());
  assert.deepEqual(afterDeactivation.catalogue, []);
  assert.deepEqual(afterDeactivation.knowledge, []);
});

test("unrelated enquiries receive no unrelated business facts", async () => {
  await createBusinessFixture();

  const context = await buildReplyContext(
    pool,
    makeLead({
      service: "Podcast editing",
      lastMessage: "How much for audio cleanup?",
    }),
  );

  assert.deepEqual(context.catalogue, []);
  assert.deepEqual(context.knowledge, []);
});

test("empty profiles and knowledge bases produce safe empty context", async () => {
  const context = await buildReplyContext(pool, makeLead());

  assert.equal(context.profile, null);
  assert.deepEqual(context.catalogue, []);
  assert.deepEqual(context.knowledge, []);
});

test("formats minor units without floating-point money arithmetic", () => {
  assert.equal(formatMinorUnits(0, "USD"), "USD 0.00");
  assert.equal(formatMinorUnits(150_000, "NGN"), "NGN 1,500.00");
  assert.equal(formatMinorUnits(123_456, "KWD"), "KWD 123.456");
  assert.equal(formatMinorUnits(500, "JPY"), "JPY 500");
});

test("mock provider uses approved catalogue prices and FAQ answers", async () => {
  const provider = new MockReplyDraftProvider();
  const lead = makeLead({
    lastMessage: "How much is wedding photography, and do you travel?",
  });
  const context = makeContext({
    catalogue: [makeCatalogueEntry({ priceMinor: 150_000 })],
    knowledge: [makeKnowledgeEntry()],
  });

  const draft = await provider.draftReply(lead, context);

  assert.equal(draft.provider, "mock");
  assert.equal(draft.isDemo, true);
  assert.match(draft.draftReply, /NGN 1,500\.00/);
  assert.match(draft.draftReply, /Travel within the city is included\./);
  assert.deepEqual(await provider.draftReply(lead, context), draft);
});

test("mock provider does not invent a price when none is approved", async () => {
  const provider = new MockReplyDraftProvider();
  const lead = makeLead({
    lastMessage: "How much does wedding photography cost?",
  });
  const draft = await provider.draftReply(
    lead,
    makeContext({
      catalogue: [makeCatalogueEntry({ priceMinor: null })],
    }),
  );

  assert.match(draft.draftReply, /price needs confirmation/i);
  assert.doesNotMatch(draft.draftReply, /NGN \d|USD \d/);
  assert.ok(
    draft.missingInformation.some((item) => /approved price/i.test(item)),
  );
});

test("mock provider does not invent policies or availability", async () => {
  const provider = new MockReplyDraftProvider();
  const refundDraft = await provider.draftReply(
    makeLead({ lastMessage: "What is your refund policy?" }),
    makeContext(),
  );

  assert.doesNotMatch(refundDraft.draftReply, /refund/i);
  assert.ok(
    refundDraft.missingInformation.some((item) => /refund policy/i.test(item)),
  );

  const availabilityDraft = await provider.draftReply(
    makeLead({ lastMessage: "Are you available on 12 December?" }),
    makeContext(),
  );

  assert.doesNotMatch(
    availabilityDraft.draftReply,
    /available|confirmed|opening hours/i,
  );
  assert.ok(
    availabilityDraft.missingInformation.includes("Preferred date and time"),
  );

  const bookingDraft = await provider.draftReply(
    makeLead({ lastMessage: "Can I book 12 December?" }),
    makeContext(),
  );

  assert.doesNotMatch(
    bookingDraft.draftReply,
    /confirmed|reserved|deposit|booking terms/i,
  );
});

test("mock provider includes an approved policy when one is supplied", async () => {
  const provider = new MockReplyDraftProvider();
  const answer = "Refunds are available up to 14 days before the event.";
  const draft = await provider.draftReply(
    makeLead({ lastMessage: "What is your refund policy?" }),
    makeContext({
      knowledge: [
        makeKnowledgeEntry({
          title: "Refund policy",
          answer,
          entryType: "policy",
        }),
      ],
    }),
  );

  assert.match(draft.draftReply, /Refunds are available up to 14 days/);
  assert.match(draft.draftReply, /Refund policy/);
  assert.ok(
    !draft.missingInformation.some((item) => /refund policy/i.test(item)),
  );
});

test("mock provider does not truncate an overlong approved answer", async () => {
  const provider = new MockReplyDraftProvider();
  const draft = await provider.draftReply(
    makeLead({ lastMessage: "What is your refund policy?" }),
    makeContext({
      knowledge: [
        makeKnowledgeEntry({
          title: "Refund policy",
          answer: `Refund details: ${"a".repeat(800)}`,
          entryType: "policy",
        }),
      ],
    }),
  );

  assert.match(draft.draftReply, /full approved text needs confirmation/i);
  assert.doesNotMatch(draft.draftReply, /a{700}/);
});

test("draft-reply uses active approved context and does not persist drafts", async () => {
  const fixture = await createBusinessFixture();
  const created = await readJson<LeadPayload>(
    await postLead({
      name: "Sarah Musa",
      service: "Wedding photography",
      lastMessage: "How much is wedding photography, and do you travel?",
    }),
  );

  const response = await draftReply(created.lead.id);
  assert.equal(response.status, 200);

  const draft = await readJson<{
    intent: string;
    summary: string;
    missingInformation: string[];
    draftReply: string;
    provider: string;
    isDemo: boolean;
  }>(response);

  assert.equal(draft.provider, "mock");
  assert.equal(draft.isDemo, true);
  assert.match(draft.draftReply, /NGN 1,500\.00/);
  assert.match(draft.draftReply, /Travel within the city is included\./);
  assert.doesNotMatch(draft.draftReply, /99,900\.00/);
  assert.doesNotMatch(draft.draftReply, /14 days before the event/);
  assert.match(draft.summary, /Sarah Musa/);
  assert.ok(fixture.activeCatalogue.id);

  const storedLeads = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM leads",
  );
  assert.equal(storedLeads.rows[0]?.count, 1);
});

test("re-running migrations preserves existing lead data", async () => {
  const created = await readJson<LeadPayload>(
    await postLead({
      name: "Migration Survivor",
      service: "Portrait photography",
      lastMessage: "Please keep my enquiry.",
    }),
  );

  const applied = await runMigrations(pool);
  assert.deepEqual(applied, []);

  const list = await readJson<LeadsPayload>(await fetch(`${baseUrl}/api/leads`));
  assert.ok(list.leads.some((lead) => lead.id === created.lead.id));
});
