import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isOnboardingOriginAllowed,
  normalizeOrigin,
  resolveOnboardingOriginPolicy,
} from "../src/whatsapp/onboarding-origin.js";

const policy = (
  overrides: Partial<ReturnType<typeof resolveOnboardingOriginPolicy>> = {},
) => ({
  allowedOrigin: "https://app.example.test",
  requireExplicitOrigin: true,
  developmentFallbackOrigins: ["http://localhost:3000", "http://127.0.0.1:3000"],
  ...overrides,
});

test("origins normalise to scheme, host, and non-default port", () => {
  assert.equal(normalizeOrigin("https://app.example.test"), "https://app.example.test");
  assert.equal(normalizeOrigin("https://APP.example.test"), "https://app.example.test");
  assert.equal(normalizeOrigin("https://app.example.test:443"), "https://app.example.test");
  assert.equal(normalizeOrigin("http://app.example.test:80"), "http://app.example.test");
  assert.equal(normalizeOrigin("http://app.example.test:3001"), "http://app.example.test:3001");
  assert.equal(normalizeOrigin("https://app.example.test/"), "https://app.example.test");
});

test("malformed, opaque, and non-origin values do not normalise", () => {
  for (const value of [
    null,
    undefined,
    "",
    "   ",
    "null",
    "not a url",
    "https://app.example.test/path",
    "https://app.example.test?x=1",
    "https://app.example.test#fragment",
    "ftp://app.example.test",
    "https://user:pass@app.example.test",
  ]) {
    assert.equal(normalizeOrigin(value), null, String(value));
  }
});

test("a configured origin is the only accepted origin", () => {
  const strict = policy();

  assert.equal(
    isOnboardingOriginAllowed(strict, "https://app.example.test"),
    true,
  );
  assert.equal(
    isOnboardingOriginAllowed(strict, "https://APP.example.test"),
    true,
  );
  assert.equal(
    isOnboardingOriginAllowed(strict, "https://app.example.test:443"),
    true,
  );
  assert.equal(
    isOnboardingOriginAllowed(strict, "http://app.example.test"),
    false,
  );
  assert.equal(
    isOnboardingOriginAllowed(strict, "https://app.example.test:8443"),
    false,
  );
  assert.equal(
    isOnboardingOriginAllowed(strict, "https://other.example.test"),
    false,
  );
  assert.equal(
    isOnboardingOriginAllowed(strict, "https://app.example.test.evil.test"),
    false,
  );
});

test("a missing origin header is always rejected", () => {
  const strict = policy({ allowedOrigin: null, requireExplicitOrigin: false });

  assert.equal(isOnboardingOriginAllowed(strict, undefined), false);
  assert.equal(isOnboardingOriginAllowed(strict, null), false);
  assert.equal(isOnboardingOriginAllowed(strict, ""), false);
  assert.equal(isOnboardingOriginAllowed(strict, "null"), false);
});

test("production requires an explicitly configured origin", () => {
  const production = resolveOnboardingOriginPolicy({
    NODE_ENV: "production",
  });

  assert.equal(production.requireExplicitOrigin, true);
  assert.equal(production.allowedOrigin, null);
  assert.equal(
    isOnboardingOriginAllowed(production, "http://localhost:3000"),
    false,
  );
  assert.equal(
    isOnboardingOriginAllowed(production, "https://app.example.test"),
    false,
  );
});

test("development falls back to the loopback application origin only", () => {
  const development = resolveOnboardingOriginPolicy({ NODE_ENV: "development" });

  assert.equal(development.requireExplicitOrigin, false);
  assert.equal(
    isOnboardingOriginAllowed(development, "http://localhost:3000"),
    true,
  );
  assert.equal(
    isOnboardingOriginAllowed(development, "http://127.0.0.1:3000"),
    true,
  );
  assert.equal(
    isOnboardingOriginAllowed(development, "https://app.example.test"),
    false,
  );
  assert.equal(
    isOnboardingOriginAllowed(development, "http://127.0.0.1:4000"),
    false,
  );
});

test("the configured origin wins over the development fallback", () => {
  const development = resolveOnboardingOriginPolicy({
    NODE_ENV: "development",
    META_ONBOARDING_ALLOWED_ORIGIN: "https://app.example.test",
  });

  assert.equal(
    isOnboardingOriginAllowed(development, "https://app.example.test"),
    true,
  );
  assert.equal(
    isOnboardingOriginAllowed(development, "http://localhost:3000"),
    false,
  );
});
