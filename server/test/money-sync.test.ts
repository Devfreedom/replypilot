import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMinorUnits } from "../src/business/money.js";
import { formatMajorPrice } from "../../src/lib/money.js";

test("frontend formatMajorPrice stays identical to server formatMinorUnits", () => {
  const cases: Array<[number, string]> = [
    [0, "NGN"],
    [5, "NGN"],
    [1500000, "NGN"],
    [1999, "USD"],
    [1500, "JPY"],
    [12345, "KWD"],
    [Number.MAX_SAFE_INTEGER, "NGN"],
  ];

  for (const [minor, currency] of cases) {
    assert.equal(
      formatMajorPrice(minor, currency),
      formatMinorUnits(minor, currency),
    );
  }
});
