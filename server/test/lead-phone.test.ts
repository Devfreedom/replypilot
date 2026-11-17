import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countryOfE164Number,
  describeLeadNumber,
  nationalFormsOfE164,
  normalizeComparableNumber,
  normalizeLeadPhoneNumber,
} from "../src/leads/phone.js";

test("an explicitly international number is stored in E.164", () => {
  const result = normalizeLeadPhoneNumber("+234 803 123 4567", null);

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.e164, "+2348031234567");
  assert.equal(result.ok && result.countryCode, "NG");
});

test("a number without a plus sign needs an explicit country", () => {
  const ambiguous = normalizeLeadPhoneNumber("08031234567", null);

  assert.equal(ambiguous.ok, false);
  assert.equal(!ambiguous.ok && ambiguous.reason, "ambiguous-country");
  assert.match(
    !ambiguous.ok ? ambiguous.message : "",
    /cannot guess a country code/i,
  );
});

test("digits that carry a calling code are not accepted without a country", () => {
  const result = normalizeLeadPhoneNumber("16505551234", null);

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "ambiguous-country");
});

test("a national number with its country becomes E.164 without stripping the trunk zero", () => {
  const result = normalizeLeadPhoneNumber("08031234567", "NG");

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.e164, "+2348031234567");
  assert.equal(result.ok && result.countryCode, "NG");
});

test("a national number may be written without its trunk zero", () => {
  const result = normalizeLeadPhoneNumber("8031234567", "NG");

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.e164, "+2348031234567");
});

test("a number that belongs to another country is rejected as a mismatch", () => {
  const result = normalizeLeadPhoneNumber("+16505551234", "NG");

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "country-mismatch");
});

test("a national number is rejected when it is not valid for the chosen country", () => {
  const result = normalizeLeadPhoneNumber("08031234567", "US");

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "invalid");
});

test("an unsupported country is rejected", () => {
  const requested = normalizeLeadPhoneNumber("8031234567", "ZZ");
  assert.equal(requested.ok, false);
  assert.equal(!requested.ok && requested.reason, "unsupported-country");

  // The country is validated even when no number is given.
  const empty = normalizeLeadPhoneNumber(null, "ZZ");
  assert.equal(empty.ok, false);
  assert.equal(!empty.ok && empty.reason, "unsupported-country");
});

test("a number from an unsupported country is rejected in international form", () => {
  const result = normalizeLeadPhoneNumber("+79123456789", null);

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "unsupported-country");
});

test("characters that are not part of a phone number are rejected", () => {
  const result = normalizeLeadPhoneNumber("abc08031234567", "NG");

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "invalid-characters");
});

test("an unusable number is rejected", () => {
  const result = normalizeLeadPhoneNumber("not-a-number", "NG");

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.reason, "invalid-characters");
});

test("no number at all is accepted and yields no E.164 value", () => {
  for (const value of [null, undefined, "", "   "]) {
    const result = normalizeLeadPhoneNumber(value, null);

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.e164, null);
    assert.equal(result.ok && result.countryCode, null);
  }
});

test("a stored number is comparable whether or not it carries a leading plus", () => {
  assert.equal(
    normalizeComparableNumber("+2348031234567"),
    normalizeComparableNumber("2348031234567"),
  );
  assert.equal(normalizeComparableNumber("+2348031234567"), "+2348031234567");
});

test("a national number without a country is not comparable", () => {
  assert.equal(normalizeComparableNumber("08031234567"), null);
});

test("the country of an E.164 number is read from the number, never guessed", () => {
  assert.equal(countryOfE164Number("+2348031234567"), "NG");
  assert.equal(countryOfE164Number("2348031234567"), "NG");
  assert.equal(countryOfE164Number("08031234567"), null);
  assert.equal(countryOfE164Number(null), null);
});

test("a stored lead number resolves only when its subscriber is identified", () => {
  const resolved = describeLeadNumber("+2348031234567");
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.e164, "+2348031234567");

  // A legacy national number without a country cannot be identified.
  const ambiguous = describeLeadNumber("08031234567");
  assert.equal(ambiguous.resolved, false);
  assert.equal(ambiguous.e164, null);

  // A syntactically plausible value that belongs to no numbering plan is not
  // an established identity either.
  const unassigned = describeLeadNumber("8031234567");
  assert.equal(unassigned.resolved, false);

  assert.equal(describeLeadNumber(null).resolved, false);
});

test("the national forms of a number come from its own numbering plan", () => {
  const nigerian = nationalFormsOfE164("+2348031234567");
  assert.deepEqual(nigerian.sort(), ["08031234567", "8031234567"]);

  const ghanaian = nationalFormsOfE164("+233241234567");
  assert.deepEqual(ghanaian.sort(), ["0241234567", "241234567"]);

  // A number that belongs to no country has no national forms.
  assert.deepEqual(nationalFormsOfE164("+8031234567"), []);
});

test("M15 bare legacy digits without + or 00 remain unresolved rather than matching foreign E.164 calling codes", () => {
  for (const bare of ["13055550123", "8123456789", "08031234567", "2348031234567"]) {
    const identity = describeLeadNumber(bare);
    assert.equal(identity.resolved, false, `Expected ${bare} to stay unresolved`);
    assert.equal(identity.e164, null, `Expected ${bare} e164 to be null`);
    assert.equal(identity.normalizedNational, bare);
  }

  const plusUs = describeLeadNumber("+13055550123");
  assert.deepEqual(plusUs, {
    e164: "+13055550123",
    normalizedNational: null,
    resolved: true,
  });

  const doubleZeroNg = describeLeadNumber("00 234 803 123 4567");
  assert.deepEqual(doubleZeroNg, {
    e164: "+2348031234567",
    normalizedNational: null,
    resolved: true,
  });
});
