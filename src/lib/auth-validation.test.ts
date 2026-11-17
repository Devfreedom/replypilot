import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTH_MIN_PASSWORD_LENGTH,
  AUTH_MAX_PASSWORD_LENGTH,
} from "../../server/src/auth/config";
import {
  AUTH_NAME_MAX_LENGTH,
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  mapAuthServerError,
  validateAuthEmail,
  validateAuthFormFields,
  validateAuthName,
  validateResetPasswordFields,
} from "./auth-validation";

test("frontend auth validation rules stay synchronized with Better Auth server constants", () => {
  assert.equal(AUTH_PASSWORD_MIN_LENGTH, AUTH_MIN_PASSWORD_LENGTH);
  assert.equal(AUTH_PASSWORD_MAX_LENGTH, AUTH_MAX_PASSWORD_LENGTH);
});

test("validateAuthEmail rejects blank and malformed emails cleanly", () => {
  assert.equal(validateAuthEmail("   "), "Enter your email address.");
  assert.match(validateAuthEmail("not-an-email") ?? "", /valid email/i);
  assert.match(validateAuthEmail("ada@") ?? "", /valid email/i);
  assert.equal(validateAuthEmail(" owner@studio.ng "), undefined);
});

test("validateAuthName enforces trimmed non-empty name up to max length", () => {
  assert.match(validateAuthName("   ") ?? "", /name/i);
  assert.match(
    validateAuthName("a".repeat(AUTH_NAME_MAX_LENGTH + 1)) ?? "",
    /120 characters/i,
  );
  assert.equal(validateAuthName("Amaka Bello"), undefined);
});

test("validateAuthFormFields checks sign-up and sign-in constraints cleanly", () => {
  const signUpRejected = validateAuthFormFields("sign-up", {
    name: " ",
    email: "bad",
    password: "short",
  });
  assert.ok(signUpRejected.name);
  assert.ok(signUpRejected.email);
  assert.match(signUpRejected.password ?? "", /at least 8 characters/i);

  const tooLong = validateAuthFormFields("sign-up", {
    name: "Kemi",
    email: "kemi@events.ng",
    password: "x".repeat(AUTH_PASSWORD_MAX_LENGTH + 1),
  });
  assert.match(tooLong.password ?? "", /128 characters/i);

  const signInEmpty = validateAuthFormFields("sign-in", {
    name: "",
    email: "kemi@events.ng",
    password: "",
  });
  assert.equal(signInEmpty.name, undefined);
  assert.match(signInEmpty.password ?? "", /enter your password/i);
});

test("validateResetPasswordFields rejects short and mismatched confirmation passwords", () => {
  const mismatch = validateResetPasswordFields({
    password: "new-password-123",
    confirmPassword: "different-password",
  });
  assert.equal(mismatch.password, undefined);
  assert.match(mismatch.confirmPassword ?? "", /do not match/i);

  const valid = validateResetPasswordFields({
    password: "new-password-123",
    confirmPassword: "new-password-123",
  });
  assert.deepEqual(valid, {});
});

test("mapAuthServerError maps Better Auth codes back to fields or safe form errors", () => {
  assert.deepEqual(
    mapAuthServerError({ code: "USER_ALREADY_EXISTS" }, "sign-up"),
    {
      fieldErrors: {
        email: "An account with this email already exists. Sign in instead.",
      },
      formError: null,
    },
  );

  assert.deepEqual(
    mapAuthServerError({ code: "PASSWORD_TOO_SHORT" }, "reset-password"),
    {
      fieldErrors: { password: "Use at least 8 characters." },
      formError: null,
    },
  );

  const invalidCreds = mapAuthServerError(
    { code: "INVALID_EMAIL_OR_PASSWORD", status: 401 },
    "sign-in",
  );
  assert.deepEqual(invalidCreds.fieldErrors, {});
  assert.match(invalidCreds.formError ?? "", /incorrect/i);

  const invalidToken = mapAuthServerError(
    { code: "INVALID_TOKEN" },
    "reset-password",
  );
  assert.match(invalidToken.formError ?? "", /expired|already used/i);

  const rateLimited = mapAuthServerError({ status: 429 }, "forgot-password");
  assert.match(rateLimited.formError ?? "", /too many attempts/i);
});
