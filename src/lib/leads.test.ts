import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dashboardViewHref,
  parseDashboardView,
  parseLeadCreationError,
  LeadApiError,
  WHATSAPP_LEAD_DUPLICATE_NUMBER_CODE,
  WHATSAPP_LEAD_NUMBER_UNRESOLVED_CODE,
} from "./leads.js";

test("dashboard view query parsing defaults to overview and accepts known views", () => {
  assert.equal(parseDashboardView(null), "overview");
  assert.equal(parseDashboardView(""), "overview");
  assert.equal(parseDashboardView("overview"), "overview");
  assert.equal(parseDashboardView("leads"), "leads");
  assert.equal(parseDashboardView("follow-ups"), "follow-ups");
  assert.equal(parseDashboardView("unknown"), "overview");
});

test("dashboard view links use the view query parameter", () => {
  assert.equal(dashboardViewHref("overview"), "/?view=overview");
  assert.equal(dashboardViewHref("leads"), "/?view=leads");
  assert.equal(dashboardViewHref("follow-ups"), "/?view=follow-ups");
});

test("a confirmed duplicate and an unresolved possible duplicate carry different codes", () => {
  const confirmed = parseLeadCreationError({
    error: "A lead with this WhatsApp number already exists.",
    code: WHATSAPP_LEAD_DUPLICATE_NUMBER_CODE,
  });
  assert.equal(confirmed?.code, WHATSAPP_LEAD_DUPLICATE_NUMBER_CODE);

  const unresolved = parseLeadCreationError({
    error: "Another lead in this workspace may already hold this WhatsApp number…",
    code: WHATSAPP_LEAD_NUMBER_UNRESOLVED_CODE,
    conflictingLeadId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(unresolved?.code, WHATSAPP_LEAD_NUMBER_UNRESOLVED_CODE);
  assert.equal(
    unresolved?.conflictingLeadId,
    "11111111-1111-4111-8111-111111111111",
  );

  assert.notEqual(
    WHATSAPP_LEAD_DUPLICATE_NUMBER_CODE,
    WHATSAPP_LEAD_NUMBER_UNRESOLVED_CODE,
  );
});

test("a body that is not a lead error payload does not parse", () => {
  assert.equal(parseLeadCreationError({ unexpected: true }), null);
  assert.equal(parseLeadCreationError(null), null);
  assert.equal(parseLeadCreationError("nope"), null);
});

test("a lead API error carries its stable code to the caller", () => {
  const error = new LeadApiError("Something went wrong", {
    code: WHATSAPP_LEAD_NUMBER_UNRESOLVED_CODE,
    conflictingLeadId: "22222222-2222-4222-8222-222222222222",
  });

  assert.ok(error instanceof Error);
  assert.equal(error.message, "Something went wrong");
  assert.equal(error.code, WHATSAPP_LEAD_NUMBER_UNRESOLVED_CODE);
  assert.equal(
    error.conflictingLeadId,
    "22222222-2222-4222-8222-222222222222",
  );

  const plain = new LeadApiError("Something went wrong");
  assert.equal(plain.code, undefined);
  assert.equal(plain.conflictingLeadId, undefined);
});
