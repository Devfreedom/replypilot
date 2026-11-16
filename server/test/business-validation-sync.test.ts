import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { after, before, beforeEach, test } from "node:test";
import { Pool } from "pg";
import {
  BUSINESS_LIMITS,
  mapBusinessProfileServerErrors,
  mapCatalogueServerErrors,
  mapKnowledgeServerErrors,
  mapSuppressionServerErrors,
  validateBusinessProfileFields,
  validateCatalogueFields,
  validateKnowledgeFields,
} from "../../src/lib/business-validation.js";
import {
  LEAD_MESSAGE_MAX_LENGTH,
  LEAD_NAME_MAX_LENGTH,
  LEAD_SERVICE_MAX_LENGTH,
  REPLY_DRAFT_MAX_LENGTH,
  mapLeadServerErrors,
  validateDraftReplyText,
  validateNewLeadFields,
} from "../../src/lib/lead-validation.js";
import { parseLeadCreationError } from "../../src/lib/leads.js";
import { createApp } from "../src/app.js";
import {
  businessProfileSchema,
  catalogueEntrySchema,
  knowledgeEntrySchema,
} from "../src/business/schemas.js";
import { createPool } from "../src/db/pool.js";
import { createLeadSchema } from "../src/leads/schemas.js";
import { updateReplyDraftSchema } from "../src/reply-drafts/schemas.js";
import {
  getTestDatabaseUrl,
  prepareTestDatabase,
  resetTestData,
} from "./test-database.js";

const TEST_ORIGIN = "http://localhost:3000";
const TEST_SECRET = "replypilot-test-secret-with-at-least-32-characters";

async function startTestServer(
  pool: Pool,
): Promise<{ server: Server; baseUrl: string }> {
  const server = createApp({
    pool,
    auth: {
      secret: TEST_SECRET,
      baseURL: TEST_ORIGIN,
      trustedOrigins: [TEST_ORIGIN],
      rateLimit: { enabled: false },
      nodeEnv: "test",
    },
  }).listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected TCP listener address.");
  }

  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function stopServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function signUpOwner(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: TEST_ORIGIN,
    },
    body: JSON.stringify({
      email: "validation-owner@example.com",
      password: "secure-password-123",
      name: "Validation Owner",
    }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  assert.ok(cookie.length > 0);
  return cookie;
}

let pool: Pool;

before(async () => {
  pool = createPool(getTestDatabaseUrl());
  await prepareTestDatabase(pool);
});

beforeEach(async () => {
  await resetTestData(pool);
});

after(async () => {
  await pool.end();
});

test("client business and lead bounds stay synchronized with server Zod schemas at exact max lengths", () => {
  const maxProfileValues = {
    businessName: "n".repeat(BUSINESS_LIMITS.businessNameMax),
    timezone: "Africa/Lagos",
    businessDescription: "d".repeat(BUSINESS_LIMITS.businessDescriptionMax),
    contactEmail: `${"a".repeat(240)}@example.com`,
    currency: "NGN",
    phoneCountry: "NG",
    phoneNational: "08031234567",
    businessAddress: "a".repeat(BUSINESS_LIMITS.businessAddressMax),
  };

  assert.deepEqual(validateBusinessProfileFields(maxProfileValues), {});
  assert.equal(
    businessProfileSchema.safeParse({
      businessName: maxProfileValues.businessName,
      businessDescription: maxProfileValues.businessDescription,
      contactEmail: maxProfileValues.contactEmail,
      contactPhone: "+2348031234567",
      contactPhoneCountry: "NG",
      businessAddress: maxProfileValues.businessAddress,
      timezone: maxProfileValues.timezone,
      openingHours: [],
      currencyCode: maxProfileValues.currency,
    }).success,
    true,
  );

  const overProfile = {
    ...maxProfileValues,
    businessName: "n".repeat(BUSINESS_LIMITS.businessNameMax + 1),
    businessDescription: "d".repeat(BUSINESS_LIMITS.businessDescriptionMax + 1),
    businessAddress: "a".repeat(BUSINESS_LIMITS.businessAddressMax + 1),
  };
  const clientOver = validateBusinessProfileFields(overProfile);
  assert.ok(clientOver.businessName);
  assert.ok(clientOver.businessDescription);
  assert.ok(clientOver.businessAddress);
  assert.equal(
    businessProfileSchema.safeParse({
      businessName: overProfile.businessName,
      businessDescription: overProfile.businessDescription,
      businessAddress: overProfile.businessAddress,
      timezone: "Africa/Lagos",
    }).success,
    false,
  );

  const maxCatalogue = {
    name: "s".repeat(BUSINESS_LIMITS.catalogueNameMax),
    currencyCode: "NGN",
    priceMajor: "15000.00",
    availabilityNotes: "v".repeat(BUSINESS_LIMITS.catalogueAvailabilityMax),
    description: "x".repeat(BUSINESS_LIMITS.catalogueDescriptionMax),
  };
  assert.deepEqual(validateCatalogueFields(maxCatalogue), {});
  assert.equal(
    catalogueEntrySchema.safeParse({
      name: maxCatalogue.name,
      currencyCode: "NGN",
      priceMinor: 1500000,
      availabilityNotes: maxCatalogue.availabilityNotes,
      description: maxCatalogue.description,
    }).success,
    true,
  );
  assert.equal(
    catalogueEntrySchema.safeParse({
      name: "s".repeat(BUSINESS_LIMITS.catalogueNameMax + 1),
      currencyCode: "NGN",
    }).success,
    false,
  );

  const maxKnowledge = {
    title: "q".repeat(BUSINESS_LIMITS.knowledgeTitleMax),
    entryType: "faq" as const,
    answer: "a".repeat(BUSINESS_LIMITS.knowledgeAnswerMax),
  };
  assert.deepEqual(validateKnowledgeFields(maxKnowledge), {});
  assert.equal(knowledgeEntrySchema.safeParse(maxKnowledge).success, true);
  assert.equal(
    knowledgeEntrySchema.safeParse({
      ...maxKnowledge,
      title: "q".repeat(BUSINESS_LIMITS.knowledgeTitleMax + 1),
    }).success,
    false,
  );

  const maxLead = {
    name: "c".repeat(LEAD_NAME_MAX_LENGTH),
    service: "s".repeat(LEAD_SERVICE_MAX_LENGTH),
    message: "m".repeat(LEAD_MESSAGE_MAX_LENGTH),
    whatsappNumber: "08031234567",
    whatsappCountryCode: "NG",
    nextFollowUpAt: "",
  };
  assert.deepEqual(validateNewLeadFields(maxLead), {});
  assert.equal(
    createLeadSchema.safeParse({
      name: maxLead.name,
      service: maxLead.service,
      lastMessage: maxLead.message,
      whatsappNumber: maxLead.whatsappNumber,
      whatsappCountryCode: maxLead.whatsappCountryCode,
    }).success,
    true,
  );
  assert.ok(
    validateNewLeadFields({
      ...maxLead,
      name: "c".repeat(LEAD_NAME_MAX_LENGTH + 1),
    }).name,
  );
  assert.equal(
    createLeadSchema.safeParse({
      name: "c".repeat(LEAD_NAME_MAX_LENGTH + 1),
      service: maxLead.service,
      lastMessage: maxLead.message,
    }).success,
    false,
  );

  assert.equal(
    validateDraftReplyText("r".repeat(REPLY_DRAFT_MAX_LENGTH)),
    undefined,
  );
  assert.ok(
    validateDraftReplyText("r".repeat(REPLY_DRAFT_MAX_LENGTH + 1)),
  );
  assert.equal(
    updateReplyDraftSchema.safeParse({
      draftReply: "r".repeat(REPLY_DRAFT_MAX_LENGTH),
    }).success,
    true,
  );
  assert.equal(
    updateReplyDraftSchema.safeParse({
      draftReply: "r".repeat(REPLY_DRAFT_MAX_LENGTH + 1),
    }).success,
    false,
  );
});

test("rejected business, suppression, and lead API requests return details that map back to exact form fields", async () => {
  const { server, baseUrl } = await startTestServer(pool);

  try {
    const cookie = await signUpOwner(baseUrl);

    const badProfile = await fetch(`${baseUrl}/api/business/profile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        businessName: "   ",
        businessDescription: "",
        contactEmail: "bad-email",
        contactPhone: "0803123",
        contactPhoneCountry: "NG",
        businessAddress: null,
        timezone: "Not/ATimezone",
        openingHours: [{ day: "monday", opensAt: "18:00", closesAt: "09:00" }],
        currencyCode: "XYZ",
      }),
    });
    assert.equal(badProfile.status, 400);
    const mappedProfile = mapBusinessProfileServerErrors(
      await badProfile.json(),
    );
    assert.ok(mappedProfile.fieldErrors.businessName);
    assert.ok(mappedProfile.fieldErrors.contactEmail);
    assert.ok(mappedProfile.fieldErrors.phoneNumber);
    assert.ok(mappedProfile.fieldErrors.timezone);
    assert.ok(mappedProfile.fieldErrors.currency);
    assert.ok(mappedProfile.fieldErrors.openingHours);

    const badCatalogue = await fetch(`${baseUrl}/api/business/catalogue`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        name: "   ",
        currencyCode: "BAD",
        priceMinor: -50,
        availabilityNotes: "v".repeat(
          BUSINESS_LIMITS.catalogueAvailabilityMax + 1,
        ),
        description: "d".repeat(BUSINESS_LIMITS.catalogueDescriptionMax + 1),
      }),
    });
    assert.equal(badCatalogue.status, 400);
    const mappedCatalogue = mapCatalogueServerErrors(
      await badCatalogue.json(),
    );
    assert.ok(mappedCatalogue.fieldErrors.name);
    assert.ok(mappedCatalogue.fieldErrors.currencyCode);
    assert.ok(mappedCatalogue.fieldErrors.priceMajor);
    assert.ok(mappedCatalogue.fieldErrors.availabilityNotes);
    assert.ok(mappedCatalogue.fieldErrors.description);

    const badKnowledge = await fetch(`${baseUrl}/api/business/knowledge`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        title: "   ",
        entryType: "memo",
        answer: "  ",
      }),
    });
    assert.equal(badKnowledge.status, 400);
    const mappedKnowledge = mapKnowledgeServerErrors(
      await badKnowledge.json(),
    );
    assert.ok(mappedKnowledge.fieldErrors.title);
    assert.ok(mappedKnowledge.fieldErrors.entryType);
    assert.ok(mappedKnowledge.fieldErrors.answer);

    const badSuppressionCustomer = await fetch(
      `${baseUrl}/api/whatsapp/customers/not-a-uuid/suppression`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          reason: "admin",
          notes: "Customer pause",
        }),
      },
    );
    assert.equal(badSuppressionCustomer.status, 400);
    const mappedBadCustomer = mapSuppressionServerErrors(
      await badSuppressionCustomer.json(),
    );
    assert.ok(mappedBadCustomer.fieldErrors.customerId);

    const badSuppressionBody = await fetch(
      `${baseUrl}/api/whatsapp/customers/${randomUUID()}/suppression`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          reason: "invalid",
          notes: "n".repeat(BUSINESS_LIMITS.suppressionNotesMax + 1),
        }),
      },
    );
    assert.equal(badSuppressionBody.status, 400);
    const mappedSuppressionBody = mapSuppressionServerErrors(
      await badSuppressionBody.json(),
    );
    assert.ok(mappedSuppressionBody.fieldErrors.reason);
    assert.ok(mappedSuppressionBody.fieldErrors.notes);

    const badLead = await fetch(`${baseUrl}/api/leads`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        name: "   ",
        service: "   ",
        lastMessage: "   ",
        whatsappNumber: "0803123",
        whatsappCountryCode: "NG",
        nextFollowUpAt: "not-a-date",
      }),
    });
    assert.equal(badLead.status, 400);
    const parsedLeadFailure = parseLeadCreationError(await badLead.json());
    assert.ok(parsedLeadFailure);
    const mappedLead = mapLeadServerErrors({
      code: parsedLeadFailure.code,
      message: parsedLeadFailure.error,
      details: parsedLeadFailure.details,
    });
    assert.ok(mappedLead.fieldErrors.name);
    assert.ok(mappedLead.fieldErrors.service);
    assert.ok(mappedLead.fieldErrors.message);
    assert.ok(mappedLead.fieldErrors.whatsappNumber);
    assert.ok(mappedLead.fieldErrors.nextFollowUpAt);
  } finally {
    await stopServer(server);
  }
});
