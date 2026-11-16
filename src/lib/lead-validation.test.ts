import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeLeadPhoneNumber } from "../../server/src/leads/phone";
import {
  LEAD_MESSAGE_MAX_LENGTH,
  LEAD_NAME_MAX_LENGTH,
  LEAD_SERVICE_MAX_LENGTH,
  REPLY_DRAFT_MAX_LENGTH,
  mapLeadServerErrors,
  validateDraftReplyText,
  validateLeadPhoneFields,
  validateNewLeadFields,
} from "./lead-validation";
import { WHATSAPP_LEAD_DUPLICATE_NUMBER_CODE } from "./leads";

test("validateLeadPhoneFields strictly mirrors server E.164 normalization", () => {
  const validNational = validateLeadPhoneFields("0803 123 4567", "NG");
  const serverNational = normalizeLeadPhoneNumber("0803 123 4567", "NG");
  assert.deepEqual(validNational.errors, {});
  assert.equal(validNational.e164, serverNational.ok ? serverNational.e164 : null);

  const validIntl = validateLeadPhoneFields("+234 803 123 4567", "");
  assert.deepEqual(validIntl.errors, {});
  assert.equal(validIntl.e164, "+2348031234567");

  const letters = validateLeadPhoneFields("+234abc1234", "");
  assert.ok(letters.errors.whatsappNumber);
  assert.equal(normalizeLeadPhoneNumber("+234abc1234", "").ok, false);

  const missingCountry = validateLeadPhoneFields("08031234567", "");
  assert.ok(missingCountry.errors.whatsappCountryCode);
  assert.equal(normalizeLeadPhoneNumber("08031234567", "").ok, false);

  const mismatch = validateLeadPhoneFields("+447700900123", "NG");
  assert.ok(mismatch.errors.whatsappNumber);
  assert.equal(normalizeLeadPhoneNumber("+447700900123", "NG").ok, false);

  const shortNational = validateLeadPhoneFields("0803123", "NG");
  assert.ok(shortNational.errors.whatsappNumber);
  assert.equal(normalizeLeadPhoneNumber("0803123", "NG").ok, false);

  const invalidNational = validateLeadPhoneFields("0991234567", "NG");
  assert.ok(invalidNational.errors.whatsappNumber);
  assert.equal(normalizeLeadPhoneNumber("0991234567", "NG").ok, false);
});

test("validateNewLeadFields rejects missing, oversized, and invalid follow-up values", () => {
  const empty = validateNewLeadFields({
    name: "   ",
    service: "",
    message: "  ",
    whatsappNumber: "",
    whatsappCountryCode: "",
    nextFollowUpAt: "",
  });
  assert.ok(empty.name);
  assert.ok(empty.service);
  assert.ok(empty.message);
  assert.equal(empty.whatsappNumber, undefined);

  const oversized = validateNewLeadFields({
    name: "a".repeat(LEAD_NAME_MAX_LENGTH + 1),
    service: "b".repeat(LEAD_SERVICE_MAX_LENGTH + 1),
    message: "c".repeat(LEAD_MESSAGE_MAX_LENGTH + 1),
    whatsappNumber: `+${"1".repeat(35)}`,
    whatsappCountryCode: "",
    nextFollowUpAt: "not-a-date",
  });
  assert.match(oversized.name ?? "", /120/);
  assert.match(oversized.service ?? "", /160/);
  assert.match(oversized.message ?? "", /2000/);
  assert.match(oversized.whatsappNumber ?? "", /32/);
  assert.match(oversized.nextFollowUpAt ?? "", /valid follow-up date/i);
});

test("validateDraftReplyText enforces trimmed non-empty and max 2000 length", () => {
  assert.match(validateDraftReplyText("   ") ?? "", /cannot be empty/i);
  assert.match(
    validateDraftReplyText("x".repeat(REPLY_DRAFT_MAX_LENGTH + 1)) ?? "",
    /2000/,
  );
  assert.equal(validateDraftReplyText("Good afternoon, thank you!"), undefined);
});

test("mapLeadServerErrors maps server body.* validation details back to exact form fields", () => {
  const mapped = mapLeadServerErrors({
    message: "Invalid request",
    details: [
      { field: "body.name", message: "Name is required" },
      { field: "body.lastMessage", message: "Last message is required" },
      { field: "body.whatsappNumber", message: "Invalid phone" },
    ],
  });

  assert.deepEqual(mapped.fieldErrors, {
    name: "Name is required",
    message: "Last message is required",
    whatsappNumber: "Invalid phone",
  });
  assert.equal(mapped.formError, null);

  const duplicate = mapLeadServerErrors({
    code: WHATSAPP_LEAD_DUPLICATE_NUMBER_CODE,
    message: "A lead with this WhatsApp number already exists.",
  });
  assert.equal(
    duplicate.fieldErrors.whatsappNumber,
    "A lead with this WhatsApp number already exists.",
  );
  assert.equal(duplicate.formError, null);
});
