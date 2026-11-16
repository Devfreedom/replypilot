import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { createAuth } from "../src/auth/config.js";
import { ConfigError, loadConfig } from "../src/config.js";

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

test("H3 loadConfig accepts valid IPv4/IPv6/CIDR proxy entries and rejects malformed ones", () => {
  const valid = loadConfig({
    ...BASE_ENVIRONMENT,
    BETTER_AUTH_TRUSTED_PROXY_CIDRS: " 10.0.0.0/8, 192.0.2.10 , 2001:db8::/32 , ::1 ",
  });
  assert.deepEqual(valid.trustedProxyCidrs, [
    "10.0.0.0/8",
    "192.0.2.10",
    "2001:db8::/32",
    "::1",
  ]);

  for (const invalid of [
    "not-an-ip",
    "10.0.0.1/99",
    "2001:db8::/129",
    "10.0.0.1/",
    "10.0.0.1/08",
    "10.0.0.1/8/2",
  ]) {
    assert.throws(
      () =>
        loadConfig({
          ...BASE_ENVIRONMENT,
          BETTER_AUTH_TRUSTED_PROXY_CIDRS: invalid,
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError, `Expected ConfigError for ${invalid}`);
        assert.match(error.message, /BETTER_AUTH_TRUSTED_PROXY_CIDRS/);
        return true;
      },
    );
  }

  const dummyPool = new Pool({
    connectionString: "postgres://replypilot:replypilot@localhost:5432/replypilot",
  });
  try {
    assert.throws(
      () =>
        createAuth({
          pool: dummyPool,
          secret: BASE_ENVIRONMENT.BETTER_AUTH_SECRET,
          trustedOrigins: ["https://replypilot.example.test"],
          trustedProxyCidrs: ["not-an-ip"],
        }),
      /Invalid trusted proxy IP or CIDR/,
    );
  } finally {
    void dummyPool.end();
  }
});

test("M2b loadConfig validates origin syntax, rejects production http origins, and normalizes origins", () => {
  const normalized = loadConfig({
    ...BASE_ENVIRONMENT,
    BETTER_AUTH_URL: "https://App.Example.Test:443/",
    BETTER_AUTH_TRUSTED_ORIGINS: "https://Admin.Example.Test/",
  });
  assert.equal(normalized.betterAuthUrl, "https://app.example.test");
  assert.deepEqual(normalized.trustedOrigins, [
    "https://app.example.test",
    "https://admin.example.test",
  ]);

  assert.throws(
    () =>
      loadConfig({
        ...BASE_ENVIRONMENT,
        BETTER_AUTH_TRUSTED_ORIGINS: "http://app.example.test",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /must use https in production/);
      return true;
    },
  );

  for (const badOrigin of [
    "https://app.example.test/api",
    "https://app.example.test/?foo=bar",
    "https://app.example.test/#section",
    "https://user:pass@app.example.test",
  ]) {
    assert.throws(
      () =>
        loadConfig({
          ...BASE_ENVIRONMENT,
          BETTER_AUTH_TRUSTED_ORIGINS: badOrigin,
        }),
      ConfigError,
    );
    assert.throws(
      () =>
        loadConfig({
          ...BASE_ENVIRONMENT,
          BETTER_AUTH_URL: badOrigin,
        }),
      ConfigError,
    );
  }

  const devConfig = loadConfig({
    NODE_ENV: "development",
    DATABASE_URL: BASE_ENVIRONMENT.DATABASE_URL,
    BETTER_AUTH_SECRET: BASE_ENVIRONMENT.BETTER_AUTH_SECRET,
    BETTER_AUTH_TRUSTED_ORIGINS: "http://localhost:3001/",
  });
  assert.equal(devConfig.trustedOrigins.includes("http://localhost:3001"), true);
});
