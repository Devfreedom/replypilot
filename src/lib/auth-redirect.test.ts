import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeAuthRedirectPath } from "./auth-redirect.js";

const ORIGIN = "https://app.replypilot.test";

test("sanitizeAuthRedirectPath accepts valid same-origin relative paths", () => {
  assert.equal(sanitizeAuthRedirectPath("/", ORIGIN), "/");
  assert.equal(
    sanitizeAuthRedirectPath("/whatsapp?tab=1", ORIGIN),
    "/whatsapp?tab=1",
  );
  assert.equal(
    sanitizeAuthRedirectPath("/settings#whatsapp", ORIGIN),
    "/settings#whatsapp",
  );
});

test("sanitizeAuthRedirectPath rejects backslash, protocol-relative, and cross-origin URLs", () => {
  assert.equal(sanitizeAuthRedirectPath("/\\evil.com", ORIGIN), "/");
  assert.equal(sanitizeAuthRedirectPath("//evil.com", ORIGIN), "/");
  assert.equal(sanitizeAuthRedirectPath("///evil.com", ORIGIN), "/");
  assert.equal(
    sanitizeAuthRedirectPath("https://evil.com/phish", ORIGIN),
    "/",
  );
  assert.equal(sanitizeAuthRedirectPath("javascript:alert(1)", ORIGIN), "/");
  assert.equal(sanitizeAuthRedirectPath("/foo\nbar", ORIGIN), "/");
  assert.equal(sanitizeAuthRedirectPath("", ORIGIN), "/");
  assert.equal(sanitizeAuthRedirectPath(null, ORIGIN), "/");
});
