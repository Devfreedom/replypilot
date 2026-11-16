import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUSINESS_LIMITS,
  mapBusinessProfileServerErrors,
  mapCatalogueServerErrors,
  mapKnowledgeServerErrors,
  mapSuppressionServerErrors,
  validateBusinessProfileFields,
  validateCatalogueFields,
  validateKnowledgeFields,
  validateSuppressionFields,
} from "./business-validation.js";

test("validateBusinessProfileFields rejects whitespace, invalid emails, bad E.164 numbers, and oversized text", () => {
  const blank = validateBusinessProfileFields({
    businessName: "   ",
    timezone: "",
    businessDescription: "a".repeat(BUSINESS_LIMITS.businessDescriptionMax + 1),
    contactEmail: "not-an-email",
    currency: "BAD",
    phoneCountry: "NG",
    phoneNational: "080312",
    businessAddress: "b".repeat(BUSINESS_LIMITS.businessAddressMax + 1),
  });

  assert.match(blank.businessName ?? "", /enter your business name/i);
  assert.match(blank.timezone ?? "", /choose the timezone/i);
  assert.match(blank.businessDescription ?? "", /2000 characters/i);
  assert.match(blank.contactEmail ?? "", /valid contact email/i);
  assert.match(blank.currency ?? "", /ISO 4217/i);
  assert.match(blank.phoneNumber ?? "", /valid phone number/i);
  assert.match(blank.businessAddress ?? "", /500 characters/i);

  const oversizedName = validateBusinessProfileFields({
    businessName: "x".repeat(BUSINESS_LIMITS.businessNameMax + 1),
    timezone: "Africa/Lagos",
    businessDescription: "",
    contactEmail: `${"a".repeat(250)}@example.com`,
    currency: "NGN",
    phoneCountry: "NG",
    phoneNational: "08031234567",
    businessAddress: "",
  });

  assert.match(oversizedName.businessName ?? "", /160 characters/i);
  assert.match(oversizedName.contactEmail ?? "", /valid contact email/i);
  assert.equal(oversizedName.phoneCountry, undefined);
  assert.equal(oversizedName.phoneNumber, undefined);

  const valid = validateBusinessProfileFields({
    businessName: "Lagos Frame Studios",
    timezone: "Africa/Lagos",
    businessDescription: "Wedding & event photography across Lagos.",
    contactEmail: "bookings@lagosframe.ng",
    currency: "NGN",
    phoneCountry: "NG",
    phoneNational: "0803 123 4567",
    businessAddress: "14 Admiralty Way, Lekki Phase 1",
  });

  assert.deepEqual(valid, {});
});

test("validateCatalogueFields enforces trimmed name, real ISO currency codes, decimal precision, and bounds", () => {
  const rejected = validateCatalogueFields({
    name: "  ",
    currencyCode: "XYZ",
    priceMajor: "1500.123",
    availabilityNotes: "c".repeat(BUSINESS_LIMITS.catalogueAvailabilityMax + 1),
    description: "d".repeat(BUSINESS_LIMITS.catalogueDescriptionMax + 1),
  });

  assert.match(rejected.name ?? "", /enter a service or product name/i);
  assert.match(rejected.currencyCode ?? "", /ISO 4217/i);
  assert.match(rejected.priceMajor ?? "", /at most 2 decimal places/i);
  assert.match(rejected.availabilityNotes ?? "", /1000 characters/i);
  assert.match(rejected.description ?? "", /2000 characters/i);

  const jpyDecimal = validateCatalogueFields({
    name: "Studio booking",
    currencyCode: "JPY",
    priceMajor: "1500.5",
    availabilityNotes: "",
    description: "",
  });

  assert.match(jpyDecimal.priceMajor ?? "", /whole amounts only/i);

  const valid = validateCatalogueFields({
    name: "Full-day traditional wedding package",
    currencyCode: "NGN",
    priceMajor: "350,000.00",
    availabilityNotes: "Weekends subject to booking confirmation",
    description: "Includes two photographers and 12-hour coverage.",
  });

  assert.deepEqual(valid, {});
});

test("validateKnowledgeFields rejects whitespace-only titles/answers, invalid entryType, and over-limit lengths", () => {
  const rejected = validateKnowledgeFields({
    title: "   ",
    entryType: "note",
    answer: "   ",
  });

  assert.match(rejected.title ?? "", /enter a title/i);
  assert.match(rejected.entryType ?? "", /faq or policy/i);
  assert.match(rejected.answer ?? "", /approved answer or policy/i);

  const overLimit = validateKnowledgeFields({
    title: "t".repeat(BUSINESS_LIMITS.knowledgeTitleMax + 1),
    entryType: "faq",
    answer: "a".repeat(BUSINESS_LIMITS.knowledgeAnswerMax + 1),
  });

  assert.match(overLimit.title ?? "", /240 characters/i);
  assert.match(overLimit.answer ?? "", /4000 characters/i);

  const valid = validateKnowledgeFields({
    title: "What deposit is required to hold an event date?",
    entryType: "policy",
    answer:
      "50% deposit upon invoice confirmation, balance 48 hours before event.",
  });

  assert.deepEqual(valid, {});
});

test("validateSuppressionFields validates UUID customerId, reason, and notes limit", () => {
  const rejected = validateSuppressionFields({
    customerId: "not-a-uuid",
    reason: "invalid_reason",
    notes: "n".repeat(BUSINESS_LIMITS.suppressionNotesMax + 1),
  });

  assert.match(rejected.customerId ?? "", /valid customer/i);
  assert.match(rejected.reason ?? "", /suppression reason/i);
  assert.match(rejected.notes ?? "", /500 characters/i);

  const valid = validateSuppressionFields({
    customerId: "11111111-1111-4111-8111-111111111111",
    reason: "admin",
    notes: "Customer requested manual pause via phone call",
  });

  assert.deepEqual(valid, {});
});

test("server error mappers translate backend details arrays back to exact form fields", () => {
  const profileMapped = mapBusinessProfileServerErrors({
    error: "Invalid request",
    details: [
      { field: "contactEmail", message: "Use a valid email address" },
      {
        field: "contactPhone",
        message: "Use a valid international phone number",
      },
      {
        field: "openingHours.0.closesAt",
        message: "Closing time must be after opening time",
      },
    ],
  });

  assert.equal(
    profileMapped.fieldErrors.contactEmail,
    "Use a valid email address",
  );
  assert.equal(
    profileMapped.fieldErrors.phoneNumber,
    "Use a valid international phone number",
  );
  assert.equal(
    profileMapped.fieldErrors.openingHours,
    "Closing time must be after opening time",
  );

  const catalogueMapped = mapCatalogueServerErrors({
    error: "Invalid request",
    details: [
      { field: "priceMinor", message: "Price cannot be negative" },
      { field: "currencyCode", message: "Use uppercase ISO 4217" },
    ],
  });

  assert.equal(
    catalogueMapped.fieldErrors.priceMajor,
    "Price cannot be negative",
  );
  assert.equal(
    catalogueMapped.fieldErrors.currencyCode,
    "Use uppercase ISO 4217",
  );

  const knowledgeMapped = mapKnowledgeServerErrors({
    error: "Invalid request",
    details: [{ field: "answer", message: "Answer is required" }],
  });

  assert.equal(knowledgeMapped.fieldErrors.answer, "Answer is required");

  const suppressionMapped = mapSuppressionServerErrors({
    error: "Invalid request",
    details: [
      { field: "customerId", message: "Invalid uuid" },
      { field: "notes", message: "notes must be 500 characters or fewer" },
    ],
  });

  assert.equal(suppressionMapped.fieldErrors.customerId, "Invalid uuid");
  assert.equal(
    suppressionMapped.fieldErrors.notes,
    "notes must be 500 characters or fewer",
  );
});
