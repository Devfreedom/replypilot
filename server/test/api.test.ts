import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile, readdir } from "node:fs/promises";
import type { Server } from "node:http";
import { after, before, beforeEach, test } from "node:test";
import { join } from "node:path";
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
  LEGACY_WORKSPACE_ID,
  bootstrapLegacyWorkspace,
  listMembershipsForUser,
} from "../src/workspaces/repository.js";
import {
  type Weekday,
  openingHoursFromSchedule,
  scheduleFromOpeningHours,
  setDayOpen,
} from "../../src/lib/opening-hours.js";
import type {
  ConversationSummary,
  InboundWhatsAppMessage,
  WhatsAppConversation,
  WhatsAppIntegrationConfig,
  WhatsAppMessage,
} from "../src/whatsapp/types.js";
import { loadWhatsAppConfig } from "../src/whatsapp/config.js";
import { normalizeWhatsAppPhoneE164 } from "../src/whatsapp/phone.js";
import { persistInboundMessages } from "../src/whatsapp/repository.js";
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
  whatsappNumber: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type LeadPayload = { lead: Lead };
type LeadsPayload = { leads: Lead[] };
type ErrorPayload = { error: string; details?: unknown[] };

type ReplyDraftSourcePayload = {
  id: string;
  type: "catalogue" | "faq" | "policy";
  title: string;
  content: string;
  reason: string;
  priceMinor: number | null;
  currencyCode: string | null;
};

type SavedReplyDraftPayload = {
  id: string;
  leadId: string;
  intent:
    | "availability"
    | "pricing"
    | "service-details"
    | "booking"
    | "general-enquiry";
  summary: string;
  missingInformation: string[];
  draftReply: string;
  provider: "mock";
  isDemo: true;
  status: "draft" | "approved";
  sources: ReplyDraftSourcePayload[];
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ReplyDraftPayload = { draft: SavedReplyDraftPayload };
type ReplyDraftsPayload = { drafts: SavedReplyDraftPayload[] };

type BusinessProfile = {
  id: string;
  businessName: string;
  businessDescription: string;
  contactEmail: string | null;
  contactPhone: string | null;
  contactPhoneCountry: string | null;
  businessAddress: string | null;
  timezone: string;
  openingHours: Array<{
    day: Weekday;
    opensAt: string;
    closesAt: string;
  }>;
  currencyCode: string | null;
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
const MIGRATIONS_DIR = join(
  process.cwd(),
  "server",
  "src",
  "db",
  "migrations",
);
const TEST_AUTH_ORIGIN = "http://127.0.0.1:3000";
const TEST_AUTH_SECRET = "replypilot-test-only-secret-0123456789abcdef";
const TEST_CLIENT_IP = "127.0.0.1";
const nativeFetch = globalThis.fetch.bind(globalThis);

type TestWorkspacePayload = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

type TestSession = Readonly<{
  email: string;
  password: string;
  cookie: string;
  user: Readonly<{ id: string; name: string; email: string }>;
  workspace: TestWorkspacePayload;
  role: "owner" | "member";
}>;

type TestAuthRateLimit = Readonly<{
  enabled?: boolean;
  window?: number;
  max?: number;
}>;

type TestAuthOptions = Readonly<{
  baseURL?: string;
  trustedOrigins?: string[];
  rateLimit?: TestAuthRateLimit;
}>;

let pool: Pool;
let server: Server;
let baseUrl: string;
let currentSession: TestSession;

async function startServer(
  poolToUse: Pool,
  replyDraftProvider?: ReplyDraftProvider,
  authOptions: TestAuthOptions = {},
  whatsapp: WhatsAppIntegrationConfig | null = null,
): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const authBaseUrl = authOptions.baseURL ?? TEST_AUTH_ORIGIN;
  const appServer = createApp({
    pool: poolToUse,
    replyDraftProvider,
    whatsapp,
    auth: {
      secret: TEST_AUTH_SECRET,
      baseURL: authBaseUrl,
      trustedOrigins: authOptions.trustedOrigins ?? [authBaseUrl],
      // The suite creates a real account for every test. Rate limiting is
      // exercised explicitly against a dedicated app instance instead of
      // tripping Better Auth's sign-up rule during unrelated tests.
      rateLimit: authOptions.rateLimit ?? { enabled: false },
    },
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

const TEST_WHATSAPP_VERIFY_TOKEN = "replypilot-test-whatsapp-verify-token";
const TEST_WHATSAPP_APP_SECRET =
  "replypilot-test-whatsapp-app-secret-0123456789abcdef";
const TEST_WHATSAPP_PHONE_NUMBER_ID = "106540352242922";
const TEST_WHATSAPP_CUSTOMER_WA_ID = "16505551234";
const TEST_WHATSAPP_BSUID = "US.13491208655302741918";

type TestWhatsAppMessage = {
  id: string;
  from?: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  [key: string]: unknown;
};

type TestWhatsAppContact = {
  wa_id?: string;
  user_id?: string;
  profile: { name: string };
};

type TestWhatsAppChange = {
  field?: string;
  value: unknown;
};

type WhatsAppWebhookPayload = {
  status: "ok" | "ignored";
  stored?: number;
  duplicates?: number;
};

type WhatsAppConversationsPayload = {
  conversations: WhatsAppConversation[];
};

type WhatsAppConversationMessagesPayload = {
  conversation: WhatsAppConversation;
  messages: WhatsAppMessage[];
};

type ConversationPaginationPayload = {
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
};

type ConversationsPayload = {
  conversations: ConversationSummary[];
  pagination: ConversationPaginationPayload;
};

type ConversationPayload = {
  conversation: ConversationSummary;
};

type ConversationMessagesPayload = {
  conversation: ConversationSummary;
  messages: WhatsAppMessage[];
  pagination: ConversationPaginationPayload;
};

function signWhatsAppBody(
  body: string,
  secret = TEST_WHATSAPP_APP_SECRET,
): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function whatsappChange({
  messages,
  contacts = [],
  phoneNumberId = TEST_WHATSAPP_PHONE_NUMBER_ID,
  field = "messages",
}: {
  messages?: TestWhatsAppMessage[];
  contacts?: TestWhatsAppContact[];
  phoneNumberId?: string;
  field?: string;
} = {}): TestWhatsAppChange {
  return {
    field,
    value: {
      messaging_product: "whatsapp",
      metadata: {
        display_phone_number: "15550783881",
        phone_number_id: phoneNumberId,
      },
      contacts,
      messages,
    },
  };
}

function whatsappEnvelope(
  changes: TestWhatsAppChange[],
  object = "whatsapp_business_account",
): string {
  return JSON.stringify({
    object,
    entry: [{ id: "waba-test", changes }],
  });
}

function textWhatsAppMessage({
  id = `wamid.${randomUUID()}`,
  from = TEST_WHATSAPP_CUSTOMER_WA_ID,
  text = "Hello from a test customer",
  timestamp = "1760000000",
}: {
  id?: string;
  from?: string;
  text?: string;
  timestamp?: string;
} = {}): TestWhatsAppMessage {
  return {
    id,
    from,
    timestamp,
    type: "text",
    text: { body: text },
  };
}

function testWhatsAppConfig(
  overrides: Partial<WhatsAppIntegrationConfig> = {},
): WhatsAppIntegrationConfig {
  return {
    verifyToken: TEST_WHATSAPP_VERIFY_TOKEN,
    appSecret: TEST_WHATSAPP_APP_SECRET,
    phoneNumberId: TEST_WHATSAPP_PHONE_NUMBER_ID,
    workspaceId: requireSession().workspace.id,
    ...overrides,
  };
}

function inboundMessage(
  overrides: Partial<InboundWhatsAppMessage> = {},
): InboundWhatsAppMessage {
  return {
    providerMessageId: `wamid.${randomUUID()}`,
    phoneNumberId: TEST_WHATSAPP_PHONE_NUMBER_ID,
    senderWaId: TEST_WHATSAPP_CUSTOMER_WA_ID,
    senderPhoneNumber: TEST_WHATSAPP_CUSTOMER_WA_ID,
    contactName: "Sheena Nelson",
    messageType: "text",
    text: "Hello from a test customer",
    providerTimestamp: new Date("2026-10-01T10:00:00.000Z"),
    ...overrides,
  };
}

function startWhatsAppServer(
  overrides: Partial<WhatsAppIntegrationConfig> = {},
): Promise<{ server: Server; baseUrl: string }> {
  return startServer(pool, undefined, {}, testWhatsAppConfig(overrides));
}

async function postWhatsApp(
  app: Readonly<{ baseUrl: string }>,
  body: string,
  options: Readonly<{
    signature?: string | null;
  }> = {},
): Promise<Response> {
  const headers = new Headers({
    "content-type": "application/json",
    "x-forwarded-for": TEST_CLIENT_IP,
  });
  const signature =
    options.signature === undefined
      ? signWhatsAppBody(body)
      : options.signature;

  if (signature) {
    headers.set("x-hub-signature-256", signature);
  }

  return nativeFetch(`${app.baseUrl}/api/webhooks/whatsapp`, {
    method: "POST",
    headers,
    body,
  });
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function requireSession(): TestSession {
  if (!currentSession) {
    throw new Error("The test session has not been initialized.");
  }

  return currentSession;
}

function cookieHeader(headers: Headers): string {
  const mutableHeaders = headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies =
    typeof mutableHeaders.getSetCookie === "function"
      ? mutableHeaders.getSetCookie()
      : (() => {
          const combined = headers.get("set-cookie");
          return combined ? [combined] : [];
        })();

  return setCookies
    .map((value) => value.split(";", 1)[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

function authHeaders(): Headers {
  return new Headers({
    "content-type": "application/json",
    origin: TEST_AUTH_ORIGIN,
    "x-forwarded-for": TEST_CLIENT_IP,
  });
}

async function registerUser(
  options: Readonly<{
    email?: string;
    password?: string;
    name?: string;
  }> = {},
): Promise<TestSession> {
  const email = options.email ?? `owner-${randomUUID()}@example.test`;
  const password = options.password ?? "replypilot-test-password";
  const name = options.name ?? "Test Owner";
  const response = await nativeFetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email, password, name }),
  });

  if (!response.ok) {
    throw new Error(
      `Registration failed (${response.status}): ${await response.text()}`,
    );
  }

  const cookie = cookieHeader(response.headers);

  if (!cookie) {
    throw new Error("Registration did not return a session cookie.");
  }

  const payload = await readJson<{
    user: { id: string; name: string; email: string };
  }>(response);
  const workspaceResponse = await nativeFetch(`${baseUrl}/api/workspace`, {
    headers: {
      cookie,
      "x-forwarded-for": TEST_CLIENT_IP,
    },
  });

  if (!workspaceResponse.ok) {
    throw new Error(
      `Workspace initialization failed (${workspaceResponse.status}): ${await workspaceResponse.text()}`,
    );
  }

  const workspacePayload = await readJson<{
    user: { id: string; name: string; email: string };
    workspace: TestWorkspacePayload;
    role: "owner" | "member";
  }>(workspaceResponse);

  return {
    email,
    password,
    cookie,
    user: payload.user,
    workspace: workspacePayload.workspace,
    role: workspacePayload.role,
  };
}

function signInRequest(email: string, password: string): Promise<Response> {
  return nativeFetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email, password }),
  });
}

function requestAs(
  session: TestSession,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<Response> {
  const headers = new Headers({
    cookie: session.cookie,
    "x-forwarded-for": TEST_CLIENT_IP,
  });

  if (body !== undefined) {
    headers.set("content-type", "application/json");
  }

  return nativeFetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function fetch(
  input: Parameters<typeof nativeFetch>[0],
  init: Parameters<typeof nativeFetch>[1] = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("x-forwarded-for", TEST_CLIENT_IP);

  if (currentSession && !headers.has("cookie")) {
    headers.set("cookie", currentSession.cookie);
  }

  return nativeFetch(input, { ...init, headers });
}

function postLead(body: unknown): Promise<Response> {
  return jsonRequest("/api/leads", "POST", body);
}

function patchLead(id: string, body: unknown): Promise<Response> {
  return jsonRequest(`/api/leads/${id}`, "PATCH", body);
}

function draftReply(id: string): Promise<Response> {
  return jsonRequest(`/api/leads/${id}/draft-reply`, "POST");
}

function createSavedDraft(
  leadId: string,
  body?: unknown,
): Promise<Response> {
  return jsonRequest(`/api/leads/${leadId}/reply-drafts`, "POST", body);
}

function listSavedDrafts(leadId: string): Promise<Response> {
  return jsonRequest(`/api/leads/${leadId}/reply-drafts`, "GET");
}

function patchSavedDraft(
  leadId: string,
  draftId: string,
  body: unknown,
): Promise<Response> {
  return jsonRequest(
    `/api/leads/${leadId}/reply-drafts/${draftId}`,
    "PATCH",
    body,
  );
}

async function createDraftLead(
  overrides: Record<string, unknown> = {},
): Promise<Lead> {
  const response = await postLead({
    name: "Sarah Musa",
    service: "Wedding photography",
    lastMessage: "How much is wedding photography, and do you travel?",
    ...overrides,
  });

  assert.equal(response.status, 201);
  return (await readJson<LeadPayload>(response)).lead;
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
  contactPhone: "+2348031234567",
  contactPhoneCountry: "NG",
  businessAddress: "12 Example Road, Lagos",
  timezone: "Africa/Lagos",
  openingHours: [{ day: "monday", opensAt: "09:00", closesAt: "17:00" }],
  currencyCode: "NGN",
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
    whatsappNumber: null,
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
  currentSession = await registerUser();
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

test("profile migration adds nullable phone-country and currency columns", async () => {
  const result = await pool.query<{
    column_name: string;
    is_nullable: string;
    column_default: string | null;
  }>(
    `
      SELECT column_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'business_profiles'
        AND column_name IN ('contact_phone_country', 'currency_code')
      ORDER BY column_name
    `,
  );

  assert.deepEqual(result.rows, [
    {
      column_name: "contact_phone_country",
      is_nullable: "YES",
      column_default: null,
    },
    {
      column_name: "currency_code",
      is_nullable: "YES",
      column_default: null,
    },
  ]);
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

test("POST /api/leads normalizes and rejects duplicate WhatsApp numbers", async () => {
  const first = await postLead({
    name: "First Enquiry",
    service: "Wedding photography",
    lastMessage: "Please share availability.",
    whatsappNumber: "+1 (650) 555-1234",
  });
  assert.equal(first.status, 201);
  const firstLead = (await readJson<LeadPayload>(first)).lead;
  assert.equal(firstLead.whatsappNumber, "16505551234");

  const duplicate = await postLead({
    name: "Duplicate Enquiry",
    service: "Wedding photography",
    lastMessage: "Another message from the same number.",
    whatsappNumber: "16505551234",
  });
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await readJson(duplicate), {
    error: "A lead with this WhatsApp number already exists.",
  });

  const stored = await pool.query<{ count: number }>(
    `
      SELECT count(*)::int AS count
      FROM leads
      WHERE workspace_id = $1
        AND whatsapp_number = $2
    `,
    [requireSession().workspace.id, "16505551234"],
  );
  assert.equal(stored.rows[0]?.count, 1);
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
    {
      name: "Test",
      service: "Wedding photography",
      lastMessage: "Bad WhatsApp number",
      whatsappNumber: "not-a-number",
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

  const storedDrafts = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM reply_drafts",
  );
  assert.equal(storedDrafts.rows[0]?.count, 0);
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
        workspace_id, id, name, service, channel, status, last_message,
        created_at, updated_at
      )
      VALUES
        ($3, $1, 'Older Lead', 'Portrait photography', 'Manual', 'New',
          'Older message', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
        ($3, $2, 'Newer Lead', 'Portrait photography', 'Manual', 'New',
          'Newer message', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')
    `,
    [olderId, newerId, requireSession().workspace.id],
  );

  const response = await fetch(`${baseUrl}/api/leads`);
  const { leads } = await readJson<LeadsPayload>(response);

  assert.deepEqual(
    leads.map((lead) => lead.id),
    [newerId, olderId],
  );
});

test("seed data is idempotent", async () => {
  const first = await seedLeads(pool, requireSession().workspace.id);
  const second = await seedLeads(pool, requireSession().workspace.id);

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
  assert.equal(
    profile.contactPhoneCountry,
    validProfileBody.contactPhoneCountry,
  );
  assert.equal(profile.businessAddress, validProfileBody.businessAddress);
  assert.equal(profile.timezone, validProfileBody.timezone);
  assert.deepEqual(profile.openingHours, validProfileBody.openingHours);
  assert.equal(profile.currencyCode, validProfileBody.currencyCode);
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

test("phone input is normalized and unconfigured profile fields stay null", async () => {
  const formatted = await createProfile({
    contactPhone: "+234 803 123 4567",
    contactPhoneCountry: "NG",
    currencyCode: undefined,
  });

  assert.equal(formatted.contactPhone, "+2348031234567");
  assert.equal(formatted.contactPhoneCountry, "NG");
  assert.equal(formatted.currencyCode, null);

  const blankResponse = await jsonRequest(
    "/api/business/profile",
    "PATCH",
    {
      ...validProfileBody,
      contactPhone: null,
      contactPhoneCountry: null,
      currencyCode: null,
    },
  );
  assert.equal(blankResponse.status, 200);
  const blank = await readJson<ProfilePayload>(blankResponse);

  assert.equal(blank.profile?.contactPhone, null);
  assert.equal(blank.profile?.contactPhoneCountry, null);
  assert.equal(blank.profile?.currencyCode, null);
});

test("business profile rejects invalid phone, country, and currency values", async () => {
  const cases = [
    {
      body: {
        ...validProfileBody,
        contactPhone: "not-a-phone",
        contactPhoneCountry: "NG",
      },
      field: "body.contactPhone",
    },
    {
      body: {
        ...validProfileBody,
        contactPhone: "+2348031234567",
        contactPhoneCountry: "XX",
      },
      field: "body.contactPhoneCountry",
    },
    {
      body: {
        ...validProfileBody,
        contactPhone: "+2348031234567",
        contactPhoneCountry: "US",
      },
      field: "body.contactPhoneCountry",
    },
    {
      body: {
        ...validProfileBody,
        contactPhone: "+2348031234567",
        contactPhoneCountry: "ng",
      },
      field: "body.contactPhoneCountry",
    },
    {
      body: {
        ...validProfileBody,
        currencyCode: "ZZZ",
      },
      field: "body.currencyCode",
    },
  ];

  for (const testCase of cases) {
    const response = await jsonRequest(
      "/api/business/profile",
      "POST",
      testCase.body,
    );
    const payload = await readJson<ErrorPayload>(response);

    assert.equal(response.status, 400);
    assert.ok(
      payload.details?.some(
        (detail) =>
          typeof detail === "object" &&
          detail !== null &&
          "field" in detail &&
          detail.field === testCase.field,
      ),
      `expected a ${testCase.field} validation error`,
    );
  }
});

test("changing the profile currency does not rewrite catalogue entries", async () => {
  const profile = await createProfile();
  const catalogue = await createCatalogue({
    name: "Currency-safe service",
    priceMinor: 150_000,
    currencyCode: "NGN",
  });
  const updateResponse = await jsonRequest(
    "/api/business/profile",
    "PATCH",
    {
      ...validProfileBody,
      currencyCode: "USD",
    },
  );

  assert.equal(updateResponse.status, 200);
  const updated = await readJson<ProfilePayload>(updateResponse);
  assert.equal(updated.profile?.currencyCode, "USD");

  const listResponse = await fetch(`${baseUrl}/api/business/catalogue`);
  const list = await readJson<CatalogueListPayload>(listResponse);
  const stored = list.entries.find((entry) => entry.id === catalogue.id);

  assert.ok(stored);
  assert.equal(stored.currencyCode, "NGN");
  assert.equal(stored.priceMinor, 150_000);
  assert.equal(profile.currencyCode, "NGN");
});

test("opening-hours schedule round-trips through persistence and reload", async () => {
  const savedSchedule = scheduleFromOpeningHours([
    { day: "monday", opensAt: "08:30", closesAt: "17:30" },
    { day: "wednesday", opensAt: "10:00", closesAt: "19:00" },
    { day: "friday", opensAt: "09:00", closesAt: "16:00" },
  ]);

  const profile = await createProfile({
    openingHours: openingHoursFromSchedule(savedSchedule.schedule),
  });

  const getResponse = await fetch(`${baseUrl}/api/business/profile`);
  assert.equal(getResponse.status, 200);
  const payload = await readJson<ProfilePayload>(getResponse);
  assert.ok(payload.profile);

  const reloaded = scheduleFromOpeningHours(payload.profile.openingHours);
  assert.deepEqual(reloaded.schedule, savedSchedule.schedule);
  assert.deepEqual(reloaded.issues, []);
  assert.deepEqual(payload.profile.openingHours, profile.openingHours);

  const withoutTuesday = setDayOpen(reloaded.schedule, "tuesday", false);
  const updateResponse = await jsonRequest(
    "/api/business/profile",
    "PATCH",
    {
      ...validProfileBody,
      openingHours: openingHoursFromSchedule(withoutTuesday),
    },
  );
  assert.equal(updateResponse.status, 200);

  const updated = await readJson<ProfilePayload>(updateResponse);
  assert.ok(updated.profile);
  const updatedSchedule = scheduleFromOpeningHours(updated.profile.openingHours);
  const tuesday = updatedSchedule.schedule.find(
    (entry) => entry.day === "tuesday",
  );
  const monday = updatedSchedule.schedule.find(
    (entry) => entry.day === "monday",
  );

  assert.equal(tuesday?.isOpen, false);
  assert.equal(monday?.isOpen, true);
  assert.equal(monday?.opensAt, "08:30");
  assert.deepEqual(updatedSchedule.issues, []);
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
        INSERT INTO catalogue_entries (
          workspace_id, name, price_minor, currency_code
        )
        VALUES (
          $1, 'Unsafe direct insert', 9007199254740992, 'NGN'
        )
      `,
      [requireSession().workspace.id],
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
  const context = await buildReplyContext(pool, requireSession().workspace.id, makeLead());

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

  const afterDeactivation = await buildReplyContext(pool, requireSession().workspace.id, makeLead());
  assert.deepEqual(afterDeactivation.catalogue, []);
  assert.deepEqual(afterDeactivation.knowledge, []);
});

test("unrelated enquiries receive no unrelated business facts", async () => {
  await createBusinessFixture();

  const context = await buildReplyContext(
    pool,
    requireSession().workspace.id,
    makeLead({
      service: "Podcast editing",
      lastMessage: "How much for audio cleanup?",
    }),
  );

  assert.deepEqual(context.catalogue, []);
  assert.deepEqual(context.knowledge, []);
});

test("empty profiles and knowledge bases produce safe empty context", async () => {
  const context = await buildReplyContext(pool, requireSession().workspace.id, makeLead());

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
  const catalogue = makeCatalogueEntry({ priceMinor: 150_000 });
  const knowledge = makeKnowledgeEntry();
  const context = makeContext({
    catalogue: [catalogue],
    knowledge: [knowledge],
  });

  const draft = await provider.draftReply(lead, context);

  assert.equal(draft.provider, "mock");
  assert.equal(draft.isDemo, true);
  assert.match(draft.draftReply, /NGN 1,500\.00/);
  assert.match(draft.draftReply, /Travel within the city is included\./);
  assert.deepEqual(
    draft.sources.map((source) => [source.type, source.id]),
    [
      ["catalogue", catalogue.id],
      ["faq", knowledge.id],
    ],
  );
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
  assert.equal(
    draft.sources[0]?.content,
    `Refund details: ${"a".repeat(800)}`,
  );
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

test("saved reply drafts include only active relevant facts and a server snapshot", async () => {
  const fixture = await createBusinessFixture();
  const lead = await createDraftLead();
  const response = await createSavedDraft(lead.id);

  assert.equal(response.status, 201);
  const draft = (await readJson<ReplyDraftPayload>(response)).draft;

  assert.equal(draft.leadId, lead.id);
  assert.equal(draft.intent, "pricing");
  assert.equal(draft.status, "draft");
  assert.equal(draft.approvedAt, null);
  assert.equal(draft.provider, "mock");
  assert.equal(draft.isDemo, true);
  assert.match(draft.draftReply, /NGN 1,500\.00/);
  assert.match(draft.draftReply, /Travel within the city is included\./);
  assert.doesNotMatch(draft.draftReply, /99,900\.00/);
  assert.doesNotMatch(draft.draftReply, /14 days before the event/);
  assert.ok(draft.missingInformation.length > 0);

  assert.deepEqual(
    draft.sources.map((source) => [source.type, source.id]),
    [
      ["catalogue", fixture.activeCatalogue.id],
      ["faq", fixture.activeFaq.id],
    ],
  );

  const catalogueSource = draft.sources[0];
  assert.equal(catalogueSource?.title, "Wedding photography");
  assert.equal(catalogueSource?.priceMinor, 150_000);
  assert.equal(catalogueSource?.currencyCode, "NGN");
  assert.match(catalogueSource?.content ?? "", /NGN 1,500\.00/);
  assert.match(catalogueSource?.reason ?? "", /keyword match/i);
  assert.match(catalogueSource?.reason ?? "", /not semantic retrieval/i);

  const faqSource = draft.sources[1];
  assert.equal(faqSource?.title, "Travel for weddings");
  assert.equal(
    faqSource?.content,
    "Travel within the city is included.",
  );
  assert.match(faqSource?.reason ?? "", /keyword match/i);

  assert.ok(
    !draft.sources.some(
      (source) => source.id === fixture.inactiveCatalogue.id,
    ),
  );
  assert.ok(
    !draft.sources.some((source) => source.id === fixture.unrelatedFaq.id),
  );
  assert.ok(
    !draft.sources.some((source) => source.id === fixture.inactivePolicy.id),
  );

  const stored = await pool.query<{
    lead_id: string;
    status: string;
    approved_at: Date | null;
    missing_information: unknown;
    sources: unknown;
    draft_reply: string;
  }>(
    `
      SELECT lead_id, status, approved_at, missing_information, sources,
             draft_reply
      FROM reply_drafts
    `,
  );

  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0]?.lead_id, lead.id);
  assert.equal(stored.rows[0]?.status, "draft");
  assert.equal(stored.rows[0]?.approved_at, null);
  assert.equal(stored.rows[0]?.draft_reply, draft.draftReply);
  assert.deepEqual(
    stored.rows[0]?.missing_information,
    draft.missingInformation,
  );
  assert.deepEqual(stored.rows[0]?.sources, draft.sources);

  const listed = await readJson<ReplyDraftsPayload>(
    await listSavedDrafts(lead.id),
  );
  assert.equal(listed.drafts.length, 1);
  assert.equal(listed.drafts[0]?.id, draft.id);
});

test("saved drafts do not report unrelated facts or invent business commitments", async () => {
  await createBusinessFixture();
  const lead = await createDraftLead({
    name: "Tunde Okafor",
    service: "Podcast editing",
    lastMessage: "How much for audio cleanup?",
  });
  const response = await createSavedDraft(lead.id);

  assert.equal(response.status, 201);
  const draft = (await readJson<ReplyDraftPayload>(response)).draft;

  assert.deepEqual(draft.sources, []);
  assert.doesNotMatch(
    draft.draftReply,
    /NGN|USD|99,900|14 days|Travel within the city|free/i,
  );
  assert.ok(draft.missingInformation.length > 0);
  assert.ok(
    draft.missingInformation.some((item) => /approved price/i.test(item)),
  );
});

test("browser-supplied source snapshots are rejected", async () => {
  const fixture = await createBusinessFixture();
  const lead = await createDraftLead();
  const response = await createSavedDraft(lead.id, {
    sources: [
      {
        id: fixture.activeCatalogue.id,
        type: "catalogue",
        title: "Free wedding photography",
        content: "Everything is free.",
        reason: "Browser supplied",
        priceMinor: 0,
        currencyCode: "NGN",
      },
    ],
  });

  assert.equal(response.status, 400);
  const payload = await readJson<ErrorPayload>(response);
  assert.equal(payload.error, "Invalid request");

  const stored = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM reply_drafts",
  );
  assert.equal(stored.rows[0]?.count, 0);
});

test("saved drafts are isolated by lead and cannot be changed through another lead", async () => {
  const firstLead = await createDraftLead({
    name: "Sarah Musa",
    lastMessage: "Are you available for a wedding in Jos?",
  });
  const secondLead = await createDraftLead({
    name: "Daniel James",
    lastMessage: "Please share your decoration packages.",
  });

  const firstDraft = (
    await readJson<ReplyDraftPayload>(await createSavedDraft(firstLead.id))
  ).draft;
  const secondDraft = (
    await readJson<ReplyDraftPayload>(await createSavedDraft(secondLead.id))
  ).draft;

  const firstList = await readJson<ReplyDraftsPayload>(
    await listSavedDrafts(firstLead.id),
  );
  const secondList = await readJson<ReplyDraftsPayload>(
    await listSavedDrafts(secondLead.id),
  );

  assert.deepEqual(
    firstList.drafts.map((draft) => draft.id),
    [firstDraft.id],
  );
  assert.deepEqual(
    secondList.drafts.map((draft) => draft.id),
    [secondDraft.id],
  );

  const unrelatedPatch = await patchSavedDraft(
    secondLead.id,
    firstDraft.id,
    { draftReply: "This must not be saved." },
  );
  assert.equal(unrelatedPatch.status, 404);
  assert.deepEqual(await readJson(unrelatedPatch), {
    error: "Reply draft not found",
  });

  const unrelatedRegenerate = await createSavedDraft(secondLead.id, {
    draftId: firstDraft.id,
  });
  assert.equal(unrelatedRegenerate.status, 404);

  const unchanged = await readJson<ReplyDraftsPayload>(
    await listSavedDrafts(firstLead.id),
  );
  assert.equal(unchanged.drafts[0]?.draftReply, firstDraft.draftReply);

  const stored = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM reply_drafts",
  );
  assert.equal(stored.rows[0]?.count, 2);
});

test("approval and editing transitions persist safely", async () => {
  const lead = await createDraftLead();
  const created = (
    await readJson<ReplyDraftPayload>(await createSavedDraft(lead.id))
  ).draft;

  assert.equal(created.status, "draft");
  assert.equal(created.approvedAt, null);

  const approveResponse = await patchSavedDraft(lead.id, created.id, {
    status: "approved",
  });
  assert.equal(approveResponse.status, 200);
  const approved = (
    await readJson<ReplyDraftPayload>(approveResponse)
  ).draft;

  assert.equal(approved.status, "approved");
  assert.ok(approved.approvedAt);
  assert.ok(Number.isFinite(Date.parse(approved.approvedAt ?? "")));

  const editAndApprove = await patchSavedDraft(lead.id, created.id, {
    draftReply: "I have edited this reply.",
    status: "approved",
  });
  assert.equal(editAndApprove.status, 400);
  const invalid = await readJson<ErrorPayload>(editAndApprove);
  assert.equal(invalid.error, "Invalid request");

  const stillApproved = await readJson<ReplyDraftsPayload>(
    await listSavedDrafts(lead.id),
  );
  assert.equal(stillApproved.drafts[0]?.status, "approved");
  assert.equal(stillApproved.drafts[0]?.draftReply, created.draftReply);

  const editResponse = await patchSavedDraft(lead.id, created.id, {
    draftReply: "Thanks for your enquiry. I will confirm the details.",
  });
  assert.equal(editResponse.status, 200);
  const edited = (await readJson<ReplyDraftPayload>(editResponse)).draft;

  assert.equal(edited.status, "draft");
  assert.equal(edited.approvedAt, null);
  assert.equal(
    edited.draftReply,
    "Thanks for your enquiry. I will confirm the details.",
  );

  const reapproveResponse = await patchSavedDraft(lead.id, created.id, {
    status: "approved",
  });
  assert.equal(reapproveResponse.status, 200);

  const returnResponse = await patchSavedDraft(lead.id, created.id, {
    status: "draft",
  });
  assert.equal(returnResponse.status, 200);
  const returned = (await readJson<ReplyDraftPayload>(returnResponse)).draft;

  assert.equal(returned.status, "draft");
  assert.equal(returned.approvedAt, null);

  const refetched = await readJson<ReplyDraftsPayload>(
    await listSavedDrafts(lead.id),
  );
  assert.equal(refetched.drafts[0]?.status, "draft");
  assert.equal(refetched.drafts[0]?.draftReply, edited.draftReply);
});

test("regeneration updates the same draft, refreshes facts, and resets approval", async () => {
  const fixture = await createBusinessFixture();
  const lead = await createDraftLead();
  const created = (
    await readJson<ReplyDraftPayload>(await createSavedDraft(lead.id))
  ).draft;

  const approved = await patchSavedDraft(lead.id, created.id, {
    status: "approved",
  });
  assert.equal(approved.status, 200);

  const catalogueUpdate = await jsonRequest(
    `/api/business/catalogue/${fixture.activeCatalogue.id}`,
    "PATCH",
    {
      name: "Wedding photography",
      description: "Full-day wedding coverage with a second photographer.",
      priceMinor: 200_000,
      currencyCode: "NGN",
      availabilityNotes: "Weekends by arrangement.",
      isActive: true,
    },
  );
  assert.equal(catalogueUpdate.status, 200);

  const knowledgeUpdate = await jsonRequest(
    `/api/business/knowledge/${fixture.activeFaq.id}`,
    "PATCH",
    {
      title: "Travel for weddings",
      answer: "Travel within 50km is included.",
      entryType: "faq",
      isActive: true,
    },
  );
  assert.equal(knowledgeUpdate.status, 200);

  const regenerateResponse = await createSavedDraft(lead.id, {
    draftId: created.id,
  });
  assert.equal(regenerateResponse.status, 200);
  const regenerated = (
    await readJson<ReplyDraftPayload>(regenerateResponse)
  ).draft;

  assert.equal(regenerated.id, created.id);
  assert.equal(regenerated.createdAt, created.createdAt);
  assert.equal(regenerated.status, "draft");
  assert.equal(regenerated.approvedAt, null);
  assert.match(regenerated.draftReply, /NGN 2,000\.00/);
  assert.match(regenerated.draftReply, /Travel within 50km is included\./);

  const catalogueSource = regenerated.sources.find(
    (source) => source.type === "catalogue",
  );
  assert.equal(catalogueSource?.priceMinor, 200_000);
  assert.match(catalogueSource?.content ?? "", /NGN 2,000\.00/);
  assert.match(
    catalogueSource?.content ?? "",
    /second photographer/,
  );

  const faqSource = regenerated.sources.find(
    (source) => source.type === "faq",
  );
  assert.equal(faqSource?.content, "Travel within 50km is included.");

  const stored = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM reply_drafts",
  );
  assert.equal(stored.rows[0]?.count, 1);
});

test("saved source snapshots survive later business edits and deactivation", async () => {
  const fixture = await createBusinessFixture();
  const lead = await createDraftLead();
  const created = (
    await readJson<ReplyDraftPayload>(await createSavedDraft(lead.id))
  ).draft;
  const originalSources = JSON.parse(
    JSON.stringify(created.sources),
  ) as ReplyDraftSourcePayload[];

  const catalogueUpdate = await jsonRequest(
    `/api/business/catalogue/${fixture.activeCatalogue.id}`,
    "PATCH",
    {
      name: "Wedding cinematography",
      description: "A completely rewritten description.",
      priceMinor: 999_000,
      currencyCode: "NGN",
      availabilityNotes: "Limited dates.",
      isActive: true,
    },
  );
  assert.equal(catalogueUpdate.status, 200);

  const knowledgeDelete = await jsonRequest(
    `/api/business/knowledge/${fixture.activeFaq.id}`,
    "DELETE",
  );
  assert.equal(knowledgeDelete.status, 200);

  const refetched = await readJson<ReplyDraftsPayload>(
    await listSavedDrafts(lead.id),
  );
  const draft = refetched.drafts[0];

  assert.equal(draft?.id, created.id);
  assert.equal(draft?.draftReply, created.draftReply);
  assert.equal(draft?.createdAt, created.createdAt);
  assert.deepEqual(draft?.sources, originalSources);
  assert.match(
    draft?.sources[0]?.content ?? "",
    /NGN 1,500\.00/,
  );
  assert.doesNotMatch(
    draft?.sources[0]?.content ?? "",
    /999,000|completely rewritten/i,
  );
  assert.equal(
    draft?.sources[1]?.content,
    "Travel within the city is included.",
  );
});

test("reply draft routes return safe errors for invalid and missing records", async () => {
  const invalidLead = await createSavedDraft("not-a-uuid");
  assert.equal(invalidLead.status, 400);
  assert.deepEqual((await readJson<ErrorPayload>(invalidLead)).details?.[0], {
    field: "id",
    message: "Invalid UUID",
  });

  const unknownLeadCreate = await createSavedDraft(randomUUID());
  assert.equal(unknownLeadCreate.status, 404);
  assert.deepEqual(await readJson(unknownLeadCreate), {
    error: "Lead not found",
  });

  const unknownLeadList = await listSavedDrafts(randomUUID());
  assert.equal(unknownLeadList.status, 404);
  assert.deepEqual(await readJson(unknownLeadList), {
    error: "Lead not found",
  });

  const lead = await createDraftLead();
  const created = (
    await readJson<ReplyDraftPayload>(await createSavedDraft(lead.id))
  ).draft;

  const invalidDraftId = await patchSavedDraft(
    lead.id,
    "not-a-uuid",
    { status: "approved" },
  );
  assert.equal(invalidDraftId.status, 400);
  const invalidDraftPayload = await readJson<ErrorPayload>(invalidDraftId);
  assert.ok(
    invalidDraftPayload.details?.some(
      (detail) =>
        typeof detail === "object" &&
        detail !== null &&
        "field" in detail &&
        detail.field === "draftId",
    ),
  );

  const unknownDraft = await patchSavedDraft(lead.id, randomUUID(), {
    status: "approved",
  });
  assert.equal(unknownDraft.status, 404);
  assert.deepEqual(await readJson(unknownDraft), {
    error: "Reply draft not found",
  });

  const emptyPatch = await patchSavedDraft(lead.id, created.id, {});
  assert.equal(emptyPatch.status, 400);

  const invalidStatus = await patchSavedDraft(lead.id, created.id, {
    status: "sent",
  });
  assert.equal(invalidStatus.status, 400);

  const invalidRegeneration = await createSavedDraft(lead.id, {
    draftId: randomUUID(),
  });
  assert.equal(invalidRegeneration.status, 404);
  assert.deepEqual(await readJson(invalidRegeneration), {
    error: "Reply draft not found",
  });

  const wrongLead = await patchSavedDraft(randomUUID(), created.id, {
    status: "approved",
  });
  assert.equal(wrongLead.status, 404);
  assert.deepEqual(await readJson(wrongLead), { error: "Lead not found" });

  const stored = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM reply_drafts",
  );
  assert.equal(stored.rows[0]?.count, 1);
});

test("saved draft generation handles provider failures and ungrounded sources", async () => {
  const fixture = await createBusinessFixture();
  const lead = await createDraftLead();

  const failingProvider: ReplyDraftProvider = {
    async draftReply() {
      throw new Error("Provider unavailable");
    },
  };

  const failingServer = await startServer(pool, failingProvider);

  try {
    const response = await fetch(
      `${failingServer.baseUrl}/api/leads/${lead.id}/reply-drafts`,
      { method: "POST" },
    );
    assert.equal(response.status, 500);
    assert.deepEqual(await readJson(response), {
      error: "Internal server error",
    });
  } finally {
    await stopServer(failingServer.server);
  }

  const ungroundedSource = {
    id: randomUUID(),
    type: "catalogue",
    title: "Invented package",
    content: "Everything is free.",
    reason: "Invented source",
    priceMinor: 0,
    currencyCode: "NGN",
  };
  const ungroundedProvider: ReplyDraftProvider = {
    async draftReply() {
      return {
        intent: "pricing",
        summary: "A pricing enquiry.",
        missingInformation: [],
        draftReply: "A safe reply.",
        provider: "mock",
        isDemo: true,
        sources: [ungroundedSource],
      };
    },
  };

  const ungroundedServer = await startServer(pool, ungroundedProvider);

  try {
    const response = await fetch(
      `${ungroundedServer.baseUrl}/api/leads/${lead.id}/reply-drafts`,
      { method: "POST" },
    );
    assert.equal(response.status, 500);
    assert.deepEqual(await readJson(response), {
      error: "Internal server error",
    });
  } finally {
    await stopServer(ungroundedServer.server);
  }

  const stored = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM reply_drafts",
  );
  assert.equal(stored.rows[0]?.count, 0);

  const misleadingProvider: ReplyDraftProvider = {
    async draftReply() {
      return {
        intent: "pricing",
        summary: "A pricing enquiry.",
        missingInformation: [],
        draftReply: "A safe reply.",
        provider: "mock",
        isDemo: true,
        sources: [
          {
            id: fixture.activeCatalogue.id,
            type: "catalogue",
            title: "Free wedding photography",
            content: "Everything is free.",
            reason: "Fabricated content",
            priceMinor: 0,
            currencyCode: "NGN",
          },
        ],
      };
    },
  };

  const misleadingServer = await startServer(pool, misleadingProvider);

  try {
    const response = await fetch(
      `${misleadingServer.baseUrl}/api/leads/${lead.id}/reply-drafts`,
      { method: "POST" },
    );
    assert.equal(response.status, 201);
    const draft = (await readJson<ReplyDraftPayload>(response)).draft;
    const source = draft.sources[0];

    assert.equal(source?.id, fixture.activeCatalogue.id);
    assert.equal(source?.title, "Wedding photography");
    assert.equal(source?.priceMinor, 150_000);
    assert.match(source?.content ?? "", /NGN 1,500\.00/);
    assert.doesNotMatch(source?.content ?? "", /Everything is free/i);
    assert.match(source?.reason ?? "", /keyword match/i);
  } finally {
    await stopServer(misleadingServer.server);
  }
});

test("re-running migrations preserves existing leads, business data, and reply drafts", async () => {
  await createBusinessFixture();
  const lead = await createDraftLead();
  const draft = (
    await readJson<ReplyDraftPayload>(await createSavedDraft(lead.id))
  ).draft;

  const applied = await runMigrations(pool);
  assert.deepEqual(applied, []);

  const migration = await pool.query<{ version: string }>(
    "SELECT version FROM schema_migrations WHERE version = $1",
    ["005_create_reply_drafts.sql"],
  );
  assert.equal(migration.rows.length, 1);

  const list = await readJson<LeadsPayload>(await fetch(`${baseUrl}/api/leads`));
  assert.ok(list.leads.some((item) => item.id === lead.id));

  const drafts = await readJson<ReplyDraftsPayload>(
    await listSavedDrafts(lead.id),
  );
  assert.equal(drafts.drafts[0]?.id, draft.id);
  assert.deepEqual(drafts.drafts[0]?.sources, draft.sources);

  const counts = await pool.query<{
    leads: number;
    reply_drafts: number;
    catalogue_entries: number;
    knowledge_entries: number;
  }>(`
    SELECT
      (SELECT count(*) FROM leads)::int AS leads,
      (SELECT count(*) FROM reply_drafts)::int AS reply_drafts,
      (SELECT count(*) FROM catalogue_entries)::int AS catalogue_entries,
      (SELECT count(*) FROM knowledge_entries)::int AS knowledge_entries
  `);
  assert.deepEqual(counts.rows[0], {
    leads: 1,
    reply_drafts: 1,
    catalogue_entries: 2,
    knowledge_entries: 3,
  });
});

test("registration creates a session and an owner workspace", async () => {
  const session = await registerUser({
    email: `new-owner-${randomUUID()}@example.test`,
    name: "Ada Photographer",
  });

  assert.equal(session.role, "owner");
  assert.match(session.workspace.id, /^[0-9a-f-]{36}$/i);
  assert.match(session.workspace.name, /Ada Photographer/);

  const workspace = await requestAs(session, "/api/workspace");
  assert.equal(workspace.status, 200);
  const payload = await readJson<{
    user: { id: string; email: string };
    workspace: { id: string; name: string };
    role: "owner" | "member";
  }>(workspace);

  assert.equal(payload.user.id, session.user.id);
  assert.equal(payload.workspace.id, session.workspace.id);
  assert.equal(payload.role, "owner");

  const membership = await pool.query<{
    role: string;
    is_default: boolean;
    workspace_id: string;
  }>(
    `
      SELECT role, is_default, workspace_id
      FROM workspace_memberships
      WHERE user_id = $1
    `,
    [session.user.id],
  );

  assert.deepEqual(membership.rows, [
    {
      role: "owner",
      is_default: true,
      workspace_id: session.workspace.id,
    },
  ]);
});

test("sign-in returns a usable HTTP-only session cookie", async () => {
  const response = await signInRequest(
    requireSession().email,
    requireSession().password,
  );

  assert.equal(response.status, 200);

  const setCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.().join("\n") ?? response.headers.get("set-cookie") ?? "";

  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.doesNotMatch(setCookie, /Secure/i);

  const cookie = cookieHeader(response.headers);
  assert.ok(cookie);

  const sessionResponse = await nativeFetch(
    `${baseUrl}/api/auth/get-session`,
    {
      headers: {
        cookie,
        "x-forwarded-for": TEST_CLIENT_IP,
      },
    },
  );
  assert.equal(sessionResponse.status, 200);
  const session = await readJson<{
    user: { id: string };
    session: { id: string };
  }>(sessionResponse);
  assert.equal(session.user.id, requireSession().user.id);
  assert.ok(session.session.id);

  const privateResponse = await nativeFetch(`${baseUrl}/api/workspace`, {
    headers: {
      cookie,
      "x-forwarded-for": TEST_CLIENT_IP,
    },
  });
  assert.equal(privateResponse.status, 200);
});

test("HTTPS auth configuration issues Secure session cookies", async () => {
  const secureOrigin = "https://replypilot.example";
  const secureServer = await startServer(pool, undefined, {
    baseURL: secureOrigin,
    trustedOrigins: [secureOrigin],
  });

  try {
    const response = await nativeFetch(
      `${secureServer.baseUrl}/api/auth/sign-in/email`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: secureOrigin,
          "x-forwarded-for": TEST_CLIENT_IP,
        },
        body: JSON.stringify({
          email: requireSession().email,
          password: requireSession().password,
        }),
      },
    );

    assert.equal(response.status, 200);

    const setCookie =
      (
        response.headers as Headers & { getSetCookie?: () => string[] }
      ).getSetCookie?.().join("\n") ??
      response.headers.get("set-cookie") ??
      "";

    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /(?:^|;\s*)Secure(?:;|$)/i);
  } finally {
    await stopServer(secureServer.server);
  }
});

test("duplicate registration and invalid credentials are rejected", async () => {
  const duplicate = await nativeFetch(
    `${baseUrl}/api/auth/sign-up/email`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        email: requireSession().email,
        password: "another-secure-password",
        name: "Duplicate",
      }),
    },
  );
  assert.equal(duplicate.status, 422);

  const invalid = await signInRequest(
    requireSession().email,
    "incorrect-password",
  );
  assert.equal(invalid.status, 401);

  const weakPassword = await nativeFetch(
    `${baseUrl}/api/auth/sign-up/email`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        email: `weak-${randomUUID()}@example.test`,
        password: "short",
        name: "Weak Password",
      }),
    },
  );
  assert.equal(weakPassword.status, 400);
});

test("unauthenticated requests cannot access private business routes", async () => {
  for (const path of [
    "/api/workspace",
    "/api/leads",
    "/api/business/profile",
    "/api/business/catalogue",
    "/api/business/knowledge",
    "/api/whatsapp/conversations",
    `/api/whatsapp/conversations/${randomUUID()}/messages`,
  ]) {
    const response = await nativeFetch(`${baseUrl}${path}`, {
      headers: { "x-forwarded-for": TEST_CLIENT_IP },
    });
    assert.equal(response.status, 401, path);
    assert.deepEqual(await readJson(response), {
      error: "Authentication required",
    });
  }

  const create = await nativeFetch(`${baseUrl}/api/leads`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": TEST_CLIENT_IP,
    },
    body: JSON.stringify({
      name: "Anonymous",
      service: "Wedding photography",
      lastMessage: "Hello",
    }),
  });
  assert.equal(create.status, 401);

  const health = await nativeFetch(`${baseUrl}/api/health`, {
    headers: { "x-forwarded-for": TEST_CLIENT_IP },
  });
  assert.equal(health.status, 200);
});

test("sign-out invalidates the server-side session", async () => {
  const cookie = requireSession().cookie;
  const signOut = await nativeFetch(`${baseUrl}/api/auth/sign-out`, {
    method: "POST",
    headers: {
      ...Object.fromEntries(authHeaders().entries()),
      cookie,
    },
  });
  assert.equal(signOut.status, 200);

  const privateResponse = await nativeFetch(`${baseUrl}/api/workspace`, {
    headers: {
      cookie,
      "x-forwarded-for": TEST_CLIENT_IP,
    },
  });
  assert.equal(privateResponse.status, 401);
});

test("expired and malformed sessions are rejected", async () => {
  await pool.query(
    `
      UPDATE auth_sessions
      SET expires_at = now() - interval '1 minute'
      WHERE user_id = $1
    `,
    [requireSession().user.id],
  );

  const expired = await fetch(`${baseUrl}/api/workspace`);
  assert.equal(expired.status, 401);

  const malformed = await nativeFetch(`${baseUrl}/api/workspace`, {
    headers: {
      cookie: "better-auth.session_token=not-a-real-session",
      "x-forwarded-for": TEST_CLIENT_IP,
    },
  });
  assert.equal(malformed.status, 401);
});

test("authentication rejects missing and untrusted origins", async () => {
  const body = JSON.stringify({
    email: requireSession().email,
    password: requireSession().password,
  });

  const missingOrigin = await nativeFetch(
    `${baseUrl}/api/auth/sign-in/email`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": TEST_CLIENT_IP,
      },
      body,
    },
  );
  assert.equal(missingOrigin.status, 403);

  const untrustedOrigin = await nativeFetch(
    `${baseUrl}/api/auth/sign-in/email`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
        "x-forwarded-for": TEST_CLIENT_IP,
      },
      body,
    },
  );
  assert.equal(untrustedOrigin.status, 403);
});

test("authentication rate limits repeated sign-in attempts", async () => {
  const limited = await startServer(pool, undefined, {
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
    },
  });

  try {
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await nativeFetch(
        `${limited.baseUrl}/api/auth/sign-in/email`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: TEST_AUTH_ORIGIN,
            "x-forwarded-for": "198.51.100.25",
          },
          body: JSON.stringify({
            email: requireSession().email,
            password: requireSession().password,
          }),
        },
      );
      statuses.push(response.status);
    }

    assert.deepEqual(statuses, [200, 200, 200, 429]);
  } finally {
    await stopServer(limited.server);
  }
});

test("legacy workspace bootstrap requires explicit guarded CLI input", async () => {
  const user = requireSession();
  const legacy = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM workspaces WHERE id = $1",
    [LEGACY_WORKSPACE_ID],
  );
  assert.equal(legacy.rows[0]?.count, 1);

  const before = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM workspace_memberships WHERE workspace_id = $1",
    [LEGACY_WORKSPACE_ID],
  );
  assert.equal(before.rows[0]?.count, 0);

  await assert.rejects(
    () =>
      bootstrapLegacyWorkspace(pool, {
        userId: user.user.id,
        confirm: false,
      }),
    /--confirm/,
  );
  await assert.rejects(
    () =>
      bootstrapLegacyWorkspace(pool, {
        userId: user.user.id,
        userEmail: user.email,
        confirm: true,
      }),
    /exactly one/,
  );
  await assert.rejects(
    () =>
      bootstrapLegacyWorkspace(pool, {
        userId: randomUUID(),
        confirm: true,
      }),
    /No registered account/,
  );

  const bootstrapped = await bootstrapLegacyWorkspace(pool, {
    userId: user.user.id,
    confirm: true,
  });

  assert.equal(bootstrapped.workspace.id, LEGACY_WORKSPACE_ID);
  assert.equal(bootstrapped.workspace.name, "Legacy development workspace");
  assert.equal(bootstrapped.membership.role, "owner");
  assert.equal(bootstrapped.membership.isDefault, true);

  const memberships = await listMembershipsForUser(pool, user.user.id);
  assert.equal(memberships.length, 2);
  assert.equal(memberships.filter((membership) => membership.isDefault).length, 1);
  assert.equal(
    memberships.find((membership) => membership.isDefault)?.workspaceId,
    LEGACY_WORKSPACE_ID,
  );

  await assert.rejects(
    () =>
      bootstrapLegacyWorkspace(pool, {
        userEmail: user.email,
        confirm: true,
      }),
    /already has a member/,
  );

  const publicEndpoint = await requestAs(
    user,
    "/api/workspace/bootstrap",
    "POST",
    {},
  );
  assert.equal(publicEndpoint.status, 404);
});

test("workspace data is isolated across all business resources", async () => {
  const ownerA = requireSession();
  const profileA = await createProfile({ businessName: "Alpha Studio" });
  const catalogueA = await createCatalogue({
    name: "Alpha wedding photography",
    description: "Alpha full-day coverage.",
    priceMinor: 100_000,
    currencyCode: "NGN",
  });
  const knowledgeA = await createKnowledge({
    title: "Alpha travel policy",
    answer: "Alpha travels within the city.",
    entryType: "faq",
  });
  const leadA = await createDraftLead({ name: "Alpha Client" });
  const draftA = (
    await readJson<ReplyDraftPayload>(
      await createSavedDraft(leadA.id),
    )
  ).draft;

  const ownerB = await registerUser({
    email: `owner-b-${randomUUID()}@example.test`,
    name: "Beta Studio",
  });

  currentSession = ownerB;
  const profileB = await createProfile({
    businessName: "Beta Studio",
    contactEmail: "beta@example.test",
    contactPhone: "+2348037654321",
  });
  const catalogueB = await createCatalogue({
    name: "Beta wedding photography",
    description: "Beta full-day coverage.",
    priceMinor: 200_000,
    currencyCode: "USD",
  });
  const knowledgeB = await createKnowledge({
    title: "Beta travel policy",
    answer: "Beta travels nationwide.",
    entryType: "policy",
  });
  const leadB = await createDraftLead({
    name: "Beta Client",
    lastMessage: "How much is Beta wedding photography?",
  });
  const draftB = (
    await readJson<ReplyDraftPayload>(
      await createSavedDraft(leadB.id),
    )
  ).draft;
  currentSession = ownerA;

  try {
    const leads = await readJson<LeadsPayload>(
      await fetch(`${baseUrl}/api/leads`),
    );
    assert.deepEqual(
      leads.leads.map((lead) => lead.id),
      [leadA.id],
    );

    const catalogue = await readJson<CatalogueListPayload>(
      await fetch(`${baseUrl}/api/business/catalogue`),
    );
    assert.deepEqual(
      catalogue.entries.map((entry) => entry.id),
      [catalogueA.id],
    );

    const knowledge = await readJson<KnowledgeListPayload>(
      await fetch(`${baseUrl}/api/business/knowledge`),
    );
    assert.deepEqual(
      knowledge.entries.map((entry) => entry.id),
      [knowledgeA.id],
    );

    const profile = await readJson<ProfilePayload>(
      await fetch(`${baseUrl}/api/business/profile`),
    );
    assert.equal(profile.profile?.id, profileA.id);
    assert.equal(profile.profile?.businessName, "Alpha Studio");
    assert.doesNotMatch(JSON.stringify(profile), /Beta Studio/);

    const crossLeadRead = await requestAs(
      ownerA,
      `/api/leads/${leadB.id}/reply-drafts`,
    );
    assert.equal(crossLeadRead.status, 404);

    const crossLeadUpdate = await requestAs(
      ownerA,
      `/api/leads/${leadB.id}`,
      "PATCH",
      { status: "Booked" },
    );
    assert.equal(crossLeadUpdate.status, 404);

    const crossDraftGeneration = await requestAs(
      ownerA,
      `/api/leads/${leadB.id}/draft-reply`,
      "POST",
    );
    assert.equal(crossDraftGeneration.status, 404);

    const crossDraftCreate = await requestAs(
      ownerA,
      `/api/leads/${leadB.id}/reply-drafts`,
      "POST",
    );
    assert.equal(crossDraftCreate.status, 404);

    const crossDraftApprove = await requestAs(
      ownerA,
      `/api/leads/${leadB.id}/reply-drafts/${draftB.id}`,
      "PATCH",
      { status: "approved" },
    );
    assert.equal(crossDraftApprove.status, 404);

    const crossDraftRegenerate = await requestAs(
      ownerA,
      `/api/leads/${leadB.id}/reply-drafts`,
      "POST",
      { draftId: draftB.id },
    );
    assert.equal(crossDraftRegenerate.status, 404);

    const foreignDraftOnOwnLead = await requestAs(
      ownerA,
      `/api/leads/${leadA.id}/reply-drafts/${draftB.id}`,
      "PATCH",
      { status: "approved" },
    );
    assert.equal(foreignDraftOnOwnLead.status, 404);

    const crossCatalogueUpdate = await requestAs(
      ownerA,
      `/api/business/catalogue/${catalogueB.id}`,
      "PATCH",
      {
        name: "Hijacked catalogue",
        description: "Hijacked.",
        priceMinor: 1,
        currencyCode: "NGN",
      },
    );
    assert.equal(crossCatalogueUpdate.status, 404);

    const crossCatalogueDelete = await requestAs(
      ownerA,
      `/api/business/catalogue/${catalogueB.id}`,
      "DELETE",
    );
    assert.equal(crossCatalogueDelete.status, 404);

    const crossKnowledgeUpdate = await requestAs(
      ownerA,
      `/api/business/knowledge/${knowledgeB.id}`,
      "PATCH",
      {
        title: "Hijacked knowledge",
        answer: "Hijacked.",
        entryType: "faq",
      },
    );
    assert.equal(crossKnowledgeUpdate.status, 404);

    const crossKnowledgeDelete = await requestAs(
      ownerA,
      `/api/business/knowledge/${knowledgeB.id}`,
      "DELETE",
    );
    assert.equal(crossKnowledgeDelete.status, 404);

    const submittedWorkspaceLead = await postLead({
      name: "Workspace Override",
      service: "Wedding photography",
      lastMessage: "Trying to override ownership.",
      workspaceId: ownerB.workspace.id,
    });
    assert.equal(submittedWorkspaceLead.status, 400);

    const submittedWorkspaceCatalogue = await jsonRequest(
      "/api/business/catalogue",
      "POST",
      {
        name: "Workspace Override",
        description: "",
        priceMinor: 1,
        currencyCode: "NGN",
        workspaceId: ownerB.workspace.id,
      },
    );
    assert.equal(submittedWorkspaceCatalogue.status, 400);

    const submittedWorkspaceProfile = await jsonRequest(
      "/api/business/profile",
      "POST",
      {
        ...validProfileBody,
        businessName: "Workspace Override",
        workspaceId: ownerB.workspace.id,
      },
    );
    assert.equal(submittedWorkspaceProfile.status, 400);

    const counts = await pool.query<{
      workspace_id: string;
      count: number;
    }>(
      `
        SELECT workspace_id, count(*)::int AS count
        FROM leads
        GROUP BY workspace_id
        ORDER BY workspace_id
      `,
    );
    assert.deepEqual(
      Object.fromEntries(
        counts.rows.map((row) => [row.workspace_id, row.count]),
      ),
      {
        [ownerA.workspace.id]: 1,
        [ownerB.workspace.id]: 1,
      },
    );

    currentSession = ownerB;
    const betaLeads = await readJson<LeadsPayload>(
      await fetch(`${baseUrl}/api/leads`),
    );
    assert.deepEqual(
      betaLeads.leads.map((lead) => [lead.id, lead.name, lead.status]),
      [[leadB.id, "Beta Client", "New"]],
    );

    const betaDrafts = await readJson<ReplyDraftsPayload>(
      await listSavedDrafts(leadB.id),
    );
    assert.equal(betaDrafts.drafts.length, 1);
    assert.equal(betaDrafts.drafts[0]?.id, draftB.id);
    assert.equal(betaDrafts.drafts[0]?.status, "draft");
    assert.deepEqual(betaDrafts.drafts[0]?.sources, draftB.sources);

    const betaCatalogue = await readJson<CatalogueListPayload>(
      await fetch(`${baseUrl}/api/business/catalogue`),
    );
    assert.deepEqual(
      betaCatalogue.entries.map((entry) => [
        entry.id,
        entry.name,
        entry.priceMinor,
      ]),
      [[catalogueB.id, "Beta wedding photography", 200_000]],
    );

    const betaProfile = await readJson<ProfilePayload>(
      await fetch(`${baseUrl}/api/business/profile`),
    );
    assert.equal(betaProfile.profile?.id, profileB.id);
    assert.equal(betaProfile.profile?.businessName, "Beta Studio");

    const betaKnowledge = await readJson<KnowledgeListPayload>(
      await fetch(`${baseUrl}/api/business/knowledge`),
    );
    assert.deepEqual(
      betaKnowledge.entries.map((entry) => entry.id),
      [knowledgeB.id],
    );
  } finally {
    currentSession = ownerA;
  }

  assert.notEqual(draftA.id, draftB.id);

  await assert.rejects(
    pool.query(
      `
        INSERT INTO reply_drafts (
          workspace_id,
          lead_id,
          intent,
          summary,
          missing_information,
          draft_reply,
          provider,
          is_demo,
          status,
          sources,
          approved_at
        )
        VALUES (
          $1, $2, 'general-enquiry', 'Cross-workspace direct insert', '[]',
          'This must fail.', 'mock', true, 'draft', '[]', NULL
        )
      `,
      [ownerA.workspace.id, leadB.id],
    ),
    /reply_drafts_lead_workspace_fkey|foreign key/i,
  );
});

test("workspace members are read-only for business data", async () => {
  const member = requireSession();
  const owner = await registerUser({
    email: `workspace-owner-${randomUUID()}@example.test`,
    name: "Workspace Owner",
  });

  currentSession = owner;
  await createProfile({ businessName: "Member Test Studio" });
  const catalogue = await createCatalogue({
    name: "Shared catalogue",
    description: "Visible to members.",
    priceMinor: 50_000,
    currencyCode: "NGN",
  });
  const lead = await createDraftLead({ name: "Member-visible lead" });
  const draft = (
    await readJson<ReplyDraftPayload>(
      await createSavedDraft(lead.id),
    )
  ).draft;
  currentSession = member;

  await pool.query(
    `
      UPDATE workspace_memberships
      SET is_default = false, updated_at = now()
      WHERE user_id = $1
    `,
    [member.user.id],
  );
  await pool.query(
    `
      INSERT INTO workspace_memberships (
        user_id,
        workspace_id,
        role,
        is_default
      )
      VALUES ($1, $2, 'member', true)
    `,
    [member.user.id, owner.workspace.id],
  );

  const workspace = await readJson<{ role: string }>(
    await fetch(`${baseUrl}/api/workspace`),
  );
  assert.equal(workspace.role, "member");

  const leads = await readJson<LeadsPayload>(
    await fetch(`${baseUrl}/api/leads`),
  );
  assert.deepEqual(
    leads.leads.map((item) => item.id),
    [lead.id],
  );

  const catalogueList = await readJson<CatalogueListPayload>(
    await fetch(`${baseUrl}/api/business/catalogue`),
  );
  assert.deepEqual(
    catalogueList.entries.map((entry) => entry.id),
    [catalogue.id],
  );

  const drafts = await readJson<ReplyDraftsPayload>(
    await listSavedDrafts(lead.id),
  );
  assert.equal(drafts.drafts[0]?.id, draft.id);

  const forbiddenRequests: Array<Promise<Response>> = [
    postLead({
      name: "Member-created lead",
      service: "Wedding photography",
      lastMessage: "Members cannot create leads.",
    }),
    patchLead(lead.id, { status: "Booked" }),
    draftReply(lead.id),
    createSavedDraft(lead.id),
    patchSavedDraft(lead.id, draft.id, { status: "approved" }),
    jsonRequest(`/api/business/catalogue/${catalogue.id}`, "DELETE"),
    jsonRequest("/api/business/knowledge", "POST", {
      title: "Member knowledge",
      answer: "Members cannot create knowledge.",
      entryType: "faq",
    }),
    jsonRequest("/api/business/profile", "PATCH", validProfileBody),
  ];

  for (const request of forbiddenRequests) {
    const response = await request;
    assert.equal(response.status, 403);
    assert.deepEqual(await readJson(response), { error: "Forbidden" });
  }

  const stored = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM leads WHERE workspace_id = $1",
    [owner.workspace.id],
  );
  assert.equal(stored.rows[0]?.count, 1);
});

test("migration backfills existing data without changing IDs or values", async () => {
  const schema = `migration_test_${randomUUID().replaceAll("-", "")}`;
  const migrations = (await readdir(MIGRATIONS_DIR))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  const oldMigrations = migrations.filter(
    (file) => Number.parseInt(file.slice(0, 3), 10) < 6,
  );
  const workspaceMigrations = migrations.filter(
    (file) => Number.parseInt(file.slice(0, 3), 10) >= 6,
  );
  const client = await pool.connect();
  const leadId = "30000000-0000-4000-8000-000000000001";
  const profileId = "30000000-0000-4000-8000-000000000002";
  const catalogueId = "30000000-0000-4000-8000-000000000003";
  const knowledgeId = "30000000-0000-4000-8000-000000000004";
  const draftId = "30000000-0000-4000-8000-000000000005";
  const approvedAt = "2026-03-01T10:30:00.000Z";
  const sources = [
    {
      id: catalogueId,
      type: "catalogue",
      title: "Legacy wedding photography",
      content: "Legacy full-day coverage.",
      reason: "Approved price from the legacy catalogue.",
      priceMinor: 175_000,
      currencyCode: "NGN",
    },
  ];

  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);

    for (const file of oldMigrations) {
      await client.query(
        await readFile(join(MIGRATIONS_DIR, file), "utf8"),
      );
    }

    await client.query(
      `
        INSERT INTO leads (
          id, name, service, channel, status, last_message,
          next_follow_up_at, created_at, updated_at
        )
        VALUES (
          $1, 'Legacy Client', 'Wedding photography', 'WhatsApp', 'Quoted',
          'Legacy enquiry message.', '2026-04-01T09:00:00Z',
          '2026-02-01T08:00:00Z', '2026-02-02T08:00:00Z'
        )
      `,
      [leadId],
    );
    await client.query(
      `
        INSERT INTO business_profiles (
          id, business_name, business_description, contact_email,
          contact_phone, contact_phone_country, business_address,
          timezone, opening_hours, currency_code
        )
        VALUES (
          $1, 'Legacy Studio', 'Legacy description.', 'legacy@example.test',
          '+2348031234567', 'NG', '1 Legacy Road',
          'Africa/Lagos', '[{"day":"monday","opensAt":"09:00","closesAt":"17:00"}]'::jsonb,
          'NGN'
        )
      `,
      [profileId],
    );
    await client.query(
      `
        INSERT INTO catalogue_entries (
          id, name, description, price_minor, currency_code,
          is_active, availability_notes
        )
        VALUES (
          $1, 'Legacy wedding photography', 'Legacy full-day coverage.',
          175000, 'NGN', true, 'Weekends by arrangement.'
        )
      `,
      [catalogueId],
    );
    await client.query(
      `
        INSERT INTO knowledge_entries (
          id, title, answer, entry_type, is_active
        )
        VALUES (
          $1, 'Legacy refund policy', 'Legacy deposits are non-refundable.',
          'policy', true
        )
      `,
      [knowledgeId],
    );
    await client.query(
      `
        INSERT INTO reply_drafts (
          id, lead_id, intent, summary, missing_information, draft_reply,
          provider, is_demo, status, sources, approved_at, created_at,
          updated_at
        )
        VALUES (
          $1, $2, 'pricing', 'Legacy saved draft.', '["Preferred date"]',
          'Legacy saved reply.', 'mock', true, 'approved', $3::jsonb, $4,
          '2026-02-03T08:00:00Z', '2026-02-04T08:00:00Z'
        )
      `,
      [draftId, leadId, JSON.stringify(sources), approvedAt],
    );

    for (const file of workspaceMigrations) {
      await client.query(
        await readFile(join(MIGRATIONS_DIR, file), "utf8"),
      );
    }

    const lead = await client.query<{
      id: string;
      workspace_id: string;
      name: string;
      status: string;
      next_follow_up_at: Date | null;
    }>(
      `
        SELECT id, workspace_id, name, status, next_follow_up_at
        FROM leads
        WHERE id = $1
      `,
      [leadId],
    );
    assert.equal(lead.rows[0]?.id, leadId);
    assert.equal(lead.rows[0]?.workspace_id, LEGACY_WORKSPACE_ID);
    assert.equal(lead.rows[0]?.name, "Legacy Client");
    assert.equal(lead.rows[0]?.status, "Quoted");
    assert.equal(
      lead.rows[0]?.next_follow_up_at?.toISOString(),
      "2026-04-01T09:00:00.000Z",
    );

    const profile = await client.query<{
      id: string;
      workspace_id: string;
      business_name: string;
      currency_code: string;
      contact_phone: string;
    }>(
      `
        SELECT id, workspace_id, business_name, currency_code, contact_phone
        FROM business_profiles
        WHERE id = $1
      `,
      [profileId],
    );
    assert.deepEqual(profile.rows[0], {
      id: profileId,
      workspace_id: LEGACY_WORKSPACE_ID,
      business_name: "Legacy Studio",
      currency_code: "NGN",
      contact_phone: "+2348031234567",
    });

    const catalogue = await client.query<{
      id: string;
      workspace_id: string;
      price_minor: string;
      currency_code: string;
    }>(
      `
        SELECT id, workspace_id, price_minor, currency_code
        FROM catalogue_entries
        WHERE id = $1
      `,
      [catalogueId],
    );
    assert.deepEqual(catalogue.rows[0], {
      id: catalogueId,
      workspace_id: LEGACY_WORKSPACE_ID,
      price_minor: "175000",
      currency_code: "NGN",
    });

    const knowledge = await client.query<{
      id: string;
      workspace_id: string;
      title: string;
    }>(
      `
        SELECT id, workspace_id, title
        FROM knowledge_entries
        WHERE id = $1
      `,
      [knowledgeId],
    );
    assert.deepEqual(knowledge.rows[0], {
      id: knowledgeId,
      workspace_id: LEGACY_WORKSPACE_ID,
      title: "Legacy refund policy",
    });

    const draft = await client.query<{
      id: string;
      lead_id: string;
      workspace_id: string;
      status: string;
      approved_at: Date;
      sources: unknown;
    }>(
      `
        SELECT id, lead_id, workspace_id, status, approved_at, sources
        FROM reply_drafts
        WHERE id = $1
      `,
      [draftId],
    );
    assert.equal(draft.rows[0]?.id, draftId);
    assert.equal(draft.rows[0]?.lead_id, leadId);
    assert.equal(draft.rows[0]?.workspace_id, LEGACY_WORKSPACE_ID);
    assert.equal(draft.rows[0]?.status, "approved");
    assert.equal(
      draft.rows[0]?.approved_at.toISOString(),
      approvedAt,
    );
    assert.deepEqual(draft.rows[0]?.sources, sources);

    const singleton = await client.query<{ column_name: string }>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = 'business_profiles'
          AND column_name = 'singleton'
      `,
      [schema],
    );
    assert.equal(singleton.rows.length, 0);

    const legacy = await client.query<{
      id: string;
      name: string;
    }>(
      "SELECT id, name FROM workspaces WHERE id = $1",
      [LEGACY_WORKSPACE_ID],
    );
    assert.deepEqual(legacy.rows[0], {
      id: LEGACY_WORKSPACE_ID,
      name: "Legacy development workspace",
    });

    const legacyMembers = await client.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM workspace_memberships
        WHERE workspace_id = $1
      `,
      [LEGACY_WORKSPACE_ID],
    );
    assert.equal(legacyMembers.rows[0]?.count, 0);

    const otherWorkspaceId = randomUUID();
    await client.query(
      "INSERT INTO workspaces (id, name) VALUES ($1, 'Other workspace')",
      [otherWorkspaceId],
    );
    await assert.rejects(
      client.query(
        `
          INSERT INTO reply_drafts (
            workspace_id,
            lead_id,
            intent,
            summary,
            missing_information,
            draft_reply,
            provider,
            is_demo,
            status,
            sources,
            approved_at
          )
          VALUES (
            $1, $2, 'general-enquiry', 'Cross workspace', '[]',
            'Must fail.', 'mock', true, 'draft', '[]', NULL
          )
        `,
        [otherWorkspaceId, leadId],
      ),
      /reply_drafts_lead_workspace_fkey|foreign key/i,
    );
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The transaction may already be aborted by the expected constraint test.
    }
    client.release();
  }
});

test("customer migration backfills existing WhatsApp conversations and messages", async () => {
  const schema = `customer_migration_${randomUUID().replaceAll("-", "")}`;
  const migrations = (await readdir(MIGRATIONS_DIR))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  const beforeCustomerMigration = migrations.filter(
    (file) => Number.parseInt(file.slice(0, 3), 10) < 9,
  );
  const customerMigration = migrations.filter(
    (file) => Number.parseInt(file.slice(0, 3), 10) === 9,
  );
  const client = await pool.connect();
  const conversationId = "40000000-0000-4000-8000-000000000001";
  const messageId = "40000000-0000-4000-8000-000000000002";

  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);

    for (const file of beforeCustomerMigration) {
      await client.query(await readFile(join(MIGRATIONS_DIR, file), "utf8"));
    }

    await client.query(
      `
        INSERT INTO whatsapp_conversations (
          id, workspace_id, phone_number_id, customer_wa_id, contact_name,
          last_message_at
        )
        VALUES (
          $1, $2, '123456789012345', '2348012345678',
          'Legacy WhatsApp Customer', '2026-05-01T09:00:00Z'
        )
      `,
      [conversationId, LEGACY_WORKSPACE_ID],
    );
    await client.query(
      `
        INSERT INTO whatsapp_messages (
          id, workspace_id, conversation_id, provider_message_id,
          direction, message_type, text_content, provider_timestamp
        )
        VALUES (
          $1, $2, $3, 'wamid.legacy', 'inbound', 'text',
          'Legacy inbound message', '2026-05-01T09:00:00Z'
        )
      `,
      [messageId, LEGACY_WORKSPACE_ID, conversationId],
    );

    for (const file of customerMigration) {
      await client.query(await readFile(join(MIGRATIONS_DIR, file), "utf8"));
    }

    const customers = await client.query<{
      id: string;
      workspace_id: string;
      phone_e164: string;
      provider_contact_id: string | null;
      display_name: string;
    }>(
      `
        SELECT id, workspace_id, phone_e164, provider_contact_id, display_name
        FROM customers
      `,
    );
    assert.equal(customers.rows.length, 1);
    const customer = customers.rows[0];
    assert.ok(customer);
    assert.equal(customer.workspace_id, LEGACY_WORKSPACE_ID);
    assert.equal(customer.phone_e164, "+2348012345678");
    assert.equal(customer.provider_contact_id, null);
    assert.equal(customer.display_name, "Legacy WhatsApp Customer");

    const conversations = await client.query<{
      id: string;
      customer_id: string;
      whatsapp_connection_id: string;
      channel: string;
      status: string;
    }>(
      `
        SELECT id, customer_id, whatsapp_connection_id, channel, status
        FROM whatsapp_conversations
      `,
    );
    assert.equal(conversations.rows.length, 1);
    assert.equal(conversations.rows[0]?.id, conversationId);
    assert.equal(conversations.rows[0]?.customer_id, customer.id);
    assert.ok(conversations.rows[0]?.whatsapp_connection_id);
    assert.equal(conversations.rows[0]?.channel, "whatsapp");
    assert.equal(conversations.rows[0]?.status, "open");

    const connections = await client.query<{
      workspace_id: string;
      phone_number_id: string;
    }>(
      "SELECT workspace_id, phone_number_id FROM whatsapp_connections",
    );
    assert.deepEqual(connections.rows[0], {
      workspace_id: LEGACY_WORKSPACE_ID,
      phone_number_id: "123456789012345",
    });

    const messages = await client.query<{ id: string; customer_id: string }>(
      "SELECT id, customer_id FROM whatsapp_messages",
    );
    assert.equal(messages.rows[0]?.id, messageId);
    assert.equal(messages.rows[0]?.customer_id, customer.id);
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The transaction may already be aborted by a failing migration.
    }
    client.release();
  }
});

test("customer first_seen_at migration uses the earliest inbound message", async () => {
  const schema = `customer_first_seen_${randomUUID().replaceAll("-", "")}`;
  const migrations = (await readdir(MIGRATIONS_DIR))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  const beforeCustomerMigration = migrations.filter(
    (file) => Number.parseInt(file.slice(0, 3), 10) < 9,
  );
  const customerMigration = migrations.filter(
    (file) => Number.parseInt(file.slice(0, 3), 10) === 9,
  );
  const firstSeenMigration = migrations.filter(
    (file) => Number.parseInt(file.slice(0, 3), 10) === 10,
  );
  const client = await pool.connect();
  const conversationId = "41000000-0000-4000-8000-000000000001";
  const firstMessageId = "41000000-0000-4000-8000-000000000002";
  const secondMessageId = "41000000-0000-4000-8000-000000000003";
  const emptyConversationId = "41000000-0000-4000-8000-000000000004";

  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);

    for (const file of beforeCustomerMigration) {
      await client.query(await readFile(join(MIGRATIONS_DIR, file), "utf8"));
    }

    // A customer with two inbound messages: 09:00 is the true first-seen time.
    await client.query(
      `
        INSERT INTO whatsapp_conversations (
          id, workspace_id, phone_number_id, customer_wa_id, contact_name,
          last_message_at
        )
        VALUES ($1, $2, '123456789012345', '2348012345678',
                'Multi Message Customer', '2026-05-01T10:00:00Z')
      `,
      [conversationId, LEGACY_WORKSPACE_ID],
    );
    await client.query(
      `
        INSERT INTO whatsapp_messages (
          id, workspace_id, conversation_id, provider_message_id,
          direction, message_type, text_content, provider_timestamp
        )
        VALUES ($1, $2, $3, 'wamid.first-seen.one', 'inbound', 'text',
                'First', '2026-05-01T09:00:00Z')
      `,
      [firstMessageId, LEGACY_WORKSPACE_ID, conversationId],
    );
    await client.query(
      `
        INSERT INTO whatsapp_messages (
          id, workspace_id, conversation_id, provider_message_id,
          direction, message_type, text_content, provider_timestamp
        )
        VALUES ($1, $2, $3, 'wamid.first-seen.two', 'inbound', 'text',
                'Second', '2026-05-01T10:00:00Z')
      `,
      [secondMessageId, LEGACY_WORKSPACE_ID, conversationId],
    );

    // A second customer with no messages, to exercise the created_at fallback.
    await client.query(
      `
        INSERT INTO whatsapp_conversations (
          id, workspace_id, phone_number_id, customer_wa_id, contact_name,
          last_message_at, created_at
        )
        VALUES ($1, $2, '123456789012345', '16505551234',
                'No Message Customer', NULL, '2026-04-01T08:00:00Z')
      `,
      [emptyConversationId, LEGACY_WORKSPACE_ID],
    );

    for (const file of customerMigration) {
      await client.query(await readFile(join(MIGRATIONS_DIR, file), "utf8"));
    }

    // Reproduce the historical bug: 009 used the last activity for both
    // customers, so the first-seen value is the most recent message time.
    await client.query(
      `
        UPDATE customers
        SET first_seen_at = '2026-05-01T10:00:00Z'
        WHERE phone_e164 = '+2348012345678'
      `,
    );
    await client.query(
      `
        UPDATE customers
        SET first_seen_at = '2026-05-01T00:00:00Z'
        WHERE phone_e164 = '+16505551234'
      `,
    );

    for (const file of firstSeenMigration) {
      await client.query(await readFile(join(MIGRATIONS_DIR, file), "utf8"));
    }

    const customers = await client.query<{
      id: string;
      phone_e164: string;
      first_seen_at: Date;
      last_seen_at: Date;
      created_at: Date;
    }>(
      `
        SELECT id, phone_e164, first_seen_at, last_seen_at, created_at
        FROM customers
        ORDER BY phone_e164
      `,
    );
    const multi = customers.rows.find(
      (row) => row.phone_e164 === "+2348012345678",
    );
    const empty = customers.rows.find(
      (row) => row.phone_e164 === "+16505551234",
    );
    assert.ok(multi);
    assert.ok(empty);
    assert.equal(
      multi.first_seen_at.toISOString(),
      "2026-05-01T09:00:00.000Z",
    );
    assert.equal(
      multi.last_seen_at.toISOString(),
      "2026-05-01T10:00:00.000Z",
    );
    assert.equal(
      empty.first_seen_at.toISOString(),
      empty.created_at.toISOString(),
    );

    // Relationships and message identity are unchanged.
    const messages = await client.query<{
      id: string;
      conversation_id: string;
      customer_id: string;
    }>(
      `
        SELECT id, conversation_id, customer_id
        FROM whatsapp_messages
        ORDER BY provider_timestamp ASC, id ASC
      `,
    );
    assert.equal(messages.rows.length, 2);
    assert.equal(messages.rows[0]?.id, firstMessageId);
    assert.equal(messages.rows[1]?.id, secondMessageId);
    assert.equal(messages.rows[0]?.conversation_id, conversationId);
    assert.equal(messages.rows[0]?.customer_id, multi.id);
    assert.equal(messages.rows[1]?.customer_id, multi.id);

    const conversations = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM whatsapp_conversations",
    );
    assert.equal(conversations.rows[0]?.count, 2);

    // Re-running the correction is a no-op.
    for (const file of firstSeenMigration) {
      await client.query(await readFile(join(MIGRATIONS_DIR, file), "utf8"));
    }
    const afterRerun = await client.query<{ first_seen_at: Date }>(
      "SELECT first_seen_at FROM customers WHERE id = $1",
      [multi.id],
    );
    assert.equal(
      afterRerun.rows[0]?.first_seen_at.toISOString(),
      "2026-05-01T09:00:00.000Z",
    );
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The transaction may already be aborted by a failing migration.
    }
    client.release();
  }
});

test("WhatsApp configuration is optional but all-or-none", () => {
  assert.equal(loadWhatsAppConfig({}), null);
  assert.equal(
    loadWhatsAppConfig({
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: "   ",
      WHATSAPP_APP_SECRET: "",
    }),
    null,
  );

  let error: unknown;
  try {
    loadWhatsAppConfig({
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: "super-secret-verify-token",
      WHATSAPP_APP_SECRET: "super-secret-app-secret-value",
    });
  } catch (caught) {
    error = caught;
  }

  assert.ok(error instanceof Error);
  assert.match(error.message, /WHATSAPP_TEST_PHONE_NUMBER_ID/);
  assert.match(error.message, /WHATSAPP_TEST_WORKSPACE_ID/);
  assert.doesNotMatch(error.message, /super-secret/);

  assert.throws(
    () =>
      loadWhatsAppConfig({
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: TEST_WHATSAPP_VERIFY_TOKEN,
        WHATSAPP_APP_SECRET: TEST_WHATSAPP_APP_SECRET,
        WHATSAPP_TEST_PHONE_NUMBER_ID: "not-numeric",
        WHATSAPP_TEST_WORKSPACE_ID: randomUUID(),
      }),
    /WHATSAPP_TEST_PHONE_NUMBER_ID/,
  );

  assert.deepEqual(
    loadWhatsAppConfig({
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: TEST_WHATSAPP_VERIFY_TOKEN,
      WHATSAPP_APP_SECRET: TEST_WHATSAPP_APP_SECRET,
      WHATSAPP_TEST_PHONE_NUMBER_ID: TEST_WHATSAPP_PHONE_NUMBER_ID,
      WHATSAPP_TEST_WORKSPACE_ID: requireSession().workspace.id,
    }),
    testWhatsAppConfig(),
  );
});

test("WhatsApp webhook is disabled when configuration is absent", async () => {
  const challenge = await nativeFetch(
    `${baseUrl}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${TEST_WHATSAPP_VERIFY_TOKEN}&hub.challenge=test`,
    { headers: { "x-forwarded-for": TEST_CLIENT_IP } },
  );
  assert.equal(challenge.status, 503);
  assert.deepEqual(await readJson(challenge), {
    error: "WhatsApp webhook is not configured",
  });

  const body = whatsappEnvelope([
    whatsappChange({ messages: [textWhatsAppMessage()] }),
  ]);
  const post = await postWhatsApp({ baseUrl }, body);
  assert.equal(post.status, 503);
});

test("WhatsApp webhook challenge requires the configured verify token and subscribe mode", async () => {
  const app = await startWhatsAppServer();

  try {
    const success = await nativeFetch(
      `${app.baseUrl}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(TEST_WHATSAPP_VERIFY_TOKEN)}&hub.challenge=challenge-123`,
      { headers: { "x-forwarded-for": TEST_CLIENT_IP } },
    );
    assert.equal(success.status, 200);
    assert.equal(await success.text(), "challenge-123");

    const wrongToken = await nativeFetch(
      `${app.baseUrl}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=challenge-123`,
      { headers: { "x-forwarded-for": TEST_CLIENT_IP } },
    );
    assert.equal(wrongToken.status, 403);

    const invalidMode = await nativeFetch(
      `${app.baseUrl}/api/webhooks/whatsapp?hub.mode=unsubscribe&hub.verify_token=${encodeURIComponent(TEST_WHATSAPP_VERIFY_TOKEN)}&hub.challenge=challenge-123`,
      { headers: { "x-forwarded-for": TEST_CLIENT_IP } },
    );
    assert.equal(invalidMode.status, 400);

    const missingChallenge = await nativeFetch(
      `${app.baseUrl}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(TEST_WHATSAPP_VERIFY_TOKEN)}`,
      { headers: { "x-forwarded-for": TEST_CLIENT_IP } },
    );
    assert.equal(missingChallenge.status, 400);
  } finally {
    await stopServer(app.server);
  }
});

test("WhatsApp webhook validates signatures against the exact raw body", async () => {
  const app = await startWhatsAppServer();
  const body = whatsappEnvelope([
    whatsappChange({ messages: [textWhatsAppMessage()] }),
  ]);

  try {
    const invalid = await postWhatsApp(app, body, {
      signature: `sha256=${"a".repeat(64)}`,
    });
    assert.equal(invalid.status, 401);

    const missing = await postWhatsApp(app, body, { signature: null });
    assert.equal(missing.status, 401);

    const malformed = await postWhatsApp(app, body, {
      signature: "sha256=not-hex",
    });
    assert.equal(malformed.status, 401);

    const changedBytes = await postWhatsApp(app, `${body}\n`, {
      signature: signWhatsAppBody(body),
    });
    assert.equal(changedBytes.status, 401);

    const valid = await postWhatsApp(app, body);
    assert.equal(valid.status, 200);
    assert.deepEqual(await readJson<WhatsAppWebhookPayload>(valid), {
      status: "ok",
      stored: 1,
      duplicates: 0,
    });
  } finally {
    await stopServer(app.server);
  }
});

test("WhatsApp webhook persists a text message and exposes it in the protected inbox", async () => {
  const app = await startWhatsAppServer();
  const providerMessageId = `wamid.${randomUUID()}`;
  const timestamp = "1760000000";
  const text = "Do you have availability in June?";
  const body = whatsappEnvelope([
    whatsappChange({
      messages: [
        textWhatsAppMessage({
          id: providerMessageId,
          text,
          timestamp,
        }),
      ],
      contacts: [
        {
          wa_id: TEST_WHATSAPP_CUSTOMER_WA_ID,
          profile: { name: "Sheena Nelson" },
        },
      ],
    }),
  ]);

  try {
    const response = await postWhatsApp(app, body);
    assert.equal(response.status, 200);
    assert.deepEqual(await readJson<WhatsAppWebhookPayload>(response), {
      status: "ok",
      stored: 1,
      duplicates: 0,
    });

    const conversations = await pool.query<{
      id: string;
      workspace_id: string;
      phone_number_id: string;
      customer_wa_id: string;
      contact_name: string | null;
      lead_id: string | null;
      last_message_at: Date;
    }>(
      `
        SELECT
          id,
          workspace_id,
          phone_number_id,
          customer_wa_id,
          contact_name,
          lead_id,
          last_message_at
        FROM whatsapp_conversations
        WHERE workspace_id = $1
      `,
      [requireSession().workspace.id],
    );
    assert.equal(conversations.rows.length, 1);
    const conversation = conversations.rows[0];
    assert.ok(conversation);
    assert.equal(conversation.phone_number_id, TEST_WHATSAPP_PHONE_NUMBER_ID);
    assert.equal(conversation.customer_wa_id, TEST_WHATSAPP_CUSTOMER_WA_ID);
    assert.equal(conversation.contact_name, "Sheena Nelson");
    assert.equal(conversation.lead_id, null);
    assert.equal(
      conversation.last_message_at.toISOString(),
      new Date(Number(timestamp) * 1_000).toISOString(),
    );

    const storedMessages = await pool.query<{
      provider_message_id: string;
      conversation_id: string;
      workspace_id: string;
      direction: string;
      message_type: string;
      text_content: string | null;
      provider_timestamp: Date;
      processing_status: string;
    }>(
      `
        SELECT
          provider_message_id,
          conversation_id,
          workspace_id,
          direction,
          message_type,
          text_content,
          provider_timestamp,
          processing_status
        FROM whatsapp_messages
        WHERE workspace_id = $1
      `,
      [requireSession().workspace.id],
    );
    assert.equal(storedMessages.rows.length, 1);
    assert.deepEqual(
      {
        ...storedMessages.rows[0],
        provider_timestamp:
          storedMessages.rows[0]?.provider_timestamp.toISOString(),
      },
      {
        provider_message_id: providerMessageId,
        conversation_id: conversation.id,
        workspace_id: requireSession().workspace.id,
        direction: "inbound",
        message_type: "text",
        text_content: text,
        provider_timestamp: new Date(Number(timestamp) * 1_000).toISOString(),
        processing_status: "stored",
      },
    );

    const inbox = await fetch(`${baseUrl}/api/whatsapp/conversations`);
    assert.equal(inbox.status, 200);
    const inboxPayload =
      await readJson<WhatsAppConversationsPayload>(inbox);
    assert.equal(inboxPayload.conversations.length, 1);
    assert.equal(inboxPayload.conversations[0]?.id, conversation.id);
    assert.equal(inboxPayload.conversations[0]?.contactName, "Sheena Nelson");
    assert.equal(inboxPayload.conversations[0]?.lastMessagePreview, text);
    assert.equal(inboxPayload.conversations[0]?.lastMessageType, "text");
    assert.equal(inboxPayload.conversations[0]?.lastMessageStatus, "stored");
    assert.equal(inboxPayload.conversations[0]?.leadId, null);

    const thread = await fetch(
      `${baseUrl}/api/whatsapp/conversations/${conversation.id}/messages`,
    );
    assert.equal(thread.status, 200);
    const threadPayload =
      await readJson<WhatsAppConversationMessagesPayload>(thread);
    assert.equal(threadPayload.conversation.id, conversation.id);
    assert.equal(threadPayload.messages.length, 1);
    assert.equal(threadPayload.messages[0]?.text, text);
    assert.equal(threadPayload.messages[0]?.processingStatus, "stored");
    assert.equal(threadPayload.messages[0]?.direction, "inbound");
  } finally {
    await stopServer(app.server);
  }
});

test("WhatsApp webhook supports BSUID senders when phone numbers are omitted", async () => {
  const app = await startWhatsAppServer();
  const businessScopedUserId = TEST_WHATSAPP_BSUID;
  const message: TestWhatsAppMessage = {
    id: `wamid.${randomUUID()}`,
    from_user_id: businessScopedUserId,
    timestamp: "1760000050",
    type: "text",
    text: { body: "Message from a username-enabled customer" },
  };
  const body = whatsappEnvelope([
    whatsappChange({
      messages: [message],
      contacts: [
        {
          user_id: businessScopedUserId,
          profile: { name: "Username Customer" },
        },
      ],
    }),
  ]);

  try {
    const response = await postWhatsApp(app, body);
    assert.equal(response.status, 200);
    assert.deepEqual(await readJson<WhatsAppWebhookPayload>(response), {
      status: "ok",
      stored: 1,
      duplicates: 0,
    });

    const conversation = await pool.query<{
      id: string;
      customer_wa_id: string;
      contact_name: string | null;
      lead_id: string | null;
    }>(
      `
        SELECT id, customer_wa_id, contact_name, lead_id
        FROM whatsapp_conversations
        WHERE workspace_id = $1
      `,
      [requireSession().workspace.id],
    );
    const stored = conversation.rows[0];
    assert.ok(stored);
    assert.equal(stored.customer_wa_id, businessScopedUserId);
    assert.equal(stored.contact_name, "Username Customer");
    assert.equal(stored.lead_id, null);

    const inbox = await fetch(`${baseUrl}/api/whatsapp/conversations`);
    const inboxPayload =
      await readJson<WhatsAppConversationsPayload>(inbox);
    assert.equal(
      inboxPayload.conversations[0]?.customerWaId,
      businessScopedUserId,
    );
    assert.equal(
      inboxPayload.conversations[0]?.contactName,
      "Username Customer",
    );
  } finally {
    await stopServer(app.server);
  }
});

test("WhatsApp webhook stores messages from multiple entries and changes once", async () => {
  const app = await startWhatsAppServer();
  const first = textWhatsAppMessage({
    id: `wamid.${randomUUID()}`,
    text: "First message",
    timestamp: "1760000100",
  });
  const second = textWhatsAppMessage({
    id: `wamid.${randomUUID()}`,
    text: "Second message",
    timestamp: "1760000200",
  });
  const third = textWhatsAppMessage({
    id: `wamid.${randomUUID()}`,
    text: "Third message",
    timestamp: "1760000300",
  });
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-first",
        changes: [
          whatsappChange({ messages: [first] }),
          whatsappChange({ messages: [third] }),
        ],
      },
      {
        id: "waba-second",
        changes: [whatsappChange({ messages: [second] })],
      },
    ],
  });

  try {
    const response = await postWhatsApp(app, body);
    assert.equal(response.status, 200);
    assert.deepEqual(await readJson<WhatsAppWebhookPayload>(response), {
      status: "ok",
      stored: 3,
      duplicates: 0,
    });

    const conversations = await pool.query<{
      id: string;
      last_message_at: Date;
    }>(
      `
        SELECT id, last_message_at
        FROM whatsapp_conversations
        WHERE workspace_id = $1
      `,
      [requireSession().workspace.id],
    );
    assert.equal(conversations.rows.length, 1);
    assert.equal(
      conversations.rows[0]?.last_message_at.toISOString(),
      new Date(1_760_000_300 * 1_000).toISOString(),
    );

    const thread = await fetch(
      `${baseUrl}/api/whatsapp/conversations/${conversations.rows[0]?.id}/messages`,
    );
    const threadPayload =
      await readJson<WhatsAppConversationMessagesPayload>(thread);
    assert.deepEqual(
      threadPayload.messages.map((message) => message.text),
      ["First message", "Second message", "Third message"],
    );
  } finally {
    await stopServer(app.server);
  }
});

test("WhatsApp webhook persists unsupported message types without inventing text", async () => {
  const app = await startWhatsAppServer();
  const message: TestWhatsAppMessage = {
    id: `wamid.${randomUUID()}`,
    from: TEST_WHATSAPP_CUSTOMER_WA_ID,
    timestamp: "1760000400",
    type: "image",
    image: { id: "media-test-id", mime_type: "image/jpeg" },
  };
  const body = whatsappEnvelope([whatsappChange({ messages: [message] })]);

  try {
    const response = await postWhatsApp(app, body);
    assert.equal(response.status, 200);
    assert.deepEqual(await readJson<WhatsAppWebhookPayload>(response), {
      status: "ok",
      stored: 1,
      duplicates: 0,
    });

    const conversation = await pool.query<{ id: string }>(
      "SELECT id FROM whatsapp_conversations WHERE workspace_id = $1",
      [requireSession().workspace.id],
    );
    const stored = await pool.query<{
      message_type: string;
      text_content: string | null;
      processing_status: string;
    }>(
      `
        SELECT message_type, text_content, processing_status
        FROM whatsapp_messages
        WHERE workspace_id = $1
      `,
      [requireSession().workspace.id],
    );
    assert.deepEqual(stored.rows[0], {
      message_type: "image",
      text_content: null,
      processing_status: "unsupported",
    });

    const inbox = await fetch(`${baseUrl}/api/whatsapp/conversations`);
    const inboxPayload =
      await readJson<WhatsAppConversationsPayload>(inbox);
    assert.equal(inboxPayload.conversations[0]?.lastMessagePreview, null);
    assert.equal(inboxPayload.conversations[0]?.lastMessageType, "image");
    assert.equal(
      inboxPayload.conversations[0]?.lastMessageStatus,
      "unsupported",
    );

    const thread = await fetch(
      `${baseUrl}/api/whatsapp/conversations/${conversation.rows[0]?.id}/messages`,
    );
    const threadPayload =
      await readJson<WhatsAppConversationMessagesPayload>(thread);
    assert.equal(threadPayload.messages[0]?.messageType, "image");
    assert.equal(threadPayload.messages[0]?.text, null);
    assert.equal(threadPayload.messages[0]?.processingStatus, "unsupported");
  } finally {
    await stopServer(app.server);
  }
});

test("WhatsApp webhook ignores status and unrelated changes", async () => {
  const app = await startWhatsAppServer();
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-test",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550783881",
                phone_number_id: TEST_WHATSAPP_PHONE_NUMBER_ID,
              },
              statuses: [{ id: "wamid.status", status: "delivered" }],
            },
          },
          {
            field: "message_template_status_update",
            value: { event: "APPROVED" },
          },
        ],
      },
    ],
  });

  try {
    const response = await postWhatsApp(app, body);
    assert.equal(response.status, 200);
    assert.deepEqual(await readJson<WhatsAppWebhookPayload>(response), {
      status: "ignored",
    });

    const counts = await pool.query<{
      conversations: number;
      messages: number;
    }>(`
      SELECT
        (SELECT count(*) FROM whatsapp_conversations)::int AS conversations,
        (SELECT count(*) FROM whatsapp_messages)::int AS messages
    `);
    assert.deepEqual(counts.rows[0], { conversations: 0, messages: 0 });
  } finally {
    await stopServer(app.server);
  }
});

test("WhatsApp webhook rejects malformed signed payloads", async () => {
  const app = await startWhatsAppServer();

  try {
    const invalidJson = await postWhatsApp(app, "{not-json");
    assert.equal(invalidJson.status, 400);

    const missingChanges = await postWhatsApp(
      app,
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [{}],
      }),
    );
    assert.equal(missingChanges.status, 400);

    const missingMetadata = await postWhatsApp(
      app,
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  messages: [textWhatsAppMessage()],
                },
              },
            ],
          },
        ],
      }),
    );
    assert.equal(missingMetadata.status, 400);

    const counts = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM whatsapp_messages",
    );
    assert.equal(counts.rows[0]?.count, 0);
  } finally {
    await stopServer(app.server);
  }
});

test("WhatsApp webhook ignores messages for a different business phone number", async () => {
  const app = await startWhatsAppServer();
  const body = whatsappEnvelope([
    whatsappChange({
      phoneNumberId: "109999999999999",
      messages: [textWhatsAppMessage()],
    }),
  ]);

  try {
    const response = await postWhatsApp(app, body);
    assert.equal(response.status, 200);
    assert.deepEqual(await readJson<WhatsAppWebhookPayload>(response), {
      status: "ignored",
    });

    const counts = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM whatsapp_messages",
    );
    assert.equal(counts.rows[0]?.count, 0);
  } finally {
    await stopServer(app.server);
  }
});

test("WhatsApp webhook acknowledges duplicate provider message IDs without new activity", async () => {
  const app = await startWhatsAppServer();
  const body = whatsappEnvelope([
    whatsappChange({
      messages: [
        textWhatsAppMessage({
          id: `wamid.${randomUUID()}`,
          text: "Only once",
          timestamp: "1760000500",
        }),
      ],
    }),
  ]);

  try {
    const first = await postWhatsApp(app, body);
    assert.equal(first.status, 200);
    assert.deepEqual(await readJson<WhatsAppWebhookPayload>(first), {
      status: "ok",
      stored: 1,
      duplicates: 0,
    });

    const before = await pool.query<{
      id: string;
      last_message_at: Date;
      updated_at: Date;
    }>(
      `
        SELECT id, last_message_at, updated_at
        FROM whatsapp_conversations
        WHERE workspace_id = $1
      `,
      [requireSession().workspace.id],
    );

    const duplicate = await postWhatsApp(app, body);
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await readJson<WhatsAppWebhookPayload>(duplicate), {
      status: "ok",
      stored: 0,
      duplicates: 1,
    });

    const after = await pool.query<{
      id: string;
      last_message_at: Date;
      updated_at: Date;
    }>(
      `
        SELECT id, last_message_at, updated_at
        FROM whatsapp_conversations
        WHERE workspace_id = $1
      `,
      [requireSession().workspace.id],
    );
    assert.equal(after.rows.length, 1);
    assert.equal(after.rows[0]?.id, before.rows[0]?.id);
    assert.equal(
      after.rows[0]?.last_message_at.toISOString(),
      before.rows[0]?.last_message_at.toISOString(),
    );
    assert.equal(
      after.rows[0]?.updated_at.toISOString(),
      before.rows[0]?.updated_at.toISOString(),
    );

    const counts = await pool.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM whatsapp_messages
        WHERE workspace_id = $1
      `,
      [requireSession().workspace.id],
    );
    assert.equal(counts.rows[0]?.count, 1);
  } finally {
    await stopServer(app.server);
  }
});

test("WhatsApp webhook rejects a missing configured workspace", async () => {
  const app = await startWhatsAppServer({ workspaceId: randomUUID() });
  const body = whatsappEnvelope([
    whatsappChange({ messages: [textWhatsAppMessage()] }),
  ]);

  try {
    const response = await postWhatsApp(app, body);
    assert.equal(response.status, 503);
    assert.deepEqual(await readJson(response), {
      error: "WhatsApp integration is unavailable",
    });

    const counts = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM whatsapp_messages",
    );
    assert.equal(counts.rows[0]?.count, 0);
  } finally {
    await stopServer(app.server);
  }
});

test("WhatsApp persistence failures are not acknowledged as stored", async () => {
  const unavailablePool = new Pool({
    connectionString:
      "postgresql://replypilot:invalid@127.0.0.1:1/replypilot_unavailable",
    connectionTimeoutMillis: 250,
  });
  unavailablePool.on("error", () => {
    // The webhook test intentionally triggers connection errors.
  });
  const app = await startServer(
    unavailablePool,
    undefined,
    {},
    testWhatsAppConfig(),
  );
  const body = whatsappEnvelope([
    whatsappChange({ messages: [textWhatsAppMessage()] }),
  ]);

  try {
    const response = await postWhatsApp(app, body);
    assert.equal(response.status, 500);
    assert.deepEqual(await readJson(response), {
      error: "Internal server error",
    });
  } finally {
    await stopServer(app.server);
    await unavailablePool.end();
  }
});

test("WhatsApp conversations associate only with an exact existing lead number", async () => {
  const app = await startWhatsAppServer();
  const lead = await createDraftLead({
    name: "Exact Match",
    whatsappNumber: "+1 (650) 555-1234",
  });
  assert.equal(lead.whatsappNumber, TEST_WHATSAPP_CUSTOMER_WA_ID);

  const matchingBody = whatsappEnvelope([
    whatsappChange({
      messages: [
        {
          ...textWhatsAppMessage({
            id: `wamid.${randomUUID()}`,
            from: TEST_WHATSAPP_CUSTOMER_WA_ID,
          }),
          from_user_id: TEST_WHATSAPP_BSUID,
        },
      ],
      contacts: [
        {
          wa_id: TEST_WHATSAPP_CUSTOMER_WA_ID,
          user_id: TEST_WHATSAPP_BSUID,
          profile: { name: "Exact Match" },
        },
      ],
    }),
  ]);
  const unmatchedSender = "2348031234567";
  const unmatchedBody = whatsappEnvelope([
    whatsappChange({
      messages: [
        textWhatsAppMessage({
          id: `wamid.${randomUUID()}`,
          from: unmatchedSender,
        }),
      ],
    }),
  ]);

  try {
    assert.equal((await postWhatsApp(app, matchingBody)).status, 200);
    assert.equal((await postWhatsApp(app, unmatchedBody)).status, 200);

    const conversations = await pool.query<{
      customer_wa_id: string;
      lead_id: string | null;
    }>(
      `
        SELECT customer_wa_id, lead_id
        FROM whatsapp_conversations
        WHERE workspace_id = $1
        ORDER BY customer_wa_id
      `,
      [requireSession().workspace.id],
    );
    assert.equal(conversations.rows.length, 2);
    const matchedConversation = conversations.rows.find(
      (conversation) => conversation.customer_wa_id === TEST_WHATSAPP_BSUID,
    );
    const unmatchedConversation = conversations.rows.find(
      (conversation) => conversation.customer_wa_id === unmatchedSender,
    );
    assert.equal(matchedConversation?.lead_id, lead.id);
    assert.equal(unmatchedConversation?.lead_id, null);
  } finally {
    await stopServer(app.server);
  }
});

test("WhatsApp inbox is workspace-scoped and rejects cross-workspace IDs", async () => {
  const app = await startWhatsAppServer();
  const owner = requireSession();
  const body = whatsappEnvelope([
    whatsappChange({
      messages: [
        textWhatsAppMessage({
          id: `wamid.${randomUUID()}`,
          text: "Owner-only message",
        }),
      ],
    }),
  ]);

  try {
    assert.equal((await postWhatsApp(app, body)).status, 200);

    const ownerConversations = await pool.query<{
      id: string;
      customer_id: string;
    }>(
      "SELECT id, customer_id FROM whatsapp_conversations WHERE workspace_id = $1",
      [owner.workspace.id],
    );
    const conversationId = ownerConversations.rows[0]?.id;
    const conversationCustomerId = ownerConversations.rows[0]?.customer_id;
    assert.ok(conversationId);
    assert.ok(conversationCustomerId);

    const ownerList = await requestAs(
      owner,
      "/api/whatsapp/conversations",
    );
    assert.equal(ownerList.status, 200);
    const ownerListPayload =
      await readJson<WhatsAppConversationsPayload>(ownerList);
    assert.equal(ownerListPayload.conversations[0]?.id, conversationId);

    const ownerThread = await requestAs(
      owner,
      `/api/whatsapp/conversations/${conversationId}/messages`,
    );
    assert.equal(ownerThread.status, 200);

    const other = await registerUser();
    assert.notEqual(other.workspace.id, owner.workspace.id);

    const otherList = await requestAs(
      other,
      "/api/whatsapp/conversations",
    );
    assert.equal(otherList.status, 200);
    assert.deepEqual(
      await readJson<WhatsAppConversationsPayload>(otherList),
      { conversations: [] },
    );

    const guessedThread = await requestAs(
      other,
      `/api/whatsapp/conversations/${conversationId}/messages`,
    );
    assert.equal(guessedThread.status, 404);
    assert.deepEqual(await readJson(guessedThread), {
      error: "Conversation not found",
    });

    let foreignKeyCode: string | undefined;
    try {
      await pool.query(
        `
          INSERT INTO whatsapp_messages (
            workspace_id,
            conversation_id,
            customer_id,
            provider_message_id,
            direction,
            message_type,
            text_content,
            provider_timestamp,
            processing_status
          )
          VALUES ($1, $2, $3, $4, 'inbound', 'text', 'Cross workspace', now(), 'stored')
        `,
        [
          other.workspace.id,
          conversationId,
          conversationCustomerId,
          `wamid.${randomUUID()}`,
        ],
      );
    } catch (error) {
      foreignKeyCode =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : undefined;
    }
    assert.equal(foreignKeyCode, "23503");
  } finally {
    await stopServer(app.server);
  }
});

test("first inbound WhatsApp message creates a customer, connection, and conversation", async () => {
  const app = await startWhatsAppServer();
  const timestamp = "1760001000";
  const body = whatsappEnvelope([
    whatsappChange({
      messages: [textWhatsAppMessage({ text: "First contact", timestamp })],
      contacts: [
        {
          wa_id: TEST_WHATSAPP_CUSTOMER_WA_ID,
          profile: { name: "Sheena Nelson" },
        },
      ],
    }),
  ]);

  try {
    assert.equal((await postWhatsApp(app, body)).status, 200);

    const customers = await pool.query<{
      id: string;
      workspace_id: string;
      phone_e164: string | null;
      provider_contact_id: string | null;
      display_name: string | null;
      first_seen_at: Date;
      last_seen_at: Date;
    }>(
      `
        SELECT id, workspace_id, phone_e164, provider_contact_id,
               display_name, first_seen_at, last_seen_at
        FROM customers
        WHERE workspace_id = $1
      `,
      [requireSession().workspace.id],
    );
    assert.equal(customers.rows.length, 1);
    const customer = customers.rows[0];
    assert.ok(customer);
    assert.equal(customer.phone_e164, "+16505551234");
    assert.equal(customer.provider_contact_id, null);
    assert.equal(customer.display_name, "Sheena Nelson");
    const seenAt = new Date(Number(timestamp) * 1_000).toISOString();
    assert.equal(customer.first_seen_at.toISOString(), seenAt);
    assert.equal(customer.last_seen_at.toISOString(), seenAt);

    const connections = await pool.query<{
      id: string;
      phone_number_id: string;
    }>(
      `
        SELECT id, phone_number_id
        FROM whatsapp_connections
        WHERE workspace_id = $1
      `,
      [requireSession().workspace.id],
    );
    assert.equal(connections.rows.length, 1);
    assert.equal(
      connections.rows[0]?.phone_number_id,
      TEST_WHATSAPP_PHONE_NUMBER_ID,
    );

    const conversations = await pool.query<{
      id: string;
      customer_id: string;
      whatsapp_connection_id: string;
      channel: string;
      status: string;
    }>(
      `
        SELECT id, customer_id, whatsapp_connection_id, channel, status
        FROM whatsapp_conversations
        WHERE workspace_id = $1
      `,
      [requireSession().workspace.id],
    );
    assert.equal(conversations.rows.length, 1);
    const conversation = conversations.rows[0];
    assert.ok(conversation);
    assert.equal(conversation.customer_id, customer.id);
    assert.equal(conversation.whatsapp_connection_id, connections.rows[0]?.id);
    assert.equal(conversation.channel, "whatsapp");
    assert.equal(conversation.status, "open");

    const messages = await pool.query<{ customer_id: string }>(
      `
        SELECT customer_id
        FROM whatsapp_messages
        WHERE workspace_id = $1
      `,
      [requireSession().workspace.id],
    );
    assert.equal(messages.rows.length, 1);
    assert.equal(messages.rows[0]?.customer_id, customer.id);
  } finally {
    await stopServer(app.server);
  }
});

test("subsequent inbound messages reuse the customer and active conversation", async () => {
  const app = await startWhatsAppServer();
  const firstTimestamp = "1760002000";
  const secondTimestamp = "1760002600";
  const firstBody = whatsappEnvelope([
    whatsappChange({
      messages: [
        textWhatsAppMessage({ text: "First", timestamp: firstTimestamp }),
      ],
    }),
  ]);
  const secondBody = whatsappEnvelope([
    whatsappChange({
      messages: [
        textWhatsAppMessage({ text: "Second", timestamp: secondTimestamp }),
      ],
    }),
  ]);

  try {
    assert.equal((await postWhatsApp(app, firstBody)).status, 200);
    assert.equal((await postWhatsApp(app, secondBody)).status, 200);

    const counts = await pool.query<{
      customers: number;
      conversations: number;
      messages: number;
    }>(`
      SELECT
        (SELECT count(*) FROM customers)::int AS customers,
        (SELECT count(*) FROM whatsapp_conversations)::int AS conversations,
        (SELECT count(*) FROM whatsapp_messages)::int AS messages
    `);
    assert.deepEqual(counts.rows[0], {
      customers: 1,
      conversations: 1,
      messages: 2,
    });

    const customer = await pool.query<{ last_seen_at: Date }>(
      "SELECT last_seen_at FROM customers WHERE workspace_id = $1",
      [requireSession().workspace.id],
    );
    assert.equal(
      customer.rows[0]?.last_seen_at.toISOString(),
      new Date(Number(secondTimestamp) * 1_000).toISOString(),
    );
  } finally {
    await stopServer(app.server);
  }
});

test("different workspaces keep separate customers for the same phone number", async () => {
  const owner = requireSession();
  const other = await registerUser();
  const timestamp = new Date("2026-09-01T09:00:00.000Z");

  await persistInboundMessages(pool, owner.workspace.id, [
    inboundMessage({ providerTimestamp: timestamp }),
  ]);
  await persistInboundMessages(pool, other.workspace.id, [
    inboundMessage({ providerTimestamp: timestamp }),
  ]);

  const customers = await pool.query<{
    id: string;
    workspace_id: string;
    phone_e164: string;
  }>(
    `
      SELECT id, workspace_id, phone_e164
      FROM customers
      WHERE phone_e164 = '+16505551234'
      ORDER BY workspace_id
    `,
  );
  assert.equal(customers.rows.length, 2);
  assert.notEqual(customers.rows[0]?.id, customers.rows[1]?.id);
  assert.deepEqual(
    new Set(customers.rows.map((row) => row.workspace_id)),
    new Set([owner.workspace.id, other.workspace.id]),
  );
});

test("an inbound message reopens a closed conversation", async () => {
  const app = await startWhatsAppServer();
  const firstBody = whatsappEnvelope([
    whatsappChange({
      messages: [textWhatsAppMessage({ text: "First", timestamp: "1760003000" })],
    }),
  ]);
  const secondBody = whatsappEnvelope([
    whatsappChange({
      messages: [
        textWhatsAppMessage({ text: "Second", timestamp: "1760003600" }),
      ],
    }),
  ]);

  try {
    assert.equal((await postWhatsApp(app, firstBody)).status, 200);
    const conversation = await pool.query<{ id: string }>(
      "SELECT id FROM whatsapp_conversations WHERE workspace_id = $1",
      [requireSession().workspace.id],
    );
    const conversationId = conversation.rows[0]?.id;
    assert.ok(conversationId);
    await pool.query(
      "UPDATE whatsapp_conversations SET status = 'closed' WHERE id = $1",
      [conversationId],
    );

    assert.equal((await postWhatsApp(app, secondBody)).status, 200);

    const after = await pool.query<{ id: string; status: string }>(
      "SELECT id, status FROM whatsapp_conversations WHERE workspace_id = $1",
      [requireSession().workspace.id],
    );
    assert.equal(after.rows.length, 1);
    assert.equal(after.rows[0]?.id, conversationId);
    assert.equal(after.rows[0]?.status, "open");
  } finally {
    await stopServer(app.server);
  }
});

test("an archived conversation is not reopened by a new inbound message", async () => {
  const workspaceId = requireSession().workspace.id;

  await persistInboundMessages(pool, workspaceId, [
    inboundMessage({
      text: "Before archive",
      providerTimestamp: new Date("2026-10-01T09:00:00.000Z"),
    }),
  ]);
  const first = await pool.query<{ id: string }>(
    "SELECT id FROM whatsapp_conversations WHERE workspace_id = $1",
    [workspaceId],
  );
  const archivedId = first.rows[0]?.id;
  assert.ok(archivedId);
  await pool.query(
    "UPDATE whatsapp_conversations SET status = 'archived' WHERE id = $1",
    [archivedId],
  );

  await persistInboundMessages(pool, workspaceId, [
    inboundMessage({
      text: "After archive",
      providerTimestamp: new Date("2026-10-01T10:00:00.000Z"),
    }),
  ]);

  const conversations = await pool.query<{ id: string; status: string }>(
    `
      SELECT id, status
      FROM whatsapp_conversations
      WHERE workspace_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [workspaceId],
  );
  assert.equal(conversations.rows.length, 2);
  assert.equal(conversations.rows[0]?.id, archivedId);
  assert.equal(conversations.rows[0]?.status, "archived");
  assert.equal(conversations.rows[1]?.status, "open");
});

test("different WhatsApp connections keep separate conversations", async () => {
  const workspaceId = requireSession().workspace.id;
  const firstConnection = "106540352242922";
  const secondConnection = "109999999999999";

  await persistInboundMessages(pool, workspaceId, [
    inboundMessage({
      phoneNumberId: firstConnection,
      text: "First number",
    }),
  ]);
  await persistInboundMessages(pool, workspaceId, [
    inboundMessage({
      phoneNumberId: secondConnection,
      text: "Second number",
    }),
  ]);

  const conversations = await pool.query<{
    id: string;
    whatsapp_connection_id: string;
    phone_number_id: string;
  }>(
    `
      SELECT conversation.id, conversation.whatsapp_connection_id,
             conversation.phone_number_id
      FROM whatsapp_conversations AS conversation
      WHERE conversation.workspace_id = $1
      ORDER BY conversation.phone_number_id ASC
    `,
    [workspaceId],
  );
  assert.equal(conversations.rows.length, 2);
  assert.deepEqual(
    conversations.rows.map((row) => row.phone_number_id),
    [firstConnection, secondConnection],
  );
  assert.notEqual(
    conversations.rows[0]?.whatsapp_connection_id,
    conversations.rows[1]?.whatsapp_connection_id,
  );

  const customers = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM customers WHERE workspace_id = $1",
    [workspaceId],
  );
  assert.equal(customers.rows[0]?.count, 1);
});

test("concurrent webhook deliveries create one active conversation", async () => {
  const app = await startWhatsAppServer();
  const bodies = Array.from({ length: 5 }, (_, index) =>
    whatsappEnvelope([
      whatsappChange({
        messages: [
          textWhatsAppMessage({
            id: `wamid.${randomUUID()}`,
            text: `Concurrent ${index}`,
            timestamp: String(1_760_004_000 + index),
          }),
        ],
      }),
    ]),
  );

  try {
    const responses = await Promise.all(
      bodies.map((body) => postWhatsApp(app, body)),
    );

    for (const response of responses) {
      assert.equal(response.status, 200);
      const payload = await readJson<WhatsAppWebhookPayload>(response);
      assert.equal(payload.stored, 1);
      assert.equal(payload.duplicates, 0);
    }

    const counts = await pool.query<{
      customers: number;
      conversations: number;
      messages: number;
      connections: number;
    }>(`
      SELECT
        (SELECT count(*) FROM customers)::int AS customers,
        (SELECT count(*) FROM whatsapp_conversations)::int AS conversations,
        (SELECT count(*) FROM whatsapp_messages)::int AS messages,
        (SELECT count(*) FROM whatsapp_connections)::int AS connections
    `);
    assert.deepEqual(counts.rows[0], {
      customers: 1,
      conversations: 1,
      messages: 5,
      connections: 1,
    });

    const active = await pool.query<{ count: number }>(
      `
        SELECT count(*)::int AS count
        FROM whatsapp_conversations
        WHERE workspace_id = $1
          AND status IN ('open', 'closed')
      `,
      [requireSession().workspace.id],
    );
    assert.equal(active.rows[0]?.count, 1);
  } finally {
    await stopServer(app.server);
  }
});

test("a duplicate provider message does not create customers or conversations", async () => {
  const app = await startWhatsAppServer();
  const body = whatsappEnvelope([
    whatsappChange({
      messages: [
        textWhatsAppMessage({
          id: "wamid.duplicate-foundation",
          text: "Only once",
          timestamp: "1760005000",
        }),
      ],
    }),
  ]);

  try {
    assert.equal((await postWhatsApp(app, body)).status, 200);
    const before = await pool.query<{ last_seen_at: Date }>(
      "SELECT last_seen_at FROM customers WHERE workspace_id = $1",
      [requireSession().workspace.id],
    );

    assert.equal((await postWhatsApp(app, body)).status, 200);

    const counts = await pool.query<{
      customers: number;
      conversations: number;
      messages: number;
    }>(`
      SELECT
        (SELECT count(*) FROM customers)::int AS customers,
        (SELECT count(*) FROM whatsapp_conversations)::int AS conversations,
        (SELECT count(*) FROM whatsapp_messages)::int AS messages
    `);
    assert.deepEqual(counts.rows[0], {
      customers: 1,
      conversations: 1,
      messages: 1,
    });

    const after = await pool.query<{ last_seen_at: Date }>(
      "SELECT last_seen_at FROM customers WHERE workspace_id = $1",
      [requireSession().workspace.id],
    );
    assert.equal(
      after.rows[0]?.last_seen_at.toISOString(),
      before.rows[0]?.last_seen_at.toISOString(),
    );
  } finally {
    await stopServer(app.server);
  }
});

test("a failed webhook batch rolls back customer and conversation creation", async () => {
  const workspaceId = requireSession().workspace.id;

  await assert.rejects(
    persistInboundMessages(pool, workspaceId, [
      inboundMessage({ text: "First stored message" }),
      inboundMessage({ providerMessageId: "w".repeat(600) }),
    ]),
  );

  const counts = await pool.query<{
    customers: number;
    conversations: number;
    messages: number;
    connections: number;
  }>(`
    SELECT
      (SELECT count(*) FROM customers)::int AS customers,
      (SELECT count(*) FROM whatsapp_conversations)::int AS conversations,
      (SELECT count(*) FROM whatsapp_messages)::int AS messages,
      (SELECT count(*) FROM whatsapp_connections)::int AS connections
  `);
  assert.deepEqual(counts.rows[0], {
    customers: 0,
    conversations: 0,
    messages: 0,
    connections: 0,
  });
});

test("a provider-only WhatsApp identity is preserved on the customer", async () => {
  const workspaceId = requireSession().workspace.id;

  await persistInboundMessages(pool, workspaceId, [
    inboundMessage({
      senderWaId: TEST_WHATSAPP_BSUID,
      senderPhoneNumber: null,
      contactName: "Username Customer",
    }),
  ]);

  const customers = await pool.query<{
    phone_e164: string | null;
    provider_contact_id: string | null;
  }>(
    `
      SELECT phone_e164, provider_contact_id
      FROM customers
      WHERE workspace_id = $1
    `,
    [workspaceId],
  );
  assert.deepEqual(customers.rows[0], {
    phone_e164: null,
    provider_contact_id: TEST_WHATSAPP_BSUID,
  });
});

test("WhatsApp phone normalization accepts phones and rejects provider identifiers", () => {
  // Valid international numbers keep their canonical E.164 form.
  assert.equal(normalizeWhatsAppPhoneE164("16505551234"), "+16505551234");
  assert.equal(normalizeWhatsAppPhoneE164("+1 (650) 555-1234"), "+16505551234");
  assert.equal(normalizeWhatsAppPhoneE164(" 16505551234 "), "+16505551234");

  // Nigerian numbers, with and without visual separators.
  assert.equal(normalizeWhatsAppPhoneE164("2348031234567"), "+2348031234567");
  assert.equal(normalizeWhatsAppPhoneE164("+234 803 123 4567"), "+2348031234567");

  // Short and long BSUIDs are provider identifiers, never phone numbers.
  assert.equal(normalizeWhatsAppPhoneE164("US.12345"), null);
  assert.equal(normalizeWhatsAppPhoneE164("US.13491208655302741918"), null);

  // Alphanumeric provider identifiers and other invalid values are rejected.
  assert.equal(normalizeWhatsAppPhoneE164("ABC12345678"), null);
  assert.equal(normalizeWhatsAppPhoneE164("wa_123456789"), null);
  assert.equal(normalizeWhatsAppPhoneE164("0016505551234"), null);
  assert.equal(normalizeWhatsAppPhoneE164("1650555123456789"), null);
  assert.equal(normalizeWhatsAppPhoneE164("1234"), null);
  assert.equal(normalizeWhatsAppPhoneE164(""), null);
  assert.equal(normalizeWhatsAppPhoneE164(null), null);
  assert.equal(normalizeWhatsAppPhoneE164(undefined), null);
});

test("customer identity comes from normalized phone numbers, not provider identifiers", async () => {
  const workspaceId = requireSession().workspace.id;

  await persistInboundMessages(pool, workspaceId, [
    inboundMessage({
      senderWaId: "2348031234567",
      senderPhoneNumber: "2348031234567",
      contactName: "Nigerian Customer",
      text: "First Nigerian message",
      providerTimestamp: new Date("2026-10-01T09:00:00.000Z"),
    }),
    inboundMessage({
      senderWaId: "2348031234567",
      senderPhoneNumber: "2348031234567",
      contactName: "Nigerian Customer",
      text: "Second Nigerian message",
      providerTimestamp: new Date("2026-10-01T09:01:00.000Z"),
    }),
    inboundMessage({
      senderWaId: "US.12345",
      senderPhoneNumber: null,
      contactName: "Short BSUID Customer",
      text: "First BSUID message",
      providerTimestamp: new Date("2026-10-01T09:02:00.000Z"),
    }),
    inboundMessage({
      senderWaId: "US.12345",
      senderPhoneNumber: null,
      contactName: "Short BSUID Customer",
      text: "Second BSUID message",
      providerTimestamp: new Date("2026-10-01T09:03:00.000Z"),
    }),
    inboundMessage({
      senderWaId: "ABC12345678",
      senderPhoneNumber: null,
      contactName: "Alphanumeric Customer",
      text: "Alphanumeric provider message",
      providerTimestamp: new Date("2026-10-01T09:04:00.000Z"),
    }),
  ]);

  const customers = await pool.query<{
    id: string;
    phone_e164: string | null;
    provider_contact_id: string | null;
  }>(
    `
      SELECT id, phone_e164, provider_contact_id
      FROM customers
      WHERE workspace_id = $1
      ORDER BY first_seen_at ASC, id ASC
    `,
    [workspaceId],
  );
  assert.equal(customers.rows.length, 3);
  assert.deepEqual(
    customers.rows.map((row) => ({
      phone_e164: row.phone_e164,
      provider_contact_id: row.provider_contact_id,
    })),
    [
      { phone_e164: "+2348031234567", provider_contact_id: null },
      { phone_e164: null, provider_contact_id: "US.12345" },
      { phone_e164: null, provider_contact_id: "ABC12345678" },
    ],
  );
  assert.equal(
    customers.rows.some(
      (row) => row.phone_e164 === "+12345" || row.phone_e164 === "+12345678",
    ),
    false,
  );

  const nigerian = customers.rows.find(
    (row) => row.phone_e164 === "+2348031234567",
  );
  const bsui = customers.rows.find(
    (row) => row.provider_contact_id === "US.12345",
  );
  const alphanumeric = customers.rows.find(
    (row) => row.provider_contact_id === "ABC12345678",
  );
  assert.ok(nigerian);
  assert.ok(bsui);
  assert.ok(alphanumeric);

  const messages = await pool.query<{ customer_id: string }>(
    `
      SELECT customer_id
      FROM whatsapp_messages
      WHERE workspace_id = $1
      ORDER BY provider_timestamp ASC, id ASC
    `,
    [workspaceId],
  );
  assert.deepEqual(
    messages.rows.map((row) => row.customer_id),
    [nigerian.id, nigerian.id, bsui.id, bsui.id, alphanumeric.id],
  );
});

test("concurrent deliveries of the same provider message are idempotent", async () => {
  const app = await startWhatsAppServer();
  const body = whatsappEnvelope([
    whatsappChange({
      messages: [
        textWhatsAppMessage({
          id: "wamid.concurrent-same-message",
          text: "Delivered more than once",
          timestamp: "1760006000",
        }),
      ],
    }),
  ]);

  try {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => postWhatsApp(app, body)),
    );
    const payloads = await Promise.all(
      responses.map((response) => {
        assert.equal(response.status, 200);
        return readJson<WhatsAppWebhookPayload>(response);
      }),
    );
    assert.equal(
      payloads.reduce((total, payload) => total + (payload.stored ?? 0), 0),
      1,
    );
    assert.equal(
      payloads.reduce((total, payload) => total + (payload.duplicates ?? 0), 0),
      4,
    );

    const counts = await pool.query<{
      customers: number;
      conversations: number;
      messages: number;
      connections: number;
    }>(`
      SELECT
        (SELECT count(*) FROM customers)::int AS customers,
        (SELECT count(*) FROM whatsapp_conversations)::int AS conversations,
        (SELECT count(*) FROM whatsapp_messages)::int AS messages,
        (SELECT count(*) FROM whatsapp_connections)::int AS connections
    `);
    assert.deepEqual(counts.rows[0], {
      customers: 1,
      conversations: 1,
      messages: 1,
      connections: 1,
    });
  } finally {
    await stopServer(app.server);
  }
});

test("a duplicate provider message does not reopen an archived conversation", async () => {
  const workspaceId = requireSession().workspace.id;
  const message = inboundMessage({
    providerMessageId: "wamid.archived-duplicate",
    text: "Archived once",
    providerTimestamp: new Date("2026-10-01T09:00:00.000Z"),
  });

  await persistInboundMessages(pool, workspaceId, [message]);
  const stored = await pool.query<{ id: string }>(
    "SELECT id FROM whatsapp_conversations WHERE workspace_id = $1",
    [workspaceId],
  );
  const conversationId = stored.rows[0]?.id;
  assert.ok(conversationId);
  await pool.query(
    "UPDATE whatsapp_conversations SET status = 'archived' WHERE id = $1",
    [conversationId],
  );

  const duplicate = await persistInboundMessages(pool, workspaceId, [message]);
  assert.deepEqual(duplicate, { stored: 0, duplicates: 1 });

  const after = await pool.query<{ id: string; status: string }>(
    "SELECT id, status FROM whatsapp_conversations WHERE workspace_id = $1",
    [workspaceId],
  );
  assert.equal(after.rows.length, 1);
  assert.equal(after.rows[0]?.id, conversationId);
  assert.equal(after.rows[0]?.status, "archived");

  const counts = await pool.query<{ messages: number }>(
    "SELECT count(*)::int AS messages FROM whatsapp_messages WHERE workspace_id = $1",
    [workspaceId],
  );
  assert.equal(counts.rows[0]?.messages, 1);
});

test("equal-timestamp messages paginate in a stable database order", async () => {
  const workspaceId = requireSession().workspace.id;
  const timestamp = new Date("2026-10-01T09:00:00.000Z");

  await persistInboundMessages(
    pool,
    workspaceId,
    Array.from({ length: 5 }, (_, index) =>
      inboundMessage({
        text: `Tie ${index}`,
        providerTimestamp: timestamp,
      }),
    ),
  );

  const conversation = await pool.query<{ id: string }>(
    "SELECT id FROM whatsapp_conversations WHERE workspace_id = $1",
    [workspaceId],
  );
  const conversationId = conversation.rows[0]?.id;
  assert.ok(conversationId);

  const expected = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM whatsapp_messages
      WHERE workspace_id = $1
        AND conversation_id = $2
      ORDER BY provider_timestamp ASC, created_at ASC, id ASC
    `,
    [workspaceId, conversationId],
  );
  assert.equal(expected.rows.length, 5);

  const firstPage = await readJson<ConversationMessagesPayload>(
    await fetch(
      `${baseUrl}/api/conversations/${conversationId}/messages?limit=2`,
    ),
  );
  const secondPage = await readJson<ConversationMessagesPayload>(
    await fetch(
      `${baseUrl}/api/conversations/${conversationId}/messages?limit=2&offset=2`,
    ),
  );
  const thirdPage = await readJson<ConversationMessagesPayload>(
    await fetch(
      `${baseUrl}/api/conversations/${conversationId}/messages?limit=2&offset=4`,
    ),
  );

  assert.deepEqual(
    [...firstPage.messages, ...secondPage.messages, ...thirdPage.messages].map(
      (message) => message.id,
    ),
    expected.rows.map((row) => row.id),
  );
  assert.equal(firstPage.pagination.hasMore, true);
  assert.equal(secondPage.pagination.hasMore, true);
  assert.equal(thirdPage.pagination.hasMore, false);
});

test("GET /api/conversations lists customer details, latest message, and paginates", async () => {
  const workspaceId = requireSession().workspace.id;

  await persistInboundMessages(pool, workspaceId, [
    inboundMessage({
      senderWaId: "16505551234",
      senderPhoneNumber: "16505551234",
      contactName: "Alpha Customer",
      text: "Older message",
      providerTimestamp: new Date("2026-10-01T09:00:00.000Z"),
    }),
    inboundMessage({
      senderWaId: "2348031234567",
      senderPhoneNumber: "2348031234567",
      contactName: "Beta Customer",
      text: "Newer message",
      providerTimestamp: new Date("2026-10-01T10:00:00.000Z"),
    }),
  ]);

  const firstPage = await fetch(`${baseUrl}/api/conversations?limit=1`);
  assert.equal(firstPage.status, 200);
  const firstPayload = await readJson<ConversationsPayload>(firstPage);
  assert.equal(firstPayload.conversations.length, 1);
  assert.deepEqual(firstPayload.pagination, {
    limit: 1,
    offset: 0,
    hasMore: true,
    nextOffset: 1,
  });

  const newest = firstPayload.conversations[0];
  assert.ok(newest);
  assert.equal(newest.customer.displayName, "Beta Customer");
  assert.equal(newest.customer.phoneE164, "+2348031234567");
  assert.equal(newest.status, "open");
  assert.equal(newest.channel, "whatsapp");
  assert.equal(newest.lastMessagePreview, "Newer message");
  assert.equal(newest.lastMessageAt, "2026-10-01T10:00:00.000Z");

  const secondPage = await readJson<ConversationsPayload>(
    await fetch(`${baseUrl}/api/conversations?limit=1&offset=1`),
  );
  assert.equal(secondPage.conversations.length, 1);
  assert.equal(
    secondPage.conversations[0]?.customer.displayName,
    "Alpha Customer",
  );
  assert.deepEqual(secondPage.pagination, {
    limit: 1,
    offset: 1,
    hasMore: false,
    nextOffset: null,
  });

  const invalidStatus = await fetch(
    `${baseUrl}/api/conversations?status=unread`,
  );
  assert.equal(invalidStatus.status, 400);
});

test("GET /api/conversations filters by conversation status", async () => {
  const workspaceId = requireSession().workspace.id;

  await persistInboundMessages(pool, workspaceId, [
    inboundMessage({
      senderWaId: "16505551234",
      senderPhoneNumber: "16505551234",
      contactName: "Open Customer",
    }),
    inboundMessage({
      senderWaId: "2348031234567",
      senderPhoneNumber: "2348031234567",
      contactName: "Closed Customer",
      providerTimestamp: new Date("2026-10-01T11:00:00.000Z"),
    }),
  ]);

  await pool.query(
    `
      UPDATE whatsapp_conversations
      SET status = 'closed'
      WHERE workspace_id = $1
        AND customer_id = (
          SELECT id
          FROM customers
          WHERE workspace_id = $1
            AND phone_e164 = '+2348031234567'
        )
    `,
    [workspaceId],
  );

  const closed = await readJson<ConversationsPayload>(
    await fetch(`${baseUrl}/api/conversations?status=closed`),
  );
  assert.deepEqual(
    closed.conversations.map((conversation) => conversation.customer.displayName),
    ["Closed Customer"],
  );

  const open = await readJson<ConversationsPayload>(
    await fetch(`${baseUrl}/api/conversations?status=open`),
  );
  assert.deepEqual(
    open.conversations.map((conversation) => conversation.customer.displayName),
    ["Open Customer"],
  );
});

test("GET /api/conversations/:id is workspace-scoped and returns a consistent 404", async () => {
  const owner = requireSession();

  await persistInboundMessages(pool, owner.workspace.id, [inboundMessage()]);
  const stored = await pool.query<{ id: string }>(
    "SELECT id FROM whatsapp_conversations WHERE workspace_id = $1",
    [owner.workspace.id],
  );
  const conversationId = stored.rows[0]?.id;
  assert.ok(conversationId);

  const ownerResponse = await fetch(
    `${baseUrl}/api/conversations/${conversationId}`,
  );
  assert.equal(ownerResponse.status, 200);
  const ownerPayload = await readJson<ConversationPayload>(ownerResponse);
  assert.equal(ownerPayload.conversation.id, conversationId);
  assert.equal(ownerPayload.conversation.customer.phoneE164, "+16505551234");
  assert.equal(ownerPayload.conversation.customer.displayName, "Sheena Nelson");

  const other = await registerUser();
  const foreign = await requestAs(
    other,
    `/api/conversations/${conversationId}`,
  );
  assert.equal(foreign.status, 404);
  assert.deepEqual(await readJson(foreign), {
    error: "Conversation not found",
  });

  const unknown = await fetch(`${baseUrl}/api/conversations/${randomUUID()}`);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await readJson(unknown), {
    error: "Conversation not found",
  });

  const malformed = await fetch(`${baseUrl}/api/conversations/not-a-uuid`);
  assert.equal(malformed.status, 400);
});

test("GET /api/conversations/:id/messages paginates stably and stays workspace-scoped", async () => {
  const owner = requireSession();

  await persistInboundMessages(pool, owner.workspace.id, [
    inboundMessage({
      text: "First",
      providerTimestamp: new Date("2026-10-01T09:00:00.000Z"),
    }),
    inboundMessage({
      text: "Second",
      providerTimestamp: new Date("2026-10-01T10:00:00.000Z"),
    }),
    inboundMessage({
      text: "Third",
      providerTimestamp: new Date("2026-10-01T11:00:00.000Z"),
    }),
  ]);

  const stored = await pool.query<{ id: string }>(
    "SELECT id FROM whatsapp_conversations WHERE workspace_id = $1",
    [owner.workspace.id],
  );
  const conversationId = stored.rows[0]?.id;
  assert.ok(conversationId);

  const firstPage = await readJson<ConversationMessagesPayload>(
    await fetch(
      `${baseUrl}/api/conversations/${conversationId}/messages?limit=2`,
    ),
  );
  assert.deepEqual(
    firstPage.messages.map((message) => message.text),
    ["First", "Second"],
  );
  assert.deepEqual(firstPage.pagination, {
    limit: 2,
    offset: 0,
    hasMore: true,
    nextOffset: 2,
  });

  const secondPage = await readJson<ConversationMessagesPayload>(
    await fetch(
      `${baseUrl}/api/conversations/${conversationId}/messages?limit=2&offset=2`,
    ),
  );
  assert.deepEqual(
    secondPage.messages.map((message) => message.text),
    ["Third"],
  );
  assert.deepEqual(secondPage.pagination, {
    limit: 2,
    offset: 2,
    hasMore: false,
    nextOffset: null,
  });

  const other = await registerUser();
  const foreign = await requestAs(
    other,
    `/api/conversations/${conversationId}/messages`,
  );
  assert.equal(foreign.status, 404);
  assert.deepEqual(await readJson(foreign), {
    error: "Conversation not found",
  });
});
