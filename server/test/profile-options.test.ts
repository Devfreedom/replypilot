import assert from "node:assert/strict";
import test from "node:test";
import { SUPPORTED_PHONE_COUNTRIES } from "../src/business/phone-countries.js";
import {
  CURATED_PHONE_COUNTRY_CODES,
  PHONE_COUNTRY_OPTIONS,
  getPhoneCountry,
} from "../../src/lib/countries.js";
import {
  CURRENCY_OPTIONS,
  currencyCountryNames,
  defaultCatalogueCurrency,
  isSupportedCurrencyCode,
} from "../../src/lib/currencies.js";
import {
  restorePhoneState,
  validatePhoneInput,
} from "../../src/lib/phone.js";
import { normalizeSearchText } from "../../src/lib/search-option.js";
import {
  TIMEZONE_OPTIONS,
  buildTimezoneOptions,
  isValidTimezone,
} from "../../src/lib/timezones.js";

test("the curated phone country list has exactly 50 shared choices", () => {
  assert.equal(CURATED_PHONE_COUNTRY_CODES.length, 50);
  assert.equal(new Set(CURATED_PHONE_COUNTRY_CODES).size, 50);
  assert.deepEqual(
    [...CURATED_PHONE_COUNTRY_CODES],
    [...SUPPORTED_PHONE_COUNTRIES],
  );
  assert.ok(CURATED_PHONE_COUNTRY_CODES.includes("NG"));
  assert.ok(CURATED_PHONE_COUNTRY_CODES.includes("US"));
  assert.ok(CURATED_PHONE_COUNTRY_CODES.includes("CA"));
  assert.ok(CURATED_PHONE_COUNTRY_CODES.includes("GB"));
  assert.ok(CURATED_PHONE_COUNTRY_CODES.includes("IN"));
  assert.ok(CURATED_PHONE_COUNTRY_CODES.includes("AU"));
});

test("country options expose flags and library-derived calling codes", () => {
  assert.equal(PHONE_COUNTRY_OPTIONS.length, 50);
  assert.equal(getPhoneCountry("NG")?.callingCode, "234");
  assert.equal(getPhoneCountry("US")?.callingCode, "1");
  assert.equal(getPhoneCountry("CA")?.callingCode, "1");
  assert.equal(getPhoneCountry("GB")?.callingCode, "44");
  assert.equal(getPhoneCountry("IN")?.callingCode, "91");
  assert.match(
    PHONE_COUNTRY_OPTIONS.find((option) => option.value === "NG")?.label ?? "",
    /Nigeria \(\+234\)/,
  );
});

test("national phone input normalizes to E.164 without duplicating the prefix", () => {
  const national = validatePhoneInput("NG", "08031234567");
  const international = validatePhoneInput("NG", "+2348031234567");

  assert.deepEqual(national.errors, {});
  assert.equal(national.phone, "+2348031234567");
  assert.equal(national.countryCode, "NG");
  assert.deepEqual(international.errors, {});
  assert.equal(international.phone, "+2348031234567");
  assert.equal(international.countryCode, "NG");
});

test("incomplete or invalid phone input remains visible as a field error", () => {
  const incomplete = validatePhoneInput("NG", "0803");
  const missingCountry = validatePhoneInput("", "08031234567");

  assert.equal(incomplete.phone, null);
  assert.match(incomplete.errors.number ?? "", /valid phone number for Nigeria/);
  assert.equal(missingCountry.phone, null);
  assert.match(missingCountry.errors.country ?? "", /Choose the country/);
});

test("shared calling codes retain their selected ISO country", () => {
  const canada = validatePhoneInput("CA", "4165550123");
  const unitedStates = validatePhoneInput("US", "2025550123");
  const wrongCountry = validatePhoneInput("CA", "2025550123");

  assert.deepEqual(canada.errors, {});
  assert.equal(canada.phone, "+14165550123");
  assert.equal(canada.countryCode, "CA");
  assert.deepEqual(unitedStates.errors, {});
  assert.equal(unitedStates.phone, "+12025550123");
  assert.equal(unitedStates.countryCode, "US");
  assert.match(wrongCountry.errors.number ?? "", /belong to United States/);
});

test("saved phone values are restored safely and ambiguous values are preserved", () => {
  const saved = restorePhoneState("+2348031234567", "NG");
  const detected = restorePhoneState("+14165550123", null);
  const unreadable = restorePhoneState("call the studio", "NG");
  const mismatched = restorePhoneState("+12025550123", "CA");

  assert.equal(saved.countryCode, "NG");
  assert.equal(saved.warning, null);
  assert.match(saved.nationalNumber, /803/);
  assert.equal(detected.countryCode, "CA");
  assert.equal(detected.warning, null);
  assert.equal(unreadable.countryCode, "NG");
  assert.equal(unreadable.nationalNumber, "call the studio");
  assert.match(unreadable.warning ?? "", /could not be interpreted/);
  assert.equal(mismatched.countryCode, "CA");
  assert.equal(mismatched.nationalNumber, "+12025550123");
  assert.match(mismatched.warning ?? "", /appears to belong to United States/);
});

test("blank optional phone values are valid with or without a selected country", () => {
  const empty = validatePhoneInput("", "");
  const countryOnly = validatePhoneInput("NG", "   ");
  const restoredEmpty = restorePhoneState(null, null);

  assert.deepEqual(empty, { phone: null, countryCode: null, errors: {} });
  assert.deepEqual(countryOnly, {
    phone: null,
    countryCode: "NG",
    errors: {},
  });
  assert.deepEqual(restoredEmpty, {
    countryCode: "",
    nationalNumber: "",
    warning: null,
  });
});

test("timezone options include IANA zones and UTC and reject invalid zones", () => {
  const values = TIMEZONE_OPTIONS.map((option) => option.value);
  const restored = buildTimezoneOptions("Africa/Lagos");

  assert.ok(TIMEZONE_OPTIONS.length >= 400);
  assert.ok(values.includes("UTC"));
  assert.ok(values.includes("Africa/Lagos"));
  assert.ok(values.includes("Europe/London"));
  assert.ok(values.includes("Asia/Kolkata"));
  assert.ok(values.includes("America/New_York"));
  assert.ok(
    restored.some((option) => option.value === "Africa/Lagos"),
    "the saved timezone must remain present",
  );
  assert.equal(isValidTimezone("Africa/Lagos"), true);
  assert.equal(isValidTimezone("UTC"), true);
  assert.equal(isValidTimezone("Mars/Olympus_Mons"), false);
  assert.equal(isValidTimezone(""), false);
});

test("timezone search text supports region and city searches", () => {
  const newYork = TIMEZONE_OPTIONS.find(
    (option) => option.value === "America/New_York",
  );
  const haystack = normalizeSearchText(
    [newYork?.label, newYork?.searchText].filter(Boolean).join(" "),
  );

  assert.match(haystack, /new york/);
  assert.match(haystack, /america/);
});

test("currency options use valid ISO codes, readable names, and unique values", () => {
  const values = CURRENCY_OPTIONS.map((option) => option.value);
  const supported = Intl.supportedValuesOf("currency");

  assert.equal(CURRENCY_OPTIONS.length, supported.length);
  assert.equal(new Set(values).size, values.length);
  assert.ok(values.every((value) => isSupportedCurrencyCode(value)));
  assert.equal(isSupportedCurrencyCode("ZZZ"), false);
  assert.match(
    CURRENCY_OPTIONS.find((option) => option.value === "NGN")?.label ?? "",
    /Naira|NGN/,
  );
  assert.ok(currencyCountryNames("NGN").includes("Nigeria"));
});

test("currency search finds options by country and currency code", () => {
  const nigeriaQuery = normalizeSearchText("Nigeria");
  const codeQuery = normalizeSearchText("ngn");
  const matchesNigeria = CURRENCY_OPTIONS.filter((option) =>
    normalizeSearchText(
      [option.label, option.value, option.description, option.searchText]
        .filter(Boolean)
        .join(" "),
    ).includes(nigeriaQuery),
  );
  const matchesCode = CURRENCY_OPTIONS.filter((option) =>
    normalizeSearchText(
      [option.label, option.value, option.description, option.searchText]
        .filter(Boolean)
        .join(" "),
    ).includes(codeQuery),
  );

  assert.ok(matchesNigeria.some((option) => option.value === "NGN"));
  assert.ok(matchesCode.some((option) => option.value === "NGN"));
});

test("new catalogue currencies default from the profile without rewriting old entries", () => {
  assert.equal(defaultCatalogueCurrency("USD"), "USD");
  assert.equal(defaultCatalogueCurrency("NGN"), "NGN");
  assert.equal(defaultCatalogueCurrency(null), "NGN");
  assert.equal(defaultCatalogueCurrency(undefined), "NGN");
  assert.equal(defaultCatalogueCurrency("ZZZ"), "NGN");
});
