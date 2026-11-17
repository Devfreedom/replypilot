import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_SAFE_PRICE_MINOR } from "./business.js";
import {
  currencyFractionDigits,
  formatMajorPrice,
  formatMinorToMajorInput,
  parseMajorPriceToMinor,
} from "./money.js";

test("currencyFractionDigits mirrors ISO currency decimal precision", () => {
  assert.equal(currencyFractionDigits("NGN"), 2);
  assert.equal(currencyFractionDigits("USD"), 2);
  assert.equal(currencyFractionDigits("JPY"), 0);
  assert.equal(currencyFractionDigits("KWD"), 3);
  assert.equal(currencyFractionDigits("invalid"), 2);
});

test("formatMajorPrice formats integer minor units accurately across decimal precisions", () => {
  assert.equal(formatMajorPrice(0, "NGN"), "NGN 0.00");
  assert.equal(formatMajorPrice(5, "NGN"), "NGN 0.05");
  assert.equal(formatMajorPrice(1500000, "NGN"), "NGN 15,000.00");
  assert.equal(formatMajorPrice(1999, "USD"), "USD 19.99");
  assert.equal(formatMajorPrice(1500, "JPY"), "JPY 1,500");
  assert.equal(formatMajorPrice(12345, "KWD"), "KWD 12.345");
});

test("parseMajorPriceToMinor converts decimal amounts without floating-point drift", () => {
  assert.deepEqual(parseMajorPriceToMinor("", "NGN"), {
    ok: true,
    minor: null,
  });
  assert.deepEqual(parseMajorPriceToMinor("   ", "NGN"), {
    ok: true,
    minor: null,
  });
  assert.deepEqual(parseMajorPriceToMinor("0", "NGN"), {
    ok: true,
    minor: 0,
  });
  // Classic IEEE-754 trap: 19.99 * 100 === 1998.9999999999998
  assert.deepEqual(parseMajorPriceToMinor("19.99", "USD"), {
    ok: true,
    minor: 1999,
  });
  assert.deepEqual(parseMajorPriceToMinor("15,000.5", "NGN"), {
    ok: true,
    minor: 1500050,
  });
  assert.deepEqual(parseMajorPriceToMinor("1500", "JPY"), {
    ok: true,
    minor: 1500,
  });
  assert.deepEqual(parseMajorPriceToMinor("12.345", "KWD"), {
    ok: true,
    minor: 12345,
  });
});

test("parseMajorPriceToMinor rejects invalid formats, negatives, precision overflow, and integer overflow", () => {
  const negative = parseMajorPriceToMinor("-500", "NGN");
  assert.equal(negative.ok, false);
  assert.match(negative.message, /cannot be negative/i);

  for (const bad of ["1500.", ".50", "abc", "1,50,000", "1500e2", "15 000"]) {
    const parsed = parseMajorPriceToMinor(bad, "NGN");
    assert.equal(parsed.ok, false, `Expected rejection for "${bad}"`);
  }

  const jpyDecimal = parseMajorPriceToMinor("1500.5", "JPY");
  assert.equal(jpyDecimal.ok, false);
  assert.match(jpyDecimal.message, /whole amounts only/i);

  const ngnExtraDigits = parseMajorPriceToMinor("1500.123", "NGN");
  assert.equal(ngnExtraDigits.ok, false);
  assert.match(ngnExtraDigits.message, /at most 2 decimal places/i);

  const overflow = parseMajorPriceToMinor(
    String(MAX_SAFE_PRICE_MINOR),
    "NGN",
  );
  assert.equal(overflow.ok, false);
  assert.match(overflow.message, /maximum supported amount/i);
});

test("formatMinorToMajorInput round-trips back through parseMajorPriceToMinor", () => {
  assert.equal(formatMinorToMajorInput(null, "NGN"), "");
  assert.equal(formatMinorToMajorInput(1500000, "NGN"), "15000.00");
  assert.equal(formatMinorToMajorInput(1500, "JPY"), "1500");
  assert.equal(formatMinorToMajorInput(12345, "KWD"), "12.345");

  assert.deepEqual(
    parseMajorPriceToMinor(formatMinorToMajorInput(150005, "NGN"), "NGN"),
    { ok: true, minor: 150005 },
  );
  assert.deepEqual(
    parseMajorPriceToMinor(formatMinorToMajorInput(1500, "JPY"), "JPY"),
    { ok: true, minor: 1500 },
  );
});
