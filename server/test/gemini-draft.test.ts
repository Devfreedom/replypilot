import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type { Pool } from "pg";
import {
  DEFAULT_GEMINI_FALLBACK_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_TIMEOUT_MS,
  GeminiReplyDraftProvider,
  MockReplyDraftProvider,
  ReplyDraftProviderError,
  resolveReplyDraftProviderKind,
  type ReplyDraftProvider,
} from "../src/ai/reply-draft.js";
import { loadConfig } from "../src/config.js";
import {
  buildCatalogueReplySource,
  MAX_SOURCES,
} from "../src/business/provenance.js";
import {
  createCatalogueEntry,
  createKnowledgeEntry,
} from "../src/business/repository.js";
import type {
  CatalogueEntry,
  KnowledgeEntry,
  ReplyContext,
} from "../src/business/types.js";
import { createPool } from "../src/db/pool.js";
import { createLead } from "../src/leads/repository.js";
import type { Lead } from "../src/leads/types.js";
import {
  createReplyDraft,
  getReplyDraftForLead,
  listReplyDraftsForLead,
  mapReplyDraftRow,
  replaceGeneratedReplyDraft,
} from "../src/reply-drafts/repository.js";
import { generateReplyDraft } from "../src/reply-drafts/service.js";
import type { ReplyDraftRow } from "../src/reply-drafts/types.js";
import { LEGACY_WORKSPACE_ID } from "../src/workspaces/repository.js";
import {
  getTestDatabaseUrl,
  prepareTestDatabase,
  resetTestData,
} from "./test-database.js";

/**
 * Allows `node --import tsx --test server/test/gemini-draft.test.ts` to find
 * the test database URL without `--env-file-if-exists=.env` while only
 * loading the two database URL variables and never logging or mutating `.env`.
 */
function ensureTestDatabaseEnv(): void {
  if (process.env.TEST_DATABASE_URL && process.env.DATABASE_URL) {
    return;
  }

  try {
    const rawEnv = readFileSync(path.join(process.cwd(), ".env"), "utf8");
    for (const line of rawEnv.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      if (key !== "DATABASE_URL" && key !== "TEST_DATABASE_URL") continue;
      if (process.env[key]) continue;
      let val = trimmed.slice(eqIndex + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  } catch {
    // Caller-provided environment variables will be validated by getTestDatabaseUrl.
  }
}

ensureTestDatabaseEnv();

const testDatabaseUrl = getTestDatabaseUrl();
let pool: Pool;

before(async () => {
  pool = createPool(testDatabaseUrl);
  await prepareTestDatabase(pool);
});

after(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetTestData(pool);
});

const SAMPLE_API_KEY = "AIzaSy-test-secret-do-not-expose-12345";
const NOW_ISO = "2026-11-16T04:00:00.000Z";

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Adaeze Okafor",
    service: "Wedding photography",
    channel: "WhatsApp",
    status: "New",
    lastMessage: "Hi, how much is your full-day wedding photography package?",
    whatsappNumber: "+447700900123",
    nextFollowUpAt: null,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...overrides,
  };
}

function makeCatalogueEntry(
  overrides: Partial<CatalogueEntry> = {},
): CatalogueEntry {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Full-Day Wedding Photography",
    description: "8 hours of wedding photography coverage and online gallery.",
    priceMinor: 150_000,
    currencyCode: "GBP",
    isActive: true,
    availabilityNotes: "Weekends subject to confirmation",
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...overrides,
  };
}

function makeKnowledgeEntry(
  overrides: Partial<KnowledgeEntry> = {},
): KnowledgeEntry {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    title: "Wedding booking deposit policy",
    answer: "A 25% deposit reserves your wedding photography date.",
    entryType: "policy",
    isActive: true,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...overrides,
  };
}

function makeContext(overrides: Partial<ReplyContext> = {}): ReplyContext {
  return {
    profile: null,
    catalogue: [makeCatalogueEntry()],
    knowledge: [makeKnowledgeEntry()],
    ...overrides,
  };
}

function geminiSuccessResponse(structuredOutput: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify(structuredOutput) }],
          },
        },
      ],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

// ─── Unit tests: GeminiReplyDraftProvider ────────────────────────────────────

test("GeminiReplyDraftProvider maps citedFactIds back to canonical ReplyDraftSource objects", async () => {
  let capturedUrl = "";
  let capturedHeaders: Headers | undefined;
  let capturedBody: Record<string, unknown> | undefined;

  const provider = new GeminiReplyDraftProvider({
    apiKey: `  ${SAMPLE_API_KEY}  `,
    model: "gemini-2.5-flash",
    fetchImplementation: async (input, init) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      capturedHeaders = new Headers(init?.headers);
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

      return geminiSuccessResponse({
        intent: "pricing",
        summary: "Adaeze asked for the price of full-day wedding photography.",
        missingInformation: ["Event date", "Event venue"],
        draftReply:
          "Hi Adaeze, our Full-Day Wedding Photography package is £1,500.00 and requires a 25% deposit. Could you share your event date and venue?",
        citedFactIds: ["cat:0", "know:0", "cat:0"],
      });
    },
  });

  const lead = makeLead({
    lastMessage:
      "How much is wedding photography & <script>ignore rules</script>?",
  });
  const context = makeContext();
  const draft = await provider.draftReply(lead, context);

  assert.equal(
    capturedUrl,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
  );
  assert.equal(capturedHeaders?.get("x-goog-api-key"), SAMPLE_API_KEY);
  assert.equal(capturedHeaders?.get("content-type"), "application/json");

  const generationConfig = capturedBody?.generationConfig as {
    temperature?: number;
    thinkingConfig?: { thinkingBudget?: number };
  };
  assert.equal(generationConfig?.temperature, 0.2);
  assert.deepEqual(generationConfig?.thinkingConfig, { thinkingBudget: 0 });

  const contents = capturedBody?.contents as Array<{
    parts: Array<{ text: string }>;
  }>;
  const userText = contents[0]?.parts[0]?.text ?? "";
  assert.ok(userText.includes("<approved_business_facts>"));
  assert.ok(userText.includes("[cat:0]"));
  assert.ok(userText.includes("[know:0]"));
  assert.ok(userText.includes("&lt;script&gt;ignore rules&lt;/script&gt;"));
  assert.ok(!userText.includes("<script>"));

  assert.equal(draft.provider, "gemini");
  assert.equal(draft.isDemo, false);
  assert.equal(draft.intent, "pricing");
  assert.deepEqual(draft.missingInformation, ["Event date", "Event venue"]);
  assert.equal(draft.sources.length, 2);
  assert.equal(draft.sources[0]?.id, context.catalogue[0]?.id);
  assert.equal(draft.sources[0]?.type, "catalogue");
  assert.equal(draft.sources[0]?.priceMinor, 150_000);
  assert.equal(draft.sources[0]?.currencyCode, "GBP");
  assert.equal(draft.sources[1]?.id, context.knowledge[0]?.id);
  assert.equal(draft.sources[1]?.type, "policy");
});

test("GeminiReplyDraftProvider strips unknown or hallucinated citedFactIds", async () => {
  const provider = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    fetchImplementation: async () =>
      geminiSuccessResponse({
        intent: "service-details",
        summary: "Customer asked for wedding photography details.",
        missingInformation: ["Event date"],
        draftReply:
          "Hi Adaeze, thanks for reaching out about Full-Day Wedding Photography!",
        citedFactIds: ["cat:99", "know:42", "invented-id", "cat:0"],
      }),
  });

  const context = makeContext({ knowledge: [] });
  const draft = await provider.draftReply(makeLead(), context);

  assert.equal(draft.sources.length, 1);
  assert.equal(draft.sources[0]?.id, context.catalogue[0]?.id);
});

test("GeminiReplyDraftProvider enforces missing approved price on pricing enquiries", async () => {
  const provider = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    fetchImplementation: async () =>
      geminiSuccessResponse({
        intent: "pricing",
        summary: "Customer asked for pricing.",
        missingInformation: [
          "Item 1",
          "Item 2",
          "Item 3",
          "Item 4",
          "Item 5",
          "Item 6",
          "Item 7",
          "Item 8",
          "Item 9",
          "Item 10",
        ],
        draftReply:
          "Hi Adaeze, thanks for asking about Wedding photography. Could you share your date so the owner can confirm pricing?",
        citedFactIds: ["cat:0"],
      }),
  });

  const unpricedContext = makeContext({
    catalogue: [makeCatalogueEntry({ priceMinor: null })],
    knowledge: [],
  });
  const draft = await provider.draftReply(makeLead(), unpricedContext);

  assert.equal(draft.missingInformation.length, 10);
  assert.ok(
    draft.missingInformation.includes(
      "An approved price for the requested service",
    ),
  );
});

test("GeminiReplyDraftProvider rejects missing or blank API keys without leaking secrets", () => {
  assert.throws(
    () => new GeminiReplyDraftProvider({ apiKey: "" }),
    (error: unknown) =>
      error instanceof ReplyDraftProviderError &&
      /GEMINI_API_KEY must not be empty/.test(error.message),
  );

  assert.throws(
    () => new GeminiReplyDraftProvider({ apiKey: "   \t\n  " }),
    (error: unknown) =>
      error instanceof ReplyDraftProviderError &&
      /GEMINI_API_KEY must not be empty/.test(error.message),
  );
});

test("GeminiReplyDraftProvider wraps non-2xx HTTP responses without exposing API key", async () => {
  for (const status of [429, 500, 503]) {
    const provider = new GeminiReplyDraftProvider({
      apiKey: SAMPLE_API_KEY,
      fetchImplementation: async () =>
        new Response(JSON.stringify({ error: { message: "upstream error" } }), {
          status,
        }),
    });

    await assert.rejects(
      () => provider.draftReply(makeLead(), makeContext()),
      (error: unknown) => {
        assert.ok(error instanceof ReplyDraftProviderError);
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert.ok(!error.message.includes(SAMPLE_API_KEY));
        return true;
      },
    );
  }
});

test("GeminiReplyDraftProvider wraps network errors and redacts any leaked key", async () => {
  const provider = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    fetchImplementation: async () => {
      throw new TypeError(
        `fetch failed with x-goog-api-key=${SAMPLE_API_KEY}`,
      );
    },
  });

  await assert.rejects(
    () => provider.draftReply(makeLead(), makeContext()),
    (error: unknown) => {
      assert.ok(error instanceof ReplyDraftProviderError);
      assert.match(error.message, /Gemini API request failed/);
      assert.ok(!error.message.includes(SAMPLE_API_KEY));
      return true;
    },
  );
});

test("GeminiReplyDraftProvider wraps AbortSignal timeouts as ReplyDraftProviderError", async () => {
  const provider = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    timeoutMs: 15,
    fetchImplementation: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("Missing AbortSignal"));
          return;
        }
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            reject(signal.reason);
          },
          { once: true },
        );
      }),
  });

  await assert.rejects(
    () => provider.draftReply(makeLead(), makeContext()),
    (error: unknown) => {
      assert.ok(error instanceof ReplyDraftProviderError);
      assert.match(error.message, /Gemini API request failed/);
      assert.ok(!error.message.includes(SAMPLE_API_KEY));
      return true;
    },
  );
});

test("GeminiReplyDraftProvider wraps malformed response JSON, empty candidate text, and schema-invalid payloads", async () => {
  const malformedPayloadProvider = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    fetchImplementation: async () => new Response("not-json", { status: 200 }),
  });
  await assert.rejects(
    () => malformedPayloadProvider.draftReply(makeLead(), makeContext()),
    (error: unknown) =>
      error instanceof ReplyDraftProviderError &&
      /invalid JSON response/i.test(error.message) &&
      !error.message.includes(SAMPLE_API_KEY),
  );

  for (const emptyBody of [
    {},
    { candidates: [] },
    { candidates: [{ content: { parts: [{ text: "   " }] } }] },
  ]) {
    const emptyTextProvider = new GeminiReplyDraftProvider({
      apiKey: SAMPLE_API_KEY,
      fetchImplementation: async () =>
        new Response(JSON.stringify(emptyBody), { status: 200 }),
    });
    await assert.rejects(
      () => emptyTextProvider.draftReply(makeLead(), makeContext()),
      (error: unknown) =>
        error instanceof ReplyDraftProviderError &&
        /did not return a structured text candidate/i.test(error.message) &&
        !error.message.includes(SAMPLE_API_KEY),
    );
  }

  const badCandidateJsonProvider = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    fetchImplementation: async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "{broken json" }] } }],
        }),
        { status: 200 },
      ),
  });
  await assert.rejects(
    () => badCandidateJsonProvider.draftReply(makeLead(), makeContext()),
    (error: unknown) =>
      error instanceof ReplyDraftProviderError &&
      /not valid JSON/i.test(error.message) &&
      !error.message.includes(SAMPLE_API_KEY),
  );

  const schemaInvalidProvider = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    fetchImplementation: async () =>
      geminiSuccessResponse({
        intent: "unsupported-intent",
        summary: "Summary",
        missingInformation: [],
        draftReply: "Reply",
        citedFactIds: [],
        unexpectedField: true,
      }),
  });
  await assert.rejects(
    () => schemaInvalidProvider.draftReply(makeLead(), makeContext()),
    (error: unknown) =>
      error instanceof ReplyDraftProviderError &&
      /failed schema validation/i.test(error.message) &&
      !error.message.includes(SAMPLE_API_KEY),
  );
});

// ─── Unit tests: mapReplyDraftRow validation ─────────────────────────────────

test("mapReplyDraftRow accepts valid gemini/mock metadata and rejects invalid combinations", () => {
  const now = new Date(NOW_ISO);
  const baseRow: ReplyDraftRow = {
    id: randomUUID(),
    lead_id: randomUUID(),
    intent: "pricing",
    summary: "Customer requested wedding photography pricing.",
    missing_information: ["Event date"],
    draft_reply: "Hi Adaeze, our package is £1,500.00.",
    provider: "gemini",
    is_demo: false,
    status: "draft",
    sources: [],
    approved_at: null,
    approved_by: null,
    send_policy_override: null,
    approval_send_policy: null,
    created_at: now,
    updated_at: now,
  };

  const validGemini = mapReplyDraftRow(baseRow);
  assert.equal(validGemini.provider, "gemini");
  assert.equal(validGemini.isDemo, false);

  const validMock = mapReplyDraftRow({
    ...baseRow,
    provider: "mock",
    is_demo: true,
  });
  assert.equal(validMock.provider, "mock");
  assert.equal(validMock.isDemo, true);

  assert.throws(
    () => mapReplyDraftRow({ ...baseRow, provider: "gemini", is_demo: true }),
    /unsupported provider metadata/,
  );
  assert.throws(
    () => mapReplyDraftRow({ ...baseRow, provider: "mock", is_demo: false }),
    /unsupported provider metadata/,
  );
  assert.throws(
    () => mapReplyDraftRow({ ...baseRow, provider: "openai", is_demo: false }),
    /unsupported provider metadata/,
  );
});

// ─── Database round-trip persistence tests ───────────────────────────────────

test("GeminiReplyDraftProvider persists and reloads with provider 'gemini', isDemo false, and canonicalized sources", async () => {
  const lead = await createLead(pool, LEGACY_WORKSPACE_ID, {
    name: "Chinedu Eze",
    service: "Wedding photography",
    lastMessage:
      "Hi, how much is your wedding photography package and what is your deposit policy?",
    whatsappNumber: null,
    confirmUnresolvedNumber: false,
    channel: "Manual",
    status: "New",
    nextFollowUpAt: null,
  });

  const catalogueEntry = await createCatalogueEntry(pool, LEGACY_WORKSPACE_ID, {
    name: "Wedding photography gold package",
    description: "Full-day wedding photography coverage.",
    priceMinor: 250_000,
    currencyCode: "GBP",
    isActive: true,
    availabilityNotes: "Available weekends",
  });

  const knowledgeEntry = await createKnowledgeEntry(pool, LEGACY_WORKSPACE_ID, {
    title: "Booking deposit policy",
    answer: "A 25% deposit confirms your wedding date.",
    entryType: "policy",
    isActive: true,
  });

  let callCount = 0;
  const geminiProvider = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    fetchImplementation: async () => {
      callCount += 1;
      if (callCount === 1) {
        return geminiSuccessResponse({
          intent: "pricing",
          summary:
            "Chinedu asked for wedding photography pricing and deposit policy.",
          missingInformation: ["Event date", "Venue location"],
          draftReply:
            "Hi Chinedu, our Wedding photography gold package is £2,500.00 with a 25% deposit. Could you share your event date and venue?",
          citedFactIds: ["cat:0", "know:0", "cat:99"],
        });
      }

      return geminiSuccessResponse({
        intent: "booking",
        summary: "Regenerated booking summary for Chinedu.",
        missingInformation: ["Preferred date"],
        draftReply:
          "Hi Chinedu, we can confirm Wedding photography gold package (£2,500.00) once you share your preferred date.",
        citedFactIds: ["cat:0"],
      });
    },
  });

  const generated = await generateReplyDraft(
    pool,
    LEGACY_WORKSPACE_ID,
    lead,
    geminiProvider,
  );
  assert.equal(generated.provider, "gemini");
  assert.equal(generated.isDemo, false);
  assert.equal(generated.sources.length, 2);
  assert.equal(generated.sources[0]?.id, catalogueEntry.id);
  assert.equal(generated.sources[1]?.id, knowledgeEntry.id);

  const created = await createReplyDraft(
    pool,
    LEGACY_WORKSPACE_ID,
    lead.id,
    generated,
  );
  assert.equal(created.provider, "gemini");
  assert.equal(created.isDemo, false);
  assert.equal(created.sources.length, 2);

  const loaded = await getReplyDraftForLead(
    pool,
    LEGACY_WORKSPACE_ID,
    lead.id,
    created.id,
  );
  assert.ok(loaded);
  assert.equal(loaded.provider, "gemini");
  assert.equal(loaded.isDemo, false);
  assert.deepEqual(loaded.sources, created.sources);

  const listed = await listReplyDraftsForLead(
    pool,
    LEGACY_WORKSPACE_ID,
    lead.id,
  );
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.provider, "gemini");
  assert.equal(listed[0]?.isDemo, false);

  // Also test replacing a mock draft with a regenerated Gemini draft.
  const mockDraft = await generateReplyDraft(
    pool,
    LEGACY_WORKSPACE_ID,
    lead,
    new MockReplyDraftProvider(),
  );
  const createdMock = await createReplyDraft(
    pool,
    LEGACY_WORKSPACE_ID,
    lead.id,
    mockDraft,
  );
  assert.equal(createdMock.provider, "mock");
  assert.equal(createdMock.isDemo, true);

  const regenerated = await generateReplyDraft(
    pool,
    LEGACY_WORKSPACE_ID,
    lead,
    geminiProvider,
  );
  const replaced = await replaceGeneratedReplyDraft(
    pool,
    LEGACY_WORKSPACE_ID,
    lead.id,
    createdMock.id,
    regenerated,
  );
  assert.equal(replaced.kind, "updated");
  assert.equal(replaced.draft.provider, "gemini");
  assert.equal(replaced.draft.isDemo, false);
  assert.equal(replaced.draft.sources.length, 1);
  assert.equal(replaced.draft.sources[0]?.id, catalogueEntry.id);

  const reloadedAfterReplace = await getReplyDraftForLead(
    pool,
    LEGACY_WORKSPACE_ID,
    lead.id,
    createdMock.id,
  );
  assert.equal(reloadedAfterReplace?.provider, "gemini");
  assert.equal(reloadedAfterReplace?.isDemo, false);
  assert.deepEqual(reloadedAfterReplace?.sources, replaced.draft.sources);
});

test("generateReplyDraft rejects mismatched provider/demo metadata and unapproved sources", async () => {
  const lead = await createLead(pool, LEGACY_WORKSPACE_ID, {
    name: "Tunde Bakare",
    service: "Event photography",
    lastMessage: "Are you free next Saturday?",
    whatsappNumber: null,
    confirmUnresolvedNumber: false,
    channel: "Manual",
    status: "New",
    nextFollowUpAt: null,
  });

  const mismatchedProvider: ReplyDraftProvider = {
    async draftReply() {
      return {
        intent: "availability",
        summary: "Availability check",
        missingInformation: ["Preferred date"],
        draftReply: "Thanks for reaching out!",
        provider: "gemini",
        isDemo: true,
        sources: [],
      };
    },
  };

  await assert.rejects(
    () =>
      generateReplyDraft(
        pool,
        LEGACY_WORKSPACE_ID,
        lead,
        mismatchedProvider,
      ),
    /Provider returned invalid reply draft output/,
  );

  const hallucinatedSourceProvider: ReplyDraftProvider = {
    async draftReply() {
      return {
        intent: "availability",
        summary: "Availability check",
        missingInformation: ["Preferred date"],
        draftReply: "Thanks for reaching out!",
        provider: "gemini",
        isDemo: false,
        sources: [
          {
            id: randomUUID(),
            type: "catalogue",
            title: "Unapproved package",
            content: "Invented price £10",
            reason: "Hallucinated",
            priceMinor: 1000,
            currencyCode: "GBP",
          },
        ],
      };
    },
  };

  await assert.rejects(
    () =>
      generateReplyDraft(
        pool,
        LEGACY_WORKSPACE_ID,
        lead,
        hallucinatedSourceProvider,
      ),
    /not selected from active approved context/,
  );
});

test("M14 bounds long keyword-match sourceReason strings to <= 300 chars and caps grounded facts at MAX_SOURCES", async () => {
  const longTokens = [
    "a".repeat(120),
    "b".repeat(120),
    "c".repeat(120),
  ];
  const lead = await createLead(pool, LEGACY_WORKSPACE_ID, {
    name: "Ngozi Mensah",
    service: `Wedding ${longTokens[0]}`,
    lastMessage: `Need pricing for ${longTokens[1]} and ${longTokens[2]} package`,
    whatsappNumber: null,
    confirmUnresolvedNumber: false,
    channel: "Manual",
    status: "New",
    nextFollowUpAt: null,
  });

  const directSource = buildCatalogueReplySource(
    makeCatalogueEntry({
      name: `Package ${longTokens[0]}`,
      description: `${longTokens[1]} ${longTokens[2]}`,
    }),
    lead,
  );
  assert.ok(directSource.reason.length <= 300);

  // Create 55 active catalogue entries matching the lead's enquiry (> MAX_SOURCES = 50).
  for (let i = 0; i < 55; i += 1) {
    await createCatalogueEntry(pool, LEGACY_WORKSPACE_ID, {
      name: `Wedding ${longTokens[0]} Option ${i}`,
      description: `Includes ${longTokens[1]} and ${longTokens[2]}`,
      priceMinor: 10_000 + i,
      currencyCode: "GBP",
      isActive: true,
      availabilityNotes: null,
    });
  }

  let sentFactCount = 0;
  const geminiProvider = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    fetchImplementation: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        contents: Array<{ parts: Array<{ text: string }> }>;
      };
      const userPrompt = body.contents[0]?.parts[0]?.text ?? "";
      const factMatches = userPrompt.match(/\[(?:cat|know):\d+\]/g) ?? [];
      sentFactCount = factMatches.length;

      // Attempt to cite both an in-cap ID and an out-of-cap ID (cat:52).
      return geminiSuccessResponse({
        intent: "pricing",
        summary: "Ngozi asked about wedding package pricing.",
        missingInformation: ["Event date"],
        draftReply:
          "Hi Ngozi, thanks for asking about our wedding packages. Could you share your event date?",
        citedFactIds: ["cat:0", "cat:49", "cat:52"],
      });
    },
  });

  const generated = await generateReplyDraft(
    pool,
    LEGACY_WORKSPACE_ID,
    lead,
    geminiProvider,
  );
  assert.equal(sentFactCount, MAX_SOURCES);
  assert.equal(generated.sources.length, 2);
  assert.ok(generated.sources.every((source) => source.reason.length <= 300));
});

test("GeminiReplyDraftProvider and MockReplyDraftProvider handle nullish runtime fields without crashing on trim", async () => {
  const partialLead = {
    ...makeLead(),
    name: undefined as unknown as string,
    service: null as unknown as string,
    lastMessage: undefined as unknown as string,
  };
  const partialContext = makeContext({
    catalogue: [
      {
        ...makeCatalogueEntry(),
        name: "Event Coverage",
        description: undefined as unknown as string,
        availabilityNotes: undefined as unknown as string | null,
      },
    ],
    knowledge: [
      {
        ...makeCatalogueEntry(),
        id: randomUUID(),
        title: "Deposit Policy",
        answer: undefined as unknown as string,
        entryType: "policy",
      } as unknown as KnowledgeEntry,
    ],
  });

  const gemini = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    fetchImplementation: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        contents: Array<{ parts: Array<{ text: string }> }>;
      };
      const prompt = body.contents[0]?.parts[0]?.text ?? "";
      assert.ok(prompt.includes("Customer Name: Customer"));
      assert.ok(prompt.includes("Requested Service: General enquiry"));
      assert.ok(prompt.includes("Customer Message: (No message text)"));

      return geminiSuccessResponse({
        intent: "general-enquiry",
        summary: "Customer submitted an enquiry with missing fields.",
        missingInformation: ["What the customer needs"],
        draftReply: "Hi there, could you share more details about what you need?",
        citedFactIds: [],
      });
    },
  });

  const geminiDraft = await gemini.draftReply(partialLead, partialContext);
  assert.equal(geminiDraft.provider, "gemini");
  assert.equal(geminiDraft.isDemo, false);

  const mockDraft = await new MockReplyDraftProvider().draftReply(
    partialLead,
    partialContext,
  );
  assert.equal(mockDraft.provider, "mock");
  assert.equal(mockDraft.isDemo, true);
});

test("GeminiReplyDraftProvider falls back cleanly from retired 404 models to default model and fails closed on generic 404", async () => {
  const calledUrls: string[] = [];

  const fallbackProvider = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    model: "gemini-2.5-flash",
    fetchImplementation: async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      calledUrls.push(url);

      if (url.includes("/models/gemini-2.5-flash:")) {
        return new Response(
          JSON.stringify({
            error: {
              code: 404,
              message:
                "This model models/gemini-2.5-flash is no longer available to new users.",
              status: "NOT_FOUND",
            },
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      }

      return geminiSuccessResponse({
        intent: "pricing",
        summary: "Customer asked for wedding photography pricing.",
        missingInformation: ["Event date"],
        draftReply:
          "Hi Adaeze, our package is £1,500.00. Could you share your event date?",
        citedFactIds: ["cat:0"],
      });
    },
  });

  const draft = await fallbackProvider.draftReply(makeLead(), makeContext());
  assert.equal(draft.provider, "gemini");
  assert.equal(calledUrls.length, 2);
  assert.ok(calledUrls[0]?.includes("/models/gemini-2.5-flash:generateContent"));
  assert.ok(calledUrls[1]?.includes("/models/gemini-3.8-flash:generateContent"));

  const generic404Provider = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    fetchImplementation: async () =>
      new Response(JSON.stringify({ error: { message: "Not found" } }), {
        status: 404,
      }),
  });

  await assert.rejects(
    () => generic404Provider.draftReply(makeLead(), makeContext()),
    (error: unknown) =>
      error instanceof ReplyDraftProviderError &&
      /HTTP 404/.test(error.message),
  );
});

test("resolveReplyDraftProviderKind distinguishes Gemini and mock providers", () => {
  assert.equal(
    resolveReplyDraftProviderKind(
      new GeminiReplyDraftProvider({ apiKey: SAMPLE_API_KEY }),
    ),
    "gemini",
  );
  assert.equal(
    resolveReplyDraftProviderKind(new MockReplyDraftProvider()),
    "mock",
  );
  assert.equal(resolveReplyDraftProviderKind(undefined), "mock");
});

test("GEMINI_TIMEOUT_MS configures GeminiReplyDraftProvider timeout and defaults to 45_000 ms", async () => {
  assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.8-flash");
  assert.equal(DEFAULT_GEMINI_TIMEOUT_MS, 45_000);

  let defaultUrl = "";
  const defaultModelProvider = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    fetchImplementation: async (input) => {
      defaultUrl = typeof input === "string" ? input : input.toString();
      return geminiSuccessResponse({
        intent: "pricing",
        summary: "Customer asked for pricing.",
        missingInformation: ["Event date"],
        draftReply: "Hi Adaeze, please share your event date.",
        citedFactIds: [],
      });
    },
  });
  await defaultModelProvider.draftReply(makeLead(), makeContext());
  assert.equal(
    defaultUrl,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
  );

  const baseEnv = {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://replypilot:replypilot@localhost:5432/replypilot",
    BETTER_AUTH_SECRET: "replypilot-development-test-secret-0123456789",
    GEMINI_API_KEY: SAMPLE_API_KEY,
  };

  const defaultConfig = loadConfig(baseEnv);
  assert.equal(defaultConfig.gemini?.timeoutMs, 45_000);

  const overriddenConfig = loadConfig({
    ...baseEnv,
    GEMINI_TIMEOUT_MS: "75000",
  });
  assert.equal(overriddenConfig.gemini?.timeoutMs, 75_000);

  assert.ok(overriddenConfig.gemini);
  const provider = new GeminiReplyDraftProvider(overriddenConfig.gemini);
  assert.equal(provider.provider, "gemini");
});

test("GeminiReplyDraftProvider classifies 429 rate limits, AbortSignal timeouts, and 5xx upstream errors", async () => {
  const rateLimited = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    fetchImplementation: async () =>
      new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), {
        status: 429,
      }),
  });
  await assert.rejects(
    () => rateLimited.draftReply(makeLead(), makeContext()),
    (error: unknown) =>
      error instanceof ReplyDraftProviderError &&
      error.code === "rate_limit" &&
      error.statusCode === 429 &&
      error.userMessage ===
        "AI provider quota or rate limit reached. Wait a moment or check your API plan and try again.",
  );

  const timedOut = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    timeoutMs: 15,
    fetchImplementation: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      }),
  });
  await assert.rejects(
    () => timedOut.draftReply(makeLead(), makeContext()),
    (error: unknown) =>
      error instanceof ReplyDraftProviderError &&
      error.code === "timeout" &&
      error.statusCode === 504 &&
      error.userMessage === "AI provider timed out. Please try again.",
  );

  const upstream500Failed = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    fetchImplementation: async () =>
      new Response(JSON.stringify({ error: { message: "Internal error" } }), {
        status: 500,
      }),
  });
  await assert.rejects(
    () => upstream500Failed.draftReply(makeLead(), makeContext()),
    (error: unknown) =>
      error instanceof ReplyDraftProviderError &&
      error.code === "upstream_error" &&
      error.statusCode === 502,
  );

  const upstream503Failed = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    fetchImplementation: async () =>
      new Response(JSON.stringify({ error: { message: "Unavailable" } }), {
        status: 503,
      }),
  });
  await assert.rejects(
    () => upstream503Failed.draftReply(makeLead(), makeContext()),
    (error: unknown) =>
      error instanceof ReplyDraftProviderError &&
      error.code === "upstream_error" &&
      error.statusCode === 503,
  );
});

test("GeminiReplyDraftProvider performs single-hop 503 fallback to configured fallbackModel", async () => {
  assert.equal(DEFAULT_GEMINI_FALLBACK_MODEL, "gemini-3.1-flash-lite");

  const baseEnv = {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://replypilot:replypilot@localhost:5432/replypilot",
    BETTER_AUTH_SECRET: "replypilot-development-test-secret-0123456789",
    GEMINI_API_KEY: SAMPLE_API_KEY,
  };

  const defaultCfg = loadConfig(baseEnv);
  assert.equal(defaultCfg.gemini?.fallbackModel, "gemini-3.1-flash-lite");

  const calledUrls: string[] = [];
  const provider = new GeminiReplyDraftProvider({
    ...defaultCfg.gemini!,
    fetchImplementation: async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      calledUrls.push(url);

      if (calledUrls.length === 1) {
        return new Response(
          JSON.stringify({ error: { code: 503, message: "High demand" } }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
      }

      return geminiSuccessResponse({
        intent: "pricing",
        summary: "Customer asked for wedding photography pricing.",
        missingInformation: ["Event date"],
        draftReply:
          "Hi Adaeze, our package is £1,500.00. Could you share your event date?",
        citedFactIds: ["cat:0"],
      });
    },
  });

  const draft = await provider.draftReply(makeLead(), makeContext());
  assert.equal(draft.provider, "gemini");
  assert.equal(calledUrls.length, 2);
  assert.ok(
    calledUrls[0]?.includes(`/models/${DEFAULT_GEMINI_MODEL}:generateContent`),
  );
  assert.ok(
    calledUrls[1]?.includes("/models/gemini-3.1-flash-lite:generateContent"),
  );
});

test("GeminiReplyDraftProvider does not trigger 503 fallback on 429, 400, 401, 403, or 404", async () => {
  for (const status of [429, 400, 401, 403, 404]) {
    let fetchCount = 0;
    const provider = new GeminiReplyDraftProvider({
      apiKey: SAMPLE_API_KEY,
      model: "gemini-3.8-flash",
      fallbackModel: "gemini-3.1-flash-lite",
      fetchImplementation: async () => {
        fetchCount += 1;
        return new Response(
          JSON.stringify({ error: { message: `Status ${status}` } }),
          { status, headers: { "Content-Type": "application/json" } },
        );
      },
    });

    await assert.rejects(
      () => provider.draftReply(makeLead(), makeContext()),
      (error: unknown) => error instanceof ReplyDraftProviderError,
    );
    assert.equal(
      fetchCount,
      1,
      `Expected exactly 1 fetch call for HTTP ${status}, got ${fetchCount}`,
    );
  }
});

test("GeminiReplyDraftProvider maps double 503 (primary and fallback) to HTTP 503 after 2 calls", async () => {
  const calledUrls: string[] = [];
  const provider = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    model: "gemini-3.8-flash",
    fallbackModel: "gemini-3.1-flash-lite",
    fetchImplementation: async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      calledUrls.push(url);
      return new Response(
        JSON.stringify({ error: { code: 503, message: "Overloaded" } }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  await assert.rejects(
    () => provider.draftReply(makeLead(), makeContext()),
    (error: unknown) =>
      error instanceof ReplyDraftProviderError &&
      error.code === "upstream_error" &&
      error.statusCode === 503,
  );
  assert.equal(calledUrls.length, 2);
  assert.ok(calledUrls[0]?.includes("/models/gemini-3.8-flash:generateContent"));
  assert.ok(
    calledUrls[1]?.includes("/models/gemini-3.1-flash-lite:generateContent"),
  );
});

test("GeminiReplyDraftProvider skips duplicate fallback call when GEMINI_FALLBACK_MODEL equals GEMINI_MODEL", async () => {
  const baseEnv = {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://replypilot:replypilot@localhost:5432/replypilot",
    BETTER_AUTH_SECRET: "replypilot-development-test-secret-0123456789",
    GEMINI_API_KEY: SAMPLE_API_KEY,
  };

  const sameExplicitCfg = loadConfig({
    ...baseEnv,
    GEMINI_MODEL: "gemini-3.8-flash",
    GEMINI_FALLBACK_MODEL: "gemini-3.8-flash",
  });
  assert.equal(sameExplicitCfg.gemini?.fallbackModel, undefined);

  const sameAsDefaultFallbackCfg = loadConfig({
    ...baseEnv,
    GEMINI_MODEL: "gemini-3.1-flash-lite",
  });
  assert.equal(sameAsDefaultFallbackCfg.gemini?.fallbackModel, undefined);

  let fetchCount = 0;
  const provider = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    model: "gemini-3.1-flash-lite",
    fallbackModel: "gemini-3.1-flash-lite",
    fetchImplementation: async () => {
      fetchCount += 1;
      return new Response(
        JSON.stringify({ error: { code: 503, message: "Overloaded" } }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  await assert.rejects(
    () => provider.draftReply(makeLead(), makeContext()),
    (error: unknown) =>
      error instanceof ReplyDraftProviderError && error.statusCode === 503,
  );
  assert.equal(fetchCount, 1);
});

// ─── Unit tests: H-10 grounding retention & missing-info hardening ───────────

test("H-10 retains long knowledge title+answer entries by truncating combined fact <= 700 chars", async () => {
  const longTitle = `Policy-${"T".repeat(93)}`; // 100 chars
  const longAnswer = `Coverage details: ${"A".repeat(632)}`; // 650 chars (<= 700, combined > 700)
  assert.equal(longTitle.length, 100);
  assert.equal(longAnswer.length, 650);

  const longPolicy = makeKnowledgeEntry({
    title: longTitle,
    answer: longAnswer,
    entryType: "policy",
  });

  let capturedPrompt = "";
  const geminiProvider = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    fetchImplementation: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        contents: Array<{ parts: Array<{ text: string }> }>;
      };
      capturedPrompt = body.contents[0]?.parts[0]?.text ?? "";

      return geminiSuccessResponse({
        intent: "service-details",
        summary: "Customer asked about long policy details.",
        missingInformation: ["Preferred date"],
        draftReply: "Hi Adaeze, please see our policy details.",
        citedFactIds: ["know:0"],
      });
    },
  });

  const geminiDraft = await geminiProvider.draftReply(
    makeLead({ lastMessage: "Tell me about your wedding policy details" }),
    makeContext({ catalogue: [], knowledge: [longPolicy] }),
  );

  const factLine = capturedPrompt
    .split("\n")
    .find((line) => line.startsWith("[know:0] "));
  assert.ok(factLine, "Expected [know:0] fact line to be retained in prompt");
  const factBody = factLine.slice("[know:0] ".length);
  assert.ok(
    factBody.length <= 700,
    `Expected formatted fact <= 700 chars, got ${factBody.length}`,
  );
  assert.ok(factBody.startsWith(`Approved policy — ${longTitle}:`));
  assert.ok(factBody.endsWith("…"));
  assert.equal(geminiDraft.sources.length, 1);
  assert.equal(geminiDraft.sources[0]?.id, longPolicy.id);

  // MockReplyDraftProvider also retains and truncates the combined fact <= 700 chars.
  const mockDraft = await new MockReplyDraftProvider().draftReply(
    makeLead({ lastMessage: "Tell me about your wedding policy details" }),
    makeContext({ catalogue: [], knowledge: [longPolicy] }),
  );
  assert.equal(mockDraft.sources.length, 1);
  assert.ok(mockDraft.draftReply.includes(`Approved policy — ${longTitle}:`));
  assert.ok(mockDraft.draftReply.includes("…"));

  // Answers strictly > 700 chars still defer to manual confirmation.
  const overlongAnswerPolicy = makeKnowledgeEntry({
    title: "Refund policy",
    answer: `Refund details: ${"R".repeat(800)}`,
    entryType: "policy",
  });
  const overlongMockDraft = await new MockReplyDraftProvider().draftReply(
    makeLead({ lastMessage: "What is your refund policy?" }),
    makeContext({ catalogue: [], knowledge: [overlongAnswerPolicy] }),
  );
  assert.match(
    overlongMockDraft.draftReply,
    /full approved text needs confirmation/i,
  );
});

test("H-10 filters placeholder missingInformation strings case-insensitively", async () => {
  const placeholderOnlyProvider = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    fetchImplementation: async () =>
      geminiSuccessResponse({
        intent: "service-details",
        summary: "Customer asked for service details.",
        missingInformation: [
          "  None ",
          "N/A",
          "no missing information",
          "Nothing missing.",
          "  -  ",
        ],
        draftReply: "Hi Adaeze, thanks for reaching out!",
        citedFactIds: [],
      }),
  });

  const fallbackDraft = await placeholderOnlyProvider.draftReply(
    makeLead({ lastMessage: "Tell me about your services" }),
    makeContext(),
  );
  assert.deepEqual(fallbackDraft.missingInformation, [
    "What the customer needs",
    "Preferred date",
  ]);

  const mixedProvider = new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    fetchImplementation: async () =>
      geminiSuccessResponse({
        intent: "service-details",
        summary: "Customer asked for service details.",
        missingInformation: ["NONE", "  Event venue  ", "n/a", "No missing info"],
        draftReply: "Hi Adaeze, could you share your venue?",
        citedFactIds: [],
      }),
  });

  const mixedDraft = await mixedProvider.draftReply(
    makeLead({ lastMessage: "Tell me about your services" }),
    makeContext(),
  );
  assert.deepEqual(mixedDraft.missingInformation, ["Event venue"]);
});

test("H-10 enforces pricing regex, missing policy when only FAQs exist, and actionable base missing info", async () => {
  const faqOnly = makeKnowledgeEntry({
    title: "Travel FAQ",
    answer: "We cover venues across the city.",
    entryType: "faq",
  });

  const providerForIntent = (intent: "booking" | "availability" | "pricing") =>
    new GeminiReplyDraftProvider({
      apiKey: SAMPLE_API_KEY,
      fetchImplementation: async () =>
        geminiSuccessResponse({
          intent,
          summary: "Customer asked about booking, pricing, and cancellation.",
          missingInformation: ["None", "N/A"],
          draftReply:
            "Hi Adaeze, please share your date and location so the owner can confirm availability, pricing, and policy details.",
          citedFactIds: [],
        }),
    });

  // Message contains "available" (which makes getIntent return "availability", not "pricing")
  // plus "how much" / "quote" and "cancellation", while model classifies "booking".
  const multiIntentLead = makeLead({
    lastMessage:
      "Are you available to book next month, how much is a quote, and what is your cancellation policy?",
  });
  const faqAndUnpricedContext = makeContext({
    catalogue: [makeCatalogueEntry({ priceMinor: null })],
    knowledge: [faqOnly],
  });

  const bookingDraft = await providerForIntent("booking").draftReply(
    multiIntentLead,
    faqAndUnpricedContext,
  );
  assert.deepEqual(bookingDraft.missingInformation, [
    "An approved price for the requested service",
    "An approved cancellation policy",
    "Preferred date and time",
    "Event location",
  ]);

  const availabilityDraft = await providerForIntent("availability").draftReply(
    multiIntentLead,
    faqAndUnpricedContext,
  );
  assert.deepEqual(availabilityDraft.missingInformation, [
    "An approved price for the requested service",
    "An approved cancellation policy",
    "Preferred date and time",
    "Event location",
  ]);

  // Pricing query regex triggers directly from lastMessage even on general-enquiry intent.
  const generalPricingDraft = await new GeminiReplyDraftProvider({
    apiKey: SAMPLE_API_KEY,
    fetchImplementation: async () =>
      geminiSuccessResponse({
        intent: "general-enquiry",
        summary: "Customer asked about package cost.",
        missingInformation: ["Event location"],
        draftReply: "Hi Adaeze, the owner will confirm package pricing.",
        citedFactIds: [],
      }),
  }).draftReply(
    makeLead({ lastMessage: "Are you free Saturday and what does a package cost?" }),
    makeContext({ catalogue: [], knowledge: [faqOnly] }),
  );
  assert.deepEqual(generalPricingDraft.missingInformation, [
    "An approved price for the requested service",
    "Event location",
  ]);

  // When an active policy entry exists and catalogue has a price, neither mandatory item is added.
  const satisfiedDraft = await providerForIntent("pricing").draftReply(
    makeLead({ lastMessage: "How much is wedding photography and what is your refund policy?" }),
    makeContext({
      catalogue: [makeCatalogueEntry({ priceMinor: 150_000 })],
      knowledge: [
        faqOnly,
        makeKnowledgeEntry({
          title: "Refund policy",
          answer: "Deposits are refundable within 14 days.",
          entryType: "policy",
        }),
      ],
    }),
  );
  assert.deepEqual(satisfiedDraft.missingInformation, [
    "Event date",
    "Event location",
    "What the customer needs",
  ]);

  // MockReplyDraftProvider also detects multi-intent pricing and missing policy when only FAQs exist.
  const mockMultiDraft = await new MockReplyDraftProvider().draftReply(
    multiIntentLead,
    faqAndUnpricedContext,
  );
  assert.ok(
    mockMultiDraft.missingInformation.includes(
      "An approved price for the requested service",
    ),
  );
  assert.ok(
    mockMultiDraft.missingInformation.includes(
      "An approved cancellation policy",
    ),
  );
});
