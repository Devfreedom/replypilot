import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canStartEmbeddedSignup,
  handleEmbeddedSignupMessage,
  isAllowedMetaOrigin,
  parseCompleteOnboardingResponse,
  parseConnectionsResponse,
  parseEmbeddedSignupConfigResponse,
  parseEmbeddedSignupEventData,
  parseOnboardingSessionResponse,
  parseWhatsAppConnection,
} from "./embedded-signup.js";

const connection = {
  id: "11111111-1111-4111-8111-111111111111",
  phoneNumberId: "106540000000001",
  displayPhoneNumber: "15550783881",
  label: "Fictional Studio",
  wabaId: "102290129340398",
  status: "active",
  credentialsConfigured: true,
  tokenExpiresAt: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  activatedAt: "2026-10-01T10:00:00.000Z",
  disconnectedAt: null,
  lastVerifiedAt: "2026-10-01T10:00:00.000Z",
  webhookSubscribedAt: "2026-10-01T10:00:00.000Z",
  lastError: null,
};

test("Meta message origins must be HTTPS facebook.com or a subdomain", () => {
  for (const origin of [
    "https://facebook.com",
    "https://www.facebook.com",
    "https://web.facebook.com",
    "https://WWW.FACEBOOK.COM",
  ]) {
    assert.equal(isAllowedMetaOrigin(origin), true, origin);
  }

  for (const origin of [
    "http://facebook.com",
    "https://facebook.com.evil.test",
    "https://evilfacebook.com",
    "https://notfacebook.com",
    "https://facebook.com:8443",
    "not a url",
    "",
  ]) {
    assert.equal(isAllowedMetaOrigin(origin), false, origin);
  }
});

test("FINISH with a phone number and Messaging account is actionable", () => {
  assert.deepEqual(
    parseEmbeddedSignupEventData({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: {
        phone_number_id: "106540000000001",
        waba_id: "102290129340398",
        business_id: "900000000000001",
      },
    }),
    {
      kind: "success",
      phoneNumberId: "106540000000001",
      wabaId: "102290129340398",
      businessId: "900000000000001",
    },
  );
});

test("cancelled, failed, and partial signup events are classified safely", () => {
  assert.deepEqual(
    parseEmbeddedSignupEventData({
      type: "WA_EMBEDDED_SIGNUP",
      event: "CANCEL",
    }),
    { kind: "cancelled" },
  );

  assert.deepEqual(
    parseEmbeddedSignupEventData({
      type: "WA_EMBEDDED_SIGNUP",
      event: "ERROR",
      data: { error_message: "Meta rejected the business account." },
    }),
    {
      kind: "error",
      message: "Meta rejected the business account.",
    },
  );

  assert.deepEqual(
    parseEmbeddedSignupEventData({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH_ONLY_WABA",
      data: { waba_id: "102290129340398" },
    }),
    { kind: "incomplete", event: "FINISH_ONLY_WABA" },
  );

  assert.deepEqual(
    parseEmbeddedSignupEventData({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: { waba_id: "102290129340398" },
    }),
    { kind: "incomplete", event: "FINISH" },
  );
});

test("unrelated browser messages are ignored", () => {
  assert.deepEqual(
    parseEmbeddedSignupEventData({ type: "SOMETHING_ELSE", event: "FINISH" }),
    { kind: "ignored" },
  );
  assert.deepEqual(parseEmbeddedSignupEventData(null), { kind: "ignored" });
});

test("message handling rejects a non-Meta origin before parsing", () => {
  const events: unknown[] = [];
  const handled = handleEmbeddedSignupMessage(
    {
      origin: "https://attacker.example",
      data: {
        type: "WA_EMBEDDED_SIGNUP",
        event: "FINISH",
        data: {
          phone_number_id: "106540000000001",
          waba_id: "102290129340398",
        },
      },
    },
    (event) => events.push(event),
  );

  assert.equal(handled, false);
  assert.deepEqual(events, []);
});

test("message handling accepts a valid Meta event", () => {
  const events: unknown[] = [];
  const handled = handleEmbeddedSignupMessage(
    {
      origin: "https://www.facebook.com",
      data: {
        type: "WA_EMBEDDED_SIGNUP",
        event: "FINISH",
        data: {
          phone_number_id: "106540000000001",
          waba_id: "102290129340398",
        },
      },
    },
    (event) => events.push(event),
  );

  assert.equal(handled, true);
  assert.equal(events.length, 1);
  assert.equal((events[0] as { kind: string }).kind, "success");
});

test("onboarding configuration responses separate configured and missing states", () => {
  assert.deepEqual(
    parseEmbeddedSignupConfigResponse({
      config: {
        configured: true,
        originConfigured: true,
        appId: "123456789012345",
        configId: "987654321098765",
        graphApiVersion: "v27.0",
        allowedOrigin: "https://app.example.test",
      },
    }),
    {
      configured: true,
      originConfigured: true,
      appId: "123456789012345",
      configId: "987654321098765",
      graphApiVersion: "v27.0",
      allowedOrigin: "https://app.example.test",
    },
  );

  assert.deepEqual(
    parseEmbeddedSignupConfigResponse({
      config: {
        configured: false,
        originConfigured: false,
        appId: null,
        configId: null,
        graphApiVersion: null,
        allowedOrigin: null,
      },
    }),
    {
      configured: false,
      originConfigured: false,
      appId: null,
      configId: null,
      graphApiVersion: null,
      allowedOrigin: null,
    },
  );

  assert.equal(parseEmbeddedSignupConfigResponse({}), null);
});

test("a configured server without an application origin is reported as unusable", () => {
  const parsed = parseEmbeddedSignupConfigResponse({
    config: {
      configured: true,
      originConfigured: false,
      appId: "123456789012345",
      configId: "987654321098765",
      graphApiVersion: "v27.0",
      allowedOrigin: null,
    },
  });

  assert.ok(parsed);
  assert.equal(parsed.configured, true);
  assert.equal(parsed.originConfigured, false);
});

test("connection parsing accepts the M14B error state and verification fields", () => {
  const parsed = parseWhatsAppConnection({
    ...connection,
    status: "error",
    lastError: "Webhook subscription could not be confirmed.",
  });

  assert.ok(parsed);
  assert.equal(parsed.status, "error");
  assert.equal(
    parsed.lastError,
    "Webhook subscription could not be confirmed.",
  );
  assert.equal(parsed.lastVerifiedAt, connection.lastVerifiedAt);
  assert.equal(parsed.webhookSubscribedAt, connection.webhookSubscribedAt);

  assert.equal(
    parseWhatsAppConnection({ ...connection, status: "invented" }),
    null,
  );
  assert.equal(parseWhatsAppConnection({ ...connection, id: 42 }), null);
});

test("connection list parsing rejects a mixed or malformed payload", () => {
  assert.deepEqual(
    parseConnectionsResponse({ connections: [connection] }),
    [connection],
  );
  assert.equal(
    parseConnectionsResponse({
      connections: [connection, { id: "x", status: "active" }],
    }),
    null,
  );
  assert.equal(parseConnectionsResponse({}), null);
});

test("onboarding session and completion responses are validated", () => {
  const state = "a".repeat(43);
  assert.deepEqual(
    parseOnboardingSessionResponse({
      state,
      expiresAt: "2026-10-01T10:30:00.000Z",
    }),
    { state, expiresAt: "2026-10-01T10:30:00.000Z" },
  );
  assert.equal(
    parseOnboardingSessionResponse({ state: "short", expiresAt: "now" }),
    null,
  );

  assert.deepEqual(
    parseCompleteOnboardingResponse({
      connection,
      verification: "pending",
      replayed: false,
    }),
    { connection, verification: "pending", replayed: false },
  );
  assert.equal(
    parseCompleteOnboardingResponse({
      connection,
      verification: "not-real",
      replayed: false,
    }),
    null,
  );
});

test("Connect is owner-only, configuration-gated, and duplicate-click safe", () => {
  const base = {
    role: "owner" as const,
    configured: true,
    configLoading: false,
    connecting: false,
  };

  assert.equal(canStartEmbeddedSignup(base), true);
  assert.equal(
    canStartEmbeddedSignup({ ...base, role: "member" }),
    false,
  );
  assert.equal(canStartEmbeddedSignup({ ...base, role: null }), false);
  assert.equal(canStartEmbeddedSignup({ ...base, configured: false }), false);
  assert.equal(canStartEmbeddedSignup({ ...base, configLoading: true }), false);
  assert.equal(canStartEmbeddedSignup({ ...base, connecting: true }), false);
});
