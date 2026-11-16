import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import type { Pool } from "pg";
import {
  GeminiReplyDraftProvider,
  MockReplyDraftProvider,
  ReplyDraftProviderError,
  type ReplyDraftProvider,
} from "../src/ai/reply-draft.js";
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
