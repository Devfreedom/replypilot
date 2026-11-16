import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";

const BASE_ENVIRONMENT = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://replypilot:replypilot@localhost:5432/replypilot",
  BETTER_AUTH_SECRET: "replypilot-production-test-secret-0123456789",
  BETTER_AUTH_URL: "https://replypilot.example.test",
};

test("no trusted proxies are configured by default", () => {
  const config = loadConfig(BASE_ENVIRONMENT);

  assert.deepEqual(config.trustedProxyCidrs, []);
});

test("trusted proxy CIDRs are parsed, trimmed and de-duplicated", () => {
  const config = loadConfig({
    ...BASE_ENVIRONMENT,
    BETTER_AUTH_TRUSTED_PROXY_CIDRS:
      " 10.0.0.0/8 , 192.0.2.10,10.0.0.0/8 ,",
  });

  assert.deepEqual(config.trustedProxyCidrs, ["10.0.0.0/8", "192.0.2.10"]);
});

test("an empty trusted proxy list leaves the client IP resolution unchanged", () => {
  const config = loadConfig({
    ...BASE_ENVIRONMENT,
    BETTER_AUTH_TRUSTED_PROXY_CIDRS: " , ",
  });

  assert.deepEqual(config.trustedProxyCidrs, []);
});

test("gemini config is null when GEMINI_API_KEY is unset", () => {
  const config = loadConfig(BASE_ENVIRONMENT);

  assert.equal(config.gemini, null);
});

test("gemini config captures trimmed GEMINI_API_KEY and optional GEMINI_MODEL", () => {
  const withoutModel = loadConfig({
    ...BASE_ENVIRONMENT,
    GEMINI_API_KEY: "  test-gemini-key-value  ",
  });
  assert.deepEqual(withoutModel.gemini, {
    apiKey: "test-gemini-key-value",
  });

  const withModel = loadConfig({
    ...BASE_ENVIRONMENT,
    GEMINI_API_KEY: "test-gemini-key-value",
    GEMINI_MODEL: "  gemini-2.5-pro  ",
  });
  assert.deepEqual(withModel.gemini, {
    apiKey: "test-gemini-key-value",
    model: "gemini-2.5-pro",
  });
});

test("loadConfig rejects whitespace-only GEMINI_API_KEY values", () => {
  assert.throws(
    () =>
      loadConfig({
        ...BASE_ENVIRONMENT,
        GEMINI_API_KEY: "   ",
      }),
    /Invalid server environment:.*GEMINI_API_KEY/,
  );

  assert.throws(
    () =>
      loadConfig({
        ...BASE_ENVIRONMENT,
        GEMINI_API_KEY: "",
      }),
    /Invalid server environment:.*GEMINI_API_KEY/,
  );
});
