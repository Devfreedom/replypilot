import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFieldDescribedBy,
  fieldMessageIds,
  mergeDescribedBy,
  passwordToggleState,
} from "./field-a11y";

test("buildFieldDescribedBy wires hint, error, and extra IDs without duplicates", () => {
  const ids = fieldMessageIds("email");
  assert.equal(ids.hintId, "email-hint");
  assert.equal(ids.errorId, "email-error");

  assert.equal(
    buildFieldDescribedBy({ fieldId: "email", hasHint: false, hasError: false }),
    undefined,
  );
  assert.equal(
    buildFieldDescribedBy({ fieldId: "email", hasHint: true, hasError: true }),
    "email-hint email-error",
  );
  assert.equal(
    mergeDescribedBy("email-hint", "email-hint email-error", false, undefined),
    "email-hint email-error",
  );
});

test("passwordToggleState provides accessible labels and screen-reader state copy", () => {
  assert.deepEqual(passwordToggleState(false), {
    inputType: "password",
    buttonLabel: "Show password",
    announcement: "Password is hidden.",
  });
  assert.deepEqual(passwordToggleState(true), {
    inputType: "text",
    buttonLabel: "Hide password",
    announcement: "Password is visible.",
  });
});
