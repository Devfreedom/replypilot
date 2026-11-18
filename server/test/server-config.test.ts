import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import {
  createAuth,
  createTrustedProxyMatcher,
  isValidProxyIpOrCidr,
  normalizeIpAddress,
} from "../src/auth/config.js";
import { ConfigError, loadConfig } from "../src/config.js";

const BASE_ENVIRONMENT = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://replypilot:replypilot@localhost:5432/replypilot",
  BETTER_AUTH_SECRET: "replypilot-production-test-secret-0123456789",
  BETTER_AUTH_URL: "https://replypilot.example.test",
  RESEND_API_KEY: "re_test_placeholder_0123456789",
  AUTH_EMAIL_FROM: "ReplyPilot <noreply@replypilot.example.test>",
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

test("gemini config captures trimmed GEMINI_API_KEY, optional GEMINI_MODEL, and GEMINI_TIMEOUT_MS", () => {
  const withoutModel = loadConfig({
    ...BASE_ENVIRONMENT,
    GEMINI_API_KEY: "  test-gemini-key-value  ",
  });
  assert.deepEqual(withoutModel.gemini, {
    apiKey: "test-gemini-key-value",
    fallbackModel: "gemini-3.1-flash-lite",
    timeoutMs: 45_000,
  });

  const withModelAndTimeout = loadConfig({
    ...BASE_ENVIRONMENT,
    GEMINI_API_KEY: "test-gemini-key-value",
    GEMINI_MODEL: "  gemini-3.5-flash  ",
    GEMINI_TIMEOUT_MS: "60000",
  });
  assert.deepEqual(withModelAndTimeout.gemini, {
    apiKey: "test-gemini-key-value",
    model: "gemini-3.5-flash",
    fallbackModel: "gemini-3.1-flash-lite",
    timeoutMs: 60_000,
  });

  const blankTimeout = loadConfig({
    ...BASE_ENVIRONMENT,
    GEMINI_API_KEY: "test-gemini-key-value",
    GEMINI_TIMEOUT_MS: "  ",
  });
  assert.deepEqual(blankTimeout.gemini, {
    apiKey: "test-gemini-key-value",
    fallbackModel: "gemini-3.1-flash-lite",
    timeoutMs: 45_000,
  });

  for (const badTimeout of ["not-a-number", "500", "500000", "-10"]) {
    assert.throws(
      () =>
        loadConfig({
          ...BASE_ENVIRONMENT,
          GEMINI_API_KEY: "test-gemini-key-value",
          GEMINI_TIMEOUT_MS: badTimeout,
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /GEMINI_TIMEOUT_MS/);
        return true;
      },
    );
  }
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

test("C1 loadConfig validates RESEND_API_KEY and AUTH_EMAIL_FROM pairing and requires email in production", () => {
  const configured = loadConfig({
    ...BASE_ENVIRONMENT,
    RESEND_API_KEY: "  re_test_trimmed_key  ",
    AUTH_EMAIL_FROM: "  ReplyPilot <noreply@replypilot.example.test>  ",
  });
  assert.deepEqual(configured.email, {
    apiKey: "re_test_trimmed_key",
    from: "ReplyPilot <noreply@replypilot.example.test>",
  });

  const devNoEmail = loadConfig({
    NODE_ENV: "development",
    DATABASE_URL: BASE_ENVIRONMENT.DATABASE_URL,
    BETTER_AUTH_SECRET: BASE_ENVIRONMENT.BETTER_AUTH_SECRET,
  });
  assert.equal(devNoEmail.email, null);

  // Missing both in production must fail closed.
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: BASE_ENVIRONMENT.NODE_ENV,
        DATABASE_URL: BASE_ENVIRONMENT.DATABASE_URL,
        BETTER_AUTH_SECRET: BASE_ENVIRONMENT.BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: BASE_ENVIRONMENT.BETTER_AUTH_URL,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /RESEND_API_KEY/);
      assert.match(error.message, /AUTH_EMAIL_FROM/);
      return true;
    },
  );

  // Setting only one fails fast in both development and production.
  for (const nodeEnv of ["development", "production"] as const) {
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: nodeEnv,
          DATABASE_URL: BASE_ENVIRONMENT.DATABASE_URL,
          BETTER_AUTH_SECRET: BASE_ENVIRONMENT.BETTER_AUTH_SECRET,
          BETTER_AUTH_URL: BASE_ENVIRONMENT.BETTER_AUTH_URL,
          RESEND_API_KEY: "re_test_only_key",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /AUTH_EMAIL_FROM/);
        return true;
      },
    );

    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: nodeEnv,
          DATABASE_URL: BASE_ENVIRONMENT.DATABASE_URL,
          BETTER_AUTH_SECRET: BASE_ENVIRONMENT.BETTER_AUTH_SECRET,
          BETTER_AUTH_URL: BASE_ENVIRONMENT.BETTER_AUTH_URL,
          AUTH_EMAIL_FROM: "ReplyPilot <noreply@replypilot.example.test>",
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /RESEND_API_KEY/);
        return true;
      },
    );
  }

  assert.throws(
    () =>
      loadConfig({
        ...BASE_ENVIRONMENT,
        RESEND_API_KEY: "   ",
      }),
    /RESEND_API_KEY/,
  );

  assert.throws(
    () =>
      loadConfig({
        ...BASE_ENVIRONMENT,
        AUTH_EMAIL_FROM: "   ",
      }),
    /AUTH_EMAIL_FROM/,
  );
});

test("H-11 loadConfig defaults HOST to loopback and accepts an override", () => {
  assert.equal(loadConfig(BASE_ENVIRONMENT).host, "127.0.0.1");
  assert.equal(
    loadConfig({ ...BASE_ENVIRONMENT, HOST: "  0.0.0.0  " }).host,
    "0.0.0.0",
  );
  assert.throws(
    () => loadConfig({ ...BASE_ENVIRONMENT, HOST: "   " }),
    /Invalid server environment:.*HOST/,
  );
});

test("H-01 an IPv6 CIDR never matches IPv4 addresses and IPv4 CIDRs never match IPv6", () => {
  for (const cidr of ["::1/64", "::/64", "::/0"]) {
    const matcher = createTrustedProxyMatcher([cidr]);
    assert.equal(matcher("203.0.113.50"), false, `${cidr} must not trust IPv4`);
    assert.equal(matcher("1.2.3.4"), false);
    assert.equal(matcher("::ffff:203.0.113.50"), false);
    assert.equal(matcher("::1"), true);
  }

  const ipv4 = createTrustedProxyMatcher(["10.0.0.0/8", "192.0.2.10"]);
  assert.equal(ipv4("10.20.30.40"), true);
  assert.equal(ipv4("192.0.2.10"), true);
  assert.equal(ipv4("192.0.2.11"), false);
  assert.equal(ipv4("::1"), false);
  assert.equal(ipv4("2001:db8::1"), false);
});

test("M-01 IPv4-mapped IPv6 CIDRs keep their prefix as an IPv4 prefix and need a prefix of at least 96", () => {
  const matcher = createTrustedProxyMatcher(["::ffff:10.0.0.0/104"]);
  assert.equal(matcher("10.0.0.1"), true);
  assert.equal(matcher("10.255.255.254"), true);
  assert.equal(matcher("::ffff:10.0.0.254"), true);
  assert.equal(matcher("::ffff:a00:5"), true);
  assert.equal(matcher("11.0.0.1"), false);

  assert.equal(isValidProxyIpOrCidr("::ffff:10.0.0.0/104"), true);
  assert.equal(isValidProxyIpOrCidr("::ffff:10.0.0.0/96"), true);
  assert.equal(isValidProxyIpOrCidr("::ffff:10.0.0.0/64"), false);
  assert.equal(isValidProxyIpOrCidr("::ffff:10.0.0.0/95"), false);
  assert.throws(
    () => createTrustedProxyMatcher(["::ffff:10.0.0.0/64"]),
    /Invalid trusted proxy IP or CIDR/,
  );
});

test("M-01 zone indices are rejected and every IPv4-mapped spelling normalizes to IPv4", () => {
  assert.equal(normalizeIpAddress("fe80::1%eth0"), null);
  assert.equal(normalizeIpAddress("2001:db8::1%1"), null);
  assert.equal(isValidProxyIpOrCidr("fe80::1%eth0"), false);
  assert.equal(isValidProxyIpOrCidr("fe80::/64%eth0"), false);
  assert.throws(
    () => createTrustedProxyMatcher(["fe80::1%eth0"]),
    /Invalid trusted proxy IP or CIDR/,
  );

  assert.equal(normalizeIpAddress("::ffff:127.0.0.1"), "127.0.0.1");
  assert.equal(normalizeIpAddress("::FFFF:7F00:1"), "127.0.0.1");
  assert.equal(normalizeIpAddress("::ffff:7f00:1"), "127.0.0.1");
  assert.equal(normalizeIpAddress("0:0:0:0:0:ffff:127.0.0.1"), "127.0.0.1");
  assert.equal(normalizeIpAddress("2001:DB8:0:0:0:0:0:1"), "2001:db8::1");
  assert.equal(normalizeIpAddress("203.0.113.9"), "203.0.113.9");
  assert.equal(normalizeIpAddress(""), null);
  assert.equal(normalizeIpAddress("not-an-ip"), null);
  assert.equal(normalizeIpAddress("0x7f.1"), null);
});
